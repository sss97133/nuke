import { RETAINED_LISTING_DRAIN_MODE } from "./retainedListingDrain.ts";
const assert = (ok: unknown) => { if (!ok) throw new Error("assertion failed"); };
const VID = "22222222-2222-4222-8222-222222222222", SID = "4cdc735c-f117-42f2-889f-ba33805639a5";
const INTERIOR = "514cacd3-82b4-4330-b3df-e292612ee718", EXTERIOR = "efcb8c61-1ff5-4790-890e-2e09118e87e3";
const saved = [Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")];
Deno.env.set("SUPABASE_URL", "https://db.test");Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");
let handler: (req: Request) => Promise<Response>;
const serve = Deno.serve;(Deno as any).serve = (fn: typeof handler) => { handler = fn; };
await import("./index.ts");Deno.serve = serve;
async function run(scenario = "new", token = "test-key") {
  const previous = [Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")];
  Deno.env.set("SUPABASE_URL", "https://db.test");Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");
  const mc = scenario === "mccormick";
  const sourceId = mc ? "006f01c3-e5fb-44f5-ab40-e55b0654de1c" : SID;
  const properties:Record<string,string> = mc ? {
    "ece619f7-c49a-44f7-999f-a41acf5d4dc3":"year", "8d274b73-a8a6-43bf-9036-5864d0152725":"make",
    "a79b528f-7d9d-46ca-96f9-96d899e81d10":"model", "9fc93dd3-3639-439a-8eed-3e9a0f846334":"vin"
  } : {[INTERIOR]:"interior_color",[EXTERIOR]:"exterior_color"};
  const rows = Array.from({ length: mc ? 2 : 30 }, (_, i) => Object.keys(properties).map(property_id => ({
    source_observation_id: `11111111-1111-4111-8111-${String(i).padStart(12,"0")}`,property_id,
    mode: `retained_listing_${properties[property_id]}_v1`,
  }))).flat();
  const persisted = new Map<string, any>(), calls: { path: string; method: string; parentRead: boolean }[] = [];
  let writes = 0;
  const original = globalThis.fetch;
  const respond = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
    status,headers:{"Content-Type":"application/json"},
  });
  globalThis.fetch = async (resource, init) => {
    const url = new URL(typeof resource === "string" ? resource : resource instanceof URL ? resource.href : resource.url);
    const options = init as { method?: string; body?: unknown } | undefined;
    const method = options?.method ?? "GET", payload = typeof options?.body === "string" ? JSON.parse(options.body) : null;
    calls.push({path:url.pathname,method,parentRead:method === "GET" && url.pathname.endsWith("vehicle_observations") && url.searchParams.has("id")});
    if (url.pathname.endsWith("/auth/v1/user")) return respond({id:VID,role:"authenticated",app_metadata:{},user_metadata:{}});
    assert(url.pathname.startsWith("/rest/v1/"));
    if (url.pathname.endsWith("claim_retained_listing_properties")) return respond(rows);
    if (url.pathname.endsWith("finish_retained_listing_property")) {
      if (payload.p_status !== "done") return respond(true);
      const o = [...persisted.values()].find(o => o.id === payload.p_result);
      assert(o && o.source_observation_id === payload.p_source && o.property_id === payload.p_property);
      assert(o.vehicle_id === VID && o.source_id === sourceId && o.observed_at === "2026-09-01T00:00:00.123456Z");
      assert(o.structured_data.factory_configuration_status === "unknown" && o.structured_data.independent_source === false);
      assert(o.agent_cost_cents === 0 && o.agent_model === null && o.confidence_score <= .6);
      return respond(true);
    }
    if (url.pathname.endsWith("observation_sources")) return respond([{id:sourceId,slug:mc?"mccormicks":"bat",base_trust_score:.85,supported_observations:["specification","listing"]}]);
    if (url.pathname.endsWith("vehicles")) return respond([{id:VID,is_public:scenario !== "private",deleted_at:null,listing_kind:"vehicle"}]);
    if (url.pathname.endsWith("observation_properties")) {
      const key = url.searchParams.get("property_key")?.slice(3);
      return respond([{id:Object.entries(properties).find(([,value])=>value===key)?.[0],namespace:"core",deprecated_at:null,applies_to_kinds:["specification"]}]);
    }
    if (url.pathname.endsWith("vehicle_observations")) {
      if (method === "POST") {
        writes++;const row = {...payload,id:`77777777-7777-4777-8777-${String(writes).padStart(12,"0")}`};
        persisted.set(payload.content_hash,row);return respond(row,201);
      }
      const id = url.searchParams.get("id")?.slice(3);
      if (id) return respond([{id,vehicle_id:VID,source_id:sourceId,source_url:mc?"https://www.classic-carauction.com/auction-cars?auctionid=7309":"https://bringatrailer.com/listing/retained-fixture",
        kind:scenario === "sale_result" ? "sale_result" : "listing",is_superseded:false,property_id:null,subject_type:"vehicle",subject_id:null,
        confidence_score:.7,extraction_method:mc?"mccormick_html_v1":"html_match",observed_at:mc?"2026-08-31T00:00:00.123456Z":null,ingested_at:"2026-09-01T00:00:00.123456Z",
        ...(mc ? {
         source_identifier:"auctionid:7309:"+"a".repeat(64),
         raw_source_ref:"listing_page_snapshots:44444444-4444-4444-8444-444444444444",
         extraction_metadata:{parser:"mccormick_html_v1",snapshot_id:"44444444-4444-4444-8444-444444444444",html_sha256:"a".repeat(64)}
        }:{}),
        structured_data:mc?{year:1978,make:"Example Manufacturer",model:"Prototype GT",vin:"1FAFP45X0YF123456",
         parser:"mccormick_html_v1",source_id:"7309",source_claims_only:true,source_event_at:null,source_captured_at:"2026-08-31T00:00:00.123456Z"
        }:{interior_color:"Exact Black Vinyl",color:scenario === "unknown" ? "unknown" : "Exact Signal Red"}}]);
      const hash = url.searchParams.get("content_hash")?.slice(3);
      return respond(hash && persisted.has(hash) ? [persisted.get(hash)] : []);
    }
    throw new Error(`unexpected route ${url.pathname}`);
  };
  try {
    const request = () => new Request("https://db.test/functions/v1/ingest-observation", {method:"POST",
      headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},
      body:JSON.stringify({mode:RETAINED_LISTING_DRAIN_MODE,batch_size:60})});
    const response = await handler(request()),body = await response.json();
    const replay = ["new","sale_result","mccormick"].includes(scenario) ? await (await handler(request())).json() : null;
    return {status:response.status,body,replay,writes,calls,persisted};
  } finally {
    globalThis.fetch = original;
    for (const [i,key] of ["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY"].entries()) {
      if (previous[i] === undefined) Deno.env.delete(key);else Deno.env.set(key,previous[i]!);
    }
  }
}
Deno.test("scheduled sixty-property drain uses real canonical selector/SDK/hash and source dedup, no nested edges", async () => {
  const r = await run();assert(r.status === 200 && r.body.stored === 60 && r.body.writes === 60 && r.writes === 60);
  assert(r.replay.stored === 60 && r.replay.writes === 0 && r.replay.duplicates === 60);
  assert(r.body.completion_failures === 0 && r.body.provider_calls === 0 && r.body.model_calls === 0);
  const parentReads = r.calls.filter(c => c.parentRead).length;
  console.log(JSON.stringify({ assay: "same_60_claims_twice", parent_reads: parentReads,
    completed: r.body.stored + r.replay.stored, new_claims: r.writes, replay_duplicates: r.replay.duplicates,
    input_lookups: r.body.input_lookups, replay_input_lookups: r.replay.input_lookups }));
  assert(parentReads === 60); // 30 distinct captures in each independent drain.
  for (const batch of [r.body, r.replay]) {
    assert(batch.input_lookups.reads_started === 32); // Parent, public vehicle and registered source reads only.
    assert(batch.input_lookups.in_flight_shares > 0);
    assert(Object.values(batch.input_lookups).reduce<number>((sum, n) => sum + Number(n), 0) === 180);
  }
  assert(r.calls.every(c => c.path.startsWith("/rest/v1/")));
  for (const o of r.persisted.values()) {
    assert(o.structured_data.source_observed_at === null && o.structured_data.observed_at_basis === "source_testimony_recorded_at");
    assert(o.structured_data[o.property_id === INTERIOR ? "interior_color" : "exterior_color"] ===
      (o.property_id === INTERIOR ? "Exact Black Vinyl" : "Exact Signal Red"));
  }
});
Deno.test("real scheduled drain refuses private parents and explicit unknown values", async () => {
  const privateRow = await run("private");assert(privateRow.writes === 0 && privateRow.body.refused === 60);
  const unknown = await run("unknown");assert(unknown.writes === 30 && unknown.body.refused === 30);
});
Deno.test("closed BaT source fields traverse the actual selector and replay without new source claims",async()=>{
 const r=await run("sale_result");
 assert(r.status===200 && r.body.stored===60 && r.body.writes===60);
 assert(r.replay.stored===60 && r.replay.duplicates===60 && r.replay.writes===0 && r.writes===60);
 for(const o of r.persisted.values()){
  assert(o.structured_data.source_extraction_method==="html_match");
  assert(o.structured_data.source_observed_at===null && o.structured_data.current_configuration_status==="unknown");
  assert(o.structured_data.source_recorded_at==="2026-09-01T00:00:00.123456Z");
 }
});
Deno.test("signed-in caller cannot claim scheduled work", async () => {
  // A user session as Auth signs it since 2026-10-14: ES256, verified against the project JWKS.
  const jwks = Deno.env.get("SUPABASE_JWKS");const pair = await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign","verify"]);
  Deno.env.set("SUPABASE_JWKS",JSON.stringify({keys:[{...(await crypto.subtle.exportKey("jwk",pair.publicKey)),kid:"t",alg:"ES256"}]}));
  try {
    const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
    const base = `${encode({alg:"ES256",typ:"JWT",kid:"t"})}.${encode({role:"authenticated",sub:VID,exp:Math.floor(Date.now()/1000)+300})}`;
    const sig = new Uint8Array(await crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},pair.privateKey,new TextEncoder().encode(base)));
    const token = `${base}.${btoa(String.fromCharCode(...sig)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;
    const r = await run("new",token);assert(r.status === 403 && r.writes === 0);
    assert(!r.calls.some(c => c.path.endsWith("claim_retained_listing_properties")));
  } finally { if(jwks===undefined)Deno.env.delete("SUPABASE_JWKS");else Deno.env.set("SUPABASE_JWKS",jwks); }
});
for (const [i,key] of ["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY"].entries()) {
  if (saved[i] === undefined) Deno.env.delete(key);else Deno.env.set(key,saved[i]!);
}

Deno.test("McCormick labels traverse real scheduled selector, property writer and replay",async()=>{
 const r=await run("mccormick");
 assert(r.status===200&&r.body.stored===8&&r.body.writes===8);
 assert(r.replay.stored===8&&r.replay.duplicates===8&&r.replay.writes===0&&r.writes===8);
 assert(r.body.completion_failures===0&&r.body.model_calls===0&&r.body.provider_calls===0);
 for(const o of r.persisted.values()){
  assert(o.source_id==="006f01c3-e5fb-44f5-ab40-e55b0654de1c");
  assert(["year","make","model","vin"].includes(o.structured_data.property_key));
  assert(o.structured_data.identity_resolution_status==="unverified");
  assert(o.structured_data.source_extraction_method==="mccormick_html_v1");
  assert(o.structured_data.source_observed_at==="2026-08-31T00:00:00.123456Z");
  assert(!o.structured_data.source_sale_receipt);
 }
});
