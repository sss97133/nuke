import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TWITCH_AUTH_BASE = 'https://id.twitch.tv/oauth2';
const TWITCH_API_BASE = 'https://api.twitch.tv/helix';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    if (error) {
      console.error('[twitch-oauth-callback] OAuth error:', error);
      return new Response(
        `<html><body><h1>Twitch Authorization Failed</h1><p>${error}</p><p><a href="/">Return to site</a></p></body></html>`,
        { status: 400, headers: { 'Content-Type': 'text/html' } }
      );
    }

    if (!code || !state) {
      return new Response(
        '<html><body><h1>Missing Authorization Code</h1><p>Please try connecting again.</p><p><a href="/">Return to site</a></p></body></html>',
        { status: 400, headers: { 'Content-Type': 'text/html' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: stateData, error: stateError } = await supabase
      .from('oauth_state_tracker')
      .select('user_id, organization_id, metadata')
      .eq('state', state)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (stateError || !stateData) {
      return new Response(
        '<html><body><h1>Invalid or Expired Request</h1><p>Please try connecting again.</p><p><a href="/">Return to site</a></p></body></html>',
        { status: 403, headers: { 'Content-Type': 'text/html' } }
      );
    }

    const TWITCH_CLIENT_ID = Deno.env.get('TWITCH_CLIENT_ID');
    const TWITCH_CLIENT_SECRET = Deno.env.get('TWITCH_CLIENT_SECRET');
    if (!TWITCH_CLIENT_ID || !TWITCH_CLIENT_SECRET) {
      throw new Error('Twitch App credentials not configured');
    }

    const tokenResponse = await fetch(`${TWITCH_AUTH_BASE}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: TWITCH_CLIENT_ID,
        client_secret: TWITCH_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: `${url.origin}/functions/v1/twitch-oauth-callback`
      })
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      throw new Error(`Token exchange failed: ${errorText}`);
    }

    const tokens = await tokenResponse.json();
    const accessToken = tokens.access_token;
    const refreshToken = tokens.refresh_token;
    const expiresIn = tokens.expires_in || 0;
    const tokenType = tokens.token_type || 'bearer';
    const scope = Array.isArray(tokens.scope)
      ? tokens.scope
      : typeof tokens.scope === 'string'
        ? tokens.scope.split(' ')
        : [];

    const profileResponse = await fetch(`${TWITCH_API_BASE}/users`, {
      headers: {
        'Client-Id': TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!profileResponse.ok) {
      const errorText = await profileResponse.text();
      throw new Error(`Failed to fetch Twitch user: ${errorText}`);
    }

    const profileData = await profileResponse.json();
    const user = Array.isArray(profileData?.data) ? profileData.data[0] : null;

    if (!user) {
      throw new Error('No Twitch user data returned');
    }

    const handle = String(user.login || user.id).toLowerCase();
    const displayName = user.display_name || user.login || 'Twitch User';
    const profileUrl = `https://www.twitch.tv/${user.login || user.id}`;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    const { data: existingIdentity } = await supabase
      .from('external_identities')
      .select('id')
      .eq('platform', 'twitch')
      .eq('handle', handle)
      .maybeSingle();

    const identityData = {
      platform: 'twitch',
      handle,
      profile_url: profileUrl,
      display_name: displayName,
      claimed_by_user_id: stateData.user_id,
      claimed_at: new Date().toISOString(),
      claim_confidence: 100,
      metadata: {
        twitch_user_id: user.id,
        login: user.login,
        display_name: displayName,
        profile_image_url: user.profile_image_url,
        email: user.email || null,
        organization_id: stateData.organization_id || null,
        token_expires_at: expiresAt
      },
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    let externalIdentityId: string;

    if (existingIdentity) {
      const { data: updated, error: updateError } = await supabase
        .from('external_identities')
        .update(identityData)
        .eq('id', existingIdentity.id)
        .select('id')
        .single();

      if (updateError) throw updateError;
      externalIdentityId = updated.id;
    } else {
      const { data: created, error: createError } = await supabase
        .from('external_identities')
        .insert(identityData)
        .select('id')
        .single();

      if (createError) throw createError;
      externalIdentityId = created.id;
    }

    await supabase
      .from('external_identity_tokens')
      .upsert({
        external_identity_id: externalIdentityId,
        access_token: accessToken,
        refresh_token: refreshToken,
        token_expires_at: expiresAt,
        scope,
        token_type: tokenType,
        updated_at: new Date().toISOString()
      }, { onConflict: 'external_identity_id' });

    await supabase
      .from('oauth_state_tracker')
      .delete()
      .eq('state', state);

    const redirectFromState = stateData.metadata?.redirect_url ? String(stateData.metadata.redirect_url) : null;
    const vehicleId = stateData.metadata?.vehicle_id ? String(stateData.metadata.vehicle_id) : null;
    const redirectUrl = redirectFromState
      || (vehicleId ? `/vehicles/${vehicleId}?twitch_connected=true` : '/settings?twitch_connected=true');

    return new Response(
      `<html>
        <head>
          <meta http-equiv="refresh" content="0;url=${redirectUrl}">
          <script>window.location.href = '${redirectUrl}';</script>
        </head>
        <body>
          <p>Twitch connected successfully! <a href="${redirectUrl}">Click here if you're not redirected.</a></p>
        </body>
      </html>`,
      { status: 200, headers: { 'Content-Type': 'text/html' } }
    );
  } catch (error: any) {
    console.error('[twitch-oauth-callback] Error:', error);
    return new Response(
      `<html><body><h1>Error</h1><p>${error.message}</p><p><a href="/">Return to site</a></p></body></html>`,
      { status: 500, headers: { 'Content-Type': 'text/html' } }
    );
  }
});
