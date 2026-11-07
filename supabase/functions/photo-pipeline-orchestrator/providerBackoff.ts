/**
 * Provider-aware recovery for the model classifier.
 *
 * A 429/402 or a spend-guard refusal says the PROVIDER cannot take work now. It says nothing about the
 * photo. So it is never a per-image failure and never feeds a breaker that stops programmatic stages:
 * the image goes back to the queue with a retry time, and only model calls slow down.
 * Pure functions here; the orchestrator does the I/O.
 */
import type { ClassifierReceipt } from "./classifier.ts";

export const RATE_LIMIT_CLASSES = ["classifier_rate_limited", "provider_cooldown", "classifier_usage_budget_exceeded"] as const;
const BASE_SECONDS = 60;          // first backoff step when the provider names no delay
const CAP_SECONDS = 6 * 3600;     // never park the queue longer than this on a guess
export const MAX_CONCURRENCY = 8;

export function isRateLimited(detail?: Pick<ClassifierReceipt, "error_class" | "http_status"> | null): boolean {
  if (!detail) return false;
  return (RATE_LIMIT_CLASSES as readonly string[]).includes(detail.error_class ?? "") || detail.http_status === 429 || detail.http_status === 402;
}

/**
 * Seconds to wait before the next model call. The provider's own Retry-After is a floor (we never retry
 * sooner than asked); otherwise exponential in the number of consecutive rate limits. Full jitter on the
 * upper 40% of the window spreads retries so a recovering provider is not met by a thundering herd.
 * `random` is injectable for tests (0..1).
 */
export function backoffSeconds(consecutive: number, retryAfter: number | null | undefined, random: () => number = Math.random): number {
  const n = Math.max(1, Math.floor(consecutive));
  const exp = Math.min(CAP_SECONDS, BASE_SECONDS * 2 ** Math.min(n - 1, 10));
  const jittered = exp * (0.6 + 0.4 * random());
  const floor = retryAfter && retryAfter > 0 ? Math.min(retryAfter, CAP_SECONDS) : 0;
  // jitter on top of the floor too, so many callers given the same Retry-After do not return together
  return Math.min(CAP_SECONDS, Math.max(jittered, floor * (1 + 0.25 * random())));
}

/** AIMD: halve on a rate limit (min 1), add one per success (max MAX_CONCURRENCY). */
export function nextConcurrency(current: number, event: "rate_limited" | "success"): number {
  const c = Math.min(Math.max(1, Math.floor(current)), MAX_CONCURRENCY);
  return event === "rate_limited" ? Math.max(1, Math.floor(c / 2)) : Math.min(MAX_CONCURRENCY, c + 1);
}

export interface ProviderGate { blocked: boolean; blocked_until: string | null; max_concurrency: number }

/** Reads the classifier provider state. Unknown (table missing/unreadable) = not blocked: never stop work on a guess. */
export async function readProviderGate(db: { from: (t: string) => any }, now = Date.now()): Promise<ProviderGate> {
  try {
    const { data, error } = await db.from("photo_pipeline_provider_state").select("blocked_until, max_concurrency").eq("provider", "classifier").maybeSingle();
    if (error || !data) return { blocked: false, blocked_until: null, max_concurrency: MAX_CONCURRENCY };
    const until = data.blocked_until ? Date.parse(data.blocked_until) : NaN;
    return { blocked: Number.isFinite(until) && until > now, blocked_until: data.blocked_until ?? null,
      max_concurrency: Number.isFinite(data.max_concurrency) ? Math.min(Math.max(1, data.max_concurrency), MAX_CONCURRENCY) : MAX_CONCURRENCY };
  } catch { return { blocked: false, blocked_until: null, max_concurrency: MAX_CONCURRENCY }; }
}

/**
 * Tell the database the provider rate-limited this image: requeue with a backoff, raise the provider
 * cooldown, reduce concurrency. Best effort and loud: a failure here is logged, the image still goes back to 'pending'.
 */
export async function recordRateLimit(db: { rpc: (fn: string, args: Record<string, unknown>) => any },
  imageId: string, detail: ClassifierReceipt | undefined): Promise<unknown> {
  try {
    const { data, error } = await db.rpc("photo_pipeline_note_failure", {
      p_image_id: imageId, p_error_class: detail?.error_class ?? "classifier_rate_limited",
      p_http_status: detail?.http_status ?? 429, p_fallback_error_class: null,
      p_retry_after_seconds: detail?.retry_after_seconds ?? null,
    });
    if (error) console.warn("[photo-pipeline] rate-limit bookkeeping failed:", error.code ?? "rpc_error");
    return data ?? null;
  } catch { console.warn("[photo-pipeline] rate-limit bookkeeping threw"); return null; }
}

/**
 * A model call succeeded: drop the image's retry row (and its claim lease), close the breaker and raise concurrency
 * one step. Without a caller the AIMD never climbs back after the first 429 and the throttle sticks at 1.
 * Best effort and loud: the photo is already completed.
 */
export async function clearRetry(db: { rpc: (fn: string, args: Record<string, unknown>) => any }, imageId: string): Promise<void> {
  try {
    const { error } = await db.rpc("photo_pipeline_clear_retry", { p_image_id: imageId });
    if (error) console.warn("[photo-pipeline] clear_retry failed:", error.code ?? "rpc_error");
  } catch { console.warn("[photo-pipeline] clear_retry threw"); }
}
