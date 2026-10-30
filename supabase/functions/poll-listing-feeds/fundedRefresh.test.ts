import { assertEquals } from "jsr:@std/assert@1";
import { dispatchFundedRefresh, fundedOutcome } from "./fundedRefresh.ts";

const target = { source: "fixture", attempted_at: "2026-10-30T00:00:00Z", state: "completed",
  counts: { queue_rows_acknowledged: 2, landed_ledger_acknowledged: 1 } };
const run = (targets: any[], status = "completed") => ({ status, metadata: { contract: "source_intake_run_v1", targets } });
Deno.test("paid refresh completion requires same-source acknowledged child work", () => {
  assertEquals(fundedOutcome(null, "fixture").status, "needs_review");
  assertEquals(fundedOutcome(run([target]), "other").status, "needs_review");
  assertEquals(fundedOutcome(run([target], "running"), "fixture").status, "needs_review");
});

function queueFixture(enabled = true) {
  const policy = { enabled, sources: { fixture: { enabled: true, needs_funding: false, feed_source: "fixture",
    provider: "anthropic", amount_cents: 300, max_ingests: 2, replenishment_mode: "provider_auto_reload",
    billing_verified: true, billing_reference: "fixture-billing" } } };
  const requests: any[] = [{ id: "funded-request", source: "source-refresh-funding", status: "funded",
    started_at: "2026-10-30T00:00:00Z", metadata: { source: "fixture", feed_source: "fixture", provider: "anthropic",
      amount_cents: 300, max_ingests: 2, billing_reference: "fixture-billing" } }];
  const db = { from(table: string) {
    const filters: ((r: any) => boolean)[] = []; let update: any; let limit = Infinity;
    const records = () => table === "extraction_runs" ? requests : table === "platform_config"
      ? [{ config_key: "source_refresh_funding", config_value: policy }] : [{ id: "feed", enabled: true, source_slug: "fixture" }];
    const get = (r: any, k: string) => k.startsWith("metadata->>") ? r.metadata?.[k.slice(11)] : r[k];
    const execute = () => {
      const rows = records().filter(r => filters.every(f => f(r))).slice(0, limit);
      if (update) for (const row of rows) Object.assign(row, update);
      return { data: structuredClone(rows) };
    };
    const q: any = { select: () => q, order: () => q, limit: (n: number) => { limit = n; return q; },
      eq: (k: string, v: any) => { filters.push(r => get(r, k) === v); return q; },
      in: (k: string, vs: any[]) => { filters.push(r => vs.includes(get(r, k))); return q; },
      update: (value: any) => { update = value; return q; },
      maybeSingle: async () => { const x = execute(); return { data: x.data[0] ?? null }; },
      then: (resolve: any) => Promise.resolve(execute()).then(resolve) };
    return q;
  } };
  return { db, requests };
}

Deno.test("concurrent schedules dispatch one funded request once and reconcile a lost response", async () => {
  const f = queueFixture(); let calls = 0;
  const fetcher = async (_url: any, init: any) => {
    calls++;
    const body = JSON.parse(init.body);
    assertEquals(body.source, "fixture"); assertEquals(body.batch_size, 1); assertEquals(body.max_ingests, 2);
    assertEquals(body.force, undefined);
    f.requests.push({ id: body.intake_run_id, source: "poll-listing-feeds", ...run([target]) });
    throw new Error("response lost after child work was retained");
  };
  await Promise.all([dispatchFundedRefresh(f.db, fetcher as typeof fetch), dispatchFundedRefresh(f.db, fetcher as typeof fetch)]);
  assertEquals(calls, 1); assertEquals(f.requests[0].status, "completed");
  await dispatchFundedRefresh(f.db, fetcher as typeof fetch); assertEquals(calls, 1);
});

Deno.test("disabled source never dispatches; unknown child outcome is retained for review without another attempt", async () => {
  const held = queueFixture(false); let calls = 0;
  const fail = async () => { calls++; throw new Error("unknown delivery"); };
  await dispatchFundedRefresh(held.db, fail as typeof fetch); assertEquals(calls, 0);
  assertEquals(held.requests[0].status, "funded");
  const f = queueFixture();
  await dispatchFundedRefresh(f.db, fail as typeof fetch);
  assertEquals(f.requests[0].status, "needs_review");
  await dispatchFundedRefresh(f.db, fail as typeof fetch); assertEquals(calls, 1);
});
Deno.test("scheduled waits remain funded; failed or uncertain attempts never trigger another paid attempt", () => {
  assertEquals(fundedOutcome(run([]), "fixture").status, "funded");
  assertEquals(fundedOutcome(run([{ ...target, attempted_at: null, state: "deferred" }]), "fixture").status, "funded");
  assertEquals(fundedOutcome(run([{ ...target, state: "failed" }]), "fixture").status, "needs_review");
  assertEquals(fundedOutcome(run([{ ...target, counts: {} }]), "fixture").status, "needs_review");
  assertEquals(fundedOutcome(run([target]), "fixture"), { status: "completed",
    result: { reason: "feed_refresh_completed", queued: 2, ingested: 1 } });
});
