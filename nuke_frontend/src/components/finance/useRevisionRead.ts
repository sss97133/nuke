import { useCallback, useEffect, useRef, useState } from 'react';
import { withOneRetry } from '../../services/accountingCloseout';

export type RevisionRead<T> = {
  /** idle: not asked for yet (the view is hidden or there is no book). loading: no answer yet. ready: data is the last answer. error: the read failed twice and there is nothing to show. */
  phase: 'idle' | 'loading' | 'ready' | 'error';
  data: T | null;
  /** When the data on screen was read (the browser's clock, milliseconds), or null. */
  readAt: number | null;
  /** A refresh failed after an answer was already on screen: the data shown is the last one read. */
  refreshFailed: boolean;
  retry: () => void;
};

/** One read of the books, started only when asked for, retried once, and read again when the book changes (its revision, settled for a moment so
 *  a landing that touches many documents is one read, not many). A failure is a state, never an empty answer. The first known revision does not
 *  trigger a second read: the read that started at mount already saw that book. A change of `scope` (another book) drops the old answer. */
export function useRevisionRead<T>(read: () => Promise<T>, opts: { scope: string | undefined; enabled: boolean; revision?: string; startAfterMs?: number; settleMs?: number }): RevisionRead<T> {
  const { scope, enabled, revision, startAfterMs = 0, settleMs = 1500 } = opts;
  const readRef = useRef(read);
  readRef.current = read;
  const [state, setState] = useState<{ scope: string | undefined; phase: RevisionRead<T>['phase']; data: T | null; readAt: number | null; refreshFailed: boolean }>({ scope, phase: 'idle', data: null, readAt: null, refreshFailed: false });
  const [tick, setTick] = useState(0);
  const seen = useRef<string | null>(null);
  useEffect(() => { seen.current = null; }, [scope]);
  useEffect(() => {
    if (!revision) return;
    if (seen.current === null) { seen.current = revision; return; }
    if (seen.current === revision) return;
    seen.current = revision;
    const timer = window.setTimeout(() => setTick(n => n + 1), settleMs);
    return () => window.clearTimeout(timer);
  }, [revision, settleMs]);
  useEffect(() => {
    if (!enabled || !scope) return;
    let cancelled = false;
    setState(previous => previous.scope === scope ? { ...previous, phase: previous.data ? 'ready' : 'loading', refreshFailed: false } : { scope, phase: 'loading', data: null, readAt: null, refreshFailed: false });
    const start = () => {
      withOneRetry(() => readRef.current())
        .then(data => { if (!cancelled) setState({ scope, phase: 'ready', data, readAt: Date.now(), refreshFailed: false }); })
        .catch(() => { if (!cancelled) setState(previous => previous.scope === scope && previous.data ? { ...previous, refreshFailed: true } : { scope, phase: 'error', data: null, readAt: null, refreshFailed: false }); });
    };
    const timer = startAfterMs > 0 ? window.setTimeout(start, startAfterMs) : (start(), 0);
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [scope, enabled, tick, startAfterMs]);
  const retry = useCallback(() => setTick(n => n + 1), []);
  // A render before the effect has caught up with a new book never shows the old book's answer.
  if (state.scope !== scope) return { phase: enabled && scope ? 'loading' : 'idle', data: null, readAt: null, refreshFailed: false, retry };
  return { phase: state.phase, data: state.data, readAt: state.readAt, refreshFailed: state.refreshFailed, retry };
}
