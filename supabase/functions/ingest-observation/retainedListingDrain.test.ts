import { drainRetainedListingProperties, RETAINED_LISTING_DRAIN_MODE } from "./retainedListingDrain.ts";
const assert = (ok: unknown) => { if (!ok) throw new Error("assertion failed"); };
const source = "11111111-1111-4111-8111-111111111111", interior = "514cacd3-82b4-4330-b3df-e292612ee718";
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({
  source_observation_id: `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`,
  property_id: interior, mode: "retained_listing_interior_color_v1",
}));
const request = (signal?: AbortSignal) => new Request("https://db.test/functions/v1/ingest-observation", {
  method: "POST", headers: { Authorization: "Bearer test-key" }, signal,
});
async function run(input: Record<string, unknown>, claimed: unknown, scenario = "new", signal?: AbortSignal) {
  const calls: { name: string; args: any }[] = [], selectors: any[] = [];
  const db = { rpc(name: string, args: any) {
    calls.push({ name, args });
    return { abortSignal() { return Promise.resolve(name === "claim_retained_listing_properties"
      ? { data: claimed, error: scenario === "claim_error" ? {} : null }
      : { data: !(scenario === "bad_custody" && args.p_status === "done"), error: null }); } };
  } };
  const response = await drainRetainedListingProperties(request(signal), input, db, async req => {
    assert(req.headers.get("authorization") === "Bearer test-key");
    selectors.push(await req.json());
    if (scenario === "throw") throw new Error("private provider detail");
    const status = scenario === "refused" ? 400 : scenario === "error" ? 503 : 200;
    return new Response(JSON.stringify(status === 200 ? { success: true,
      observation_id: source, duplicate: scenario === "duplicate" } :
      { error: scenario === "refused" ? "Retained source ineligible" : "private source error" }), { status });
  });
  return { response, body: await response.json(), calls, selectors };
}
const input = { mode: RETAINED_LISTING_DRAIN_MODE, batch_size: 60 };
Deno.test("listing drain refuses arbitrary input before claim", async () => {
  for (const patch of [{ batch_size: 61 }, { batch_size: 0 }, { batch_size: null }, { batch_size: 1.5 },
    { observations: [] }, { source_observation_id: source }, { dry_run: false }]) {
    const r = await run({ ...input, ...patch }, []);assert(r.response.status === 400 && r.calls.length === 0);
  }
});
Deno.test("sixty claims use exact existing selectors and require verified completion", async () => {
  const r = await run(input, rows(60));assert(r.body.writes === 60 && r.body.stored === 60 && r.body.retries === 0);
  assert(r.calls.length === 61 && r.selectors.length === 60);
  assert(r.body.model_calls === 0 && r.body.provider_calls === 0);
  r.selectors.forEach((s, i) => assert(JSON.stringify(s) === JSON.stringify({
    mode: rows(60)[i].mode, source_observation_id: rows(60)[i].source_observation_id })));
});
Deno.test("duplicate acknowledges custody without counting new writes", async () => {
  const r = await run(input, rows(2), "duplicate");assert(r.body.stored === 2 && r.body.duplicates === 2 && r.body.writes === 0);
});
Deno.test("malformed, duplicate, overclaimed and wrong-property server work is refused", async () => {
  for (const work of [rows(61), [rows(1)[0], rows(1)[0]], [{ ...rows(1)[0], mode: "invented" }],
    [{ ...rows(1)[0], property_id: source }], [{ ...rows(1)[0], source_observation_id: "invalid" }]]) {
    const r = await run(input, work);assert(r.response.status === 503 && r.selectors.length === 0 && r.calls.length === 1);
  }
});
Deno.test("canonical refusal and transient errors retain distinct work states and sanitized output", async () => {
  const refusal = await run(input, rows(1), "refused");assert(refusal.body.refused === 1 && refusal.calls[1].args.p_status === "refused");
  for (const scenario of ["error", "throw"]) {
    const r = await run(input, rows(1), scenario);assert(r.body.retries === 1 && r.body.writes === 0);
    assert(r.calls[1].args.p_status === "retry" && !JSON.stringify(r.body).includes("private"));
  }
});
Deno.test("false persisted-result CAS cannot count writes or done", async () => {
  const r = await run(input, rows(1), "bad_custody");assert(r.body.stored === 0 && r.body.writes === 0 && r.body.completion_failures === 1);
  assert(r.body.retries === 1 && r.calls[2].args.p_status === "retry" && r.calls[2].args.p_result === null);
});
Deno.test("aborted and elapsed-budget records defer before admission", async () => {
  const c = new AbortController();c.abort();
  const r = await run(input, rows(2), "new", c.signal);assert(r.body.deferred === 2 && r.selectors.length === 0);
  const original = Date.now;let calls = 0;
  Date.now = () => calls++ < 2 ? 0 : 36000;
  try { const b = await run(input, rows(2));assert(b.body.deferred === 2 && b.selectors.length === 0); }
  finally { Date.now = original; }
});
Deno.test("claim failure is unavailable rather than healthy empty", async () => {
  const r = await run(input, [], "claim_error");assert(r.response.status === 503 && r.selectors.length === 0);
});
