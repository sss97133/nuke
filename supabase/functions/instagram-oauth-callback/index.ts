import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const INSTAGRAM_API_BASE = 'https://graph.instagram.com';
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
      console.error('[instagram-oauth-callback] OAuth error:', error);
      return new Response(
        `<html><body><h1>Instagram Authorization Failed</h1><p>${error}</p><p><a href="/">Return to site</a></p></body></html>`,
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
        redirect_uri: `${url.origin}/functions/v1/instagram-oauth-callback`,
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

    // Get user's Facebook Pages (Instagram Business accounts are connected to Pages)
    const pagesResponse = await fetch(
      `${FACEBOOK_API_BASE}/me/accounts?access_token=${longLivedToken}`
    );

    if (!pagesResponse.ok) {
      throw new Error('Failed to fetch Facebook Pages');
    }

    const pagesData = await pagesResponse.json();
    const pages = pagesData.data || [];

    if (pages.length === 0) {
      return new Response(
        '<html><body><h1>No Instagram Business Account Found</h1><p>Your Instagram account must be connected to a Facebook Page. Please connect it in Meta Business Suite.</p><p><a href="/">Return to site</a></p></body></html>',
        { status: 400, headers: { 'Content-Type': 'text/html' } }
      );
    }

    // Get Instagram Business Account for first page
    const page = pages[0];
    const pageAccessToken = page.access_token;

    const igAccountResponse = await fetch(
      `${FACEBOOK_API_BASE}/${page.id}?fields=instagram_business_account&access_token=${pageAccessToken}`
    );

    if (!igAccountResponse.ok) {
      throw new Error('Failed to fetch Instagram Business Account');
    }

    const igAccountData = await igAccountResponse.json();
    const igBusinessAccount = igAccountData.instagram_business_account;

    if (!igBusinessAccount) {
      return new Response(
        '<html><body><h1>No Instagram Business Account Found</h1><p>Your Facebook Page is not connected to an Instagram Business account. Please connect it in Meta Business Suite.</p><p><a href="/">Return to site</a></p></body></html>',
        { status: 400, headers: { 'Content-Type': 'text/html' } }
      );
    }

    const igAccountId = igBusinessAccount.id;

    // Get Instagram account info
    const igInfoResponse = await fetch(
      `${INSTAGRAM_API_BASE}/${igAccountId}?fields=username,profile_picture_url&access_token=${pageAccessToken}`
    );

    const igInfo = igInfoResponse.ok ? await igInfoResponse.json() : { username: 'unknown' };
    const instagramHandle = igInfo.username || 'unknown';

    // Store or update external identity
    const { data: existingIdentity, error: identityError } = await supabase
      .from('external_identities')
      .select('id')
      .eq('platform', 'instagram')
      .eq('handle', instagramHandle.toLowerCase())
      .maybeSingle();

    let externalIdentityId: string;

    if (existingIdentity) {
      // Update existing
      const { data: updated, error: updateError } = await supabase
        .from('external_identities')
        .update({
          profile_url: `https://www.instagram.com/${instagramHandle}/`,
          display_name: instagramHandle,
          claimed_by_user_id: stateData.user_id,
          claimed_at: new Date().toISOString(),
          claim_confidence: 100,
          metadata: {
            instagram_account_id: igAccountId,
            facebook_page_id: page.id,
            access_token: longLivedToken, // TODO: Encrypt this
            token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
            organization_id: stateData.organization_id
          },
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', existingIdentity.id)
        .select('id')
        .single();

      if (updateError) throw updateError;
      externalIdentityId = updated.id;
    } else {
      // Create new
      const { data: created, error: createError } = await supabase
        .from('external_identities')
        .insert({
          platform: 'instagram',
          handle: instagramHandle.toLowerCase(),
          profile_url: `https://www.instagram.com/${instagramHandle}/`,
          display_name: instagramHandle,
          claimed_by_user_id: stateData.user_id,
          claimed_at: new Date().toISOString(),
          claim_confidence: 100,
          metadata: {
            instagram_account_id: igAccountId,
            facebook_page_id: page.id,
            access_token: longLivedToken, // TODO: Encrypt this
            token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
            organization_id: stateData.organization_id
          }
        })
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

    // Store access token in environment variable for sync functions
    // Note: In production, you'd want to store this encrypted in a vault
    // For now, we'll store it in external_identities.metadata

    // Redirect to success page
    const redirectUrl = stateData.organization_id
      ? `${url.origin}/org/${stateData.organization_id}?instagram_connected=true`
      : `${url.origin}/settings?instagram_connected=true`;

    return new Response(null, {
      status: 302,
      headers: { 'Location': redirectUrl }
    });
  } catch (error: any) {
    console.error('[instagram-oauth-callback] Error:', error);
    return new Response(
      `<html><body><h1>Error</h1><p>${error.message}</p><p><a href="/">Return to site</a></p></body></html>`,
      { status: 500, headers: { 'Content-Type': 'text/html' } }
    );
  }
});

