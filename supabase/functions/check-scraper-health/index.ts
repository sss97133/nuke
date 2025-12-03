import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || 'https://qkgaybvrernstplzjaam.supabase.co'
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || ''
    
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    })

    // Get health stats for all sources
    const { data: healthSummary, error: healthError } = await supabase
      .rpc('get_all_sources_health')

    if (healthError) {
      throw new Error(`Failed to get health summary: ${healthError.message}`)
    }

    // Check for degraded sources
    const degradedSources = healthSummary?.filter((s: any) => 
      s.status === 'degraded' || s.status === 'failing'
    ) || []

    // Get detailed stats for each source
    const detailedStats: any = {}
    for (const source of ['craigslist', 'bat', 'ksl', 'facebook_marketplace']) {
      const { data: stats } = await supabase
        .rpc('get_source_health_stats', { p_source: source, p_hours: 24 })

      if (stats && stats.length > 0) {
        detailedStats[source] = stats[0]
      }
    }

    // Check if we should send alerts
    if (degradedSources.length > 0) {
      console.log(`⚠️ Found ${degradedSources.length} degraded sources`)
      
      for (const source of degradedSources) {
        // Create admin notification
        const { error: notifError } = await supabase
          .from('admin_notifications')
          .insert({
            type: source.status === 'failing' ? 'scraper_critical' : 'scraper_degraded',
            severity: source.status === 'failing' ? 'critical' : 'warning',
            title: `${source.source} Scraper ${source.status === 'failing' ? 'Failing' : 'Degraded'}`,
            message: `Success rate: ${source.success_rate}% (${source.total_attempts} attempts in last 24h)`,
            metadata: {
              source: source.source,
              success_rate: source.success_rate,
              total_attempts: source.total_attempts,
              last_success: source.last_success,
              last_failure: source.last_failure,
              detailed_stats: detailedStats[source.source]
            },
            is_read: false
          })

        if (notifError) {
          console.error('Failed to create notification:', notifError.message)
        }
      }
    }

    // Overall system health
    const totalAttempts = healthSummary?.reduce((sum: number, s: any) => sum + (s.total_attempts || 0), 0) || 0
    const healthySources = healthSummary?.filter((s: any) => s.status === 'healthy').length || 0
    const totalSources = healthSummary?.length || 0
    
    const systemStatus = healthySources === totalSources ? 'healthy' :
                        healthySources > totalSources / 2 ? 'degraded' : 'failing'

    return new Response(
      JSON.stringify({
        success: true,
        system_status: systemStatus,
        timestamp: new Date().toISOString(),
        summary: {
          total_sources: totalSources,
          healthy_sources: healthySources,
          degraded_sources: degradedSources.length,
          total_attempts_24h: totalAttempts
        },
        sources: healthSummary,
        detailed_stats: detailedStats,
        degraded_sources: degradedSources
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    )

  } catch (error: any) {
    console.error('Error in check-scraper-health:', error)
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error?.message || String(error)
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    )
  }
})

