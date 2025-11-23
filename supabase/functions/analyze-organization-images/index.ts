import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY')

Deno.serve(async (req) => {
  // Allow CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { organizationId, batch } = await req.json()
    
    console.log('Processing organization:', organizationId, 'batch:', batch)

    // Fetch unanalyzed organization images (limit to prevent timeouts)
    const { data: images, error: fetchError } = await supabase
      .from('organization_images')
      .select('*')
      .eq('organization_id', organizationId)
      .is('ai_analysis', null)
      .order('taken_at', { ascending: true })
      .limit(batch ? 50 : 10)

    if (fetchError) {
      console.error('Fetch error:', fetchError)
      throw fetchError
    }
    
    if (!images || images.length === 0) {
      console.log('No unanalyzed images found for org:', organizationId)
      return new Response(JSON.stringify({ message: 'No images to analyze', organizationId }), { 
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      })
    }
    
    console.log(`Found ${images.length} images to analyze for org:`, organizationId)

    // Group images by date clusters (within 7 days = same session)
    const clusters = []
    let currentCluster = []
    let lastDate = null

    for (const img of images) {
      const imgDate = new Date(img.captured_at || img.created_at)
      
      if (!lastDate || Math.abs(imgDate.getTime() - lastDate.getTime()) < 7 * 24 * 60 * 60 * 1000) {
        currentCluster.push(img)
      } else {
        if (currentCluster.length > 0) clusters.push(currentCluster)
        currentCluster = [img]
      }
      lastDate = imgDate
    }
    if (currentCluster.length > 0) clusters.push(currentCluster)

    // Analyze each cluster
    for (const cluster of clusters) {
      // Individual image analysis
      for (const image of cluster) {
        const prompt = `Analyze this organization/facility image using the 5 W's framework:

WHO: Who is in this image? Workers, customers, owner?
WHAT: What is shown? (equipment, facility interior/exterior, work in progress, finished work, team photo)
WHEN: Context clues about timing (new facility, established business, under renovation)
WHERE: Type of location (garage, commercial shop, outdoor lot, showroom)
WHY: What is the uploader's INTENT? (show capability, document progress, prove legitimacy, attract customers/investors)

Then classify the image:
- facility_exterior: Outside of building
- facility_interior: Shop floor, work areas
- equipment: Tools, machinery, equipment
- work_in_progress: Active projects, renovations
- team: Staff photos
- finished_work: Completed projects, showcase
- event: Customer events, open house
- other

Extract business intelligence:
- Growth signals (new equipment, expansion, renovation)
- Capability indicators (specialized tools, clean facility, professional setup)
- Stage assessment (startup/bootstrap, growing, established)
- Investment readiness (infrastructure, organization, professionalism)

Return JSON:
{
  "category": "facility_interior",
  "what_is_shown": "Shop floor with new lift installation",
  "context_5ws": {
    "who": "...",
    "what": "...",
    "when": "...",
    "where": "...",
    "why": "..."
  },
  "user_intent": "Documenting shop expansion and new capabilities",
  "business_intelligence": {
    "growth_signals": ["new_equipment", "expansion"],
    "capability_level": "growing",
    "investment_stage": "ready_for_growth_capital",
    "confidence": 0.85
  },
  "tags": ["lift", "renovation", "expansion", "professional_setup"]
}`

        try {
          const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'x-api-key': anthropicApiKey,
              'anthropic-version': '2023-06-01',
              'content-type': 'application/json'
            },
            body: JSON.stringify({
              model: 'claude-3-5-sonnet-20241022',
              max_tokens: 1000,
              messages: [{
                role: 'user',
                content: [
                  { type: 'text', text: prompt + '\n\nIMPORTANT: Return ONLY valid JSON, no other text.' },
                  { type: 'image', source: { type: 'url', url: image.image_url } }
                ]
              }]
            })
          })

          const aiResponse = await response.json()
          console.log('Claude response:', aiResponse)
          
          if (aiResponse.content && aiResponse.content[0] && aiResponse.content[0].text) {
            const analysis = JSON.parse(aiResponse.content[0].text)

            // Save individual analysis
            await supabase
              .from('organization_images')
              .update({
                ai_analysis: analysis,
                category: analysis.category,
                ai_tags: analysis.tags,
                processed_at: new Date().toISOString()
              })
              .eq('id', image.id)
            
            console.log(`✓ Analyzed image ${image.id}`)
          } else {
            console.error('Unexpected response format:', aiResponse)
          }

        } catch (err) {
          console.error(`Error analyzing image ${image.id}:`, err)
        }
      }

      // Cluster-level narrative analysis
      if (cluster.length >= 3) {
        const clusterPrompt = `Analyze this sequence of ${cluster.length} facility images taken over time.

Look at the PROGRESSION and NARRATIVE:
1. What story do these images tell when viewed together?
2. What phase is this business in? (startup/bootstrap, growth, established, declining)
3. Are there growth signals? (renovation, new equipment, expansion, professionalization)
4. What's the business trajectory? (upward, stable, uncertain)
5. Is this an investment opportunity? Why or why not?

Context from images:
${cluster.map((img, i) => `Image ${i + 1}: ${img.caption || 'No caption'}, Date: ${img.captured_at || img.created_at}`).join('\n')}

Return JSON with business narrative and investment assessment.`

        try {
          const imageContent = cluster.slice(0, 10).map(img => ({
            type: 'image',
            source: { type: 'url', url: img.image_url }
          }))

          const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'x-api-key': anthropicApiKey,
              'anthropic-version': '2023-06-01',
              'content-type': 'application/json'
            },
            body: JSON.stringify({
              model: 'claude-3-5-sonnet-20241022',
              max_tokens: 2000,
              messages: [{
                role: 'user',
                content: [
                  { type: 'text', text: clusterPrompt + '\n\nIMPORTANT: Return ONLY valid JSON with all required fields.' },
                  ...imageContent
                ]
              }]
            })
          })

          const aiResponse = await response.json()
          console.log('Cluster analysis response:', aiResponse)
          
          if (aiResponse.content && aiResponse.content[0] && aiResponse.content[0].text) {
            const narrative = JSON.parse(aiResponse.content[0].text)

            // Store cluster narrative
            const { error: insertError } = await supabase
              .from('organization_narratives')
              .insert({
                organization_id: organizationId,
                narrative_type: 'facility_progression',
                time_period_start: cluster[0].taken_at || cluster[0].created_at,
                time_period_end: cluster[cluster.length - 1].taken_at || cluster[cluster.length - 1].created_at,
                narrative: narrative,
                image_count: cluster.length,
                confidence_score: narrative.confidence || 0.7,
                investment_signals: narrative.growth_signals || [],
                business_stage: narrative.business_stage
              })

            if (insertError) {
              console.error('Error storing narrative:', insertError)
            } else {
              console.log(`✓ Stored narrative for ${cluster.length} image cluster`)
            }

            // If high investment potential, match to investors
            if (narrative.investment_readiness?.score > 0.7 || narrative.investment_score > 0.7) {
              console.log('🎯 High investment potential detected:', narrative.business_stage, narrative.investment_score || narrative.investment_readiness?.score)
            }
          } else {
            console.error('Unexpected cluster response:', aiResponse)
          }

        } catch (err) {
          console.error('Error analyzing cluster narrative:', err.message)
        }
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        organizationId,
        imagesAnalyzed: images.length,
        clustersFound: clusters.length
      }),
      { 
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        } 
      }
    )

  } catch (error) {
    console.error('Function error:', error)
    return new Response(
      JSON.stringify({ error: error.message, stack: error.stack }),
      { 
        status: 500, 
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        } 
      }
    )
  }
})

