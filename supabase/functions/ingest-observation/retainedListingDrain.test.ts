import { drainRetainedListingProperties, RETAINED_LISTING_DRAIN_MODE, RetainedBatchLookups } from "./retainedListingDrain.ts";
const assert = (ok: unknown) => { if (!ok) throw new Error("assertion failed"); };
const source = "11111111-1111-4111-8111-111111111111", interior = "514cacd3-82b4-4330-b3df-e292612ee718";
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({
  source_observation_id: `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`,
  property_id: interior, mode: "retained_listing_interior_color_v1",
}));
const request = (signal?: AbortSignal) => new Request("https://db.test/functions/v1/ingest-observation", {
  method: "POST", headers: { Authorization: "Bearer test-key" }, signal,
});
const familyProposal = "6b9de10b-1666-4bdf-bb69-7e82d62f8b32";
// Synthetic ratification output, never a production property identifier.
const familyId = "33333333-3333-4333-8333-333333333333";
const familyMode = "retained_listing_engine_family_label_v1";
const familyRows = (n: number, id = familyId) => rows(n).map(row => ({ ...row, property_id: id, mode: familyMode }));
const registry = (id = familyId) => ({
  proposal: { id: familyProposal, status: "approved", promoted_to_id: id },
  property: { id, property_key: "engine_family_label", label: "Publisher engine-family label", namespace: "core",
    data_type: "string", unit: null, parent_property_id: null, discriminator_key: null, cardinality: "single",
    verification_scope: "class", ratified_at: "2026-10-15T00:00:00Z", deprecated_at: null,
    applies_to_kinds: ["specification"], proposed_by_proposal_id: familyProposal },
});
type FamilyFixture = { proposal: any; property: any; readError?: string; readThrow?: string };
async function run(input: Record<string, unknown>, claimed: unknown, scenario = "new", signal?: AbortSignal, family?: FamilyFixture) {
  const calls: { name: string; args: any }[] = [], selectors: any[] = [];
  const registryReads: { table: string; fields: string; id: string; signal: AbortSignal }[] = [];
  const db = { rpc(name: string, args: any) {
    calls.push({ name, args });
    return { abortSignal() {
      if (name === "finish_retained_listing_property" && scenario === "completion_throw") throw Error("private RPC detail");
      return Promise.resolve(name === "claim_retained_listing_properties"
      ? { data: claimed, error: scenario === "claim_error" ? {} : null }
      : { data: !(["bad_custody","retry_refused"].includes(scenario) && args.p_status === "done") && scenario !== "retry_refused",
        error: scenario === "completion_error" && args.p_status === "done" ? { message: "private RPC error" } : null }); } };
  }, from(table: string) {
    assert(family && ["schema_proposals", "observation_properties"].includes(table));
    return { select(fields: string) { return { eq(column: string, id: string) {
      assert(column === "id");
      return { maybeSingle() { return { abortSignal(readSignal: AbortSignal) {
        registryReads.push({ table, fields, id, signal: readSignal });
        if (readSignal.aborted || family?.readThrow === table) throw Error("private registry failure");
        return Promise.resolve({ data: table === "schema_proposals" ? family?.proposal : family?.property,
          error: family?.readError === table ? { message: "private registry error" } : null });
      } }; } };
    } }; } };
  } };
  const response = await drainRetainedListingProperties(request(signal), input, db, async req => {
    assert(req.headers.get("authorization") === "Bearer test-key");
    selectors.push(await req.json());
    if (scenario === "throw") throw new Error("private provider detail");
    if (scenario === "malformed") return new Response("private malformed response");
    if (scenario === "missing_receipt") return new Response(JSON.stringify({ success: true }));
    const status = scenario === "refused" ? 400 : scenario === "error" ? 503 : 200;
    return new Response(JSON.stringify(status === 200 ? { success: true,
      observation_id: source, duplicate: scenario === "duplicate" } :
      { error: scenario === "refused" ? "Retained source ineligible" : "private source error" }), { status });
  });
  return { response, body: await response.json(), calls, selectors, registryReads };
}
const input = { mode: RETAINED_LISTING_DRAIN_MODE, batch_size: 60 };
Deno.test("powertrain replay drains all four exact existing property selectors", async () => {
  const properties = [
    ["c0f743ae-dc94-4dfd-98ef-514b76f74a9b", "engine_configuration"],
    ["66b2f1f6-b714-4ac0-85b6-60ba89529c1a", "engine_displacement_l"],
    ["235aed17-9bd3-4886-90be-9b1a8e2d1844", "transmission_type"],
    ["32b51f19-e5cf-4f67-81d9-96c2d30885a1", "drivetrain_layout"],
  ];
  const work = properties.map(([property_id, key]) => ({ source_observation_id: source,
    property_id, mode: `retained_listing_${key}_v1` }));
  const r = await run(input, work);
  assert(r.body.stored === 4 && r.body.writes === 4 && r.body.completion_failures === 0);
  assert(r.selectors.every((s, i) => s.mode === work[i].mode && s.source_observation_id === source));
  for (const row of work) {
    const invalid = await run(input, [{ ...row, mode: "retained_listing_interior_color_v1" }]);
    assert(invalid.response.status === 503 && invalid.selectors.length === 0);
  }
});
Deno.test("listing drain refuses arbitrary input before claim", async () => {
  for (const patch of [{ batch_size: 121 }, { batch_size: 0 }, { batch_size: null }, { batch_size: 1.5 },
    { observations: [] }, { source_observation_id: source }, { dry_run: false }]) {
    const r = await run({ ...input, ...patch }, []);assert(r.response.status === 400 && r.calls.length === 0);
  }
});
Deno.test("drain dispatches only the exact registered VIN label key",async()=>{
 const work={source_observation_id:source,property_id:"9fc93dd3-3639-439a-8eed-3e9a0f846334",mode:"retained_listing_vin_v1"};
 const r=await run(input,[work]);assert(r.body.stored===1 && r.body.writes===1 && r.selectors[0].mode===work.mode);
 const forged=await run(input,[{...work,mode:"retained_vin_reference_v1"}]);assert(forged.response.status===503 && forged.selectors.length===0);
});
Deno.test("sixty claims use exact existing selectors and require verified completion", async () => {
  const r = await run(input, rows(60));assert(r.body.writes === 60 && r.body.stored === 60 && r.body.retries === 0);
  assert(r.calls.length === 61 && r.selectors.length === 60);
  assert(r.body.model_calls === 0 && r.body.provider_calls === 0);
  assert(r.registryReads.length === 0);
  r.selectors.forEach((s, i) => assert(JSON.stringify(s) === JSON.stringify({
    mode: rows(60)[i].mode, source_observation_id: rows(60)[i].source_observation_id })));
});
Deno.test("duplicate acknowledges custody without counting new writes", async () => {
  const r = await run(input, rows(2), "duplicate");assert(r.body.stored === 2 && r.body.duplicates === 2 && r.body.writes === 0);
});
Deno.test("120 claims retain exact selectors, verified custody and zero inference", async () => {
  const r = await run({ ...input, batch_size: 120 }, rows(120));
  assert(r.body.claimed === 120 && r.body.stored === 120 && r.body.writes === 120);
  assert(r.calls.length === 121 && r.selectors.length === 120 && r.body.completion_failures === 0);
  assert(r.body.model_calls === 0 && r.body.provider_calls === 0);
  assert(r.registryReads.length === 0);
  r.selectors.forEach((s, i) => assert(JSON.stringify(s) === JSON.stringify({
    mode: rows(120)[i].mode, source_observation_id: rows(120)[i].source_observation_id })));
});
Deno.test("120 family claims resolve the approved registry ID once and keep the existing bounded selector/custody path", async () => {
  const work = familyRows(120);
  const r = await run({ ...input, batch_size: 120 }, work, "new", undefined, registry());
  assert(r.response.status === 200 && r.body.stored === 120 && r.body.writes === 120);
  assert(r.registryReads.length === 2 && r.calls.length === 121 && r.body.completion_failures === 0);
  assert(r.registryReads[0].table === "schema_proposals" && r.registryReads[0].id === familyProposal);
  assert(r.registryReads[1].table === "observation_properties" && r.registryReads[1].id === familyId);
  assert(r.registryReads.every(read => read.signal instanceof AbortSignal));
  assert(r.body.model_calls === 0 && r.body.provider_calls === 0);
  r.selectors.forEach((selector, i) => assert(JSON.stringify(selector) === JSON.stringify({
    mode: familyMode, source_observation_id: work[i].source_observation_id })));
  assert(r.calls.slice(1).every(call => call.name === "finish_retained_listing_property" &&
    call.args.p_property === familyId && call.args.p_status === "done"));
});
Deno.test("family registry IDs are resolved independently per drain and coexist with existing properties", async () => {
  for (const id of [familyId, "44444444-4444-4444-8444-444444444444"]) {
    const work = [...rows(1), ...familyRows(2, id)];
    const r = await run(input, work, "duplicate", undefined, registry(id));
    assert(r.body.stored === 3 && r.body.duplicates === 3 && r.body.writes === 0 && r.registryReads.length === 2);
    assert(r.registryReads[1].id === id && r.calls.slice(1).filter(call => call.args.p_property === id).length === 2);
  }
});
Deno.test("unapproved, withdrawn, absent and mismatched family proposals fail before registry or admission", async () => {
  for (const proposal of [null, { ...registry().proposal, id: source },
    ...["open", "under_review", "withdrawn", "rejected"].map(status => ({ ...registry().proposal, status })),
    ...[null, "invalid", interior, source].map(promoted_to_id => ({ ...registry().proposal, promoted_to_id }))]) {
    const r = await run(input, [...rows(1), ...familyRows(1)], "new", undefined, { ...registry(), proposal });
    assert(r.response.status === 503 && r.body.error === "invalid_claimed_listing_work" && r.body.writes === 0);
    assert(r.registryReads.length === 1 && r.calls.length === 1 && r.selectors.length === 0);
  }
});
Deno.test("family registry semantics and proposal linkage must exactly retain the reviewed contract", async () => {
  const changes = [
    { id: source }, { property_key: "engine_code" }, { label: "Engine family" }, { namespace: "pending" },
    { data_type: "integer" }, { unit: "liters" }, { parent_property_id: source }, { discriminator_key: "engine" },
    { cardinality: "multiple" }, { verification_scope: "instance" }, { ratified_at: null }, { ratified_at: "" },
    { deprecated_at: "2026-10-15T01:00:00Z" }, { applies_to_kinds: ["listing"] }, { applies_to_kinds: null },
    { proposed_by_proposal_id: source },
  ];
  for (const property of [null, ...changes.map(change => ({ ...registry().property, ...change }))]) {
    const r = await run(input, familyRows(1), "new", undefined, { ...registry(), property });
    assert(r.response.status === 503 && r.body.error === "invalid_claimed_listing_work");
    assert(r.registryReads.length === 2 && r.calls.length === 1 && r.selectors.length === 0 && r.body.writes === 0);
  }
});
Deno.test("family lookup failures and cancellation fail closed without source details or admission", async () => {
  for (const table of ["schema_proposals", "observation_properties"]) {
    for (const failure of [{ readError: table }, { readThrow: table }]) {
      const r = await run(input, familyRows(1), "new", undefined, { ...registry(), ...failure });
      assert(r.response.status === 503 && r.body.error === "listing_property_registry_unavailable");
      assert(r.calls.length === 1 && r.selectors.length === 0 && !JSON.stringify(r.body).includes("private"));
      assert(r.registryReads.length === (table === "schema_proposals" ? 1 : 2));
    }
  }
  const controller = new AbortController();controller.abort();
  const cancelled = await run(input, familyRows(1), "new", controller.signal, registry());
  assert(cancelled.response.status === 503 && cancelled.registryReads[0].signal.aborted && cancelled.selectors.length === 0);
});
Deno.test("malformed, duplicate, overclaimed or mismatched family selectors cannot trigger admission", async () => {
  for (const work of [familyRows(61), [familyRows(1)[0], familyRows(1)[0]],
    [{ ...familyRows(1)[0], source_observation_id: "invalid" }],
    [{ ...familyRows(1)[0], property_id: "invalid" }], [{ ...familyRows(1)[0], property_id: interior }],
    [{ ...familyRows(1)[0], mode: "retained_listing_interior_color_v1" }]]) {
    const r = await run(input, work, "new", undefined, registry());
    assert(r.response.status === 503 && r.selectors.length === 0 && r.calls.length === 1 && r.registryReads.length === 0);
  }
  const mismatch = await run(input, [familyRows(1)[0], familyRows(1, source)[0]], "new", undefined, registry());
  assert(mismatch.response.status === 503 && mismatch.selectors.length === 0 && mismatch.registryReads.length === 1);
});
Deno.test("admissions overlap by at most two and completion stays source-bound", async () => {
  let active = 0, peak = 0;
  const admitted = new Set<string>(), finished = new Set<string>();
  const work = rows(12);
  const db = { rpc(name: string, args: any) { return { abortSignal() {
    if (name === "claim_retained_listing_properties") return Promise.resolve({ data: work, error: null });
    assert(admitted.has(args.p_source) && !finished.has(args.p_source));
    assert(args.p_status === "done" && args.p_result === args.p_source);
    finished.add(args.p_source);
    return Promise.resolve({ data: true, error: null });
  } }; } };
  const response = await drainRetainedListingProperties(request(), input, db, async req => {
    const selector = await req.json();
    active++;peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;admitted.add(selector.source_observation_id);
    return new Response(JSON.stringify({ success: true, observation_id: selector.source_observation_id, duplicate: false }));
  });
  const receipt = await response.json();
  assert(peak === 2 && active === 0 && finished.size === 12 && receipt.writes === 12);
  assert(receipt.completion_failures === 0 && receipt.model_calls === 0 && receipt.provider_calls === 0);
});
Deno.test("120-cap drain still defers unstarted records at the existing35s boundary", async () => {
  const original = Date.now;let calls = 0;
  Date.now = () => calls++ < 100 ? 0 : 36000;
  try {
    const r = await run({ ...input, batch_size: 120 }, rows(120));
    assert(r.body.stored > 0 && r.body.deferred > 0 && r.body.stored + r.body.deferred === 120);
    assert(r.body.completion_failures === 0 && r.calls.length === 121);
  } finally { Date.now = original; }
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
Deno.test("failure feedback distinguishes admission from persisted custody without exposing source details or changing retry states", async () => {
  for (const [scenario,stage] of [["error","admission_http"],["throw","admission_exception"],
    ["malformed","admission_exception"],["missing_receipt","admission_receipt"],
    ["bad_custody","completion_custody"],["completion_error","completion_rpc"],
    ["completion_throw","completion_exception"],["retry_refused","completion_custody"]]) {
    const r=await run(input,rows(1),scenario);
    assert(r.body.stored===0 && r.body.writes===0 && r.body.failure_stages[stage]===1);
    assert(!JSON.stringify(r.body).includes("private") && r.body.model_calls===0 && r.body.provider_calls===0);
    if (stage.startsWith("admission")) assert(r.calls[1].args.p_status==="retry" && r.body.retries===1);
    else if (scenario!=="completion_throw") {
      assert(r.calls[1].args.p_status==="done" && r.calls[2].args.p_status==="retry" && r.calls[2].args.p_result===null);
      assert(r.body.retries===(scenario==="retry_refused"?0:1));
    }
    assert(r.body.failure_stages.completion_retry===(scenario==="retry_refused"?1:0));
    assert(JSON.stringify(r.body.admission_http_statuses)===(scenario==="error"?'\u007b"503":1\u007d':'\u007b\u007d'));
  }
  for(const scenario of ["new","duplicate","refused"]){
    const r=await run(input,rows(1),scenario);
    assert(Object.values(r.body.failure_stages).every(n=>n===0));
  }
});
Deno.test("aborted and elapsed-budget records defer before admission", async () => {
  const c = new AbortController();c.abort();
  const r = await run(input, rows(2), "new", c.signal);assert(r.body.deferred === 2 && r.selectors.length === 0);
  const original = Date.now;let calls = 0;
  Date.now = () => calls++ < 2 ? 0 : 36000;
  try { const b = await run(input, rows(2));assert(b.body.deferred === 2 && b.selectors.length === 0); }
  finally { Date.now = original; }
});
Deno.test("elapsed completion budget is reported without an RPC or an unproved completion", async()=>{
  const original=Date.now;let elapsed=0;
  Date.now=()=>elapsed;
  const calls:string[]=[];
  const db={rpc(name:string){calls.push(name);return {abortSignal(){return Promise.resolve({data:rows(1),error:null});}};}};
  try{
    const response=await drainRetainedListingProperties(request(),input,db,async()=>{
      elapsed=56000;
      return new Response(JSON.stringify({success:true,observation_id:source,duplicate:false}));
    });
    const body=await response.json();
    assert(body.success===false && body.stored===0 && body.writes===0 && body.completion_failures===1);
    assert(body.failure_stages.completion_budget===1 && calls.length===1 && calls[0]==="claim_retained_listing_properties");
  }finally{Date.now=original;}
});
Deno.test("claim failure is unavailable rather than healthy empty", async () => {
  const r = await run(input, [], "claim_error");assert(r.response.status === 503 && r.selectors.length === 0);
});

Deno.test("batch inputs omit failures and stop retaining rows at the byte/entry bounds",()=>{
 const lookups=new RetainedBatchLookups();
 lookups.remember("missing",{data:null,error:null});lookups.remember("error",{data:{id:source},error:{}});
 assert(lookups.get("missing")===undefined && lookups.get("error")===undefined);
 lookups.remember("oversize",{data:"x".repeat(4*1024*1024),error:null});assert(lookups.get("oversize")===undefined);
 for(let i=0;i<257;i++)lookups.remember(`row:${i}`,{data:{id:i},error:null});
 assert(lookups.get("row:255").data.id===255 && lookups.get("row:256")===undefined);
 assert(new RetainedBatchLookups().get("row:0")===undefined);
});

Deno.test("overlapping input reads share work but only qualified results are retained", async () => {
 const lookups = new RetainedBatchLookups();let reads = 0;
 let release!: (value: any) => void;
 const result = { data: { id: source }, error: null };
 const load = () => { reads++;return new Promise(resolve => { release = resolve; }); };
 const first = lookups.read("parent", load), second = lookups.read("parent", load);
 const unrelated = await lookups.read("different-parent", async () => ({ data: { id: interior }, error: null }));
 assert(reads === 1 && unrelated.data.id === interior);
 release(result);
 assert((await first) === result && (await second) === result);
 assert(lookups.get("parent") === undefined); // Reading alone is not qualification.
 lookups.remember("parent", result);
 assert(await lookups.read("parent", load) === result && reads === 1);
 assert(JSON.stringify(lookups.stats()) === JSON.stringify({ reads_started: 2, cache_hits: 1, in_flight_shares: 1 }));
 assert(new RetainedBatchLookups().get("parent") === undefined);
});

Deno.test("missing, failed, cancelled and thrown shared reads can be retried", async () => {
 for (const result of [{ data: null, error: null }, { data: null, error: { message: "private failure" } }]) {
  const lookups = new RetainedBatchLookups();let reads = 0;
  const load = async () => { reads++;return result; };
  await Promise.all([lookups.read("parent", load), lookups.read("parent", load)]);
  lookups.remember("parent", result);
  await lookups.read("parent", load);
  assert(reads === 2 && lookups.get("parent") === undefined);
 }
 for (const synchronous of [true, false]) {
  const lookups = new RetainedBatchLookups();
  const controller = new AbortController();
  const load = () => {
   if (synchronous) throw new Error("private failure");
   return new Promise((_resolve, reject) => controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true }));
  };
  const pending = Promise.allSettled([lookups.read("parent", load), lookups.read("parent", load)]);
  await Promise.resolve();controller.abort();
  assert((await pending).every(result => result.status === "rejected"));
  assert((await lookups.read("parent", async () => ({ data: { id: source }, error: null }))).data.id === source);
  assert(lookups.stats().reads_started === 2 && lookups.stats().in_flight_shares === 1);
 }
});
