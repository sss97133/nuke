import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueries, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { bounded, readYearState, type YearState } from '../../services/accountingCloseout';

/** The reads of the accounting office, over the app's query client: one cached answer per book and read, a bounded and cancellable request, one retry, and a
 *  re-read when the book itself changes. Nothing is kept after the page that asked for it is gone (gcTime 0): the answers hold the owner's amounts. */

/** A landing touches many documents; the book's change is read once, after it has held still this long. */
export const SETTLE_MS = 1500;
/** The slow reads (seconds each) are not repeated more often than this because the book changed, however often it does. */
export const HEAVY_GAP_MS = 60_000;
/** A cheap read answered less than this long ago is not asked again when its view comes back on screen. */
export const FRESH_MS = 30_000;
export const RETRY_DELAY_MS = 1500;

export type RevisionRead<T> = {
  /** idle: not asked for yet (the view is hidden or there is no book). loading: no answer yet. ready: data is the last answer. error: the read failed twice and there is nothing to show. */
  phase: 'idle' | 'loading' | 'ready' | 'error';
  data: T | null;
  /** When the data on screen was read (the browser's clock, milliseconds), or null. */
  readAt: number | null;
  /** A refresh failed after an answer was already on screen: the data shown is the last one read. */
  refreshFailed: boolean;
  /** Read again now, whatever was read before; a read still in flight is cancelled and replaced. Does nothing while the read is not asked for. */
  retry: () => void;
};

/** How many times the book has changed since this reader mounted, counted once the change has held still for `settleMs` and no sooner than `minGapMs`
 *  after the previous count. The first revision known is the book the first read already saw, so it counts nothing. Another book (`scope`) starts at zero. */
export function useRevisionEpoch(revision: string | undefined, scope: string | undefined, settleMs: number = SETTLE_MS, minGapMs = 0): number {
  const [counted, setCounted] = useState<{ scope: string | undefined; epoch: number }>({ scope, epoch: 0 });
  const seen = useRef<{ scope: string | undefined; revision: string } | null>(null);
  const lastAt = useRef(0);
  useEffect(() => {
    if (!revision) return;
    if (!seen.current || seen.current.scope !== scope) { seen.current = { scope, revision }; lastAt.current = 0; return; }
    if (seen.current.revision === revision) return;
    const wait = Math.max(settleMs, lastAt.current + minGapMs - Date.now());
    const timer = window.setTimeout(() => {
      seen.current = { scope, revision }; lastAt.current = Date.now();
      setCounted(current => ({ scope, epoch: current.scope === scope ? current.epoch + 1 : 1 }));
    }, wait);
    return () => window.clearTimeout(timer);
  }, [revision, scope, settleMs, minGapMs]);
  return counted.scope === scope ? counted.epoch : 0;
}

/** True from `ms` after `on` first became true for this scope, and for good after that: a stagger that does not start over when a view is hidden and shown. */
function useAfter(on: boolean, ms: number, scope: string | undefined): boolean {
  const [done, setDone] = useState<{ scope: string | undefined } | null>(null);
  useEffect(() => {
    if (!on || done?.scope === scope) return;
    if (ms <= 0) { setDone({ scope }); return; }
    const timer = window.setTimeout(() => setDone({ scope }), ms);
    return () => window.clearTimeout(timer);
  }, [on, ms, scope, done]);
  return ms <= 0 ? on : done?.scope === scope;
}

/** The book changed: the reads under `key` are asked again (the ones on screen now, the others when they next are). `replace` cancels a read still in flight
 *  and starts a new one; without it a read in flight is left to finish, so two readers of one answer never restart each other. */
function useReadAgainOnChange(key: QueryKey, epoch: number, replace: boolean) {
  const client = useQueryClient();
  const keyText = JSON.stringify(key);
  useEffect(() => {
    if (epoch > 0) void client.invalidateQueries({ queryKey: JSON.parse(keyText) as QueryKey }, { cancelRefetch: replace });
  }, [client, keyText, epoch, replace]);
}

const QUERY = { gcTime: 0, retry: 1, retryDelay: RETRY_DELAY_MS, refetchOnWindowFocus: false, refetchOnReconnect: false } as const;

/** One read of the books, started only when asked for, after its place in the queue (`startAfterMs`), retried once, cancelled when something newer replaces
 *  it, stopped after the bound, and read again when the book changes. A failure is a state, never an empty answer. A view that comes back on screen keeps its
 *  answer: it is read again only if the book changed, or (when `staleMs` is finite) the answer is older than that. Another book never shows this book's answer. */
export function useRevisionRead<T>(name: string, read: (signal: AbortSignal) => Promise<T>,
  opts: { scope: string | undefined; enabled: boolean; revision?: string; startAfterMs?: number; settleMs?: number; minGapMs?: number; staleMs?: number }): RevisionRead<T> {
  const { scope, enabled, revision, startAfterMs = 0, settleMs, minGapMs = 0, staleMs = Infinity } = opts;
  const readRef = useRef(read);
  readRef.current = read;
  const asked = !!scope && enabled;
  const due = useAfter(asked, startAfterMs, scope);
  const epoch = useRevisionEpoch(revision, scope, settleMs, minGapMs);
  const queryKey = useMemo(() => ['books', name, scope] as const, [name, scope]);
  const query = useQuery({
    ...QUERY, queryKey, queryFn: ({ signal }) => bounded(inner => readRef.current(inner), signal), enabled: asked && due, staleTime: staleMs,
  });
  useReadAgainOnChange(queryKey, epoch, true);
  const { refetch } = query;
  const retry = useCallback(() => { if (asked && due) void refetch(); }, [asked, due, refetch]);
  const has = query.data !== undefined;
  const phase: RevisionRead<T>['phase'] = has ? 'ready' : query.isError ? 'error' : asked ? 'loading' : 'idle';
  return { phase, data: has ? (query.data as T) : null, readAt: has ? query.dataUpdatedAt : null, refreshFailed: has && query.isRefetchError, retry };
}

/** One keyed read per tax year, in parallel, each shared by every component that asks for the same book, year and read: the docket and Finish your taxes read a
 *  year's state once. Each year is either read, failed, or not answered yet (absent from both). */
export function useYearReads<T>(name: string, scope: string | undefined, years: string[], read: (year: string, signal: AbortSignal) => Promise<T>,
  opts: { enabled: boolean; revision?: string; minGapMs?: number }): { data: Record<string, T>; status: Record<string, 'ready' | 'error'> } {
  const { enabled, revision, minGapMs = 0 } = opts;
  const readRef = useRef(read);
  readRef.current = read;
  const epoch = useRevisionEpoch(revision, scope, SETTLE_MS, minGapMs);
  const results = useQueries({
    queries: years.map(year => ({
      ...QUERY, queryKey: ['books', name, scope, year] as const, queryFn: ({ signal }: { signal: AbortSignal }) => bounded(inner => readRef.current(year, inner), signal),
      enabled: !!scope && enabled, staleTime: Infinity,
    })),
  });
  useReadAgainOnChange(['books', name, scope], epoch, false);
  const data: Record<string, T> = {}, status: Record<string, 'ready' | 'error'> = {};
  years.forEach((year, i) => {
    const result = results[i];
    if (result?.data !== undefined) { data[year] = result.data as T; status[year] = 'ready'; } else if (result?.isError) status[year] = 'error';
  });
  return { data, status };
}

/** books_year_state per tax year: the settled return facts, the filing state and the open items. Read once per book and year for the whole page. */
export function useYearStates(ownerId: string | undefined, years: string[], opts: { enabled: boolean; revision?: string }) {
  return useYearReads<YearState>('year-state', ownerId, years, (year, signal) => readYearState(ownerId!, year, signal), opts);
}
