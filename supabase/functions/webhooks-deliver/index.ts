/**
 * Webhooks Delivery Service
 *
 * Delivers webhooks to registered endpoints with:
 * - HMAC-SHA256 signatures (Stripe-compatible format)
 * - Exponential backoff retry logic
 * - Delivery tracking and auditing
 *
 * Can be triggered by:
 * - Direct call from other edge functions
 * - Scheduled job for retrying failed deliveries
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface WebhookEvent {
  event_type: string;
  data: Record<string, any>;
  user_id?: string; // If specified, only send to this user's endpoints
  event_id?: string; // Idempotency key
}

interface DeliveryResult {
  endpoint_id: string;
  status: 'success' | 'failed' | 'retrying';
  response_status?: number;
  response_time_ms?: number;
  error?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const action = body.action || 'deliver';

    // Action: Retry pending deliveries (called by scheduler)
    if (action === 'retry') {
      return await retryPendingDeliveries(supabase);
    }

    // Action: Deliver a new event
    if (action === 'deliver') {
      const event: WebhookEvent = body.event;

      if (!event || !event.event_type || !event.data) {
        return new Response(
          JSON.stringify({ error: "event.event_type and event.data are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const results = await deliverEvent(supabase, event);

      return new Response(
        JSON.stringify({
          success: true,
          delivered: results.filter(r => r.status === 'success').length,
          failed: results.filter(r => r.status === 'failed').length,
          retrying: results.filter(r => r.status === 'retrying').length,
          results,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Invalid action. Use 'deliver' or 'retry'" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("Webhook delivery error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function deliverEvent(supabase: any, event: WebhookEvent): Promise<DeliveryResult[]> {
  // Find matching endpoints
  let query = supabase
    .from("webhook_endpoints")
    .select("id, url, secret, events, user_id")
    .eq("is_active", true);

  if (event.user_id) {
    query = query.eq("user_id", event.user_id);
  }

  const { data: endpoints, error } = await query;

  if (error) {
    console.error("Failed to fetch endpoints:", error);
    return [];
  }

  if (!endpoints || endpoints.length === 0) {
    return [];
  }

  // Filter endpoints by event type subscription
  const matchingEndpoints = endpoints.filter((ep: any) => {
    return ep.events.includes('*') || ep.events.includes(event.event_type);
  });

  // Generate idempotency key if not provided
  const eventId = event.event_id || crypto.randomUUID();

  // Deliver to each matching endpoint
  const results: DeliveryResult[] = [];

  for (const endpoint of matchingEndpoints) {
    const result = await deliverToEndpoint(supabase, endpoint, event, eventId);
    results.push(result);
  }

  return results;
}

async function deliverToEndpoint(
  supabase: any,
  endpoint: { id: string; url: string; secret: string; user_id: string },
  event: WebhookEvent,
  eventId: string
): Promise<DeliveryResult> {
  const timestamp = Math.floor(Date.now() / 1000);

  // Build payload (Stripe-compatible structure)
  const payload = {
    id: eventId,
    type: event.event_type,
    created: timestamp,
    data: event.data,
    livemode: true,
  };

  const payloadString = JSON.stringify(payload);

  // Generate signature
  const signature = await generateSignature(endpoint.secret, timestamp, payloadString);

  // Create delivery record
  const { data: delivery, error: createError } = await supabase
    .from("webhook_deliveries")
    .insert({
      endpoint_id: endpoint.id,
      event_type: event.event_type,
      event_id: eventId,
      payload: payload,
      status: 'pending',
      attempts: 0,
    })
    .select()
    .single();

  if (createError) {
    console.error("Failed to create delivery record:", createError);
    return {
      endpoint_id: endpoint.id,
      status: 'failed',
      error: "Failed to create delivery record",
    };
  }

  // Attempt delivery
  return await attemptDelivery(supabase, delivery.id, endpoint.url, payloadString, signature, timestamp);
}

async function attemptDelivery(
  supabase: any,
  deliveryId: string,
  url: string,
  payloadString: string,
  signature: string,
  timestamp: number
): Promise<DeliveryResult> {
  const startTime = Date.now();

  // Get current delivery state
  const { data: delivery } = await supabase
    .from("webhook_deliveries")
    .select("attempts, max_attempts, endpoint_id")
    .eq("id", deliveryId)
    .single();

  if (!delivery) {
    return {
      endpoint_id: '',
      status: 'failed',
      error: "Delivery record not found",
    };
  }

  const newAttempts = delivery.attempts + 1;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Nuke-Signature': signature,
        'Nuke-Timestamp': timestamp.toString(),
        // Also include Stripe-compatible header for interoperability
        'Stripe-Signature': `t=${timestamp},v1=${signature.split(',')[1]?.split('=')[1] || signature}`,
      },
      body: payloadString,
    });

    const responseTime = Date.now() - startTime;
    const responseBody = await response.text().catch(() => '');

    if (response.ok) {
      // Success
      await supabase
        .from("webhook_deliveries")
        .update({
          status: 'success',
          attempts: newAttempts,
          response_status: response.status,
          response_body: responseBody.substring(0, 1000),
          response_time_ms: responseTime,
          delivered_at: new Date().toISOString(),
        })
        .eq("id", deliveryId);

      return {
        endpoint_id: delivery.endpoint_id,
        status: 'success',
        response_status: response.status,
        response_time_ms: responseTime,
      };
    } else {
      // Failed - schedule retry if attempts remaining
      return await handleFailure(
        supabase,
        deliveryId,
        delivery.endpoint_id,
        newAttempts,
        delivery.max_attempts,
        response.status,
        responseBody,
        responseTime,
        `HTTP ${response.status}: ${response.statusText}`
      );
    }
  } catch (error: any) {
    const responseTime = Date.now() - startTime;
    return await handleFailure(
      supabase,
      deliveryId,
      delivery.endpoint_id,
      newAttempts,
      delivery.max_attempts,
      null,
      null,
      responseTime,
      error.message
    );
  }
}

async function handleFailure(
  supabase: any,
  deliveryId: string,
  endpointId: string,
  attempts: number,
  maxAttempts: number,
  responseStatus: number | null,
  responseBody: string | null,
  responseTime: number,
  errorMessage: string
): Promise<DeliveryResult> {
  if (attempts >= maxAttempts) {
    // Max retries reached - mark as failed
    await supabase
      .from("webhook_deliveries")
      .update({
        status: 'failed',
        attempts,
        response_status: responseStatus,
        response_body: responseBody?.substring(0, 1000),
        response_time_ms: responseTime,
        last_error: errorMessage,
      })
      .eq("id", deliveryId);

    return {
      endpoint_id: endpointId,
      status: 'failed',
      response_status: responseStatus ?? undefined,
      response_time_ms: responseTime,
      error: errorMessage,
    };
  }

  // Schedule retry with exponential backoff
  // Retry delays: 1min, 5min, 30min, 2hr, 8hr
  const delayMinutes = [1, 5, 30, 120, 480][attempts - 1] || 480;
  const nextRetryAt = new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();

  await supabase
    .from("webhook_deliveries")
    .update({
      status: 'retrying',
      attempts,
      response_status: responseStatus,
      response_body: responseBody?.substring(0, 1000),
      response_time_ms: responseTime,
      last_error: errorMessage,
      next_retry_at: nextRetryAt,
    })
    .eq("id", deliveryId);

  return {
    endpoint_id: endpointId,
    status: 'retrying',
    response_status: responseStatus ?? undefined,
    response_time_ms: responseTime,
    error: `${errorMessage}. Retry scheduled for ${nextRetryAt}`,
  };
}

async function retryPendingDeliveries(supabase: any): Promise<Response> {
  // Find deliveries ready for retry
  const { data: pendingDeliveries, error } = await supabase
    .from("webhook_deliveries")
    .select(`
      id, endpoint_id, payload,
      webhook_endpoints!inner(url, secret, is_active)
    `)
    .eq("status", "retrying")
    .lte("next_retry_at", new Date().toISOString())
    .limit(50);

  if (error) {
    console.error("Failed to fetch pending deliveries:", error);
    return new Response(
      JSON.stringify({ error: "Failed to fetch pending deliveries" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (!pendingDeliveries || pendingDeliveries.length === 0) {
    return new Response(
      JSON.stringify({ message: "No pending deliveries to retry" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const results: DeliveryResult[] = [];

  for (const delivery of pendingDeliveries) {
    const endpoint = delivery.webhook_endpoints;

    if (!endpoint.is_active) {
      // Endpoint was disabled - mark as failed
      await supabase
        .from("webhook_deliveries")
        .update({
          status: 'failed',
          last_error: 'Endpoint was disabled',
        })
        .eq("id", delivery.id);

      results.push({
        endpoint_id: delivery.endpoint_id,
        status: 'failed',
        error: 'Endpoint was disabled',
      });
      continue;
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const payloadString = JSON.stringify(delivery.payload);
    const signature = await generateSignature(endpoint.secret, timestamp, payloadString);

    const result = await attemptDelivery(
      supabase,
      delivery.id,
      endpoint.url,
      payloadString,
      signature,
      timestamp
    );
    results.push(result);
  }

  return new Response(
    JSON.stringify({
      processed: pendingDeliveries.length,
      succeeded: results.filter(r => r.status === 'success').length,
      failed: results.filter(r => r.status === 'failed').length,
      retrying: results.filter(r => r.status === 'retrying').length,
      results,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

async function generateSignature(
  secret: string,
  timestamp: number,
  payload: string
): Promise<string> {
  // Stripe-compatible signature format
  const signedPayload = `${timestamp}.${payload}`;
  const encoder = new TextEncoder();

  // Remove whsec_ prefix if present
  const rawSecret = secret.startsWith('whsec_') ? secret.slice(6) : secret;

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(rawSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(signedPayload)
  );

  const signatureHex = Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return `t=${timestamp},v1=${signatureHex}`;
}

/**
 * Helper function for other edge functions to trigger webhook delivery.
 * Export this for use in other functions.
 *
 * Usage in other edge functions:
 *   await triggerWebhook(supabase, {
 *     event_type: 'vehicle.created',
 *     data: { vehicle_id: 'xxx', ...vehicle },
 *     user_id: userId,
 *   });
 */
export async function triggerWebhook(supabase: any, event: WebhookEvent): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    await fetch(`${supabaseUrl}/functions/v1/webhooks-deliver`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({
        action: 'deliver',
        event,
      }),
    });
  } catch (error) {
    console.error("Failed to trigger webhook:", error);
    // Don't throw - webhook delivery should not block main operations
  }
}
