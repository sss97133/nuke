import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { AnalysisLeaseLost, enqueueAnalysis, runAnalysisQueue, type AnalysisClaim } from "./queueWork.ts";

const claim: AnalysisClaim = { id: "work", vehicle_id: "vehicle", claimed_revision: 7, lease_token: crypto.randomUUID(),
  claimed_widget_slugs: ["a", "b"] };

Deno.test("worker claims only work it can reach and closes one lease before taking another", async () => {
  let active = false;
  let count = 0;
  const computed: string[] = [];
  const db = { rpc(name: string, args: Record<string, unknown>) {
    if (name === "claim_analysis_queue_batch") {
      assertEquals(active, false);
      assertEquals(args.p_batch_size, 1);
      assertEquals(args.p_vehicle_id, "vehicle");
      count++;
      active = count === 1;
      return Promise.resolve({ data: active ? [claim] : [], error: null });
    }
    assertEquals(name, "finish_analysis_queue_work");
    assertEquals(args.p_revision, 7);
    assertEquals(args.p_worker_id, "worker");
    assertEquals(args.p_lease_token, claim.lease_token);
    assertEquals(args.p_succeeded_widgets, ["a", "b"]);
    active = false;
    return Promise.resolve({ data: { status: "complete" }, error: null });
  } };
  const result = await runAnalysisQueue(db, { batchSize: 20, vehicleId: "vehicle", workerId: "worker",
    compute: async (snapshot, slug) => { assertEquals(snapshot.claimed_revision, 7); computed.push(slug); return { widget: slug }; } });
  assertEquals(computed, ["a", "b"]);
  assertEquals(result.total_computed, 2);
  assertEquals(result.processed, 1);
});

Deno.test("failed calculations stay requested while only successfully published widgets are acknowledged", async () => {
  let first = true;
  const db = { rpc(name: string, args: Record<string, unknown>) {
    if (name === "claim_analysis_queue_batch") {
      const data = first ? [claim] : []; first = false;
      return Promise.resolve({ data, error: null });
    }
    assertEquals(args.p_succeeded_widgets, ["a"]);
    assertEquals(args.p_failed, 1);
    assertEquals(args.p_error, "b: source unavailable");
    return Promise.resolve({ data: { status: "pending" }, error: null });
  } };
  const result = await runAnalysisQueue(db, { batchSize: 1,
    compute: async (_, slug) => { if (slug === "b") throw new Error("source unavailable"); return {}; } });
  assertEquals(result.total_failed, 1);
});

Deno.test("losing a lease stops this worker without closing the replacement's work", async () => {
  const calls: string[] = [];
  const db = { rpc(name: string) { calls.push(name); return Promise.resolve({ data: [claim], error: null }); } };
  const result = await runAnalysisQueue(db, { batchSize: 10, compute: async () => { throw new AnalysisLeaseLost(); } });
  assertEquals(calls, ["claim_analysis_queue_batch"]);
  assertEquals(result.processed, 0);
});

Deno.test("function budget leaves remaining widgets persisted instead of leasing an unreachable batch", async () => {
  let clock = 0;
  let claims = 0;
  const db = { rpc(name: string, args: Record<string, unknown>) {
    if (name === "claim_analysis_queue_batch") { claims++; return Promise.resolve({ data: [claim], error: null }); }
    assertEquals(args.p_succeeded_widgets, ["a"]);
    return Promise.resolve({ data: { status: "pending" }, error: null });
  } };
  const result = await runAnalysisQueue(db, { batchSize: 20, now: () => clock,
    compute: async () => { clock += 60_000; return {}; } });
  assertEquals(claims, 1);
  assertEquals(result.total_computed, 1);
});

Deno.test("enqueue, claim and missing completion receipts fail visibly", async () => {
  await assertRejects(() => enqueueAnalysis({ rpc: () => Promise.resolve({ data: null,
    error: { message: "database unavailable" } }) }, "vehicle", "observation", [], ["a"], 70), Error, "enqueue failed");
  await assertRejects(() => runAnalysisQueue({ rpc: () => Promise.resolve({ data: null,
    error: { message: "database unavailable" } }) }, { batchSize: 1, compute: async () => ({}) }), Error, "claim failed");
  await assertRejects(() => runAnalysisQueue({ rpc: (name) => Promise.resolve({
    data: name === "claim_analysis_queue_batch" ? [claim] : {}, error: null }) },
    { batchSize: 1, compute: async () => ({}) }), Error, "completion receipt missing");
});

Deno.test("zero batch capacity claims nothing", async () => {
  let calls = 0;
  const db = { rpc() { calls++; return Promise.resolve({ data: [claim], error: null }); } };
  const result = await runAnalysisQueue(db, { batchSize: 0, compute: async () => ({}) });
  assertEquals(calls, 0);
  assertEquals(result.claimed, 0);
});

Deno.test('short retained budget claims one reachable lease and leaves later widgets durable', async () => {
  let clock = 0;
  const db = { rpc(name: string, args: Record<string, unknown>) {
    if (name === 'claim_analysis_queue_batch') {
      assertEquals(args.p_retained_only, true); return Promise.resolve({ data: [claim], error: null });
    }
    assertEquals(args.p_succeeded_widgets, ['a']);
    return Promise.resolve({ data: { status: 'pending' }, error: null });
  } };
  const result = await runAnalysisQueue(db, { batchSize: 2, retainedOnly: true, budgetMs: 15000, reserveMs: 9000,
    now: () => clock, compute: async () => { clock += 8000; return {}; } });
  assertEquals(result.claimed, 1); assertEquals(result.total_computed, 1);
});
