/**
 * AI PARTS RECOMMENDATION ENGINE
 * Analyzes vehicle images and recommends replacement/upgrade parts
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { vehicle_id, image_ids } = await req.json()

    if (!vehicle_id) {
      return new Response(
        JSON.stringify({ error: 'vehicle_id required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')

    // Get vehicle context
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('year, make, model, vin')
      .eq('id', vehicle_id)
      .single()

    // Get vehicle images
    let query = supabase
      .from('vehicle_images')
      .select('id, image_url, ai_scan_metadata')
      .eq('vehicle_id', vehicle_id)
    
    if (image_ids && image_ids.length > 0) {
      query = query.in('id', image_ids)
    }
    
    const { data: images } = await query
      .order('created_at', { ascending: false })
      .limit(10)

    if (!images || images.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No images found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`🚗 Analyzing ${images.length} images for ${vehicle.year} ${vehicle.make} ${vehicle.model}`)

    const recommendations = []

    for (const image of images) {
      const prompt = `Analyze this ${vehicle.year} ${vehicle.make} ${vehicle.model} image for parts that need replacement or upgrade.

For each part that shows wear, damage, or could be upgraded:
1. Identify the specific part
2. Assess condition (critical, high priority, medium, low, cosmetic)
3. Explain why it needs attention
4. Suggest OEM part number if possible

Return JSON:
{
  "parts": [
    {
      "part_name": "Master Cylinder",
      "oem_part_number": "GM-15643918",
      "issue": "Visible brake fluid leaks around reservoir",
      "priority": "critical",
      "confidence": 95,
      "category": "brakes"
    }
  ]
}`

      const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'anthropic-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 2000,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'url', url: image.image_url }
              },
              {
                type: 'text',
                text: prompt
              }
            ]
          }]
        })
      })

      if (claudeResp.ok) {
        const claudeData = await claudeResp.json()
        const content = claudeData.content?.[0]?.text || '{}'
        const analysis = JSON.parse(content.match(/\{[\s\S]*\}/)?.[0] || '{}')

        console.log(`   📸 Image ${image.id}: Found ${analysis.parts?.length || 0} recommendations`)

        if (analysis.parts && analysis.parts.length > 0) {
          for (const part of analysis.parts) {
            // Try to match to catalog
            const { data: catalogMatches } = await supabase
              .from('catalog_parts')
              .select('id, part_number, name, price_current, category')
              .or(`name.ilike.%${part.part_name}%,part_number.eq.${part.oem_part_number}`)
              .limit(3)

            recommendations.push({
              image_id: image.id,
              part_name: part.part_name,
              oem_part_number: part.oem_part_number,
              issue: part.issue,
              priority: part.priority,
              confidence: part.confidence,
              catalog_matches: catalogMatches || [],
              estimated_cost: catalogMatches?.[0]?.price_current || null
            })

            // Save recommendation
            await supabase
              .from('ai_part_recommendations')
              .insert({
                vehicle_id,
                image_id: image.id,
                identified_issue: part.issue,
                recommended_parts: [part],
                catalog_matches: catalogMatches || [],
                estimated_cost: catalogMatches?.[0]?.price_current || null,
                confidence_score: part.confidence,
                priority: part.priority
              })
          }
        }
      }

      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 1000))
    }

    console.log(`✅ Generated ${recommendations.length} recommendations`)

    return new Response(
      JSON.stringify({
        success: true,
        vehicle: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
        images_analyzed: images.length,
        recommendations,
        total_estimated_cost: recommendations.reduce((sum, r) => sum + (r.estimated_cost || 0), 0)
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

