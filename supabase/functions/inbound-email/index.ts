/**
 * Inbound Email Webhook Handler
 *
 * Receives Resend inbound email webhooks (email.received events),
 * fetches full email content via Resend API, and stores in contact_inbox.
 *
 * Webhook URL: https://qkgaybvrernstplzjaam.supabase.co/functions/v1/inbound-email
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_URL = "https://api.resend.com";

// Valid nuke.ag addresses we accept
const VALID_ADDRESSES = [
  "privacy@nuke.ag",
  "legal@nuke.ag",
  "info@nuke.ag",
  "investors@nuke.ag",
  "support@nuke.ag",
  "hello@nuke.ag",
];

Deno.serve(async (req) => {
  // Only accept POST
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) {
    console.error("RESEND_API_KEY not configured");
    return new Response("Server configuration error", { status: 500 });
  }

  try {
    const event = await req.json();

    // Verify this is an email.received event
    if (event.type !== "email.received") {
      console.log(`Ignoring event type: ${event.type}`);
      return new Response(JSON.stringify({ ignored: true, type: event.type }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const data = event.data;
    const emailId = data.email_id;

    if (!emailId) {
      console.error("No email_id in webhook payload");
      return new Response("Missing email_id", { status: 400 });
    }

    console.log(`Processing inbound email: ${emailId}`);
    console.log(`  From: ${data.from}`);
    console.log(`  To: ${JSON.stringify(data.to)}`);
    console.log(`  Subject: ${data.subject}`);

    // Parse sender name and address
    const fromMatch = data.from?.match(/^(?:"?([^"]*)"?\s*)?<?([^>]+)>?$/);
    const fromName = fromMatch?.[1]?.trim() || null;
    const fromAddress = fromMatch?.[2]?.trim() || data.from;

    // Determine which nuke.ag address received it
    const toAddresses: string[] = Array.isArray(data.to) ? data.to : [data.to];
    const nukeAddress = toAddresses.find((addr: string) => addr.endsWith("@nuke.ag")) || toAddresses[0];

    // Fetch full email content from Resend API
    let bodyHtml: string | null = null;
    let bodyText: string | null = null;
    let headers: Record<string, string> | null = null;

    try {
      const emailRes = await fetch(`${RESEND_API_URL}/emails/${emailId}`, {
        headers: { Authorization: `Bearer ${resendApiKey}` },
      });

      if (emailRes.ok) {
        const emailContent = await emailRes.json();
        bodyHtml = emailContent.html || null;
        bodyText = emailContent.text || null;
        headers = emailContent.headers || null;
      } else {
        console.warn(`Failed to fetch email content: ${emailRes.status}`);
      }
    } catch (fetchErr) {
      console.warn("Error fetching email content:", fetchErr);
    }

    // Store in database
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: inserted, error } = await supabase
      .from("contact_inbox")
      .upsert(
        {
          email_id: emailId,
          message_id: data.message_id || null,
          from_address: fromAddress,
          from_name: fromName,
          to_address: nukeAddress,
          cc: data.cc || [],
          subject: data.subject || "(no subject)",
          body_text: bodyText,
          body_html: bodyHtml,
          attachments: data.attachments || [],
          in_reply_to: data.in_reply_to || null,
          thread_id: data.thread_id || null,
          headers: headers,
          status: "unread",
          received_at: data.created_at || new Date().toISOString(),
        },
        { onConflict: "email_id" }
      )
      .select("id")
      .single();

    if (error) {
      console.error("Database insert error:", error);
      // Return 200 anyway so Resend doesn't retry forever
      return new Response(
        JSON.stringify({ stored: false, error: error.message }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(`Stored email ${emailId} as ${inserted.id}`);

    return new Response(
      JSON.stringify({
        stored: true,
        id: inserted.id,
        from: fromAddress,
        to: nukeAddress,
        subject: data.subject,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Webhook processing error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
});
