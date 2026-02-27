/**
 * notify-transfer-parties
 *
 * Sends outbound SMS and email to buyer and seller when transfer events occur.
 * Designed to be called fire-and-forget from transfer-automator — never throws.
 *
 * Events:
 *   seeded           — deal just seeded; send both parties their transfer link
 *   milestone_advanced — a milestone was marked complete; nudge the relevant party
 *   stalled          — transfer has gone quiet; remind both parties
 *   overdue          — a required milestone is past deadline
 *
 * Input:
 *   { transfer_id: string, event: EventType, milestone_type?: string }
 *
 * Output:
 *   { sent: Result[], skipped: string[], errors: string[] }
 *
 * Non-fatal: always returns 200. Errors are logged and returned in the response,
 * but a notification failure never breaks the transfer process.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { sendEmail } from '../_shared/email.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const FRONTEND_URL = Deno.env.get('FRONTEND_URL') || 'https://nuke.ag';

const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
const TWILIO_PHONE_NUMBER = Deno.env.get('TWILIO_PHONE_NUMBER');

type EventType = 'seeded' | 'milestone_advanced' | 'stalled' | 'overdue';

interface NotifyResult {
  recipient: 'buyer' | 'seller';
  channel: 'sms' | 'email';
  status: 'sent' | 'skipped' | 'failed';
  reason?: string;
}

// Human-readable milestone labels for notifications
const MILESTONE_LABELS: Record<string, string> = {
  contact_exchanged:       'Contact exchanged',
  discussion_complete:     'Discussion complete',
  deposit_triggered:       'Deposit requested',
  deposit_sent:            'Deposit sent',
  deposit_received:        'Deposit received',
  deposit_confirmed:       'Deposit confirmed',
  full_payment_triggered:  'Payment requested',
  full_payment_sent:       'Payment sent',
  full_payment_received:   'Payment received',
  payment_confirmed:       'Payment confirmed',
  inspection_scheduled:    'Inspection scheduled',
  inspection_completed:    'Inspection complete',
  title_sent:              'Title mailed',
  title_received:          'Title received',
  shipping_initiated:      'Vehicle picked up',
  vehicle_arrived:         'Vehicle delivered',
  transfer_complete:       'Transfer complete',
};

// Which party needs to act at each milestone
const MILESTONE_ACTOR: Record<string, 'buyer' | 'seller' | 'both'> = {
  contact_exchanged:       'both',
  deposit_triggered:       'buyer',
  deposit_sent:            'seller',
  deposit_received:        'buyer',
  deposit_confirmed:       'both',
  full_payment_triggered:  'buyer',
  full_payment_sent:       'seller',
  full_payment_received:   'buyer',
  payment_confirmed:       'both',
  inspection_scheduled:    'seller',
  inspection_completed:    'both',
  title_sent:              'buyer',
  title_received:          'seller',
  shipping_initiated:      'buyer',
  vehicle_arrived:         'both',
  transfer_complete:       'both',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const sent: NotifyResult[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  try {
    const { transfer_id, event, milestone_type } = await req.json() as {
      transfer_id: string;
      event: EventType;
      milestone_type?: string;
    };

    if (!transfer_id || !event) {
      return json({ error: 'transfer_id and event required' }, 400);
    }

    // Fetch transfer + vehicle
    const { data: transfer, error: fetchErr } = await supabase
      .from('ownership_transfers')
      .select(`
        id, agreed_price, sale_date, status, inbox_email,
        buyer_access_token, seller_access_token,
        buyer_phone, buyer_email,
        seller_phone, seller_email,
        vehicle:vehicles!vehicle_id(year, make, model)
      `)
      .eq('id', transfer_id)
      .single();

    if (fetchErr || !transfer) {
      return json({ error: 'Transfer not found', detail: fetchErr }, 404);
    }

    const vehicle = transfer.vehicle as { year: number; make: string; model: string } | null;
    const vehicleName = vehicle
      ? `${vehicle.year} ${vehicle.make} ${vehicle.model}`
      : 'your vehicle';

    const buyerLink = `${FRONTEND_URL}/t/${transfer.buyer_access_token}`;
    const sellerLink = `${FRONTEND_URL}/t/${transfer.seller_access_token}`;
    const price = transfer.agreed_price
      ? `$${Number(transfer.agreed_price).toLocaleString()}`
      : null;

    // -------------------------------------------------------------------------
    // Build messages per event type
    // -------------------------------------------------------------------------

    if (event === 'seeded') {
      // Buyer
      await sendSMS(
        transfer.buyer_phone,
        `Your ${vehicleName}${price ? ` (${price})` : ''} deal is in motion. Track every step at: ${buyerLink}\n\nReply to this thread or email ${transfer.inbox_email} to update your transfer.\n\n— Nuke`,
        'buyer', sent, skipped, errors,
      );
      await sendEmail({
        to: transfer.buyer_email ?? '',
        subject: `Your ${vehicleName} transfer has started`,
        html: emailHtml({
          headline: `Your ${vehicleName} deal is in motion`,
          body: `${price ? `The agreed price is <strong>${price}</strong>. ` : ''}Track every step of your transfer, confirm milestones, and communicate with the seller — all in one place.`,
          ctaText: 'Track your transfer',
          ctaUrl: buyerLink,
          footer: `Questions? Reply to this email or send a message to <a href="mailto:${transfer.inbox_email}">${transfer.inbox_email}</a> — it goes straight to your transfer thread.`,
        }),
        replyTo: transfer.inbox_email ?? undefined,
      }).then(r => recordEmailResult(r, 'buyer', sent, skipped, errors));

      // Seller
      await sendSMS(
        transfer.seller_phone,
        `Your ${vehicleName}${price ? ` sold for ${price}` : ' sold'}. Track the transfer at: ${sellerLink}\n\nReply or email ${transfer.inbox_email} to update your transfer.\n\n— Nuke`,
        'seller', sent, skipped, errors,
      );
      await sendEmail({
        to: transfer.seller_email ?? '',
        subject: `Your ${vehicleName} sold — transfer started`,
        html: emailHtml({
          headline: `Your ${vehicleName} sold${price ? ` for ${price}` : ''}`,
          body: `Track every step of the handover, confirm milestones, and communicate with the buyer — all in one place.`,
          ctaText: 'Track your transfer',
          ctaUrl: sellerLink,
          footer: `Questions? Reply to this email or send a message to <a href="mailto:${transfer.inbox_email}">${transfer.inbox_email}</a> — it goes straight to your transfer thread.`,
        }),
        replyTo: transfer.inbox_email ?? undefined,
      }).then(r => recordEmailResult(r, 'seller', sent, skipped, errors));

    } else if (event === 'milestone_advanced' && milestone_type) {
      const label = MILESTONE_LABELS[milestone_type] ?? milestone_type.replace(/_/g, ' ');
      const actor = MILESTONE_ACTOR[milestone_type] ?? 'both';

      if (actor === 'buyer' || actor === 'both') {
        await sendSMS(
          transfer.buyer_phone,
          `Update on your ${vehicleName}: "${label}" — check what's next at ${buyerLink}\n\n— Nuke`,
          'buyer', sent, skipped, errors,
        );
      }
      if (actor === 'seller' || actor === 'both') {
        await sendSMS(
          transfer.seller_phone,
          `Update on your ${vehicleName}: "${label}" — check what's next at ${sellerLink}\n\n— Nuke`,
          'seller', sent, skipped, errors,
        );
      }

    } else if (event === 'stalled') {
      const stalledMsg = (link: string) =>
        `Action needed: your ${vehicleName} transfer has gone quiet. Check what's needed at ${link}\n\n— Nuke`;

      await sendSMS(transfer.buyer_phone, stalledMsg(buyerLink), 'buyer', sent, skipped, errors);
      await sendSMS(transfer.seller_phone, stalledMsg(sellerLink), 'seller', sent, skipped, errors);

    } else if (event === 'overdue') {
      const overdueLabel = milestone_type
        ? MILESTONE_LABELS[milestone_type] ?? milestone_type.replace(/_/g, ' ')
        : 'a required step';
      const actor = milestone_type ? (MILESTONE_ACTOR[milestone_type] ?? 'both') : 'both';

      const overdueMsg = (link: string) =>
        `Overdue on your ${vehicleName} transfer: "${overdueLabel}" is past its deadline. Take action at ${link}\n\n— Nuke`;

      if (actor === 'buyer' || actor === 'both') {
        await sendSMS(transfer.buyer_phone, overdueMsg(buyerLink), 'buyer', sent, skipped, errors);
      }
      if (actor === 'seller' || actor === 'both') {
        await sendSMS(transfer.seller_phone, overdueMsg(sellerLink), 'seller', sent, skipped, errors);
      }
    }

    console.log(`[notify-transfer-parties] transfer=${transfer_id} event=${event} sent=${sent.length} skipped=${skipped.length} errors=${errors.length}`);

    return json({ transfer_id, event, sent, skipped, errors });

  } catch (err) {
    console.error('[notify-transfer-parties] unexpected error:', err);
    return json({ error: String(err), sent, skipped, errors }, 500);
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function sendSMS(
  phone: string | null | undefined,
  message: string,
  recipient: 'buyer' | 'seller',
  sent: NotifyResult[],
  skipped: string[],
  errors: string[],
): Promise<void> {
  if (!phone) {
    skipped.push(`${recipient}:sms — no phone`);
    return;
  }
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    skipped.push(`${recipient}:sms — Twilio not configured`);
    return;
  }

  // Normalize to E.164 (US numbers)
  const normalized = phone.replace(/\D/g, '');
  const e164 = normalized.length === 10 ? `+1${normalized}` : `+${normalized}`;

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: e164, From: TWILIO_PHONE_NUMBER, Body: message }),
    });

    if (!res.ok) {
      const errText = await res.text();
      errors.push(`${recipient}:sms — Twilio ${res.status}: ${errText.slice(0, 200)}`);
      return;
    }

    const data = await res.json();
    sent.push({ recipient, channel: 'sms', status: 'sent', reason: data.sid });
  } catch (err) {
    errors.push(`${recipient}:sms — ${String(err)}`);
  }
}

function recordEmailResult(
  result: { success: boolean; id?: string; error?: string },
  recipient: 'buyer' | 'seller',
  sent: NotifyResult[],
  skipped: string[],
  errors: string[],
): void {
  if (!result.success && result.error === 'Email service not configured') {
    skipped.push(`${recipient}:email — Resend not configured`);
  } else if (!result.success) {
    errors.push(`${recipient}:email — ${result.error}`);
  } else {
    sent.push({ recipient, channel: 'email', status: 'sent', reason: result.id });
  }
}

// Simple transactional email template
function emailHtml(opts: {
  headline: string;
  body: string;
  ctaText: string;
  ctaUrl: string;
  footer?: string;
}): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;max-width:580px">
        <!-- Header -->
        <tr><td style="background:#111;padding:24px 32px">
          <span style="color:#fff;font-size:18px;font-weight:700;letter-spacing:-0.5px">nuke</span>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px">
          <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#111;line-height:1.3">${opts.headline}</h1>
          <p style="margin:0 0 28px;font-size:15px;line-height:1.6;color:#444">${opts.body}</p>
          <a href="${opts.ctaUrl}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 28px;border-radius:6px">${opts.ctaText}</a>
        </td></tr>
        <!-- Footer -->
        ${opts.footer ? `<tr><td style="padding:0 32px 28px;font-size:13px;color:#888;line-height:1.5">${opts.footer}</td></tr>` : ''}
        <tr><td style="padding:20px 32px;border-top:1px solid #eee;font-size:12px;color:#aaa">
          You received this because a vehicle transfer was created on your behalf. <a href="${FRONTEND_URL}" style="color:#888">nuke.ag</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
