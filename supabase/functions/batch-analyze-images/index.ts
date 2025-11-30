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

    const { vehicle_id } = await req.json()
    if (!vehicle_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'vehicle_id required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get all images without analysis
    const { data: images } = await supabase
      .from('vehicle_images')
      .select('id, image_url, ai_scan_metadata')
      .eq('vehicle_id', vehicle_id)
      .is('ai_scan_metadata->appraiser->primary_label', null)

    if (!images || images.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'All images already analyzed', analyzed: 0 }),
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

    console.log(`Analyzing ${images.length} images for vehicle ${vehicle_id}`)

    let analyzed = 0
    let failed = 0

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
1. View angle (exterior_front, exterior_rear, exterior_side, exterior_three_quarter, interior_dashboard, engine_bay, etc.)
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
          console.error(`Failed for image ${image.id}: ${response.status}`)
          failed++
          continue
        }

        const data = await response.json()
        const result = JSON.parse(data.choices[0]?.message?.content || '{}')

        const angleLabels: Record<string, string> = {
          'exterior_front': 'Front View',
          'exterior_rear': 'Rear View',
          'exterior_side': 'Side View',
          'exterior_three_quarter': 'Three-Quarter View',
          'interior_dashboard': 'Interior - Dashboard',
          'engine_bay': 'Engine Bay'
        }

        const descriptionParts = []
        if (result.angle) {
          descriptionParts.push(`Angle: ${angleLabels[result.angle] || result.angle}`)
        }
        if (result.condition_score) {
          descriptionParts.push(`Condition: ${result.condition_score}/10`)
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
            context: contextParts.join(' | ') || 'ClassicCars.com listing photo',
            model: 'gpt-4o',
            analyzed_at: new Date().toISOString(),
            condition_score: result.condition_score,
            rust_severity: result.rust_severity,
            paint_quality: result.paint_quality
          }
        }

        await supabase
          .from('vehicle_images')
          .update({
            ai_scan_metadata: aiScanMetadata,
            ai_processing_status: 'completed'
          })
          .eq('id', image.id)

        analyzed++
        console.log(`Analyzed image ${image.id}`)

        // Rate limit delay
        await new Promise(resolve => setTimeout(resolve, 1000))

      } catch (error: any) {
        console.error(`Error analyzing image ${image.id}:`, error.message)
        failed++
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        analyzed,
        failed,
        total: images.length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

