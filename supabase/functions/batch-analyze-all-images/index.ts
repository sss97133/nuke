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

    const { batch_size = 50, offset = 0, limit = null } = await req.json()

    // Get all images without analysis (paginated)
    let query = supabase
      .from('vehicle_images')
      .select('id, image_url, vehicle_id, ai_scan_metadata')
      .is('ai_scan_metadata->appraiser->primary_label', null)
      .order('created_at', { ascending: true })
      .range(offset, offset + (limit || batch_size) - 1)

    const { data: images, error: queryError } = await query

    if (queryError) {
      throw queryError
    }

    if (!images || images.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No images need analysis',
          analyzed: 0,
          total_remaining: 0
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get total count for progress tracking
    const { count: totalRemaining } = await supabase
      .from('vehicle_images')
      .select('*', { count: 'exact', head: true })
      .is('ai_scan_metadata->appraiser->primary_label', null)

    const openaiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openaiKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'OPENAI_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Processing batch: ${offset + 1}-${offset + images.length} of ~${totalRemaining} remaining`)

    let analyzed = 0
    let failed = 0
    const failedIds: string[] = []

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

Return ONLY valid JSON:
{
  "angle": "exterior_side",
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
          const errorText = await response.text()
          console.error(`Failed for image ${image.id}: ${response.status} - ${errorText.substring(0, 100)}`)
          failed++
          failedIds.push(image.id)
          continue
        }

        const data = await response.json()
        const content = data.choices[0]?.message?.content

        if (!content) {
          console.error(`No content for image ${image.id}`)
          failed++
          failedIds.push(image.id)
          continue
        }

        let result
        try {
          result = JSON.parse(content)
        } catch (parseError) {
          // Try to extract JSON from markdown
          const jsonMatch = content.match(/\{[\s\S]*\}/)
          if (jsonMatch) {
            result = JSON.parse(jsonMatch[0])
          } else {
            throw new Error('No valid JSON in response')
          }
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
        if (result.angle) {
          descriptionParts.push(`Angle: ${angleLabels[result.angle] || result.angle}`)
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
            angle: result.angle || 'exterior',
            primary_label: angleLabels[result.angle || 'exterior'] || 'Exterior View',
            description: descriptionParts.join(' • ') || 'Vehicle exterior view',
            context: contextParts.join(' | ') || 'Vehicle listing photo',
            model: 'gpt-4o',
            analyzed_at: new Date().toISOString(),
            condition_score: result.condition_score,
            rust_severity: result.rust_severity,
            paint_quality: result.paint_quality
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
          console.error(`Update failed for ${image.id}:`, updateError.message)
          failed++
          failedIds.push(image.id)
        } else {
          analyzed++
          if (analyzed % 10 === 0) {
            console.log(`  Progress: ${analyzed}/${images.length} analyzed`)
          }
        }

        // Rate limit delay - 1 second between requests
        await new Promise(resolve => setTimeout(resolve, 1000))

      } catch (error: any) {
        console.error(`Error analyzing image ${image.id}:`, error.message)
        failed++
        failedIds.push(image.id)
      }
    }

    // Get updated count
    const { count: remainingAfter } = await supabase
      .from('vehicle_images')
      .select('*', { count: 'exact', head: true })
      .is('ai_scan_metadata->appraiser->primary_label', null)

    return new Response(
      JSON.stringify({
        success: true,
        analyzed,
        failed,
        total_in_batch: images.length,
        total_remaining: remainingAfter || 0,
        failed_ids: failedIds,
        next_offset: offset + images.length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('Batch analysis error:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

