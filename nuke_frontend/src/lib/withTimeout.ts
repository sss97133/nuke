/**
 * withTimeout — race a promise against a deadline.
 *
 * Why: an uncapped Supabase query that hangs on a saturated connection pool holds a
 * pooled connection for ~30s, which worsens saturation for every OTHER query and can
 * leave a UI section spinning forever. Wrapping section loaders with a deadline bounds
 * that blast radius — on timeout the promise rejects and the caller falls back to its
 * empty/partial/error state instead of hanging.
 *
 * The wrapped promise is not cancelled (PostgREST has no client abort here); the timer
 * is cleared on settle so it doesn't leak. The hung request resolves later, ignored.
 */
export async function withTimeout<T>(
  promise: PromiseLike<T>,
  ms: number,
  label = 'operation',
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
