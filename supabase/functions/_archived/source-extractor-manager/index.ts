/**
 * SOURCE-EXTRACTOR MANAGER
 *
 * Programmatic assignment of extraction functions to URL sources.
 *
 * Every source URL gets an extractor.
 * Every extractor tracks success/failure.
 * When something breaks, we know exactly which sources are affected.
 *
 * Actions:
 * - register_all: Auto-register extractors for all sources without one
 * - health_check: Get health status of all source-extractor pairs
 * - get_broken: List broken extractors needing attention
 * - get_extractor_for_url: Find the right extractor for a given URL
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SourceHealth {
  source_id: string;
  source_name: string;
  source_url: string;
  source_type: string;
  extractor_name: string | null;
  extractor_status: string | null;
  success_rate: number | null;
  health_status: 'no_extractor' | 'broken' | 'degraded' | 'healthy';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body = await req.json().catch(() => ({}));
    const { action = 'health_check', url } = body;

    console.log('='.repeat(70));
    console.log('SOURCE-EXTRACTOR MANAGER');
    console.log('='.repeat(70));
    console.log(`Action: ${action}`);
    console.log(`Time: ${new Date().toISOString()}\n`);

    switch (action) {
      case 'register_all':
        return await registerAllSources(supabase);

      case 'health_check':
        return await healthCheck(supabase);

      case 'get_broken':
        return await getBrokenExtractors(supabase);

      case 'get_extractor_for_url':
        if (!url) {
          return new Response(
            JSON.stringify({ error: 'url parameter required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        return await getExtractorForUrl(supabase, url);

      case 'summary':
        return await getSummary(supabase);

      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

  } catch (error: any) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Register extractors for all sources without one
async function registerAllSources(supabase: any) {
  console.log('📝 Auto-registering extractors for all sources...\n');

  // Call the database function
  const { data, error } = await supabase.rpc('auto_register_extractors_for_sources');

  if (error) {
    console.error('Registration error:', error);
    throw new Error(`Failed to register extractors: ${error.message}`);
  }

  const registered = data || [];
  console.log(`✅ Registered ${registered.length} new extractors\n`);

  // Log each registration
  for (const reg of registered) {
    console.log(`  ${reg.source_name} → ${reg.extractor_name}`);
  }

  return new Response(
    JSON.stringify({
      success: true,
      action: 'register_all',
      registered_count: registered.length,
      registrations: registered,
      timestamp: new Date().toISOString()
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// Get health status of all source-extractor pairs
async function healthCheck(supabase: any) {
  console.log('🔍 Checking source-extractor health...\n');

  const { data: health, error } = await supabase
    .from('source_extractor_health')
    .select('*')
    .order('health_status');

  if (error) {
    console.error('Health check error:', error);
    throw new Error(`Failed to get health status: ${error.message}`);
  }

  const sources = health || [];

  // Categorize by health status
  const noExtractor = sources.filter((s: any) => s.health_status === 'no_extractor');
  const broken = sources.filter((s: any) => s.health_status === 'broken');
  const degraded = sources.filter((s: any) => s.health_status === 'degraded');
  const healthy = sources.filter((s: any) => s.health_status === 'healthy');

  const summary = {
    total_sources: sources.length,
    no_extractor: noExtractor.length,
    broken: broken.length,
    degraded: degraded.length,
    healthy: healthy.length,
    overall_status: broken.length > 5 ? 'critical' :
                    (broken.length > 0 || degraded.length > 5) ? 'needs_attention' :
                    noExtractor.length > 10 ? 'needs_setup' : 'good'
  };

  console.log('Summary:');
  console.log(`  Total sources: ${summary.total_sources}`);
  console.log(`  No extractor: ${summary.no_extractor}`);
  console.log(`  Broken: ${summary.broken}`);
  console.log(`  Degraded: ${summary.degraded}`);
  console.log(`  Healthy: ${summary.healthy}`);
  console.log(`  Overall: ${summary.overall_status}\n`);

  return new Response(
    JSON.stringify({
      success: true,
      action: 'health_check',
      summary,
      sources_needing_extractors: noExtractor.slice(0, 20).map((s: any) => ({
        name: s.source_name,
        url: s.source_url,
        type: s.source_type
      })),
      broken_sources: broken.map((s: any) => ({
        name: s.source_name,
        extractor: s.extractor_name,
        success_rate: s.success_rate,
        failed_count: s.failed_count
      })),
      timestamp: new Date().toISOString()
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// Get broken extractors that need fixing
async function getBrokenExtractors(supabase: any) {
  console.log('❌ Finding broken extractors...\n');

  const { data, error } = await supabase
    .from('source_extractor_health')
    .select('*')
    .in('health_status', ['broken', 'degraded'])
    .order('success_rate');

  if (error) {
    throw new Error(`Failed to get broken extractors: ${error.message}`);
  }

  const broken = data || [];

  console.log(`Found ${broken.length} broken/degraded extractors:\n`);
  for (const b of broken.slice(0, 10)) {
    console.log(`  ${b.source_name}: ${b.extractor_name} (${(b.success_rate * 100).toFixed(1)}% success)`);
  }

  return new Response(
    JSON.stringify({
      success: true,
      action: 'get_broken',
      broken_count: broken.length,
      extractors: broken.map((b: any) => ({
        source_name: b.source_name,
        source_url: b.source_url,
        extractor_name: b.extractor_name,
        extractor_version: b.extractor_version,
        success_rate: b.success_rate,
        total_attempts: b.total_attempts,
        failed_count: b.failed_count,
        health_status: b.health_status
      })),
      timestamp: new Date().toISOString()
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// Find the right extractor for a URL
async function getExtractorForUrl(supabase: any, url: string) {
  console.log(`🔍 Finding extractor for: ${url}\n`);

  const { data, error } = await supabase.rpc('get_extractor_for_url', { p_url: url });

  if (error) {
    throw new Error(`Failed to get extractor: ${error.message}`);
  }

  const extractor = data?.[0];

  if (extractor) {
    console.log(`Found: ${extractor.extractor_name} v${extractor.extractor_version}`);
    console.log(`Success rate: ${(extractor.success_rate * 100).toFixed(1)}%`);
  } else {
    console.log('No extractor found, will use default');
  }

  return new Response(
    JSON.stringify({
      success: true,
      action: 'get_extractor_for_url',
      url,
      extractor: extractor || null,
      using_default: !extractor,
      timestamp: new Date().toISOString()
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// Get summary of source-extractor system
async function getSummary(supabase: any) {
  console.log('📊 Getting system summary...\n');

  // Get counts
  const [
    { count: totalSources },
    { count: activeSources },
    { count: totalExtractors },
    { count: pendingQueue },
    { count: failedQueue }
  ] = await Promise.all([
    supabase.from('scrape_sources').select('*', { count: 'exact', head: true }),
    supabase.from('scrape_sources').select('*', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('extractor_registry').select('*', { count: 'exact', head: true }).neq('status', 'retired'),
    supabase.from('import_queue').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('import_queue').select('*', { count: 'exact', head: true }).eq('status', 'failed')
  ]);

  const summary = {
    scrape_sources: {
      total: totalSources,
      active: activeSources
    },
    extractors: {
      total: totalExtractors
    },
    import_queue: {
      pending: pendingQueue,
      failed: failedQueue
    }
  };

  console.log('System Summary:');
  console.log(`  Sources: ${activeSources}/${totalSources} active`);
  console.log(`  Extractors: ${totalExtractors} registered`);
  console.log(`  Queue: ${pendingQueue} pending, ${failedQueue} failed`);

  return new Response(
    JSON.stringify({
      success: true,
      action: 'summary',
      summary,
      timestamp: new Date().toISOString()
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}
