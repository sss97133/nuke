/**
 * agent-email — Inter-agent messaging + real email via Resend
 *
 * Actions:
 *   POST { action: "send", from, to, subject, message, reply_to_id? }
 *   POST { action: "inbox", role, mark_read?, limit? }
 *   POST { action: "thread", thread_id }
 *   POST { action: "sent", role, limit? }
 *
 * Uses direct postgres (bypasses PostgREST) for reliability.
 */

import postgres from "https://deno.land/x/postgresjs@v3.4.5/mod.js";

const RESEND_API_URL = "https://api.resend.com/emails";

const ROLE_TO_EMAIL: Record<string, string> = {
  coo: "coo@nuke.ag", cto: "cto@nuke.ag", cfo: "cfo@nuke.ag",
  cpo: "cpo@nuke.ag", cdo: "cdo@nuke.ag", cwfto: "cwfto@nuke.ag",
  "vp-ai": "vp-ai@nuke.ag", "vp-extraction": "vp-extraction@nuke.ag",
  "vp-platform": "vp-platform@nuke.ag", "vp-vehicle-intel": "vp-vehicle-intel@nuke.ag",
  "vp-deal-flow": "vp-deal-flow@nuke.ag", "vp-orgs": "vp-orgs@nuke.ag",
  "vp-photos": "vp-photos@nuke.ag", "vp-docs": "vp-docs@nuke.ag",
  worker: "worker@nuke.ag", founder: "founder@nuke.ag",
};

const ROLE_DISPLAY: Record<string, string> = {
  coo: "COO", cto: "CTO", cfo: "CFO", cpo: "CPO", cdo: "CDO", cwfto: "CWFTO",
  "vp-ai": "VP AI", "vp-extraction": "VP Extraction", "vp-platform": "VP Platform",
  "vp-vehicle-intel": "VP Vehicle Intel", "vp-deal-flow": "VP Deal Flow",
  "vp-orgs": "VP Orgs", "vp-photos": "VP Photos", "vp-docs": "VP Docs",
  worker: "Worker", founder: "Founder", system: "Nuke System",
};

const ALL_ROLES = Object.keys(ROLE_TO_EMAIL).filter(r => r !== "founder");

function getSql() {
  const dbUrl = Deno.env.get("SUPABASE_DB_URL");
  if (!dbUrl) throw new Error("SUPABASE_DB_URL not set");
  return postgres(dbUrl, { max: 1 });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" },
    });
  }

  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const founderEmail = Deno.env.get("FOUNDER_EMAIL") || Deno.env.get("ADMIN_EMAIL");

  try {
    const body = await req.json();
    const { action } = body;
    const sql = getSql();

    // ── SEND ──────────────────────────────────────────────────────────────────
    if (action === "send") {
      const { from, to, subject, message, reply_to_id } = body;
      if (!from || !to || !subject || !message) {
        await sql.end();
        return json({ error: "Missing: from, to, subject, message" }, 400);
      }

      const fromDisplay = ROLE_DISPLAY[from] || from;
      const fromEmail = ROLE_TO_EMAIL[from] || `${from}@nuke.ag`;
      const recipients: string[] = to === "all" ? ALL_ROLES.filter(r => r !== from) : [to];
      const inserted: string[] = [];
      let resendId: string | null = null;

      // Get thread_id from parent if reply
      let threadId: string | null = null;
      if (reply_to_id) {
        const rows = await sql`SELECT thread_id FROM agent_messages WHERE id = ${reply_to_id}`;
        threadId = rows[0]?.thread_id || null;
      }

      for (const recipient of recipients) {
        const toEmail = recipient === "founder" ? founderEmail : ROLE_TO_EMAIL[recipient];
        const sentVia = recipient === "founder" && founderEmail ? "resend" : "internal";

        const rows = await sql`
          INSERT INTO agent_messages
            (from_role, to_role, from_email, to_email, subject, body, reply_to_id, thread_id, sent_via)
          VALUES
            (${from}, ${recipient}, ${fromEmail}, ${toEmail ?? null},
             ${subject}, ${message}, ${reply_to_id ?? null}, ${threadId ?? null}, ${sentVia})
          RETURNING id, thread_id
        `;

        const msg = rows[0];
        if (msg) inserted.push(msg.id);

        // Send real email to founder
        if (recipient === "founder" && founderEmail && resendApiKey) {
          const res = await fetch(RESEND_API_URL, {
            method: "POST",
            headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: `Nuke ${fromDisplay} <${fromEmail}>`,
              to: [founderEmail],
              subject,
              text: message,
              html: `<pre style="font-family:monospace;white-space:pre-wrap">${message}</pre>`,
              reply_to: fromEmail,
            }),
          });
          const rd = await res.json();
          resendId = rd.id || null;
          if (msg) {
            await sql`UPDATE agent_messages SET resend_id = ${resendId} WHERE id = ${msg.id}`;
          }
          console.log(`[agent-email] ${from} → founder via Resend: ${resendId}`);
        }
      }

      await sql.end();
      return json({ sent: true, recipients, message_ids: inserted, resend_id: resendId });
    }

    // ── INBOX ─────────────────────────────────────────────────────────────────
    if (action === "inbox") {
      const { role, mark_read = true, limit: lim = 20 } = body;
      if (!role) { await sql.end(); return json({ error: "Missing: role" }, 400); }

      const messages = await sql`
        SELECT id, thread_id, reply_to_id, from_role, to_role, subject, body, created_at, read_at
        FROM agent_messages
        WHERE to_role = ${role} AND read_at IS NULL
        ORDER BY created_at DESC
        LIMIT ${lim}
      `;

      if (mark_read && messages.length > 0) {
        const ids = messages.map((m: Record<string, string>) => m.id);
        await sql`UPDATE agent_messages SET read_at = NOW() WHERE id = ANY(${ids})`;
      }

      await sql.end();
      return json({
        role, unread: messages.length,
        messages: messages.map((m: Record<string, string>) => ({
          id: m.id, thread_id: m.thread_id,
          from: m.from_role, subject: m.subject,
          body: m.body, received_at: m.created_at,
        })),
      });
    }

    // ── THREAD ────────────────────────────────────────────────────────────────
    if (action === "thread") {
      const { thread_id } = body;
      if (!thread_id) { await sql.end(); return json({ error: "Missing: thread_id" }, 400); }
      const messages = await sql`
        SELECT * FROM agent_messages WHERE thread_id = ${thread_id} ORDER BY created_at
      `;
      await sql.end();
      return json({ thread_id, messages });
    }

    // ── SENT ──────────────────────────────────────────────────────────────────
    if (action === "sent") {
      const { role, limit: lim = 10 } = body;
      if (!role) { await sql.end(); return json({ error: "Missing: role" }, 400); }
      const messages = await sql`
        SELECT id, thread_id, from_role, to_role, subject, created_at
        FROM agent_messages WHERE from_role = ${role}
        ORDER BY created_at DESC LIMIT ${lim}
      `;
      await sql.end();
      return json({ role, messages });
    }

    await sql.end();
    return json({ error: `Unknown action: ${action}` }, 400);

  } catch (err) {
    console.error("[agent-email] error:", err);
    return json({ error: String(err) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}
