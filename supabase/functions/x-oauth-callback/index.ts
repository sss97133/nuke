/**
 * X (Twitter) OAuth 2.0 Callback
 *
 * Handles the OAuth callback from X, exchanges code for tokens,
 * and stores credentials for automated posting.
 *
 * X API v2 uses OAuth 2.0 with PKCE
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const X_API_BASE = 'https://api.twitter.com/2';

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
      console.error('[x-oauth-callback] OAuth error:', error);
      return new Response(
        `<html><body><h1>X Authorization Failed</h1><p>${error}</p><p><a href="/">Return to site</a></p></body></html>`,
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

    // Verify state and get PKCE code_verifier
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

    const codeVerifier = stateData.metadata?.code_verifier;
    if (!codeVerifier) {
      throw new Error('Missing PKCE code_verifier');
    }

    const X_CLIENT_ID = Deno.env.get('X_CLIENT_ID');
    const X_CLIENT_SECRET = Deno.env.get('X_CLIENT_SECRET');

    if (!X_CLIENT_ID || !X_CLIENT_SECRET) {
      throw new Error('X API credentials not configured');
    }

    // Exchange code for access token (OAuth 2.0 with PKCE)
    const tokenResponse = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + btoa(`${X_CLIENT_ID}:${X_CLIENT_SECRET}`)
      },
      body: new URLSearchParams({
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: `${Deno.env.get('SUPABASE_URL')}/functions/v1/x-oauth-callback`,
        code_verifier: codeVerifier
      })
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      throw new Error(`Token exchange failed: ${errorText}`);
    }

    const tokens = await tokenResponse.json();
    const accessToken = tokens.access_token;
    const refreshToken = tokens.refresh_token;
    const expiresIn = tokens.expires_in || 7200; // 2 hours default

    // Get user info
    const userResponse = await fetch(`${X_API_BASE}/users/me`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!userResponse.ok) {
      throw new Error('Failed to fetch X user info');
    }

    const userData = await userResponse.json();
    const xHandle = userData.data?.username || 'unknown';
    const xUserId = userData.data?.id;

    // Store or update external identity
    const { data: existingIdentity } = await supabase
      .from('external_identities')
      .select('id')
      .eq('platform', 'x')
      .eq('handle', xHandle.toLowerCase())
      .maybeSingle();

    let externalIdentityId: string;

    const identityData = {
      platform: 'x',
      handle: xHandle.toLowerCase(),
      profile_url: `https://x.com/${xHandle}`,
      display_name: userData.data?.name || xHandle,
      claimed_by_user_id: stateData.user_id,
      claimed_at: new Date().toISOString(),
      claim_confidence: 100,
      metadata: {
        x_user_id: xUserId,
        access_token: accessToken,
        refresh_token: refreshToken,
        token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
        scopes: tokens.scope,
        organization_id: stateData.organization_id,
        auto_post_enabled: true  // Enable auto-posting by default
      },
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

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

    // Clean up state
    await supabase
      .from('oauth_state_tracker')
      .delete()
      .eq('state', state);

    console.log(`[x-oauth-callback] Successfully connected @${xHandle}`);

    // Redirect to success page
    const redirectUrl = `${url.origin}/settings?x_connected=true&handle=${xHandle}`;

    return new Response(null, {
      status: 302,
      headers: { 'Location': redirectUrl }
    });

  } catch (error: any) {
    console.error('[x-oauth-callback] Error:', error);
    return new Response(
      `<html><body><h1>Error</h1><p>${error.message}</p><p><a href="/">Return to site</a></p></body></html>`,
      { status: 500, headers: { 'Content-Type': 'text/html' } }
    );
  }
});
