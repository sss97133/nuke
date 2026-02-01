import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BAT_ORG_ID = '222375e1-901e-4a2c-a254-4e412f0e2a56';
const CAB_ORG_ID = 'c124e282-a99c-4c9a-971d-65a0ddc03224';
const PCM_ORG_ID = 'd3bd67bb-0c19-4304-8a6b-89d384328eac';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { action, offset = 0 } = await req.json();

    if (action === 'link_bat_vehicles') {
      // Get batch of BaT vehicles with pagination
      const { data: vehicles, error: fetchError } = await supabase
        .from('vehicles')
        .select('id')
        .ilike('discovery_url', '%bringatrailer%')
        .range(offset, offset + 999)
        .order('created_at', { ascending: true });

      if (fetchError) {
        return new Response(
          JSON.stringify({ error: fetchError.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!vehicles || vehicles.length === 0) {
        return new Response(
          JSON.stringify({ success: true, linked: 0, message: 'No more vehicles at this offset' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Get linked IDs for this batch
      const vehicleIds = vehicles.map(v => v.id);
      const { data: existingLinks } = await supabase
        .from('organization_vehicles')
        .select('vehicle_id')
        .eq('organization_id', BAT_ORG_ID)
        .in('vehicle_id', vehicleIds);

      const linkedIds = new Set((existingLinks || []).map(l => l.vehicle_id));
      const toLink = vehicles.filter(v => !linkedIds.has(v.id));

      // Insert one at a time - limit to 20 to avoid timeout
      let linked = 0;
      let errors: string[] = [];

      for (const vehicle of toLink.slice(0, 20)) {
        const { error: insertError } = await supabase
          .from('organization_vehicles')
          .insert({
            organization_id: BAT_ORG_ID,
            vehicle_id: vehicle.id,
            relationship_type: 'sold_by',
            auto_tagged: true,
          });

        if (!insertError) {
          linked++;
        } else if (errors.length < 3) {
          errors.push(insertError.message.slice(0, 50));
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          linked,
          batch_size: vehicles.length,
          already_linked: linkedIds.size,
          next_offset: offset + 1000,
          errors: errors.length > 0 ? errors : undefined
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'fix_titles') {
      // Get vehicles with null titles but valid year/make/model - smaller batch
      const { data: vehicles, error } = await supabase
        .from('vehicles')
        .select('id, year, make, model')
        .is('title', null)
        .not('year', 'is', null)
        .limit(100);

      if (error) {
        return new Response(
          JSON.stringify({ error: error.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      let updated = 0;
      for (const v of (vehicles || [])) {
        const title = [v.year, v.make, v.model].filter(Boolean).join(' ');
        if (title) {
          await supabase.from('vehicles').update({ title }).eq('id', v.id);
          updated++;
        }
      }

      return new Response(
        JSON.stringify({ success: true, updated }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'status') {
      // Get counts
      const { count: batTotal } = await supabase
        .from('vehicles')
        .select('*', { count: 'exact', head: true })
        .ilike('discovery_url', '%bringatrailer%');

      const { count: batLinked } = await supabase
        .from('organization_vehicles')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', BAT_ORG_ID);

      const { count: nullTitles } = await supabase
        .from('vehicles')
        .select('*', { count: 'exact', head: true })
        .is('title', null);

      return new Response(
        JSON.stringify({
          bat: { total: batTotal, linked: batLinked, unlinked: (batTotal || 0) - (batLinked || 0) },
          null_titles: nullTitles
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Unknown action. Use: link_bat_vehicles, fix_titles, status' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (e) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
