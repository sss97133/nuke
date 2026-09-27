import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { usePageTitle } from '../../hooks/usePageTitle';
import { squarify } from '../../lib/squarify';
import { NO_MAKE, useMarketPulse, type BoardReading, type LiveAuction, type SameHourRange } from './useMarketPulse';

// The homepage: the live collector-car market as Nuke sees it right now.
// Every figure is computed from the rows market_pulse_live() returns, and every
// row opens the vehicle's own record. Nothing here is estimated or smoothed.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type Window = 'all' | '1h' | '24h' | 'new' | 'nr';
type Sort = 'ending' | 'bid' | 'newest';

const WINDOWS: { id: Window; label: string }[] = [
  { id: 'all', label: 'Live auctions' },
  { id: '1h', label: 'Ending < 1 h' },
  { id: '24h', label: 'Ending < 24 h' },
  { id: 'new', label: 'First seen < 24 h' },
  { id: 'nr', label: 'No reserve' },
];

// The board opens on the money; the soonest endings have their own panel beside the map.
const SORTS: { id: Sort; label: string }[] = [
  { id: 'bid', label: 'Highest bid' },
  { id: 'ending', label: 'Ending first' },
  { id: 'newest', label: 'First seen' },
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

interface MakeNode {
  make: string;
  count: number;
  bids: number;
}

// Tile color is the make's change against the same time last week, only when that reading was
// recorded live (rebuilt readings have no per-make split). No reading, no color.
function changeTone(pct: number | null): { bg: string; fg: string } | null {
  if (pct == null || Math.abs(pct) < 2) return null;
  if (pct >= 10) return { bg: 'var(--success)', fg: 'var(--bg)' };
  if (pct > 0) return { bg: 'var(--success-dim)', fg: 'var(--text)' };
  if (pct <= -10) return { bg: 'var(--error)', fg: 'var(--bg)' };
  return { bg: 'var(--error-dim)', fg: 'var(--text)' };
}

function MarketMap({ auctions, selected, onSelect, weekAgo }: { auctions: LiveAuction[]; selected: string | null; onSelect: (make: string | null) => void; weekAgo: BoardReading | null }) {
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
      const n = by.get(a.make) ?? { make: a.make, count: 0, bids: 0 };
      n.count += 1;
      n.bids += a.currentBid ?? 0;
      by.set(a.make, n);
    }
    return [...by.values()];
  }, [auctions]);
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
            ? `${shown.make} · ${shown.count} live · ${usd(shown.bids)} bid · ${((shown.bids / total) * 100).toFixed(1)}% of all bids${makeChange(shown) != null ? ` · ${signed(makeChange(shown) as number)} vs last week` : ''}`
            : 'Current bids by make · area = dollars bid · hover or tap a make'}
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
        const tone = changeTone(makeChange(node));
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

function EndingNext({ auctions, risenIds, stale }: { auctions: LiveAuction[]; risenIds: Set<string>; stale: boolean }) {
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
              <BidCell auction={a} risen={risenIds.has(a.id)} stale={stale} />
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
const ROW_H_NARROW = 42;

function BoardRow({ a, risen, narrow, stale }: { a: LiveAuction; risen: boolean; narrow: boolean; stale: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px', height: narrow ? ROW_H_NARROW : ROW_H, boxSizing: 'border-box', borderBottom: '2px solid var(--border)', fontSize: 11 }}>
      <div style={{ width: narrow ? 64 : 84, flexShrink: 0 }}>
        <Countdown endsAt={a.endsAt} />
      </div>
      <Link to={`/vehicle/${a.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, textDecoration: 'none', color: 'var(--text)' }}>
        <Thumb src={a.imageUrl} size={narrow ? 44 : 60} />
        <span style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title(a)}</span>
      </Link>
      {a.noReserve && <span style={{ ...label, color: 'var(--text)', border: '2px solid var(--text)', padding: '0 3px', flexShrink: 0 }}>NR</span>}
      <div style={{ width: narrow ? 84 : 104, textAlign: 'right', flexShrink: 0 }}>
        <BidCell auction={a} risen={risen} stale={stale} />
      </div>
      {a.listingUrl && (
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
function Board({ rows, risenIds, narrow, stale }: { rows: LiveAuction[]; risenIds: Set<string>; narrow: boolean; stale: boolean }) {
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
            <BoardRow a={a} risen={risenIds.has(a.id)} narrow={narrow} stale={stale} />
          </div>
        );
      })}
    </div>
  );
}

function inWindow(a: LiveAuction, w: Window, now: number): boolean {
  switch (w) {
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

  const figures = useMemo(() => {
    const f: Record<Window, number> = { all: 0, '1h': 0, '24h': 0, new: 0, nr: 0 };
    for (const a of live) for (const w of WINDOWS) if (inWindow(a, w.id, now)) f[w.id] += 1;
    return f;
  }, [live, now]);
  const openBids = useMemo(() => live.reduce((s, a) => s + (a.currentBid ?? 0), 0), [live]);
  const syncBehind = data?.syncedAt != null && now - data.syncedAt > STALE_MS;

  const board = useMemo(() => {
    const rows = live.filter((a) => (make == null || a.make === make) && inWindow(a, win, now));
    if (sort === 'bid') rows.sort((a, b) => (b.currentBid ?? 0) - (a.currentBid ?? 0));
    else if (sort === 'newest') rows.sort((a, b) => b.listedAt - a.listedAt);
    return rows;
  }, [live, make, win, sort, now]);
  const boardBids = useMemo(() => board.reduce((s, a) => s + (a.currentBid ?? 0), 0), [board]);

  if (isError || (!isLoading && live.length === 0)) return <>{onUnavailable ?? null}</>;

  return (
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
      <div style={{ display: 'grid', gridTemplateColumns: narrow ? 'repeat(3, 1fr)' : 'repeat(6, 1fr)', border: '2px solid var(--border)', background: 'var(--border)', gap: 2, marginBottom: 12 }}>
        <Figure caption="Current bids" value={isLoading ? '…' : usd(openBids, true)} active={false} onClick={() => setParam('live', null)} hint="Sum of the current high bid on every live auction" />
        {WINDOWS.map((w) => (
          <Figure
            key={w.id}
            caption={w.label}
            hint={w.id === 'new' ? 'First seen by Nuke in the last 24 h; the live page is read every 15 min' : undefined}
            value={isLoading ? '…' : figures[w.id].toLocaleString('en-US')}
            active={win === w.id && w.id !== 'all'}
            onClick={() => setParam('live', w.id === 'all' || win === w.id ? null : w.id)}
          />
        ))}
      </div>

      {!isLoading && (data?.weekAgo || data?.sameHour) && (
        <Relativity value={openBids} weekAgo={data?.weekAgo ?? null} sameHour={data?.sameHour ?? null} />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : 'minmax(0, 3fr) minmax(260px, 1fr)', gap: 12, marginBottom: 12 }}>
        <section style={{ minWidth: 0 }}>
          <MarketMap auctions={live} selected={make} onSelect={(m) => setParam('make', m)} weekAgo={data?.weekAgo ?? null} />
        </section>
        <section style={{ border: '2px solid var(--border)', alignSelf: 'start', minWidth: 0 }}>
          <div style={{ ...label, padding: '6px 8px', borderBottom: '2px solid var(--border)' }}>Ending next</div>
          <EndingNext auctions={live.filter((a) => make == null || a.make === make)} risenIds={risenIds} stale={syncBehind} />
        </section>
      </div>

      <section ref={boardRef} style={{ border: '2px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, padding: '6px 8px', borderBottom: '2px solid var(--border)' }}>
          <span style={label}>
            {board.length.toLocaleString('en-US')} auctions · {usd(boardBids, true)} bid
            {make ? ` · ${make}` : ''}
            {win !== 'all' ? ` · ${WINDOWS.find((w) => w.id === win)?.label}` : ''}
          </span>
          <div style={{ display: 'flex', gap: 2 }}>
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
        {isLoading ? null : <Board rows={board} risenIds={risenIds} narrow={narrow} stale={syncBehind} />}
      </section>

      {data?.source && (
        <div style={{ ...label, marginTop: 8 }}>
          Source: {data.source}. Current bid = the highest bid on the listing when last read.
        </div>
      )}
    </div>
  );
}

function Figure({ caption, value, active, onClick, hint }: { caption: string; value: string; active: boolean; onClick: () => void; hint?: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      title={hint}
      style={{
        textAlign: 'left',
        padding: '8px 10px',
        border: 'none',
        background: active ? 'var(--text)' : 'var(--bg)',
        color: active ? 'var(--bg)' : 'var(--text)',
        cursor: 'pointer',
        transition: 'background 180ms cubic-bezier(0.16, 1, 0.3, 1), color 180ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      <div style={{ ...label, color: 'inherit', opacity: 0.8 }}>{caption}</div>
      <div style={{ ...mono, fontSize: 20, fontWeight: 700, marginTop: 2 }}>{value}</div>
    </button>
  );
}
