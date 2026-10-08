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
  const rows = Array.from({ length: 30 }, (_, i) => [INTERIOR, EXTERIOR].map(property_id => ({
    source_observation_id: `11111111-1111-4111-8111-${String(i).padStart(12,"0")}`,property_id,
    mode: property_id === INTERIOR ? "retained_listing_interior_color_v1" : "retained_listing_exterior_color_v1",
  }))).flat();
  const persisted = new Map<string, any>(), calls: { path: string; method: string }[] = [];
  let writes = 0;
  const original = globalThis.fetch;
  const respond = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
    status,headers:{"Content-Type":"application/json"},
  });
  globalThis.fetch = async (resource, init) => {
    const url = new URL(typeof resource === "string" ? resource : resource instanceof URL ? resource.href : resource.url);
    const options = init as { method?: string; body?: unknown } | undefined;
    const method = options?.method ?? "GET", payload = typeof options?.body === "string" ? JSON.parse(options.body) : null;
    calls.push({path:url.pathname,method});
    if (url.pathname.endsWith("/auth/v1/user")) return respond({id:VID,role:"authenticated",app_metadata:{},user_metadata:{}});
    assert(url.pathname.startsWith("/rest/v1/"));
    if (url.pathname.endsWith("claim_retained_listing_properties")) return respond(rows);
    if (url.pathname.endsWith("finish_retained_listing_property")) {
      if (payload.p_status !== "done") return respond(true);
      const o = [...persisted.values()].find(o => o.id === payload.p_result);
      assert(o && o.source_observation_id === payload.p_source && o.property_id === payload.p_property);
      assert(o.vehicle_id === VID && o.source_id === SID && o.observed_at === "2026-09-01T00:00:00.123456Z");
      assert(o.structured_data.factory_configuration_status === "unknown" && o.structured_data.independent_source === false);
      assert(o.agent_cost_cents === 0 && o.agent_model === null && o.confidence_score <= .6);
      return respond(true);
    }
    if (url.pathname.endsWith("observation_sources")) return respond([{id:SID,slug:"bat",base_trust_score:.85,supported_observations:["specification","listing"]}]);
    if (url.pathname.endsWith("vehicles")) return respond([{id:VID,is_public:scenario !== "private",deleted_at:null,listing_kind:"vehicle"}]);
    if (url.pathname.endsWith("observation_properties")) {
      const key = url.searchParams.get("property_key")?.slice(3);
      return respond([{id:key === "interior_color" ? INTERIOR : EXTERIOR,namespace:"core",deprecated_at:null,applies_to_kinds:["specification"]}]);
    }
    if (url.pathname.endsWith("vehicle_observations")) {
      if (method === "POST") {
        writes++;const row = {...payload,id:`77777777-7777-4777-8777-${String(writes).padStart(12,"0")}`};
        persisted.set(payload.content_hash,row);return respond(row,201);
      }
      const id = url.searchParams.get("id")?.slice(3);
      if (id) return respond([{id,vehicle_id:VID,source_id:SID,source_url:"https://bringatrailer.com/listing/retained-fixture",
        kind:"listing",is_superseded:false,property_id:null,subject_type:"vehicle",subject_id:null,
        confidence_score:.7,extraction_method:"html_match",observed_at:null,ingested_at:"2026-09-01T00:00:00.123456Z",
        structured_data:{interior_color:"Exact Black Vinyl",color:scenario === "unknown" ? "unknown" : "Exact Signal Red"}}]);
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
    const replay = scenario === "new" ? await (await handler(request())).json() : null;
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
Deno.test("signed-in caller cannot claim scheduled work", async () => {
  const secret = Deno.env.get("JWT_SIGNING_SECRET");Deno.env.set("JWT_SIGNING_SECRET","test-secret");
  try {
    const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
    const base = `${encode({alg:"HS256",typ:"JWT"})}.${encode({role:"authenticated",sub:VID,exp:Math.floor(Date.now()/1000)+300})}`;
    const key = await crypto.subtle.importKey("raw",new TextEncoder().encode("test-secret"),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
    const sig = new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(base)));
    const token = `${base}.${btoa(String.fromCharCode(...sig)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}`;
    const r = await run("new",token);assert(r.status === 403 && r.writes === 0);
    assert(!r.calls.some(c => c.path.endsWith("claim_retained_listing_properties")));
  } finally { if(secret===undefined)Deno.env.delete("JWT_SIGNING_SECRET");else Deno.env.set("JWT_SIGNING_SECRET",secret); }
});
for (const [i,key] of ["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY"].entries()) {
  if (saved[i] === undefined) Deno.env.delete(key);else Deno.env.set(key,saved[i]!);
}
