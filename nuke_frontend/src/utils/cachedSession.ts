/**
 * Reads the Supabase session synchronously from localStorage.
 *
 * Supabase v2 persists the session under `sb-{projectRef}-auth-token`.
 * Reading it synchronously lets components initialize auth state on the first
 * render without waiting for the async `getSession()` round-trip, eliminating
 * loading spinners for returning users.
 *
 * The async `getSession()` should still be called in the background to validate
 * and refresh the token — this is only for initializing UI state.
 */
export function readCachedSession(): any | null {
  try {
    const url = (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined ?? '';
    const projectRef = url.match(/\/\/([^.]+)\./)?.[1];
    if (!projectRef) return null;
    const raw = localStorage.getItem(`sb-${projectRef}-auth-token`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.access_token || !parsed?.user) return null;
    // Reject already-expired tokens so we don't flash stale user state
    if (parsed.expires_at && Date.now() / 1000 > parsed.expires_at) return null;
    return parsed;
  } catch {
    return null;
  }
}
