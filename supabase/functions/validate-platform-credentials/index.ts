// Edge Function: validate-platform-credentials
// Validates platform credentials by attempting to login
// Called immediately after credentials are stored

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// AES-256-GCM decryption
async function decrypt(
  ciphertext: Uint8Array,
  iv: Uint8Array,
  tag: Uint8Array,
  keyBase64: string
): Promise<string> {
  const keyBytes = Uint8Array.from(atob(keyBase64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  // Concatenate ciphertext and tag for Web Crypto API
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
  // Remove \x prefix if present (Postgres BYTEA format)
  const cleanHex = hex.replace(/^\\x/i, '');
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = parseInt(cleanHex.substr(i, 2), 16);
  }
  return bytes;
}

// Platform-specific login implementations
async function validateBatCredentials(username: string, password: string): Promise<{
  success: boolean;
  error?: string;
  requires_2fa?: boolean;
  session_cookies?: Record<string, string>;
}> {
  const loginUrl = 'https://bringatrailer.com/wp-login.php';
  const baseUrl = 'https://bringatrailer.com';

  const formData = new URLSearchParams({
    log: username,
    pwd: password,
    'wp-submit': 'Log In',
    redirect_to: baseUrl,
    testcookie: '1',
  });

  try {
    const response = await fetch(loginUrl, {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        Origin: baseUrl,
        Referer: `${baseUrl}/wp-login.php`,
      },
      body: formData,
      redirect: 'manual',
    });

    const setCookieHeaders = response.headers.getSetCookie?.() || [];
    const cookies: Record<string, string> = {};

    for (const cookieStr of setCookieHeaders) {
      const [cookiePart] = cookieStr.split(';');
      const [name, value] = cookiePart.split('=');
      if (name && value) {
        cookies[name.trim()] = value.trim();
      }
    }

    // Check for WordPress session cookie (indicates successful login)
    const hasSessionCookie = Object.keys(cookies).some((name) =>
      name.startsWith('wordpress_logged_in_')
    );

    if (response.status >= 300 && response.status < 400 && hasSessionCookie) {
      // Successful login - got redirect with session cookie
      return { success: true, session_cookies: cookies };
    }

    if (response.status === 200) {
      // Stayed on login page - either invalid credentials or 2FA required
      const body = await response.text();

      if (body.includes('two-factor') || body.includes('2fa') || body.includes('Two-Factor')) {
        return { success: false, requires_2fa: true, error: '2FA required' };
      }

      if (body.includes('incorrect') || body.includes('Invalid') || body.includes('ERROR')) {
        return { success: false, error: 'Invalid username or password' };
      }

      return { success: false, error: 'Login failed - unexpected response' };
    }

    return { success: false, error: `Unexpected status: ${response.status}` };
  } catch (error) {
    console.error('BaT login error:', error);
    return { success: false, error: error.message || 'Network error' };
  }
}

async function validateCarsAndBidsCredentials(
  username: string,
  password: string
): Promise<{ success: boolean; error?: string; requires_2fa?: boolean }> {
  // Cars & Bids uses Google OAuth primarily, but also has email/password
  // For now, mark as needing manual validation
  return { success: false, error: 'Cars & Bids validation not yet implemented' };
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

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { credential_id } = await req.json();

    if (!credential_id) {
      return new Response(
        JSON.stringify({ error: 'credential_id required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get the credential record
    const { data: credential, error: fetchError } = await supabase
      .from('platform_credentials')
      .select('*')
      .eq('id', credential_id)
      .single();

    if (fetchError || !credential) {
      return new Response(
        JSON.stringify({ error: 'Credential not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update status to validating
    await supabase
      .from('platform_credentials')
      .update({ status: 'validating' })
      .eq('id', credential_id);

    // Decrypt credentials
    let decryptedCredentials: { username: string; password: string };
    try {
      const ciphertext = hexToBytes(credential.encrypted_credentials);
      const iv = hexToBytes(credential.encryption_iv);
      const tag = hexToBytes(credential.encryption_tag);

      const decryptedJson = await decrypt(ciphertext, iv, tag, encryptionKey);
      decryptedCredentials = JSON.parse(decryptedJson);
    } catch (error) {
      console.error('Decryption failed:', error);
      await supabase
        .from('platform_credentials')
        .update({
          status: 'invalid',
          validation_error: 'Failed to decrypt credentials',
        })
        .eq('id', credential_id);

      return new Response(
        JSON.stringify({ success: false, error: 'Decryption failed' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Log the validation attempt
    await supabase.from('credential_access_log').insert({
      credential_id: credential_id,
      user_id: credential.user_id,
      action: 'validated',
      platform: credential.platform,
      success: false, // Will update later
    });

    // Validate based on platform
    let validationResult: {
      success: boolean;
      error?: string;
      requires_2fa?: boolean;
      session_cookies?: Record<string, string>;
    };

    switch (credential.platform) {
      case 'bat':
        validationResult = await validateBatCredentials(
          decryptedCredentials.username,
          decryptedCredentials.password
        );
        break;
      case 'cars_and_bids':
        validationResult = await validateCarsAndBidsCredentials(
          decryptedCredentials.username,
          decryptedCredentials.password
        );
        break;
      default:
        validationResult = { success: false, error: `Platform ${credential.platform} not supported` };
    }

    // Update credential status based on result
    let newStatus: string;
    let validationError: string | null = null;

    if (validationResult.success) {
      newStatus = 'active';
    } else if (validationResult.requires_2fa) {
      newStatus = '2fa_required';
      validationError = '2FA verification required';

      // Create pending 2FA request
      const { data: tfaRequest } = await supabase.from('pending_2fa_requests').insert({
        credential_id: credential_id,
        method: 'totp', // BaT typically uses TOTP
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 min expiry
        status: 'pending',
      }).select().single();

      // Send in-app notification
      const platformName = credential.platform === 'bat' ? 'Bring a Trailer' :
                          credential.platform === 'cars_and_bids' ? 'Cars & Bids' :
                          credential.platform;

      await fetch(`${supabaseUrl}/functions/v1/create-notification`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({
          user_id: credential.user_id,
          notification_type: 'bidding_2fa_required',
          title: '2FA Verification Required',
          message: `Enter your two-factor code to complete login to ${platformName}`,
          action_url: `/settings/bidding?tfa=${tfaRequest?.id || ''}`,
          metadata: {
            credential_id: credential_id,
            platform: credential.platform,
            tfa_request_id: tfaRequest?.id,
            expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          },
        }),
      }).catch((e) => console.error('Failed to create notification:', e));
    } else {
      newStatus = 'invalid';
      validationError = validationResult.error || 'Validation failed';
    }

    await supabase
      .from('platform_credentials')
      .update({
        status: newStatus,
        validation_error: validationError,
        last_validated_at: new Date().toISOString(),
      })
      .eq('id', credential_id);

    // Update audit log
    await supabase
      .from('credential_access_log')
      .update({ success: validationResult.success })
      .eq('credential_id', credential_id)
      .order('created_at', { ascending: false })
      .limit(1);

    return new Response(
      JSON.stringify({
        success: validationResult.success,
        status: newStatus,
        error: validationError,
        requires_2fa: validationResult.requires_2fa || false,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Validation error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
