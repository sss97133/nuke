/**
 * API Keys Management
 *
 * Secure endpoint for creating, listing, and revoking API keys.
 * Following Stripe's patterns for developer experience.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

interface CreateKeyRequest {
  name: string;
  scopes?: string[];
  expires_in_days?: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Authenticate user via JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid authentication" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const url = new URL(req.url);
    const pathParts = url.pathname.split('/').filter(Boolean);
    const keyId = pathParts.length > 1 ? pathParts[pathParts.length - 1] : null;

    // GET - List API keys
    if (req.method === "GET") {
      const { data: keys, error } = await supabase
        .from("api_keys")
        .select(`
          id, name, key_prefix, scopes, is_active,
          rate_limit_per_hour, rate_limit_remaining,
          last_used_at, expires_at, created_at
        `)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Get usage stats for each key
      const keysWithStats = await Promise.all(
        (keys || []).map(async (key) => {
          const { count } = await supabase
            .from("api_usage_logs")
            .select("*", { count: "exact", head: true })
            .eq("user_id", user.id)
            .gte("timestamp", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

          return {
            ...key,
            requests_24h: count || 0,
          };
        })
      );

      return new Response(
        JSON.stringify({ data: keysWithStats }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // POST - Create new API key
    if (req.method === "POST") {
      const body: CreateKeyRequest = await req.json();

      if (!body.name || body.name.length < 1 || body.name.length > 100) {
        return new Response(
          JSON.stringify({ error: "Name is required (1-100 characters)" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Generate secure API key
      const rawKey = generateApiKey();
      const keyPrefix = rawKey.substring(0, 8);
      const keyHash = await hashApiKey(rawKey);

      // Calculate expiration
      let expiresAt = null;
      if (body.expires_in_days) {
        expiresAt = new Date(Date.now() + body.expires_in_days * 24 * 60 * 60 * 1000).toISOString();
      }

      const { data: newKey, error } = await supabase
        .from("api_keys")
        .insert({
          user_id: user.id,
          name: body.name,
          key_hash: keyHash,
          key_prefix: keyPrefix,
          scopes: body.scopes || ["read", "write"],
          is_active: true,
          rate_limit_per_hour: 1000,
          rate_limit_remaining: 1000,
          expires_at: expiresAt,
        })
        .select()
        .single();

      if (error) throw error;

      // Return the full key ONLY on creation (never stored or shown again)
      return new Response(
        JSON.stringify({
          data: {
            id: newKey.id,
            name: newKey.name,
            key: `nk_live_${rawKey}`, // Full key - only shown once!
            key_prefix: keyPrefix,
            scopes: newKey.scopes,
            expires_at: newKey.expires_at,
            created_at: newKey.created_at,
          },
          message: "API key created. Save this key - it won't be shown again!",
        }),
        { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // DELETE - Revoke API key
    if (req.method === "DELETE" && keyId) {
      // Verify ownership
      const { data: existingKey } = await supabase
        .from("api_keys")
        .select("user_id")
        .eq("id", keyId)
        .single();

      if (!existingKey || existingKey.user_id !== user.id) {
        return new Response(
          JSON.stringify({ error: "Key not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Soft delete by deactivating
      const { error } = await supabase
        .from("api_keys")
        .update({ is_active: false })
        .eq("id", keyId);

      if (error) throw error;

      return new Response(
        JSON.stringify({ message: "API key revoked" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("API keys error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/**
 * Generate a secure random API key
 */
function generateApiKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => chars[byte % chars.length]).join('');
}

/**
 * Hash API key using SHA-256
 */
async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return 'sha256_' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
