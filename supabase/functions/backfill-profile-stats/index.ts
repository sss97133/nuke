/**
 * Backfill Profile Stats Edge Function
 * Populates profile stats from existing BaT data
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { type, id, batch_size = 100 } = await req.json();

    if (type === 'user' && id) {
      // Backfill single user
      const { error } = await supabaseClient.rpc('backfill_user_profile_stats', {
        p_user_id: id,
      });

      if (error) throw error;

      return new Response(
        JSON.stringify({ success: true, message: `Backfilled stats for user ${id}` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (type === 'organization' && id) {
      // Backfill single organization
      const { error } = await supabaseClient.rpc('backfill_organization_profile_stats', {
        p_org_id: id,
      });

      if (error) throw error;

      return new Response(
        JSON.stringify({ success: true, message: `Backfilled stats for organization ${id}` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (type === 'all_users') {
      // Backfill all users in batches
      const { data: users, error: usersError } = await supabaseClient
        .from('profiles')
        .select('id')
        .limit(batch_size);

      if (usersError) throw usersError;

      const results = [];
      for (const user of users || []) {
        try {
          const { error } = await supabaseClient.rpc('backfill_user_profile_stats', {
            p_user_id: user.id,
          });
          if (error) {
            results.push({ user_id: user.id, error: error.message });
          } else {
            results.push({ user_id: user.id, success: true });
          }
        } catch (err) {
          results.push({ user_id: user.id, error: String(err) });
        }
      }

      return new Response(
        JSON.stringify({ success: true, processed: results.length, results }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (type === 'all_organizations') {
      // Backfill all organizations in batches
      const { data: orgs, error: orgsError } = await supabaseClient
        .from('businesses')
        .select('id')
        .limit(batch_size);

      if (orgsError) throw orgsError;

      const results = [];
      for (const org of orgs || []) {
        try {
          const { error } = await supabaseClient.rpc('backfill_organization_profile_stats', {
            p_org_id: org.id,
          });
          if (error) {
            results.push({ org_id: org.id, error: error.message });
          } else {
            results.push({ org_id: org.id, success: true });
          }
        } catch (err) {
          results.push({ org_id: org.id, error: String(err) });
        }
      }

      return new Response(
        JSON.stringify({ success: true, processed: results.length, results }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Invalid request. Use type: "user", "organization", "all_users", or "all_organizations"' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

