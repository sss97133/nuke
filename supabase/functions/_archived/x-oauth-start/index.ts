/**
 * X OAuth Start
 *
 * Initiates the OAuth 2.0 flow with PKCE for X (Twitter).
 * Returns the authorization URL to redirect the user to.
 *
 * Usage:
 *   POST /x-oauth-start
 *   {
 *     "user_id": "uuid",
 *     "redirect_after": "/settings"  // Where to go after success
 *   }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encode as base64encode } from 'https://deno.land/std@0.168.0/encoding/base64.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { user_id, redirect_after, organization_id } = body;

    if (!user_id) {
      return new Response(
        JSON.stringify({ error: 'user_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const X_CLIENT_ID = Deno.env.get('X_CLIENT_ID');
    if (!X_CLIENT_ID) {
      return new Response(
        JSON.stringify({ error: 'X API not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Generate PKCE challenge
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);

    // Generate state for CSRF protection
    const state = crypto.randomUUID();

    // Store state and code_verifier
    const { error: stateError } = await supabase
      .from('oauth_state_tracker')
      .insert({
        state,
        user_id,
        organization_id,
        platform: 'x',
        metadata: {
          code_verifier: codeVerifier,
          redirect_after
        },
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10 min
      });

    if (stateError) {
      throw new Error(`Failed to store OAuth state: ${stateError.message}`);
    }

    // Build authorization URL
    const redirectUri = `${Deno.env.get('SUPABASE_URL')}/functions/v1/x-oauth-callback`;

    // X OAuth 2.0 scopes
    // tweet.read - Read tweets
    // tweet.write - Post and delete tweets
    // users.read - Read user profile
    // offline.access - Get refresh token
    const scopes = [
      'tweet.read',
      'tweet.write',
      'users.read',
      'offline.access'
    ].join(' ');

    const authUrl = new URL('https://twitter.com/i/oauth2/authorize');
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', X_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', scopes);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    console.log(`[x-oauth-start] Generated auth URL for user ${user_id}`);

    return new Response(
      JSON.stringify({
        authorization_url: authUrl.toString(),
        state
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[x-oauth-start] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64URLEncode(array);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return base64URLEncode(new Uint8Array(hash));
}

function base64URLEncode(buffer: Uint8Array): string {
  const base64 = base64encode(buffer);
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
