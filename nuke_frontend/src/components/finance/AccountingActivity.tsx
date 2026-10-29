import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAccountingBook } from './AccountingBookContext';
import { dollars, pacific, readActivityPasses, type ActivityPass } from '../../services/accountingCloseout';

export type Activity = { document_id: string; source_filename: string | null; run_id: string; actor_user_id: string | null; method: string | null; recorded_at: string; records_changed: number; first_reading: boolean };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** What a revision did, in words: the writer's method names the flow, records_changed says how much moved. */
export function activityWhat(row: Activity): string {
  if (row.first_reading) return row.records_changed ? `added ${plural(row.records_changed, 'record')}` : 'added a source';
  if (row.method === 'authenticated-record-classification') return `classified ${plural(row.records_changed, 'record')}`;
  if (row.method === 'authenticated-expense-use-review') return 'assigned vehicle or shop use';
  const flow = (row.method || '').replace(/[-_]+/g, ' ').trim();
  const change = row.records_changed ? `changed ${plural(row.records_changed, 'record')}` : 'updated evidence';
  return flow ? `${change} · ${flow}` : change;
}
export function ago(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Who ran a pass: a person from the book's grants, or an agent named by its run family. */
export function passWho(pass: ActivityPass, people: Record<string, string>): string {
  const family = `${pass.run_family || ''} ${pass.method || ''}`;
  if (/agent|sdk|reconciliation|import|-books\b/i.test(family)) {
    const name = (pass.run_family || pass.method || 'agent').replace(/[-_]+/g, ' ').replace(/\s*\b20\d{6}\b.*$/, '').trim();
    return `Agent · ${name}`;
  }
  return (pass.actor_user_id && people[pass.actor_user_id]) || 'A reviewer';
}
/** What a pass did, per year, in words. */
export function passWhat(pass: ActivityPass): string {
  const years = Object.entries(pass.years).sort(([a], [b]) => b.localeCompare(a))
    .map(([year, y]) => `${year}: ${y.records.toLocaleString('en-US')} ${y.records === 1 ? 'record' : 'records'}${y.amount ? `, ${dollars(y.amount)} touched` : ''}`);
  return [pass.records_changed ? `${pass.records_changed.toLocaleString('en-US')} ${pass.records_changed === 1 ? 'record' : 'records'} changed` : `${pass.revisions} evidence ${pass.revisions === 1 ? 'update' : 'updates'}`,
    ...years, pass.questions_opened ? `${pass.questions_opened} ${pass.questions_opened === 1 ? 'question' : 'questions'} opened` : null].filter(Boolean).join(' · ');
}

/** One line per pass (agent run or person session), newest first. */
export function ActivityPasses({ people, onOpen }: { people: Record<string, string>; onOpen: (documentId: string) => void }) {
  const { ownerId, liveRevision } = useAccountingBook();
  const [passes, setPasses] = useState<{ ownerId: string; rows: ActivityPass[] | null; failed: boolean } | null>(null);
  useEffect(() => {
    if (!ownerId) return;
    let cancelled = false;
    readActivityPasses(ownerId, 12).then(rows => { if (!cancelled) setPasses({ ownerId, rows, failed: false }); })
      .catch(() => { if (!cancelled) setPasses(previous => ({ ownerId, rows: previous?.ownerId === ownerId ? previous.rows : null, failed: true })); });
    return () => { cancelled = true; };
  }, [ownerId, liveRevision]);
  if (!ownerId || passes?.ownerId !== ownerId) return null;
  if (!passes.rows?.length) return passes.failed ? <p role="status" className="accounting-muted">Passes could not load.</p> : null;
  return <section aria-label="Changes by pass"><h3>Changes by pass</h3>
    <ol className="accounting-activity-passes">{passes.rows.map(pass => <li key={`${pass.actor_user_id}:${pass.run_family}:${pass.method}:${pass.started_at}`}>
      <button type="button" onClick={() => onOpen(pass.latest_document_id)}><strong>{passWho(pass, people)}</strong>
        <span className="accounting-muted">{pacific(pass.started_at)}{pass.ended_at !== pass.started_at ? ` to ${pacific(pass.ended_at)}` : ''}{pass.partial ? ' (earlier part not shown)' : ''}</span>
        <span>{passWhat(pass)}</span></button>
    </li>)}</ol>
  </section>;
}

/** The book's latest attributed revisions, refreshed with the shared ledger. Changes by others since this page opened
 *  are marked New; tapping one opens its source. */
export default function AccountingActivity({ people, onOpen }: { people: Record<string, string>; onOpen: (documentId: string) => void }) {
  const { ownerId, liveRevision } = useAccountingBook();
  const [feed, setFeed] = useState<{ ownerId: string; rows: Activity[] | null; failed: boolean; loading: boolean } | null>(null);
  const [retry, setRetry] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const opened = useRef(Date.now());
  useEffect(() => { opened.current = Date.now(); }, [ownerId]);
  useEffect(() => {
    if (!ownerId) return;
    let cancelled = false;
    setFeed(previous => previous?.ownerId === ownerId
      ? { ...previous, loading: true }
      : { ownerId, rows: null, failed: false, loading: true });
    const fail = () => {
      if (!cancelled) setFeed(previous => ({ ownerId, rows: previous?.ownerId === ownerId ? previous.rows : null, failed: true, loading: false }));
    };
    void Promise.resolve(supabase.rpc('accounting_recent_activity', { p_owner_id: ownerId, p_limit: 20 })).then(({ data, error }) => {
      if (cancelled) return;
      if (error || !Array.isArray(data)) { fail(); return; }
      setFeed({ ownerId, rows: data as Activity[], failed: false, loading: false }); setNow(Date.now());
    }).catch(fail);
    return () => { cancelled = true; };
  }, [ownerId, liveRevision, retry]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30000); return () => window.clearInterval(timer); }, []);
  const who = (row: Activity) => (row.actor_user_id && people[row.actor_user_id]) || 'A reviewer';
  const fresh = (row: Activity) => Date.parse(row.recorded_at) > opened.current && people[row.actor_user_id || ''] !== 'You';
  // A different book must never inherit the previous book's rows or error state.
  if (!ownerId) return null;
  if (feed?.ownerId !== ownerId || (!feed.rows && !feed.failed)) return <p role="status" className="accounting-muted">Loading recent changes…</p>;
  const { rows, failed, loading } = feed;
  if (!rows?.length && !failed) return <p role="status" className="accounting-muted">No recorded changes are visible for this book yet.</p>;
  const latest = rows?.[0];
  const news = rows?.filter(fresh).length || 0;
  return <section className="accounting-activity" aria-label="Recent changes" aria-busy={loading}>
    {failed && <p role="status" className="accounting-muted">
      {rows?.length ? 'Showing the last loaded changes. New changes could not be loaded.' : 'Recent changes are unavailable right now.'}{' '}
      <button type="button" disabled={loading} onClick={() => setRetry(value => value + 1)}>{loading ? 'Retrying…' : 'Try again'}</button>
    </p>}
    {latest && <><p className="accounting-activity-latest"><span className="accounting-eyebrow">{failed ? 'Last loaded' : 'Latest'}</span> <strong>{who(latest)}</strong> {activityWhat(latest)} <span className="accounting-muted">· {latest.source_filename || 'source'} · {ago(latest.recorded_at, now)}</span></p>
    <details><summary>Recent changes {news > 0 && <span className="accounting-new">{news} new</span>}</summary>
      <ol className="accounting-activity-list">{rows?.map(row => <li key={row.run_id}>
        <button type="button" onClick={() => onOpen(row.document_id)}><strong>{who(row)}</strong> {activityWhat(row)}<span className="accounting-muted">{row.source_filename || 'source'} · {ago(row.recorded_at, now)}</span>{fresh(row) && <span className="accounting-new">New</span>}</button>
      </li>)}</ol>
    </details></>}
  </section>;
}
