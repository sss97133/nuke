import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { usePageTitle } from '../../hooks/usePageTitle';
import { squarify } from '../../lib/squarify';
import { NO_MAKE, useMarketPulse, type BidCurve, type BoardReading, type LiveAuction, type SameHourRange } from './useMarketPulse';

// The homepage: the live collector-car market as Nuke sees it right now.
// Every figure is computed from the rows market_pulse_live() returns, and every
// row opens the vehicle's own record. Nothing here is estimated or smoothed.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type Window = 'all' | '1h' | '24h' | 'new' | 'nr' | 'hot' | 'cold';
type Sort = 'ending' | 'bid' | 'newest' | 'hottest' | 'coldest';

const WINDOWS: { id: Window; label: string }[] = [
  { id: 'all', label: 'Live auctions' },
  { id: '1h', label: 'Ending < 1 h' },
  { id: '24h', label: 'Ending < 24 h' },
  { id: 'new', label: 'First seen < 24 h' },
  { id: 'nr', label: 'No reserve' },
  { id: 'hot', label: 'Running hot' },
  { id: 'cold', label: 'Running cold' },
];

// The board opens on the money; the soonest endings have their own panel beside the map.
const SORTS: { id: Sort; label: string }[] = [
  { id: 'bid', label: 'Highest bid' },
  { id: 'ending', label: 'Ending first' },
  { id: 'newest', label: 'First seen' },
  { id: 'hottest', label: 'Hottest' },
  { id: 'coldest', label: 'Coldest' },
];

const label: React.CSSProperties = {
  fontFamily: 'Arial, sans-serif',
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--text-secondary)',
};

const mono: React.CSSProperties = { fontFamily: "'Courier New', monospace" };

function usd(n: number | null | undefined, compact = false): string {
  if (n == null) return '—';
  if (compact && Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (compact && Math.abs(n) >= 10_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

function left(ms: number): string {
  if (ms <= 0) return 'ENDED';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${String(sec).padStart(2, '0')}s`;
}

// In the viewer's own time zone.
function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}

function title(a: LiveAuction): string {
  return a.title ?? [a.year, a.make === NO_MAKE ? null : a.make, a.model].filter(Boolean).join(' ');
}

// A clock that ticks every second while the auction is in its last hour, every
// 30 s before that. The countdown is the only thing on the page that moves on its own.
function Countdown({ endsAt, strong }: { endsAt: number; strong?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  const remaining = endsAt - now;
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), remaining < HOUR ? 1000 : 30_000);
    return () => window.clearInterval(id);
  }, [remaining < HOUR]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <span style={{ ...mono, fontWeight: strong || remaining < HOUR ? 700 : 400, color: remaining < HOUR ? 'var(--text)' : 'var(--text-secondary)' }}>
      {left(remaining)}
    </span>
  );
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => setW(Math.floor(entries[0].contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function pctChange(now: number, before: number): number | null {
  return before > 0 ? ((now - before) / before) * 100 : null;
}

function signed(pct: number): string {
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

// Each earlier week at this weekday and hour is a tick; now is the block. The sentence ranks now among them.
function RangeBar({ value, range }: { value: number; range: SameHourRange }) {
  const lo = Math.min(range.low, value);
  const hi = Math.max(range.high, value);
  const span = hi - lo;
  const x = (v: number) => (span > 0 ? (v - lo) / span : 0.5);
  const beaten = range.readings.filter((r) => value > r.bids).length;
  const n = range.readings.length;
  const rank = n === 0 ? null : beaten === n ? `higher than all ${n}` : beaten === 0 ? `lower than all ${n}` : `higher than ${beaten} of ${n}`;
  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
      title={`Current bids at this hour (${range.hourUtc}:00 UTC) on ${range.weekdayUtc}s, ${range.weeks} weeks since ${range.firstDay}. Readings before 27 Sep are rebuilt from BaT bid history (96% of auctions) and may run up to ~4% low.`}
    >
      <span style={label}>Same time on {range.weekdayUtc}s · last {range.weeks} weeks</span>
      <span style={{ ...mono, fontSize: 11 }}>{usd(lo, true)}</span>
      <span style={{ position: 'relative', width: 160, height: 12 }}>
        <span style={{ position: 'absolute', top: 5, left: 0, right: 0, height: 2, background: 'var(--border)' }} />
        {range.readings.map((r) => (
          <span
            key={r.day}
            title={`${r.day}: ${usd(r.bids)}`}
            style={{ position: 'absolute', top: 2, left: `calc(${x(r.bids) * 100}% - 1px)`, width: 2, height: 8, background: 'var(--text-secondary)' }}
          />
        ))}
        <span title={`Now: ${usd(value)}`} style={{ position: 'absolute', top: 0, left: `calc(${x(value) * 100}% - 3px)`, width: 6, height: 12, background: 'var(--text)' }} />
      </span>
      <span style={{ ...mono, fontSize: 11 }}>{usd(hi, true)}</span>
      {rank && <span style={{ ...label, color: 'var(--text)' }}>{rank} {range.weekdayUtc}s at this hour</span>}
    </span>
  );
}

// What the headline is relative to: the same board a week ago, and its range at this time of the week.
function Relativity({ value, weekAgo, sameHour }: { value: number; weekAgo: BoardReading | null; sameHour: SameHourRange | null }) {
  const pct = weekAgo ? pctChange(value, weekAgo.bids) : null;
  const rebuilt = weekAgo?.source === 'archive';
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', alignItems: 'center', padding: '6px 10px', border: '2px solid var(--border)', borderTop: 'none', marginTop: -12, marginBottom: 12 }}>
      {weekAgo && pct != null ? (
        <span title={`${usd(weekAgo.bids)} across ${weekAgo.n.toLocaleString('en-US')} auctions at ${clock(weekAgo.at)} a week ago${rebuilt ? ' (rebuilt from BaT bid history, 96% of auctions)' : ''}`}>
          <span style={label}>vs same time last week </span>
          <span style={{ ...mono, fontWeight: 700, color: pct >= 0 ? 'var(--success)' : 'var(--error)' }}>{rebuilt ? '≈' : ''}{signed(pct)}</span>
          <span style={{ ...mono, fontSize: 11, color: 'var(--text-secondary)' }}> from {usd(weekAgo.bids, true)}</span>
        </span>
      ) : null}
      {sameHour && <RangeBar value={value} range={sameHour} />}
    </div>
  );
}

// ---- Hot / cold ----------------------------------------------------------------------------------
// heat = current bid / (band middle x the share of the final price comparable cars are usually bid to with
// this much time left). The band is the lot's expected-price range from comparable BaT sales on its model
// page, weighted toward its own version (scripts/market/live-bands.mjs, model version 31); the curve is
// measured on 36,700 sales (migration 20260927230000). Past 120 h the curve rests on thin, early data, so no verdict.
interface Heat { ratio: number; state: 'hot' | 'cold' | 'in line'; typicalNow: number; share: number; hoursLeft: number }
const HEAT_MAX_H = 120;
const HOT = 1.25;
const COLD = 0.8;

function curveAt(curve: BidCurve, tier: string, hours: number): number | null {
  const pts = curve[tier];
  if (!pts || pts.length === 0) return null;
  const h = Math.max(pts[pts.length - 1][0], Math.min(pts[0][0], hours));
  for (let i = 0; i < pts.length - 1; i++) {
    const [h1, v1] = pts[i];
    const [h2, v2] = pts[i + 1];
    if (h <= h1 && h >= h2) return v1 + ((v2 - v1) * (h1 - h)) / (h1 - h2);
  }
  return pts[pts.length - 1][1];
}

function heatOf(a: LiveAuction, curve: BidCurve | null, now: number): Heat | null {
  if (!curve || !a.band || !a.currentBid || a.currentBid <= 0) return null;
  const hoursLeft = (a.endsAt - now) / HOUR;
  if (hoursLeft <= 0 || hoursLeft > HEAT_MAX_H) return null;
  const share = curveAt(curve, a.band.tier, hoursLeft);
  if (!share) return null;
  const typicalNow = a.band.p50 * share;
  const ratio = a.currentBid / typicalNow;
  return { ratio, state: ratio >= HOT ? 'hot' : ratio <= COLD ? 'cold' : 'in line', typicalNow, share, hoursLeft };
}

// Backtest, 10,065 cars sold 2026-06-27..09-26, each priced only from sales before it: of the cars tagged hot at
// this much time left, the share that finished above the middle of their comparable sales; of those tagged cold,
// the share that finished below it. (In line: 46-49% above, i.e. no signal.)
const BACKTEST: [number, string, number, number][] = [
  [120, '5 days', 0.784, 0.781], [96, '4 days', 0.808, 0.797], [72, '3 days', 0.833, 0.809],
  [48, '2 days', 0.855, 0.829], [24, 'a day', 0.884, 0.85], [12, '12 hours', 0.915, 0.876],
];

// Three significant figures: "about $166,000", not "$166,323".
function about(n: number): number {
  const step = 10 ** Math.max(0, Math.floor(Math.log10(Math.max(n, 1))) - 2);
  return Math.round(n / step) * step;
}

// Past 3x the multiple mostly says the comps don't describe the car (backtest: 77% of those sold above 90% of their
// comps), so it is shown as 3x+ rather than as a precise number.
function multiple(ratio: number): string {
  return ratio >= 3 ? '3×+' : ratio < 0.1 ? '<0.1×' : `${ratio.toFixed(1)}×`;
}

function heatParts(a: LiveAuction, heat: Heat) {
  const band = a.band as NonNullable<LiveAuction['band']>;
  // Quote the checkpoint at or before this point in the auction (17 h left reads the 24 h record, not the 12 h one).
  const [, when, hotAbove, coldBelow] = [...BACKTEST].reverse().find((row) => row[0] >= heat.hoursLeft) ?? BACKTEST[BACKTEST.length - 1];
  return {
    bid: usd(a.currentBid),
    left: left(heat.hoursLeft * HOUR),
    comps: band.comps,
    middle: usd(band.p50),
    range: `${usd(band.p10)}–${usd(band.p90)}`,
    share: Math.round(heat.share * 100),
    typical: usd(about(heat.typicalNow)),
    multiple: multiple(heat.ratio),
    beyond: (a.currentBid ?? 0) > band.p90
      ? 'The bid already tops 90% of those sales: this car is bringing more than its model page usually does (a rarer version, very low miles, or prices that have risen since), so the multiple says "beyond its comps", not how far.'
      : null,
    outcome: heat.state === 'hot'
      ? `Of sold cars running this hot ${when} out, ${Math.round(hotAbove * 100)}% finished above the middle of their comparable sales.`
      : heat.state === 'cold'
        ? `Of sold cars running this cold ${when} out, ${Math.round(coldBelow * 100)}% finished below the middle of their comparable sales.`
        : null,
  };
}

function explainHeat(a: LiveAuction, heat: Heat): string {
  const x = heatParts(a, heat);
  return `Bid ${x.bid} with ${x.left} left. ${x.comps} comparable BaT sales (same model page, weighted toward the same version, year, mileage and gearbox) put the middle at ${x.middle}, 80% range ${x.range}. With this much time left, cars at this price are usually bid to about ${x.share}% of their final, so a typical bid now is about ${x.typical}; this one is at ${x.multiple} that.${x.beyond ? ` ${x.beyond}` : ''}${x.outcome ? ` ${x.outcome}` : ''}`;
}

// A phone has no hover, so a tag is also a button: tapping it opens the reasoning (ExplainSheet). The title
// attribute stays for mouse users. Tags sit inside row links, so the tap must not open the car.
const ExplainContext = createContext<((a: LiveAuction, heat: Heat) => void) | null>(null);

function HeatTag({ a, heat }: { a: LiveAuction; heat: Heat | null | undefined }) {
  const explain = useContext(ExplainContext);
  if (!heat || heat.state === 'in line') return null;
  const hot = heat.state === 'hot';
  const text = `${hot ? 'Hot' : 'Cold'} ${multiple(heat.ratio)}`;
  const open = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    explain?.(a, heat);
  };
  return (
    <span
      title={explainHeat(a, heat)}
      role={explain ? 'button' : undefined}
      tabIndex={explain ? 0 : undefined}
      aria-label={explain ? `${text}: why` : undefined}
      onClick={explain ? open : undefined}
      onKeyDown={explain ? (e) => { if (e.key === 'Enter' || e.key === ' ') open(e); } : undefined}
      style={{ ...label, color: 'var(--bg)', background: hot ? 'var(--success)' : 'var(--error)', padding: '1px 4px', flexShrink: 0, whiteSpace: 'nowrap', cursor: explain ? 'pointer' : undefined }}
    >
      {text}
    </span>
  );
}

// The reasoning behind one tag, opened by tapping it: bottom sheet on a phone, a panel bottom-right on desktop.
function ExplainSheet({ item, onClose, narrow }: { item: { a: LiveAuction; heat: Heat } | null; onClose: () => void; narrow: boolean }) {
  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, onClose]);
  if (!item) return null;
  const { a, heat } = item;
  const x = heatParts(a, heat);
  const hot = heat.state === 'hot';
  const rows: [string, string][] = [
    ['Current bid', `${x.bid} · ${x.left} left`],
    ['Comparable sales', `${x.comps} on its BaT model page, weighted toward the same version, year, mileage and gearbox`],
    ['Their middle', `${x.middle} (80% range ${x.range})`],
    ['Typical bid now', `about ${x.typical}: with this much time left, cars at this price are usually bid to about ${x.share}% of their final`],
    ['This bid', `${x.multiple} typical`],
  ];
  return (
    <div
      role="dialog"
      aria-label={`Why ${title(a)} is running ${heat.state}`}
      style={{
        position: 'fixed', zIndex: 2000, bottom: narrow ? 0 : 16, left: narrow ? 0 : 'auto', right: narrow ? 0 : 16,
        width: narrow ? 'auto' : 440, maxHeight: '70vh', overflowY: 'auto', boxSizing: 'border-box',
        background: 'var(--surface)', color: 'var(--text)', border: '2px solid var(--text)', padding: 12, fontSize: 12, fontFamily: 'Arial, sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{title(a)}</div>
          <span style={{ ...label, color: 'var(--bg)', background: hot ? 'var(--success)' : 'var(--error)', padding: '1px 4px' }}>
            {hot ? 'Running hot' : 'Running cold'} · {x.multiple}
          </span>
        </div>
        <button onClick={onClose} aria-label="Close" style={{ ...label, color: 'var(--text)', background: 'transparent', border: '2px solid var(--text)', padding: '2px 8px', cursor: 'pointer' }}>
          Close
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 10, rowGap: 6 }}>
        {rows.map(([k, v]) => (
          <React.Fragment key={k}>
            <span style={{ ...label, paddingTop: 1 }}>{k}</span>
            <span>{v}</span>
          </React.Fragment>
        ))}
      </div>
      {x.beyond && <p style={{ margin: '10px 0 0' }}>{x.beyond}</p>}
      {x.outcome && <p style={{ margin: '10px 0 0' }}><span style={label}>Track record</span> {x.outcome}</p>}
      <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
        <Link to={`/vehicle/${a.id}`} style={{ ...label, color: 'var(--text)' }}>Open the car</Link>
        {a.listingUrl && (
          <a href={a.listingUrl} target="_blank" rel="noopener noreferrer" style={{ ...label, color: 'var(--text-secondary)' }}>BaT listing ↗</a>
        )}
      </div>
    </div>
  );
}

// A make's color is the median heat of its priced live lots (3 or more); grey when unpriced or in line.
function heatTone(median: number | null): { bg: string; fg: string } | null {
  if (median == null) return null;
  if (median >= 1.3) return { bg: 'var(--success)', fg: 'var(--bg)' };
  if (median >= 1.1) return { bg: 'var(--success-dim)', fg: 'var(--text)' };
  if (median <= 0.77) return { bg: 'var(--error)', fg: 'var(--bg)' };
  if (median <= 0.9) return { bg: 'var(--error-dim)', fg: 'var(--text)' };
  return null;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

interface MakeNode {
  make: string;
  count: number;
  bids: number;
  heats: number[];
}

function MarketMap({ auctions, selected, onSelect, weekAgo, heat }: { auctions: LiveAuction[]; selected: string | null; onSelect: (make: string | null) => void; weekAgo: BoardReading | null; heat: Map<string, Heat | null> }) {
  const byMakeBefore = weekAgo?.source === 'live' ? weekAgo.byMake : null;
  const makeChange = (m: MakeNode) => {
    const before = byMakeBefore?.[m.make]?.[0];
    return before != null ? pctChange(m.bids, before) : null;
  };
  const [ref, width] = useWidth<HTMLDivElement>();
  const height = width < 640 ? 240 : 380;
  const makes = useMemo(() => {
    const by = new Map<string, MakeNode>();
    for (const a of auctions) {
      const n = by.get(a.make) ?? { make: a.make, count: 0, bids: 0, heats: [] };
      n.count += 1;
      n.bids += a.currentBid ?? 0;
      const h = heat.get(a.id);
      if (h) n.heats.push(h.ratio);
      by.set(a.make, n);
    }
    return [...by.values()];
  }, [auctions, heat]);
  const makeHeat = (m: MakeNode) => (m.heats.length >= 3 ? median(m.heats) : null);
  const rects = useMemo(
    () => (width > 0 ? squarify(makes.filter((m) => m.bids > 0).map((m) => ({ node: m, area: m.bids })), 0, 0, width, height) : []),
    [makes, width, height]
  );
  const total = makes.reduce((s, m) => s + m.bids, 0);
  const [hovered, setHovered] = useState<string | null>(null);
  const shown = makes.find((m) => m.make === (hovered ?? selected));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4, minHeight: 12 }}>
        <span style={{ ...label, color: shown ? 'var(--text)' : 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {shown
            ? `${shown.make} · ${shown.count} live · ${usd(shown.bids)} bid · ${((shown.bids / total) * 100).toFixed(1)}% of all bids${makeHeat(shown) != null ? ` · bids ${(makeHeat(shown) as number).toFixed(2)}× typical (median of ${shown.heats.length} priced)` : ''}${makeChange(shown) != null ? ` · ${signed(makeChange(shown) as number)} vs last week` : ''}`
            : 'Current bids by make · area = dollars bid · color = bids vs comparable sales at this point (green hot, red cold) · hover or tap a make'}
        </span>
        {selected && (
          <button onClick={() => onSelect(null)} style={{ ...label, color: 'var(--text)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0 }}>
            {selected} ✕
          </button>
        )}
      </div>
    <div ref={ref} style={{ position: 'relative', height, background: 'var(--border)' }} onMouseLeave={() => setHovered(null)}>
      {rects.map(({ node, x, y, w, h }) => {
        const active = selected === node.make;
        const dim = selected != null && !active;
        const roomy = w > 64 && h > 34;
        const tone = heatTone(makeHeat(node));
        return (
          <button
            key={node.make}
            onClick={() => onSelect(active ? null : node.make)}
            onMouseEnter={() => setHovered(node.make)}
            onFocus={() => setHovered(node.make)}
            aria-pressed={active}
            aria-label={`${node.make}: ${node.count} live, ${usd(node.bids)} bid`}
            style={{
              position: 'absolute',
              left: x + 1,
              top: y + 1,
              width: Math.max(0, w - 2),
              height: Math.max(0, h - 2),
              padding: roomy ? '5px 6px' : 0,
              border: 'none',
              background: active ? 'var(--text)' : tone?.bg ?? 'var(--surface)',
              color: active ? 'var(--bg)' : tone?.fg ?? 'var(--text)',
              opacity: dim ? 0.45 : 1,
              cursor: 'pointer',
              textAlign: 'left',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              transition: 'opacity 180ms cubic-bezier(0.16, 1, 0.3, 1), background 180ms cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            {roomy && (
              <>
                <span style={{ ...label, color: 'inherit', fontSize: w > 140 ? 10 : 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
                  {node.make}
                </span>
                <span style={{ ...mono, fontSize: w > 140 ? 13 : 10, whiteSpace: 'nowrap' }}>
                  {usd(node.bids, true)} <span style={{ opacity: 0.7 }}>· {node.count}</span>
                </span>
              </>
            )}
          </button>
        );
      })}
    </div>
    </div>
  );
}

function Thumb({ src, size }: { src: string | null; size: number }) {
  const h = Math.round(size * 0.67);
  if (!src) return <div style={{ width: size, height: h, background: 'var(--surface)', flexShrink: 0 }} />;
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={h}
      loading="lazy"
      decoding="async"
      style={{ width: size, height: h, objectFit: 'cover', flexShrink: 0, background: 'var(--surface)' }}
    />
  );
}

// The sync writes a row only when its bid changes, so a row's own time is when its bid last
// changed, not when it was last read. Freshness is the sync's: if nothing has been written for
// 45 minutes (three missed syncs), every bid on the page is shown grey as possibly behind.
const STALE_MS = 45 * 60_000;

function BidCell({ auction, risen, stale }: { auction: LiveAuction; risen: boolean; stale: boolean }) {
  return (
    <span
      title={`${stale ? 'The live sync is behind; this is the last bid Nuke read. ' : ''}Bid last changed ${clock(auction.updatedAt)}`}
      style={{
        ...mono,
        fontWeight: 700,
        padding: '1px 3px',
        background: risen ? 'var(--success)' : 'transparent',
        color: risen ? 'var(--bg)' : stale ? 'var(--text-disabled)' : 'var(--text)',
        transition: 'background 180ms cubic-bezier(0.16, 1, 0.3, 1), color 180ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {usd(auction.currentBid)}
    </span>
  );
}

function EndingNext({ auctions, risenIds, stale, heat }: { auctions: LiveAuction[]; risenIds: Set<string>; stale: boolean; heat: Map<string, Heat | null> }) {
  const next = auctions.slice(0, 8);
  if (next.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {next.map((a) => (
        <Link
          key={a.id}
          to={`/vehicle/${a.id}`}
          style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 8px', borderBottom: '2px solid var(--border)', textDecoration: 'none', color: 'var(--text)' }}
        >
          <Thumb src={a.imageUrl} size={54} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title(a)}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontSize: 11, marginTop: 2 }}>
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <BidCell auction={a} risen={risenIds.has(a.id)} stale={stale} />
                <HeatTag a={a} heat={heat.get(a.id)} />
              </span>
              <Countdown endsAt={a.endsAt} strong />
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

// Fixed row heights so the board can render only the rows on screen.
const ROW_H = 52;
const ROW_H_NARROW = 50;

function BoardRow({ a, risen, narrow, stale, heat }: { a: LiveAuction; risen: boolean; narrow: boolean; stale: boolean; heat: Heat | null | undefined }) {
  const nr = a.noReserve && <span style={{ ...label, color: 'var(--text)', border: '2px solid var(--text)', padding: '0 3px', flexShrink: 0 }}>NR</span>;
  const tagged = (heat != null && heat.state !== 'in line') || a.noReserve;
  const name = <span style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title(a)}</span>;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: narrow ? 8 : 10, padding: '0 8px', height: narrow ? ROW_H_NARROW : ROW_H, boxSizing: 'border-box', borderBottom: '2px solid var(--border)', fontSize: 11 }}>
      <div style={{ width: narrow ? 58 : 84, flexShrink: 0 }}>
        <Countdown endsAt={a.endsAt} />
      </div>
      <Link to={`/vehicle/${a.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, textDecoration: 'none', color: 'var(--text)' }}>
        <Thumb src={a.imageUrl} size={narrow ? 40 : 60} />
        {narrow ? (
          // A phone has no room for tags beside the title: they go under it.
          <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            {name}
            {tagged && <span style={{ display: 'flex', gap: 4 }}><HeatTag a={a} heat={heat} />{nr}</span>}
          </span>
        ) : name}
      </Link>
      {!narrow && <HeatTag a={a} heat={heat} />}
      {!narrow && nr}
      <div style={{ width: narrow ? 76 : 104, textAlign: 'right', flexShrink: 0 }}>
        <BidCell auction={a} risen={risen} stale={stale} />
      </div>
      {!narrow && a.listingUrl && (
        <a
          href={a.listingUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="The listing on Bring a Trailer"
          style={{ ...label, color: 'var(--text-secondary)', textDecoration: 'none', flexShrink: 0 }}
        >
          BAT ↗
        </a>
      )}
    </div>
  );
}

// Every row stays reachable by scrolling; only the ones near the viewport are in the DOM.
function Board({ rows, risenIds, narrow, stale, heat }: { rows: LiveAuction[]; risenIds: Set<string>; narrow: boolean; stale: boolean; heat: Map<string, Heat | null> }) {
  const listRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  useLayoutEffect(() => {
    const measure = () => {
      if (listRef.current) setOffset(listRef.current.getBoundingClientRect().top + window.scrollY);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, []);
  const rowH = narrow ? ROW_H_NARROW : ROW_H;
  const v = useWindowVirtualizer({ count: rows.length, estimateSize: () => rowH, overscan: 12, scrollMargin: offset });
  return (
    <div ref={listRef} style={{ height: v.getTotalSize(), position: 'relative' }}>
      {v.getVirtualItems().map((item) => {
        const a = rows[item.index];
        return (
          <div key={a.id} style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${item.start - offset}px)` }}>
            <BoardRow a={a} risen={risenIds.has(a.id)} narrow={narrow} stale={stale} heat={heat.get(a.id)} />
          </div>
        );
      })}
    </div>
  );
}

function inWindow(a: LiveAuction, w: Window, now: number, heat?: Heat | null): boolean {
  switch (w) {
    case 'hot': return heat?.state === 'hot';
    case 'cold': return heat?.state === 'cold';
    case '1h': return a.endsAt - now < HOUR;
    case '24h': return a.endsAt - now < DAY;
    case 'new': return now - a.listedAt < DAY;
    case 'nr': return a.noReserve;
    default: return true;
  }
}

export default function MarketPulse({ onUnavailable }: { onUnavailable?: React.ReactNode }) {
  usePageTitle('Market');
  const { data, isLoading, isError, risenIds } = useMarketPulse();
  const [params, setParams] = useSearchParams();
  const [boardRef, boardWidth] = useWidth<HTMLDivElement>();
  const narrow = boardWidth > 0 && boardWidth < 640;
  const [explaining, setExplaining] = useState<{ a: LiveAuction; heat: Heat } | null>(null);
  const openExplain = useCallback((a: LiveAuction, heat: Heat) => setExplaining({ a, heat }), []);
  const closeExplain = useCallback(() => setExplaining(null), []);

  const make = params.get('make')?.toUpperCase() ?? null;
  const win = (WINDOWS.some((w) => w.id === params.get('live')) ? params.get('live') : 'all') as Window;
  const sort = (SORTS.some((s) => s.id === params.get('sort')) ? params.get('sort') : 'bid') as Sort;

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value == null) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  // Figures and filters are evaluated against the clock once a minute; the countdowns tick on their own.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const live = useMemo(() => (data?.auctions ?? []).filter((a) => a.endsAt > now), [data, now]);
  const heat = useMemo(() => new Map(live.map((a) => [a.id, heatOf(a, data?.curve ?? null, now)])), [live, data, now]);

  const figures = useMemo(() => {
    const f: Record<Window, number> = { all: 0, '1h': 0, '24h': 0, new: 0, nr: 0, hot: 0, cold: 0 };
    for (const a of live) for (const w of WINDOWS) if (inWindow(a, w.id, now, heat.get(a.id))) f[w.id] += 1;
    return f;
  }, [live, now, heat]);
  const openBids = useMemo(() => live.reduce((s, a) => s + (a.currentBid ?? 0), 0), [live]);
  const syncBehind = data?.syncedAt != null && now - data.syncedAt > STALE_MS;

  const board = useMemo(() => {
    const rows = live.filter((a) => (make == null || a.make === make) && inWindow(a, win, now, heat.get(a.id)));
    const ratio = (a: LiveAuction) => heat.get(a.id)?.ratio ?? null;
    if (sort === 'bid') rows.sort((a, b) => (b.currentBid ?? 0) - (a.currentBid ?? 0));
    else if (sort === 'newest') rows.sort((a, b) => b.listedAt - a.listedAt);
    else if (sort === 'hottest') rows.sort((a, b) => (ratio(b) ?? -1) - (ratio(a) ?? -1));
    else if (sort === 'coldest') rows.sort((a, b) => (ratio(a) ?? Infinity) - (ratio(b) ?? Infinity));
    return rows;
  }, [live, make, win, sort, now, heat]);
  const boardBids = useMemo(() => board.reduce((s, a) => s + (a.currentBid ?? 0), 0), [board]);

  if (isError || (!isLoading && live.length === 0)) return <>{onUnavailable ?? null}</>;

  return (
    <ExplainContext.Provider value={openExplain}>
    <div style={{ fontFamily: 'Arial, sans-serif', color: 'var(--text)', background: 'var(--bg)', padding: '12px 12px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.14em' }}>MARKET</span>
          <span style={label}>Live auctions · Bring a Trailer</span>
        </div>
        {data?.syncedAt != null && (
          <span style={label} title={data.source}>
            Last change seen {clock(data.syncedAt)} · {syncBehind ? 'live sync is behind' : 'board read every 15 min'}
          </span>
        )}
      </div>

      {/* Figures. Each one is a filter on the board below. */}
      <div style={{ display: 'grid', gridTemplateColumns: narrow ? 'repeat(4, 1fr)' : 'repeat(8, 1fr)', border: '2px solid var(--border)', background: 'var(--border)', gap: 2, marginBottom: 12 }}>
        <Figure caption="Current bids" value={isLoading ? '…' : usd(openBids, true)} active={false} onClick={() => setParam('live', null)} hint="Sum of the current high bid on every live auction" compact={narrow} />
        {WINDOWS.map((w) => (
          <Figure
            key={w.id}
            caption={w.label}
            hint={w.id === 'new' ? 'First seen by Nuke in the last 24 h; the live page is read every 15 min'
              : w.id === 'hot' ? `Bid at least ${HOT}x where comparable sales usually are at this point in the auction (within 5 days of the close)`
              : w.id === 'cold' ? `Bid at most ${COLD}x where comparable sales usually are at this point in the auction (within 5 days of the close)`
              : undefined}
            value={isLoading ? '…' : figures[w.id].toLocaleString('en-US')}
            active={win === w.id && w.id !== 'all'}
            onClick={() => setParam('live', w.id === 'all' || win === w.id ? null : w.id)}
            compact={narrow}
          />
        ))}
      </div>

      {!isLoading && (data?.weekAgo || data?.sameHour) && (
        <Relativity value={openBids} weekAgo={data?.weekAgo ?? null} sameHour={data?.sameHour ?? null} />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : 'minmax(0, 3fr) minmax(260px, 1fr)', gap: 12, marginBottom: 12 }}>
        <section style={{ minWidth: 0 }}>
          <MarketMap auctions={live} selected={make} onSelect={(m) => setParam('make', m)} weekAgo={data?.weekAgo ?? null} heat={heat} />
        </section>
        <section style={{ border: '2px solid var(--border)', alignSelf: 'start', minWidth: 0 }}>
          <div style={{ ...label, padding: '6px 8px', borderBottom: '2px solid var(--border)' }}>Ending next</div>
          <EndingNext auctions={live.filter((a) => make == null || a.make === make)} risenIds={risenIds} stale={syncBehind} heat={heat} />
        </section>
      </div>

      <section ref={boardRef} style={{ border: '2px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, padding: '6px 8px', borderBottom: '2px solid var(--border)' }}>
          <span style={label}>
            {board.length.toLocaleString('en-US')} auctions · {usd(boardBids, true)} bid
            {make ? ` · ${make}` : ''}
            {win !== 'all' ? ` · ${WINDOWS.find((w) => w.id === win)?.label}` : ''}
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
            {SORTS.map((s) => (
              <button
                key={s.id}
                onClick={() => setParam('sort', s.id === 'bid' ? null : s.id)}
                aria-pressed={sort === s.id}
                style={{
                  ...label,
                  color: sort === s.id ? 'var(--bg)' : 'var(--text)',
                  background: sort === s.id ? 'var(--text)' : 'transparent',
                  border: '2px solid var(--text)',
                  padding: '2px 6px',
                  cursor: 'pointer',
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        {isLoading ? null : <Board rows={board} risenIds={risenIds} narrow={narrow} stale={syncBehind} heat={heat} />}
      </section>

      {data?.source && (
        <div style={{ ...label, marginTop: 8 }}>
          Source: {data.source}. Current bid = the highest bid on the listing when last read. Hot/cold compares it with where comparable BaT sales on the same model page are usually bid at the same point in the auction; tap a tag for the numbers.
        </div>
      )}
      <ExplainSheet item={explaining} onClose={closeExplain} narrow={narrow} />
    </div>
    </ExplainContext.Provider>
  );
}

function Figure({ caption, value, active, onClick, hint, compact }: { caption: string; value: string; active: boolean; onClick: () => void; hint?: string; compact?: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      title={hint}
      style={{
        textAlign: 'left',
        padding: compact ? '6px 6px' : '8px 10px',
        border: 'none',
        background: active ? 'var(--text)' : 'var(--bg)',
        color: active ? 'var(--bg)' : 'var(--text)',
        cursor: 'pointer',
        transition: 'background 180ms cubic-bezier(0.16, 1, 0.3, 1), color 180ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      <div style={{ ...label, color: 'inherit', opacity: 0.8 }}>{caption}</div>
      <div style={{ ...mono, fontSize: compact ? 17 : 20, fontWeight: 700, marginTop: 2 }}>{value}</div>
    </button>
  );
}
