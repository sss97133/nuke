import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { RekognitionClient, DetectLabelsCommand } from "npm:@aws-sdk/client-rekognition"
import { callOpenAiChatCompletions } from "../_shared/openaiChat.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface AutomatedTag {
  tag_name: string
  tag_type: 'part' | 'tool' | 'process' | 'issue' | 'custom'
  confidence: number
  x_position: number
  y_position: number
  width: number
  height: number
  ai_detection_data: any
}

interface RekognitionLabel {
  Name: string
  Confidence: number
  Instances?: Array<{
    Confidence: number
    BoundingBox: {
      Left: number
      Top: number
      Width: number
      Height: number
    }
  }>
  Categories?: any[]
}

serve(async (req) => {
  // ... (CORS and Setup remain same)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const startedAt = Date.now()
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false, detectSessionInUrl: false } }
    )

    const { image_url, image_id, timeline_event_id, vehicle_id, user_id, force_reprocess = false } = await req.json()
    if (!image_url) throw new Error('Missing image_url')

    // Idempotency / caching: if we already completed a scan and caller didn't force reprocess,
    // return early so we don't burn tokens again.
    const existingLookup = image_id
      ? supabase.from('vehicle_images').select('id, ai_processing_status, ai_scan_metadata, total_processing_cost, processing_models_used, analysis_history').eq('id', image_id)
      : supabase.from('vehicle_images').select('id, ai_processing_status, ai_scan_metadata, total_processing_cost, processing_models_used, analysis_history').eq('image_url', image_url)
    const { data: existingRow } = await existingLookup.maybeSingle()
    const existingMeta = (existingRow?.ai_scan_metadata || {}) as any
    const existingStatus = String(existingRow?.ai_processing_status || '')
    const alreadyCompleted =
      existingRow?.id &&
      (existingStatus === 'completed' || existingStatus === 'complete') &&
      (existingMeta?.scanned_at || existingMeta?.appraiser?.analyzed_at || existingMeta?.tier_1_analysis)

    if (!force_reprocess && alreadyCompleted) {
      return new Response(
        JSON.stringify({
          success: true,
          cached: true,
          image_id: existingRow?.id,
          ai_processing_status: existingStatus,
          ai_scan_metadata: existingMeta,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Best-effort: mark as processing early to avoid stuck "pending" jobs
    try {
      if (image_id) {
        await supabase
          .from('vehicle_images')
          .update({
            ai_processing_status: 'processing',
            ai_processing_started_at: new Date().toISOString()
          })
          .eq('id', image_id)
      } else {
        await supabase
          .from('vehicle_images')
          .update({
            ai_processing_status: 'processing',
            ai_processing_started_at: new Date().toISOString()
          })
          .eq('image_url', image_url)
      }
    } catch (err) {
      // Non-blocking
      console.warn('Failed to mark image as processing (non-blocking):', err)
    }

    // 1. Run Rekognition (Label Detection)
    // Cache: reuse prior labels if present so we don't re-download/re-scan the same image.
    let rekognitionData: any = existingMeta?.rekognition || {}
    if (!rekognitionData || Object.keys(rekognitionData).length === 0) {
      try {
        rekognitionData = await analyzeImageWithRekognition(image_url)
      } catch (rekError) {
        console.warn('Rekognition failed, continuing without labels:', rekError)
        // Continue without Rekognition data - not critical
        rekognitionData = {}
      }
    }

    // 2. Determine "Appraiser Context" from labels
    const context = determineAppraiserContext(rekognitionData)

    // Cheap triage gate: only run expensive OCR-style extractors (SPID/VIN tag)
    // when the image is likely to contain meaningful text (documents, labels, plates).
    const labelNames: string[] = (rekognitionData?.Labels || []).map((l: any) =>
      String(l?.Name || '').toLowerCase()
    )
    const likelyTextImage =
      labelNames.some((n) =>
        n.includes('text') ||
        n.includes('document') ||
        n.includes('label') ||
        n.includes('paper') ||
        n.includes('poster') ||
        n.includes('license plate') ||
        n.includes('number plate') ||
        n.includes('sign')
      )
    
    // 3. Run OpenAI Vision "Appraiser Brain" if context is found
    let appraiserResult = null
    if (context) {
      appraiserResult = await runAppraiserBrain(image_url, context, supabase, user_id)
    }

    // 3.5. Check for SPID sheet and extract data if found
    let spidData = null
    let spidResponse = null
    const hasSpidAlready = Boolean(existingMeta?.spid) || existingMeta?.scan_type === 'spid_sheet'
    if (likelyTextImage && !hasSpidAlready) {
      try {
        spidResponse = await detectSPIDSheet(image_url, vehicle_id, supabase, user_id)
        if (spidResponse?.is_spid_sheet && spidResponse.confidence > 70) {
          spidData = spidResponse.extracted_data
          console.log('SPID sheet detected:', spidData)
        }
      } catch (err) {
        console.warn('SPID detection failed:', err)
        // Don't fail the whole analysis if SPID detection fails
      }
    }

    // 3.6. Check for VIN tag/plate and extract VIN for verification
    let vinTagData = null
    let vinTagResponse = null
    const hasVinTagAlready = Boolean(existingMeta?.vin_tag)
    if (likelyTextImage && !hasVinTagAlready) {
      try {
        vinTagResponse = await detectAndExtractVINTag(image_url, vehicle_id, supabase, user_id)
        if (vinTagResponse?.is_vin_tag && vinTagResponse.confidence > 70) {
          vinTagData = vinTagResponse.extracted_data
          console.log('VIN tag detected:', vinTagData)
          
          // Verify extracted VIN against vehicle's VIN if available
          if (vinTagData.vin && vehicle_id) {
            const { data: vehicle } = await supabase
              .from('vehicles')
              .select('vin')
              .eq('id', vehicle_id)
              .maybeSingle()
            
            if (vehicle) {
              if (vehicle.vin && vehicle.vin.toUpperCase() === vinTagData.vin.toUpperCase()) {
                vinTagData.verification_status = 'verified'
                vinTagData.verification_confidence = 1.0
                console.log('✅ VIN verified: matches vehicle record')
              } else if (vehicle.vin) {
                vinTagData.verification_status = 'mismatch'
                vinTagData.verification_confidence = 0.0
                console.warn('⚠️ VIN mismatch: extracted VIN does not match vehicle record')
              } else {
                vinTagData.verification_status = 'new'
                vinTagData.verification_confidence = vinTagResponse.confidence / 100
                console.log('📝 New VIN extracted from tag')
                
                // Auto-update vehicle VIN if vehicle doesn't have one
                await supabase
                  .from('vehicles')
                  .update({ 
                    vin: vinTagData.vin,
                    vin_source: 'Photo OCR'
                  })
                  .eq('id', vehicle_id)
                
                // Create field source attribution for the VIN
                await supabase
                  .from('vehicle_field_sources')
                  .insert({
                    vehicle_id: vehicle_id,
                    field_name: 'vin',
                    field_value: vinTagData.vin,
                    source_type: 'ai_scraped',
                    source_url: image_url,
                    confidence_score: Math.round(vinTagResponse.confidence),
                    user_id: user_id,
                    extraction_method: 'ocr',
                    metadata: { 
                      extracted_via: 'vin_plate_ocr',
                      detection_confidence: vinTagResponse.confidence,
                      vin_condition: vinTagData.condition || 'unknown'
                    }
                  })
                  .then(() => console.log('✅ VIN field source created'))
                  .catch(err => console.warn('Failed to create VIN field source:', err))
                
                // Create timeline event for VIN extraction
                await supabase
                  .from('timeline_events')
                  .insert({
                    vehicle_id: vehicle_id,
                    user_id: user_id,
                    event_type: 'auction_listed',
                    event_date: new Date().toISOString(),
                    title: 'VIN Extracted from Photo',
                    description: `VIN ${vinTagData.vin} was extracted from a VIN plate photo via AI vision.`,
                    source: 'AI Vision OCR',
                    source_type: 'user_input',
                    confidence_score: Math.round(vinTagResponse.confidence),
                    image_urls: [image_url],
                    metadata: {
                      vin: vinTagData.vin,
                      extraction_method: 'ocr',
                      vin_condition: vinTagData.condition || 'unknown'
                    }
                  })
                  .then(() => console.log('✅ VIN timeline event created'))
                  .catch(err => console.warn('Failed to create VIN timeline event:', err))
                
                // Create VIN validation record (multi-proof system)
                // Use existing vin_validations table structure
                await supabase
                  .from('vin_validations')
                  .insert({
                    vehicle_id: vehicle_id,
                    user_id: user_id,
                    vin_photo_url: image_url,
                    extracted_vin: vinTagData.vin,
                    submitted_vin: vinTagData.vin,
                    validation_status: vinTagResponse.confidence >= 85 ? 'approved' : 'pending',
                    confidence_score: vinTagResponse.confidence / 100, // Decimal format
                    validation_method: 'ai_vision'
                  })
                  .then(() => console.log('✅ VIN validation created'))
                  .catch(err => {
                    // Might already exist - that's ok, multiple proofs are good
                    console.log('VIN validation insert note:', err?.message || 'duplicate ok');
                  })
                
                // Trigger NHTSA VIN decode to auto-fill specs (non-blocking)
                fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/decode-vin-and-update`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
                  },
                  body: JSON.stringify({
                    vehicle_id: vehicle_id,
                    vin: vinTagData.vin
                  })
                })
                  .then(() => console.log('✅ VIN decode triggered'))
                  .catch(err => console.warn('VIN decode trigger failed:', err))
              }
            }
          }
        }
      } catch (err) {
        console.warn('VIN tag detection failed:', err)
        // Don't fail the whole analysis if VIN tag detection fails
      }
    }

    // 4. Generate Tags
    const automatedTags = generateAutomatedTags(rekognitionData)

    // 5. Save Everything
    // Update image metadata with appraiser result, SPID data, and VIN tag data
    const tier1Compat = {
      category: context || 'general',
      angle: context || null,
      condition_glance: appraiserResult?.condition_glance
        ?? appraiserResult?.condition
        ?? appraiserResult?.appraisal?.condition
        ?? null,
      components_visible: appraiserResult?.components_visible
        ?? appraiserResult?.components
        ?? appraiserResult?.visible_components
        ?? []
    }

    const metadataUpdate: any = {
      rekognition: rekognitionData,
      scanned_at: new Date().toISOString(),
      processing_tier_reached: 1,
      tier_1_analysis: tier1Compat
    }
    if (appraiserResult) {
      metadataUpdate.appraiser = appraiserResult
    }
    if (spidData) {
      metadataUpdate.spid = spidData
    }
    if (vinTagData) {
      metadataUpdate.vin_tag = vinTagData
    }
    
    // Update image record
    const imageLookup = image_id
      ? supabase.from('vehicle_images').select('id, ai_scan_metadata').eq('id', image_id)
      : supabase.from('vehicle_images').select('id, ai_scan_metadata').eq('image_url', image_url)
    const { data: imageRecord } = await imageLookup.maybeSingle()
    
    if (imageRecord) {
      const existing = imageRecord.ai_scan_metadata || {}

      // Cost + usage aggregation (OpenAI only; Rekognition isn't accounted here).
      const costBreakdown: any[] = []
      const modelsUsed = new Set<string>()
      let totalTokens = 0
      let totalCostUsd = 0

      const addCost = (label: string, obj: any) => {
        const usage = obj?._usage || obj?.usage || null
        const cost = Number(obj?._cost_usd ?? 0)
        const model = obj?._model || obj?.model || null
        if (model) modelsUsed.add(String(model))
        if (usage?.total_tokens) totalTokens += Number(usage.total_tokens) || 0
        if (Number.isFinite(cost) && cost > 0) totalCostUsd += cost
        if (usage || model || (Number.isFinite(cost) && cost >= 0)) {
          costBreakdown.push({ step: label, model, usage, cost_usd: Number.isFinite(cost) ? cost : null })
        }
      }

      addCost('appraiser', appraiserResult)
      addCost('spid', spidResponse)
      addCost('vin_tag', vinTagResponse)

      const prevCost = Number(existingRow?.total_processing_cost || 0)
      const nextCost = prevCost + (Number.isFinite(totalCostUsd) ? totalCostUsd : 0)
      const prevModels: string[] = Array.isArray(existingRow?.processing_models_used) ? existingRow!.processing_models_used : []
      const nextModels = Array.from(new Set([...prevModels, ...Array.from(modelsUsed)])).slice(0, 25)
      const prevHistory = (existingRow?.analysis_history && typeof existingRow.analysis_history === 'object') ? existingRow.analysis_history : {}
      const runId = `run_${Date.now()}`
      const nextHistory = {
        ...prevHistory,
        [runId]: {
          at: new Date().toISOString(),
          function: 'analyze-image',
          total_tokens: totalTokens,
          cost_usd: totalCostUsd,
          breakdown: costBreakdown,
        }
      }

      await supabase
        .from('vehicle_images')
        .update({
          ai_scan_metadata: { ...existing, ...metadataUpdate },
          ai_processing_status: 'completed',
          ai_processing_completed_at: new Date().toISOString(),
          total_processing_cost: nextCost,
          processing_models_used: nextModels,
          analysis_history: nextHistory,
        })
        .eq('id', imageRecord.id)

      // Best-effort audit trail: save a scan session snapshot (does not replace older runs).
      // This makes it possible to backfill/re-extract later and track accuracy/cost over time.
      try {
        if (vehicle_id) {
          const modelsUsedArr = [
            // Rekognition may be missing if not configured
            (metadataUpdate?.rekognition ? 'aws-rekognition-detect-labels' : null),
            (appraiserResult ? 'gpt-4o-mini' : null),
            (spidData ? 'gpt-4o' : null),
            (vinTagData ? 'gpt-4o' : null),
          ].filter(Boolean)

          await supabase
            .from('ai_scan_sessions')
            .insert({
              vehicle_id,
              event_id: timeline_event_id || null,
              image_ids: [imageRecord.id],
              ai_model_version: `analyze-image@2025-12-14`,
              ai_model_cost: totalCostUsd || 0,
              total_images_analyzed: 1,
              scan_duration_seconds: Math.round((Date.now() - startedAt) / 10) / 100,
              total_tokens_used: totalTokens || null,
              fields_extracted: [
                (appraiserResult ? 'tier1' : null),
                (spidData ? 'spid' : null),
                (vinTagData ? 'vin' : null),
                (metadataUpdate?.rekognition ? 'tags' : null),
              ].filter(Boolean),
              concerns_flagged: [],
              overall_confidence: null,
              context_available: {
                rekognition: Boolean(metadataUpdate?.rekognition),
                vehicle_id: Boolean(vehicle_id),
                timeline_event_id: Boolean(timeline_event_id),
                models_used: modelsUsedArr,
                openai_cost_usd: totalCostUsd || 0,
                openai_tokens: totalTokens || 0,
              },
              created_by: user_id || null,
            })
        }
      } catch (err) {
        console.warn('Failed to write ai_scan_sessions (non-blocking):', err)
      }
      
      // If SPID data was extracted, also save to dedicated table
      if (spidData && spidResponse && vehicle_id) {
        if (spidResponse.is_spid_sheet && spidResponse.confidence > 70) {
          const extracted = spidResponse.extracted_data
          
          // Upsert SPID data to dedicated table (triggers auto-verification)
          const { error: spidSaveError } = await supabase
            .from('vehicle_spid_data')
            .upsert({
              vehicle_id: vehicle_id,
              image_id: imageRecord.id,
              vin: extracted.vin || null,
              model_code: extracted.model_code || null,
              build_date: extracted.build_date || null,
              sequence_number: extracted.sequence_number || null,
              paint_code_exterior: extracted.paint_code_exterior || null,
              paint_code_interior: extracted.paint_code_interior || null,
              engine_code: extracted.engine_code || null,
              transmission_code: extracted.transmission_code || null,
              axle_ratio: extracted.axle_ratio || null,
              rpo_codes: extracted.rpo_codes || [],
              extraction_confidence: spidResponse.confidence,
              raw_text: spidResponse.raw_text || null,
              extraction_model: 'gpt-4o'
            }, {
              onConflict: 'vehicle_id',
              ignoreDuplicates: false
            })
          
          if (spidSaveError) {
            console.error('Failed to save SPID data:', spidSaveError)
          } else {
            console.log('✅ SPID data saved - auto-verification triggered')
          }
          
          // If VIN was extracted and vehicle doesn't have one, update vehicle record
          if (extracted.vin) {
            const { data: vehicle } = await supabase
              .from('vehicles')
              .select('vin')
              .eq('id', vehicle_id)
              .maybeSingle()
            
            if (vehicle && !vehicle.vin) {
              await supabase
                .from('vehicles')
                .update({ vin: extracted.vin })
                .eq('id', vehicle_id)
            }
          }
        }
      }
    }

    // Insert automated tags
    await insertAutomatedTags(supabase, automatedTags, image_url, timeline_event_id, vehicle_id)

    return new Response(
      JSON.stringify({
        success: true,
        tags: automatedTags,
        appraisal: appraiserResult
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error in analyze-image function:', error)
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorStack = error instanceof Error ? error.stack : undefined
    console.error('Error details:', { message: errorMessage, stack: errorStack })

    // Best-effort: mark image as failed and store error in ai_scan_metadata (no ai_processing_error column on vehicle_images)
    try {
      const body = await req.json().catch(() => ({} as any))
      const imageId = body?.image_id ?? null
      const imageUrl = body?.image_url ?? null
      const q = imageId
        ? supabase.from('vehicle_images').select('id, ai_scan_metadata').eq('id', imageId)
        : (imageUrl ? supabase.from('vehicle_images').select('id, ai_scan_metadata').eq('image_url', imageUrl) : null)

      if (q) {
        const { data: img } = await q.maybeSingle()
        if (img?.id) {
          const existing = img.ai_scan_metadata || {}
          await supabase
            .from('vehicle_images')
            .update({
              ai_processing_status: 'failed',
              ai_processing_completed_at: new Date().toISOString(),
              ai_scan_metadata: {
                ...existing,
                last_error: {
                  message: errorMessage,
                  at: new Date().toISOString()
                }
              }
            })
            .eq('id', img.id)
        }
      }
    } catch (err) {
      console.warn('Failed to mark image as failed (non-blocking):', err)
    }

    return new Response(
      JSON.stringify({ 
        error: errorMessage,
        success: false 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

// ... (Helper functions for Rekognition and Tags remain, I will add the new Appraiser logic below)

function determineAppraiserContext(rekognitionData: any): string | null {
  const labels = rekognitionData.Labels?.map((l: any) => l.Name.toLowerCase()) || []
  
  if (labels.includes('engine') || labels.includes('engine control unit')) return 'engine'
  if (labels.includes('interior') || labels.includes('seat') || labels.includes('dashboard')) return 'interior'
  if (labels.includes('undercarriage') || labels.includes('suspension') || labels.includes('chassis')) return 'undercarriage'
  if (labels.includes('vehicle') || labels.includes('car') || labels.includes('truck')) return 'exterior'
  
  return null
}

// Import shared SPID detection utility
async function detectSPIDSheet(imageUrl: string, vehicleId?: string, supabaseClient?: any, userId?: string) {
  const { detectSPIDSheet: detectSPID } = await import('../_shared/detectSPIDSheet.ts')
  return await detectSPID(imageUrl, vehicleId, supabaseClient, userId)
}

async function detectAndExtractVINTag(imageUrl: string, vehicleId?: string, supabaseClient?: any, userId?: string) {
  // Get user API key or fallback to system key
  let openAiKey: string | null = null;
  
  try {
    if (userId && supabaseClient) {
      const { getUserApiKey } = await import('../_shared/getUserApiKey.ts')
      const apiKeyResult = await getUserApiKey(
        supabaseClient,
        userId,
        'openai',
        'OPENAI_API_KEY'
      )
      openAiKey = apiKeyResult.apiKey;
    } else {
      openAiKey = Deno.env.get('OPENAI_API_KEY') || null;
    }
  } catch (err) {
    console.warn('Failed to get API key, using system key:', err)
    openAiKey = Deno.env.get('OPENAI_API_KEY') || null;
  }
  
  if (!openAiKey) return null

  const res = await callOpenAiChatCompletions({
    apiKey: openAiKey,
    body: {
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are an expert at identifying and reading VIN (Vehicle Identification Number) tags and plates on vehicles.

VIN tags/plates are metal or plastic plates typically found:
- On the driver's side dashboard (visible through windshield)
- On the driver's side door jamb
- On the firewall/engine bay
- On the frame/chassis

A VIN is EXACTLY 17 characters, alphanumeric (no I, O, or Q), and follows ISO 3779 format.

Your task:
1. Determine if this image shows a VIN tag/plate
2. If yes, extract the complete 17-character VIN
3. Assess the condition/legibility of the VIN tag
4. Note any concerns about authenticity (rivets, tampering, etc.)

Return a JSON object with:
{
  "is_vin_tag": boolean,
  "confidence": number (0-100),
  "extracted_data": {
    "vin": string | null (17-character VIN if found),
    "vin_location": string | null ("dashboard", "door_jamb", "firewall", "frame", "unknown"),
    "condition": string | null ("excellent", "good", "fair", "poor", "illegible"),
    "authenticity_concerns": string[] (empty if none, e.g. ["replacement_rivets", "paint_over", "tampering"]),
    "readability": string | null ("clear", "partial", "difficult", "illegible")
  },
  "raw_text": string (any visible text in the image)
}

Be very careful to extract the EXACT VIN - check each character carefully. VINs are critical for vehicle identification.`
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Analyze this image. Is it a VIN tag or plate? If yes, extract the complete 17-character VIN and assess its condition.'
            },
            {
              type: 'image_url',
              image_url: {
                url: imageUrl,
                detail: 'high'
              }
            }
          ]
        }
      ],
      max_tokens: 1000,
      response_format: { type: 'json_object' }
    },
    timeoutMs: 20000,
  })

  if (!res.ok) return null

  try {
    const parsed = JSON.parse(res.content_text || '{}')
    return {
      ...parsed,
      _usage: res.usage || null,
      _cost_usd: res.cost_usd ?? null,
      _model: res.model || 'gpt-4o',
    }
  } catch {
    return null
  }
}

async function runAppraiserBrain(imageUrl: string, context: string, supabaseClient?: any, userId?: string) {
  // Get user API key or fallback to system key
  let openAiKey: string | null = null;
  
  try {
    if (userId && supabaseClient) {
      const { getUserApiKey } = await import('../_shared/getUserApiKey.ts')
      const apiKeyResult = await getUserApiKey(
        supabaseClient,
        userId,
        'openai',
        'OPENAI_API_KEY'
      )
      openAiKey = apiKeyResult.apiKey;
    } else {
      openAiKey = Deno.env.get('OPENAI_API_KEY') || null;
    }
  } catch (err) {
    console.warn('Failed to get API key, using system key:', err)
    openAiKey = Deno.env.get('OPENAI_API_KEY') || null;
  }
  
  if (!openAiKey) return null

  const prompts = {
    engine: `Analyze this engine bay image. Return a JSON object with:
{
  "description": "One detailed sentence (e.g., Stock 5.7L V8 engine bay with clean wiring and visible A/C compressor)",
  "is_stock": true or false,
  "is_clean": true or false,
  "has_visible_leaks": true or false,
  "wiring_quality": true or false,
  "rust_presence": true or false,
  "visible_components": ["component1", "component2"],
  "category": "engine_bay",
  "model": "gpt-4o-mini"
}`,
    interior: `Analyze this interior image. Return a JSON object with:
{
  "description": "One detailed sentence (e.g., Original bench seat interior with column shifter and AM/FM radio)",
  "seats_good_condition": true or false,
  "dash_cracks": true or false,
  "stock_radio": true or false,
  "manual_transmission": true or false,
  "carpets_clean": true or false,
  "visible_features": ["feature1", "feature2"],
  "category": "interior",
  "model": "gpt-4o-mini"
}`,
    undercarriage: `Analyze this undercarriage image. Return a JSON object with:
{
  "description": "One detailed sentence (e.g., Clean frame rails with recent suspension work and minimal surface rust)",
  "heavy_rust": true or false,
  "recent_work": true or false,
  "leaks_detected": true or false,
  "exhaust_condition": true or false,
  "visible_components": ["component1", "component2"],
  "category": "undercarriage",
  "model": "gpt-4o-mini"
}`,
    exterior: `Analyze this exterior image. Return a JSON object with:
{
  "description": "One detailed sentence (e.g., Driver side view showing red paint with chrome trim and original hubcaps)",
  "body_straight": true or false,
  "paint_glossy": true or false,
  "visible_damage": true or false,
  "modifications": true or false,
  "visible_panels": ["panel1", "panel2"],
  "category": "exterior",
  "model": "gpt-4o-mini"
}`
  }

  const prompt = prompts[context as keyof typeof prompts] || prompts.exterior

  const res = await callOpenAiChatCompletions({
    apiKey: openAiKey,
    body: {
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: imageUrl } }
          ]
        }
      ],
      max_tokens: 500,
      response_format: { type: "json_object" }
    },
    timeoutMs: 20000,
  })

  if (!res.ok) return null

  const content = res.content_text
  try {
    // extract JSON from markdown block if present
    const jsonMatch = (content || '').match(/\{[\s\S]*\}/)
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : (content || '{}'))
    return {
      ...parsed,
      _usage: res.usage || null,
      _cost_usd: res.cost_usd ?? null,
      _model: res.model || 'gpt-4o-mini',
    }
  } catch {
    return {
      raw_analysis: content,
      _usage: res.usage || null,
      _cost_usd: res.cost_usd ?? null,
      _model: res.model || 'gpt-4o-mini',
    }
  }
}


async function analyzeImageWithRekognition(imageUrl: string) {
  const region = Deno.env.get('AWS_REGION') || 'us-east-1'
  const accessKeyId = Deno.env.get('AWS_ACCESS_KEY_ID')
  const secretAccessKey = Deno.env.get('AWS_SECRET_ACCESS_KEY')
  const sessionToken = Deno.env.get('AWS_SESSION_TOKEN') || undefined

  if (!accessKeyId || !secretAccessKey) {
    throw new Error('AWS credentials not configured')
  }

  // Download image to analyze
  const imageResponse = await fetch(imageUrl)
  if (!imageResponse.ok) {
    throw new Error(`Failed to download image: ${imageResponse.status} ${imageResponse.statusText}`)
  }
  const imageBytes = new Uint8Array(await imageResponse.arrayBuffer())

  // Use AWS SDK v3 for proper SigV4 handling
  const client = new RekognitionClient({
    region,
    credentials: { accessKeyId, secretAccessKey, sessionToken }
  })

  const command = new DetectLabelsCommand({
    Image: { Bytes: imageBytes },
    MaxLabels: 50,
    MinConfidence: 60
  })

  const result = await client.send(command)
  return result
}

function generateAutomatedTags(rekognitionData: any): AutomatedTag[] {
  const tags: AutomatedTag[] = []

  if (!rekognitionData.Labels) return tags

  // Automotive-specific label mapping
  const automotiveMapping: { [key: string]: { type: string, mappedName: string } } = {
    // Vehicle parts
    'Car': { type: 'part', mappedName: 'Vehicle' },
    'Automobile': { type: 'part', mappedName: 'Vehicle' },
    'Truck': { type: 'part', mappedName: 'Truck' },
    'Engine': { type: 'part', mappedName: 'Engine' },
    'Wheel': { type: 'part', mappedName: 'Wheel' },
    'Tire': { type: 'part', mappedName: 'Tire' },
    'Bumper': { type: 'part', mappedName: 'Bumper' },
    'Headlight': { type: 'part', mappedName: 'Headlight' },
    'Taillight': { type: 'part', mappedName: 'Taillight' },
    'Door': { type: 'part', mappedName: 'Door' },
    'Hood': { type: 'part', mappedName: 'Hood' },
    'Windshield': { type: 'part', mappedName: 'Windshield' },
    'Mirror': { type: 'part', mappedName: 'Mirror' },
    'Grille': { type: 'part', mappedName: 'Grille' },
    'Exhaust': { type: 'part', mappedName: 'Exhaust' },
    'Brake': { type: 'part', mappedName: 'Brake' },
    'Suspension': { type: 'part', mappedName: 'Suspension' },
    'Transmission': { type: 'part', mappedName: 'Transmission' },
    'Radiator': { type: 'part', mappedName: 'Radiator' },
    'Battery': { type: 'part', mappedName: 'Battery' },

    // Tools
    'Wrench': { type: 'tool', mappedName: 'Wrench' },
    'Screwdriver': { type: 'tool', mappedName: 'Screwdriver' },
    'Hammer': { type: 'tool', mappedName: 'Hammer' },
    'Drill': { type: 'tool', mappedName: 'Drill' },
    'Jack': { type: 'tool', mappedName: 'Jack' },
    'Tool': { type: 'tool', mappedName: 'Tool' },
    'Equipment': { type: 'tool', mappedName: 'Equipment' },
    'Machine': { type: 'tool', mappedName: 'Machine' },

    // Processes/Activities
    'Repair': { type: 'process', mappedName: 'Repair' },
    'Maintenance': { type: 'process', mappedName: 'Maintenance' },
    'Installation': { type: 'process', mappedName: 'Installation' },
    'Welding': { type: 'process', mappedName: 'Welding' },
    'Painting': { type: 'process', mappedName: 'Painting' },
    'Assembly': { type: 'process', mappedName: 'Assembly' },

    // Issues/Damage
    'Rust': { type: 'issue', mappedName: 'Rust' },
    'Damage': { type: 'issue', mappedName: 'Damage' },
    'Crack': { type: 'issue', mappedName: 'Crack' },
    'Dent': { type: 'issue', mappedName: 'Dent' },
    'Scratch': { type: 'issue', mappedName: 'Scratch' },
    'Wear': { type: 'issue', mappedName: 'Wear' }
  }

  rekognitionData.Labels.forEach((label: RekognitionLabel) => {
    const mapping = automotiveMapping[label.Name]

    if (mapping && label.Confidence >= 70) {
      if (label.Instances && label.Instances.length > 0) {
        // Create tags for each detected instance with bounding boxes
        label.Instances.forEach((instance, index) => {
          if (instance.Confidence >= 60) {
            tags.push({
              tag_name: mapping.mappedName,
              tag_type: mapping.type as any,
              confidence: Math.round(instance.Confidence),
              // Store as integers (percent) so dedupe/unique keys are stable.
              x_position: Math.round(instance.BoundingBox.Left * 100),
              y_position: Math.round(instance.BoundingBox.Top * 100),
              width: Math.round(instance.BoundingBox.Width * 100),
              height: Math.round(instance.BoundingBox.Height * 100),
              ai_detection_data: {
                rekognition_label: label.Name,
                rekognition_confidence: label.Confidence,
                instance_index: index,
                categories: label.Categories || []
              }
            })
          }
        })
      } else {
        // Create a general tag without specific location
        tags.push({
          tag_name: mapping.mappedName,
          tag_type: mapping.type as any,
          confidence: Math.round(label.Confidence),
          x_position: 50, // Center of image
          y_position: 50,
          width: 20,
          height: 20,
          ai_detection_data: {
            rekognition_label: label.Name,
            rekognition_confidence: label.Confidence,
            categories: label.Categories || []
          }
        })
      }
    }
  })

  return tags
}

async function insertAutomatedTags(
  supabase: any,
  tags: AutomatedTag[],
  imageUrl: string,
  timelineEventId?: string,
  vehicleId?: string
) {
  if (tags.length === 0) return

  try {
    const tagData = tags.map(tag => ({
      image_url: imageUrl,
      timeline_event_id: timelineEventId,
      vehicle_id: vehicleId,
      tag_name: tag.tag_name,
      tag_type: tag.tag_type,
      x_position: tag.x_position,
      y_position: tag.y_position,
      width: tag.width,
      height: tag.height,
      confidence: tag.confidence,
      created_by: '00000000-0000-0000-0000-000000000000', // System user
      verified: false, // AI tags need verification
      ai_detection_data: tag.ai_detection_data,
      manual_override: false
    }))

    // Insert tags, ignore conflicts (don't overwrite existing manual tags)
    const { error } = await supabase
      .from('image_tags')
      .upsert(tagData, {
        onConflict: 'image_url,tag_name,x_position,y_position',
        ignoreDuplicates: true
      })

    if (error) {
      console.error('Error inserting automated tags:', error)
      // Don't throw - tag insertion failure shouldn't break the whole analysis
      console.warn('Continuing without tags due to insertion error')
    }
  } catch (err) {
    console.error('Exception inserting automated tags:', err)
    // Don't throw - tag insertion failure shouldn't break the whole analysis
  }
}