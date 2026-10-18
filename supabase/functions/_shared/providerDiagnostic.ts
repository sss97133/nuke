/** Allowlisted diagnostics only. Never carry a secret, provider prose, request URL,
 * model name, header, token fragment or decrypted bundle through this boundary. */
export type DiagnosticProvider = "google" | "anthropic" | "openai";
export type CredentialKind = "api_key" | "oauth" | "unrecognized";
export type ProviderDiagnosticCode = "no_connected_key" | "credential_lookup_failed" |
  "credential_not_accepted" | "permission_denied" | "billing_or_usage_limit" |
  "rate_or_quota_limit" | "provider_transient" | "request_refused" |
  "request_failed" | "response_unreadable" | "service_guard_held";
export interface ProviderDiagnostic {
  code: ProviderDiagnosticCode;
  provider: DiagnosticProvider | null;
  http_status: number | null;
  credential_kind: CredentialKind | null;
}
export interface ProviderAttemptCoverage {
  method: "byok_vision_attempts_v1";
  expected_providers: number;
  assessed_providers: number;
  outcomes_observed: number;
  complete: boolean;
  no_reading_started: boolean;
}
export interface AnthropicTokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
}

/** Provider-reported counters, not an invoice or a zero-cost claim when absent. */
export function safeAnthropicUsage(value: unknown): AnthropicTokenUsage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const count = (key: string) => Number.isSafeInteger(raw[key]) && (raw[key] as number) >= 0 && (raw[key] as number) <= 1_000_000_000
    ? raw[key] as number : null;
  const input_tokens = count("input_tokens"), output_tokens = count("output_tokens");
  if (input_tokens === null || output_tokens === null) return null;
  return { input_tokens, output_tokens, cache_creation_input_tokens: count("cache_creation_input_tokens"),
    cache_read_input_tokens: count("cache_read_input_tokens") };
}

const codes = new Set<unknown>(["no_connected_key", "credential_lookup_failed", "credential_not_accepted",
  "permission_denied", "billing_or_usage_limit", "rate_or_quota_limit", "provider_transient",
  "request_refused", "request_failed", "response_unreadable", "service_guard_held"]);
const providers = new Set<unknown>(["google", "anthropic", "openai"]);
const kinds = new Set<unknown>(["api_key", "oauth", "unrecognized"]);

/** The decrypted value already exists in getUserApiKey. Inspect its kind in memory,
 * without returning bundle fields or changing how the existing caller routes it. */
export function credentialKind(value: string, provider: string): CredentialKind {
  const key = value.trim();
  if (provider === "anthropic" && key.startsWith("sk-ant-oat")) return "oauth";
  if (key.startsWith("{")) {
    try {
      const bundle = JSON.parse(key);
      if (bundle && typeof bundle === "object" &&
        ("access_token" in bundle || "refresh_token" in bundle || "accessToken" in bundle)) return "oauth";
    } catch { /* An unrecognized value is not evidence of an invalid or revoked key. */ }
    return "unrecognized";
  }
  if (provider === "anthropic" && key.startsWith("sk-ant-api") ||
    provider === "openai" && key.startsWith("sk-") || provider === "google" && key.startsWith("AIza")) return "api_key";
  return "unrecognized";
}

export function safeProviderDiagnostics(value: unknown): ProviderDiagnostic[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 3).flatMap(item => {
    if (!item || typeof item !== "object" || !codes.has(item.code)) return [];
    return [{ code: item.code as ProviderDiagnosticCode,
      provider: providers.has(item.provider) ? item.provider as DiagnosticProvider : null,
      http_status: Number.isInteger(item.http_status) && item.http_status >= 400 && item.http_status <= 599 ? item.http_status : null,
      credential_kind: kinds.has(item.credential_kind) ? item.credential_kind as CredentialKind : null }];
  });
}

/** HTTP evidence, not a conclusion that a stored key was revoked/expired. The billing
 * codes are the provider's own structured codes; a generic429 remains rate-or-quota.
 * References: platform.claude.com/docs/en/api/errors; developers.openai.com/api/docs/guides/error-codes;
 * ai.google.dev/gemini-api/docs/troubleshooting. Unknown prose is never classified. */
export class ProviderHTTPError extends Error {
  readonly diagnostic: ProviderDiagnostic;
  constructor(provider: DiagnosticProvider, status: number, body: unknown, guarded = false) {
    let code: ProviderDiagnosticCode = "request_refused";
    const error = body && typeof body === "object" ? (body as Record<string, any>).error : null;
    const billingCodes = ["credit_balance_exhausted", "organization_spend_limit_exceeded", "project_spend_limit_exceeded",
      "organization_usage_limit_exceeded", "insufficient_quota"];
    if (guarded) code = "service_guard_held";
    else if (status === 401) code = "credential_not_accepted";
    else if (status === 403) code = "permission_denied";
    else if (status === 402 || provider === "openai" && billingCodes.includes(error?.code)) code = "billing_or_usage_limit";
    else if (status === 429) code = "rate_or_quota_limit";
    else if (status === 408 || status >= 500) code = "provider_transient";
    const name = provider === "anthropic" ? "Anthropic" : provider === "openai" ? "OpenAI" : "Google";
    super(`${name} API error: ${status} - ${code}`);
    this.name = "ProviderHTTPError";
    this.diagnostic = { code, provider, http_status: status, credential_kind: null };
  }
}

export class VisionProviderUnavailable extends Error {
  readonly diagnostics: ProviderDiagnostic[];
  readonly coverage: ProviderAttemptCoverage;
  constructor(diagnostics: ProviderDiagnostic[]) {
    super("vision_provider_unavailable");
    this.name = "VisionProviderUnavailable";
    this.diagnostics = safeProviderDiagnostics(diagnostics);
    const observed = Array.isArray(diagnostics) ? diagnostics.length : 0;
    const assessed = new Set(this.diagnostics.map(d => d.provider).filter(provider => providers.has(provider)));
    // Check the original list before truncation. Every existing provider selection
    // must have one terminal outcome; no first-error or partial-list certificate.
    const complete = observed === 3 && this.diagnostics.length === observed && assessed.size === 3 &&
      diagnostics.every((original, i) => original.http_status === this.diagnostics[i].http_status);
    const noReading = complete && this.diagnostics.every(d =>
      ["no_connected_key", "credential_lookup_failed"].includes(d.code) && d.http_status === null ||
      d.code === "credential_not_accepted" && d.http_status === 401);
    this.coverage = { method: "byok_vision_attempts_v1", expected_providers: 3,
      assessed_providers: assessed.size, outcomes_observed: observed, complete, no_reading_started: noReading };
  }
}
