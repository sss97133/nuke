/**
 * KYC WEBHOOK HANDLER
 *
 * Handles webhooks from KYC providers (Persona/Jumio/Onfido).
 * In demo mode, auto-approves after simulated delay.
 *
 * POST /kyc-webhook/persona - Handle Persona webhooks
 * POST /kyc-webhook/jumio - Handle Jumio webhooks
 * POST /kyc-webhook/onfido - Handle Onfido webhooks
 * POST /kyc-webhook/demo - Handle demo mode webhooks
 *
 * POST /kyc-webhook/initiate - Start a new KYC flow
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-persona-signature",
};

// Simulated demo delay (5 seconds)
const DEMO_APPROVAL_DELAY_MS = 5000;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const url = new URL(req.url);
    const pathParts = url.pathname.split('/').filter(Boolean);
    const provider = pathParts[pathParts.length - 1] || 'demo';

    // Initiate new KYC flow
    if (provider === 'initiate') {
      const body = await req.json();
      const { user_id, provider: kycProvider = 'demo' } = body;

      if (!user_id) {
        return new Response(JSON.stringify({
          success: false,
          error: 'user_id is required'
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // Create inquiry via RPC
      const { data, error } = await supabase.rpc('initiate_kyc_verification', {
        p_user_id: user_id,
        p_provider: kycProvider
      });

      if (error) throw error;

      // In demo mode, schedule auto-approval
      if (kycProvider === 'demo') {
        // For demo, we'll use a background task approach
        // In production, this would come from the real provider
        const providerInquiryId = data.provider_inquiry_id;

        // Schedule the auto-approval (in a real implementation, use a queue)
        setTimeout(async () => {
          try {
            await supabase.rpc('process_kyc_webhook', {
              p_provider: 'demo',
              p_provider_inquiry_id: providerInquiryId,
              p_event_type: 'demo.approved',
              p_payload: {
                demo: true,
                approved_at: new Date().toISOString(),
                simulated: true,
                checks: {
                  document_valid: true,
                  face_match: true,
                  liveness: true
                }
              }
            });
          } catch (e) {
            console.error('Demo auto-approval failed:', e);
          }
        }, DEMO_APPROVAL_DELAY_MS);
      }

      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Handle provider webhooks
    const rawBody = await req.text();
    let payload: any;

    try {
      payload = JSON.parse(rawBody);
    } catch {
      payload = { raw: rawBody };
    }

    // Verify webhook signature (provider-specific)
    // In production, implement signature verification for each provider
    const isValidSignature = await verifyWebhookSignature(req, rawBody, provider);
    if (!isValidSignature) {
      console.warn(`Invalid webhook signature from ${provider}`);
      // In production, reject invalid signatures
      // For now, log and continue for development
    }

    // Extract event details based on provider
    let eventType: string;
    let providerInquiryId: string;

    switch (provider) {
      case 'persona':
        eventType = payload.data?.attributes?.name || payload.meta?.type || 'unknown';
        providerInquiryId = payload.data?.attributes?.payload?.data?.id ||
                           payload.data?.id ||
                           '';
        break;

      case 'jumio':
        eventType = payload.transaction?.status || 'unknown';
        providerInquiryId = payload.transactionReference || payload.scanReference || '';
        break;

      case 'onfido':
        eventType = payload.action || 'unknown';
        providerInquiryId = payload.resource?.id || payload.object?.id || '';
        break;

      case 'demo':
        eventType = payload.event_type || 'demo.approved';
        providerInquiryId = payload.inquiry_id || '';
        break;

      default:
        eventType = 'unknown';
        providerInquiryId = '';
    }

    console.log(`Processing ${provider} webhook: ${eventType} for ${providerInquiryId}`);

    // Process the webhook
    const { data, error } = await supabase.rpc('process_kyc_webhook', {
      p_provider: provider,
      p_provider_inquiry_id: providerInquiryId,
      p_event_type: eventType,
      p_payload: payload
    });

    if (error) {
      console.error('Error processing webhook:', error);
      throw error;
    }

    return new Response(JSON.stringify({
      success: true,
      provider,
      event_type: eventType,
      result: data
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (e: any) {
    console.error("KYC webhook error:", e);
    return new Response(JSON.stringify({
      success: false,
      error: e.message
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});

async function verifyWebhookSignature(
  req: Request,
  rawBody: string,
  provider: string
): Promise<boolean> {
  // In production, implement proper signature verification for each provider

  switch (provider) {
    case 'persona': {
      const signature = req.headers.get('x-persona-signature');
      const webhookSecret = Deno.env.get('PERSONA_WEBHOOK_SECRET');
      if (!signature || !webhookSecret) return false;

      // Implement HMAC verification
      // const expectedSignature = await computeHmac(rawBody, webhookSecret);
      // return signature === expectedSignature;
      return true; // Placeholder
    }

    case 'jumio': {
      const signature = req.headers.get('x-jumio-signature');
      if (!signature) return false;
      return true; // Placeholder
    }

    case 'onfido': {
      const signature = req.headers.get('x-sha2-signature');
      if (!signature) return false;
      return true; // Placeholder
    }

    case 'demo':
      return true; // Demo mode always valid

    default:
      return true;
  }
}
