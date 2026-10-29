/**
 * The ladder: where the car stands on its sourced bands and what moves it. One renderer for the contributor page and
 * the owner card. Every number here comes from the `progress` block the intake writers return (vehicle_evidence_rungs
 * and vehicle_evidence_items); nothing is computed or guessed on the page.
 *
 * A dollar band is shown only when the reply carries its derivation: the reader that computed it, how many sold lots
 * (n), the interval, the as-of date and the auction_events lot ids. A rung without that is a label, never a number;
 * a rung the reader marks too_few_to_tell says so in words.
 */
import React from 'react';
import { day, Text } from '../../kit';
import { arr, num, obj, str } from '../jobs/jobRead';

export type Derivation = { reader: string; n: number; asOf: string; lotIds: string[]; interval: { low: number; high: number; level: string | null } | string | null };
export type Rung = {
  key: string; label: string; low: number | null; high: number | null; basis: string | null; reached: boolean;
  derivation: Derivation | null; tooFew: boolean; reasoning: string | null;
};
export type Item = { key: string; label: string; kind: string | null; questionKey: string | null; status: string | null };
export type Progress = {
  rung: Rung | null; rungs: Rung[];
  proven: Item[]; open: Item[]; contradicted: Item[]; next: Item[];
  lastChange: { at: string | null; what: string | null; toStatus: string | null; movedFrom: string | null; movedTo: string | null } | null;
};

const readInterval = (v: unknown): Derivation['interval'] => {
  if (typeof v === 'string') return v.trim() || null;
  const o = obj(v);
  if (o) { const low = num(o.low) ?? num(o.lo); const high = num(o.high) ?? num(o.hi); return low !== null && high !== null ? { low, high, level: str(o.level) ?? str(o.coverage) } : null; }
  const a = arr(v); const low = num(a[0]); const high = num(a[1]);
  return low !== null && high !== null ? { low, high, level: null } : null;
};
/** The derivation only counts when every part is present: a band without its lots is not shown. */
const readDerivation = (r: Record<string, unknown>): Derivation | null => {
  const reader = str(r.reader); const n = num(r.n); const asOf = str(r.as_of);
  const lotIds = arr(r.lot_ids).map(x => str(x) ?? (typeof x === 'number' ? String(x) : null)).filter((x): x is string => !!x);
  if (!reader || n === null || n <= 0 || !asOf || lotIds.length === 0) return null;
  return { reader, n, asOf, lotIds, interval: readInterval(r.interval) };
};
/** Reasoning as the writer gives it: a sentence, or {rule, result} (its inputs are the lots already shown). */
const readReasoning = (v: unknown): string | null => {
  const s = str(v); if (s) return s;
  const o = obj(v); if (!o) return null;
  return [str(o.rule), str(o.result)].filter(Boolean).join(' ') || null;
};
const readRung = (v: unknown, reached = false): Rung | null => {
  const r = obj(v); if (!r) return null;
  const key = str(r.key) ?? str(r.label); const label = str(r.label) ?? str(r.key);
  if (!key || !label) return null;
  // The derivation lives in the rung's `band` block (reader, n, as_of, lot_ids, low, high) or, for older replies, on the rung itself.
  const b = obj(r.band) ?? r;
  return {
    key, label, low: num(b.low) ?? num(r.band_low) ?? num(r.low), high: num(b.high) ?? num(r.band_high) ?? num(r.high), basis: str(r.basis), reached: r.reached === true || reached,
    derivation: readDerivation(b), tooFew: b.too_few_to_tell === true || r.too_few_to_tell === true, reasoning: readReasoning(b.reasoning) ?? readReasoning(r.reasoning),
  };
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
/** Whether the band may be shown at all: both ends and a complete derivation. */
export const isDerived = (r: Rung): boolean => !r.tooFew && r.low !== null && r.high !== null && r.derivation !== null;
/** The band in words: "too few to tell" when the reader says so (whatever else the row carries); dollars only with a derivation; else nothing. */
export const bandText = (r: Rung): string | null => r.tooFew ? 'too few to tell' : isDerived(r) ? `${usd(r.low!)} to ${usd(r.high!)}` : null;
/** "14 sold lots, market line, as of Oct 29, 2026" (+ the interval when the reader gives one). */
export const derivationText = (d: Derivation): string => {
  const pretty = day(d.asOf); const when = pretty === 'unknown date' ? d.asOf : pretty;
  const interval = typeof d.interval === 'string' ? `, ${d.interval}` : d.interval ? `, ${d.interval.level ? `${d.interval.level} ` : ''}interval ${usd(d.interval.low)} to ${usd(d.interval.high)}` : '';
  return `${d.n.toLocaleString('en-US')} sold ${d.n === 1 ? 'lot' : 'lots'}, ${d.reader}, as of ${when}${interval}`;
};

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

function DerivationView({ d }: { d: Derivation }) {
  return <details className="ct-derivation">
    <summary><Text role="caption">{derivationText(d)}</Text></summary>
    <ul className="ct-lots" aria-label="Sold lots behind this band">{d.lotIds.map(id => <li key={id}><Text role="caption">{id}</Text></li>)}</ul>
  </details>;
}

export function IntakeLadder({ progress, moved, audience }: { progress: Progress; moved?: string | null; audience: 'contributor' | 'owner' }) {
  const { rung, rungs } = progress;
  const counts = [progress.proven.length ? `${progress.proven.length} proven` : null, progress.open.length ? `${progress.open.length} open` : null,
    progress.contradicted.length ? `${progress.contradicted.length} contradicted` : null].filter(Boolean).join(' · ');
  const standing = rung ? (bandText(rung) ? `${rung.label}: ${bandText(rung)}` : rung.label) : null;
  return <section className="ct-ladder" aria-label="Where the car stands">
    {rungs.length > 0 && <ol className="ct-rungs" aria-label="Rungs">{rungs.map(r => <li key={r.key} className={`ct-rung${r.reached ? ' ct-rung--reached' : ''}${rung && r.key === rung.key ? ' ct-rung--here' : ''}`}>
      <span className="ct-rung__bar" aria-hidden="true" />
      <Text role="caption">{r.label}</Text>
      {bandText(r) && <Text role="caption" className="ct-rung__band">{bandText(r)}</Text>}
      {r.derivation && <DerivationView d={r.derivation} />}
    </li>)}</ol>}
    {rung && standing && <div className="ct-ladder__now">
      <Text role="label">{audience === 'contributor' ? 'Where it stands with what you have sent' : 'Where it stands'}</Text>
      <Text role="entity" as="p" className="ct-ladder__rung">{standing}</Text>
      {rung.derivation && <DerivationView d={rung.derivation} />}
      {rung.basis && <Text role="caption" as="p">{rung.basis}</Text>}
      {rung.reasoning && <blockquote className="ct-reasoning"><Text role="body">{rung.reasoning}</Text></blockquote>}
    </div>}
    {counts && <Text role="caption" as="p" className="ct-ladder__counts">{counts}</Text>}
    {moved && <p className="ct-moved" role="status"><Text role="body">{moved}</Text></p>}
    {progress.next.length > 0 && <div className="ct-ladder__next">
      <Text role="label">{audience === 'contributor' ? 'What moves it next' : 'Next'}</Text>
      <ol className="ct-next">{progress.next.map(n => <li key={n.key}><Text role="body">{n.label}</Text>{n.kind && <Text role="caption">{` (${n.kind})`}</Text>}</li>)}</ol>
    </div>}
  </section>;
}
