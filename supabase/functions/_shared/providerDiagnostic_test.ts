import { credentialKind, ProviderHTTPError, safeProviderDiagnostics, VisionProviderUnavailable, type ProviderDiagnostic } from "./providerDiagnostic.ts";
const equal = (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error("diagnostic contract differs"); };

Deno.test("credential kind inspects only in-memory shape and never assumes an unknown key is invalid", () => {
  equal(credentialKind(["sk", "ant", "api", "fixture"].join("-"), "anthropic"), "api_key");
  equal(credentialKind(["sk", "ant", "oat", "fixture"].join("-"), "anthropic"), "oauth");
  equal(credentialKind(JSON.stringify({ access_token: "fixture", refresh_token: "fixture", expires_at: 1 }), "anthropic"), "oauth");
  equal(credentialKind("{not-json", "anthropic"), "unrecognized");
  equal(credentialKind("a-credential-with-an-unfamiliar-format", "openai"), "unrecognized");
});

Deno.test("HTTP evidence separates rejected credentials, permission, billing, rate-or-quota and transient errors", () => {
  const diagnostic = (status: number, body: unknown = null, provider: "anthropic" | "openai" | "google" = "anthropic", guard = false) =>
    new ProviderHTTPError(provider, status, body, guard).diagnostic.code;
  equal(diagnostic(401), "credential_not_accepted");
  equal(diagnostic(403), "permission_denied");
  equal(diagnostic(402), "billing_or_usage_limit");
  equal(diagnostic(429), "rate_or_quota_limit");
  equal(diagnostic(429, { error: { code: "credit_balance_exhausted" } }, "openai"), "billing_or_usage_limit");
  equal(diagnostic(429, { error: { code: "project_spend_limit_exceeded" } }, "openai"), "billing_or_usage_limit");
  equal(diagnostic(400, { error: { message: "some billing-looking prose" } }), "request_refused");
  equal(diagnostic(529), "provider_transient");
  equal(diagnostic(408), "provider_transient");
  equal(diagnostic(429, null, "google", true), "service_guard_held");
  equal(diagnostic(503, null, "google", true), "service_guard_held");
  for (const [provider, prefix] of [["anthropic", "Anthropic"], ["openai", "OpenAI"], ["google", "Google"]] as const) {
    equal(new ProviderHTTPError(provider, 401, { error: { message: "PRIVATE_PROVIDER_CANARY" } }).message,
      `${prefix} API error: 401 - credential_not_accepted`);
  }
});

Deno.test("diagnostics cannot retain provider prose, arbitrary fields, credential values or unbounded lists", () => {
  const canary = "PRIVATE_PROVIDER_OR_CREDENTIAL_CANARY";
  const error = new ProviderHTTPError("anthropic", 401, { error: { message: canary }, request_id: canary });
  const unavailable = new VisionProviderUnavailable([{ ...error.diagnostic, credential_kind: "oauth", body: canary } as any]);
  equal(JSON.stringify(unavailable).includes(canary), false);
  equal(unavailable.message.includes(canary), false);
  equal(safeProviderDiagnostics([{ code: canary, provider: "anthropic" }]), []);
  equal(safeProviderDiagnostics([{ code: "request_failed", provider: canary, http_status: 200, credential_kind: canary, apiKey: canary }]),
    [{ code: "request_failed", provider: null, http_status: null, credential_kind: null }]);
  equal(safeProviderDiagnostics(Array(20).fill(error.diagnostic)).length, 3);
});
Deno.test("a complete all-provider certificate permits only proven no-reading outcomes, never mixed or truncated failures", () => {
  const failure = (provider: "google" | "anthropic" | "openai", code: ProviderDiagnostic["code"] = "credential_not_accepted", status: number | null = 401): ProviderDiagnostic =>
    ({ provider, code, http_status: status, credential_kind: null });
  const all = [failure("google"), failure("anthropic"), failure("openai")];
  equal(new VisionProviderUnavailable(all).coverage.no_reading_started, true);
  const lookup = [failure("google", "credential_lookup_failed", null), failure("anthropic"), failure("openai", "no_connected_key", null)];
  equal(new VisionProviderUnavailable(lookup).coverage.no_reading_started, true);
  for (const code of ["response_unreadable", "request_failed", "provider_transient", "rate_or_quota_limit"] as const) {
    const mixed = new VisionProviderUnavailable([all[0], all[1], failure("openai", code, code === "provider_transient" ? 503 : null)]);
    equal(mixed.coverage.complete, true); equal(mixed.coverage.no_reading_started, false);
  }
  for (const incomplete of [all.slice(0, 1), [all[0], all[1], all[1]], [...all, all[2]],
    [all[0], all[1], failure("openai", "credential_lookup_failed", 200)]]) {
    const error = new VisionProviderUnavailable(incomplete);
    equal(error.coverage.complete, false); equal(error.coverage.no_reading_started, false);
  }
});
