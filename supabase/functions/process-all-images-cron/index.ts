import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    )

    const { max_images = 1000, batch_size = 50 } = await req.json().catch(() => ({}))

    console.log(`🚨 Starting batch image processing (max: ${max_images}, batch: ${batch_size})`)

    // Get count of images needing analysis
    const { count: totalRemaining } = await supabase
      .from('vehicle_images')
      .select('*', { count: 'exact', head: true })
      .is('ai_scan_metadata->appraiser->primary_label', null)

    if (!totalRemaining || totalRemaining === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'All images already analyzed',
          analyzed: 0,
          total_remaining: 0
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const openaiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openaiKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'OPENAI_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const maxToProcess = Math.min(max_images, totalRemaining)
    console.log(`Processing ${maxToProcess} of ${totalRemaining} remaining images`)

    let totalAnalyzed = 0
    let totalFailed = 0
    let offset = 0

    // Process in batches until we hit max_images or run out
    while (totalAnalyzed < maxToProcess) {
      const batchLimit = Math.min(batch_size, maxToProcess - totalAnalyzed)
      
      // Get batch of images
      const { data: images, error: queryError } = await supabase
        .from('vehicle_images')
        .select('id, image_url, vehicle_id, ai_scan_metadata')
        .is('ai_scan_metadata->appraiser->primary_label', null)
        .order('created_at', { ascending: true })
        .range(offset, offset + batchLimit - 1)

      if (queryError || !images || images.length === 0) {
        console.log('No more images to process')
        break
      }

      console.log(`Processing batch: ${offset + 1}-${offset + images.length}`)

      for (const image of images) {
        try {
          const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${openaiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'gpt-4o',
              messages: [{
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: `Analyze this vehicle image. Determine:
1. View angle (exterior_front, exterior_rear, exterior_side, exterior_three_quarter, interior_dashboard, engine_bay, undercarriage, detail_shot)
2. Condition score (1-10)
3. Rust severity (0-10)
4. Paint quality (1-10)
5. Environment (garage, outdoor, showroom, etc.)
6. Photo quality (professional, amateur, etc.)

CRITICAL: Do NOT default to exterior_three_quarter. Only choose exterior_three_quarter if the FULL vehicle is visible AND (front+side) or (rear+side) are clearly visible.
If the vehicle is cropped/close-up, choose detail_shot unless it's clearly interior/engine_bay/undercarriage.

Return ONLY valid JSON:
{
  "angle": "exterior_side",
  "evidence": {
    "full_vehicle_in_frame": true,
    "front_end_visible": false,
    "rear_end_visible": false,
    "side_profile_visible": true,
    "interior_visible": false,
    "engine_bay_visible": false,
    "undercarriage_visible": false,
    "document_visible": false
  },
  "condition_score": 6,
  "rust_severity": 4,
  "paint_quality": 5,
  "environment": "garage",
  "photo_quality": "amateur"
}`
                  },
                  {
                    type: 'image_url',
                    image_url: { url: image.image_url }
                  }
                ]
              }],
              max_tokens: 300,
              temperature: 0.1,
              response_format: { type: 'json_object' }
            })
          })

          if (!response.ok) {
            console.error(`Failed for image ${image.id}: ${response.status}`)
            totalFailed++
            continue
          }

          const data = await response.json()
          const content = data.choices[0]?.message?.content

          if (!content) {
            totalFailed++
            continue
          }

          let result
          try {
            result = JSON.parse(content)
          } catch {
            const jsonMatch = content.match(/\{[\s\S]*\}/)
            if (jsonMatch) {
              result = JSON.parse(jsonMatch[0])
            } else {
              totalFailed++
              continue
            }
          }

          // Deterministic guardrails to prevent "three-quarter everywhere"
          const ev = (result as any)?.evidence || {}
          const full = !!ev.full_vehicle_in_frame
          const front = !!ev.front_end_visible
          const rear = !!ev.rear_end_visible
          const side = !!ev.side_profile_visible
          const interior = !!ev.interior_visible
          const engine = !!ev.engine_bay_visible
          const under = !!ev.undercarriage_visible
          const doc = !!ev.document_visible

          const modelAngle = (result as any)?.angle
          let finalAngle = modelAngle

          if (doc) finalAngle = 'detail_shot'
          else if (interior) finalAngle = (typeof modelAngle === 'string' && modelAngle.startsWith('interior_')) ? modelAngle : 'interior_dashboard'
          else if (engine) finalAngle = 'engine_bay'
          else if (under) finalAngle = 'undercarriage'
          else if (full) {
            if ((front && side) || (rear && side)) finalAngle = 'exterior_three_quarter'
            else if (front && !rear && !side) finalAngle = 'exterior_front'
            else if (rear && !front && !side) finalAngle = 'exterior_rear'
            else if (side && !front && !rear) finalAngle = 'exterior_side'
            else finalAngle = 'detail_shot'
          } else {
            if (!interior && !engine && !under) finalAngle = 'detail_shot'
          }

          if (modelAngle === 'exterior_three_quarter' && !(full && side && (front || rear))) {
            finalAngle = full ? (side ? 'exterior_side' : 'detail_shot') : 'detail_shot'
          }

          const angleLabels: Record<string, string> = {
            'exterior_front': 'Front View',
            'exterior_rear': 'Rear View',
            'exterior_side': 'Side View',
            'exterior_three_quarter': 'Three-Quarter View',
            'interior_dashboard': 'Interior - Dashboard',
            'interior_front_seats': 'Interior - Front Seats',
            'engine_bay': 'Engine Bay',
            'undercarriage': 'Undercarriage',
            'detail_shot': 'Detail Shot'
          }

          const descriptionParts = []
          if (finalAngle) {
            descriptionParts.push(`Angle: ${angleLabels[finalAngle] || finalAngle}`)
          }
          if (result.condition_score) {
            descriptionParts.push(`Condition: ${result.condition_score}/10`)
          }
          if (result.rust_severity !== undefined) {
            descriptionParts.push(`Rust: ${result.rust_severity}/10`)
          }

          const contextParts = []
          if (result.environment) {
            contextParts.push(`Environment: ${result.environment}`)
          }
          if (result.photo_quality) {
            contextParts.push(`Photo quality: ${result.photo_quality}`)
          }

          const aiScanMetadata = {
            appraiser: {
              angle: finalAngle || 'exterior',
              primary_label: angleLabels[finalAngle || 'exterior'] || 'Exterior View',
              description: descriptionParts.join(' • ') || 'Vehicle exterior view',
              context: contextParts.join(' | ') || 'Vehicle listing photo',
              model: 'gpt-4o',
              analyzed_at: new Date().toISOString(),
              condition_score: result.condition_score,
              rust_severity: result.rust_severity,
              paint_quality: result.paint_quality,
              angle_evidence: ev || null,
              model_angle_raw: modelAngle || null
            }
          }

          const { error: updateError } = await supabase
            .from('vehicle_images')
            .update({
              ai_scan_metadata: aiScanMetadata,
              ai_processing_status: 'completed'
            })
            .eq('id', image.id)

          if (updateError) {
            totalFailed++
          } else {
            totalAnalyzed++
            if (totalAnalyzed % 10 === 0) {
              console.log(`  Progress: ${totalAnalyzed}/${maxToProcess} analyzed`)
            }
          }

          // Rate limit delay
          await new Promise(resolve => setTimeout(resolve, 1000))

        } catch (error: any) {
          console.error(`Error analyzing image ${image.id}:`, error.message)
          totalFailed++
        }
      }

      offset += images.length

      // Check if we've hit our limit
      if (totalAnalyzed >= maxToProcess) {
        break
      }
    }

    // Get final count
    const { count: remainingAfter } = await supabase
      .from('vehicle_images')
      .select('*', { count: 'exact', head: true })
      .is('ai_scan_metadata->appraiser->primary_label', null)

    return new Response(
      JSON.stringify({
        success: true,
        analyzed: totalAnalyzed,
        failed: totalFailed,
        total_remaining: remainingAfter || 0,
        processed_in_this_run: totalAnalyzed
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('Processing error:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

