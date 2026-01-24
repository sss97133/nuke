import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { action } = await req.json();

    if (action === 'fix_titles') {
      // Generate titles from year/make/model where title is null
      const { data, error } = await supabase.rpc('exec_sql', {
        query: `
          UPDATE vehicles
          SET title = CONCAT(
            COALESCE(year::text, ''), ' ',
            COALESCE(INITCAP(make), ''), ' ',
            COALESCE(INITCAP(model), '')
          )
          WHERE title IS NULL
          AND (year IS NOT NULL OR make IS NOT NULL OR model IS NOT NULL)
        `
      });

      if (error) {
        // Try direct update if exec_sql doesn't exist
        const { count, error: updateError } = await supabase
          .from('vehicles')
          .update({ title: 'PLACEHOLDER' }) // Can't do computed update via REST
          .is('title', null)
          .select('id', { count: 'exact', head: true });

        return new Response(
          JSON.stringify({
            error: 'Cannot do computed update via REST API. Need direct SQL access.',
            suggestion: 'Run this SQL manually: UPDATE vehicles SET title = CONCAT(year, \' \', INITCAP(make), \' \', INITCAP(model)) WHERE title IS NULL'
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, message: 'Titles updated' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'link_bat_vehicles') {
      const BAT_ORG_ID = '222375e1-901e-4a2c-a254-4e412f0e2a56';

      // Get unlinked BaT vehicles in batches of 100
      const { data: vehicles, error: fetchError } = await supabase
        .from('vehicles')
        .select('id')
        .ilike('discovery_url', '%bringatrailer%')
        .limit(5000);

      if (fetchError) {
        return new Response(
          JSON.stringify({ error: fetchError.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Get already linked
      const { data: linked } = await supabase
        .from('organization_vehicles')
        .select('vehicle_id')
        .eq('organization_id', BAT_ORG_ID)
        .limit(50000);

      const linkedIds = new Set((linked || []).map(l => l.vehicle_id));
      const unlinked = (vehicles || []).filter(v => !linkedIds.has(v.id));

      // Insert one at a time to avoid trigger timeout
      let total = 0;
      let errors: string[] = [];

      for (let i = 0; i < Math.min(unlinked.length, 100); i++) {
        const record = {
          organization_id: BAT_ORG_ID,
          vehicle_id: unlinked[i].id,
          relationship_type: 'sold_by',
          auto_tagged: true,
        };

        const { error: insertError } = await supabase
          .from('organization_vehicles')
          .insert(record);

        if (!insertError) {
          total++;
        } else if (errors.length < 3) {
          errors.push(insertError.message);
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          linked: total,
          remaining: unlinked.length - total,
          errors: errors.length > 0 ? errors : undefined
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Unknown action. Use: fix_titles, link_bat_vehicles' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (e) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
