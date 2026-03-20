
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/**
 * Thin proxy: forwards upload analysis requests to analyze-image.
 * Preserves the API contract for frontend callers (EnhancedImageTagger, tagService).
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { image_url, vehicle_id, timeline_event_id, trigger_source } = await req.json()

    console.log(`[auto-analyze-upload] Forwarding to yono-analyze: ${image_url} for vehicle ${vehicle_id}`)

    const serviceRoleKey =
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
      Deno.env.get('SERVICE_ROLE_KEY') ||
      Deno.env.get('SUPABASE_SERVICE_KEY') ||
      Deno.env.get('SUPABASE_KEY') ||
      ''

    const resp = await fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/yono-analyze`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
          image_url,
          vehicle_id,
          timeline_event_id,
        }),
        signal: AbortSignal.timeout(120000),
      }
    )

    const result = await resp.json()

    // Map response to match the old auto-analyze-upload contract
    const tagsCreated = result.tags?.length || 0
    console.log(`[auto-analyze-upload] Done: ${tagsCreated} tags created`)

    return new Response(
      JSON.stringify({
        success: result.success,
        source: 'analyze-image',
        tags_created: tagsCreated,
        tags: result.tags || [],
        trigger_source,
        analysis_timestamp: new Date().toISOString(),
        appraisal: result.appraisal || null,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    console.error('[auto-analyze-upload] Error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
