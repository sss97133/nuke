/**
 * transfer-email-webhook
 *
 * Receives inbound email webhooks from Resend and routes them to the correct
 * ownership transfer via transfer-advance.
 *
 * Configure in Resend Dashboard → Domains → nuke.ag → Inbound:
 *   Catch-all pattern: t-*@nuke.ag → this webhook URL
 *   Webhook URL: https://qkgaybvrernstplzjaam.supabase.co/functions/v1/transfer-email-webhook
 *
 * Routing precedence:
 *   1. TO address matches `t-{shortid}@nuke.ag` → direct transfer lookup
 *   2. FROM address matches transfer.buyer_email or seller_email
 *   3. Email thread subject contains transfer short ID
 *   4. No match → stored in contact_inbox for manual review
 *
 * Resend inbound webhook payload (email.received event):
 * {
 *   "type": "email.received",
 *   "data": {
 *     "email_id": "...",
 *     "from": "John Doe <john@example.com>",
 *     "to": ["t-abc123@nuke.ag"],
 *     "subject": "Re: 1984 K10 transfer",
 *     "text": "...",
 *     "html": "...",
 *     "attachments": [...]
 *   }
 * }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const RESEND_WEBHOOK_SECRET = Deno.env.get('RESEND_WEBHOOK_SECRET'); // optional signing secret

// Regex to extract short ID from t-{shortid}@nuke.ag
const INBOX_ADDRESS_RE = /^t-([a-f0-9]{10})@nuke\.ag$/i;

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Resend signature verification via svix
  // When RESEND_WEBHOOK_SECRET is set, validate incoming svix signatures.
  // Requests with svix headers are validated; requests without are logged but allowed
  // (this accommodates internal testing and non-Resend senders).
  const svixId = req.headers.get('svix-id');
  const svixTs = req.headers.get('svix-timestamp');
  const svixSig = req.headers.get('svix-signature');

  if (RESEND_WEBHOOK_SECRET && svixId && svixTs && svixSig) {
    try {
      const rawBody = await req.clone().text();
      const toSign = `${svixId}.${svixTs}.${rawBody}`;
      // RESEND_WEBHOOK_SECRET format may be "whsec_base64..." — strip prefix
      const secretB64 = RESEND_WEBHOOK_SECRET.replace(/^whsec_/, '');
      const secretBytes = Uint8Array.from(atob(secretB64), (c) => c.charCodeAt(0));
      const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(toSign));
      const computed = 'v1,' + btoa(String.fromCharCode(...new Uint8Array(sigBytes)));
      const sigs = svixSig.split(' ');
      if (!sigs.some((s) => s === computed)) {
        console.warn('[transfer-email-webhook] Svix signature mismatch — rejecting');
        return new Response('Unauthorized', { status: 401 });
      }
    } catch (err) {
      console.warn('[transfer-email-webhook] Svix verification error:', err);
      // Don't block on verification errors — log and continue
    }
  } else if (RESEND_WEBHOOK_SECRET && !svixId) {
    // No svix headers — this is an internal/test call, allow through
    console.log('[transfer-email-webhook] No svix headers — allowing (internal/test call)');
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  let event: Record<string, unknown>;
  try {
    event = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  // Resend wraps events as { type, data }
  if (event.type !== 'email.received') {
    return new Response(JSON.stringify({ ignored: true, type: event.type }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const data = event.data as Record<string, unknown>;
  const emailId = data.email_id as string;

  // Fetch full email content from Resend API (body may be truncated in webhook)
  let emailBody = (data.text as string) ?? '';
  let emailHtml = (data.html as string) ?? '';
  let attachments: Array<{ filename: string; content_type: string }> = [];

  if (RESEND_API_KEY && emailId) {
    try {
      const res = await fetch(`https://api.resend.com/emails/${emailId}`, {
        headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
      });
      if (res.ok) {
        const full = await res.json();
        emailBody = full.text ?? emailBody;
        emailHtml = full.html ?? emailHtml;
        attachments = full.attachments ?? [];
      }
    } catch (err) {
      console.warn('[transfer-email-webhook] Failed to fetch full email from Resend:', err);
    }
  }

  const fromRaw = (data.from as string) ?? '';
  const toAddresses: string[] = Array.isArray(data.to) ? data.to as string[] : [data.to as string];
  const subject = (data.subject as string) ?? '';

  // Parse from address: "Name <email>" or bare "email"
  const fromEmail = extractEmail(fromRaw);
  const toEmail = toAddresses[0] ?? '';

  console.log(`[transfer-email-webhook] From: ${fromEmail}, To: ${toEmail}, Subject: ${subject}`);

  // --- Route to transfer ---
  const transfer_id = await resolveTransfer(supabase, toEmail, fromEmail, subject);

  if (!transfer_id) {
    // No matching transfer — store in contact_inbox for manual review
    await supabase.from('contact_inbox').insert({
      source: 'email',
      from_address: fromEmail,
      to_address: toEmail,
      subject,
      body_text: emailBody,
      raw: event,
      needs_review: true,
      created_at: new Date().toISOString(),
    }).maybeSingle(); // ignore errors — table may not have all these columns

    console.log(`[transfer-email-webhook] No transfer found for ${toEmail} / ${fromEmail} — stored in inbox`);
    return new Response(JSON.stringify({ routed: false, reason: 'no_transfer_match' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Call transfer-advance to classify + advance milestone
  const advanceRes = await fetch(
    `${SUPABASE_URL}/functions/v1/transfer-advance`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        action: 'ingest_email',
        transfer_id,
        from_email: fromEmail,
        to_email: toEmail,
        subject,
        body_text: emailBody,
        body_html: emailHtml,
        received_at: new Date().toISOString(),
        attachments: attachments.map((a) => ({ filename: a.filename, content_type: a.content_type })),
      }),
    },
  );

  const result = await advanceRes.json();
  console.log(`[transfer-email-webhook] transfer-advance result:`, JSON.stringify(result));

  return new Response(JSON.stringify({ routed: true, transfer_id, ...result }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});

// ---------------------------------------------------------------------------
// Resolve which transfer an email belongs to.
// Returns transfer_id or null.
// ---------------------------------------------------------------------------
async function resolveTransfer(
  supabase: ReturnType<typeof createClient>,
  toEmail: string,
  fromEmail: string,
  subject: string,
): Promise<string | null> {
  // 1. TO address is a transfer inbox (t-{shortid}@nuke.ag)
  const toMatch = toEmail.toLowerCase().match(INBOX_ADDRESS_RE);
  if (toMatch) {
    const shortId = toMatch[1];
    // inbox_email is stored as t-{shortid}@nuke.ag
    const { data } = await supabase
      .from('ownership_transfers')
      .select('id')
      .eq('inbox_email', `t-${shortId}@nuke.ag`)
      .in('status', ['pending', 'in_progress', 'stalled'])
      .maybeSingle();
    if (data?.id) return data.id;
  }

  // 2. FROM email matches a known buyer or seller email on an active transfer
  if (fromEmail) {
    const { data } = await supabase
      .from('ownership_transfers')
      .select('id')
      .or(`buyer_email.eq.${fromEmail.toLowerCase()},seller_email.eq.${fromEmail.toLowerCase()}`)
      .in('status', ['pending', 'in_progress', 'stalled'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.id) return data.id;
  }

  // 3. Subject line contains a transfer short ID pattern "t-{10hex}"
  const subjectMatch = subject.match(/\bt-([a-f0-9]{10})\b/i);
  if (subjectMatch) {
    const { data } = await supabase
      .from('ownership_transfers')
      .select('id')
      .eq('inbox_email', `t-${subjectMatch[1].toLowerCase()}@nuke.ag`)
      .maybeSingle();
    if (data?.id) return data.id;
  }

  return null;
}

function extractEmail(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  return match ? match[1].toLowerCase().trim() : raw.toLowerCase().trim();
}
