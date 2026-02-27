/**
 * QuickBooks OAuth Callback
 * Clean redirect URI endpoint (no query params — Intuit requires this)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const QUICKBOOKS_CLIENT_ID = Deno.env.get('QUICKBOOKS_CLIENT_ID')!;
const QUICKBOOKS_CLIENT_SECRET = Deno.env.get('QUICKBOOKS_CLIENT_SECRET')!;
const QUICKBOOKS_REDIRECT_URI = 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/quickbooks-callback';
const QB_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const realmId = url.searchParams.get('realmId');
  const error = url.searchParams.get('error');

  if (error) {
    return new Response(`<html><body><h2>QuickBooks connection failed</h2><p>${error}</p></body></html>`, {
      status: 400,
      headers: { 'Content-Type': 'text/html' },
    });
  }

  if (!code || !realmId) {
    return new Response('<html><body><h2>Missing code or realmId</h2></body></html>', {
      status: 400,
      headers: { 'Content-Type': 'text/html' },
    });
  }

  // Exchange code for tokens
  const tokenResponse = await fetch(QB_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${btoa(`${QUICKBOOKS_CLIENT_ID}:${QUICKBOOKS_CLIENT_SECRET}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: QUICKBOOKS_REDIRECT_URI,
    }),
  });

  const tokens = await tokenResponse.json();

  if (tokens.error) {
    return new Response(`<html><body><h2>Token exchange failed</h2><p>${tokens.error_description || tokens.error}</p></body></html>`, {
      status: 400,
      headers: { 'Content-Type': 'text/html' },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  await supabase
    .from('parent_company')
    .update({
      quickbooks_realm_id: realmId,
      quickbooks_access_token: tokens.access_token,
      quickbooks_refresh_token: tokens.refresh_token,
      quickbooks_token_expires_at: expiresAt.toISOString(),
      quickbooks_connected_at: new Date().toISOString(),
    })
    .eq('legal_name', 'NUKE LTD');

  return new Response(`<html><body><h2>✅ QuickBooks connected successfully</h2><p>Realm ID: ${realmId}</p><p>You can close this tab.</p></body></html>`, {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  });
});
