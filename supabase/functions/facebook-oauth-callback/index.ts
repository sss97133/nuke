import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FACEBOOK_API_BASE = 'https://graph.facebook.com/v18.0';

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
      console.error('[facebook-oauth-callback] OAuth error:', error);
      return new Response(
        `<html><body><h1>Facebook Authorization Failed</h1><p>${error}</p><p><a href="/">Return to site</a></p></body></html>`,
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

    // Verify state (CSRF protection)
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

    const FACEBOOK_APP_ID = Deno.env.get('FACEBOOK_APP_ID');
    const FACEBOOK_APP_SECRET = Deno.env.get('FACEBOOK_APP_SECRET');

    if (!FACEBOOK_APP_ID || !FACEBOOK_APP_SECRET) {
      throw new Error('Facebook App credentials not configured');
    }

    // Exchange code for short-lived access token
    const tokenResponse = await fetch(`${FACEBOOK_API_BASE}/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: FACEBOOK_APP_ID,
        client_secret: FACEBOOK_APP_SECRET,
        grant_type: 'authorization_code',
        redirect_uri: `${url.origin}/functions/v1/facebook-oauth-callback`,
        code: code
      })
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      throw new Error(`Token exchange failed: ${errorText}`);
    }

    const tokens = await tokenResponse.json();
    const shortLivedToken = tokens.access_token;

    // Exchange short-lived token for long-lived token (60 days)
    const longLivedResponse = await fetch(
      `${FACEBOOK_API_BASE}/oauth/access_token?` +
      `grant_type=fb_exchange_token&` +
      `client_id=${FACEBOOK_APP_ID}&` +
      `client_secret=${FACEBOOK_APP_SECRET}&` +
      `fb_exchange_token=${shortLivedToken}`
    );

    if (!longLivedResponse.ok) {
      const errorText = await longLivedResponse.text();
      throw new Error(`Long-lived token exchange failed: ${errorText}`);
    }

    const longLivedTokens = await longLivedResponse.json();
    const longLivedToken = longLivedTokens.access_token;
    const expiresIn = longLivedTokens.expires_in || 5184000; // 60 days default

    // Get user's Facebook profile info
    const profileResponse = await fetch(
      `${FACEBOOK_API_BASE}/me?fields=id,name,email,link&access_token=${longLivedToken}`
    );

    if (!profileResponse.ok) {
      const errorText = await profileResponse.text();
      throw new Error(`Failed to fetch profile: ${errorText}`);
    }

    const profile = await profileResponse.json();

    // Store or update external identity
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    const { data: existingIdentity } = await supabase
      .from('external_identities')
      .select('id')
      .eq('platform', 'facebook')
      .eq('claimed_by_user_id', stateData.user_id)
      .maybeSingle();

    const identityData = {
      platform: 'facebook',
      external_id: profile.id,
      handle: profile.name?.toLowerCase().replace(/\s+/g, '') || profile.id,
      display_name: profile.name || 'Facebook User',
      profile_url: profile.link || `https://www.facebook.com/${profile.id}`,
      claimed_by_user_id: stateData.user_id,
      organization_id: stateData.organization_id || null,
      metadata: {
        access_token: longLivedToken,
        token_expires_at: expiresAt,
        email: profile.email || null,
        facebook_id: profile.id
      }
    };

    if (existingIdentity) {
      // Update existing
      const { error: updateError } = await supabase
        .from('external_identities')
        .update(identityData)
        .eq('id', existingIdentity.id);

      if (updateError) {
        throw new Error(`Failed to update identity: ${updateError.message}`);
      }
    } else {
      // Create new
      const { error: insertError } = await supabase
        .from('external_identities')
        .insert(identityData);

      if (insertError) {
        throw new Error(`Failed to create identity: ${insertError.message}`);
      }
    }

    // Clean up state
    await supabase
      .from('oauth_state_tracker')
      .delete()
      .eq('state', state);

    // Redirect back to the app
    const vehicleId = stateData.metadata?.vehicle_id;
    const redirectUrl = vehicleId 
      ? `/vehicles/${vehicleId}` 
      : '/vehicles';
    
    return new Response(
      `<html>
        <head>
          <meta http-equiv="refresh" content="0;url=${redirectUrl}">
          <script>window.location.href = '${redirectUrl}';</script>
        </head>
        <body>
          <p>Facebook connected successfully! <a href="${redirectUrl}">Click here if you're not redirected.</a></p>
        </body>
      </html>`,
      { 
        status: 200, 
        headers: { 'Content-Type': 'text/html' }
      }
    );
  } catch (error: any) {
    console.error('[facebook-oauth-callback] Error:', error);
    return new Response(
      `<html><body><h1>Error</h1><p>${error.message}</p><p><a href="/">Return to site</a></p></body></html>`,
      { status: 500, headers: { 'Content-Type': 'text/html' } }
    );
  }
});
