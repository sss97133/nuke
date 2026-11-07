import { assert, assertEquals } from "jsr:@std/assert@1";
import { parseRetryAfter, classifyImage } from "./classifier.ts";
import { backoffSeconds, isRateLimited, nextConcurrency, readProviderGate, recordRateLimit } from "./providerBackoff.ts";
import { __setGuardDb, allowAllGuardDb } from "../_shared/geminiGuard.ts";

Deno.test("Retry-After parses seconds and dates, bounds garbage", () => {
  assertEquals(parseRetryAfter("30"), 30);
  assertEquals(parseRetryAfter(new Date(1_000_000 + 45_000).toUTCString(), 1_000_000 - (1_000_000 % 1000)) !== null, true);
  assertEquals(parseRetryAfter("nonsense"), null);
  assertEquals(parseRetryAfter(null), null);
  assertEquals(parseRetryAfter("999999999"), 86400);
});

Deno.test("backoff: exponential, jittered, Retry-After is a floor, capped", () => {
  const lo = () => 0, hi = () => 1;
  assert(backoffSeconds(1, null, lo) >= 36 && backoffSeconds(1, null, hi) <= 60);
  assert(backoffSeconds(3, null, lo) > backoffSeconds(1, null, hi));
  assert(backoffSeconds(1, 600, lo) >= 600);            // never sooner than the provider asked
  assertEquals(backoffSeconds(50, null, hi), 6 * 3600);  // capped
  assert(backoffSeconds(4, null, lo) !== backoffSeconds(4, null, hi)); // jitter spreads retries
});

Deno.test("concurrency halves on rate limit, recovers one step per success", () => {
  assertEquals(nextConcurrency(8, "rate_limited"), 4);
  assertEquals(nextConcurrency(1, "rate_limited"), 1);
  assertEquals(nextConcurrency(4, "success"), 5);
  assertEquals(nextConcurrency(8, "success"), 8);
});

Deno.test("rate-limit detection covers 429, 402 and guard cooldown, not ordinary failures", () => {
  assert(isRateLimited({ error_class: "classifier_rate_limited" }));
  assert(isRateLimited({ error_class: "provider_cooldown" }));
  assert(isRateLimited({ error_class: "classifier_count_http_error", http_status: 429 }));
  assert(isRateLimited({ http_status: 402 }));
  assert(!isRateLimited({ error_class: "image_mime_invalid" }));
  assert(!isRateLimited({ error_class: "classifier_http_error", http_status: 500 }));
  assert(!isRateLimited(undefined));
});

const stub = (status: number, headers: Record<string, string> = {}, body: unknown = {}) => (async (url: string | URL | Request) => {
  const u = String(url);
  if (u.includes("example.invalid")) return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } });
  if (u.includes("countTokens")) return Response.json({ totalTokens: 10 });
  return Response.json(body, { status, headers });
}) as typeof fetch;

Deno.test("429 on generation carries Retry-After into the receipt and is classified rate-limited", async () => {
  __setGuardDb(allowAllGuardDb());
  const r = await classifyImage("https://example.invalid/p.jpg", "k", stub(429, { "retry-after": "90" }));
  assertEquals(r.classifier_ok, false);
  assertEquals(r.classifier_receipt?.error_class, "classifier_rate_limited");
  assertEquals(r.classifier_receipt?.retry_after_seconds, 90);
  assert(isRateLimited(r.classifier_receipt));
  __setGuardDb(null);
});

Deno.test("429 on countTokens is rate-limited too (was an ordinary http error)", async () => {
  __setGuardDb(allowAllGuardDb());
  const f = (async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes("example.invalid")) return new Response(new Uint8Array([1]), { headers: { "content-type": "image/jpeg" } });
    return new Response("{}", { status: 429 });
  }) as typeof fetch;
  const r = await classifyImage("https://example.invalid/p.jpg", "k", f);
  assertEquals(r.classifier_receipt?.error_class, "classifier_rate_limited");
  assertEquals(r.classifier_receipt?.failure_phase, "token_count");
  __setGuardDb(null);
});

Deno.test("spend-guard refusal is provider_cooldown, not a photo failure", async () => {
  __setGuardDb(allowAllGuardDb());
  const r = await classifyImage("https://example.invalid/p.jpg", "k", stub(429, { "x-gemini-guard": "cooldown" }));
  assertEquals(r.classifier_receipt?.error_class, "provider_cooldown");
  assertEquals(r.classifier_receipt?.guard_reason, "cooldown");
  assert(isRateLimited(r.classifier_receipt));
  __setGuardDb(null);
});

Deno.test("gate: future blocked_until blocks; missing table or error never blocks", async () => {
  const db = (row: unknown, error: unknown = null) => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error }) }) }) }) });
  const now = Date.parse("2026-11-07T12:00:00Z");
  const blocked = await readProviderGate(db({ blocked_until: "2026-11-07T13:00:00Z", max_concurrency: 2 }), now);
  assertEquals([blocked.blocked, blocked.max_concurrency], [true, 2]);
  assertEquals((await readProviderGate(db({ blocked_until: "2026-11-07T11:00:00Z", max_concurrency: 3 }), now)).blocked, false);
  assertEquals((await readProviderGate(db(null, { code: "42P01" }), now)).blocked, false);
  assertEquals((await readProviderGate({ from: () => { throw new Error("x"); } }, now)).blocked, false);
});

Deno.test("recordRateLimit sends Retry-After to the RPC and survives RPC failure", async () => {
  let args: Record<string, unknown> = {};
  await recordRateLimit({ rpc: async (_f: string, a: Record<string, unknown>) => { args = a; return { data: { status: "pending" }, error: null }; } },
    "img", { model: null, attempts: 1, error_class: "classifier_rate_limited", http_status: 429, retry_after_seconds: 42 });
  assertEquals(args.p_retry_after_seconds, 42);
  assertEquals(args.p_http_status, 429);
  const out = await recordRateLimit({ rpc: async () => { throw new Error("down"); } }, "img", undefined);
  assertEquals(out, null);
});
