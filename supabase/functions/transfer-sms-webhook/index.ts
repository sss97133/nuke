/**
 * transfer-sms-webhook
 *
 * Receives inbound SMS/MMS from Twilio and routes to the correct
 * ownership transfer via transfer-advance.
 *
 * Configure in Twilio Console → Phone Numbers → {your number} → Messaging:
 *   Webhook URL: https://qkgaybvrernstplzjaam.supabase.co/functions/v1/transfer-sms-webhook
 *   HTTP POST, application/x-www-form-urlencoded
 *
 * Routing:
 *   1. FROM phone matches transfer.buyer_phone or seller_phone (active transfer)
 *   2. No match → store in contact_inbox for manual review, reply with routing message
 *
 * Twilio POST body fields (form-encoded):
 *   From, To, Body, MessageSid, NumMedia, MediaUrl0..N, MediaContentType0..N
 *
 * Twilio validation:
 *   Uses X-Twilio-Signature HMAC-SHA1 on the full webhook URL + sorted params.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
const TWILIO_PHONE_NUMBER = Deno.env.get('TWILIO_PHONE_NUMBER');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return twiml(''); // Twilio doesn't send OPTIONS but just in case
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Parse Twilio's form-encoded body
  const body = await req.text();
  const params = parseFormEncoded(body);

  const from = params.From ?? '';       // e.g. "+14155551234"
  const to = params.To ?? '';           // our Twilio number
  const messageBody = params.Body ?? '';
  const messageSid = params.MessageSid ?? '';
  const numMedia = parseInt(params.NumMedia ?? '0', 10);

  console.log(`[transfer-sms-webhook] From: ${from}, Body: ${messageBody.slice(0, 100)}`);

  // Auth: accept a valid Twilio signature. When no X-Twilio-Signature header is present,
  // the request is treated as internal (for testing or programmatic calls from other edge fns).
  // Production Twilio webhooks always include X-Twilio-Signature.
  const twilioSig = req.headers.get('X-Twilio-Signature');

  if (twilioSig && TWILIO_AUTH_TOKEN) {
    // Validate signature from Twilio
    const webhookUrl = `${SUPABASE_URL}/functions/v1/transfer-sms-webhook`;
    const valid = await validateTwilioSignature(twilioSig, TWILIO_AUTH_TOKEN, webhookUrl, params);
    if (!valid) {
      console.warn('[transfer-sms-webhook] Invalid Twilio signature');
      return new Response('Forbidden', { status: 403 });
    }
  }
  // No signature = internal/programmatic call. Log it but allow through.
  if (!twilioSig) {
    console.log('[transfer-sms-webhook] No X-Twilio-Signature — treating as internal call');
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Normalize FROM phone (strip +1 country code for matching)
  const fromNormalized = normalizePhone(from);

  // Collect MMS media URLs
  const mediaUrls: string[] = [];
  for (let i = 0; i < numMedia; i++) {
    const url = params[`MediaUrl${i}`];
    if (url) mediaUrls.push(url);
  }

  // Resolve transfer by sender's phone number
  const transfer_id = await resolveTransferByPhone(supabase, fromNormalized);

  if (!transfer_id) {
    // Unknown sender — store in contact_inbox and send a routing reply
    await supabase.from('contact_inbox').insert({
      source: 'sms',
      from_address: from,
      to_address: to,
      body_text: messageBody,
      needs_review: true,
      created_at: new Date().toISOString(),
    }).maybeSingle();

    console.log(`[transfer-sms-webhook] No transfer found for ${fromNormalized} — replied with routing message`);

    // Reply to unknown sender asking them to identify the deal
    return twiml(
      `Thanks for reaching out to Nuke! We couldn't automatically link your message to an active transfer. ` +
      `Please reply with your deal reference number (e.g. t-abc123) or contact support@nuke.ag.`
    );
  }

  // Call transfer-advance to classify + advance the milestone
  const advanceRes = await fetch(
    `${SUPABASE_URL}/functions/v1/transfer-advance`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        action: 'ingest_sms',
        transfer_id,
        from_number: from,
        to_number: to,
        body_text: messageBody,
        received_at: new Date().toISOString(),
        media_urls: mediaUrls.length > 0 ? mediaUrls : undefined,
      }),
    },
  );

  const result = await advanceRes.json();
  console.log(`[transfer-sms-webhook] transfer-advance result:`, JSON.stringify(result));

  // Build a natural-language acknowledgement
  let reply = '';
  if (result.classified && result.milestone_advanced) {
    const milestoneLabel = result.milestone_advanced.replace(/_/g, ' ');
    reply = `Got it — logged "${milestoneLabel}" for your transfer. We'll keep this thread updated as things progress.`;
  } else {
    // Message received but no milestone advanced — silent ACK
    reply = ''; // empty TwiML = no reply SMS
  }

  return twiml(reply);
});

// ---------------------------------------------------------------------------
// Resolve which transfer an SMS belongs to by sender's phone number.
// ---------------------------------------------------------------------------
async function resolveTransferByPhone(
  supabase: ReturnType<typeof createClient>,
  phoneNormalized: string,
): Promise<string | null> {
  if (!phoneNormalized) return null;

  // Match against buyer_phone or seller_phone on active transfers
  const { data } = await supabase
    .from('ownership_transfers')
    .select('id')
    .or(`buyer_phone.eq.${phoneNormalized},seller_phone.eq.${phoneNormalized}`)
    .in('status', ['pending', 'in_progress', 'stalled'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.id ?? null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizePhone(phone: string): string {
  // Strip all non-digits, then strip leading 1 (US country code) if 11 digits
  const digits = phone.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

function parseFormEncoded(body: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const pair of body.split('&')) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) continue;
    const k = decodeURIComponent(pair.slice(0, eqIdx).replace(/\+/g, ' '));
    const v = decodeURIComponent(pair.slice(eqIdx + 1).replace(/\+/g, ' '));
    if (k) params[k] = v;
  }
  return params;
}

// Twilio signature validation using HMAC-SHA1
async function validateTwilioSignature(
  signature: string,
  authToken: string,
  webhookUrl: string,
  params: Record<string, string>,
): Promise<boolean> {
  if (!signature) return false;

  // Build the string to sign: URL + sorted params concatenated
  const sortedKeys = Object.keys(params).sort();
  const paramStr = sortedKeys.map((k) => `${k}${params[k]}`).join('');
  const toSign = `${webhookUrl}${paramStr}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(authToken),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );

  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(toSign));
  const computed = btoa(String.fromCharCode(...new Uint8Array(sig)));

  return computed === signature;
}

// Return TwiML response (Twilio expects XML even for empty replies)
function twiml(message: string): Response {
  const body = message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;

  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
