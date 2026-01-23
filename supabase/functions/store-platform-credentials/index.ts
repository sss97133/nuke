import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// AES-256-GCM encryption
async function encrypt(plaintext: string, keyBase64: string): Promise<{ ciphertext: Uint8Array; iv: Uint8Array; tag: Uint8Array }> {
  // Decode base64 key
  const keyBytes = Uint8Array.from(atob(keyBase64), c => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );

  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for GCM
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, tagLength: 128 },
    key,
    data
  );

  const encryptedArray = new Uint8Array(encrypted);
  // Last 16 bytes are the auth tag
  const ciphertext = encryptedArray.slice(0, -16);
  const tag = encryptedArray.slice(-16);

  return { ciphertext, iv, tag };
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const encryptionKey = Deno.env.get("CREDENTIAL_ENCRYPTION_KEY");

    if (!encryptionKey) {
      throw new Error("CREDENTIAL_ENCRYPTION_KEY not configured");
    }

    // Get user from auth header
    const authHeader = req.headers.get("Authorization")!;
    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey);

    const token = authHeader.replace("Bearer ", "");
    const body = await req.json();
    const { platform, username, password, totp_secret, user_id: bodyUserId } = body;

    let userId: string;

    // Try to get user from token first
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);

    if (user) {
      userId = user.id;
    } else if (bodyUserId) {
      // Allow passing user_id directly (for service role / admin use)
      userId = bodyUserId;
    } else {
      return new Response(
        JSON.stringify({ error: "Unauthorized - no valid user" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!platform || !username || !password) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: platform, username, password" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Encrypt credentials
    const credentialsJson = JSON.stringify({ username, password });
    const { ciphertext, iv, tag } = await encrypt(credentialsJson, encryptionKey);

    // Encrypt TOTP secret if provided
    let totpEncrypted = null;
    if (totp_secret) {
      const totpResult = await encrypt(totp_secret, encryptionKey);
      totpEncrypted = {
        ciphertext: totpResult.ciphertext,
        iv: totpResult.iv,
        tag: totpResult.tag,
      };
    }

    // Check if credential already exists
    const { data: existing } = await supabaseClient
      .from("platform_credentials")
      .select("id")
      .eq("user_id", userId)
      .eq("platform", platform)
      .maybeSingle();

    let result;
    if (existing) {
      // Update existing
      const { data, error } = await supabaseClient
        .from("platform_credentials")
        .update({
          encrypted_credentials: bytesToHex(ciphertext),
          encryption_iv: bytesToHex(iv),
          encryption_tag: bytesToHex(tag),
          totp_secret_encrypted: totpEncrypted ? bytesToHex(totpEncrypted.ciphertext) : null,
          requires_2fa: !!totp_secret,
          status: "pending",
          validation_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .select()
        .single();

      if (error) throw error;
      result = data;
    } else {
      // Insert new
      const { data, error } = await supabaseClient
        .from("platform_credentials")
        .insert({
          user_id: userId,
          platform,
          encrypted_credentials: bytesToHex(ciphertext),
          encryption_iv: bytesToHex(iv),
          encryption_tag: bytesToHex(tag),
          totp_secret_encrypted: totpEncrypted ? bytesToHex(totpEncrypted.ciphertext) : null,
          requires_2fa: !!totp_secret,
          status: "pending",
        })
        .select()
        .single();

      if (error) throw error;
      result = data;
    }

    // Log credential creation
    await supabaseClient.from("credential_access_log").insert({
      credential_id: result.id,
      user_id: userId,
      action: "created",
      platform,
      success: true,
    });

    // TODO: Trigger async validation via Elixir backend
    // For now, we'll validate synchronously in a future iteration
    // The Elixir PlatformAuthenticator will pick this up and validate

    // For now, mark as pending - Elixir backend will validate
    return new Response(
      JSON.stringify({
        id: result.id,
        platform: result.platform,
        status: result.status,
        message: "Credentials stored. Validation will be performed by the backend.",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error storing credentials:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
