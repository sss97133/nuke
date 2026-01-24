/**
 * apply-migration
 *
 * Applies database migrations that can't be run through normal channels.
 * Only for admin use.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { migration } = body;

    if (migration !== 'data_lineage_and_org_services') {
      return new Response(
        JSON.stringify({ error: 'Unknown migration' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[migration] Applying data_lineage_and_org_services...');
    const results: string[] = [];

    // Step 1: Add Wayback Machine to observation_sources
    const { error: waybackError } = await supabase
      .from('observation_sources')
      .upsert({
        slug: 'wayback-machine',
        display_name: 'Internet Archive Wayback Machine',
        category: 'registry',
        base_url: 'https://web.archive.org',
        base_trust_score: 0.95,
        supported_observations: ['listing', 'media', 'specification', 'provenance'],
        notes: 'Historical snapshots of web pages. Extremely reliable for provenance.',
      }, {
        onConflict: 'slug',
      });

    if (waybackError) {
      results.push(`wayback source: ${waybackError.message}`);
    } else {
      results.push('wayback-machine source added');
    }

    // Step 2: Update Classic.com to aggregator category
    const { error: classicError } = await supabase
      .from('observation_sources')
      .update({
        category: 'aggregator',
        notes: 'Aggregates listings from 275+ dealers. Good for VINs and finding original sources.',
      })
      .eq('slug', 'classic-com');

    if (classicError) {
      results.push(`classic.com update: ${classicError.message}`);
    } else {
      results.push('classic-com updated to aggregator');
    }

    // Step 3: Add known platform providers with service_type in metadata
    const providers = [
      { id: 'a0000000-0000-0000-0000-000000000001', business_name: 'Speed Digital', website: 'https://www.speeddigital.com', metadata: { service_type: 'website_builder', powers_other_orgs: true } },
      { id: 'a0000000-0000-0000-0000-000000000003', business_name: 'Classic.com', website: 'https://www.classic.com', metadata: { service_type: 'listing_aggregator' } },
      { id: 'a0000000-0000-0000-0000-000000000005', business_name: 'SearchTempest', website: 'https://www.searchtempest.com', metadata: { service_type: 'search_tool' } },
      { id: 'a0000000-0000-0000-0000-000000000006', business_name: 'Carfax', website: 'https://www.carfax.com', metadata: { service_type: 'history_report' } },
      { id: 'a0000000-0000-0000-0000-000000000007', business_name: 'Internet Archive', website: 'https://archive.org', metadata: { service_type: 'archive' } },
    ];

    for (const p of providers) {
      const { error } = await supabase.from('businesses').upsert({ ...p, business_type: 'other' }, { onConflict: 'id' });
      results.push(error ? `${p.business_name}: ${error.message}` : `${p.business_name} added`);
    }

    return new Response(
      JSON.stringify({ success: true, results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
