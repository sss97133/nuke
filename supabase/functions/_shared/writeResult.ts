// supabase-js resolves a failed write as { error } instead of throwing. A write whose result is dropped
// fails silently: the function returns 200 and the table stays empty (extract-mecum auction_events,
// extract-barn-finds-listing vehicle_events, 2026-10-15). Wrap the awaited write in one of these.
// scripts/guardrails/no-swallowed-write-errors.mjs flags a write whose result is neither read nor wrapped.

type WriteResult = { error?: { message?: string; code?: string; details?: string } | null };

/** Throw when the write failed. Use where a failed write means the run failed (it reaches the caller as non-2xx or a counted failure). */
export function mustWrite<T extends WriteResult>(label: string, result: T): T {
  if (result?.error) {
    const e = result.error;
    throw new Error(`${label} failed: ${e.message ?? String(e)}${e.code ? ` (${e.code})` : ''}`);
  }
  return result;
}

/** Record a failed write without stopping the run: returns the error text, or null on success. Push it into the run's errors array. */
export function softWrite(label: string, result: WriteResult, errors?: string[]): string | null {
  if (!result?.error) return null;
  const msg = `${label} failed: ${result.error.message ?? String(result.error)}${result.error.code ? ` (${result.error.code})` : ''}`;
  console.error(msg);
  errors?.push(msg);
  return msg;
}
