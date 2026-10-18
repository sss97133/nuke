/**
 * Reply to Inbound Email: the work behind index.ts, after requireWriteAuth.
 *
 * Sends a reply via Resend from the nuke.ag address the email came to, and marks the contact_inbox record replied.
 * Called from the admin inbox UI. Only the service key or an active admin may send (requireAdminOrService), and that
 * is judged before anything else: before the request body is read, before the inbox row is looked up, before Resend.
 * Any other caller, signed in or not, gets a 403. Sign-up is open and anonymous sign-in is on, so "signed in" alone
 * let anyone mail Nuke's correspondents from Nuke's addresses (2026-10-14).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { authenticateWriter, requireAdminOrService, type WriteGuardDeps } from "../_shared/writeGuard.ts";
import { projectSecretKey } from "../_shared/supabaseKeys.ts";

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

/** Test seams: the environment and every outbound call (the guard's lookups, the database, Resend). */
export interface ReplyDeps {
  env?: (name: string) => string | undefined;
  fetch?: typeof fetch;
  /** unix seconds */
  now?: () => number;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

export async function handleReplyEmail(req: Request, deps: ReplyDeps = {}): Promise<Response> {
  const env = deps.env ?? ((name: string) => Deno.env.get(name));
  const doFetch = deps.fetch ?? fetch;
  const guardDeps: WriteGuardDeps = { env, fetch: doFetch, ...(deps.now ? { now: deps.now } : {}) };

  // The service key or an active admin, before anything else.
  const notAdmin = await requireAdminOrService(req, { headers: corsHeaders, deps: guardDeps });
  if (notAdmin) return notAdmin;
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const resendApiKey = env("RESEND_API_KEY");
  if (!resendApiKey) {
    return json({ error: "RESEND_API_KEY not configured" }, 500);
  }

  try {
    // The replier: the admin's user id, or nobody for the service key.
    const verdict = await authenticateWriter(req, { deps: guardDeps });
    const repliedBy = verdict.ok && verdict.caller.kind === "user" ? verdict.caller.userId : null;

    const supabase = createClient(env("SUPABASE_URL")!, projectSecretKey(env)!, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: doFetch },
    });

    const { inbox_id, reply_html, reply_text } = await req.json();

    if (!inbox_id || (!reply_html && !reply_text)) {
      return json({ error: "Missing inbox_id or reply content" }, 400);
    }

    // Get the original email
    const { data: original, error: fetchError } = await supabase
      .from("contact_inbox")
      .select("*")
      .eq("id", inbox_id)
      .single();

    if (fetchError || !original) {
      return json({ error: "Email not found" }, 404);
    }

    // Determine from address
    const fromAddr = REPLY_FROM[original.to_address] || `Nuke <${original.to_address}>`;

    // Send reply via Resend
    const res = await doFetch(RESEND_API_URL, {
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
      return json({ error: resendData.message || "Failed to send reply" }, 500);
    }

    // Update inbox record
    await supabase
      .from("contact_inbox")
      .update({
        status: "replied",
        replied_at: new Date().toISOString(),
        replied_by: repliedBy,
        reply_resend_id: resendData.id,
      })
      .eq("id", inbox_id);

    return json({ success: true, resend_id: resendData.id }, 200);
  } catch (err) {
    console.error("Reply error:", err);
    return json({ error: String(err) }, 500);
  }
}
