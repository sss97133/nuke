import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AuthUrlRequest {
  user_id: string;
  vehicle_id?: string;
  organization_id?: string;
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
    const { user_id, vehicle_id, organization_id } = request;

    if (!user_id) {
      throw new Error('user_id is required');
    }

    const FACEBOOK_APP_ID = Deno.env.get('FACEBOOK_APP_ID');
    if (!FACEBOOK_APP_ID) {
      throw new Error('FACEBOOK_APP_ID not configured');
    }

    // Generate state token for CSRF protection
    const state = crypto.randomUUID();

    // Store state in database
    const { error: stateError } = await supabase
      .from('oauth_state_tracker')
      .insert({
        user_id: user_id,
        organization_id: organization_id || null,
        state: state,
        platform: 'facebook',
        metadata: vehicle_id ? { vehicle_id } : null,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10 minutes
      });

    if (stateError) {
      throw new Error(`Failed to store state: ${stateError.message}`);
    }

    // Build Facebook OAuth URL
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const callbackUrl = `${supabaseUrl}/functions/v1/facebook-oauth-callback`;

    const authUrl = new URL('https://www.facebook.com/v18.0/dialog/oauth');
    authUrl.searchParams.set('client_id', FACEBOOK_APP_ID);
    authUrl.searchParams.set('redirect_uri', callbackUrl);
    authUrl.searchParams.set('state', state);
    // Facebook permissions for user_videos, user_posts, user_photos, user_location, etc.
    authUrl.searchParams.set('scope', 'public_profile,email,user_videos,user_posts,user_photos,user_location');

    return new Response(
      JSON.stringify({
        auth_url: authUrl.toString(),
        callback_url: callbackUrl
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('[get-facebook-auth-url] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
