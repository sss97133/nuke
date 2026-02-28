// DEPRECATED: This function writes legacy angle strings (exterior_three_quarter,
// exterior_front, etc.) to vehicle_images.angle. The platform has migrated to
// the 41-zone vehicle_zone system. New image analysis should use the YONO pipeline
// (yono-vision-worker) which writes vehicle_zone + zone_confidence.
// See: nuke_frontend/src/constants/vehicleZones.ts for the canonical zone taxonomy.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

serve(async (req) => {
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

  // Daily budget cap — checked before any processing or status changes
  {
    const DAILY_BUDGET_CAP = Number(Deno.env.get('ANALYZE_IMAGE_DAILY_CAP') || '50')
    try {
      const budgetClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SERVICE_ROLE_KEY') ?? '',
        { auth: { persistSession: false, detectSessionInUrl: false } }
      )
      const { data: spendRows } = await budgetClient
        .from('ai_scan_sessions')
        .select('ai_model_cost')
        .gte('created_at', new Date(new Date().toDateString()).toISOString())
      const today_spend = (spendRows || []).reduce(
        (sum: number, row: any) => sum + (Number(row.ai_model_cost) || 0),
        0
      )
      if (today_spend >= DAILY_BUDGET_CAP) {
        console.warn(`[analyze-image] Daily budget cap reached: $${today_spend.toFixed(4)} >= $${DAILY_BUDGET_CAP}`)
        return new Response(
          JSON.stringify({ paused: true, reason: 'daily_budget_cap_reached', today_spend, cap: DAILY_BUDGET_CAP }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 429 }
        )
      }
    } catch (budgetErr) {
      // Non-blocking: if budget check fails, allow processing to continue
      console.warn('[analyze-image] Budget cap check failed (non-blocking):', budgetErr)
    }
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

    const serviceRoleKey =
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
      Deno.env.get('SERVICE_ROLE_KEY') ||
      Deno.env.get('SUPABASE_SERVICE_KEY') ||
      Deno.env.get('SUPABASE_KEY') ||
      ''

    // ========================================================================
    // 1. Idempotency check
    // ========================================================================
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

    // ========================================================================
    // 2. Mark as processing
    // ========================================================================
    try {
      const updateQ = image_id
        ? supabase.from('vehicle_images').update({ ai_processing_status: 'processing', ai_processing_started_at: new Date().toISOString() }).eq('id', image_id)
        : supabase.from('vehicle_images').update({ ai_processing_status: 'processing', ai_processing_started_at: new Date().toISOString() }).eq('image_url', image_url)
      await updateQ
    } catch (err) {
      console.warn('Failed to mark image as processing (non-blocking):', err)
    }

    // ========================================================================
    // 3. Fetch vehicle context (year/make/model/description/color/vin)
    //    Used to ground both YONO and vision-analyze-image so they analyze
    //    a KNOWN vehicle, not a mystery car.
    // ========================================================================
    let vehicleContext: string = 'general'
    if (vehicle_id) {
      try {
        // Fetch vehicle identity
        const { data: vehicleRow } = await supabase
          .from('vehicles')
          .select('year, make, model, description, interior_color, vin, transmission')
          .eq('id', vehicle_id)
          .maybeSingle()

        if (vehicleRow) {
          const parts: string[] = [
            vehicleRow.year && vehicleRow.make && vehicleRow.model
              ? `${vehicleRow.year} ${vehicleRow.make} ${vehicleRow.model}`
              : null,
            vehicleRow.vin ? `VIN: ${vehicleRow.vin}` : null,
            vehicleRow.transmission ? `Transmission: ${vehicleRow.transmission}` : null,
            vehicleRow.interior_color ? `Interior: ${vehicleRow.interior_color}` : null,
            vehicleRow.description ? vehicleRow.description.substring(0, 400) : null,
          ].filter(Boolean) as string[]

          // Pull findings from already-analyzed images of this vehicle
          // This lets each image benefit from what previous images revealed
          const { data: priorImages } = await supabase
            .from('vehicle_images')
            .select('ai_scan_metadata')
            .eq('vehicle_id', vehicle_id)
            .eq('ai_processing_status', 'completed')
            .not('ai_scan_metadata', 'is', null)
            .limit(8)

          if (priorImages && priorImages.length > 0) {
            const priorFindings: string[] = []
            for (const img of priorImages) {
              const meta = img.ai_scan_metadata as any
              const desc = meta?.appraiser?.description || meta?.tier_1_analysis?.condition_glance
              const zone = meta?.appraiser?.subject
              const damage = meta?.appraiser?.visible_damage
              const notes = meta?.appraiser?.condition_notes
              if (desc) priorFindings.push(desc.substring(0, 120))
              else if (zone && notes) priorFindings.push(`${zone}: ${notes.substring(0, 80)}`)
            }
            if (priorFindings.length > 0) {
              parts.push(`Previously observed across ${priorImages.length} images: ${priorFindings.slice(0, 4).join(' / ')}`)
            }
          }

          vehicleContext = parts.join(' | ')
          console.log('[analyze-image] Vehicle context built:', vehicleContext.substring(0, 150))
        }
      } catch (ctxErr) {
        console.warn('[analyze-image] Failed to fetch vehicle context (non-blocking):', ctxErr)
      }
    }

    // ========================================================================
    // 4. Tier 0: YONO local classifier (free, fast, ~4ms)
    //    If YONO is confident (>0.7), record result and skip cloud call.
    //    If YONO is uncertain or sidecar is down, proceed to Gemini/GPT.
    // ========================================================================
    let yonoResult: any = null
    let yonoSkippedCloud = false
    try {
      const yonoResp = await fetch(
        `${Deno.env.get('SUPABASE_URL')}/functions/v1/yono-classify`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({ image_url }),
          signal: AbortSignal.timeout(15000),
        }
      )
      const yonoJson = await yonoResp.json()
      if (yonoJson.available && yonoJson.make) {
        yonoResult = yonoJson
        const highConfidence = (yonoJson.confidence || 0) >= 0.70
        console.log('[analyze-image] YONO result:', {
          make: yonoJson.make,
          confidence: yonoJson.confidence,
          ms: yonoJson.ms,
          skip_cloud: highConfidence,
        })
        if (highConfidence) {
          yonoSkippedCloud = true
        }
      } else {
        console.log('[analyze-image] YONO unavailable or no result:', yonoJson.reason || 'no make')
      }
    } catch (yonoErr) {
      console.warn('[analyze-image] YONO call failed (non-blocking):', yonoErr)
    }

    // ========================================================================
    // 4. Call vision-analyze-image for the AI analysis (skipped if YONO confident)
    // ========================================================================
    let appraiserResult: any = null
    let visionModel: string | null = null
    let visionCost: number = 0
    let visionUsage: any = null

    if (yonoSkippedCloud) {
      console.log('[analyze-image] Skipping cloud vision — YONO confident:', yonoResult.make, yonoResult.confidence)
    } else {
      try {
      console.log('[analyze-image] Calling vision-analyze-image...')
      const visionResp = await fetch(
        `${Deno.env.get('SUPABASE_URL')}/functions/v1/vision-analyze-image`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({ image_url, context: vehicleContext }),
          signal: AbortSignal.timeout(90000),
        }
      )
      const visionJson = await visionResp.json()

      if (visionJson.success && visionJson.analysis) {
        appraiserResult = visionJson.analysis
        visionModel = visionJson.model || null
        visionCost = visionJson.cost_usd || 0
        visionUsage = visionJson.usage || null
        console.log('[analyze-image] Vision analysis SUCCESS:', {
          category: appraiserResult.category,
          subject: appraiserResult.subject,
          model: visionModel,
        })
      } else {
        console.warn('[analyze-image] Vision analysis failed:', visionJson.error || 'unknown')
      }
    } catch (visionErr) {
      console.error('[analyze-image] Vision analysis exception:', visionErr)
    }
    } // end if (!yonoSkippedCloud)

    // ========================================================================
    // 5. Gate SPID detection on appraiser result
    // ========================================================================
    let spidData = null
    let spidResponse = null
    const hasSpidAlready = Boolean(existingMeta?.spid) || existingMeta?.scan_type === 'spid_sheet'
    const descLower = (appraiserResult?.description || '').toLowerCase()
    const subjectLower = (appraiserResult?.subject || '').toLowerCase()
    const likelySpid = appraiserResult?.category === 'document' &&
      (subjectLower.includes('spid') || descLower.includes('build sheet') || descLower.includes('rpo'))

    if (likelySpid && !hasSpidAlready) {
      try {
        spidResponse = await detectSPIDSheet(image_url, vehicle_id, supabase, user_id)
        if (spidResponse?.is_spid_sheet && spidResponse.confidence > 70) {
          spidData = spidResponse.extracted_data
          console.log('SPID sheet detected:', spidData)
        }
      } catch (err) {
        console.warn('SPID detection failed:', err)
      }
    }

    // ========================================================================
    // 5. Gate VIN detection on appraiser result
    // ========================================================================
    let vinTagData = null
    let vinTagResponse = null
    const hasVinTagAlready = Boolean(existingMeta?.vin_tag)
    const likelyVin = appraiserResult?.category === 'document' &&
      (subjectLower.includes('vin') || descLower.includes('vin'))

    if (likelyVin && !hasVinTagAlready) {
      try {
        vinTagResponse = await detectAndExtractVINTag(image_url, vehicle_id, supabase, user_id)
        if (vinTagResponse?.is_vin_tag && vinTagResponse.confidence > 70) {
          const raw = String(vinTagResponse?.extracted_data?.vin || '').toUpperCase().trim()
          const normalizedVin = raw.replace(/[^A-Z0-9]/g, '')
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
              } else if (vehicle.vin) {
                vinTagData.verification_status = 'mismatch'
                vinTagData.verification_confidence = 0.0
              } else {
                vinTagData.verification_status = 'new'
                vinTagData.verification_confidence = vinTagResponse.confidence / 100

                await supabase
                  .from('vehicles')
                  .update({ vin: vinTagData.vin, vin_source: 'Photo OCR' })
                  .eq('id', vehicle_id)

                await supabase
                  .from('vehicle_field_sources')
                  .insert({
                    vehicle_id,
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
                  .then(() => console.log('VIN field source created'))
                  .catch((err: any) => console.warn('Failed to create VIN field source:', err))

                await supabase
                  .from('timeline_events')
                  .insert({
                    vehicle_id,
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
                  .then(() => console.log('VIN timeline event created'))
                  .catch((err: any) => console.warn('Failed to create VIN timeline event:', err))

                await supabase
                  .from('vin_validations')
                  .insert({
                    vehicle_id,
                    user_id: user_id,
                    vin_photo_url: image_url,
                    extracted_vin: vinTagData.vin,
                    submitted_vin: vinTagData.vin,
                    validation_status: vinTagResponse.confidence >= 85 ? 'approved' : 'pending',
                    confidence_score: vinTagResponse.confidence / 100,
                    validation_method: 'ai_vision'
                  })
                  .then(() => console.log('VIN validation created'))
                  .catch((err: any) => console.log('VIN validation insert note:', err?.message || 'duplicate ok'))

                // Trigger NHTSA VIN decode (non-blocking)
                if (serviceRoleKey) {
                  fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/decode-vin-and-update`, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': `Bearer ${serviceRoleKey}`
                    },
                    body: JSON.stringify({ vehicle_id, vin: vinTagData.vin }),
                    signal: AbortSignal.timeout(30000),
                  })
                    .then(() => console.log('VIN decode triggered'))
                    .catch((err: any) => console.warn('VIN decode trigger failed:', err))
                }
              }
            }
          }
        }
      } catch (err) {
        console.warn('VIN tag detection failed:', err)
      }
    }

    // ========================================================================
    // 6. Generate tags from appraiser result
    // ========================================================================
    const automatedTags = generateTagsFromAppraiser(appraiserResult)

    // ========================================================================
    // 7. Save metadata, camera position, tags
    // ========================================================================
    const category = appraiserResult?.category || 'general'
    const detectedAngle = appraiserResult?.category || null
    const detectedSubject = appraiserResult?.subject || null

    const tier1Compat = {
      category,
      angle: detectedAngle,
      subject: detectedSubject,
      is_full_vehicle: !appraiserResult?.is_close_up && category === 'exterior',
      is_interior: category === 'interior',
      is_exterior: category === 'exterior',
      condition_glance: appraiserResult?.condition_notes ?? null,
      components_visible: appraiserResult?.visible_components ?? [],
    }

    const metadataUpdate: any = {
      scanned_at: new Date().toISOString(),
      processing_tier_reached: 1,
      tier_1_analysis: tier1Compat,
    }
    if (appraiserResult) {
      metadataUpdate.appraiser = appraiserResult
    }
    if (yonoResult) {
      metadataUpdate.yono = {
        make: yonoResult.make,
        confidence: yonoResult.confidence,
        top5: yonoResult.top5,
        is_vehicle: yonoResult.is_vehicle,
        ms: yonoResult.ms,
        skipped_cloud: yonoSkippedCloud,
      }
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

      // Cost + usage aggregation
      const costBreakdown: any[] = []
      const modelsUsed = new Set<string>()
      let totalTokens = 0
      let totalCostUsd = 0

      const addCost = (label: string, model: string | null, usage: any, costUsd: number) => {
        if (model) modelsUsed.add(String(model))
        if (usage?.total_tokens) totalTokens += Number(usage.total_tokens) || 0
        if (Number.isFinite(costUsd) && costUsd > 0) totalCostUsd += costUsd
        if (usage || model || (Number.isFinite(costUsd) && costUsd >= 0)) {
          costBreakdown.push({ step: label, model, usage, cost_usd: Number.isFinite(costUsd) ? costUsd : null })
        }
      }

      addCost('vision', visionModel, visionUsage, visionCost)
      if (spidResponse) {
        addCost('spid', spidResponse._model || 'gpt-4o', spidResponse._usage || null, Number(spidResponse._cost_usd ?? 0))
      }
      if (vinTagResponse) {
        addCost('vin_tag', vinTagResponse._model || 'gpt-4o', vinTagResponse._usage || null, Number(vinTagResponse._cost_usd ?? 0))
      }

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

      // Audit trail
      try {
        if (vehicle_id) {
          const modelsUsedArr = [
            visionModel,
            (spidData ? 'gpt-4o' : null),
            (vinTagData ? 'gpt-4o' : null),
          ].filter(Boolean)

          await supabase
            .from('ai_scan_sessions')
            .insert({
              vehicle_id,
              event_id: timeline_event_id || null,
              image_ids: [imageRecord.id],
              ai_model_version: `analyze-image@2026-02-19`,
              ai_model_cost: totalCostUsd || 0,
              total_images_analyzed: 1,
              scan_duration_seconds: Math.round((Date.now() - startedAt) / 10) / 100,
              total_tokens_used: totalTokens || null,
              fields_extracted: [
                (appraiserResult ? 'tier1' : null),
                (spidData ? 'spid' : null),
                (vinTagData ? 'vin' : null),
              ].filter(Boolean),
              concerns_flagged: [],
              overall_confidence: null,
              context_available: {
                vehicle_id: Boolean(vehicle_id),
                timeline_event_id: Boolean(timeline_event_id),
                models_used: modelsUsedArr,
                cost_usd: totalCostUsd || 0,
                tokens: totalTokens || 0,
              },
              created_by: user_id || null,
            })
        }
      } catch (err) {
        console.warn('Failed to write ai_scan_sessions (non-blocking):', err)
      }

      // Save SPID data to dedicated table
      if (spidData && spidResponse && vehicle_id) {
        if (spidResponse.is_spid_sheet && spidResponse.confidence > 70) {
          const extracted = spidResponse.extracted_data
          const { error: spidSaveError } = await supabase
            .from('vehicle_spid_data')
            .upsert({
              vehicle_id,
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

    // Insert camera position
    let cameraPosition = null
    if (imageRecord?.id && (detectedAngle || appraiserResult?.camera_position)) {
      try {
        cameraPosition = await insertCameraPosition(
          supabase,
          imageRecord.id,
          vehicle_id,
          detectedAngle || 'unknown',
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
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error in analyze-image function:', error)
    const errorMessage = error instanceof Error ? error.message : String(error)

    // Best-effort: mark image as failed
    try {
      const body = await req.json().catch(() => ({} as any))
      const imageId = body?.image_id ?? null
      const imageUrl = body?.image_url ?? null
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SERVICE_ROLE_KEY') ?? '',
        { auth: { persistSession: false, detectSessionInUrl: false } }
      )
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
                last_error: { message: errorMessage, at: new Date().toISOString() }
              }
            })
            .eq('id', img.id)
        }
      }
    } catch (err) {
      console.warn('Failed to mark image as failed (non-blocking):', err)
    }

    return new Response(
      JSON.stringify({ error: errorMessage, success: false }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

// ============================================================================
// Tag generation from appraiser result
// ============================================================================
function generateTagsFromAppraiser(appraiserResult: any): AutomatedTag[] {
  if (!appraiserResult || appraiserResult.category === 'error') return []

  const tags: AutomatedTag[] = []
  const seen = new Set<string>()

  const addTag = (name: string, type: AutomatedTag['tag_type'], confidence: number, detectionData: any) => {
    const key = `${name}:${type}`
    if (seen.has(key)) return
    seen.add(key)
    tags.push({
      tag_name: name,
      tag_type: type,
      confidence: Math.round(Math.min(confidence, 100)),
      x_position: 50,
      y_position: 50,
      width: 20,
      height: 20,
      ai_detection_data: detectionData,
    })
  }

  // Category tag
  if (appraiserResult.category) {
    addTag(
      appraiserResult.category.charAt(0).toUpperCase() + appraiserResult.category.slice(1),
      'custom',
      90,
      { source: 'appraiser', field: 'category', value: appraiserResult.category }
    )
  }

  // Primary subject -> part tag
  if (appraiserResult.subject) {
    const subjectParts = String(appraiserResult.subject).split('.')
    // Use the most descriptive part (e.g., "door" from "exterior.panel.door.front.driver")
    const meaningful = subjectParts.find(p =>
      !['exterior', 'interior', 'engine', 'undercarriage', 'document', 'damage', 'panel', 'front', 'rear', 'driver', 'passenger'].includes(p)
    ) || subjectParts[subjectParts.length - 1]
    const tagName = meaningful.charAt(0).toUpperCase() + meaningful.slice(1).replace(/_/g, ' ')
    addTag(tagName, 'part', 85, { source: 'appraiser', field: 'subject', value: appraiserResult.subject })
  }

  // Secondary subjects -> part tags at lower confidence
  if (Array.isArray(appraiserResult.secondary_subjects)) {
    for (const sec of appraiserResult.secondary_subjects) {
      const parts = String(sec).split('.')
      const meaningful = parts.find(p =>
        !['exterior', 'interior', 'engine', 'undercarriage', 'document', 'damage', 'panel', 'front', 'rear', 'driver', 'passenger'].includes(p)
      ) || parts[parts.length - 1]
      const tagName = meaningful.charAt(0).toUpperCase() + meaningful.slice(1).replace(/_/g, ' ')
      addTag(tagName, 'part', 70, { source: 'appraiser', field: 'secondary_subject', value: sec })
    }
  }

  // Visible components -> part tags
  if (Array.isArray(appraiserResult.visible_components)) {
    for (const comp of appraiserResult.visible_components) {
      const tagName = String(comp).charAt(0).toUpperCase() + String(comp).slice(1).replace(/_/g, ' ')
      addTag(tagName, 'part', 75, { source: 'appraiser', field: 'visible_component', value: comp })
    }
  }

  // Damage/condition -> issue tags
  if (appraiserResult.visible_damage && appraiserResult.condition_notes) {
    const notes = String(appraiserResult.condition_notes).toLowerCase()
    const damageKeywords: Array<[string, string]> = [
      ['rust', 'Rust'], ['dent', 'Dent'], ['scratch', 'Scratch'], ['crack', 'Crack'],
      ['tear', 'Tear'], ['stain', 'Stain'], ['fade', 'Fade'], ['wear', 'Wear'],
      ['corrosion', 'Corrosion'], ['chip', 'Paint chip'], ['peel', 'Paint peel'],
      ['bubble', 'Rust bubble'], ['hole', 'Hole'], ['bend', 'Bend'], ['warp', 'Warp'],
    ]
    for (const [keyword, tagName] of damageKeywords) {
      if (notes.includes(keyword)) {
        addTag(tagName, 'issue', 80, { source: 'appraiser', field: 'condition_notes', matched: keyword })
      }
    }
    // If damage is visible but no specific keyword matched, add generic "Damage" tag
    if (!damageKeywords.some(([kw]) => notes.includes(kw))) {
      addTag('Damage', 'issue', 70, { source: 'appraiser', field: 'visible_damage', notes: appraiserResult.condition_notes })
    }
  }

  return tags
}

// ============================================================================
// SPID detection (imports shared utility)
// ============================================================================
async function detectSPIDSheet(imageUrl: string, vehicleId?: string, supabaseClient?: any, userId?: string) {
  const { detectSPIDSheet: detectSPID } = await import('../_shared/detectSPIDSheet.ts')
  return await detectSPID(imageUrl, vehicleId, supabaseClient, userId)
}

// ============================================================================
// VIN tag detection
// ============================================================================
async function detectAndExtractVINTag(imageUrl: string, vehicleId?: string, supabaseClient?: any, userId?: string) {
  const { callOpenAiChatCompletions } = await import('../_shared/openaiChat.ts')

  let openAiKey: string | null = null
  try {
    if (userId && supabaseClient) {
      const { getUserApiKey } = await import('../_shared/getUserApiKey.ts')
      const apiKeyResult = await getUserApiKey(supabaseClient, userId, 'openai', 'OPENAI_API_KEY')
      openAiKey = apiKeyResult.apiKey
    } else {
      openAiKey = Deno.env.get('OPENAI_API_KEY') || null
    }
  } catch (err) {
    console.warn('Failed to get API key, using system key:', err)
    openAiKey = Deno.env.get('OPENAI_API_KEY') || null
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
    "vin": string | null,
    "vin_location": string | null,
    "condition": string | null,
    "authenticity_concerns": string[],
    "readability": string | null,
    "vin_format": string | null
  },
  "raw_text": string
}

Be very careful to extract the EXACT VIN - check each character carefully.`
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Analyze this image. Is it a VIN tag or plate? If yes, extract the complete VIN and assess its condition.' },
            { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } }
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

// ============================================================================
// Tag insertion
// ============================================================================
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
      created_by: '00000000-0000-0000-0000-000000000000',
      verified: false,
      ai_detection_data: tag.ai_detection_data,
      manual_override: false
    }))

    const { error } = await supabase
      .from('image_tags')
      .upsert(tagData, {
        onConflict: 'image_url,tag_name,x_position,y_position',
        ignoreDuplicates: true
      })

    if (error) {
      console.error('Error inserting automated tags:', error)
    }
  } catch (err) {
    console.error('Exception inserting automated tags:', err)
  }
}

// ============================================================================
// Camera position insertion
// ============================================================================
async function insertCameraPosition(
  supabase: any,
  imageId: string,
  vehicleId: string | undefined,
  detectedAngle: string,
  appraiserResult: any
): Promise<any> {
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
    azimuth_deg = aiCameraPos.azimuth_deg
    elevation_deg = aiCameraPos.elevation_deg ?? 0
    distance_mm = aiCameraPos.distance_mm ?? 5000
    confidence = aiCameraPos.confidence ?? 0.7

    if (aiSubjectPos) {
      subject_x_mm = aiSubjectPos.x_mm ?? null
      subject_y_mm = aiSubjectPos.y_mm ?? null
      subject_z_mm = aiSubjectPos.z_mm ?? null
    }
  } else {
    const fallback = angleToCameraPosition(detectedAngle, appraiserResult)
    azimuth_deg = fallback.azimuth_deg
    elevation_deg = fallback.elevation_deg
    distance_mm = fallback.distance_mm
    confidence = fallback.confidence * 0.5
    subject_key = fallback.subject_key
  }

  const az_rad = azimuth_deg * Math.PI / 180
  const el_rad = elevation_deg * Math.PI / 180
  const horiz_dist = distance_mm * Math.cos(el_rad)

  const camera_x_mm = Math.round(-horiz_dist * Math.sin(az_rad))
  const camera_y_mm = Math.round(-horiz_dist * Math.cos(az_rad))
  const camera_z_mm = Math.round(distance_mm * Math.sin(el_rad))

  const { data, error } = await supabase
    .from('image_camera_position')
    .upsert({
      image_id: imageId,
      vehicle_id: vehicleId || null,
      subject_key,
      azimuth_deg,
      elevation_deg,
      distance_mm,
      camera_x_mm,
      camera_y_mm,
      camera_z_mm,
      subject_x_mm,
      subject_y_mm,
      subject_z_mm,
      confidence,
      source: 'analyze-image',
      source_version: 'v4',
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

// ============================================================================
// Fallback angle-to-camera-position mapping
// ============================================================================
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
  const appraiserCategory = appraiserResult?.category?.toLowerCase() || ''

  let azimuth = 45
  let elevation = 15
  let distance = 8000
  let subject = 'vehicle'
  let confidence = 0.5
  let needs_reanalysis = true

  if (label.includes('front') && !label.includes('interior') && !label.includes('suspension')) {
    distance = 8000; elevation = 15; subject = 'vehicle'
    if (label.includes('straight') || label === 'front' || label === 'exterior_front') {
      azimuth = 0; confidence = 0.8; needs_reanalysis = false
    } else if (label.includes('driver')) {
      azimuth = 45; confidence = 0.85; needs_reanalysis = false
    } else if (label.includes('passenger')) {
      azimuth = 315; confidence = 0.85; needs_reanalysis = false
    }
  } else if (label.includes('rear') && !label.includes('interior') && !label.includes('suspension') && !label.includes('seat')) {
    distance = 8000; elevation = 15; subject = 'vehicle'
    if (label.includes('straight') || label === 'rear' || label === 'exterior_rear') {
      azimuth = 180; confidence = 0.8; needs_reanalysis = false
    } else if (label.includes('driver')) {
      azimuth = 135; confidence = 0.85; needs_reanalysis = false
    } else if (label.includes('passenger')) {
      azimuth = 225; confidence = 0.85; needs_reanalysis = false
    }
  } else if (label.includes('profile') || label.includes('side')) {
    distance = 8000; elevation = 8; subject = 'vehicle'
    if (label.includes('driver')) {
      azimuth = 90; confidence = 0.85; needs_reanalysis = false
    } else if (label.includes('passenger')) {
      azimuth = 270; confidence = 0.85; needs_reanalysis = false
    }
  } else if (label.includes('engine') || appraiserCategory === 'engine') {
    subject = 'engine.bay'; distance = 1500; elevation = 60; azimuth = 0; confidence = 0.6; needs_reanalysis = false
  } else if (label.includes('interior') || label.includes('dash') || label.includes('seat') || appraiserCategory === 'interior') {
    distance = 800
    if (label.includes('dashboard') || label.includes('dash')) {
      subject = 'interior.dashboard'; azimuth = 0; elevation = -30; confidence = 0.8; needs_reanalysis = false
    } else {
      subject = 'interior.cabin'; azimuth = 0; elevation = -15; distance = 1000; confidence = 0.4; needs_reanalysis = true
    }
  } else if (label.includes('undercarriage') || label.includes('frame') || label.includes('suspension')) {
    subject = 'undercarriage'; distance = 1500; elevation = -45; azimuth = 0; confidence = 0.5; needs_reanalysis = true
  } else if (label === 'exterior' || label === 'exterior_three_quarter') {
    subject = 'vehicle'; azimuth = 45; elevation = 15; distance = 8000; confidence = 0.15; needs_reanalysis = true
  }

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
    confidence,
    needs_reanalysis,
  }
}
