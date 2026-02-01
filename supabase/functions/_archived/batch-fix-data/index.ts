import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BAT_ORG_ID = '222375e1-901e-4a2c-a254-4e412f0e2a56';
const CAB_ORG_ID = 'c124e282-a99c-4c9a-971d-65a0ddc03224';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { action, batch_size = 100 } = await req.json();

    if (action === 'fix_all') {
      const results = {
        titles_fixed: 0,
        bat_linked: 0,
        cab_linked: 0,
        errors: [] as string[],
      };

      // Fix titles in batches
      for (let i = 0; i < 10; i++) {
        const { data: vehicles } = await supabase
          .from('vehicles')
          .select('id, year, make, model')
          .is('title', null)
          .not('year', 'is', null)
          .limit(batch_size);

        if (!vehicles || vehicles.length === 0) break;

        for (const v of vehicles) {
          const title = [v.year, v.make, v.model].filter(Boolean).join(' ');
          if (title) {
            await supabase.from('vehicles').update({ title }).eq('id', v.id);
            results.titles_fixed++;
          }
        }
      }

      // Link BaT vehicles - get unlinked ones
      const { data: batVehicles } = await supabase
        .from('vehicles')
        .select('id')
        .ilike('discovery_url', '%bringatrailer%')
        .limit(batch_size);

      if (batVehicles) {
        const vehicleIds = batVehicles.map(v => v.id);
        const { data: existingLinks } = await supabase
          .from('organization_vehicles')
          .select('vehicle_id')
          .eq('organization_id', BAT_ORG_ID)
          .in('vehicle_id', vehicleIds);

        const linkedIds = new Set((existingLinks || []).map(l => l.vehicle_id));
        const toLink = batVehicles.filter(v => !linkedIds.has(v.id));

        for (const v of toLink.slice(0, 50)) {
          const { error } = await supabase.from('organization_vehicles').insert({
            organization_id: BAT_ORG_ID,
            vehicle_id: v.id,
            relationship_type: 'sold_by',
            auto_tagged: true,
          });
          if (!error) results.bat_linked++;
          else if (results.errors.length < 3) results.errors.push(error.message.slice(0, 50));
        }
      }

      // Link C&B vehicles
      const { data: cabVehicles } = await supabase
        .from('vehicles')
        .select('id')
        .ilike('discovery_url', '%carsandbids%')
        .limit(batch_size);

      if (cabVehicles) {
        const vehicleIds = cabVehicles.map(v => v.id);
        const { data: existingLinks } = await supabase
          .from('organization_vehicles')
          .select('vehicle_id')
          .eq('organization_id', CAB_ORG_ID)
          .in('vehicle_id', vehicleIds);

        const linkedIds = new Set((existingLinks || []).map(l => l.vehicle_id));
        const toLink = cabVehicles.filter(v => !linkedIds.has(v.id));

        for (const v of toLink.slice(0, 50)) {
          const { error } = await supabase.from('organization_vehicles').insert({
            organization_id: CAB_ORG_ID,
            vehicle_id: v.id,
            relationship_type: 'sold_by',
            auto_tagged: true,
          });
          if (!error) results.cab_linked++;
          else if (results.errors.length < 3) results.errors.push(error.message.slice(0, 50));
        }
      }

      return new Response(
        JSON.stringify({ success: true, ...results }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Unknown action. Use: fix_all' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (e) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
