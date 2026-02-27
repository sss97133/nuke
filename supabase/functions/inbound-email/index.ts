/**
 * Inbound Email Webhook Handler
 *
 * Receives Resend inbound email webhooks (email.received events),
 * fetches full email content via Resend API, and stores in contact_inbox.
 *
 * Routing:
 *   - alerts@nuke.ag → process-alert-email (extracts listing URLs → import_queue)
 *   - coo@nuke.ag, cto@nuke.ag, etc. → agent_messages table
 *   - all others → contact_inbox only
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
  // Vehicle listing alert forwarding — routes to process-alert-email → import_queue
  "alerts@nuke.ag",
  // Agent addresses — routed to agent_messages
  "coo@nuke.ag",
  "cto@nuke.ag",
  "cfo@nuke.ag",
  "cpo@nuke.ag",
  "cdo@nuke.ag",
  "cwfto@nuke.ag",
  "vp-ai@nuke.ag",
  "vp-extraction@nuke.ag",
  "vp-platform@nuke.ag",
  "vp-vehicle-intel@nuke.ag",
  "vp-deal-flow@nuke.ag",
  "vp-orgs@nuke.ag",
  "vp-photos@nuke.ag",
  "vp-docs@nuke.ag",
  "worker@nuke.ag",
];

// Map email address → agent role
const EMAIL_TO_ROLE: Record<string, string> = {
  "coo@nuke.ag": "coo",
  "cto@nuke.ag": "cto",
  "cfo@nuke.ag": "cfo",
  "cpo@nuke.ag": "cpo",
  "cdo@nuke.ag": "cdo",
  "cwfto@nuke.ag": "cwfto",
  "vp-ai@nuke.ag": "vp-ai",
  "vp-extraction@nuke.ag": "vp-extraction",
  "vp-platform@nuke.ag": "vp-platform",
  "vp-vehicle-intel@nuke.ag": "vp-vehicle-intel",
  "vp-deal-flow@nuke.ag": "vp-deal-flow",
  "vp-orgs@nuke.ag": "vp-orgs",
  "vp-photos@nuke.ag": "vp-photos",
  "vp-docs@nuke.ag": "vp-docs",
  "worker@nuke.ag": "worker",
};

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

    // Parse sender name and address from "Name <email>" or bare "email"
    let fromName: string | null = null;
    let fromAddress: string = data.from || "";
    const angleMatch = data.from?.match(/^(.*?)\s*<([^>]+)>$/);
    if (angleMatch) {
      fromName = angleMatch[1].replace(/^["']|["']$/g, "").trim() || null;
      fromAddress = angleMatch[2].trim();
    }

    // Determine which nuke.ag address received it
    const toAddresses: string[] = Array.isArray(data.to) ? data.to : [data.to];
    const nukeAddress = toAddresses.find((addr: string) => addr.endsWith("@nuke.ag")) || toAddresses[0];

    // Prefer body content from webhook payload directly (available immediately).
    // Also attempt to fetch full email content from Resend API for headers and
    // richer content — but fall back gracefully if the API key lacks read scope.
    let bodyHtml: string | null = data.html || null;
    let bodyText: string | null = data.text || null;
    let headers: Record<string, string> | null = null;

    try {
      const emailRes = await fetch(`${RESEND_API_URL}/emails/receiving/${emailId}`, {
        headers: { Authorization: `Bearer ${resendApiKey}` },
      });

      if (emailRes.ok) {
        const emailContent = await emailRes.json();
        // Prefer API response (richer) over webhook payload for content
        bodyHtml = emailContent.html || bodyHtml;
        bodyText = emailContent.text || bodyText;
        headers = emailContent.headers || null;
        // Use the API's from field if available (more reliable)
        if (emailContent.from) {
          const apiAngle = emailContent.from.match(/^(.*?)\s*<([^>]+)>$/);
          if (apiAngle) {
            fromName = apiAngle[1].replace(/^["']|["']$/g, "").trim() || fromName;
            fromAddress = apiAngle[2].trim();
          } else {
            fromAddress = emailContent.from;
          }
        }
      } else {
        console.warn(`Failed to fetch email content: ${emailRes.status} — using webhook payload body`);
      }
    } catch (fetchErr) {
      console.warn("Error fetching email content (using webhook payload body):", fetchErr);
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

    // Route to agent_messages if addressed to an agent
    const agentRole = EMAIL_TO_ROLE[nukeAddress];
    if (agentRole) {
      const senderName = fromName || fromAddress.split("@")[0];
      await supabase.from("agent_messages").insert({
        from_role: "founder",
        to_role: agentRole,
        from_email: fromAddress,
        to_email: nukeAddress,
        subject: data.subject || "(no subject)",
        body: bodyText || bodyHtml || "(no body)",
        sent_via: "resend",
        metadata: { contact_inbox_id: inserted.id, sender_name: senderName },
      });
      console.log(`[inbound-email] Routed to agent_messages for role: ${agentRole}`);
    }

    // Route alerts@nuke.ag to process-alert-email → import_queue
    // Gmail forwarding: user forwards toymachine91@gmail.com alerts to alerts@nuke.ag
    if (nukeAddress === "alerts@nuke.ag") {
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const alertRes = await fetch(`${supabaseUrl}/functions/v1/process-alert-email`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: fromAddress,
            to: nukeAddress,
            subject: data.subject || "",
            html: bodyHtml || "",
            text: bodyText || "",
            messageId: emailId,
          }),
        });
        const alertResult = await alertRes.json().catch(() => ({}));
        console.log(`[inbound-email] alerts routing → process-alert-email: queued=${alertResult.queued ?? 0}, source=${alertResult.source ?? "unknown"}`);
      } catch (alertErr) {
        console.warn("[inbound-email] Failed to forward to process-alert-email:", alertErr);
      }
    }

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
