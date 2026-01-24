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

    const results: Record<string, any> = {};

    // Canonical org IDs (matching the organizations table)
    const CANONICAL_IDS = {
      pcarmarket: '2a2494ae-cc22-4300-accb-24ed9a054663',
      carsandbids: '4dac1878-b3fc-424c-9e92-3cf552f1e053',
      bringatrailer: 'd2bd6370-11d1-4af0-8dd2-3de2c3899166',
      sbxcars: 'a35b59b1-0e64-437c-953d-24a6f5bb17c6',
    };

    // Old duplicate IDs to migrate FROM
    const MIGRATIONS = [
      // PCarMarket
      { from: 'd3bd67bb-0c19-4304-8a6b-89d384328eac', to: CANONICAL_IDS.pcarmarket, name: 'PCarMarket-1' },
      { from: 'f7c80592-6725-448d-9b32-2abf3e011cf8', to: CANONICAL_IDS.pcarmarket, name: 'PCarMarket-2' },
      // Cars and Bids
      { from: 'c124e282-a99c-4c9a-971d-65a0ddc03224', to: CANONICAL_IDS.carsandbids, name: 'CarsAndBids-1' },
      { from: '822cae29-f80e-4859-9c48-a1485a543152', to: CANONICAL_IDS.carsandbids, name: 'CarsAndBids-2' },
      // Bring a Trailer
      { from: '222375e1-901e-4a2c-a254-4e412f0e2a56', to: CANONICAL_IDS.bringatrailer, name: 'BaT-1' },
      { from: '3c0c5a1e-4836-430b-822d-585c70ad6dc1', to: CANONICAL_IDS.bringatrailer, name: 'BaT-2' },
      { from: '04ded0e8-e31e-4200-bf91-ed5f4fc6af4b', to: CANONICAL_IDS.bringatrailer, name: 'BaT-3' },
      { from: '93dfd8f8-0eaf-4fd1-b47a-24d5a8fd7965', to: CANONICAL_IDS.bringatrailer, name: 'BaT-4' },
      { from: 'bd035ea4-75f0-4b17-ad02-aee06283343f', to: CANONICAL_IDS.bringatrailer, name: 'BaT-5' },
      { from: 'e1f3c01f-e5e9-47b1-add6-9f7359ba0857', to: CANONICAL_IDS.bringatrailer, name: 'BaT-6' },
      // SBX Cars
      { from: '37b84b5e-ee28-410a-bea5-8d4851e39525', to: CANONICAL_IDS.sbxcars, name: 'SBX-1' },
      { from: '23a897dc-7fb3-4464-bae3-2f92e801abb2', to: CANONICAL_IDS.sbxcars, name: 'SBX-2' },
    ];

    // Perform migrations
    for (const migration of MIGRATIONS) {
      // Count first
      const { count: beforeCount, error: countError } = await supabase
        .from('organization_vehicles')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', migration.from);

      console.log(`[${migration.name}] beforeCount: ${beforeCount}, error: ${JSON.stringify(countError)}`);

      if ((beforeCount ?? 0) > 0) {
        // Update in batches of 500
        let totalMigrated = 0;
        while (true) {
          const { data: batch } = await supabase
            .from('organization_vehicles')
            .select('id')
            .eq('organization_id', migration.from)
            .limit(500);

          if (!batch || batch.length === 0) break;

          const ids = batch.map(r => r.id);
          const { error } = await supabase
            .from('organization_vehicles')
            .update({ organization_id: migration.to })
            .in('id', ids);

          if (error) {
            console.error(`Migration error for ${migration.name}:`, error);
            break;
          }

          totalMigrated += ids.length;
          console.log(`[${migration.name}] Migrated ${totalMigrated}/${beforeCount}`);
        }

        results[migration.name] = { from: migration.from, to: migration.to, count: totalMigrated };
      } else {
        results[migration.name] = { from: migration.from, to: migration.to, count: 0, note: 'already migrated' };
      }
    }

    // Final counts
    const finalCounts: Record<string, number> = {};
    for (const [name, id] of Object.entries(CANONICAL_IDS)) {
      const { count } = await supabase
        .from('organization_vehicles')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', id);
      finalCounts[name] = count || 0;
    }

    return new Response(
      JSON.stringify({
        success: true,
        migrations: results,
        final_counts: finalCounts,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Migration error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
