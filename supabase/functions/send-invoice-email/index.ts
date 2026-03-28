/**
 * send-invoice-email — Send a rendered invoice email via Resend
 *
 * POST { to, subject, customer_name, vehicle_title, invoice_number,
 *        invoice_date, total, paid, balance, line_items }
 *
 * Builds a clean HTML invoice email from structured data, sends via Resend,
 * and updates the generated_invoices.sent_at timestamp.
 */

import { corsHeaders } from "../_shared/cors.ts";
import { sendEmail } from "../_shared/email.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface LineItem {
  description: string;
  amount: number;
}

interface InvoicePayload {
  to: string;
  subject: string;
  customer_name?: string;
  vehicle_title?: string;
  invoice_number: string;
  invoice_date: string;
  total: number;
  paid: number;
  balance: number;
  line_items?: LineItem[];
}

function fmt(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildInvoiceHtml(p: InvoicePayload): string {
  const rows = (p.line_items || [])
    .map(
      (li) => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #e0e0e0;font-size:14px;">${li.description}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e0e0e0;font-size:14px;text-align:right;font-family:'Courier New',monospace;">${fmt(li.amount)}</td>
      </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:24px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border:2px solid #1a1a1a;">
        <!-- Header -->
        <tr>
          <td style="padding:20px 24px;border-bottom:2px solid #1a1a1a;">
            <table width="100%"><tr>
              <td>
                <div style="font-size:20px;font-weight:700;letter-spacing:0.08em;">NUKE</div>
                <div style="font-size:11px;color:#888;font-family:'Courier New',monospace;">Vehicle Build Services</div>
              </td>
              <td style="text-align:right;">
                <div style="font-size:14px;font-weight:700;letter-spacing:0.08em;">INVOICE</div>
                <div style="font-size:11px;color:#888;font-family:'Courier New',monospace;">${p.invoice_number}</div>
                <div style="font-size:11px;color:#888;font-family:'Courier New',monospace;">${p.invoice_date}</div>
              </td>
            </tr></table>
          </td>
        </tr>

        <!-- Bill To / Vehicle -->
        <tr>
          <td style="padding:16px 24px;">
            <table width="100%"><tr>
              <td style="vertical-align:top;">
                <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#888;margin-bottom:4px;">VEHICLE</div>
                <div style="font-size:14px;font-weight:700;">${p.vehicle_title || "Vehicle"}</div>
              </td>
              <td style="text-align:right;vertical-align:top;">
                <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#888;margin-bottom:4px;">BILL TO</div>
                <div style="font-size:14px;font-weight:700;">${p.customer_name || ""}</div>
              </td>
            </tr></table>
          </td>
        </tr>

        <!-- Line Items -->
        <tr>
          <td style="padding:0 24px 16px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr style="border-bottom:2px solid #1a1a1a;">
                <th style="padding:6px 8px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#888;border-bottom:2px solid #1a1a1a;">Description</th>
                <th style="padding:6px 8px;text-align:right;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#888;border-bottom:2px solid #1a1a1a;">Amount</th>
              </tr>
              ${rows}
            </table>
          </td>
        </tr>

        <!-- Totals -->
        <tr>
          <td style="padding:0 24px 20px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border-top:2px solid #1a1a1a;padding-top:12px;">
              <tr>
                <td style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#888;padding:3px 8px;">Subtotal</td>
                <td style="text-align:right;font-family:'Courier New',monospace;font-size:14px;padding:3px 8px;">${fmt(p.total)}</td>
              </tr>
              ${p.paid > 0 ? `<tr>
                <td style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#004225;padding:3px 8px;">Payments Received</td>
                <td style="text-align:right;font-family:'Courier New',monospace;font-size:14px;color:#004225;padding:3px 8px;">(${fmt(p.paid)})</td>
              </tr>` : ""}
              <tr>
                <td style="font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;padding:8px 8px 3px;border-top:1px solid #e0e0e0;">Balance Due</td>
                <td style="text-align:right;font-family:'Courier New',monospace;font-size:18px;font-weight:700;padding:8px 8px 3px;border-top:1px solid #e0e0e0;color:${p.balance > 0 ? "#C8102E" : "#004225"};">${fmt(p.balance)}</td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:12px 24px;border-top:2px solid #1a1a1a;font-size:10px;color:#888;text-align:center;font-family:'Courier New',monospace;">
            Questions? Reply to this email or contact us at nuke.ag
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const payload: InvoicePayload = await req.json();
    const { to, subject, invoice_number } = payload;

    if (!to || !subject || !invoice_number) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: to, subject, invoice_number" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build HTML email from structured data
    const html = buildInvoiceHtml(payload);

    // Send via Resend
    const result = await sendEmail({ to, subject, html, replyTo: "skylar@nuke.ag" });

    if (!result.success) {
      console.error("[send-invoice-email] Resend failed:", result.error);
      return new Response(
        JSON.stringify({ error: result.error }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update sent_at on the generated_invoices record (safety net — frontend also sets this)
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const sb = createClient(supabaseUrl, serviceKey);

      await sb
        .from("generated_invoices")
        .update({ sent_at: new Date().toISOString(), status: "sent" })
        .eq("invoice_number", invoice_number);
    } catch (dbErr) {
      // Non-fatal — email already sent, log and continue
      console.warn("[send-invoice-email] DB update failed (email was sent):", dbErr);
    }

    console.log(`[send-invoice-email] Sent to ${to} — invoice ${invoice_number} — resend_id ${result.id}`);

    return new Response(
      JSON.stringify({ success: true, resend_id: result.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[send-invoice-email] error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
