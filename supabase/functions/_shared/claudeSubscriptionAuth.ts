/**
 * Claude SUBSCRIPTION auth — Nuke as an OAuth *client* to Anthropic.
 *
 * This is the inverse of `oauth-server` (where Nuke is the provider and Claude.ai
 * connects INTO Nuke). Here, a Nuke user connects THEIR Claude Max/Pro subscription
 * so Nuke can run their analysis on their own plan, with API as the pressure-release.
 *
 * The funnel, per-job, lives in `resolveClaudeAuth()` + `runWithChain()`:
 *
 *   SUBSCRIPTION token  → run (free for them, $0 to us)
 *        │ 429 / rate-limited
 *        ├─ mode="slow"     → caller backs off + retries on the subscription
 *        └─ mode="upgrade"  → fall through to API:
 *                               ├─ user's own API key  (BYOK — their bill)
 *                               └─ platform key        (we meter + bill them)
 *
 * STORAGE: the subscription token bundle is stored as JSON in
 * `user_ai_providers.api_key_encrypted` under `provider = 'anthropic_subscription'`.
 * No schema change — `api_key_encrypted` is already a free-text blob and `provider`
 * is unconstrained text. The bundle shape is `StoredSubscriptionToken` below.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * ⚠️  UNSANCTIONED CLIENT — READ BEFORE PRODUCTION.
 * There is no Anthropic-published third-party OAuth client for consumer
 * subscriptions. The only working client_id is Claude Code's own first-party id.
 * The constants in ANTHROPIC_OAUTH below are the publicly-observed Claude Code
 * values; Anthropic can rotate them or tighten the flow at any time, which would
 * break this button with zero notice. Consumer Max/Pro terms also scope usage to
 * personal use through Claude's own surfaces. This module is built for the
 * defensible BYOK case (each user drives THEIR OWN subscription on THEIR OWN data);
 * verify the constants against a live `claude setup-token` run before shipping.
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * @owner external-agent-write-api
 */

import {
  holdCredits, settleHold, releaseHold, estimateCents, usageToCents, type ClaudeUsage,
} from "./aiCredits.ts";
import { encryptSecret, decryptSecret } from "./secretBox.ts";

const SUBSCRIPTION_PROVIDER = "anthropic_subscription";

// ── Anthropic OAuth-client constants (UNSANCTIONED — verify before prod) ───────
// These mirror what `claude setup-token` uses. Treat as config, not gospel.
const ANTHROPIC_OAUTH = {
  CLIENT_ID: Deno.env.get("CLAUDE_OAUTH_CLIENT_ID") ?? "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
  AUTHORIZE_URL: "https://claude.ai/oauth/authorize",
  TOKEN_URL: "https://console.anthropic.com/v1/oauth/token",
  // Manual copy-paste callback (what setup-token uses). For a hosted button, swap
  // to your own registered redirect once a sanctioned client exists.
  REDIRECT_URI: Deno.env.get("CLAUDE_OAUTH_REDIRECT_URI") ?? "https://console.anthropic.com/oauth/code/callback",
  SCOPES: "org:create_api_key user:profile user:inference",
  // Inference beta header required when calling /v1/messages with an OAuth token.
  ANTHROPIC_BETA: "oauth-2025-04-20",
  ANTHROPIC_VERSION: "2023-06-01",
  MESSAGES_URL: "https://api.anthropic.com/v1/messages",
};

const ACCESS_TOKEN_SKEW_SECONDS = 60; // refresh this many seconds before expiry

// ── Stored bundle shape (lives in api_key_encrypted as JSON) ───────────────────
export interface StoredSubscriptionToken {
  kind: "claude_subscription_oauth";
  access_token: string;
  refresh_token: string;
  expires_at: number; // unix seconds
  scope: string;
  obtained_at: number; // unix seconds
}

export interface ResolvedClaudeAuth {
  source: "subscription" | "user_api_key" | "system_api_key";
  // For subscription: an OAuth bearer used with the oauth beta header.
  // For api_key sources: a normal x-api-key value.
  token: string;
  isOAuth: boolean;
}

// ── PKCE helpers (same primitives as oauth-server) ─────────────────────────────

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function randomVerifier(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return b64url(arr);
}

export async function challengeFromVerifier(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

/**
 * Build the authorize URL the user's browser is sent to. The caller stores
 * `verifier` (server-side, keyed by `state`) to complete the exchange later.
 */
export function buildAuthorizeUrl(state: string, challenge: string): string {
  const u = new URL(ANTHROPIC_OAUTH.AUTHORIZE_URL);
  u.searchParams.set("code", "true");
  u.searchParams.set("client_id", ANTHROPIC_OAUTH.CLIENT_ID);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", ANTHROPIC_OAUTH.REDIRECT_URI);
  u.searchParams.set("scope", ANTHROPIC_OAUTH.SCOPES);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("state", state);
  return u.toString();
}

// ── Token exchange + refresh ───────────────────────────────────────────────────

interface AnthropicTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
  scope?: string;
  token_type?: string;
}

async function postToken(body: Record<string, string>): Promise<AnthropicTokenResponse> {
  const res = await fetch(ANTHROPIC_OAUTH.TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`anthropic token endpoint ${res.status}: ${text.slice(0, 300)}`);
  }
  return await res.json() as AnthropicTokenResponse;
}

/** Exchange an authorization code (+ PKCE verifier) for a token bundle. */
export async function exchangeCode(code: string, verifier: string): Promise<StoredSubscriptionToken> {
  // The manual-paste flow returns `code#state`; split if present.
  const [rawCode] = code.split("#");
  const t = await postToken({
    grant_type: "authorization_code",
    code: rawCode,
    client_id: ANTHROPIC_OAUTH.CLIENT_ID,
    redirect_uri: ANTHROPIC_OAUTH.REDIRECT_URI,
    code_verifier: verifier,
  });
  return bundleFrom(t);
}

/** Mint a fresh access token from a stored refresh token. */
export async function refreshToken(refresh: string): Promise<StoredSubscriptionToken> {
  const t = await postToken({
    grant_type: "refresh_token",
    refresh_token: refresh,
    client_id: ANTHROPIC_OAUTH.CLIENT_ID,
  });
  // Anthropic may or may not rotate the refresh token; keep the new one if given.
  return bundleFrom(t, refresh);
}

function bundleFrom(t: AnthropicTokenResponse, fallbackRefresh?: string): StoredSubscriptionToken {
  const now = Math.floor(Date.now() / 1000);
  return {
    kind: "claude_subscription_oauth",
    access_token: t.access_token,
    refresh_token: t.refresh_token ?? fallbackRefresh ?? "",
    expires_at: now + (t.expires_in ?? 3600),
    scope: t.scope ?? ANTHROPIC_OAUTH.SCOPES,
    obtained_at: now,
  };
}

// ── Storage (reuses user_ai_providers — no new table) ──────────────────────────

export async function storeSubscriptionToken(
  supabase: any,
  userId: string,
  bundle: StoredSubscriptionToken,
): Promise<void> {
  const encoded = await encryptSecret(JSON.stringify(bundle)); // AES-GCM at rest — see secretBox.ts
  // Manual update-or-insert: user_ai_providers has no unique (user_id, provider)
  // constraint, so we can't use onConflict upsert without a schema change.
  const { data: existing } = await supabase
    .from("user_ai_providers")
    .select("id")
    .eq("user_id", userId)
    .eq("provider", SUBSCRIPTION_PROVIDER)
    .maybeSingle();
  const row = {
    user_id: userId,
    provider: SUBSCRIPTION_PROVIDER,
    api_key_encrypted: encoded,
    model_name: "claude-opus-4-8",
    is_active: true,
  };
  const { error } = existing
    ? await supabase.from("user_ai_providers").update(row).eq("id", existing.id)
    : await supabase.from("user_ai_providers").insert(row);
  if (error) throw new Error(`store subscription token: ${error.message}`);
}

async function loadSubscriptionToken(supabase: any, userId: string): Promise<StoredSubscriptionToken | null> {
  const { data } = await supabase
    .from("user_ai_providers")
    .select("api_key_encrypted")
    .eq("user_id", userId)
    .eq("provider", SUBSCRIPTION_PROVIDER)
    .eq("is_active", true)
    .maybeSingle();
  if (!data?.api_key_encrypted) return null;
  try {
    return JSON.parse(await decryptSecret(data.api_key_encrypted)) as StoredSubscriptionToken;
  } catch {
    return null;
  }
}

/** Return a valid (refreshed if needed) subscription access token, or null. */
async function getFreshSubscriptionToken(supabase: any, userId: string): Promise<string | null> {
  const bundle = await loadSubscriptionToken(supabase, userId);
  if (!bundle) return null;
  const now = Math.floor(Date.now() / 1000);
  if (bundle.expires_at - ACCESS_TOKEN_SKEW_SECONDS > now) return bundle.access_token;
  if (!bundle.refresh_token) return null;
  try {
    const fresh = await refreshToken(bundle.refresh_token);
    await storeSubscriptionToken(supabase, userId, fresh);
    return fresh.access_token;
  } catch (e) {
    console.error("[claudeSubscriptionAuth] refresh failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

// ── Resolution + the run chain ─────────────────────────────────────────────────

/**
 * Resolve the best Claude auth for this user, in funnel order.
 * `allowSubscription=false` is how the 429 "upgrade" branch skips straight to API.
 */
export async function resolveClaudeAuth(
  supabase: any,
  userId: string | null,
  opts: { allowSubscription?: boolean } = {},
): Promise<ResolvedClaudeAuth | null> {
  const allowSubscription = opts.allowSubscription ?? true;

  if (userId && allowSubscription) {
    const subToken = await getFreshSubscriptionToken(supabase, userId);
    if (subToken) return { source: "subscription", token: subToken, isOAuth: true };
  }

  // Fall through to the existing BYOK / platform-key chain.
  if (userId) {
    const { data } = await supabase
      .from("user_ai_providers")
      .select("api_key_encrypted")
      .eq("user_id", userId)
      .eq("provider", "anthropic")
      .eq("is_active", true)
      .order("is_default", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.api_key_encrypted) {
      const key = await decryptSecret(data.api_key_encrypted);
      // A Claude OAuth access token (sk-ant-oat...) is a SUBSCRIPTION credential, not an
      // API key. It MUST use the OAuth bearer + beta header (isOAuth), never x-api-key.
      // Route it as a subscription so it runs free on the user's plan. In the 429
      // "upgrade" fork (allowSubscription=false) we deliberately skip it — an OAuth token
      // cannot act as an API key — and fall through to the system key.
      if (key.startsWith("sk-ant-oat")) {
        if (allowSubscription) return { source: "subscription", token: key, isOAuth: true };
      } else {
        return { source: "user_api_key", token: key, isOAuth: false };
      }
    }
  }

  const systemKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (systemKey) return { source: "system_api_key", token: systemKey, isOAuth: false };
  return null;
}

function authHeaders(auth: ResolvedClaudeAuth): HeadersInit {
  const base: Record<string, string> = {
    "content-type": "application/json",
    "anthropic-version": ANTHROPIC_OAUTH.ANTHROPIC_VERSION,
  };
  if (auth.isOAuth) {
    base["authorization"] = `Bearer ${auth.token}`;
    base["anthropic-beta"] = ANTHROPIC_OAUTH.ANTHROPIC_BETA;
  } else {
    base["x-api-key"] = auth.token;
  }
  return base;
}

export interface RunResult {
  ok: boolean;
  status: number;
  source: ResolvedClaudeAuth["source"];
  body: any;
  rateLimited: boolean;
  retryAfterSeconds: number | null;
  // Set when the platform key was used and the user's credit ledger was debited.
  chargedCents?: number;
  // True when an upgrade to the platform key was needed but the user has no funds.
  needsFunding?: boolean;
  // Set when the PLATFORM's own Anthropic account failed billing (e.g. empty balance).
  // The user was NOT charged; this is an operator/service problem — surface as 503.
  serviceError?: string;
}

/**
 * Run one Claude messages call through the funnel.
 *
 *   mode "slow"    → on a subscription 429, return rateLimited so the CALLER can
 *                    back off and retry on the subscription (free, just delayed).
 *   mode "upgrade" → on a subscription 429, immediately re-resolve with
 *                    allowSubscription=false and run on API (user key → system key).
 *
 * `maxWaitSeconds` is the slow-mode ceiling: if the rate-limit reset is further
 * out than this, we force the upgrade branch even in slow mode (the "this'll take
 * 4 hrs on your plan, or run it now on API" nudge).
 */
export async function runWithChain(
  supabase: any,
  userId: string | null,
  payload: Record<string, unknown>,
  opts: { mode?: "slow" | "upgrade"; maxWaitSeconds?: number } = {},
): Promise<RunResult> {
  const mode = opts.mode ?? "slow";
  const maxWait = opts.maxWaitSeconds ?? 300;

  const auth = await resolveClaudeAuth(supabase, userId);
  if (!auth) throw new Error("no claude auth available (no subscription, no user key, no system key)");

  // Platform/system key is the PRIMARY credential (no subscription, no BYOK key): WE pay
  // Anthropic, so this MUST be metered against the user's prepaid wallet — same as the
  // 429-upgrade fork below. (Previously this happy path returned unmetered.)
  if (auth.source === "system_api_key") {
    return await runMeteredPlatform(supabase, userId, auth, payload);
  }

  let res = await fetch(ANTHROPIC_OAUTH.MESSAGES_URL, {
    method: "POST",
    headers: authHeaders(auth),
    body: JSON.stringify(payload),
  });

  // Happy path or a non-rate-limit error on the subscription/BYOK key: return as-is
  // (subscription = free for the user; user_api_key = their own bill — neither metered).
  if (res.status !== 429 || auth.source !== "subscription") {
    return await toRunResult(res, auth.source);
  }

  // Subscription rate-limited → fork.
  const retryAfter = parseRetryAfter(res);
  const mustUpgrade = mode === "upgrade" || (retryAfter !== null && retryAfter > maxWait);

  if (!mustUpgrade) {
    // Slow-down: hand the rate-limit signal back so the caller can queue/backoff.
    return await toRunResult(res, auth.source);
  }

  // Upgrade: re-resolve skipping the subscription, run on API.
  const apiAuth = await resolveClaudeAuth(supabase, userId, { allowSubscription: false });
  if (!apiAuth) return await toRunResult(res, auth.source); // nothing to upgrade to

  // BYOK (user's own API key): their bill — we don't meter or hold credits.
  if (apiAuth.source === "user_api_key") {
    res = await fetch(ANTHROPIC_OAUTH.MESSAGES_URL, {
      method: "POST", headers: authHeaders(apiAuth), body: JSON.stringify(payload),
    });
    return await toRunResult(res, apiAuth.source);
  }

  // Platform key via upgrade: meter it. Pass the rate-limit result so an out-of-funds
  // user still gets the original retry signal.
  const rl = await toRunResult(res, auth.source);
  return await runMeteredPlatform(supabase, userId, apiAuth, payload, rl);
}

/**
 * Run ONE Claude call on the PLATFORM key with full metering: reserve an estimate,
 * call, then settle the actual token cost. Used both when the platform key is the
 * primary credential and via the 429-upgrade fork — so platform usage is NEVER
 * unmetered. The user is charged only for a successful call; a failed call (including
 * the platform's own Anthropic account running dry) releases the hold and charges $0.
 */
async function runMeteredPlatform(
  supabase: any,
  userId: string | null,
  apiAuth: ResolvedClaudeAuth,
  payload: Record<string, unknown>,
  priorRateLimited?: RunResult,
): Promise<RunResult> {
  if (!userId) throw new Error("platform-key call requires a user to bill");
  const model = String((payload as any).model ?? "claude-opus-4-8");
  const maxOut = Number((payload as any).max_tokens ?? 1024);
  const estInput = 2000; // rough; refine with a token-count pass if needed
  const hold = await holdCredits(
    supabase, userId, estimateCents(model, estInput, maxOut),
    "claude-platform", { model, est_input: estInput, max_tokens: maxOut },
  );
  if (!hold) {
    // User's prepaid wallet can't cover it — surface the funding prompt, don't run on our dime.
    const base: RunResult = priorRateLimited ??
      { ok: false, status: 402, source: apiAuth.source, body: null, rateLimited: false, retryAfterSeconds: null };
    return { ...base, needsFunding: true };
  }
  try {
    const res = await fetch(ANTHROPIC_OAUTH.MESSAGES_URL, {
      method: "POST", headers: authHeaders(apiAuth), body: JSON.stringify(payload),
    });
    const result = await toRunResult(res, apiAuth.source);
    const usage: ClaudeUsage = (result.body && result.body.usage) ? result.body.usage : {};
    const cents = result.ok ? usageToCents(model, usage) : 0;
    await settleHold(supabase, userId, hold, cents, { model, usage, status: result.status });
    // The PLATFORM's own Anthropic account failed billing (e.g. empty balance): the user
    // was NOT charged (cents=0, hold released). This is an operator problem, not a user
    // wallet problem — flag it distinctly so the endpoint returns 503, not "add funds".
    if (!result.ok && isBillingError(result)) {
      return { ...result, chargedCents: 0, serviceError: "platform_unfunded" };
    }
    return { ...result, chargedCents: cents };
  } catch (e) {
    await releaseHold(supabase, userId, hold); // never charge for a call that threw
    throw e;
  }
}

/** True when an Anthropic response is a billing/credit-balance failure (HTTP 400). */
function isBillingError(r: RunResult): boolean {
  if (r.status !== 400) return false;
  const msg = JSON.stringify(r.body ?? "").toLowerCase();
  return msg.includes("credit balance") || msg.includes("too low") || msg.includes("billing");
}

function parseRetryAfter(res: Response): number | null {
  const h = res.headers.get("retry-after") ?? res.headers.get("anthropic-ratelimit-unified-reset");
  if (!h) return null;
  const n = Number(h);
  return Number.isFinite(n) ? n : null;
}

async function toRunResult(res: Response, source: ResolvedClaudeAuth["source"]): Promise<RunResult> {
  let body: any = null;
  try { body = await res.json(); } catch { body = await res.text().catch(() => null); }
  return {
    ok: res.ok,
    status: res.status,
    source,
    body,
    rateLimited: res.status === 429,
    retryAfterSeconds: parseRetryAfter(res),
  };
}
