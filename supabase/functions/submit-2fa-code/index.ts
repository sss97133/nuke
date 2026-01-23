// Edge Function: submit-2fa-code
// Submits a 2FA code to complete platform authentication

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

// AES-256-GCM decryption
async function decrypt(
  ciphertext: Uint8Array,
  iv: Uint8Array,
  tag: Uint8Array,
  keyBase64: string
): Promise<string> {
  const keyBytes = Uint8Array.from(atob(keyBase64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);

  const combined = new Uint8Array(ciphertext.length + tag.length);
  combined.set(ciphertext);
  combined.set(tag, ciphertext.length);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    key,
    combined
  );

  return new TextDecoder().decode(decrypted);
}

function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.replace(/^\\x/i, '');
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = parseInt(cleanHex.substr(i, 2), 16);
  }
  return bytes;
}

// Submit 2FA code to BaT
async function submitBat2FACode(
  code: string,
  cookies: Record<string, string>
): Promise<{ success: boolean; error?: string; session_cookies?: Record<string, string> }> {
  const formData = new URLSearchParams({
    authcode: code,
    'wp-submit': 'Authenticate',
  });

  const cookieString = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

  try {
    const response = await fetch('https://bringatrailer.com/wp-login.php?action=validate_2fa', {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookieString,
      },
      body: formData,
      redirect: 'manual',
    });

    const setCookieHeaders = response.headers.getSetCookie?.() || [];
    const newCookies: Record<string, string> = { ...cookies };

    for (const cookieStr of setCookieHeaders) {
      const [cookiePart] = cookieStr.split(';');
      const [name, value] = cookiePart.split('=');
      if (name && value) {
        newCookies[name.trim()] = value.trim();
      }
    }

    const hasSessionCookie = Object.keys(newCookies).some((name) =>
      name.startsWith('wordpress_logged_in_')
    );

    if (response.status >= 300 && response.status < 400 && hasSessionCookie) {
      return { success: true, session_cookies: newCookies };
    }

    if (response.status === 200) {
      const body = await response.text();
      if (body.includes('invalid') || body.includes('incorrect')) {
        return { success: false, error: 'Invalid code' };
      }
    }

    return { success: false, error: '2FA verification failed' };
  } catch (error) {
    console.error('BaT 2FA error:', error);
    return { success: false, error: error.message || 'Network error' };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const encryptionKey = Deno.env.get('CREDENTIAL_ENCRYPTION_KEY');

    if (!encryptionKey) {
      throw new Error('CREDENTIAL_ENCRYPTION_KEY not configured');
    }

    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: {
        headers: authHeader ? { Authorization: authHeader } : {},
      },
    });

    const { request_id, code } = await req.json();

    if (!request_id || !code) {
      return new Response(
        JSON.stringify({ success: false, error: 'request_id and code required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get the 2FA request
    const { data: tfaRequest, error: tfaError } = await supabase
      .from('pending_2fa_requests')
      .select('*, platform_credentials(*)')
      .eq('id', request_id)
      .single();

    if (tfaError || !tfaRequest) {
      return new Response(
        JSON.stringify({ success: false, error: '2FA request not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if expired
    if (new Date(tfaRequest.expires_at) < new Date()) {
      await supabase
        .from('pending_2fa_requests')
        .update({ status: 'expired' })
        .eq('id', request_id);

      return new Response(
        JSON.stringify({ success: false, error: 'Code expired. Please try logging in again.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify user owns this request
    if (authHeader) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user && user.id !== tfaRequest.platform_credentials.user_id) {
        return new Response(
          JSON.stringify({ success: false, error: 'Unauthorized' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    const credential = tfaRequest.platform_credentials;
    let result: { success: boolean; error?: string; session_cookies?: Record<string, string> };

    // For now, we need to re-authenticate with the 2FA code
    // In a production system, you'd maintain the partial session
    switch (credential.platform) {
      case 'bat':
        // Re-login and then submit 2FA
        // Note: This is a simplified flow. Production would maintain session state.
        result = await submitBat2FACode(code, {});
        break;
      default:
        result = { success: false, error: `Platform ${credential.platform} not supported` };
    }

    // Update request status
    await supabase
      .from('pending_2fa_requests')
      .update({
        user_code: code,
        submitted_at: new Date().toISOString(),
        status: result.success ? 'verified' : 'failed',
      })
      .eq('id', request_id);

    // Update credential status
    if (result.success) {
      await supabase
        .from('platform_credentials')
        .update({
          status: 'active',
          validation_error: null,
          last_validated_at: new Date().toISOString(),
        })
        .eq('id', credential.id);

      // Log success
      await supabase.from('credential_access_log').insert({
        credential_id: credential.id,
        user_id: credential.user_id,
        action: '2fa_completed',
        platform: credential.platform,
        success: true,
      });
    }

    return new Response(
      JSON.stringify({
        success: result.success,
        error: result.error,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('2FA submission error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
