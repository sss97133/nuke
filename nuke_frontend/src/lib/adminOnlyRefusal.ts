// Edge functions that write with full database rights on the ids a caller sends answer only the service key or an
// active admin (requireAdminOrService in supabase/functions/_shared/writeGuard.ts): anyone else gets
// 403 {"error":"forbidden","reason":"admins only"}. A page that calls one shows this sentence, never a spinner or nothing.
// The features come back for owners once each function checks that the caller owns the record it names.
export const ADMIN_ONLY_TEXT =
  'Closed for now: this runs with full database rights on the record you name, so only admins can start it until it checks that the record is yours.';

/** True when a supabase.functions.invoke error (FunctionsHttpError, its Response in .context) or a fetch Response is a 403. */
export function isAdminOnlyRefusal(errorOrResponse: unknown): boolean {
  if (errorOrResponse instanceof Response) return errorOrResponse.status === 403;
  const ctx = (errorOrResponse as { context?: unknown } | null | undefined)?.context;
  return ctx instanceof Response && ctx.status === 403;
}

/** The error to show: the plain refusal for a 403, otherwise the error unchanged. */
export function explainRefusal(error: unknown): unknown {
  return isAdminOnlyRefusal(error) ? new Error(ADMIN_ONLY_TEXT) : error;
}
