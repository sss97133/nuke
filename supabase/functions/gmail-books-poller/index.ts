/** Inactive until separate release approval. See docs/work-money-ingest.md. */
import { isServiceCaller, requireWriteAuth } from "../_shared/writeGuard.ts";
import { projectSecretKey } from "../_shared/supabaseKeys.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { type Job, VERSION } from "./core.ts";
import { poll } from "./poller.ts";

Deno.serve(async (req) => {
  const denied = await requireWriteAuth(req);
  if (denied) return denied;
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  // Ordinary user JWTs cannot read the operator mailbox or choose its owner.
  if (!await isServiceCaller(req)) return reply({ error: "service_only" }, 403);
  if (req.method !== "POST") return reply({ error: "post_required" }, 405);
  try {
    const input = await req.json();
    const dryRun = input.dry_run !== false;
    if (!dryRun && Deno.env.get("WORK_MONEY_INGEST_ENABLED") !== "true") {
      return reply({ error: "ingest_disabled" }, 409);
    }
    const owner = Deno.env.get("WORK_MONEY_OWNER_ID");
    const mailbox = Deno.env.get("WORK_MONEY_MAILBOX");
    const accountants = (Deno.env.get("WORK_MONEY_ACCOUNTANT_SENDERS") ?? "")
      .split(",").map((s) => s.trim()).filter(Boolean);
    if (!owner || !mailbox || !accountants.length) {
      return reply({ error: "missing_owner_mailbox_or_senders" }, 503);
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const key = projectSecretKey()!;
    const db = async (path: string, body?: unknown) => {
      const r = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) throw new Error("database_request_failed");
      const text = await r.text();
      return text ? JSON.parse(text) : null;
    };
    const rpc = (name: string, body: unknown) => db(`rpc/${name}`, body);
    const backfill = input.after !== undefined || input.before !== undefined;
    if (backfill && (!input.after || !input.before)) {
      return reply({ error: "backfill_requires_both_bounds" }, 400);
    }
    let covered: string | undefined;
    if (!backfill) {
      const health = await db(
        `work_money_source_health?owner_id=eq.${
          encodeURIComponent(owner)
        }&source=eq.gmail&select=covered_through`,
      );
      covered = health[0]?.covered_through;
    }
    const before = new Date(input.before ?? Date.now()).toISOString();
    const after = new Date(
      input.after ??
        (covered ? Date.parse(covered) - 86400000 : Date.now() - 7 * 86400000),
    ).toISOString();
    if (Date.parse(before) > Date.now() + 60000) {
      return reply({ error: "future_window" }, 400);
    }
    // Refresh lazily INSIDE the recorded scan, so OAuth failures produce failed health receipts.
    let token: string | undefined;
    const gmail = async (path: string) => {
      if (!token) {
        const clientId = Deno.env.get("GOOGLE_CLIENT_ID"),
          secret = Deno.env.get("GOOGLE_CLIENT_SECRET"),
          refresh = Deno.env.get("GOOGLE_REFRESH_TOKEN");
        if (!clientId || !secret || !refresh) throw new Error("missing_oauth");
        const r = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: secret,
            refresh_token: refresh,
            grant_type: "refresh_token",
          }),
          signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) throw new Error("oauth_failed");
        token = (await r.json()).access_token;
        if (!token) throw new Error("oauth_failed");
        const profile = await fetch( // guardrail-allow: raw-fetch -- private Gmail JSON API
          "https://gmail.googleapis.com/gmail/v1/users/me/profile",
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(15000),
          },
        ); // guardrail-allow: raw-fetch -- private Gmail JSON API, never archive mailbox data publicly
        if (
          !profile.ok ||
          (await profile.json()).emailAddress?.toLowerCase() !==
            mailbox.toLowerCase()
        ) throw new Error("mailbox_mismatch");
      }
      const r = await fetch( // guardrail-allow: raw-fetch -- private Gmail JSON API
        `https://gmail.googleapis.com/gmail/v1/users/me/${path}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(15000),
        },
      ); // guardrail-allow: raw-fetch -- private Gmail JSON API, not page scraping
      if (!r.ok) throw new Error("gmail_read_failed");
      return r.json();
    };
    const result = await poll({
      dryRun,
      after,
      before,
      config: { accountantSenders: accountants },
    }, {
      jobs: () =>
        rpc("work_money_candidate_jobs", { p_owner: owner }) as Promise<Job[]>,
      list: (query, page) =>
        gmail(
          `messages?${new URLSearchParams({
            q: query,
            maxResults: "50",
            ...(page ? { pageToken: page } : {}),
          })}`,
        ),
      message: (id) => gmail(`messages/${encodeURIComponent(id)}?format=full`),
      start: () =>
        rpc("work_money_run_start", {
          p_owner: owner,
          p_source: "gmail",
          p_mode: backfill ? "backfill" : "poll",
          p_after: after,
          p_before: before,
        }),
      stage: async (run, email, signal, proposals, sha) =>
        !!await rpc("stage_work_money_email", {
          p_run: run,
          p_email: email,
          p_signal: signal,
          p_proposals: proposals,
          p_sha: sha,
          p_version: VERSION,
        }),
      finish: (run, success, scanned, staged, last, error) =>
        rpc("work_money_run_finish", {
          p_run: run,
          p_success: success,
          p_scanned: scanned,
          p_staged: staged,
          p_last_message: last,
          p_error: error,
        }),
    });
    return reply(result);
  } catch {
    return reply({
      error: "scan_failed",
      detail:
        "Check source health and configuration; no successful coverage advanced.",
    }, 500);
  }
});
