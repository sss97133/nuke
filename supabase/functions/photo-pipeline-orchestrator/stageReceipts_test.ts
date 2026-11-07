import { buildStageReceipt, rateLimitRetrySeconds, recordStageReceipt, unavailableReceipts, UNAVAILABLE_RETRY_SECONDS } from "./stageReceipts.ts";
import { runStageWorker, type WorkItem } from "./stageWorker.ts";

function eq(a: unknown, b: unknown) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); }

Deno.test("rate_limited carries the retry time from the #3025 backoff, clamped", () => {
  const now = Date.parse("2026-11-07T00:00:00Z");
  eq(rateLimitRetrySeconds({ next_attempt_at: "2026-11-07T00:02:00Z" }, { retry_after_seconds: 5 }, now), 120);
  eq(rateLimitRetrySeconds(null, { retry_after_seconds: 30 }, now), 30);
  eq(rateLimitRetrySeconds(null, undefined, now), null);
  const r = buildStageReceipt("img", "classifier", "rate_limited", { retryAfterSeconds: 999999, httpStatus: 429 })!;
  eq([r.p_outcome, r.p_retry_after_seconds, r.p_error_class, r.p_producer_version], ["rate_limited", 86400, "classifier_rate_limited", 1]);
});

Deno.test("retry time never rides on a non-retryable outcome; failures always typed", () => {
  const ok = buildStageReceipt("img", "classifier", "succeeded", { retryAfterSeconds: 60 })!;
  eq([ok.p_retry_after_seconds, ok.p_error_class], [null, null]);
  const f = buildStageReceipt("img", "classifier", "failed", { retryAfterSeconds: 60 })!;
  eq([f.p_retry_after_seconds, f.p_error_class], [null, "stage_failed"]);
  eq(buildStageReceipt("img", "no_such_stage", "succeeded"), null);
  eq(buildStageReceipt("", "classifier", "succeeded"), null);
});

Deno.test("undeployed functions become unavailable receipts on registry stage names; unknown names ignored", () => {
  const rs = unavailableReceipts("img", ["analyze-engine-bay", "mystery-fn"]);
  eq(rs.length, 1);
  eq([rs[0].p_stage, rs[0].p_outcome, rs[0].p_retry_after_seconds, rs[0].p_error_class], ["engine_bay", "unavailable", UNAVAILABLE_RETRY_SECONDS, "edge_function_not_deployed"]);
  eq(unavailableReceipts("img", undefined), []);
});

Deno.test("recordStageReceipt is best effort: rpc error or throw returns false, never throws", async () => {
  const r = buildStageReceipt("img", "classifier", "succeeded");
  eq(await recordStageReceipt({ rpc: () => Promise.resolve({ error: { code: "42501" } }) }, r), false);
  eq(await recordStageReceipt({ rpc: () => { throw new Error("x"); } }, r), false);
  eq(await recordStageReceipt({ rpc: () => Promise.resolve({ error: null }) }, r), true);
  eq(await recordStageReceipt({ rpc: () => Promise.resolve({ error: null }) }, null), false);
});

// ---- worker
function fakeDb(o: { enabled?: boolean; blockedUntil?: string | null; queue?: WorkItem[]; onBlockCheck?: () => void }) {
  const queue = [...(o.queue ?? [])]; const claims: unknown[] = [];
  const table = (t: string) => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(
    t === "platform_config" ? { data: { config_value: { enabled: o.enabled ?? false } } }
      : { data: { blocked_until: o.blockedUntil ?? null, max_concurrency: 8 } }) }) }) });
  return { claims, db: { from: table, rpc: (fn: string, args: Record<string, unknown>) => { claims.push([fn, args]); return Promise.resolve({ data: queue.splice(0, 1), error: null }); } } };
}
const item = (n: number): WorkItem => ({ work_id: n, image_id: `img${n}`, image_url: "u", user_id: null, vehicle_id: null, lane: "live" });
const noSleep = () => Promise.resolve();

Deno.test("worker is inert when the flag is off: no claim", async () => {
  const f = fakeDb({ enabled: false, queue: [item(1)] });
  const out = await runStageWorker(f.db, { stage: "classifier" }, () => { throw new Error("must not run"); }, Date.now, noSleep);
  eq((out as any).skipped, "disabled"); eq(f.claims.length, 0);
});

Deno.test("worker refuses an unsupported stage before claiming", async () => {
  const f = fakeDb({ enabled: true, queue: [item(1)] });
  const out = await runStageWorker(f.db, { stage: "exif" }, () => Promise.reject(new Error("no")), Date.now, noSleep);
  eq((out as any).error, "unsupported_stage"); eq(f.claims.length, 0);
});

Deno.test("worker respects the provider breaker: nothing claimed while blocked", async () => {
  const f = fakeDb({ enabled: true, blockedUntil: new Date(Date.now() + 600_000).toISOString(), queue: [item(1)] });
  const out = await runStageWorker(f.db, { stage: "classifier" }, () => { throw new Error("must not run"); }, Date.now, noSleep);
  eq((out as any).stopped, "provider_cooldown"); eq(f.claims.length, 0);
});

Deno.test("worker claims one at a time, is bounded by limit, and stops on a rate limit without stranding leases", async () => {
  const f = fakeDb({ enabled: true, queue: [item(1), item(2), item(3), item(4), item(5)] });
  const ran: string[] = [];
  const out: any = await runStageWorker(f.db, { stage: "classifier", limit: 2 }, (i) => { ran.push(i.image_id); return Promise.resolve({ ok: true }); }, Date.now, noSleep);
  eq(ran, ["img1", "img2"]); eq([out.attempted, out.processed, out.stopped], [2, 2, "limit"]);
  const g = fakeDb({ enabled: true, queue: [item(1), item(2), item(3)] });
  const out2: any = await runStageWorker(g.db, { stage: "classifier", limit: 8 }, () => Promise.resolve({ ok: false, rate_limited: true }), Date.now, noSleep);
  eq([out2.attempted, out2.stopped, g.claims.length], [1, "rate_limited", 1]);   // item 2,3 never claimed
});

Deno.test("worker stops at its deadline and reports an empty queue", async () => {
  let t = 0; const clock = () => (t += 60_000);
  const f = fakeDb({ enabled: true, queue: [item(1), item(2), item(3)] });
  const out: any = await runStageWorker(f.db, { stage: "classifier", limit: 8, deadline_ms: 100_000 }, () => Promise.resolve({ ok: true }), clock, noSleep);
  eq(out.stopped, "deadline");
  const e: any = await runStageWorker(fakeDb({ enabled: true }).db, { stage: "classifier" }, () => Promise.resolve({ ok: true }), Date.now, noSleep);
  eq(e.stopped, "queue_empty");
});
