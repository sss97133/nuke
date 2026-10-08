import { drainBatSaleQueue } from "./batSaleQueue.ts";
const assert = (ok: unknown) => { if (!ok) throw new Error("assertion failed"); };
const uuid = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({
  id: uuid(i), source_snapshot_id: uuid(i + 100), source_vehicle_id: uuid(i + 200),
}));
const input = { mode: "source_sale_qualification", use_source_queue: true,
  qualification_version: "v1", dry_run: false, batch_size: 40 };
async function run(body: Record<string, unknown>, work: unknown, options: {
  legacy?: boolean; completionRejected?: boolean; badAck?: boolean; aborted?: boolean;
} = {}) {
  const calls: { name: string; args: any }[] = [], selectors: any[] = [];
  const db = { rpc(name: string, args: any) {
    calls.push({ name, args });return { abortSignal() { return Promise.resolve({
      data: name === "claim_bat_sale_snapshots" ? work : !options.completionRejected, error: null,
    }); } };
  } };
  const abort = new AbortController();if (options.aborted) abort.abort();
  const request = new Request("https://db.test/ingest-observation", { method: "POST",
    headers: { Authorization: "Bearer service-test" }, signal: abort.signal });
  const canonical = { request, admit: async (req: Request) => {
    assert(req.headers.get("authorization") === "Bearer service-test");
    const selector = await req.json();selectors.push(selector);
    return Response.json({ success: true, dry_run: false, model_calls: 0, writes: 1,
      observation_id: options.badAck ? "bad" : uuid(999), receipt: {
        method: "protected_archived_sale_observation_v1", snapshot_id: selector.snapshot_id,
        vehicle_id: selector.vehicle_id,
      } });
  } };
  const response = await drainBatSaleQueue(db, body, options.legacy ? undefined : canonical);
  return { status: response.status, body: await response.json(), calls, selectors };
}
Deno.test("canonical40 source claims reuse the exact protected leaf and verify every persisted completion", async () => {
  const r = await run(input, rows(40));assert(r.status === 200 && r.body.claimed === 40);
  assert(r.body.stored === 40 && r.body.writes === 40 && r.body.model_calls === 0);
  assert(r.body.retries === 0 && r.body.completion_failures === 0 && r.calls.length === 41);
  r.selectors.forEach((s, i) => assert(JSON.stringify(s) === JSON.stringify({
    mode: input.mode, qualification_version: "v1", dry_run: false,
    vehicle_id: rows(40)[i].source_vehicle_id, snapshot_id: rows(40)[i].source_snapshot_id,
  })));
});
Deno.test("canonical input remains source-only; legacy outer request ceiling stays20", async () => {
  for (const patch of [{ batch_size: 41 }, { batch_size: null }, { batch_size: 0 }, { batch_size: 1.5 },
    { dry_run: true }, { use_source_queue: false }, { mode: "other" }, { observations: [] },
    { snapshot_id: uuid(100) }, { qualification_version: "episode_v2" }, { force: true }]) {
    const r = await run({ ...input, ...patch }, []);assert(r.status === 400 && r.calls.length === 0);
  }
  const legacy = await run({ ...input, batch_size: 21 }, [], { legacy: true });
  assert(legacy.status === 400 && legacy.calls.length === 0);
  const { batch_size: _limit, ...defaultInput } = input;
  const defaultResult = await run(defaultInput, []);
  assert(defaultResult.status === 200 && defaultResult.calls[0].args.p_limit === 20);
});
Deno.test("overclaimed and duplicate leased work cannot enter canonical intake", async () => {
  for (const work of [rows(41), [rows(1)[0], rows(1)[0]]]) {
    const r = await run(input, work);assert(r.status === 503 && r.selectors.length === 0 && r.calls.length === 1);
  }
});
Deno.test("invalid record acknowledgement and failed custody never count verified new writes", async () => {
  const malformed = await run(input, rows(2), { badAck: true });
  assert(malformed.body.writes === 0 && malformed.body.retries === 2);
  const failed = await run(input, rows(2), { completionRejected: true });
  assert(failed.status === 503 && failed.body.writes === 0 && failed.body.writes_reported === 1);
  assert(failed.body.completion_failures === 1 && failed.selectors.length === 1);
});
Deno.test("cancelled canonical request preserves unstarted budget deferrals without source reads", async () => {
  const r = await run(input, rows(40), { aborted: true });
  assert(r.status === 200 && r.selectors.length === 0 && r.body.writes === 0);
  assert(r.body.results.every((x: any) => x.reason === "batch_budget_deferred"));
  assert(r.calls.slice(1).every(c => c.args.p_reason === "batch_budget_deferred"));
});
Deno.test("same40s stop-new-record boundary defers the rest of a40-item batch", async () => {
  const original = Date.now;let calls = 0;Date.now = () => calls++ < 20 ? 0 : 41000;
  try {
    const r = await run(input, rows(40));
    assert(r.body.stored > 0 && r.body.stored < 40 && r.body.completion_failures === 0);
    const deferred = r.body.results.filter((x: any) => x.reason === "batch_budget_deferred").length;
    assert(deferred > 0 && deferred + r.body.stored === 40);
  } finally { Date.now = original; }
});
