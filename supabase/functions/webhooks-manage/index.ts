/**
 * Webhooks Management Endpoint
 *
 * Register, list, update, and delete webhook endpoints.
 * Follows Stripe webhook patterns for developer familiarity.
 *
 * Authentication: Bearer token (Supabase JWT) or API key
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

interface WebhookEndpointInput {
  url: string;
  description?: string;
  events?: string[];
  is_active?: boolean;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Authenticate
    const { userId, error: authError } = await authenticateRequest(req, supabase);
    if (authError || !userId) {
      return new Response(
        JSON.stringify({ error: authError || "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const url = new URL(req.url);
    const pathParts = url.pathname.split('/').filter(Boolean);
    const endpointId = pathParts[pathParts.length - 1];
    const isSpecificEndpoint = endpointId && endpointId !== 'webhooks-manage' && isUUID(endpointId);

    // GET /webhooks - List all webhook endpoints
    if (req.method === "GET" && !isSpecificEndpoint) {
      const { data, error } = await supabase
        .from("webhook_endpoints")
        .select(`
          id, url, description, events, is_active,
          created_at, updated_at
        `)
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Count deliveries per endpoint
      const endpointsWithStats = await Promise.all(
        (data || []).map(async (endpoint) => {
          const { count: totalDeliveries } = await supabase
            .from("webhook_deliveries")
            .select("*", { count: "exact", head: true })
            .eq("endpoint_id", endpoint.id);

          const { count: failedDeliveries } = await supabase
            .from("webhook_deliveries")
            .select("*", { count: "exact", head: true })
            .eq("endpoint_id", endpoint.id)
            .eq("status", "failed");

          return {
            ...endpoint,
            stats: {
              total_deliveries: totalDeliveries || 0,
              failed_deliveries: failedDeliveries || 0,
            },
          };
        })
      );

      return new Response(
        JSON.stringify({ data: endpointsWithStats }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // GET /webhooks/:id - Get specific endpoint with recent deliveries
    if (req.method === "GET" && isSpecificEndpoint) {
      const { data: endpoint, error } = await supabase
        .from("webhook_endpoints")
        .select("*")
        .eq("id", endpointId)
        .eq("user_id", userId)
        .single();

      if (error || !endpoint) {
        return new Response(
          JSON.stringify({ error: "Webhook endpoint not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Get recent deliveries
      const { data: deliveries } = await supabase
        .from("webhook_deliveries")
        .select(`
          id, event_type, event_id, status, attempts,
          response_status, response_time_ms, created_at, delivered_at, last_error
        `)
        .eq("endpoint_id", endpointId)
        .order("created_at", { ascending: false })
        .limit(20);

      return new Response(
        JSON.stringify({
          data: {
            ...endpoint,
            secret: undefined, // Never expose the secret
            recent_deliveries: deliveries || [],
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // POST /webhooks - Create new endpoint
    if (req.method === "POST") {
      const body: WebhookEndpointInput = await req.json();

      if (!body.url) {
        return new Response(
          JSON.stringify({ error: "url is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Validate URL format
      if (!isValidWebhookUrl(body.url)) {
        return new Response(
          JSON.stringify({ error: "Invalid webhook URL. Must be HTTPS (HTTP allowed for localhost only)" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Validate events
      const events = body.events || ['*'];
      const validEvents = [
        '*',
        'vehicle.created', 'vehicle.updated', 'vehicle.deleted',
        'observation.created',
        'document.uploaded',
        'import.completed',
      ];

      for (const event of events) {
        if (!validEvents.includes(event)) {
          return new Response(
            JSON.stringify({
              error: `Invalid event type: ${event}`,
              valid_events: validEvents,
            }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      // Generate webhook secret
      const secret = await generateWebhookSecret();

      const { data, error } = await supabase
        .from("webhook_endpoints")
        .insert({
          user_id: userId,
          url: body.url,
          description: body.description,
          events,
          secret,
          is_active: body.is_active ?? true,
        })
        .select()
        .single();

      if (error) throw error;

      return new Response(
        JSON.stringify({
          data: {
            ...data,
            secret, // Only expose secret on creation
          },
          message: "Webhook endpoint created. Save the secret - it won't be shown again.",
        }),
        { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // PATCH /webhooks/:id - Update endpoint
    if (req.method === "PATCH" && isSpecificEndpoint) {
      const body: Partial<WebhookEndpointInput> = await req.json();

      // Verify ownership
      const { data: existing } = await supabase
        .from("webhook_endpoints")
        .select("user_id")
        .eq("id", endpointId)
        .single();

      if (!existing || existing.user_id !== userId) {
        return new Response(
          JSON.stringify({ error: "Webhook endpoint not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const updateData: any = {};
      if (body.url !== undefined) {
        if (!isValidWebhookUrl(body.url)) {
          return new Response(
            JSON.stringify({ error: "Invalid webhook URL" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        updateData.url = body.url;
      }
      if (body.description !== undefined) updateData.description = body.description;
      if (body.events !== undefined) updateData.events = body.events;
      if (body.is_active !== undefined) updateData.is_active = body.is_active;

      const { data, error } = await supabase
        .from("webhook_endpoints")
        .update(updateData)
        .eq("id", endpointId)
        .select()
        .single();

      if (error) throw error;

      return new Response(
        JSON.stringify({
          data: { ...data, secret: undefined },
          message: "Webhook endpoint updated",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // DELETE /webhooks/:id - Delete endpoint
    if (req.method === "DELETE" && isSpecificEndpoint) {
      // Verify ownership
      const { data: existing } = await supabase
        .from("webhook_endpoints")
        .select("user_id")
        .eq("id", endpointId)
        .single();

      if (!existing || existing.user_id !== userId) {
        return new Response(
          JSON.stringify({ error: "Webhook endpoint not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { error } = await supabase
        .from("webhook_endpoints")
        .delete()
        .eq("id", endpointId);

      if (error) throw error;

      return new Response(
        JSON.stringify({ message: "Webhook endpoint deleted" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // POST /webhooks/:id/rotate-secret - Rotate the secret
    if (req.method === "POST" && pathParts[pathParts.length - 1] === "rotate-secret") {
      const webhookId = pathParts[pathParts.length - 2];

      // Verify ownership
      const { data: existing } = await supabase
        .from("webhook_endpoints")
        .select("user_id")
        .eq("id", webhookId)
        .single();

      if (!existing || existing.user_id !== userId) {
        return new Response(
          JSON.stringify({ error: "Webhook endpoint not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const newSecret = await generateWebhookSecret();

      const { data, error } = await supabase
        .from("webhook_endpoints")
        .update({ secret: newSecret })
        .eq("id", webhookId)
        .select()
        .single();

      if (error) throw error;

      return new Response(
        JSON.stringify({
          data: { ...data, secret: newSecret },
          message: "Secret rotated. Save the new secret - it won't be shown again.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("Webhook management error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function isUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

function isValidWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Allow HTTP for localhost only
    if (parsed.protocol === 'http:') {
      return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    }
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

async function generateWebhookSecret(): Promise<string> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return `whsec_${hex}`;
}

async function authenticateRequest(req: Request, supabase: any): Promise<{ userId: string | null; error?: string }> {
  const authHeader = req.headers.get("Authorization");
  const apiKey = req.headers.get("X-API-Key");

  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (user && !error) {
      return { userId: user.id };
    }
  }

  if (apiKey) {
    const rawKey = apiKey.startsWith('nk_live_') ? apiKey.slice(8) : apiKey;
    const keyHash = await hashApiKey(rawKey);

    const { data: keyData, error } = await supabase
      .from("api_keys")
      .select("user_id, is_active")
      .eq("key_hash", keyHash)
      .eq("is_active", true)
      .single();

    if (keyData && !error) {
      await supabase
        .from("api_keys")
        .update({ last_used_at: new Date().toISOString() })
        .eq("key_hash", keyHash);
      return { userId: keyData.user_id };
    }
  }

  return { userId: null, error: "Invalid or missing authentication" };
}

async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return 'sha256_' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
