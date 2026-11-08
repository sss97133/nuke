// v101 contract tests for the OpenAI-primary / Gemini-fallback router. LOCAL ONLY: every network call is a stub.
// Any URL that is not one of the stubbed synthetic hosts throws, so a test can never reach a real service.
import { __setGuardDb, allowAllGuardDb } from "../_shared/geminiGuard.ts";
__setGuardDb(allowAllGuardDb());
Deno.env.set("SUPABASE_URL", "https://supa.example.invalid");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-key");
Deno.env.set("OPENAI_API_KEY", "synthetic-openai-key");
for (const k of ["OPEN_AI_API_KEY", "GOOGLE_AI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "free_api_key"]) Deno.env.delete(k);

// ---- controllable clock + timers (backoff is recorded, never slept) ----
const realNow = Date.now.bind(Date);
let skew = 0;
Date.now = () => realNow() + skew;
const advance = (ms: number) => { skew += ms; };
const realSetTimeout = globalThis.setTimeout;
let delays: number[] = [];
globalThis.setTimeout = ((fn: () => void, ms?: number) => {
  if (!String(new Error().stack).includes("loadManifest")) delays.push(Number(ms)); // the manifest RPC race timer is not a backoff
  return realSetTimeout(fn, 0);
}) as typeof setTimeout;

// ---- stubbed supabase REST (platform_config, manifest rpc, llm_cost_tracking) ----
let routeCfg: Record<string, unknown> | null = null;
let spend: Record<string, unknown>[] = [];
const origFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (u.origin !== "https://supa.example.invalid") throw new Error("unexpected global network call: " + u.origin);
  if (u.pathname === "/rest/v1/platform_config") return Response.json(routeCfg ? { config_value: routeCfg } : {});
  if (u.pathname === "/rest/v1/rpc/classifier_schema_manifest") return Response.json({ message: "absent" }, { status: 404 });
  if (u.pathname === "/rest/v1/llm_cost_tracking" && init?.method === "POST") { spend.push(JSON.parse(String(init.body))); return new Response(null, { status: 201 }); }
  throw new Error("unexpected supabase path " + u.pathname);
}) as typeof fetch;

const { classifyImageRouted, classifyWithOpenAI, parseRouteConfig } = await import("./classifierProvider.ts");
const { PROMPT, CLASSIFIER_BUDGET } = await import("./classifier.ts");

function assert(v: unknown, m = "assertion failed"): asserts v { if (!v) throw new Error(m); }
const T = { sanitizeOps: false, sanitizeResources: false } as const;

const valid = { image_type: "engine_bay", image_medium: "photograph", confidence: 0.9, is_automotive: true, description: "A visible component" };
const oaOk = (content: unknown = valid) => Response.json({ model: "gpt-4.1-mini-2025", usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 },
  choices: [{ finish_reason: "stop", message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] });
const gUsage = { promptTokenCount: 1024, candidatesTokenCount: 100, totalTokenCount: 1124 };
const gOk = () => Response.json({ usageMetadata: gUsage, candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(valid) }] } }] });
const img = () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } });
const URL_IMG = "https://img.example.invalid/a.jpg";

interface Rig { openai: (n: number, body: any) => Response; gemini: (n: number) => Response; image: (url: string, n: number) => Response }
function rig(over: Partial<Rig> = {}) {
  const r: Rig = { openai: () => oaOk(), gemini: () => gOk(), image: () => img(), ...over };
  const log = { openai: [] as any[], gemini: [] as string[], geminiGenerate: 0, image: [] as string[], other: [] as string[] };
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (u.origin === "https://api.openai.com") {
      const body = JSON.parse(String(init?.body)); log.openai.push({ body, auth: new Headers(init?.headers).get("authorization") });
      return r.openai(log.openai.length, body);
    }
    if (u.origin === "https://generativelanguage.googleapis.com") {
      log.gemini.push(u.pathname);
      if (u.pathname.endsWith(":countTokens")) return Response.json({ totalTokens: 1024 });
      log.geminiGenerate++; return r.gemini(log.geminiGenerate);
    }
    if (u.origin === "https://img.example.invalid" || u.pathname.includes("/storage/v1/")) { log.image.push(u.pathname + u.search); return r.image(u.href, log.image.length); }
    log.other.push(u.href); throw new Error("unexpected provider-side call: " + u.origin);
  }) as typeof fetch;
  return { fetchImpl, log };
}
// each test starts after the config cache (60 s) and any breaker (10 min) have expired
function fresh(cfg: Record<string, unknown> | null = null) { advance(11 * 60_000 + 1); routeCfg = cfg; spend = []; delays = []; }
const err = (r: any) => String(r.classifier_receipt?.error_class);

Deno.test("parseRouteConfig defaults: missing row => openai primary, gpt-4.1-mini, gemini fallback on", () => {
  for (const raw of [null, undefined, {}, "x", []]) {
    const c = parseRouteConfig(raw); assert(c.primary === "openai" && c.openai_model === "gpt-4.1-mini" && c.gemini_fallback === true);
  }
  const g = parseRouteConfig({ primary: "gemini", openai_model: "gpt-4.1", gemini_fallback: false });
  assert(g.primary === "gemini" && g.openai_model === "gpt-4.1" && g.gemini_fallback === false);
  assert(parseRouteConfig({ openai_model: "not-priced" }).openai_model === "gpt-4.1-mini", "unknown model must fall back to the priced default");
});

Deno.test({ name: "default route: OpenAI first, one call, no Gemini, spend row recorded, key only sent to OpenAI", ...T, fn: async () => {
  fresh(); const { fetchImpl, log } = rig();
  const r = await classifyImageRouted(URL_IMG, "synthetic-gemini-key", fetchImpl);
  assert(r.classifier_ok === true && r.classifier_receipt?.model === "openai:gpt-4.1-mini");
  assert(log.openai.length === 1 && log.gemini.length === 0);
  assert(log.openai[0].auth === "Bearer synthetic-openai-key" && log.openai[0].body.model === "gpt-4.1-mini");
  assert(log.openai[0].body.messages[0].content[0].text.includes("CITATION RULES"), "v98 prompt first");
  await new Promise((res) => realSetTimeout(res, 20));
  assert(spend.length === 1 && spend[0].provider === "openai" && spend[0].caller === "photo-pipeline-orchestrator" && spend[0].input_tokens === 1000);
}});

Deno.test({ name: "primary=gemini: Gemini first, OpenAI untouched on success; OpenAI used only if Gemini fails", ...T, fn: async () => {
  fresh({ primary: "gemini" }); let t = rig();
  let r = await classifyImageRouted(URL_IMG, "gk", t.fetchImpl);
  assert(r.classifier_ok && t.log.openai.length === 0 && t.log.geminiGenerate === 1);
  fresh({ primary: "gemini" }); t = rig({ gemini: () => new Response("x", { status: 500 }) });
  r = await classifyImageRouted(URL_IMG, "gk", t.fetchImpl);
  assert(r.classifier_ok && t.log.openai.length === 1 && t.log.geminiGenerate === 1);
  fresh({ primary: "gemini" }); t = rig({ gemini: () => new Response("x", { status: 500 }) });
  r = await classifyImageRouted(URL_IMG, undefined, t.fetchImpl);   // gemini primary, no Gemini key: key_missing is a Gemini failure, so OpenAI answers
  assert(r.classifier_ok && t.log.openai.length === 1 && t.log.geminiGenerate === 0, "gemini-primary without a key falls to OpenAI");
}});

Deno.test({ name: "OpenAI 429 + Retry-After: 3 tries, honoured delay, breaker 20 s, Gemini fallback; breaker skips OpenAI then expires", ...T, fn: async () => {
  fresh(); let t = rig({ openai: () => new Response("slow down", { status: 429, headers: { "retry-after": "2" } }) });
  let r = await classifyImageRouted(URL_IMG, "gk", t.fetchImpl);
  assert(t.log.openai.length === 3, "3 OpenAI tries, got " + t.log.openai.length);
  const waits = delays.filter((d) => d >= 1000);
  assert(waits.length === 2 && waits.every((d) => d >= 1700 && d <= 2300), "Retry-After 2s honoured (+-15%): " + waits);
  assert(r.classifier_ok && t.log.geminiGenerate === 1, "fell back to Gemini");
  // within the 20 s breaker: OpenAI is not even attempted
  advance(5_000); delays = []; t = rig();
  r = await classifyImageRouted(URL_IMG, "gk", t.fetchImpl);
  assert(t.log.openai.length === 0 && r.classifier_ok, "breaker active");
  // after it expires OpenAI is tried again (config cache also expired by now)
  advance(30_000); t = rig(); r = await classifyImageRouted(URL_IMG, "gk", t.fetchImpl);
  assert(t.log.openai.length === 1 && r.classifier_ok && r.classifier_receipt?.model?.startsWith("openai:"));
}});

Deno.test({ name: "OpenAI 401/402/403: no retry, 10 min breaker reports provider_cooldown with zero OpenAI fetches", ...T, fn: async () => {
  for (const status of [401, 402, 403]) {
    fresh(); let t = rig({ openai: () => new Response("no", { status }) });
    let r = await classifyImageRouted(URL_IMG, undefined, t.fetchImpl);   // no Gemini key: the OpenAI failure itself is returned
    assert(t.log.openai.length === 1 && r.classifier_ok === false && err(r) === "classifier_http_error" && r.classifier_receipt?.http_status === status);
    advance(5 * 60_000); t = rig();
    r = await classifyImageRouted(URL_IMG, undefined, t.fetchImpl);
    assert(t.log.openai.length === 0 && err(r) === "provider_cooldown", status + " cooldown " + err(r));
    advance(6 * 60_000 + 1); t = rig();
    r = await classifyImageRouted(URL_IMG, undefined, t.fetchImpl);
    assert(t.log.openai.length === 1 && r.classifier_ok, "breaker released after 10 min");
  }
}});

Deno.test({ name: "image-side terminal errors do not spend Gemini; 5xx image error does reach the fallback", ...T, fn: async () => {
  for (const [label, make, cls] of [
    ["mime", () => new Response("<html>", { headers: { "content-type": "text/html" } }), "image_mime_invalid"],
    ["404", () => new Response("", { status: 404 }), "image_http_error"],
    ["oversize", () => new Response(new Uint8Array(CLASSIFIER_BUDGET.image_bytes + 1), { headers: { "content-type": "image/jpeg" } }), "payload_too_large"],
  ] as const) {
    fresh(); const t = rig({ image: make });
    const r = await classifyImageRouted(URL_IMG, "gk", t.fetchImpl);
    assert(r.classifier_ok === false && err(r) === cls && t.log.gemini.length === 0 && t.log.openai.length === 0, label + " " + err(r));
  }
  fresh(); const t = rig({ image: () => new Response("", { status: 503 }) });
  const r = await classifyImageRouted(URL_IMG, "gk", t.fetchImpl);
  assert(r.classifier_ok === false && t.log.image.length >= 2, "503 image error is retried on the fallback path (image fetched again)");
}});

Deno.test({ name: "both providers fail: primary failure reported with the fallback's class; cooldown case reports the fallback's", ...T, fn: async () => {
  fresh(); let t = rig({ openai: () => new Response("x", { status: 500 }), gemini: () => new Response("x", { status: 500 }) });
  let r = await classifyImageRouted(URL_IMG, "gk", t.fetchImpl);
  assert(t.log.openai.length === 3 && r.classifier_ok === false && r.classifier_receipt?.model?.startsWith("openai:"));
  assert(err(r) === "classifier_http_error" && r.classifier_receipt?.http_status === 500);
  assert(r.classifier_receipt?.fallback_error_class === "classifier_http_error" && r.classifier_receipt?.fallback_http_status === 500);
  // breaker still active from the 500s? (500 does not trip it) -> use a 402 to trip it, then fail Gemini too
  fresh(); t = rig({ openai: () => new Response("x", { status: 402 }), gemini: () => new Response("x", { status: 500 }) });
  await classifyImageRouted(URL_IMG, "gk", t.fetchImpl);
  advance(1000); t = rig({ gemini: () => new Response("x", { status: 500 }) });
  r = await classifyImageRouted(URL_IMG, "gk", t.fetchImpl);
  assert(t.log.openai.length === 0 && r.classifier_receipt?.model !== null && r.classifier_receipt?.fallback_error_class === "provider_cooldown", "cooldown noted on the fallback's failure: " + JSON.stringify(r.classifier_receipt));
}});

Deno.test({ name: "gemini_fallback=false never calls Gemini", ...T, fn: async () => {
  fresh({ gemini_fallback: false }); const t = rig({ openai: () => new Response("x", { status: 500 }) });
  const r = await classifyImageRouted(URL_IMG, "gk", t.fetchImpl);
  assert(r.classifier_ok === false && t.log.gemini.length === 0);
}});

Deno.test({ name: "unusable v98 answer gets exactly one legacy-prompt retry", ...T, fn: async () => {
  fresh(); const t = rig({ openai: (n) => n === 1 ? oaOk("not json") : oaOk() });
  const r = await classifyImageRouted(URL_IMG, "gk", t.fetchImpl);
  assert(r.classifier_ok && t.log.openai.length === 2 && t.log.geminiGenerate === 0);
  assert(t.log.openai[0].body.messages[0].content[0].text.includes("CITATION RULES") && t.log.openai[0].body.max_tokens === 3000);
  assert(t.log.openai[1].body.messages[0].content[0].text === PROMPT && t.log.openai[1].body.max_tokens === CLASSIFIER_BUDGET.output_tokens);
  assert(r.classifier_receipt?.prompt_version === undefined, "legacy answer carries no v98 prompt_version");
  fresh(); const t2 = rig({ openai: () => oaOk("not json") });   // both unusable: one retry only, then Gemini
  const r2 = await classifyImageRouted(URL_IMG, "gk", t2.fetchImpl);
  assert(t2.log.openai.length === 2 && r2.classifier_ok && t2.log.geminiGenerate === 1);
}});

Deno.test({ name: "Gemini guard refusals (paused / cap / unavailable) are not retried and spend no provider call", ...T, fn: async () => {
  const mk = (cfg: unknown, count: number, cfgErr = false) => ({
    from(table: string) {
      const q: any = {}; for (const m of ["select", "eq", "gte", "insert", "update"]) q[m] = () => q;
      q.maybeSingle = async () => table === "platform_config" ? (cfgErr ? { data: null, error: { message: "boom" } } : { data: { config_value: cfg }, error: null }) : { data: { id: "r" }, error: null };
      q.then = (ok: any, bad?: any) => Promise.resolve({ count, data: null, error: null }).then(ok, bad);
      return q;
    },
  });
  try {
  for (const [label, db, reason] of [["paused", mk({ paused: true }, 0), "paused"], ["daily cap", mk({ daily_cap: 5 }, 5), "daily_cap"], ["config unreadable", mk(null, 0, true), "unavailable"]] as const) {
    __setGuardDb(db as any); fresh(); const t = rig({ openai: () => new Response("x", { status: 500 }) });
    const r = await classifyImageRouted(URL_IMG, "gk", t.fetchImpl);
    // KNOWN GAP (pre-existing in the repo's classifier.ts, not a v101 delta): classifyImage sends :countTokens through raw fetch,
    // not geminiFetch, so a paused/capped guard still lets ONE unmetered countTokens request out per image. generateContent is blocked.
    assert(r.classifier_ok === false && t.log.geminiGenerate === 0 && t.log.gemini.every((p) => p.endsWith(":countTokens")) && t.log.gemini.length === 1,
      label + ": generateContent blocked " + JSON.stringify({ ok: r.classifier_ok, g: t.log.gemini, o: t.log.openai.length, rc: r.classifier_receipt }));
    assert(delays.filter((d) => d >= 1000).length === 2, label + ": only the 2 OpenAI backoffs, no Gemini retry sleep: " + delays);
    assert(typeof r.classifier_receipt?.fallback_error_class === "string", label + " fallback class noted: " + JSON.stringify(r.classifier_receipt));
    console.log("  guard refusal", reason, "-> fallback_error_class", r.classifier_receipt?.fallback_error_class);
  }
  } finally { __setGuardDb(allowAllGuardDb()); }
}});

Deno.test({ name: "genuine Google 429 with a RetryInfo hint gets exactly one backoff retry", ...T, fn: async () => {
  const quota = (secs: string) => Response.json({ error: { message: "x", details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: secs }] } }, { status: 429 });
  fresh({ primary: "openai" }); let t = rig({ openai: () => new Response("x", { status: 500 }), gemini: (n) => n === 1 ? quota("5s") : gOk() });
  let r = await classifyImageRouted(URL_IMG, "gk", t.fetchImpl);
  assert(t.log.geminiGenerate === 2 && r.classifier_ok, "retry succeeded " + JSON.stringify({ g: t.log.geminiGenerate, rc: r.classifier_receipt, d: delays }));
  assert(delays.some((d) => d >= 5000 && d <= 6000), "hinted delay slept: " + delays);
  fresh(); t = rig({ openai: () => new Response("x", { status: 500 }), gemini: () => quota("60s") });   // hint > 20 s: not retried
  r = await classifyImageRouted(URL_IMG, "gk", t.fetchImpl);
  assert(t.log.geminiGenerate === 1 && r.classifier_ok === false);
}});

Deno.test({ name: "renderer path: storage URL fetched as 1600px JPEG first; renderer 5xx is a classified image_http_error", ...T, fn: async () => {
  const S = "https://supa.example.invalid/storage/v1/object/public/bucket/a.heic";
  fresh(); let t = rig();
  const r = await classifyImageRouted(S, undefined, t.fetchImpl);
  assert(r.classifier_ok && t.log.image[0].includes("/storage/v1/render/image/public/bucket/a.heic") && t.log.image[0].includes("width=1600") && r.classifier_receipt?.image_resized === "render_1600");
  fresh(); t = rig({ image: () => new Response("", { status: 503 }) });
  const r2 = await classifyImageRouted(S, undefined, t.fetchImpl);
  assert(r2.classifier_ok === false && err(r2) === "image_http_error" && r2.classifier_receipt?.http_status === 503 && t.log.image.length === 1, "renderer 5xx does not fall through to the raw object");
}});

Deno.test({ name: "VIN: checksum-valid read is kept (v2.vin.checksum_ok) and drives vin_detected; a bad check digit nulls vin_detected", ...T, fn: async () => {
  for (const [vin, ok] of [["1HGCM82633A004352", true], ["1HGCM82633A004353", false]] as const) {
    fresh(); const t = rig({ openai: () => oaOk({ ...valid, vin: { value: vin, confidence: 0.95, evidence: "plate reads " + vin }, vin_detected: vin }) });
    const r = await classifyImageRouted(URL_IMG, undefined, t.fetchImpl);
    assert(r.classifier_ok && r.v2?.vin?.checksum_ok === ok && (r.vin_detected ?? null) === (ok ? vin : null), vin + " " + JSON.stringify(r.v2?.vin) + " " + r.vin_detected);
  }
}});

Deno.test({ name: "missing OpenAI key: no OpenAI call, classifier_key_missing, Gemini fallback still available", ...T, fn: async () => {
  Deno.env.delete("OPENAI_API_KEY"); try {
    fresh(); const t = rig();
    const r = await classifyImageRouted(URL_IMG, "gk", t.fetchImpl);
    assert(r.classifier_ok && t.log.openai.length === 0 && t.log.geminiGenerate === 1, "key-missing fallback " + JSON.stringify({ r, o: t.log.openai.length, g: t.log.geminiGenerate }));
    fresh(); const t2 = rig(); const r2 = await classifyImageRouted(URL_IMG, undefined, t2.fetchImpl);
    assert(r2.classifier_ok === false && err(r2) === "classifier_key_missing" && t2.log.image.length === 0 && t2.log.openai.length === 0);
  } finally { Deno.env.set("OPENAI_API_KEY", "synthetic-openai-key"); }
  const bad = await classifyWithOpenAI(URL_IMG, "k", "not-priced", rig().fetchImpl);
  assert(bad.classifier_ok === false && err(bad) === "classifier_model_invalid");
}});

void origFetch; // global fetch stays stubbed for the life of this test process (it only answers synthetic hosts)
