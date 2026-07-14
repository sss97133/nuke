/**
 * track — first-party funnel analytics into our own DB (app_events table).
 *
 * No third-party analytics: events are batched and inserted via the anon
 * REST endpoint (RLS insert-only). Used to answer the launch questions —
 * queries per visitor, search → vehicle conversion, day-2 return — straight
 * from SQL. See docs/LAUNCH_DAY_ONE.md for the queries.
 *
 * Usage: track('search_results', { q, total })
 * Auto-attached: session_key, user_id (when signed in), path, referrer.
 */
import { supabase } from './supabase';

interface AppEvent {
  event: string;
  props: Record<string, unknown>;
  session_key: string;
  user_id: string | null;
  path: string;
  referrer: string | null;
  created_at: string;
}

const SESSION_KEY_STORAGE = 'nuke_session_key';
const FLUSH_INTERVAL_MS = 10_000;
const FLUSH_BATCH_SIZE = 20;
const MAX_ERRORS_PER_SESSION = 10;

let buffer: AppEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let cachedUserId: string | null = null;
let referrerSent = false;
let errorCount = 0;
let initialized = false;

function sessionKey(): string {
  try {
    let key = localStorage.getItem(SESSION_KEY_STORAGE);
    if (!key) {
      key = crypto.randomUUID();
      localStorage.setItem(SESSION_KEY_STORAGE, key);
    }
    return key;
  } catch {
    return 'no-storage';
  }
}

function restUrl(): string | null {
  const base = (import.meta as any).env?.VITE_SUPABASE_URL;
  const anon = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY;
  if (!base || !anon) return null;
  // apikey as query param so navigator.sendBeacon (no headers) works on pagehide
  return `${base}/rest/v1/app_events?apikey=${encodeURIComponent(anon)}`;
}

async function flush(useBeacon = false): Promise<void> {
  if (buffer.length === 0) return;
  const batch = buffer;
  buffer = [];

  try {
    if (useBeacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const url = restUrl();
      if (url) {
        navigator.sendBeacon(url, new Blob([JSON.stringify(batch)], { type: 'application/json' }));
        return;
      }
    }
    await supabase.from('app_events').insert(batch);
  } catch {
    // Analytics must never break the app. Drop the batch.
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_INTERVAL_MS);
}

function init() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  // Cache auth state for user_id attribution (async, best-effort)
  supabase.auth.getSession().then(({ data }: any) => {
    cachedUserId = data?.session?.user?.id || null;
  }).catch(() => {});
  supabase.auth.onAuthStateChange((_event: string, s: any) => {
    cachedUserId = s?.user?.id || null;
  });

  // Flush on tab close / background — the moment most analytics get lost
  window.addEventListener('pagehide', () => void flush(true));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush(true);
  });

  // Client errors are funnel killers — capture a bounded sample
  window.addEventListener('error', (e) => {
    if (errorCount >= MAX_ERRORS_PER_SESSION) return;
    errorCount++;
    track('client_error', { message: String(e.message || '').slice(0, 300), source: String(e.filename || '').slice(0, 200) });
  });
  window.addEventListener('unhandledrejection', (e) => {
    if (errorCount >= MAX_ERRORS_PER_SESSION) return;
    errorCount++;
    track('client_error', { message: String((e as PromiseRejectionEvent).reason?.message || (e as PromiseRejectionEvent).reason || '').slice(0, 300), kind: 'unhandledrejection' });
  });
}

export function track(event: string, props: Record<string, unknown> = {}): void {
  try {
    init();
    buffer.push({
      event,
      props,
      session_key: sessionKey(),
      user_id: cachedUserId,
      path: typeof location !== 'undefined' ? location.pathname.slice(0, 512) : '',
      // Referrer only matters on the first event of a load (the channel attribution)
      referrer: !referrerSent && typeof document !== 'undefined' && document.referrer ? document.referrer.slice(0, 512) : null,
      created_at: new Date().toISOString(),
    });
    referrerSent = true;
    if (buffer.length >= FLUSH_BATCH_SIZE) void flush();
    else scheduleFlush();
  } catch {
    // Never throw from analytics
  }
}
