// Starts a job page's first read while its code is still downloading, so the data and the chunk arrive together.
// The router's lazy loader calls warmJobRoute; readJob takes the warmed call once and every later read fetches fresh.
// Imports only the Supabase client, so the router's chunk stays small.
import { supabase } from '../../lib/supabase';

type Warm = { at: number; result: Promise<{ data: unknown; error: { message?: string; code?: string } | null }> };
const warmed = new Map<string, Warm>();
const MAX_AGE_MS = 15000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const keyOf = (rpc: string, args: Record<string, unknown>) => `${rpc}:${JSON.stringify(args)}`;

export function warmRead(rpc: string, args: Record<string, unknown>): void {
  const key = keyOf(rpc, args);
  if (warmed.has(key)) return;
  warmed.set(key, { at: Date.now(), result: Promise.resolve(supabase.rpc(rpc, args)).then(r => ({ data: r.data, error: r.error })) });
}

/** The warmed call for these arguments, used once; null when none was started or it is stale. */
export function takeWarm(rpc: string, args: Record<string, unknown>): Warm['result'] | null {
  const key = keyOf(rpc, args);
  const w = warmed.get(key);
  if (!w) return null;
  warmed.delete(key);
  return Date.now() - w.at <= MAX_AGE_MS ? w.result : null;
}

/** For a direct load of /jobs/:id: start the job path read before JobPage's chunk has arrived. */
export function warmJobRoute(pathname: string): void {
  const m = /^\/jobs\/([^/]+)\/?$/.exec(pathname);
  if (m && UUID_RE.test(m[1])) warmRead('work_order_job_path_read', { p_work_order_id: m[1] });
}
