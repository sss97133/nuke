/**
 * The ladder: where the car stands on its sourced bands and what moves it. One renderer for the contributor page and
 * the owner card. Every number here comes from the `progress` block the intake writers return; nothing is computed or
 * guessed on the page.
 *
 * A rung's band is rendered only from its `band` block (reader evidence_rung_band_v1): the number appears only with its
 * population in words (n, class, years, since, basis, interval) and its lot ids; a band the reader marks too_few_to_tell
 * says so and shows n, never a number; a rung with no band block is a label. The band's class is the spec's proxy, not a
 * claim about this car, so each rung reads "what <class> lots sold for".
 */
import React from 'react';
import { day, Text } from '../../kit';
import { arr, num, obj, str } from '../jobs/jobRead';

export type Band = {
  reader: string; n: number; asOf: string; lotIds: string[]; low: number | null; high: number | null; median: number | null;
  interval: string | null; tooFew: boolean; reasoning: string | null;
  params: { cls: string | null; make: string | null; model: string | null; yearMin: number | null; yearMax: number | null; since: string | null; basis: string | null };
  classCounts: Array<[string, number]>;
};
export type Rung = { key: string; label: string; basis: string | null; reached: boolean; band: Band | null };
export type Item = { key: string; label: string; kind: string | null; questionKey: string | null; status: string | null };
export type Progress = {
  rung: Rung | null; rungs: Rung[];
  proven: Item[]; open: Item[]; contradicted: Item[]; next: Item[];
  received: Array<{ key: string; label: string; sourceRead: string; assessment: string }>;
  lastChange: { at: string | null; what: string | null; toStatus: string | null; movedFrom: string | null; movedTo: string | null; eventKind: string | null } | null;
};

const CLASS_WORDS: Record<string, string> = { base: 'base', trans_am: 'Trans Am', sd: 'SD', clone: 'clone' };
export const classWord = (k: string) => CLASS_WORDS[k] ?? k.replace(/_/g, ' ');

/** Reasoning as the writer gives it: a sentence, or {rule, result} (its inputs are the lots already shown). */
const readReasoning = (v: unknown): string | null => {
  const s = str(v); if (s) return s;
  const o = obj(v); if (!o) return null;
  return [str(o.rule), str(o.result)].filter(Boolean).join(' ') || null;
};
/** The band block only counts when every part of its derivation is present: a number without its lots is not shown. */
export function readBand(v: unknown): Band | null {
  const b = obj(v); if (!b) return null;
  const reader = str(b.reader); const n = num(b.n); const asOf = str(b.as_of);
  const lotIds = arr(b.lot_ids).map(x => str(x) ?? (typeof x === 'number' ? String(x) : null)).filter((x): x is string => !!x);
  if (!reader || n === null || n < 0 || !asOf) return null;
  const tooFew = b.too_few_to_tell === true;
  if (!tooFew && lotIds.length === 0) return null;
  const p = obj(b.params) ?? {};
  const counts = obj(b.class_counts) ?? {};
  return {
    reader, n, asOf, lotIds, low: num(b.low), high: num(b.high), median: num(b.median), interval: str(b.interval), tooFew, reasoning: readReasoning(b.reasoning),
    params: { cls: str(p.class), make: str(p.make), model: str(p.model) ?? str(p.model_pattern), yearMin: num(p.year_min), yearMax: num(p.year_max), since: str(p.since), basis: str(p.basis) },
    classCounts: Object.entries(counts).map(([k, c]) => [k, num(c)] as [string, number | null]).filter((e): e is [string, number] => e[1] !== null)
      .sort((a, b2) => b2[1] - a[1]),
  };
}
const readRung = (v: unknown, reached = false): Rung | null => {
  const r = obj(v); if (!r) return null;
  const key = str(r.key) ?? str(r.label); const label = str(r.label) ?? str(r.key);
  if (!key || !label) return null;
  return { key, label, basis: str(r.basis), reached: r.reached === true || reached, band: readBand(r.band) };
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
    received: arr(p.received).flatMap(v => {
      const r = obj(v); const key = str(r?.key); const label = str(r?.label);
      return key && label ? [{ key, label, sourceRead: str(r?.source_read_status) ?? 'pending', assessment: str(r?.assessment_status) ?? 'unresolved' }] : [];
    }),
    lastChange: lc ? { at: str(lc.at), what: str(lc.what), toStatus: str(lc.to_status), movedFrom: str(lc.moved_from), movedTo: str(lc.moved_to), eventKind: str(lc.event_kind) } : null,
  };
  return out.rung || out.rungs.length || out.proven.length || out.open.length || out.next.length ? out : null;
}

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const monthYear = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : iso; };
const yearSpan = (a: number | null, b: number | null) => a !== null && b !== null ? (a === b ? String(a) : `${a}-${String(b).slice(-2)}`) : a !== null ? String(a) : b !== null ? String(b) : null;

/** Whether a number may be shown at all: a band with both ends, not too few. */
export const isDerived = (b: Band | null): boolean => !!b && !b.tooFew && b.low !== null && b.high !== null;
/** The band in words: "too few to tell" when the reader says so; dollars only with a full derivation; else nothing. */
export const bandText = (b: Band | null): string | null =>
  !b ? null : b.tooFew ? 'too few to tell' : b.low !== null && b.high !== null ? `${usd(b.low)} to ${usd(b.high)}` : null;
/** "what base lots sold for": the class is the spec's proxy, never a claim about this car. */
export const classLine = (b: Band | null): string | null => b?.params.cls ? `what ${classWord(b.params.cls)} lots sold for` : null;
/** "34 base 1970-73 Pontiac Firebird lots sold since Jan 2022, hammer, p25 to p75" */
export function populationText(b: Band, subject?: string | null): string {
  const { params: p } = b;
  const what = [p.cls ? classWord(p.cls) : null, yearSpan(p.yearMin, p.yearMax), p.make, p.model ?? subject ?? null].filter(Boolean).join(' ');
  const since = p.since ? ` sold since ${monthYear(p.since)}` : '';
  const interval = b.interval ? b.interval.replace(/\s+of\s+.*$/i, '') : null;
  const tail = [p.basis, interval].filter(Boolean).join(', ');
  return `${b.n.toLocaleString('en-US')} ${what ? `${what} ` : ''}${b.n === 1 ? 'lot' : 'lots'}${since}${tail ? `, ${tail}` : ''}`;
}
/** "as of Oct 29, 2026, evidence_rung_band_v1" */
export const asOfText = (b: Band) => { const d = day(b.asOf); return `as of ${d === 'unknown date' ? b.asOf : d}, ${b.reader}`; };
export const classCountsText = (b: Band): string | null => b.classCounts.length
  ? `lots by class${b.params.since ? ` since ${monthYear(b.params.since)}` : ''}: ${b.classCounts.map(([k, n]) => `${classWord(k)} ${n.toLocaleString('en-US')}`).join(' · ')}` : null;

/** What the last input did, in one line, from the writer's own record of it: the item (by key or label) and any rung move. */
export function movedText(p: Progress | null): string | null {
  const lc = p?.lastChange; if (!lc || !p) return null;
  const all = [...p.proven, ...p.open, ...p.contradicted];
  const item = lc.what ? all.find(i => i.key === lc.what || i.label === lc.what) : null;
  const label = item?.label ?? lc.what;
  if (lc.eventKind === 'input_received') return `${label ?? 'Input'} received. Evidence checks are pending.`;
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

function BandView({ b, subject }: { b: Band; subject?: string | null }) {
  return <details className="ct-derivation">
    <summary><Text role="caption">{populationText(b, subject)}</Text></summary>
    <Text role="caption" as="p" className="ct-derivation__asof">{asOfText(b)}</Text>
    {b.lotIds.length > 0 && <ul className="ct-lots" aria-label="Sold lots behind this band">{b.lotIds.map(id => <li key={id}><Text role="caption">{id}</Text></li>)}</ul>}
  </details>;
}

export function IntakeLadder({ progress, moved, audience, subject }: { progress: Progress; moved?: string | null; audience: 'contributor' | 'owner'; subject?: string | null }) {
  const { rung, rungs } = progress;
  const counts = [progress.proven.length ? `${progress.proven.length} proven` : null, progress.open.length ? `${progress.open.length} open` : null,
    progress.contradicted.length ? `${progress.contradicted.length} contradicted` : null].filter(Boolean).join(' · ');
  const standing = rung ? (bandText(rung.band) ? `${rung.label}: ${bandText(rung.band)}` : rung.label) : null;
  const classCounts = rung?.band ? classCountsText(rung.band) : null;
  return <section className="ct-ladder" aria-label="Where the car stands">
    {rungs.length > 0 && <ol className="ct-rungs" aria-label="Rungs">{rungs.map(r => <li key={r.key} className={`ct-rung${r.reached ? ' ct-rung--reached' : ''}${rung && r.key === rung.key ? ' ct-rung--here' : ''}`}>
      <span className="ct-rung__bar" aria-hidden="true" />
      <span className="ct-rung__name"><Text role="caption">{r.label}</Text>{classLine(r.band) && <Text role="caption" className="ct-rung__class">{classLine(r.band)}</Text>}</span>
      {bandText(r.band) && <Text role="caption" className="ct-rung__band">{bandText(r.band)}</Text>}
      {r.band && <BandView b={r.band} subject={subject} />}
    </li>)}</ol>}
    {rung && standing && <div className="ct-ladder__now">
      <Text role="label">{audience === 'contributor' ? 'Where it stands with what you have sent' : 'Where it stands'}</Text>
      <Text role="entity" as="p" className="ct-ladder__rung">{standing}</Text>
      {classLine(rung.band) && <Text role="caption" as="p" className="ct-rung__class">{classLine(rung.band)}</Text>}
      {rung.band && <BandView b={rung.band} subject={subject} />}
      {classCounts && <Text role="caption" as="p" className="ct-ladder__classes">{classCounts}</Text>}
      {rung.basis && <Text role="caption" as="p">{rung.basis}</Text>}
      {rung.band?.reasoning && <blockquote className="ct-reasoning"><Text role="body">{rung.band.reasoning}</Text></blockquote>}
    </div>}
    {counts && <Text role="caption" as="p" className="ct-ladder__counts">{counts}</Text>}
    {progress.received.length > 0 && <ul aria-label="Received evidence">{progress.received.map(r => <li key={r.key}>
      <Text role="caption">{r.label}: received · {r.sourceRead === 'read' ? 'source read' : r.sourceRead === 'failed' ? 'reading failed' : 'reading pending'} · {r.assessment === 'supported' ? 'claim supported' : r.assessment === 'contradicted' ? 'claim contradicted' : 'claim unresolved'}</Text>
    </li>)}</ul>}
    {moved && <p className="ct-moved" role="status"><Text role="body">{moved}</Text></p>}
    {progress.next.length > 0 && <div className="ct-ladder__next">
      <Text role="label">{audience === 'contributor' ? 'What moves it next' : 'Next'}</Text>
      <ol className="ct-next">{progress.next.map(n => <li key={n.key}><Text role="body">{n.label}</Text>{n.kind && <Text role="caption">{` (${n.kind})`}</Text>}</li>)}</ol>
    </div>}
  </section>;
}
