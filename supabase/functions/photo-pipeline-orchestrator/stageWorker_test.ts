import { probeStageAvailability, runStageWorker, type WorkItem } from "./stageWorker.ts";

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

function probeDb(stages: unknown[], enabled = true) {
  const rpcs: Record<string, unknown>[] = [];
  const db = {
    from: (t: string) => t === "platform_config"
      ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { config_value: { enabled } } }) }) }) }
      : { select: () => ({ or: () => ({ order: () => ({ limit: async () => ({ data: stages, error: null }) }) }) }) },
    rpc: async (_fn: string, args: Record<string, unknown>) => { rpcs.push(args); return { error: null }; },
  };
  return { db, rpcs };
}

Deno.test("probe: 404 keeps a stage unavailable, anything else marks it available; known-live stages are not probed", async () => {
  const { db, rpcs } = probeDb([
    { stage: "engine_bay", producer: "analyze-engine-bay", legacy_unavailable_key: "analyze-engine-bay", available: false },
    { stage: "receipt_ocr", producer: "receipt-extract", legacy_unavailable_key: "receipt-photo-ocr", available: null },
    { stage: "exif", producer: "derive-image-exif", legacy_unavailable_key: null, available: null },   // never seen unavailable: not probed
  ]);
  const urls: string[] = [];
  const f = (async (u: string, init: RequestInit) => { urls.push(`${init.method} ${u}`); return new Response(null, { status: u.includes("analyze-engine-bay") ? 404 : 200 }); }) as unknown as typeof fetch;
  const out = await probeStageAvailability(db, "https://x.test", f) as { probed: number };
  assert(out.probed === 2 && urls.length === 2 && urls.every((u) => u.startsWith("OPTIONS ")));
  assert(rpcs.some((a) => a.p_stage === "engine_bay" && a.p_available === false));
  assert(rpcs.some((a) => a.p_stage === "receipt_ocr" && a.p_available === true));
});

Deno.test("probe: a network error leaves the signal alone; disabled flag probes nothing", async () => {
  const { db, rpcs } = probeDb([{ stage: "engine_bay", producer: "p", legacy_unavailable_key: "k", available: false }]);
  const boom = (async () => { throw new Error("net"); }) as unknown as typeof fetch;
  await probeStageAvailability(db, "https://x.test", boom);
  assert(rpcs.length === 0);
  const off = probeDb([{ stage: "engine_bay", producer: "p", legacy_unavailable_key: "k", available: false }], false);
  const out = await probeStageAvailability(off.db, "https://x.test", boom) as { skipped?: string };
  assert(out.skipped === "disabled");
});

Deno.test("worker: filing and evidence are supported; the runner is told its stage; no provider gate or stagger applies", async () => {
  for (const stage of ["filing", "evidence"]) {
    const { db, claims } = fakeDb({ blockedUntil: future(), items: [item(1), item(2)] });   // classifier cooldown must not stop them
    const seen: string[] = []; let slept = 0;
    const out = await runStageWorker(db, { stage, limit: 4 }, async (_i, st) => { seen.push(st); return { ok: true }; }, Date.now, async () => { slept++; }) as { processed: number; stopped: string };
    assert(out.processed === 2 && seen.join() === `${stage},${stage}` && claims[0] === `claim_image_stage_work:${stage}` && slept === 0);
  }
});
