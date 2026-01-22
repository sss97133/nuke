import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AuthUrlRequest {
  user_id: string;
  organization_id?: string;
  vehicle_id?: string;
  redirect_url?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const request: AuthUrlRequest = await req.json();
    const { user_id, organization_id, vehicle_id, redirect_url } = request;

    if (!user_id) {
      throw new Error('user_id is required');
    }

    const TWITCH_CLIENT_ID = Deno.env.get('TWITCH_CLIENT_ID');
    if (!TWITCH_CLIENT_ID) {
      throw new Error('TWITCH_CLIENT_ID not configured');
    }

    const state = crypto.randomUUID();

    const { error: stateError } = await supabase
      .from('oauth_state_tracker')
      .insert({
        user_id,
        organization_id: organization_id || null,
        state,
        platform: 'twitch',
        metadata: {
          vehicle_id: vehicle_id || null,
          redirect_url: redirect_url || null
        },
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
      });

    if (stateError) {
      throw new Error(`Failed to store state: ${stateError.message}`);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const callbackUrl = `${supabaseUrl}/functions/v1/twitch-oauth-callback`;

    const authUrl = new URL('https://id.twitch.tv/oauth2/authorize');
    authUrl.searchParams.set('client_id', TWITCH_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', callbackUrl);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'user:read:email');
    authUrl.searchParams.set('state', state);

    return new Response(
      JSON.stringify({
        auth_url: authUrl.toString(),
        callback_url: callbackUrl
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('[get-twitch-auth-url] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
