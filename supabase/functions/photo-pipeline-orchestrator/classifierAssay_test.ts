import { runClassifierAssay } from "./classifierAssay.ts";

const imageId = "eada407d-2206-46e4-89db-490743c723d1";
const vehicleId = "2e61fa34-c5b4-4709-9636-4823546a5bc4";
const eventId = "561c96be-3855-41cf-ae08-bf31ba3fcb4d";
const sourceUrl = "https://bringatrailer.com/listing/2006-pontiac-solstice-92/";
const imageUrl = "https://bringatrailer.com/wp-content/uploads/2026/09/0001-72395.jpg";
const realFetch = globalThis.fetch;
const envNames = ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_JWT_SECRET", "GOOGLE_AI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "free_api_key"];
const oldEnv = new Map(envNames.map(name => [name, Deno.env.get(name)]));
const assert = (value: unknown) => { if (!value) throw new Error("assertion failed"); };
let source: any, vehicle: any, event: any, queries: any[], generationStatus: number;
let fetches: string[], generationBody: any, generationKey: string | null;
let failTable: string | null;
function reset() {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");
  Deno.env.set("SUPABASE_JWT_SECRET", "assay-signing-secret");
  Deno.env.set("GOOGLE_AI_API_KEY", "production-google-priority");
  Deno.env.set("GEMINI_API_KEY", "secondary-must-not-be-called");
  source = { id: imageId, vehicle_id: vehicleId, image_url: imageUrl, source: "bat_import",
    is_external: true, is_sensitive: false, is_document: false, is_duplicate: false, is_superseded: false,
    is_approved: true, approval_status: "auto_approved", verification_status: "approved", redaction_level: "none",
    vehicle_image_gallery_eligible: true, exif_data: { listing_urls: [sourceUrl] } };
  vehicle = { id: vehicleId, is_public: true };
  event = { id: eventId, vehicle_id: vehicleId, source: "bat", source_url: sourceUrl };
  queries = []; fetches = []; generationStatus = 200; generationBody = null; generationKey = null; failTable = null;
}
const db = {
  from(table: string) {
    const q: any = { table, filters: [], signal: null }; queries.push(q);
    const builder: any = {
      select(columns: string) { q.columns = columns; return builder; },
      eq(key: string, value: unknown) { q.filters.push([key, value]); return builder; },
      in(key: string, value: unknown) { q.filters.push([key, value]); return builder; },
      limit(value: number) { q.limit = value; return builder; },
      abortSignal(signal: AbortSignal) { q.signal = signal; return builder; },
      maybeSingle() {
        if (failTable === table) return Promise.resolve({ data: null, error: { message: "private database detail" } });
        return Promise.resolve({ data: structuredClone(table === "vehicle_images" ? source : table === "vehicles" ? vehicle : event), error: null });
      },
    };
    for (const write of ["insert", "update", "upsert", "delete"]) builder[write] = () => { throw new Error("forbidden write"); };
    return builder;
  },
  rpc() { throw new Error("forbidden RPC"); },
  functions: { invoke() { throw new Error("forbidden downstream function"); } },
};
globalThis.fetch = (async (input, init) => {
  const url = String(input); fetches.push(url);
  if (url === imageUrl) return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { headers: { "Content-Type": "image/jpeg" } });
  if (url === "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:countTokens") {
    return Response.json({ totalTokens: 643 });
  }
  if (url === "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent") {
    generationBody = JSON.parse(String(init?.body)); generationKey = new Headers(init?.headers).get("x-goog-api-key");
    if (generationStatus !== 200) return Response.json({ error: { message: "private provider text" } }, { status: generationStatus });
    return Response.json({ modelVersion: "gemini-2.5-flash", usageMetadata: { promptTokenCount: 643, candidatesTokenCount: 90, totalTokenCount: 733 },
      candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ image_type: "vehicle_exterior", image_medium: "photograph",
        confidence: 0.8, is_automotive: true, description: "Black convertible, front three-quarter view" }) }] } }] });
  }
  throw new Error("unexpected network or downstream call");
}) as typeof fetch;
function request(token = "test-key", input: Record<string, unknown> = { action: "classifier_assay", image_id: imageId }) {
  return new Request("https://example.invalid/functions/v1/photo-pipeline-orchestrator", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
}
async function run(input: Record<string, unknown> = { action: "classifier_assay", image_id: imageId }, token?: string) {
  const response = await runClassifierAssay(request(token, input), input, db);
  return { response, body: await response.json() };
}
async function userJwt() {
  const b64 = (v: unknown) => btoa(JSON.stringify(v)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const data = `${b64({ alg: "HS256" })}.${b64({ role: "authenticated", sub: vehicleId, exp: Math.floor(Date.now() / 1000) + 600 })}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("assay-signing-secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
  return `${data}.${btoa(String.fromCharCode(...signature)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}

Deno.test("public source assay performs three bounded reads and one counted generation, zero writes or downstream work", async () => {
  reset(); const original = structuredClone(source); const { response, body } = await run();
  assert(response.status === 200 && body.success && body.classifier_ok && body.db_writes === 0 && body.downstream_calls === 0 && !body.state_persisted);
  assert(body.image_id === imageId && body.vehicle_id === vehicleId && body.auction_event_id === eventId);
  assert(body.classification.image_type === "vehicle_exterior" && body.classifier_receipt.usage.total_tokens === 733);
  assert(/^[a-f0-9]{64}$/.test(body.classifier_receipt.image_sha256) && /^[a-f0-9]{64}$/.test(body.classifier_receipt.input_sha256));
  assert(body.classifier_receipt.model_version === "gemini-2.5-flash" && body.classifier_receipt.attempts === 1);
  assert(queries.length === 3 && queries.every(q => q.signal instanceof AbortSignal));
  assert(queries[0].filters.some(([key, value]: any[]) => key === "vehicle_image_gallery_eligible" && value === true));
  assert(queries[2].filters.some(([key, value]: any[]) => key === "vehicle_id" && value === vehicleId));
  assert(fetches.length === 3 && generationKey === "production-google-priority");
  assert(generationBody.generationConfig.maxOutputTokens === 768 && generationBody.generationConfig.thinkingConfig.thinkingBudget === 0);
  assert(JSON.stringify(source) === JSON.stringify(original) && response.headers.get("cache-control") === "no-store");
});
Deno.test("assay refuses anonymous and authenticated users before reading sources", async () => {
  reset(); let result = await run(undefined, "invalid"); assert(result.response.status === 401);
  result = await run(undefined, await userJwt()); assert(result.response.status === 403);
  assert(queries.length === 0 && fetches.length === 0);
});
Deno.test("assay accepts only one explicit canonical image ID and no caller URL, model, or cohort", async () => {
  for (const input of [{ action: "classifier_assay", image_id: "invalid" }, { action: "classifier_assay", image_id: [imageId] },
    { action: "classifier_assay", image_id: imageId, image_url: imageUrl }, { action: "classifier_assay", image_id: imageId, model: "other" }]) {
    reset(); const result = await run(input); assert(result.response.status === 400 && queries.length === 0 && fetches.length === 0);
  }
});
Deno.test("assay holds unpublished, private, sensitive, rejected, or unrelated source rows without provider calls", async () => {
  for (const patch of [{ vehicle_image_gallery_eligible: false }, { source: "user_upload" }, { is_external: false }, { is_sensitive: true },
    { is_document: true }, { is_duplicate: true }, { is_superseded: true }, { is_approved: false }, { approval_status: "pending" },
    { verification_status: "pending" }, { redaction_level: "full" }, { image_url: "http://bringatrailer.com/wp-content/uploads/a.jpg" },
    { image_url: "https://bringatrailer.com.attacker.invalid/wp-content/uploads/a.jpg" }, { image_url: "https://user@bringatrailer.com/wp-content/uploads/a.jpg" },
    { image_url: "https://bringatrailer.com:8443/wp-content/uploads/a.jpg" }, { exif_data: {} }]) {
    reset(); Object.assign(source, patch); const result = await run(); assert(result.response.status === 403 && fetches.length === 0);
  }
});
Deno.test("a public-looking image cannot bypass private vehicle or wrong-auction provenance", async () => {
  reset(); vehicle.is_public = false; assert((await run()).response.status === 403 && fetches.length === 0);
  reset(); event.vehicle_id = imageId; assert((await run()).response.status === 403 && fetches.length === 0);
  reset(); event.source_url = "https://bringatrailer.com/listing/unrelated-car/"; assert((await run()).response.status === 403 && fetches.length === 0);
  reset(); event.source = "other"; assert((await run()).response.status === 403 && fetches.length === 0);
});
Deno.test("assay source read failures stay static and spend no model tokens", async () => {
  for (const table of ["vehicle_images", "vehicles", "auction_events"]) {
    reset(); failTable = table; const result = await run();
    assert(result.response.status === 503 && fetches.length === 0 && !JSON.stringify(result.body).includes("private database"));
  }
});
Deno.test("provider refusal is failed assay with unknown usage and never a second provider or fallback classification", async () => {
  reset(); generationStatus = 429; const result = await run();
  assert(result.response.status === 502 && result.body.success === false && result.body.classification === null);
  assert(result.body.classifier_receipt.attempts === 1 && result.body.classifier_receipt.usage === undefined);
  assert(result.body.classifier_receipt.http_status === 429 && fetches.length === 3 && queries.length === 3);
  assert(!JSON.stringify(result.body).includes("private provider"));
});
Deno.test("restore classifier assay fixture", () => {
  globalThis.fetch = realFetch;
  for (const [name, value] of oldEnv) value === undefined ? Deno.env.delete(name) : Deno.env.set(name, value);
});
