// Starts a job page's first read while its code is still downloading, so the data and the chunk arrive together.
// The router's lazy loader calls warmJobRoute; readJob takes the warmed call once and every later read fetches fresh.
// Imports only the Supabase client, so the router's chunk stays small.
import { supabase } from '../../lib/supabase';

type Warm = { at: number; result: Promise<{ data: unknown; error: { message?: string; code?: string } | null }> };
const warmed = new Map<string, Warm>();
const MAX_AGE_MS = 15000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const keyOf = (rpc: string, args: Record<string, unknown>, viewerId: string | null) => JSON.stringify([viewerId, rpc, args]);

export function warmRead(rpc: string, args: Record<string, unknown>, viewerId: string | null, isCurrent = () => true): Promise<void> {
  const key = keyOf(rpc, args, viewerId);
  if (warmed.has(key)) return Promise.resolve();
  const entry: Warm = { at: Date.now(), result: Promise.resolve(supabase.rpc(rpc, args)).then(r => {
    if (!isCurrent()) {
      if (warmed.get(key) === entry) warmed.delete(key);
      return { data: null, error: { message: 'The viewer changed. Reload the job.' } };
    }
    return { data: r.data, error: r.error };
  }, () => ({ data: null, error: {message: 'The job could not be loaded. Try again.'} })) };
  warmed.set(key, entry);
  return entry.result.then(() => undefined);
}

/** The warmed call for these arguments, used once; null when none was started or it is stale. */
export function takeWarm(rpc: string, args: Record<string, unknown>, viewerId: string | null | undefined): Warm['result'] | null {
  // Callers without a resolved viewer may read fresh, but cannot consume another viewer's warm result.
  if (viewerId === undefined) return null;
  const key = keyOf(rpc, args, viewerId);
  const w = warmed.get(key);
  if (!w) return null;
  warmed.delete(key);
  return Date.now() - w.at <= MAX_AGE_MS ? w.result : null;
}

/** For a direct load of /jobs/:id: start the job path read before JobPage's chunk has arrived. */
export async function warmJobRoute(pathname: string): Promise<void> {
  const m = /^\/jobs\/([^/]+)\/?$/.exec(pathname);
  if (!m || !UUID_RE.test(m[1])) return;
  let sampledViewer: string | null | undefined;
  let observedViewer: string | null | undefined;
  let changed = false;
  // The RPC obtains its token asynchronously. A session change between sampling
  // the viewer and completing the request must never populate the earlier key.
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    const next = session?.user.id ?? null;
    if ((observedViewer !== undefined && observedViewer !== next) || (sampledViewer !== undefined && sampledViewer !== next)) changed = true;
    observedViewer = next;
  });
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) return;
    sampledViewer = data.session?.user.id ?? null;
    if (changed || (observedViewer !== undefined && observedViewer !== sampledViewer)) return;
    await warmRead('work_order_job_path_read', { p_work_order_id: m[1] }, sampledViewer, () => !changed);
  } catch { /* A failed warm-up leaves the page's normal reader available. */ }
  finally { subscription.unsubscribe(); }
}
