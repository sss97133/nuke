import { cloudVisionMultiJSON } from "./visionFallback.ts";
import { getUserApiKey } from "./getUserApiKey.ts";
import { ProviderHTTPError, VisionProviderUnavailable, safeAnthropicUsage } from "./providerDiagnostic.ts";
const equal = (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error("vision diagnostic contract differs"); };
const opts = { parts: [{ text: "offline fixture" }], throwOnUnavailable: true };
const missing = async () => ({ apiKey: "SYS_CANARY", source: "system" as const, userKeyStatus: "missing" as const });
async function unavailable(action: () => Promise<unknown>) {
  try { await action(); } catch (error) {
    if (error instanceof VisionProviderUnavailable) return error;
    throw error;
  }
  throw new Error("expected typed unavailability");
}

Deno.test("no connected user key stays BYOK-only and nullable callers remain compatible", async () => {
  let calls = 0;
  const deps = { getKey: missing, call: async () => { calls++; throw new Error("unexpected call"); } };
  const error = await unavailable(() => cloudVisionMultiJSON({}, "fixture-user", opts, deps));
  equal(error.diagnostics.map(d => [d.provider, d.code]), [["google", "no_connected_key"], ["anthropic", "no_connected_key"], ["openai", "no_connected_key"]]);
  equal(error.coverage.complete, true); equal(error.coverage.no_reading_started, true);
  equal(JSON.stringify(error).includes("SYS_CANARY"), false);
  equal(await cloudVisionMultiJSON({}, "fixture-user", { ...opts, throwOnUnavailable: false }, deps), null);
  equal(calls, 0);
});

Deno.test("a key lookup failure is not misreported as a missing connected key", async () => {
  const error = await unavailable(() => cloudVisionMultiJSON({}, "fixture-user", opts, {
    getKey: async () => { throw new Error("PRIVATE_LOOKUP_ERROR"); },
    call: async () => { throw new Error("unexpected call"); },
  }));
  equal(error.diagnostics.length, 3);
  equal(error.diagnostics.every(d => d.code === "credential_lookup_failed"), true);
  equal(error.coverage.no_reading_started, true);
  equal(JSON.stringify(error).includes("PRIVATE_LOOKUP_ERROR"), false);
});

Deno.test("actual legacy decryption adds kind metadata without changing credential bytes, selection or storage", async () => {
  const plain = JSON.stringify({ access_token: "PRIVATE_O", refresh_token: "fixture", expires_at: 1 });
  let selections = 0;
  const query: any = { select: () => { selections++; return query; }, eq: () => query, order: () => query, limit: () => query,
    maybeSingle: async () => ({ data: { api_key_encrypted: btoa(plain), model_name: "fixture-model" }, error: null }) };
  const client = { rpc: async () => ({ data: true, error: null }), from: () => query };
  const result = await getUserApiKey(client, "fixture-user", "anthropic", "UNUSED_ENV");
  equal(result.apiKey === plain, true);
  equal(result.credentialKind, "oauth");
  equal(result.source, "user"); equal(result.userKeyStatus, "available"); equal(selections, 1);
});

Deno.test("the actual401 provider path returns safe OAuth-kind diagnostics without rerouting or leaking body/header secrets", async () => {
  const previousFetch = globalThis.fetch, previousLog = console.log, previousWarn = console.warn, previousError = console.error;
  const logs: string[] = [];
  const key = JSON.stringify({ access_token: "PRIVATE_K", refresh_token: "fixture" });
  let calls = 0;
  globalThis.fetch = (async (url, init) => {
    equal(String(url), "https://api.anthropic.com/v1/messages");
    equal(new Headers(init?.headers).get("x-api-key") === key, true);
    calls++;
    return new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "PRIVATE_PROVIDER_CANARY" } }),
      { status: 401, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  console.log = console.warn = console.error = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
  try {
    const error = await unavailable(() => cloudVisionMultiJSON({}, "fixture-user", opts, {
      getKey: async (_db, _user, provider) => provider === "anthropic"
        ? { apiKey: key, source: "user", credentialKind: "oauth", modelName: "fixture-model", userKeyStatus: "available" }
        : missing(),
    }));
    equal(error.diagnostics.find(d => d.provider === "anthropic"),
      { code: "credential_not_accepted", provider: "anthropic", http_status: 401, credential_kind: "oauth" });
    equal(error.coverage, { method: "byok_vision_attempts_v1", expected_providers: 3, assessed_providers: 3,
      outcomes_observed: 3, complete: true, no_reading_started: true });
    equal(calls, 1);
    equal((JSON.stringify(error) + logs.join(" ")).includes("PRIVATE_"), false);
  } finally { globalThis.fetch = previousFetch; console.log = previousLog; console.warn = previousWarn; console.error = previousError; }
});

Deno.test("existing user-provider preference and fallback order are unchanged with diagnostics enabled", async () => {
  const attempted: string[] = [];
  const result = await cloudVisionMultiJSON({}, "fixture-user", opts, {
    getKey: async () => ({ apiKey: "fixture", source: "user", userKeyStatus: "available", credentialKind: "unrecognized" }),
    call: async cfg => {
      attempted.push(cfg.provider);
      if (cfg.provider === "google") throw new ProviderHTTPError("google", 503, null);
      return { content: '{"ok":true}' };
    },
  });
  equal(attempted, ["google", "anthropic"]);
  equal(result?.provider, "anthropic"); equal(result?.data, { ok: true });
});

Deno.test("a paid response with unreadable JSON remains ambiguous and never becomes no-connected-key", async () => {
  let calls = 0;
  const error = await unavailable(() => cloudVisionMultiJSON({}, "fixture-user", opts, {
    getKey: async (_db, _user, provider) => provider === "anthropic"
      ? { apiKey: "fixture", source: "user", credentialKind: "unrecognized" } : missing(),
    call: async () => { calls++; return { content: "unreadable output" }; },
  }));
  equal(calls, 1);
  equal(error.diagnostics.find(d => d.provider === "anthropic")?.code, "response_unreadable");
  equal(error.coverage.complete, true); equal(error.coverage.no_reading_started, false);
});

Deno.test("usage admits only bounded provider counters and absence never becomes zero spend", () => {
  const raw = { input_tokens: 1200, output_tokens: 300, cache_creation_input_tokens: 0,
    cache_read_input_tokens: 10, private_canary: "PRIVATE_USAGE_METADATA" };
  equal(safeAnthropicUsage(raw), { input_tokens: 1200, output_tokens: 300,
    cache_creation_input_tokens: 0, cache_read_input_tokens: 10 });
  equal(safeAnthropicUsage(undefined), null);
  for (const bad of [-1, 1.5, "1200", Infinity, NaN, 1_000_000_001]) equal(safeAnthropicUsage({ ...raw, input_tokens: bad }), null);
  equal(safeAnthropicUsage({ input_tokens: 0, output_tokens: 0 }), {
    input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: null, cache_read_input_tokens: null });
});

Deno.test("actual Anthropic response retains safe usage without another provider call", async () => {
  const previousFetch = globalThis.fetch, previousLog = console.log;
  const logs: string[] = []; let calls = 0;
  globalThis.fetch = (async (url) => {
    equal(String(url), "https://api.anthropic.com/v1/messages"); calls++;
    return new Response(JSON.stringify({ content: [{ type: "text", text: '{"ok":true}' }],
      usage: { input_tokens: 1200, output_tokens: 300, cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0, private_canary: "PRIVATE_USAGE_METADATA" }, stop_reason: "end_turn" }),
      { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  console.log = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
  try {
    const result = await cloudVisionMultiJSON({}, "fixture-user", opts, {
      getKey: async (_db, _user, provider) => provider === "anthropic"
        ? { apiKey: "KEY_CANARY", source: "user", modelName: "fixture-model", credentialKind: "api_key" } : missing(),
    });
    equal(calls, 1); equal(result?.data, { ok: true });
    equal(result?.usage, { input_tokens: 1200, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 });
    equal(logs.some(log => log.includes("anthropic_token_usage")), true);
    equal((JSON.stringify(result) + logs.join(" ")).includes("PRIVATE_"), false);
    equal((JSON.stringify(result) + logs.join(" ")).includes("KEY_CANARY"), false);
  } finally { globalThis.fetch = previousFetch; console.log = previousLog; }
});

Deno.test("unreadable paid output logs only counters and remains unsafe to retry fresh", async () => {
  const previousLog = console.log; const logs: string[] = [];
  console.log = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
  try {
    const error = await unavailable(() => cloudVisionMultiJSON({}, "fixture-user", opts, {
      getKey: async (_db, _user, provider) => provider === "anthropic" ? { apiKey: "fixture", source: "user" } : missing(),
      call: async () => ({ content: "PRIVATE_UNREADABLE_OUTPUT", usage: { input_tokens: 700, output_tokens: 20, private_canary: "PRIVATE_METADATA" } }),
    }));
    equal(error.coverage.no_reading_started, false);
    equal(logs.some(log => log.includes('"input_tokens":700')), true);
    equal(logs.join(" ").includes("PRIVATE_"), false);
  } finally { console.log = previousLog; }
});
