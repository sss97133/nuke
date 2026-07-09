// derive-dispatch — the loop that makes Nuke conclude things instead of being told them.
//
// It is deliberately dumb. It knows nothing about titles, receipts, or photographs.
// It claims work from `derivation_queue`, looks up which reader the registry
// (`observation_extractors`) names for that work, invokes it AS THE OWNER, and records
// what came out. Adding a new kind of evidence is a row in two tables and one new
// edge function — never a change here.
//
//   evidence lands  -> trigger enqueues (enqueue_secure_document_derivation)
//   cron / agent    -> derive-dispatch claims a batch
//   dispatch        -> invokes observation_extractors.edge_function_name
//   the reader      -> emits cited observations via ingest-observation
//   ingest          -> fires analysis-engine-coordinator; projections recompute
//
// Compute belongs to the owner. The reader resolves credentials through runWithChain,
// so a user's own subscription pays first. `platform_credential` is an operator flag
// for backfills, which are our cost, not theirs.
//
// Contract:
//   POST { batch_size?: number, user_id?: string, platform_credential?: boolean }
//     → { claimed, done, failed, results: [...] }
//   service_role only. Cron calls it; the Ask-panel agent enqueues into it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const WORKER = `derive-dispatch-${crypto.randomUUID().slice(0, 8)}`;

// Evidence type → the argument name its reader expects. The reader owns its own
// contract; dispatch only has to know how to name the thing it is handing over.
const EVIDENCE_ARG: Record<string, string> = {
  secure_document: "document_id",
  vehicle_image: "image_id",
  receipt: "receipt_id",
  qb_transaction: "transaction_id",
  imessage_conversation: "conversation_id",
  email: "email_id",
  artifact: "artifact_id",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (roleOf(req.headers.get("Authorization")) !== "service_role") {
      return json({ error: "service_role required" }, 403);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const batchSize = Math.min(Math.max(Number(body.batch_size) || 5, 1), 25);
    const platformCredential = body.platform_credential === true;

    // Claim a batch. Claiming before working is what lets two workers run without
    // reading the same evidence twice.
    const { data: claimed, error: claimErr } = await admin.rpc("claim_derivation_work", {
      p_worker: WORKER,
      p_batch_size: batchSize,
      p_user_id: body.user_id ?? null,
    });
    if (claimErr) throw claimErr;
    if (!claimed?.length) return json({ claimed: 0, done: 0, failed: 0, results: [] });

    const results: unknown[] = [];
    let done = 0, failed = 0;

    for (const item of claimed) {
      try {
        // The registry decides who reads this. Dispatch never hardcodes a reader.
        const { data: extractor } = await admin
          .from("observation_extractors")
          .select("slug, edge_function_name, extractor_type, is_active")
          .eq("slug", item.extractor_slug)
          .maybeSingle();

        if (!extractor?.is_active || !extractor.edge_function_name) {
          await finish(admin, item.id, "skipped", { error: `no active reader for ${item.extractor_slug}` });
          results.push({ id: item.id, status: "skipped" });
          continue;
        }

        const argName = EVIDENCE_ARG[item.evidence_type];
        if (!argName) {
          await finish(admin, item.id, "skipped", { error: `no arg mapping for ${item.evidence_type}` });
          results.push({ id: item.id, status: "skipped" });
          continue;
        }

        const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/${extractor.edge_function_name}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            // The gateway rewrites Authorization between functions; prove we are the
            // dispatcher with the shared secret, not with a claim we don't control.
            "x-nuke-internal": Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
          },
          body: JSON.stringify({
            user_id: item.user_id,
            [argName]: item.evidence_id,
            limit: 1,
            dry_run: false,
            platform_credential: platformCredential,
          }),
        });
        const out = await res.json().catch(() => null);

        // A rate-limited subscription is not a failure. Put the work back with a
        // retry time and stop billing anyone for waiting.
        if (res.status === 429) {
          const retry = Number(out?.retry_after_seconds) || 900;
          await requeue(admin, item.id, retry, "rate limited on the owner's plan");
          results.push({ id: item.id, status: "requeued", retry_after_seconds: retry });
          continue;
        }
        if (res.status === 402) {
          await requeue(admin, item.id, 86400, out?.error ?? "no credential / no funds");
          results.push({ id: item.id, status: "requeued", reason: "needs credential" });
          continue;
        }

        const derived = out?.derived ?? [];
        if (!res.ok) {
          failed++;
          await finish(admin, item.id, "failed", { error: `reader ${res.status}`, attempts: item.attempts + 1 });
          results.push({ id: item.id, status: "failed", detail: out });
          continue;
        }

        done++;
        await finish(admin, item.id, "done", {
          observation_ids: derived.map((d: any) => d.observation_id).filter(Boolean),
          credential_source: derived[0]?.credential ?? null,
        });
        results.push({
          id: item.id, status: "done",
          observations: derived.length,
          asks_owner: derived.filter((d: any) => d.asks_owner).length,
        });
      } catch (e) {
        failed++;
        await finish(admin, item.id, "failed", { error: String(e instanceof Error ? e.message : e), attempts: item.attempts + 1 });
        results.push({ id: item.id, status: "failed" });
      }
    }

    // The registry records that it ran. `last_run_at` has been null on every row
    // since the table was created, because nothing ever drove it.
    const slugs = [...new Set(claimed.map((c: any) => c.extractor_slug))];
    for (const s of slugs) {
      await admin.from("observation_extractors")
        .update({ last_run_at: new Date().toISOString(), ...(failed === 0 ? { last_success_at: new Date().toISOString(), consecutive_failures: 0 } : {}) })
        .eq("slug", s);
    }

    return json({ claimed: claimed.length, done, failed, results });
  } catch (e) {
    console.error("[derive-dispatch]", e);
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});

async function finish(admin: any, id: string, status: string, extra: Record<string, unknown>) {
  await admin.from("derivation_queue").update({
    status,
    completed_at: status === "done" || status === "skipped" ? new Date().toISOString() : null,
    locked_at: null, locked_by: null,
    error_message: (extra.error as string) ?? null,
    observation_ids: (extra.observation_ids as string[]) ?? null,
    credential_source: (extra.credential_source as string) ?? null,
    ...(extra.attempts != null ? { attempts: extra.attempts } : {}),
  }).eq("id", id);
}

/** Back to pending with a delay. Retries are not failures. */
async function requeue(admin: any, id: string, delaySeconds: number, reason: string) {
  await admin.from("derivation_queue").update({
    status: "pending",
    locked_at: null, locked_by: null,
    next_attempt_at: new Date(Date.now() + delaySeconds * 1000).toISOString(),
    error_message: reason,
  }).eq("id", id);
}

function roleOf(authHeader: string | null): string | null {
  try {
    const tok = (authHeader ?? "").replace(/^Bearer\s+/i, "");
    const p = tok.split(".")[1];
    if (!p) return null;
    const pad = p + "=".repeat((4 - (p.length % 4)) % 4);
    return JSON.parse(atob(pad.replace(/-/g, "+").replace(/_/g, "/")))?.role ?? null;
  } catch { return null; }
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
