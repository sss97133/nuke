import { runStageWorker, type WorkItem } from "./stageWorker.ts";

function assert(v: unknown): asserts v { if (!v) throw new Error("assertion failed"); }
const item = (n: number): WorkItem => ({ work_id: n, image_id: `img${n}`, image_url: "u", user_id: null, vehicle_id: null, lane: "live" });

function fakeDb(o: { enabled?: boolean; blockedUntil?: string | null; items?: WorkItem[]; claimError?: boolean } = {}) {
  const claims: string[] = []; const queue = [...(o.items ?? [])];
  const db = {
    from: (t: string) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => t === "platform_config"
      ? { data: { config_value: { enabled: o.enabled ?? true } } }
      : { data: o.blockedUntil === undefined ? null : { blocked_until: o.blockedUntil, max_concurrency: 8 } } }) }) }),
    rpc: async (fn: string, args: Record<string, unknown>) => { claims.push(`${fn}:${args.p_stage}`);
      return o.claimError ? { data: null, error: { code: "x" } } : { data: queue.splice(0, 1), error: null }; },
  };
  return { db, claims };
}
const noSleep = async () => {};
const future = () => new Date(Date.now() + 600_000).toISOString();

Deno.test("worker: disabled flag claims nothing", async () => {
  const { db, claims } = fakeDb({ enabled: false, items: [item(1)] });
  const out = await runStageWorker(db, {}, async () => ({ ok: true }), Date.now, noSleep) as { skipped?: string };
  assert(out.skipped === "disabled" && claims.length === 0);
});

Deno.test("worker: provider cooldown stops before claiming, so no lease is stranded", async () => {
  const { db, claims } = fakeDb({ blockedUntil: future(), items: [item(1)] });
  const out = await runStageWorker(db, {}, async () => ({ ok: true }), Date.now, noSleep) as { stopped: string; attempted: number };
  assert(out.stopped === "provider_cooldown" && out.attempted === 0 && claims.length === 0);
});

Deno.test("worker: an expired cooldown does not block", async () => {
  const { db } = fakeDb({ blockedUntil: new Date(Date.now() - 1000).toISOString(), items: [item(1)] });
  const out = await runStageWorker(db, {}, async () => ({ ok: true }), Date.now, noSleep) as { processed: number };
  assert(out.processed === 1);
});

Deno.test("worker: first 429 stops the loop; the remaining queued items are never claimed", async () => {
  const { db, claims } = fakeDb({ items: [item(1), item(2), item(3)] });
  const seen: string[] = [];
  const out = await runStageWorker(db, { limit: 8 }, async (i) => { seen.push(i.image_id); return { ok: false, rate_limited: true }; }, Date.now, noSleep) as { stopped: string; attempted: number };
  assert(out.stopped === "rate_limited" && out.attempted === 1 && seen.length === 1 && claims.length === 1);
});

Deno.test("worker: a thrown runner does not strand later items or loop forever (bounded by limit)", async () => {
  const { db } = fakeDb({ items: [item(1), item(2), item(3)] });
  const out = await runStageWorker(db, { limit: 2 }, async () => { throw new Error("boom"); }, Date.now, noSleep) as { attempted: number; processed: number };
  assert(out.attempted === 2 && out.processed === 0);
});

Deno.test("worker: unsupported stage refused before any claim (programmatic stages have no runner here)", async () => {
  const { db, claims } = fakeDb({ items: [item(1)] });
  const out = await runStageWorker(db, { stage: "exif" }, async () => ({ ok: true }), Date.now, noSleep) as { status: number };
  assert(out.status === 400 && claims.length === 0);
});

Deno.test("worker: deadline bounds the run", async () => {
  const { db } = fakeDb({ items: [item(1), item(2)] });
  let t = 0; const now = () => (t += 60_000);
  const out = await runStageWorker(db, { deadline_ms: 1000 }, async () => ({ ok: true }), now, noSleep) as { stopped: string };
  assert(out.stopped === "deadline");
});

Deno.test("worker: claim error is a failure, not an empty queue", async () => {
  const { db } = fakeDb({ claimError: true });
  const out = await runStageWorker(db, {}, async () => ({ ok: true }), Date.now, noSleep) as { success: boolean; error: string };
  assert(out.success === false && out.error === "claim_failed");
});
