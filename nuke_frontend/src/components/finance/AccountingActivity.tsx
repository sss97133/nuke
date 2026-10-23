import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAccountingBook } from './AccountingBookContext';

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

/** The book's latest attributed revisions, refreshed with the shared ledger. Changes by others since this page opened
 *  are marked New; tapping one opens its source. */
export default function AccountingActivity({ people, onOpen }: { people: Record<string, string>; onOpen: (documentId: string) => void }) {
  const { ownerId, liveRevision } = useAccountingBook();
  const [rows, setRows] = useState<Activity[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const opened = useRef(new Date().toISOString());
  useEffect(() => { opened.current = new Date().toISOString(); setRows(null); }, [ownerId]);
  useEffect(() => {
    if (!ownerId) return;
    let cancelled = false;
    void Promise.resolve(supabase.rpc('accounting_recent_activity', { p_owner_id: ownerId, p_limit: 20 })).then(({ data, error }) => {
      if (cancelled) return;
      if (error || !Array.isArray(data)) { setFailed(true); return; }
      setFailed(false); setRows(data as Activity[]); setNow(Date.now());
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [ownerId, liveRevision]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30000); return () => window.clearInterval(timer); }, []);
  const who = (row: Activity) => (row.actor_user_id && people[row.actor_user_id]) || 'A reviewer';
  const fresh = (row: Activity) => row.recorded_at > opened.current && people[row.actor_user_id || ''] !== 'You';
  if (!ownerId || (!rows && !failed)) return null;
  if (failed && !rows) return <p className="accounting-muted">Recent changes are unavailable right now.</p>;
  if (!rows?.length) return null;
  const latest = rows[0];
  const news = rows.filter(fresh).length;
  return <section className="accounting-activity" aria-label="Recent changes">
    <p className="accounting-activity-latest"><span className="accounting-eyebrow">Latest</span> <strong>{who(latest)}</strong> {activityWhat(latest)} <span className="accounting-muted">· {latest.source_filename || 'source'} · {ago(latest.recorded_at, now)}</span></p>
    <details><summary>Recent changes {news > 0 && <span className="accounting-new">{news} new</span>}</summary>
      <ol className="accounting-activity-list">{rows.map(row => <li key={row.run_id}>
        <button type="button" onClick={() => onOpen(row.document_id)}><strong>{who(row)}</strong> {activityWhat(row)}<span className="accounting-muted">{row.source_filename || 'source'} · {ago(row.recorded_at, now)}</span>{fresh(row) && <span className="accounting-new">New</span>}</button>
      </li>)}</ol>
    </details>
  </section>;
}
