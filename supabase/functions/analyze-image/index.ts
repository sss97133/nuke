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

  const paused = (() => {
    const v = String(Deno.env.get('NUKE_ANALYSIS_PAUSED') || '').trim().toLowerCase()
    return v === '1' || v === 'true' || v === 'yes' || v === 'on'
  })()
  if (paused) {
    return new Response(
      JSON.stringify({
        success: false,
        paused: true,
        message: 'AI image analysis paused (NUKE_ANALYSIS_PAUSED)'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  }

  try {
    const startedAt = Date.now()
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false, detectSessionInUrl: false } }
    )

    const { image_url, image_id, timeline_event_id, vehicle_id, user_id, force_reprocess = false } = await req.json()
    if (!image_url) throw new Error('Missing image_url')

    // Reuse a single service key for all internal calls. Different deployments used different env var names.
    const serviceRoleKey =
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
      Deno.env.get('SERVICE_ROLE_KEY') ||
      Deno.env.get('SUPABASE_SERVICE_KEY') ||
      Deno.env.get('SUPABASE_KEY') ||
      ''

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

    // 2. Determine "Appraiser Context" from labels (used as a hint, not a gate)
    const context = determineAppraiserContext(rekognitionData) || 'general'

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
    
    // 3. Run Vision Analysis - Try Gemini first (40x cheaper), fallback to GPT
    let appraiserResult: any = null
    let appraiserDebug: any = { call_started: true }
    try {
      console.log('[analyze-image] Running appraiser brain with context:', context)
      
      // Try Gemini Flash first ($0.0001/image vs $0.004/image for GPT)
      console.log('[analyze-image] Attempting Gemini Flash (cost: ~$0.0001)...')
      let result = await runAppraiserBrainGemini(image_url, context)
      
      if (result && result.category && result.category !== 'error' && !result._gemini_error) {
        console.log('[analyze-image] Gemini SUCCESS - using cheap model')
        appraiserDebug.model_used = 'gemini-1.5-flash'
      } else {
        // Fallback to GPT-4o-mini if Gemini fails
        const geminiError = result?._gemini_error || 'unknown'
        const geminiErrorMsg = result?._error_message || ''
        console.log('[analyze-image] Gemini failed/empty, reason:', geminiError, geminiErrorMsg, '- falling back to GPT-4o-mini (cost: ~$0.004)...')
        appraiserDebug.gemini_error = geminiError
        appraiserDebug.gemini_error_message = geminiErrorMsg
        result = await runAppraiserBrain(image_url, context, supabase, user_id)
        appraiserDebug.model_used = 'gpt-4o-mini'
        appraiserDebug.gemini_failed = true
      }
      
      console.log('[analyze-image] Vision analysis returned type:', typeof result, 'truthy:', !!result)
      
      if (result && result._debug) {
        appraiserDebug = { ...appraiserDebug, ...result._debug }
        delete result._debug
      }
      appraiserResult = result
      
      if (appraiserResult && appraiserResult.category !== 'error') {
        console.log('[analyze-image] Appraiser brain SUCCESS:', JSON.stringify({
          category: appraiserResult.category,
          subject: appraiserResult.subject,
          camera_position: appraiserResult.camera_position,
          model: appraiserResult._model
        }))
        appraiserDebug.call_success = true
      } else if (appraiserResult && appraiserResult.category === 'error') {
        console.warn('[analyze-image] Appraiser brain returned error category:', appraiserResult.subject)
        appraiserDebug.returned_error = true
        appraiserDebug.error_subject = appraiserResult.subject
      } else {
        console.warn('[analyze-image] Appraiser brain returned null/undefined')
        appraiserDebug.returned_null = true
      }
    } catch (appraiserError) {
      console.error('[analyze-image] Appraiser brain threw exception:', appraiserError)
      appraiserDebug.threw_exception = true
      appraiserDebug.exception = String(appraiserError)
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
          // Normalize + validate VIN before we write anything to core tables.
          const raw = String(vinTagResponse?.extracted_data?.vin || '').toUpperCase().trim()
          const normalizedVin = raw.replace(/[^A-Z0-9]/g, '')
          
          // Modern VINs are 17 characters, but pre-1981 vehicles (like early Porsches) may have shorter chassis numbers
          // Accept both 17-char modern VINs and shorter pre-1981 chassis numbers (6-16 chars)
          const isModernVin = /^[A-HJ-NPR-Z0-9]{17}$/.test(normalizedVin)
          const isPre1981Chassis = /^[A-HJ-NPR-Z0-9]{6,16}$/.test(normalizedVin) && 
                                   (vinTagResponse.extracted_data?.vin_format === 'pre_1981' || 
                                    vinTagResponse.extracted_data?.vin_format === 'porsche_f_number')
          const isValidVin = isModernVin || isPre1981Chassis

          vinTagData = {
            ...(vinTagResponse.extracted_data || {}),
            vin: isValidVin ? normalizedVin : null,
          }
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
                // Use the same key we used for DB writes; older deployments only set SERVICE_ROLE_KEY.
                if (serviceRoleKey) {
                  fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/decode-vin-and-update`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${serviceRoleKey}`
                  },
                  body: JSON.stringify({
                    vehicle_id: vehicle_id,
                    vin: vinTagData.vin
                  })
                })
                  .then(() => console.log('✅ VIN decode triggered'))
                  .catch(err => console.warn('VIN decode trigger failed:', err))
                } else {
                  console.warn('VIN decode trigger skipped: missing service role key env var')
                }
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
    // Try to extract a more specific angle from appraiser result or labels
    let detectedAngle = context || null
    if (appraiserResult?.angle) {
      detectedAngle = appraiserResult.angle
    } else if (context === 'interior') {
      // Try to be more specific for interior images
      const labelText = (rekognitionData.Labels || []).map((l: any) => l.Name.toLowerCase()).join(' ')
      if (labelText.includes('door') && (labelText.includes('panel') || labelText.includes('interior'))) {
        // Try to determine which door
        if (labelText.includes('driver') || labelText.includes('left')) {
          detectedAngle = 'interior_door_driver'
        } else if (labelText.includes('passenger') || labelText.includes('right')) {
          detectedAngle = 'interior_door_passenger'
        } else {
          detectedAngle = 'interior_door'
        }
      } else if (labelText.includes('dashboard') || labelText.includes('dash')) {
        detectedAngle = 'interior_dash_full'
      } else if (labelText.includes('seat')) {
        if (labelText.includes('driver') || labelText.includes('left')) {
          detectedAngle = 'interior_driver_seat'
        } else if (labelText.includes('passenger') || labelText.includes('right')) {
          detectedAngle = 'interior_passenger_seat'
        } else {
          detectedAngle = 'interior_seats'
        }
      }
    }
    
    // Extract subject from labels or appraiser result
    let detectedSubject = null
    if (appraiserResult?.subject) {
      detectedSubject = appraiserResult.subject
    } else {
      const labelText = (rekognitionData.Labels || []).map((l: any) => l.Name.toLowerCase()).join(' ')
      if (labelText.includes('door') && labelText.includes('panel')) {
        detectedSubject = 'door_panel'
      } else if (labelText.includes('dashboard') || labelText.includes('dash')) {
        detectedSubject = 'dashboard'
      } else if (labelText.includes('engine')) {
        detectedSubject = 'engine'
      } else if (labelText.includes('seat')) {
        detectedSubject = 'seat'
      } else if (labelText.includes('frame') || labelText.includes('chassis')) {
        detectedSubject = 'frame'
      }
    }
    
    const tier1Compat = {
      category: context || 'general',
      angle: detectedAngle,
      subject: detectedSubject,
      is_full_vehicle: false, // Will be determined by angle classification
      is_interior: context === 'interior',
      is_exterior: context === 'exterior',
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

    // === NEW: Insert camera position based on detected angle ===
    let cameraPosition = null
    if (imageRecord?.id && detectedAngle) {
      try {
        cameraPosition = await insertCameraPosition(
          supabase,
          imageRecord.id,
          vehicle_id,
          detectedAngle,
          appraiserResult
        )
      } catch (camErr) {
        console.warn('Failed to insert camera position (non-blocking):', camErr)
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        tags: automatedTags,
        appraisal: appraiserResult,
        camera_position: cameraPosition,
        _debug: Object.keys(appraiserDebug).length > 0 ? appraiserDebug : undefined
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
  const labelText = labels.join(' ')
  
  // Check for engine bay first
  if (labels.includes('engine') || labels.includes('engine control unit') || 
      labelText.includes('engine bay') || labelText.includes('motor')) return 'engine'
  
  // Check for interior - be more comprehensive
  // Door interiors: door panel, door handle, window controls, armrest, interior door
  // Also check for upholstery, fabric, leather, vinyl which are interior materials
  if (labels.includes('interior') || labels.includes('seat') || labels.includes('dashboard') ||
      labels.includes('door panel') || labels.includes('door handle') || 
      labels.includes('armrest') || labels.includes('upholstery') ||
      labels.includes('fabric') || labels.includes('leather') || labels.includes('vinyl') ||
      labelText.includes('interior door') || labelText.includes('door interior') ||
      labelText.includes('window control') || labelText.includes('door card')) return 'interior'
  
  // Check for undercarriage
  if (labels.includes('undercarriage') || labels.includes('suspension') || 
      labels.includes('chassis') || labels.includes('frame') || labels.includes('axle')) return 'undercarriage'
  
  // Only classify as exterior if we see full vehicle context
  // Don't default to exterior for close-ups or partial views
  if ((labels.includes('vehicle') || labels.includes('car') || labels.includes('truck')) &&
      (labels.includes('exterior') || labelText.includes('full vehicle') || 
       labelText.includes('side view') || labelText.includes('front view') || 
       labelText.includes('rear view'))) return 'exterior'
  
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

SPECIAL NOTES FOR PORSCHE VEHICLES:
- Porsche VIN tags from 1965-1981 (like early 911s) may have a different format or be stamped/etched rather than on a plate
- Look for "Fahrgestellnummer" (German for chassis number) labels or stamps
- Early Porsche VINs may appear as "F" followed by numbers (e.g., F300001 format)
- VINs on door jamb plates may be preceded by text like "Fahrgestell-Nr" or "Chassis No"
- Check engine bay firewall plates, door jamb stickers, and under-hood labels
- Some early Porsches have the VIN stamped directly into metal surfaces

A VIN is EXACTLY 17 characters (for post-1981 vehicles) OR may be shorter for pre-1981 vehicles. Modern VINs are alphanumeric (no I, O, or Q), and follow ISO 3779 format. For pre-1981 vehicles, extract whatever chassis/identification number is visible.

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
    "vin": string | null (VIN/chassis number if found - may be 17 characters for modern vehicles or shorter for pre-1981 vehicles),
    "vin_location": string | null ("dashboard", "door_jamb", "firewall", "frame", "engine_bay", "unknown"),
    "condition": string | null ("excellent", "good", "fair", "poor", "illegible"),
    "authenticity_concerns": string[] (empty if none, e.g. ["replacement_rivets", "paint_over", "tampering"]),
    "readability": string | null ("clear", "partial", "difficult", "illegible"),
    "vin_format": string | null ("modern_17_char", "pre_1981", "porsche_f_number", "unknown")
  },
  "raw_text": string (any visible text in the image, including German labels like "Fahrgestellnummer")
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
  console.log('[runAppraiserBrain] === STARTING - v115 ===')
  
  // Build debug info throughout the function
  const debugInfo: any = {
    version: 'v115',
    started_at: new Date().toISOString(),
    steps: []
  };
  
  // Try MULTIPLE approaches to get the OpenAI key
  // Approach 1: Standard Deno.env.get
  let openAiKey: string | undefined;
  try {
    openAiKey = Deno.env.get('OPENAI_API_KEY');
    debugInfo.steps.push({ approach: 1, name: 'OPENAI_API_KEY', found: !!openAiKey });
    console.log('[runAppraiserBrain] Approach 1 (OPENAI_API_KEY):', openAiKey ? 'FOUND' : 'NOT FOUND');
  } catch (e) {
    debugInfo.steps.push({ approach: 1, name: 'OPENAI_API_KEY', error: String(e) });
  }
  
  // Approach 2: Alternative name
  if (!openAiKey) {
    try {
      openAiKey = Deno.env.get('OPEN_AI_API_KEY');
      debugInfo.steps.push({ approach: 2, name: 'OPEN_AI_API_KEY', found: !!openAiKey });
      console.log('[runAppraiserBrain] Approach 2 (OPEN_AI_API_KEY):', openAiKey ? 'FOUND' : 'NOT FOUND');
    } catch (e) {
      debugInfo.steps.push({ approach: 2, name: 'OPEN_AI_API_KEY', error: String(e) });
    }
  }
  
  // Approach 3: Try toObject() method
  if (!openAiKey) {
    try {
      const envObj = Deno.env.toObject();
      openAiKey = envObj['OPENAI_API_KEY'] || envObj['OPEN_AI_API_KEY'];
      debugInfo.steps.push({ approach: 3, name: 'toObject', found: !!openAiKey, total_keys: Object.keys(envObj).length });
      console.log('[runAppraiserBrain] Approach 3 (toObject):', openAiKey ? 'FOUND' : 'NOT FOUND');
    } catch (e) {
      debugInfo.steps.push({ approach: 3, name: 'toObject', error: String(e) });
    }
  }
  
  // Debug: list all env vars that might be relevant
  try {
    const allEnvKeys = Object.keys(Deno.env.toObject());
    debugInfo.total_env_vars = allEnvKeys.length;
    const relevantKeys = allEnvKeys.filter(k => 
      k.includes('API') || k.includes('KEY') || k.includes('OPENAI') || k.includes('SUPABASE')
    );
    debugInfo.relevant_keys = relevantKeys;
    console.log('[runAppraiserBrain] Total env vars:', allEnvKeys.length);
    console.log('[runAppraiserBrain] Relevant vars:', relevantKeys.join(', '));
  } catch (e) {
    debugInfo.env_list_error = String(e);
    console.log('[runAppraiserBrain] Could not list env vars:', e);
  }
  
  if (!openAiKey) {
    console.error('[runAppraiserBrain] CRITICAL: No OPENAI_API_KEY found after all approaches!');
    debugInfo.final_status = 'no_api_key';
    // Return debug info instead of null - with a category so it has some truthy structure
    return {
      category: 'error',
      subject: 'api_key_missing',
      description: 'No OpenAI API key available',
      _debug: debugInfo
    };
  }
  
  // Validate key format (should start with sk-)
  const keyPrefix = openAiKey.substring(0, 10);
  const keyLength = openAiKey.length;
  debugInfo.key_prefix = keyPrefix;
  debugInfo.key_length = keyLength;
  debugInfo.key_valid_format = openAiKey.startsWith('sk-');
  console.log('[runAppraiserBrain] Key found! prefix:', keyPrefix, 'length:', keyLength);
  
  if (!openAiKey.startsWith('sk-')) {
    console.error('[runAppraiserBrain] WARNING: Key does not start with sk-! Prefix:', keyPrefix);
  }

  // UNIFIED PROMPT - asks for BOTH content analysis AND 3D camera position
  const unifiedPrompt = `You are analyzing a vehicle photograph for a professional appraisal system.

COORDINATE SYSTEM:
The vehicle's center (0,0,0) is at the geometric center of the vehicle based on its length, width, and height.
- X-axis: Positive = passenger side, Negative = driver side
- Y-axis: Positive = front of vehicle, Negative = rear of vehicle  
- Z-axis: Positive = up, Negative = down (0 = ground level, vehicle center ~700mm)

CAMERA POSITION:
Estimate the camera's position relative to the vehicle's center (0,0,0).
Use spherical coordinates:
- azimuth_deg: 0° = directly in front, 90° = driver side, 180° = directly behind, 270° = passenger side
- elevation_deg: 0° = level with vehicle center, positive = camera above, negative = camera below
- distance_mm: distance from vehicle center to camera in millimeters
If discernible from perspective, also estimate:
- lens_angle_of_view_deg: horizontal FOV in degrees (e.g. wide ~70–90, normal ~50, telephoto ~20–35), or null
- focal_length_mm: equivalent 35mm focal length in mm (e.g. 24, 50, 85), or null

SUBJECT IDENTIFICATION:
Identify the PRIMARY subject/focus of this photograph using the taxonomy:
- vehicle (full exterior shot)
- exterior.panel.fender.front.driver / .passenger
- exterior.panel.fender.rear.driver / .passenger
- exterior.panel.door.front.driver / .passenger
- exterior.panel.door.rear.driver / .passenger
- exterior.panel.quarter.driver / .passenger
- exterior.panel.hood
- exterior.panel.trunk / .tailgate
- exterior.panel.roof
- exterior.panel.rocker.driver / .passenger
- exterior.bumper.front / .rear
- exterior.wheel.front.driver / .passenger / .rear.driver / .rear.passenger
- exterior.light.headlight.driver / .passenger
- exterior.light.taillight.driver / .passenger
- exterior.glass.windshield / .rear / .side.driver / .side.passenger
- exterior.mirror.driver / .passenger
- exterior.trim.grille / .molding / .chrome
- exterior.badge / .emblem
- interior.dashboard
- interior.dashboard.gauges / .center_stack / .glove_box
- interior.seat.front.driver / .front.passenger / .rear
- interior.door.panel.front.driver / .front.passenger / .rear.driver / .rear.passenger
- interior.console.center / .shifter
- interior.steering.wheel / .column
- interior.headliner
- interior.carpet.front / .rear
- interior.trunk
- engine.bay
- engine.block / .intake / .exhaust / .alternator / .etc
- undercarriage.frame.front / .center / .rear
- undercarriage.suspension.front / .rear
- undercarriage.exhaust
- undercarriage.floor.front / .rear
- damage.dent / .scratch / .rust / .crack / .etc
- document.vin_tag / .spid_sheet / .title / .etc

IMPORTANT: For close-up detail shots (measuring tape, specific damage, small areas), the subject should be the specific part being photographed, NOT "vehicle".

Return a JSON object:
{
  "category": "exterior|interior|engine|undercarriage|document|damage",
  "subject": "the.primary.subject.key",
  "secondary_subjects": ["other.visible.subjects"],
  "description": "One detailed sentence describing what's shown",
  "camera_position": {
    "azimuth_deg": number (0-360),
    "elevation_deg": number (-90 to 90),
    "distance_mm": number (how far camera is from vehicle center),
    "confidence": number (0.0-1.0, how certain you are about position),
    "lens_angle_of_view_deg": number or null,
    "focal_length_mm": number or null
  },
  "subject_position": {
    "x_mm": number (subject center X relative to vehicle center),
    "y_mm": number (subject center Y relative to vehicle center),
    "z_mm": number (subject center Z relative to vehicle center)
  },
  "is_close_up": boolean (is this a detail/close-up shot vs full vehicle),
  "visible_damage": boolean,
  "condition_notes": "any condition observations",
  "visible_components": ["component1", "component2"]
}`;

  debugInfo.calling_openai = true;
  console.log('[runAppraiserBrain] Calling OpenAI...');
  
  let res: any;
  try {
    res = await callOpenAiChatCompletions({
      apiKey: openAiKey,
      body: {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: unifiedPrompt },
              { type: "image_url", image_url: { url: imageUrl } }
            ]
          }
        ],
        max_tokens: 800,
        response_format: { type: "json_object" }
      },
      timeoutMs: 25000,
    });
    debugInfo.openai_status = res?.status;
    debugInfo.openai_ok = res?.ok;
    console.log('[runAppraiserBrain] OpenAI call completed, status:', res?.status, 'ok:', res?.ok);
  } catch (fetchError) {
    const errorMsg = fetchError instanceof Error ? fetchError.message : String(fetchError);
    console.error('[runAppraiserBrain] EXCEPTION calling OpenAI:', fetchError);
    console.error('[runAppraiserBrain] Error message:', errorMsg);
    debugInfo.final_status = 'openai_exception';
    debugInfo.exception = errorMsg;
    return {
      category: 'error',
      subject: 'openai_exception',
      description: `OpenAI call threw exception: ${errorMsg}`,
      _debug: debugInfo
    };
  }

  if (!res || !res.ok) {
    console.error('[runAppraiserBrain] OpenAI call failed:', {
      status: res?.status,
      ok: res?.ok,
      raw: JSON.stringify(res?.raw || {}).substring(0, 500)
    });
    debugInfo.final_status = 'openai_failed';
    debugInfo.openai_raw = JSON.stringify(res?.raw || {}).substring(0, 300);
    return {
      category: 'error',
      subject: 'openai_failed',
      description: `OpenAI returned status ${res?.status}`,
      _debug: debugInfo
    };
  }

  console.log('[runAppraiserBrain] OpenAI SUCCESS:', {
    status: res.status,
    tokens: res.usage?.total_tokens,
    cost: res.cost_usd
  });
  debugInfo.final_status = 'success';

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
      _debug: debugInfo,
    }
  } catch {
    return {
      raw_analysis: content,
      _usage: res.usage || null,
      _cost_usd: res.cost_usd ?? null,
      _model: res.model || 'gpt-4o-mini',
      _debug: debugInfo,
    }
  }
}


// ============================================================================
// GEMINI FLASH - 40x cheaper than GPT-4o-mini ($0.0001 vs $0.004 per image)
// ============================================================================
async function runAppraiserBrainGemini(imageUrl: string, context: string): Promise<any> {
  console.log('[runAppraiserBrainGemini] === STARTING ===');
  
  // Check both possible key names
  const freeApiKey = Deno.env.get('free_api_key');
  const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
  console.log('[runAppraiserBrainGemini] Key check:', {
    free_api_key_exists: !!freeApiKey,
    free_api_key_length: freeApiKey?.length || 0,
    GEMINI_API_KEY_exists: !!geminiApiKey,
    GEMINI_API_KEY_length: geminiApiKey?.length || 0
  });
  
  const geminiKey = freeApiKey || geminiApiKey;
  if (!geminiKey) {
    console.error('[runAppraiserBrainGemini] No Gemini API key found (tried: free_api_key, GEMINI_API_KEY)');
    return { _gemini_error: 'no_api_key' };
  }
  
  console.log('[runAppraiserBrainGemini] Using key length:', geminiKey.length, 'prefix:', geminiKey.substring(0, 10));

  const prompt = `You are analyzing a vehicle photograph for a professional appraisal system.

COORDINATE SYSTEM:
The vehicle's center (0,0,0) is at the geometric center of the vehicle.
- X-axis: Positive = passenger side, Negative = driver side
- Y-axis: Positive = front of vehicle, Negative = rear
- Z-axis: Positive = up, Negative = down

CAMERA POSITION (estimate in spherical coordinates):
- azimuth_deg: 0° = directly in front, 90° = driver side, 180° = rear, 270° = passenger side
- elevation_deg: 0° = level with vehicle center, positive = above, negative = below
- distance_mm: distance from vehicle center to camera in millimeters

LENS / FOV (estimate if discernible from perspective; null if unknown):
- lens_angle_of_view_deg: horizontal field of view in degrees (e.g. wide ~70–90, normal ~50, telephoto ~20–35)
- focal_length_mm: equivalent 35mm focal length in mm if inferrable from perspective (e.g. 24, 50, 85), else null

SUBJECT TAXONOMY (use these exact keys):
- vehicle (full exterior shot)
- exterior.panel.fender.front.driver / .front.passenger / .rear.driver / .rear.passenger
- exterior.panel.door.front.driver / .front.passenger / .rear.driver / .rear.passenger
- exterior.panel.quarter.driver / .passenger
- exterior.panel.hood / .trunk / .tailgate / .roof
- exterior.panel.rocker.driver / .passenger
- exterior.bumper.front / .rear
- exterior.wheel.front.driver / .front.passenger / .rear.driver / .rear.passenger
- exterior.trim.grille / .molding / .chrome
- exterior.light.headlight.driver / .headlight.passenger / .taillight.driver / .taillight.passenger
- exterior.glass.windshield / .rear / .side.driver / .side.passenger
- exterior.mirror.driver / .passenger
- exterior.badge / .emblem
- interior.dashboard / .dashboard.gauges / .dashboard.center_stack / .dashboard.glove_box
- interior.seat.front.driver / .front.passenger / .rear
- interior.door.panel.front.driver / .front.passenger / .rear.driver / .rear.passenger
- interior.console.center / .shifter
- interior.steering.wheel / .column
- interior.headliner / .carpet.front / .carpet.rear / .trunk
- engine.bay / .block / .intake / .exhaust / .alternator / .carburetor / .air_cleaner
- undercarriage.frame.front / .frame.center / .frame.rear
- undercarriage.suspension.front / .suspension.rear
- undercarriage.exhaust / .exhaust.muffler
- undercarriage.floor.front / .floor.rear / .fuel_tank / .driveshaft / .differential
- damage.dent / .scratch / .rust / .crack / .tear / .stain / .fade
- document.vin_tag / .spid_sheet / .title / .window_sticker

Context: ${context}

Return ONLY valid JSON with this exact structure:
{
  "category": "exterior|interior|engine|undercarriage|document|damage",
  "subject": "the.primary.subject.key.from.taxonomy",
  "secondary_subjects": ["other", "visible", "subjects"],
  "description": "One detailed sentence describing what is shown in the photograph",
  "camera_position": {
    "azimuth_deg": number,
    "elevation_deg": number,
    "distance_mm": number,
    "confidence": number,
    "lens_angle_of_view_deg": number|null,
    "focal_length_mm": number|null
  },
  "subject_position": {
    "x_mm": number,
    "y_mm": number,
    "z_mm": number
  },
  "is_close_up": boolean,
  "visible_damage": boolean,
  "condition_notes": "any observations about condition"
}`;

  try {
    // Download image and convert to base64
    console.log('[runAppraiserBrainGemini] Downloading image...');
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      console.error('[runAppraiserBrainGemini] Failed to download image:', imageResponse.status);
      return { _gemini_error: 'image_download_failed', _error_message: `Status ${imageResponse.status}` };
    }
    
    const imageBuffer = await imageResponse.arrayBuffer();
    const uint8Array = new Uint8Array(imageBuffer);
    
    // Convert to base64
    let binary = '';
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    const base64Image = btoa(binary);
    
    const mimeType = imageResponse.headers.get('content-type') || 'image/jpeg';
    console.log('[runAppraiserBrainGemini] Image downloaded, size:', uint8Array.length, 'type:', mimeType);

    console.log('[runAppraiserBrainGemini] Calling Gemini API...');
    const startTime = Date.now();
    
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-002:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64Image
                }
              }
            ]
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 600,
          }
        })
      }
    );

    const duration = Date.now() - startTime;
    console.log('[runAppraiserBrainGemini] API response received in', duration, 'ms, status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[runAppraiserBrainGemini] API error:', response.status, errorText.substring(0, 500));
      return { _gemini_error: 'api_error', _error_message: `Status ${response.status}: ${errorText.substring(0, 200)}` };
    }

    const result = await response.json();
    
    const content = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) {
      console.error('[runAppraiserBrainGemini] No content in response:', JSON.stringify(result).substring(0, 500));
      return { _gemini_error: 'no_content', _error_message: JSON.stringify(result).substring(0, 200) };
    }

    console.log('[runAppraiserBrainGemini] Got response content, length:', content.length);

    // Parse JSON from response (may be wrapped in markdown code block)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[runAppraiserBrainGemini] Could not extract JSON from response:', content.substring(0, 300));
      return { _gemini_error: 'no_json_in_response', _error_message: content.substring(0, 200) };
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error('[runAppraiserBrainGemini] JSON parse failed:', parseError);
      return { _gemini_error: 'json_parse_failed', _error_message: String(parseError) };
    }
    
    // Estimate token usage (Gemini doesn't always return this)
    const inputTokens = Math.ceil((prompt.length + base64Image.length * 0.75) / 4);
    const outputTokens = Math.ceil(content.length / 4);
    
    console.log('[runAppraiserBrainGemini] SUCCESS:', {
      category: parsed.category,
      subject: parsed.subject,
      duration_ms: duration
    });

    return {
      ...parsed,
      _usage: {
        prompt_tokens: inputTokens,
        completion_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens
      },
      _cost_usd: 0.0001,  // Approximate cost for Gemini Flash
      _model: 'gemini-1.5-flash',
    };
  } catch (error) {
    console.error('[runAppraiserBrainGemini] Exception:', error);
    return { _gemini_error: 'exception', _error_message: String(error) };
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

/**
 * Insert camera position based on AI analysis.
 * Uses proper 3D coordinate system with spherical and Cartesian coordinates.
 */
async function insertCameraPosition(
  supabase: any,
  imageId: string,
  vehicleId: string | undefined,
  detectedAngle: string,
  appraiserResult: any
): Promise<any> {
  // Extract camera position from AI result if available
  const aiCameraPos = appraiserResult?.camera_position
  const aiSubjectPos = appraiserResult?.subject_position
  const aiSubject = appraiserResult?.subject || 'vehicle'
  
  let azimuth_deg: number
  let elevation_deg: number
  let distance_mm: number
  let confidence: number
  let subject_key: string = aiSubject
  let subject_x_mm: number | null = null
  let subject_y_mm: number | null = null
  let subject_z_mm: number | null = null
  
  if (aiCameraPos && typeof aiCameraPos.azimuth_deg === 'number') {
    // Use AI-derived coordinates (much more accurate)
    azimuth_deg = aiCameraPos.azimuth_deg
    elevation_deg = aiCameraPos.elevation_deg ?? 0
    distance_mm = aiCameraPos.distance_mm ?? 5000
    confidence = aiCameraPos.confidence ?? 0.7
    
    // Subject position if available
    if (aiSubjectPos) {
      subject_x_mm = aiSubjectPos.x_mm ?? null
      subject_y_mm = aiSubjectPos.y_mm ?? null
      subject_z_mm = aiSubjectPos.z_mm ?? null
    }
  } else {
    // Fallback to label-based estimation (lower confidence)
    const fallback = angleToCameraPosition(detectedAngle, appraiserResult)
    azimuth_deg = fallback.azimuth_deg
    elevation_deg = fallback.elevation_deg
    distance_mm = fallback.distance_mm
    confidence = fallback.confidence * 0.5  // Halve confidence for fallback
    subject_key = fallback.subject_key
  }
  
  // Convert spherical to Cartesian
  const az_rad = azimuth_deg * Math.PI / 180
  const el_rad = elevation_deg * Math.PI / 180
  const horiz_dist = distance_mm * Math.cos(el_rad)
  
  const camera_x_mm = Math.round(-horiz_dist * Math.sin(az_rad))
  const camera_y_mm = Math.round(-horiz_dist * Math.cos(az_rad))
  const camera_z_mm = Math.round(distance_mm * Math.sin(el_rad))
  
  // Insert into image_camera_position
  const { data, error } = await supabase
    .from('image_camera_position')
    .upsert({
      image_id: imageId,
      vehicle_id: vehicleId || null,
      subject_key: subject_key,
      azimuth_deg: azimuth_deg,
      elevation_deg: elevation_deg,
      distance_mm: distance_mm,
      camera_x_mm: camera_x_mm,
      camera_y_mm: camera_y_mm,
      camera_z_mm: camera_z_mm,
      subject_x_mm: subject_x_mm,
      subject_y_mm: subject_y_mm,
      subject_z_mm: subject_z_mm,
      confidence: confidence,
      source: 'analyze-image',
      source_version: 'v3',  // New version with AI coordinates
      evidence: {
        detected_angle: detectedAngle,
        ai_camera_position: aiCameraPos || null,
        ai_subject_position: aiSubjectPos || null,
        ai_subject: aiSubject,
        category: appraiserResult?.category || null,
        description: appraiserResult?.description || null,
        is_close_up: appraiserResult?.is_close_up || false,
        lens_angle_of_view_deg: aiCameraPos?.lens_angle_of_view_deg ?? null,
        focal_length_mm: aiCameraPos?.focal_length_mm ?? null,
      }
    }, {
      onConflict: 'image_id,subject_key,source,source_version',
      ignoreDuplicates: false
    })
    .select()
    .single()
  
  if (error) {
    console.warn('Failed to insert camera position:', error)
    return null
  }
  
  return {
    subject_key,
    azimuth_deg,
    elevation_deg,
    distance_mm,
    camera_x_mm,
    camera_y_mm,
    camera_z_mm,
    confidence,
    subject_position: aiSubjectPos || null,
  }
}

/**
 * Convert detected angle label to camera position.
 * Returns proper 3D coordinates based on angle semantics.
 */
function angleToCameraPosition(
  angleLabel: string,
  appraiserResult?: any
): {
  subject_key: string
  azimuth_deg: number
  elevation_deg: number
  distance_mm: number
  camera_x_mm: number
  camera_y_mm: number
  camera_z_mm: number
  confidence: number
  needs_reanalysis: boolean
} {
  const label = (angleLabel || '').toLowerCase().replace(/[_\s]+/g, '_')
  const appraiserAngle = appraiserResult?.angle?.toLowerCase()?.replace(/[_\s]+/g, '_') || ''
  const appraiserCategory = appraiserResult?.category?.toLowerCase() || ''
  
  // Use appraiser result if more specific
  const effectiveLabel = appraiserAngle || label
  
  // Default values
  let azimuth = 45
  let elevation = 15
  let distance = 8000
  let subject = 'vehicle'
  let confidence = 0.5
  let needs_reanalysis = true
  
  // === EXTERIOR FULL VEHICLE ===
  if (effectiveLabel.includes('front') && !effectiveLabel.includes('interior') && !effectiveLabel.includes('suspension')) {
    distance = 8000
    elevation = 15
    subject = 'vehicle'
    
    if (effectiveLabel.includes('straight') || effectiveLabel === 'front' || effectiveLabel === 'exterior_front') {
      azimuth = 0
      confidence = 0.8
      needs_reanalysis = false
    } else if (effectiveLabel.includes('driver')) {
      azimuth = 45
      confidence = 0.85
      needs_reanalysis = false
    } else if (effectiveLabel.includes('passenger')) {
      azimuth = 315
      confidence = 0.85
      needs_reanalysis = false
    } else if (effectiveLabel.includes('quarter') || effectiveLabel.includes('three_quarter')) {
      azimuth = 45  // Assume driver side
      confidence = 0.3  // Low - ambiguous
      needs_reanalysis = true
    }
  }
  // === REAR ===
  else if (effectiveLabel.includes('rear') && !effectiveLabel.includes('interior') && !effectiveLabel.includes('suspension') && !effectiveLabel.includes('seat')) {
    distance = 8000
    elevation = 15
    subject = 'vehicle'
    
    if (effectiveLabel.includes('straight') || effectiveLabel === 'rear' || effectiveLabel === 'exterior_rear') {
      azimuth = 180
      confidence = 0.8
      needs_reanalysis = false
    } else if (effectiveLabel.includes('driver')) {
      azimuth = 135
      confidence = 0.85
      needs_reanalysis = false
    } else if (effectiveLabel.includes('passenger')) {
      azimuth = 225
      confidence = 0.85
      needs_reanalysis = false
    } else {
      azimuth = 135
      confidence = 0.3
      needs_reanalysis = true
    }
  }
  // === SIDE/PROFILE ===
  else if (effectiveLabel.includes('profile') || effectiveLabel.includes('side')) {
    distance = 8000
    elevation = 8
    subject = 'vehicle'
    
    if (effectiveLabel.includes('driver')) {
      azimuth = 90
      confidence = 0.85
      needs_reanalysis = false
    } else if (effectiveLabel.includes('passenger')) {
      azimuth = 270
      confidence = 0.85
      needs_reanalysis = false
    } else {
      azimuth = 90  // Assume driver
      confidence = 0.3
      needs_reanalysis = true
    }
  }
  // === ENGINE BAY ===
  else if (effectiveLabel.includes('engine') || appraiserCategory === 'engine') {
    subject = 'engine.bay'
    distance = 1500
    elevation = 60
    azimuth = 0
    
    if (effectiveLabel.includes('full') || effectiveLabel === 'engine_bay') {
      confidence = 0.8
      needs_reanalysis = false
    } else if (effectiveLabel.includes('driver')) {
      azimuth = 70
      elevation = 45
      confidence = 0.7
      needs_reanalysis = false
    } else if (effectiveLabel.includes('passenger')) {
      azimuth = 290
      elevation = 45
      confidence = 0.7
      needs_reanalysis = false
    } else {
      confidence = 0.6
      needs_reanalysis = false
    }
  }
  // === INTERIOR ===
  else if (effectiveLabel.includes('interior') || effectiveLabel.includes('dash') || effectiveLabel.includes('seat') || appraiserCategory === 'interior') {
    distance = 800
    
    if (effectiveLabel.includes('dashboard') || effectiveLabel.includes('dash')) {
      subject = 'interior.dashboard'
      azimuth = 0
      elevation = -30
      confidence = 0.8
      needs_reanalysis = false
    } else if (effectiveLabel.includes('driver') && effectiveLabel.includes('seat')) {
      subject = 'interior.seat.front.driver'
      azimuth = 90
      elevation = 0
      confidence = 0.7
      needs_reanalysis = false
    } else if (effectiveLabel.includes('door')) {
      subject = 'interior.door.panel.front.driver'
      azimuth = 90
      elevation = 0
      distance = 500
      confidence = 0.6
      needs_reanalysis = true  // Which door?
    } else {
      subject = 'interior.cabin'
      azimuth = 0
      elevation = -15
      distance = 1000
      confidence = 0.4
      needs_reanalysis = true
    }
  }
  // === UNDERCARRIAGE ===
  else if (effectiveLabel.includes('undercarriage') || effectiveLabel.includes('frame') || effectiveLabel.includes('suspension')) {
    subject = 'undercarriage'
    distance = 1500
    elevation = -45
    azimuth = 0
    confidence = 0.5
    needs_reanalysis = true
    
    if (effectiveLabel.includes('front')) {
      azimuth = 0
      elevation = -30
      confidence = 0.6
    } else if (effectiveLabel.includes('rear')) {
      azimuth = 180
      elevation = -30
      confidence = 0.6
    }
  }
  // === DETAIL (USELESS) ===
  else if (effectiveLabel.includes('detail')) {
    subject = 'vehicle'
    azimuth = 45
    elevation = 15
    distance = 600
    confidence = 0.1  // Very low - needs reanalysis
    needs_reanalysis = true
  }
  // === VAGUE EXTERIOR ===
  else if (effectiveLabel === 'exterior' || effectiveLabel === 'exterior_three_quarter') {
    subject = 'vehicle'
    azimuth = 45
    elevation = 15
    distance = 8000
    confidence = 0.15
    needs_reanalysis = true
  }
  
  // Convert spherical to Cartesian
  const az_rad = azimuth * Math.PI / 180
  const el_rad = elevation * Math.PI / 180
  const horiz_dist = distance * Math.cos(el_rad)
  
  return {
    subject_key: subject,
    azimuth_deg: azimuth,
    elevation_deg: elevation,
    distance_mm: distance,
    camera_x_mm: Math.round(-horiz_dist * Math.sin(az_rad)),
    camera_y_mm: Math.round(-horiz_dist * Math.cos(az_rad)),
    camera_z_mm: Math.round(distance * Math.sin(el_rad)),
    confidence: confidence,
    needs_reanalysis: needs_reanalysis,
  }
}