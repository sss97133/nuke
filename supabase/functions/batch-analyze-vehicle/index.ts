import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface BatchAnalysisRequest {
  vehicle_id: string;
  force_reanalysis?: boolean; // Re-analyze even if already analyzed
  max_images?: number; // Limit number of images to analyze (for testing)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const paused = (() => {
      const v = String(Deno.env.get('NUKE_ANALYSIS_PAUSED') || '').trim().toLowerCase()
      return v === '1' || v === 'true' || v === 'yes' || v === 'on'
    })()
    if (paused) {
      return new Response(
        JSON.stringify({
          success: false,
          paused: true,
          message: 'Batch image analysis paused (NUKE_ANALYSIS_PAUSED)'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    const serviceRoleKey =
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
      Deno.env.get('SERVICE_ROLE_KEY') ||
      Deno.env.get('SUPABASE_SERVICE_KEY') ||
      Deno.env.get('SUPABASE_KEY') ||
      ''

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      serviceRoleKey,
      { auth: { persistSession: false, detectSessionInUrl: false } }
    )

    const { vehicle_id, force_reanalysis = false, max_images }: BatchAnalysisRequest = await req.json()
    
    if (!vehicle_id) {
      throw new Error('Missing vehicle_id')
    }

    console.log(`🔍 Starting batch analysis for vehicle: ${vehicle_id}`)
    console.log(`   Force reanalysis: ${force_reanalysis}`)
    console.log(`   Max images: ${max_images || 'unlimited'}`)

    // Cap max_images to prevent unbounded AI API calls
    const safeMaxImages = Math.max(1, Math.min(max_images || 100, 200))

    // Get pending images for this vehicle (skip already completed/processing)
    let query = supabase
      .from('vehicle_images')
      .select('id, image_url, vehicle_id')
      .eq('vehicle_id', vehicle_id)
      .order('created_at', { ascending: true })
      .limit(safeMaxImages)

    if (!force_reanalysis) {
      query = query.eq('ai_processing_status', 'pending')
    }

    const { data: images, error: imagesError } = await query

    if (imagesError) {
      throw new Error(`Failed to fetch images: ${imagesError.message}`)
    }

    if (!images || images.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No pending images found for this vehicle',
          analyzed: 0,
          skipped: 0,
          failed: 0
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`📸 Found ${images.length} pending images to analyze`)

    const imagesToAnalyze = images

    // Analyze images in batches (5 at a time to avoid overwhelming)
    const batchSize = 5
    let analyzed = 0
    let failed = 0
    const failures: Array<{ image_id: string; error: string }> = []

    for (let i = 0; i < imagesToAnalyze.length; i += batchSize) {
      const batch = imagesToAnalyze.slice(i, i + batchSize)
      console.log(`   Analyzing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(imagesToAnalyze.length / batchSize)} (${batch.length} images)`)

      // Analyze batch in parallel
      const results = await Promise.allSettled(
        batch.map(async (image) => {
          try {
            // Call analyze-image function
            const { data, error } = await supabase.functions.invoke('yono-analyze', {
              body: {
                image_url: image.image_url,
                vehicle_id: image.vehicle_id,
                image_id: image.id
              }
            })

            if (error) {
              throw new Error(error.message || 'Analysis failed')
            }

            return { success: true, image_id: image.id }
          } catch (err) {
            return { 
              success: false, 
              image_id: image.id, 
              error: err instanceof Error ? err.message : 'Unknown error' 
            }
          }
        })
      )

      // Count successes and failures
      for (const result of results) {
        if (result.status === 'fulfilled') {
          if (result.value.success) {
            analyzed++
          } else {
            failed++
            failures.push({ 
              image_id: result.value.image_id, 
              error: result.value.error || 'Unknown error' 
            })
          }
        } else {
          failed++
          failures.push({ 
            image_id: 'unknown', 
            error: result.reason?.message || 'Promise rejected' 
          })
        }
      }

      // Small delay between batches to avoid rate limits
      if (i + batchSize < imagesToAnalyze.length) {
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
    }

    console.log(`✅ Batch analysis complete: ${analyzed} analyzed, ${failed} failed`)

    // After all images analyzed, generate profile summary
    if (analyzed > 0) {
      console.log('🧠 Generating vehicle profile summary from all images...')
      try {
        // This would call a function to summarize all tags into profile_image_insights
        // For now, just log
        console.log('   Profile summary generation would happen here')
      } catch (err) {
        console.warn('Failed to generate profile summary:', err)
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        message: `Analyzed ${analyzed} images, ${failed} failed`,
        total_images: images.length,
        analyzed,
        skipped: images.length - imagesToAnalyze.length,
        failed,
        failures: failures.length > 0 ? failures.slice(0, 10) : undefined // Return first 10 failures
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    )

  } catch (error) {
    console.error('Batch analysis error:', error)
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    )
  }
})

