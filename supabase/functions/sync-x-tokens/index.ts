/**
 * Sync X Tokens
 *
 * After OAuth via Supabase linkIdentity, sync the tokens
 * from auth.identities to our external_identities table.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'No authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create client with user's token to get their identity
    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Could not get user', details: userError?.message }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Find Twitter identity in the user's identities
    const twitterIdentity = user.identities?.find(i => i.provider === 'twitter');
    if (!twitterIdentity) {
      return new Response(
        JSON.stringify({ error: 'No Twitter identity linked', identities: user.identities?.map(i => i.provider) }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract tokens from identity_data
    const identityData = twitterIdentity.identity_data || {};

    // The tokens might be in different places depending on Supabase version
    // Check common locations
    const accessToken = identityData.access_token ||
                       identityData.provider_token ||
                       (twitterIdentity as any).access_token;

    const refreshToken = identityData.refresh_token ||
                        identityData.provider_refresh_token ||
                        (twitterIdentity as any).refresh_token;

    if (!accessToken) {
      return new Response(
        JSON.stringify({
          error: 'No access token found in identity',
          identity_data_keys: Object.keys(identityData),
          identity_keys: Object.keys(twitterIdentity)
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Now update our external_identities table
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const handle = identityData.preferred_username ||
                  identityData.user_name ||
                  identityData.name ||
                  twitterIdentity.id;

    // Upsert external identity
    const { data: existing } = await supabaseAdmin
      .from('external_identities')
      .select('id, metadata')
      .eq('platform', 'x')
      .eq('claimed_by_user_id', user.id)
      .maybeSingle();

    const newMetadata = {
      ...(existing?.metadata || {}),
      access_token: accessToken,
      refresh_token: refreshToken,
      x_user_id: twitterIdentity.id,
      token_expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // 2 hours
      auto_post_enabled: existing?.metadata?.auto_post_enabled ?? true
    };

    if (existing) {
      await supabaseAdmin
        .from('external_identities')
        .update({
          metadata: newMetadata,
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id);
    } else {
      await supabaseAdmin
        .from('external_identities')
        .insert({
          platform: 'x',
          handle: handle,
          claimed_by_user_id: user.id,
          metadata: newMetadata
        });
    }

    return new Response(
      JSON.stringify({
        success: true,
        handle,
        has_access_token: !!accessToken,
        has_refresh_token: !!refreshToken
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[sync-x-tokens] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
