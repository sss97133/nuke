/**
 * Reply to Inbound Email
 *
 * Sends a reply via Resend and updates the contact_inbox record.
 * Called from the admin inbox UI.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const RESEND_API_URL = "https://api.resend.com/emails";

// Map incoming address to reply-from address
const REPLY_FROM: Record<string, string> = {
  "privacy@nuke.ag": "Nuke Privacy <privacy@nuke.ag>",
  "legal@nuke.ag": "Nuke Legal <legal@nuke.ag>",
  "info@nuke.ag": "Nuke <info@nuke.ag>",
  "investors@nuke.ag": "Nuke Investor Relations <investors@nuke.ag>",
  "support@nuke.ag": "Nuke Support <support@nuke.ag>",
  "hello@nuke.ag": "Nuke <hello@nuke.ag>",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) {
    return new Response(
      JSON.stringify({ error: "RESEND_API_KEY not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    // Verify auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify user from JWT
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { inbox_id, reply_html, reply_text } = await req.json();

    if (!inbox_id || (!reply_html && !reply_text)) {
      return new Response(
        JSON.stringify({ error: "Missing inbox_id or reply content" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get the original email
    const { data: original, error: fetchError } = await supabase
      .from("contact_inbox")
      .select("*")
      .eq("id", inbox_id)
      .single();

    if (fetchError || !original) {
      return new Response(
        JSON.stringify({ error: "Email not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Determine from address
    const fromAddr = REPLY_FROM[original.to_address] || `Nuke <${original.to_address}>`;

    // Send reply via Resend
    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddr,
        to: [original.from_address],
        subject: original.subject.startsWith("Re: ")
          ? original.subject
          : `Re: ${original.subject}`,
        html: reply_html || `<p>${reply_text}</p>`,
        text: reply_text || undefined,
        reply_to: original.to_address,
        headers: {
          "In-Reply-To": original.message_id || undefined,
          References: original.message_id || undefined,
        },
      }),
    });

    const resendData = await res.json();

    if (!res.ok) {
      console.error("Resend reply error:", resendData);
      return new Response(
        JSON.stringify({ error: resendData.message || "Failed to send reply" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update inbox record
    await supabase
      .from("contact_inbox")
      .update({
        status: "replied",
        replied_at: new Date().toISOString(),
        replied_by: user.id,
        reply_resend_id: resendData.id,
      })
      .eq("id", inbox_id);

    return new Response(
      JSON.stringify({ success: true, resend_id: resendData.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Reply error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
