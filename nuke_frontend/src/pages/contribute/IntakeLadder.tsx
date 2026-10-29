/**
 * The ladder: where the car stands on its sourced bands and what moves it. One renderer for the contributor page and
 * the owner card. Every number here comes from the `progress` block the intake writers return (vehicle_evidence_rungs
 * and vehicle_evidence_items); nothing is computed or guessed on the page.
 */
import React from 'react';
import { Text } from '../../kit';
import { arr, num, obj, str } from '../jobs/jobRead';

export type Rung = { key: string; label: string; low: number | null; high: number | null; basis: string | null; reached: boolean };
export type Item = { key: string; label: string; kind: string | null; questionKey: string | null; status: string | null };
export type Progress = {
  rung: Rung | null; rungs: Rung[];
  proven: Item[]; open: Item[]; contradicted: Item[]; next: Item[];
  lastChange: { at: string | null; what: string | null; toStatus: string | null; movedFrom: string | null; movedTo: string | null } | null;
};

const readRung = (v: unknown, reached = false): Rung | null => {
  const r = obj(v); if (!r) return null;
  const key = str(r.key) ?? str(r.label); const label = str(r.label) ?? str(r.key);
  if (!key || !label) return null;
  return { key, label, low: num(r.band_low) ?? num(r.low), high: num(r.band_high) ?? num(r.high), basis: str(r.basis), reached: r.reached === true || reached };
};
const readItem = (v: unknown, status: string | null): Item | null => {
  if (typeof v === 'string') return v ? { key: v, label: v, kind: null, questionKey: null, status } : null;
  const o = obj(v); if (!o) return null;
  const label = str(o.label) ?? str(o.prompt) ?? str(o.key); const key = str(o.key) ?? label;
  if (!key || !label) return null;
  return { key, label, kind: str(o.kind), questionKey: str(o.question_key) ?? str(o.satisfied_by), status: str(o.status) ?? status };
};
const items = (v: unknown, status: string | null) => arr(v).map(x => readItem(x, status)).filter((x): x is Item => x !== null);

/** Tolerant read of the writer's progress block. Null when there is none. */
export function readProgress(v: unknown): Progress | null {
  const p = obj(v); if (!p) return null;
  const rung = readRung(p.rung, true);
  // The writer says which rungs are reached; without that flag, everything up to the standing rung counts.
  let seen = false;
  const rungs = arr(p.rungs).map(x => {
    const r = readRung(x); if (!r) return null;
    const flagged = typeof obj(x)?.reached === 'boolean';
    const byOrder = rung ? !seen : false; if (rung && r.key === rung.key) seen = true;
    return { ...r, reached: flagged ? r.reached : byOrder };
  }).filter((x): x is Rung => x !== null);
  const lc = obj(p.last_change);
  const out: Progress = {
    rung, rungs, proven: items(p.proven, 'proven'), open: items(p.open, 'open'), contradicted: items(p.contradicted, 'contradicted'), next: items(p.next, 'open').slice(0, 3),
    lastChange: lc ? { at: str(lc.at), what: str(lc.what), toStatus: str(lc.to_status), movedFrom: str(lc.moved_from), movedTo: str(lc.moved_to) } : null,
  };
  return out.rung || out.rungs.length || out.proven.length || out.open.length || out.next.length ? out : null;
}

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
export const bandText = (r: Rung): string | null => r.low !== null && r.high !== null ? `${usd(r.low)} to ${usd(r.high)}` : r.low !== null ? `from ${usd(r.low)}` : r.high !== null ? `up to ${usd(r.high)}` : null;

/** What the last input did, in one line, from the writer's own record of it: the item (by key or label) and any rung move. */
export function movedText(p: Progress | null): string | null {
  const lc = p?.lastChange; if (!lc || !p) return null;
  const all = [...p.proven, ...p.open, ...p.contradicted];
  const item = lc.what ? all.find(i => i.key === lc.what || i.label === lc.what) : null;
  const label = item?.label ?? lc.what;
  const verb = lc.toStatus === 'proven' ? 'is now proven' : lc.toStatus === 'contradicted' ? 'is now contradicted' : lc.toStatus ? `is now ${lc.toStatus}` : 'changed';
  const rungName = (k: string) => p.rungs.find(r => r.key === k)?.label ?? k;
  const move = lc.movedTo && lc.movedFrom && lc.movedTo !== lc.movedFrom ? ` The car moved from ${rungName(lc.movedFrom)} to ${rungName(lc.movedTo)}.` : '';
  const head = label ? `${label} ${verb}.` : '';
  return head || move ? `${head}${move}`.trim() : null;
}

/** The photo and document items a contributor can name when sending a file: next first, then the rest still open. */
export function shotChoices(p: Progress | null): Item[] {
  if (!p) return [];
  const seen = new Set<string>();
  return [...p.next, ...p.open].filter(i => (i.kind === 'photo' || i.kind === 'document') && !seen.has(i.key) && seen.add(i.key)).slice(0, 12);
}

export function IntakeLadder({ progress, moved, audience }: { progress: Progress; moved?: string | null; audience: 'contributor' | 'owner' }) {
  const { rung, rungs } = progress;
  const counts = [progress.proven.length ? `${progress.proven.length} proven` : null, progress.open.length ? `${progress.open.length} open` : null,
    progress.contradicted.length ? `${progress.contradicted.length} contradicted` : null].filter(Boolean).join(' · ');
  return <section className="ct-ladder" aria-label="Where the car stands">
    {rungs.length > 0 && <ol className="ct-rungs" aria-label="Rungs">{rungs.map(r => <li key={r.key} className={`ct-rung${r.reached ? ' ct-rung--reached' : ''}${rung && r.key === rung.key ? ' ct-rung--here' : ''}`}>
      <span className="ct-rung__bar" aria-hidden="true" />
      <Text role="caption">{r.label}</Text>
      {bandText(r) && <Text role="caption" className="ct-rung__band">{bandText(r)}</Text>}
    </li>)}</ol>}
    {rung && <div className="ct-ladder__now">
      <Text role="label">{audience === 'contributor' ? 'Where it stands with what you have sent' : 'Where it stands'}</Text>
      <Text role="entity" as="p" className="ct-ladder__rung">{rung.label}{bandText(rung) ? `: ${bandText(rung)}` : ''}</Text>
      {rung.basis && <Text role="caption" as="p">{rung.basis}</Text>}
    </div>}
    {counts && <Text role="caption" as="p" className="ct-ladder__counts">{counts}</Text>}
    {moved && <p className="ct-moved" role="status"><Text role="body">{moved}</Text></p>}
    {progress.next.length > 0 && <div className="ct-ladder__next">
      <Text role="label">{audience === 'contributor' ? 'What moves it next' : 'Next'}</Text>
      <ol className="ct-next">{progress.next.map(n => <li key={n.key}><Text role="body">{n.label}</Text>{n.kind && <Text role="caption">{` (${n.kind})`}</Text>}</li>)}</ol>
    </div>}
  </section>;
}
