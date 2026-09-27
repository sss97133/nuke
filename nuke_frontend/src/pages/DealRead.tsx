/**
 * DealRead — a marketplace ask placed on the cohort's Bring a Trailer sales record.
 *
 * Route: /deal/:vehicleId — the subject is a `vehicles` row landed through
 * `ingest` with an asking price (a Facebook / Craigslist listing), never a
 * sale. The comps are the cohort's BaT sales under the sold rule in
 * lib/dealRead/batComps.ts, read live from `vehicles` + `bat_listings`.
 *
 * Every figure on the page is derived from rows the page also shows, and every
 * figure is a button that opens those rows in place (tenet 1: everything is a
 * button; C10 depth: aggregate → rows → source). When the corpus fails its
 * integrity gate the market figures are withheld — "not priced yet" — and the
 * rows still render, because a real sale record is evidence even when the set
 * is incomplete. Nothing here is fabricated, averaged across a conflict, or
 * softened into an "honest-low" number (feedback: block, never guess).
 *
 * Design: docs/library/technical/design-book (Arial labels 8–9px, Courier New
 * for machine data, 2px borders, zero radius/shadow, colour only as data).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useDealRead, type DealObservation, type DealSubject } from '../hooks/useDealRead';
import { SectionHeader, DarkBlock } from '../components/terminal/primitives';
import { panelStyle } from '../components/terminal/styles';
import {
  classifyEngine, fmtMoney, median, mileageBracket, shareBelow, summarize, windowComps,
  type Comp, type EngineClass, type Exclusion, type ExclusionReason,
} from '../lib/dealRead/batComps';
import { backtestFor, type BacktestRow } from '../lib/dealRead/registers';
import './DealRead.css';

const WINDOW_MONTHS = 36;

// ─── Drills: every datum opens the rows behind it, in place, URL-addressable ──

interface Drills {
  isOpen: (id: string) => boolean;
  toggle: (id: string) => void;
  closeAll: () => void;
}

function useDrills(): Drills {
  const [params, setParams] = useSearchParams();
  const open = useMemo(() => new Set((params.get('open') ?? '').split(',').filter(Boolean)), [params]);
  const write = (next: Set<string>) => {
    const p = new URLSearchParams(params);
    if (next.size) p.set('open', Array.from(next).join(','));
    else p.delete('open');
    setParams(p, { replace: true });
  };
  const closeAll = () => write(new Set());
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && open.size) closeAll(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return {
    isOpen: id => open.has(id),
    toggle: id => {
      const next = new Set(open);
      if (next.has(id)) next.delete(id); else next.add(id);
      write(next);
    },
    closeAll,
  };
}

function Drill({ id, drills, children, strong }: { id: string; drills: Drills; children: React.ReactNode; strong?: boolean }) {
  return (
    <button
      type="button"
      className={`dr-drill${strong ? ' dr-strong' : ''}`}
      aria-expanded={drills.isOpen(id)}
      aria-controls={`x-${id}`}
      onClick={() => drills.toggle(id)}
    >
      {children}
    </button>
  );
}

function Expansion({ id, drills, children }: { id: string; drills: Drills; children: React.ReactNode }) {
  if (!drills.isOpen(id)) return null;
  return <div id={`x-${id}`} className="dr-expand">{children}</div>;
}

// ─── Formatting ────────────────────────────────────────────────────────────

const fmtPct = (x: number | null | undefined, digits = 0): string =>
  x == null || !isFinite(x) ? 'n/a' : `${(x * 100).toFixed(digits)}%`;

const fmtDelta = (a: number | null, b: number | null): string => {
  if (a == null || b == null || b === 0) return 'n/a';
  const d = (a - b) / b;
  return `${d >= 0 ? '+' : '−'}${Math.abs(Math.round(d * 100))}%`;
};

const fmtMiles = (n: number | null | undefined): string =>
  n == null || !isFinite(n) ? 'n/a' : `${Math.round(n).toLocaleString('en-US')} mi`;

const shortId = (id: string | null | undefined): string => (id ?? '').slice(0, 8);

const ENGINE_LABEL: Record<EngineClass, string> = {
  four_2_0: '2.0 flat-four',
  four_1_7_1_8: '1.7 / 1.8 flat-four',
  four_other: 'flat-four, other displacement',
  six: 'flat-six',
  swap: 'engine swap',
  unknown: 'engine not recorded',
};

const REASON_LABEL: Record<ExclusionReason, string> = {
  unresolved: 'price recorded, outcome not recorded',
  not_sold: 'did not sell (reserve not met / withdrawn)',
  status_conflict: 'record says sold and reserve not met at once',
  price_conflict: 'sale price differs between records of the same lot',
  date_conflict: 'sale date differs between records of the same lot',
  junk_price: 'sale price under $1,000 (parse artifact)',
  undated: 'sold, no sale date',
  outside_years: 'outside the cohort model years',
  title_not_model: 'BaT title names another model',
  six_cylinder: '914/6 or six-cylinder conversion',
  engine_swap: 'engine swap',
  engine_not_stock: 'flat-four of a non-stock displacement',
  engine_unknown: 'engine not recorded',
};

// ─── Row tables (the evidence behind every number) ──────────────────────────

function textFlags(c: Comp): string {
  if (!c.text) return '…';
  if (!c.text.readable) return c.text.project ? `${/race ?car/i.test(c.title) ? 'race car' : 'project'} (title) · write-up truncated` : 'write-up truncated';
  const f: string[] = [];
  if (c.text.rustMention) f.push('rust');
  if (c.text.project) f.push(/race ?car/i.test(c.title) ? 'race car' : 'project');
  if (c.text.restored) f.push('restored');
  if (c.text.repaint) f.push('repaint');
  if (c.text.originalPaint) f.push('orig paint');
  if (c.text.originalInterior) f.push('orig interior');
  if (c.text.ac) f.push('a/c');
  if (c.text.titleIssue) f.push('title issue');
  return f.length ? f.join(' · ') : 'none read';
}

function CompRows({ rows, ask, mark }: { rows: Comp[]; ask?: number | null; mark?: (c: Comp) => boolean }) {
  if (rows.length === 0) return <div className="dr-mono dr-muted" style={{ fontSize: 'var(--fs-9)' }}>no rows</div>;
  return (
    <div className="dr-scroll">
      <table className="dr-table">
        <thead>
          <tr>
            <th>sold</th><th>lot</th><th className="num">price</th>
            {ask != null && <th className="num">vs ask</th>}
            <th className="num">miles</th><th>engine</th><th>trans</th><th>write-up reads</th><th>record</th><th>basis</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(c => (
            <tr key={c.slug} style={mark?.(c) ? { fontWeight: 700 } : undefined}>
              <td>{c.date}</td>
              <td className="wrap"><a className="dr-link" href={c.url} target="_blank" rel="noreferrer">{c.title || c.slug}</a></td>
              <td className="num">{fmtMoney(c.price)}</td>
              {ask != null && <td className="num">{fmtDelta(c.price, ask)}</td>}
              <td className="num">{c.mileage != null ? fmtMiles(c.mileage) : 'n/a'}</td>
              <td className="wrap">{c.engineText || ENGINE_LABEL[c.engine]}</td>
              <td className="wrap">{c.transmission ?? 'n/a'}</td>
              <td className="wrap">{textFlags(c)}</td>
              <td>{c.vehicleId ? <Link className="dr-link" to={`/vehicle/${c.vehicleId}`}>nuke {shortId(c.vehicleId)}</Link> : 'no vehicle row'}</td>
              <td>{c.basis}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExclusionRows({ rows }: { rows: Exclusion[] }) {
  if (rows.length === 0) return <div className="dr-mono dr-muted" style={{ fontSize: 'var(--fs-9)' }}>no rows</div>;
  return (
    <div className="dr-scroll">
      <table className="dr-table">
        <thead>
          <tr><th>lot</th><th>year</th><th className="num">price held</th><th>date held</th><th>why set aside</th><th>record</th></tr>
        </thead>
        <tbody>
          {rows.map(e => (
            <tr key={`${e.reason}-${e.slug}`}>
              <td className="wrap"><a className="dr-link" href={e.url} target="_blank" rel="noreferrer">{e.title || e.slug}</a></td>
              <td>{e.year ?? 'n/a'}</td>
              <td className="num">{e.price != null ? fmtMoney(e.price) : 'n/a'}</td>
              <td>{e.date ?? 'n/a'}</td>
              <td className="wrap">{e.detail}</td>
              <td>{e.vehicleId ? <Link className="dr-link" to={`/vehicle/${e.vehicleId}`}>nuke {shortId(e.vehicleId)}</Link> : 'bat_listings only'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BacktestRows({ rows }: { rows: BacktestRow[] }) {
  return (
    <div className="dr-scroll">
      <table className="dr-table">
        <thead>
          <tr><th>sold</th><th>lot</th><th className="num">actual</th><th className="num">p10</th><th className="num">p50</th><th className="num">p90</th><th>in band</th><th className="num">miss</th><th className="num">n eff</th></tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.slug}>
              <td>{r.sold_on}</td>
              <td className="wrap"><a className="dr-link" href={r.url} target="_blank" rel="noreferrer">{r.title}</a></td>
              <td className="num">{fmtMoney(r.actual)}</td>
              <td className="num">{fmtMoney(r.p10)}</td>
              <td className="num">{fmtMoney(r.p50)}</td>
              <td className="num">{fmtMoney(r.p90)}</td>
              <td>{r.in_p10_p90 ? 'yes' : 'no'}</td>
              <td className="num">{r.miss_pct.toFixed(1)}%</td>
              <td className="num">{r.n_eff.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KeyValues({ entries }: { entries: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="dr-kv">
      {entries.map(([k, v]) => (
        <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>
      ))}
    </dl>
  );
}

// ─── Strip plot: every counted sale as a dot, the ask as a rule ────────────

function useWidth<T extends HTMLElement>(ref: React.RefObject<T | null>): number {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(entries => setW(Math.floor(entries[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

const hash01 = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
};

function StripPlot({ comps, ask, quantiles }: {
  comps: Comp[]; ask: number | null;
  /** only passed when the corpus gate passes */
  quantiles: Array<{ label: string; value: number }> | null;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const width = useWidth(ref);
  const H = 152, padL = 28, padR = 28, axisY = 116, dotTop = 40, dotBottom = 100;
  const prices = comps.map(c => c.price);
  const values = ask != null ? [...prices, ask] : prices;
  const lo = Math.floor(Math.min(...values) / 5000) * 5000;
  const hi = Math.ceil(Math.max(...values) / 5000) * 5000 || 5000;
  const span = Math.max(hi - lo, 5000);
  const x = (v: number) => padL + ((v - lo) / span) * Math.max(width - padL - padR, 1);
  const step = width < 520 ? 20000 : span > 120000 ? 25000 : 10000;
  const ticks: number[] = [];
  for (let t = lo; t <= hi; t += step) ticks.push(t);

  return (
    <div ref={ref} style={{ width: '100%' }}>
      {width > 0 && (
        <svg className="dr-strip" width={width} height={H} viewBox={`0 0 ${width} ${H}`} role="img"
             aria-label={`${comps.length} sales with the ask marked`}>
          {/* axis */}
          <line x1={padL} y1={axisY} x2={width - padR} y2={axisY} stroke="var(--border)" strokeWidth={2} />
          {ticks.map(t => (
            <g key={t}>
              <line x1={x(t)} y1={axisY} x2={x(t)} y2={axisY + 4} stroke="var(--border)" strokeWidth={1} />
              <text x={x(t)} y={axisY + 16} textAnchor="middle" fill="var(--text-secondary)">${Math.round(t / 1000)}k</text>
            </g>
          ))}
          {/* quantile marks — positions only; the values sit in the row below the plot */}
          {quantiles?.map(q => (
            <g key={q.label}>
              <line x1={x(q.value)} y1={axisY - 10} x2={x(q.value)} y2={axisY} stroke="var(--text)" strokeWidth={q.label === 'median' ? 2 : 1} />
              <text className="lbl" x={x(q.value)} y={H - 4} textAnchor="middle" fill="var(--text)">{q.label === 'median' ? 'MED' : q.label.toUpperCase()}</text>
            </g>
          ))}
          {/* sales */}
          {comps.map(c => {
            const cy = dotTop + hash01(c.slug) * (dotBottom - dotTop);
            const unreadable = !c.text || !c.text.readable;
            const hollow = !!c.text?.rustMention;
            return (
              <a key={c.slug} href={c.url} target="_blank" rel="noreferrer">
                <circle cx={x(c.price)} cy={cy} r={3.5}
                  fill={hollow || unreadable ? 'var(--surface)' : 'var(--text-secondary)'}
                  stroke="var(--text-secondary)" strokeWidth={1.2}
                  strokeDasharray={unreadable ? '1.5 1.5' : undefined} />
                <title>{`${fmtMoney(c.price)} · ${c.date} · ${c.title}${c.mileage != null ? ` · ${fmtMiles(c.mileage)}` : ''} · ${textFlags(c)}`}</title>
              </a>
            );
          })}
          {/* the ask */}
          {ask != null && (
            <g>
              <line x1={x(ask)} y1={14} x2={x(ask)} y2={axisY} stroke="var(--text)" strokeWidth={2} />
              <text className="lbl" x={x(ask)} y={10} fill="var(--text)"
                    textAnchor={x(ask) > width * 0.8 ? 'end' : x(ask) < width * 0.2 ? 'start' : 'middle'}>
                ASK {fmtMoney(ask)}
              </text>
            </g>
          )}
        </svg>
      )}
    </div>
  );
}

// ─── Claims: what the listing says vs what sold ────────────────────────────

interface ClaimSpec {
  id: string;
  claim: string;
  reads: string;
  withLabel: string;
  withoutLabel: string;
  needsText: boolean;
  /** which comps carry the same feature the listing claims */
  isWith: (c: Comp) => boolean;
  isWithout: (c: Comp) => boolean;
}

function claimSpecs(subject: DealSubject, sd: Record<string, unknown>, subjectEngine: EngineClass): ClaimSpec[] {
  const specs: ClaimSpec[] = [];
  const str = (k: string): string | null => (typeof sd[k] === 'string' ? (sd[k] as string) : null);
  const readable = (c: Comp) => !!c.text?.readable;

  if (str('rust')) {
    specs.push({
      id: 'rust', claim: str('rust') as string, reads: 'write-up mentions rust / corrosion',
      withLabel: 'no rust mention', withoutLabel: 'mentions rust', needsText: true,
      isWith: c => readable(c) && !c.text!.rustMention, isWithout: c => readable(c) && c.text!.rustMention,
    });
  }
  if (sd.road_ready === false || str('runs')) {
    specs.push({
      id: 'running', claim: `not road-ready${str('runs') ? ` · runs ${str('runs')}` : ''}${str('suspected_fault') ? ` · ${str('suspected_fault')}` : ''}`,
      reads: 'write-up says project / non-running',
      withLabel: 'sold as project or non-running', withoutLabel: 'sold running', needsText: true,
      isWith: c => readable(c) && c.text!.project, isWithout: c => readable(c) && !c.text!.project,
    });
  }
  if (subject.mileage != null) {
    const bracket = mileageBracket(subject.mileage);
    specs.push({
      id: 'mileage', claim: `${fmtMiles(subject.mileage)}${str('mileage_claim') ? ` (${str('mileage_claim')})` : ''}`,
      reads: `odometer bracket ${bracket}`,
      withLabel: `${bracket} miles`, withoutLabel: 'other brackets', needsText: false,
      isWith: c => mileageBracket(c.mileage) === bracket, isWithout: c => c.mileage != null && mileageBracket(c.mileage) !== bracket,
    });
  }
  if (str('paint')) {
    specs.push({
      id: 'paint', claim: str('paint') as string, reads: 'write-up says repainted vs original / factory paint',
      withLabel: 'repainted', withoutLabel: 'original paint', needsText: true,
      isWith: c => readable(c) && c.text!.repaint, isWithout: c => readable(c) && c.text!.originalPaint,
    });
  }
  if (str('interior')) {
    specs.push({
      id: 'interior', claim: `${str('interior')} interior`, reads: 'write-up says original interior / upholstery',
      withLabel: 'original interior', withoutLabel: 'not stated', needsText: true,
      isWith: c => readable(c) && c.text!.originalInterior, isWithout: c => readable(c) && !c.text!.originalInterior,
    });
  }
  if (sd.factory_ac === true) {
    specs.push({
      id: 'ac', claim: 'factory A/C', reads: 'write-up mentions air conditioning',
      withLabel: 'with a/c', withoutLabel: 'no a/c mentioned', needsText: true,
      isWith: c => readable(c) && c.text!.ac, isWithout: c => readable(c) && !c.text!.ac,
    });
  }
  if (subjectEngine === 'four_2_0' || subjectEngine === 'four_1_7_1_8') {
    const other: EngineClass = subjectEngine === 'four_2_0' ? 'four_1_7_1_8' : 'four_2_0';
    specs.push({
      id: 'engine', claim: `${subject.engine_size || subject.engine_type || ENGINE_LABEL[subjectEngine]}${str('engine_bay') ? ` · ${str('engine_bay')}` : ''}`,
      reads: 'BaT spec line, stock four-cylinder lots',
      withLabel: ENGINE_LABEL[subjectEngine], withoutLabel: ENGINE_LABEL[other], needsText: false,
      isWith: c => c.engine === subjectEngine, isWithout: c => c.engine === other,
    });
  }
  if (str('title') || subject.title_status) {
    specs.push({
      id: 'title', claim: str('title') ?? `${subject.title_status} title`, reads: 'write-up says clean title vs salvage / bill of sale',
      withLabel: 'clean title stated', withoutLabel: 'title issue stated', needsText: true,
      isWith: c => readable(c) && c.text!.cleanTitle, isWithout: c => readable(c) && c.text!.titleIssue,
    });
  }
  return specs;
}

// ─── Page ──────────────────────────────────────────────────────────────────

export default function DealRead() {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const now = useMemo(() => new Date(), []);
  const data = useDealRead(vehicleId, now);
  const drills = useDrills();
  const { subject, observations, bounds, compSet } = data;

  const listingObs = useMemo(
    () => (observations ?? []).find(o => o.kind === 'listing') ?? null,
    [observations],
  );
  const sd = (listingObs?.structured_data ?? {}) as Record<string, unknown>;
  const ask = subject?.asking_price ?? (typeof sd.asking_price === 'number' ? (sd.asking_price as number) : null);
  const subjectEngine = classifyEngine(subject?.engine_size || subject?.engine_type, subject?.title_status ? '' : '');

  // the set the ask is placed on: same engine class when the ask records one, else every stock four
  const tight = useMemo(() => {
    if (!compSet) return [];
    return subjectEngine === 'four_2_0' || subjectEngine === 'four_1_7_1_8'
      ? compSet.comps.filter(c => c.engine === subjectEngine)
      : compSet.comps;
  }, [compSet, subjectEngine]);
  const tightLabel = subjectEngine === 'four_2_0' || subjectEngine === 'four_1_7_1_8'
    ? `stock ${ENGINE_LABEL[subjectEngine]}` : 'stock four-cylinder';
  const win = useMemo(() => windowComps(tight, WINDOW_MONTHS, now), [tight, now]);
  const win12 = useMemo(() => windowComps(tight, 12, now), [tight, now]);
  const stats = useMemo(() => summarize(win.map(c => c.price)), [win]);
  const gate = compSet?.gates;
  const figures = !!gate?.pass && win.length >= 5;
  const register = backtestFor(subject?.make, subject?.model);

  if (!vehicleId) return null;

  if (data.isLoading && !subject) {
    return (
      <div className="dr-page" aria-busy="true">
        <div className="dr-skeleton" /><div className="dr-skeleton" /><div className="dr-skeleton" />
      </div>
    );
  }
  if (data.error && !subject) {
    return (
      <div className="dr-page">
        <DarkBlock label="Deal read" meta="READ FAILED" reason={`The database read failed: ${data.error.message}`} />
      </div>
    );
  }
  if (!subject) {
    return (
      <div className="dr-page">
        <DarkBlock label="Deal read" reason={<>No vehicle row with id {vehicleId}. A deal read needs a listing landed through ingest. <Link className="dr-link" to="/search">Search</Link></>} />
      </div>
    );
  }

  const title = [subject.year, subject.make, subject.model, subject.trim].filter(Boolean).join(' ');
  const specLine = [
    subject.engine_size || subject.engine_type,
    subject.transmission?.toLowerCase(),
    subject.mileage != null ? `${fmtMiles(subject.mileage)}${typeof sd.mileage_claim === 'string' ? ' (TMU)' : ''}` : null,
    subject.color?.toLowerCase(),
    subject.location,
  ].filter(Boolean).join(' · ');
  const venue = (subject.listing_source || subject.source || 'listing').replace(/[_-]/g, ' ');
  const seenOn = (listingObs?.observed_at ?? subject.created_at ?? '').slice(0, 10);
  const listedDays = typeof sd.listed_for_approx_days === 'number' ? (sd.listed_for_approx_days as number) : null;

  const quantiles = figures
    ? [
      { label: 'p10', value: stats.p10 as number }, { label: 'p25', value: stats.p25 as number },
      { label: 'median', value: stats.p50 as number }, { label: 'p75', value: stats.p75 as number },
      { label: 'p90', value: stats.p90 as number },
    ]
    : null;
  const below = ask != null ? win.filter(c => c.price < ask) : [];
  const belowShare = ask != null ? shareBelow(win.map(c => c.price), ask) : null;
  const specs = claimSpecs(subject, sd, subjectEngine);
  const readableCount = win.filter(c => c.text?.readable).length;
  const exclusionsByReason = new Map<ExclusionReason, Exclusion[]>();
  for (const e of compSet?.excluded ?? []) exclusionsByReason.set(e.reason, [...(exclusionsByReason.get(e.reason) ?? []), e]);
  const older = tight.filter(c => !win.includes(c));
  const otherEngine = (compSet?.comps ?? []).filter(c => !tight.includes(c));

  return (
    <div className="dr-page">

      {/* ── Masthead: the subject and its ask, with the ask's source DNA behind it ── */}
      <div style={{ ...panelStyle, borderColor: 'var(--text)' }}>
        <div className="dr-masthead-row">
          <div style={{ minWidth: 0 }}>
            <div className="dr-label" style={{ marginBottom: '4px' }}>Deal read · marketplace ask vs BaT sales record</div>
            <div style={{ fontSize: 'var(--fs-11)', fontWeight: 800, lineHeight: 1.2 }}>{title}</div>
            <div className="dr-mono dr-muted" style={{ fontSize: 'var(--fs-9)', marginTop: '4px' }}>{specLine || 'no specs recorded'}</div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div className="dr-label">Ask</div>
            {ask != null ? (
              <div className="dr-mono" style={{ fontSize: 'var(--fs-11)', fontWeight: 800, lineHeight: 1.2 }}>
                <Drill id="ask" drills={drills}>{fmtMoney(ask)}</Drill>
              </div>
            ) : (
              <div className="dr-mono dr-muted" style={{ fontSize: 'var(--fs-10)' }}>no ask recorded</div>
            )}
            <div className="dr-mono dr-muted" style={{ fontSize: 'var(--fs-8)', marginTop: '4px' }}>
              {venue}{seenOn ? ` · read ${seenOn}` : ''}{listedDays != null ? ` · listed ~${Math.round(listedDays / 7)} wk` : ''}
            </div>
            <div className="dr-mono" style={{ fontSize: 'var(--fs-8)', marginTop: '4px', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              {subject.listing_url && <a className="dr-link" href={subject.listing_url} target="_blank" rel="noreferrer">listing↗</a>}
              <Link className="dr-link" to={`/vehicle/${subject.id}`}>nuke record→</Link>
            </div>
          </div>
        </div>
        <Expansion id="ask" drills={drills}>
          <div className="dr-label" style={{ marginBottom: '4px' }}>Where the ask comes from</div>
          <KeyValues entries={[
            ['vehicles.asking_price', `${fmtMoney(subject.asking_price)} · row ${shortId(subject.id)} · created ${(subject.created_at ?? '').slice(0, 19).replace('T', ' ')}`],
            ['vehicles.sale_price', subject.sale_price == null ? 'null — an ask is never a sale' : fmtMoney(subject.sale_price)],
            ['listing_url', subject.listing_url ? <a className="dr-link" href={subject.listing_url} target="_blank" rel="noreferrer">{subject.listing_url}</a> : 'n/a'],
            ['landed via', `ingest edge function (${venue})`],
          ]} />
          {(observations ?? []).length > 0 ? (
            <div style={{ marginTop: '8px' }}>
              <div className="dr-label" style={{ marginBottom: '4px' }}>Observations on this vehicle</div>
              <ObservationRows rows={observations ?? []} />
            </div>
          ) : (
            <div className="dr-mono dr-muted" style={{ fontSize: 'var(--fs-9)', marginTop: '8px' }}>no observations recorded</div>
          )}
        </Expansion>
        <div className="dr-status-line">
          <span>SUBJECT {shortId(subject.id)}{listingObs ? ` · LISTING OBSERVATION ${shortId(listingObs.id)}` : ''}</span>
          <span>{compSet ? `as of ${compSet.asOf.slice(0, 16).replace('T', ' ')}Z` : 'reading the sales record…'}</span>
        </div>
      </div>

      {/* ── The ask on the sales record ── */}
      {!bounds ? (
        <DarkBlock label="Ask on the sales record" reason={`No cohort bounds for ${subject.make} ${subject.model} in canonical_models — the model years that define this market are not registered yet.`} />
      ) : !compSet ? (
        <div style={panelStyle}><SectionHeader label="Ask on the sales record" meta="reading…" /><div className="dr-skeleton" style={{ border: 0 }} /></div>
      ) : win.length === 0 ? (
        <DarkBlock label="Ask on the sales record" reason={`No ${tightLabel} sale under the sold rule in the last ${WINDOW_MONTHS} months. ${compSet.gates.lotCount} lots read; see corpus integrity.`} />
      ) : (
        <div style={panelStyle}>
          <SectionHeader
            label="Ask on the sales record"
            meta={<>{tightLabel} · BaT · {bounds.year_start}–{bounds.year_end} · last {WINDOW_MONTHS} mo · <Drill id="win" drills={drills}>n={win.length}</Drill></>}
          />
          <StripPlot comps={win} ask={ask} quantiles={quantiles} />
          <div className="dr-mono dr-muted" style={{ fontSize: 'var(--fs-8)', marginTop: '4px', display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
            <span>● no rust mention</span><span>○ mentions rust</span><span>◌ write-up unreadable</span><span>| ask</span><span>each dot opens its BaT lot</span>
          </div>
          {figures ? (
            <div className="dr-mono" style={{ fontSize: 'var(--fs-9)', marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
              <Drill id="q-p10" drills={drills}>p10 {fmtMoney(stats.p10)}</Drill>
              <Drill id="q-p25" drills={drills}>p25 {fmtMoney(stats.p25)}</Drill>
              <Drill id="q-med" drills={drills} strong>median {fmtMoney(stats.p50)}</Drill>
              <Drill id="q-p75" drills={drills}>p75 {fmtMoney(stats.p75)}</Drill>
              <Drill id="q-p90" drills={drills}>p90 {fmtMoney(stats.p90)}</Drill>
              {ask != null && <Drill id="q-below" drills={drills} strong>below ask {fmtPct(belowShare, 1)} ({below.length} of {win.length})</Drill>}
              <Drill id="w12" drills={drills}>last 12 mo n={win12.length} · median {fmtMoney(median(win12.map(c => c.price)))}</Drill>
            </div>
          ) : (
            <div className="dr-mono" style={{ fontSize: 'var(--fs-9)', marginTop: '8px' }}>
              <span className="dr-strong">not priced yet</span>
              <span className="dr-muted"> · percentiles, median and share below ask withheld — </span>
              <Drill id="withheld" drills={drills}>{gate?.reasons.length ? gate.reasons.join('; ') : `${win.length} sales is under the 5-comp floor`}</Drill>
              <span className="dr-muted"> · the {win.length} dots are real sales; the set is not the whole market</span>
            </div>
          )}
          <Expansion id="withheld" drills={drills}>
            <div className="dr-mono dr-muted" style={{ fontSize: 'var(--fs-9)', lineHeight: 1.5, marginBottom: '8px', whiteSpace: 'normal' }}>
              The sold rule counts a lot only when a status says it sold. Prod's BaT rows are under correction (ISSUES 2026-09-25: no-sale bids stored as sale prices, sold lots never marked sold); until the unresolved share is under {fmtPct(gate?.maxUnresolvedShare ?? 0)} and the last 12 months hold {gate?.minLast12moSales ?? 0}+ dated sales, percentiles would describe Nuke's coverage, not the market. The lots below carry a price and no outcome:
            </div>
            <ExclusionRows rows={exclusionsByReason.get('unresolved') ?? []} />
          </Expansion>
          <Expansion id="win" drills={drills}><CompRows rows={win} ask={ask} /></Expansion>
          <Expansion id="q-p10" drills={drills}><div className="dr-label">at or below p10</div><CompRows rows={win.filter(c => c.price <= (stats.p10 ?? 0))} ask={ask} /></Expansion>
          <Expansion id="q-p25" drills={drills}><div className="dr-label">at or below p25</div><CompRows rows={win.filter(c => c.price <= (stats.p25 ?? 0))} ask={ask} /></Expansion>
          <Expansion id="q-med" drills={drills}><div className="dr-label">all {win.length} sales, median rows in bold</div><CompRows rows={[...win].sort((a, b) => a.price - b.price)} ask={ask} mark={c => c.price === stats.p50 || (win.length % 2 === 0 && [...win].sort((a, b) => a.price - b.price).slice(win.length / 2 - 1, win.length / 2 + 1).includes(c))} /></Expansion>
          <Expansion id="q-p75" drills={drills}><div className="dr-label">at or above p75</div><CompRows rows={win.filter(c => c.price >= (stats.p75 ?? Infinity))} ask={ask} /></Expansion>
          <Expansion id="q-p90" drills={drills}><div className="dr-label">at or above p90</div><CompRows rows={win.filter(c => c.price >= (stats.p90 ?? Infinity))} ask={ask} /></Expansion>
          <Expansion id="q-below" drills={drills}><div className="dr-label">sold below the ask</div><CompRows rows={below} ask={ask} /></Expansion>
          <Expansion id="w12" drills={drills}><div className="dr-label">last 12 months</div><CompRows rows={win12} ask={ask} /></Expansion>
        </div>
      )}

      {/* ── Claims vs the record ── */}
      {compSet && win.length > 0 && (
        <div style={panelStyle}>
          <SectionHeader
            label="What the listing claims vs what sold"
            meta={<>{tightLabel} · last {WINDOW_MONTHS} mo · write-ups readable {readableCount} of {win.length}{data.textLoaded ? '' : ' · reading…'}</>}
          />
          {specs.length === 0 ? (
            <div className="dr-mono dr-muted" style={{ fontSize: 'var(--fs-9)' }}>the listing observation carries no claims to test</div>
          ) : (
            <div className="dr-scroll">
              <table className="dr-table">
                <thead>
                  <tr><th>listing claims</th><th>read in the sales record as</th><th className="num">with</th><th className="num">median</th><th className="num">without</th><th className="num">median</th><th className="num">with vs without</th></tr>
                </thead>
                <tbody>
                  {specs.map(s => {
                    const pool = s.id === 'engine' ? windowComps(compSet.comps, WINDOW_MONTHS, now) : win;
                    const w = pool.filter(s.isWith), wo = pool.filter(s.isWithout);
                    const mw = median(w.map(c => c.price)), mwo = median(wo.map(c => c.price));
                    const show = figures && w.length >= 3 && wo.length >= 3;
                    return (
                      <tr key={s.id}>
                        <td className="wrap" style={{ fontFamily: 'var(--font-family)', maxWidth: '260px' }}>{s.claim}</td>
                        <td className="wrap" style={{ fontFamily: 'var(--font-family)' }}>{s.reads}</td>
                        <td className="num"><Drill id={`c-${s.id}-with`} drills={drills}>{w.length} {s.withLabel}</Drill></td>
                        <td className="num">{show ? fmtMoney(mw) : <span className="dr-muted">{figures ? 'thin' : 'withheld'}</span>}</td>
                        <td className="num"><Drill id={`c-${s.id}-without`} drills={drills}>{wo.length} {s.withoutLabel}</Drill></td>
                        <td className="num">{show ? fmtMoney(mwo) : <span className="dr-muted">{figures ? 'thin' : 'withheld'}</span>}</td>
                        <td className="num">{show ? <span className="dr-strong">{fmtDelta(mw, mwo)}</span> : <span className="dr-muted">n/a</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {specs.map(s => {
            const pool = s.id === 'engine' ? windowComps(compSet.comps, WINDOW_MONTHS, now) : win;
            return (
              <React.Fragment key={s.id}>
                <Expansion id={`c-${s.id}-with`} drills={drills}><div className="dr-label">{s.withLabel}</div><CompRows rows={pool.filter(s.isWith)} ask={ask} /></Expansion>
                <Expansion id={`c-${s.id}-without`} drills={drills}><div className="dr-label">{s.withoutLabel}</div><CompRows rows={pool.filter(s.isWithout)} ask={ask} /></Expansion>
              </React.Fragment>
            );
          })}
          <div className="dr-mono dr-muted" style={{ fontSize: 'var(--fs-8)', marginTop: '8px' }}>
            claims are the seller's statements as recorded in the listing observation, not inspection findings · text features are read from BaT write-ups held in Nuke; a truncated write-up reads as nothing
          </div>
        </div>
      )}

      {/* ── The sales counted ── */}
      {compSet && (
        <div style={panelStyle}>
          <SectionHeader
            label="Sales counted"
            meta={<>{win.length} rows · newest first{older.length ? <> · <Drill id="older" drills={drills}>{older.length} older</Drill></> : null}{otherEngine.length ? <> · <Drill id="other-engine" drills={drills}>{otherEngine.length} other stock engines</Drill></> : null}</>}
          />
          <CompRows rows={win} ask={ask} />
          <Expansion id="older" drills={drills}><div className="dr-label">before the {WINDOW_MONTHS}-month window</div><CompRows rows={older} ask={ask} /></Expansion>
          <Expansion id="other-engine" drills={drills}><div className="dr-label">stock four-cylinder sales of another displacement</div><CompRows rows={otherEngine} ask={ask} /></Expansion>
        </div>
      )}

      <div className="dr-grid-2">
        {/* ── The model's own error ── */}
        {register ? (
          <div style={panelStyle}>
            <SectionHeader label="Model error · band backtest" meta={`${register.meta.register.split(' ')[0]} · archive ${register.meta.archive_commit.split(' ')[0]}`} />
            <div className="dr-mono" style={{ fontSize: 'var(--fs-9)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div><Drill id="bt-all" drills={drills}>{register.meta.n} sales</Drill> <span className="dr-muted">{register.meta.first_sale} → {register.meta.last_sale}, each priced only from earlier sales</span></div>
              <div><Drill id="bt-in" drills={drills} strong>80% band caught {register.meta.caught_p10_p90_pct.toFixed(1)}%</Drill> <span className="dr-muted">of sales (target 80) · 50% band caught {register.meta.caught_p25_p75_pct.toFixed(1)}% (target 50)</span></div>
              <div><Drill id="bt-miss" drills={drills} strong>midpoint missed by a median {register.meta.median_miss_pct.toFixed(1)}%</Drill> <span className="dr-muted">· all cohorts 25.1% — this model's condition swings price more than its text shows</span></div>
            </div>
            <div className="dr-mono dr-muted" style={{ fontSize: 'var(--fs-8)', marginTop: '8px', lineHeight: 1.5 }}>
              {register.meta.source_file} → {register.meta.source_object.split(' (')[0]} · exported {register.meta.exported_at} · {register.meta.not_in_database}
            </div>
            <Expansion id="bt-all" drills={drills}><BacktestRows rows={register.rows} /></Expansion>
            <Expansion id="bt-in" drills={drills}><div className="dr-label">outside the 80% band</div><BacktestRows rows={register.rows.filter(r => !r.in_p10_p90)} /></Expansion>
            <Expansion id="bt-miss" drills={drills}><div className="dr-label">largest misses first</div><BacktestRows rows={[...register.rows].sort((a, b) => b.miss_pct - a.miss_pct)} /></Expansion>
          </div>
        ) : (
          <DarkBlock label="Model error · band backtest" reason={`No backtest register for ${subject.make} ${subject.model} yet. The band's error is measured per BaT cohort in scripts/bat-archive.sql.`} />
        )}

        {/* ── Corpus integrity: what was read, what was set aside, the gate ── */}
        {compSet && gate && (
          <div style={{ ...panelStyle, ...(gate.pass ? {} : { borderStyle: 'dashed' }) }}>
            <SectionHeader label="Corpus integrity" meta={gate.pass ? 'GATE PASS' : 'FIGURES WITHHELD'} />
            <KeyValues entries={[
              ['lots read', `${gate.lotCount} BaT lots, ${subject.make} ${bounds?.canonical_model ?? subject.model} ${bounds?.year_start}–${bounds?.year_end}`],
              ['sale records', `${gate.soldCount} under the sold rule (a status in vehicles or bat_listings; a price alone is never a sale)`],
              ['counted', `${compSet.comps.length} stock four-cylinder, dated, consistent across tables`],
              ['unresolved', <><Drill id="ex-unresolved" drills={drills}>{gate.unresolvedCount} lots ({fmtPct(gate.unresolvedShare)})</Drill> carry a price but no outcome · limit {fmtPct(gate.maxUnresolvedShare)}</>],
              ['freshness', `${gate.last12moSales} dated sales in the last 12 months · minimum ${gate.minLast12moSales}`],
              ['gate', gate.pass ? 'pass — market figures shown' : `withheld — ${gate.reasons.join('; ')}`],
            ]} />
            <Expansion id="ex-unresolved" drills={drills}><ExclusionRows rows={exclusionsByReason.get('unresolved') ?? []} /></Expansion>
            <div className="dr-label" style={{ margin: '8px 0 4px' }}>Set aside, by reason</div>
            <div className="dr-mono" style={{ fontSize: 'var(--fs-9)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {(Object.keys(REASON_LABEL) as ExclusionReason[]).filter(r => r !== 'unresolved' && (exclusionsByReason.get(r)?.length ?? 0) > 0).map(r => (
                <div key={r}>
                  <Drill id={`ex-${r}`} drills={drills}>{exclusionsByReason.get(r)!.length}</Drill> <span className="dr-muted">{REASON_LABEL[r]}</span>
                </div>
              ))}
            </div>
            {(Object.keys(REASON_LABEL) as ExclusionReason[]).filter(r => r !== 'unresolved').map(r => (
              <Expansion key={r} id={`ex-${r}`} drills={drills}><div className="dr-label">{REASON_LABEL[r]}</div><ExclusionRows rows={exclusionsByReason.get(r) ?? []} /></Expansion>
            ))}
            <div className="dr-mono dr-muted" style={{ fontSize: 'var(--fs-8)', marginTop: '8px', lineHeight: 1.5 }}>
              read: vehicles(sale_status, auction_outcome, sale_price, sale_date, engine_size, description) · bat_listings(listing_status, sale_price, sale_date) · canonical_models(year_start, year_end) · as of {compSet.asOf.slice(0, 16).replace('T', ' ')}Z
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ObservationRows({ rows }: { rows: DealObservation[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {rows.map(o => {
        const sd = (o.structured_data ?? {}) as Record<string, unknown>;
        const entries = Object.entries(sd).filter(([, v]) => v != null && typeof v !== 'object');
        return (
          <div key={o.id} style={{ borderTop: '1px solid var(--border)', paddingTop: '4px' }}>
            <div className="dr-mono" style={{ fontSize: 'var(--fs-9)' }}>
              <span className="dr-strong">{o.kind}</span>
              <span className="dr-muted"> · observed {o.observed_at.slice(0, 16).replace('T', ' ')}Z · {o.extraction_method ?? 'method not recorded'} · confidence {o.confidence ?? 'n/a'}{o.confidence_score != null ? ` (${o.confidence_score.toFixed(2)})` : ''} · </span>
              {o.source_url ? <a className="dr-link" href={o.source_url} target="_blank" rel="noreferrer">source↗</a> : <span className="dr-muted">no source url</span>}
              <span className="dr-muted"> · {shortId(o.id)}</span>
            </div>
            {entries.length > 0 && (
              <div style={{ marginTop: '4px' }}>
                <KeyValues entries={entries.map(([k, v]) => [k, String(v)] as [string, React.ReactNode])} />
              </div>
            )}
            {o.content_text && entries.length === 0 && (
              <div className="dr-mono" style={{ fontSize: 'var(--fs-9)', marginTop: '4px', whiteSpace: 'normal' }}>{o.content_text}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
