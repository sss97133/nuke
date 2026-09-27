/**
 * AuctionSequenceBand — a BaT auction's week, as it happened, inside the
 * timeline: the listing opens, every bid steps the high bid up at its time,
 * every comment lands at its time (the seller's marked), the auction closes
 * with its result, and post-close comments trail off to the right.
 *
 * Every mark is a link to its comment on BaT; every day opens the day drawer.
 * Colour carries nothing here — the sequence is the information. Design per
 * .claude/rules/frontend.md (Arial labels 8–9px, Courier data, 1–2px rules).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { fmtClock, fmtDayShort, fmtMoment, fmtUsd, localDate, type AuctionItem, type AuctionSequence } from './auctionSequence';

interface Props {
  auction: AuctionSequence;
  activeDay: string | null;
  onOpenDay: (date: string) => void;
}

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

const OUTCOME_LABEL: Record<AuctionSequence['outcome'], string> = {
  sold: 'SOLD',
  reserve_not_met: 'RESERVE NOT MET',
  no_sale: 'NOT SOLD',
  withdrawn: 'WITHDRAWN',
  live: 'LIVE',
  unknown: 'RESULT NOT RECORDED',
};

const mono: React.CSSProperties = { fontFamily: 'var(--vp-font-mono)' };

const LABEL_FONT_PX = 8;
const LABEL_GAP_PX = 6;

/** Rendered width of a day label, measured in the band's own mono font (canvas), not assumed. */
function makeLabelMeasurer(host: HTMLElement | null): (text: string) => number {
  const family = (host ? getComputedStyle(host).getPropertyValue('--vp-font-mono') : '').trim() || "'Courier New', monospace";
  const ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  if (!ctx) return text => text.length * LABEL_FONT_PX * 0.6; // Courier New advances 0.6 em
  ctx.font = `${LABEL_FONT_PX}px ${family}`;
  return text => ctx.measureText(text).width;
}

function itemTitle(i: AuctionItem): string {
  const when = `${fmtDayShort(i.at)} ${fmtClock(i.at)}`;
  if (i.kind === 'bid') return `${fmtUsd(i.amount)} · ${i.author} · ${when}`;
  const text = i.text.length > 120 ? `${i.text.slice(0, 117)}…` : i.text;
  return `${i.author}${i.kind === 'seller' ? ' (seller)' : ''} · ${when}${text ? ` · ${text}` : ''}`;
}

const AuctionSequenceBand: React.FC<Props> = ({ auction, activeDay, onOpenDay }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const width = useWidth(ref);
  const { items, open, close } = auction;

  const geom = useMemo(() => {
    const times = items.map(i => new Date(i.at).getTime());
    const openT = open ? new Date(open.at).getTime() : (times.length ? Math.min(...times) : null);
    const closeT = close ? new Date(close.at).getTime() : null;
    if (openT == null) return null;
    const lastT = times.length ? Math.max(...times) : openT;
    const t0 = Math.min(openT, ...(times.length ? [times[0]] : []));
    let t1 = Math.max(lastT, closeT ?? lastT);
    if (t1 - t0 < 3600e3) t1 = t0 + 24 * 3600e3;
    t1 += (t1 - t0) * 0.03;
    // local midnights inside the window
    const days: { start: number; end: number; date: string }[] = [];
    const d = new Date(t0); d.setHours(0, 0, 0, 0);
    for (let s = d.getTime(); s < t1; ) {
      const n = new Date(s); n.setDate(n.getDate() + 1);
      days.push({ start: s, end: n.getTime(), date: localDate(new Date(s + 12 * 3600e3).toISOString()) });
      s = n.getTime();
    }
    return { t0, t1, openT, closeT, days };
  }, [items, open, close]);

  if (!geom) return null;

  const H = 96, padL = 8, padR = 8;
  const laneBidTop = 22, laneBidBottom = 54, laneCmtTop = 60, laneCmtBottom = 72, axisY = 76;
  const x = (t: number) => padL + ((t - geom.t0) / (geom.t1 - geom.t0)) * Math.max(width - padL - padR, 1);
  const bids = items.filter(i => i.kind === 'bid' && i.amount != null);
  const maxBid = bids.reduce((m, b) => Math.max(m, b.amount as number), 0);
  const yBid = (amount: number) => laneBidBottom - (maxBid > 0 ? (amount / maxBid) * (laneBidBottom - laneBidTop) : 0);
  // running high bid as a step path
  let stepPath = '';
  let high = 0;
  for (const b of bids) {
    const bx = x(new Date(b.at).getTime());
    const amt = b.amount as number;
    if (amt > high) {
      stepPath += stepPath ? ` H ${bx.toFixed(1)} V ${yBid(amt).toFixed(1)}` : `M ${bx.toFixed(1)} ${yBid(amt).toFixed(1)}`;
      high = amt;
    }
  }
  if (stepPath && geom.closeT != null) stepPath += ` H ${x(geom.closeT).toFixed(1)}`;
  // Day labels: a label is drawn only where its own day is wide enough to hold it and it
  // clears the previous drawn label — measured from the rendered text, never a fixed width.
  const measure = makeLabelMeasurer(ref.current);
  const dayLabels = new Map<string, string>();
  let lastLabelRight = -Infinity;
  for (const d of geom.days) {
    const x0 = Math.max(padL, x(d.start)), x1 = Math.min(width - padR, x(d.end));
    const text = fmtDayShort(new Date(d.start + 12 * 3600e3).toISOString()).toUpperCase();
    const w = measure(text);
    if (x1 - x0 < w + LABEL_GAP_PX) continue;          // the day is too narrow for its own label
    if (x0 + 3 < lastLabelRight + LABEL_GAP_PX) continue; // it would run into the previous label
    dayLabels.set(d.date, text);
    lastLabelRight = x0 + 3 + w;
  }
  const closeX = geom.closeT != null ? x(geom.closeT) : null;
  const resultLabel = `${OUTCOME_LABEL[auction.outcome]}${auction.price != null ? ` ${fmtUsd(auction.price)}` : ''}`;

  return (
    <div className="auction-band" ref={ref}>
      {/* the facts line */}
      <div className="auction-band__facts">
        <a className="auction-band__lot" href={auction.lotUrl} target="_blank" rel="noreferrer">
          BAT{auction.lotNumber ? ` LOT ${auction.lotNumber}` : ''}↗
        </a>
        <span style={mono}>OPEN {fmtMoment(open)}</span>
        {open && <span className="auction-band__basis">({open.basis})</span>}
        <span style={mono}>CLOSE {fmtMoment(close)}</span>
        {close && <span className="auction-band__basis">({close.basis})</span>}
        <span style={{ ...mono, fontWeight: 700 }}>{resultLabel}{auction.buyer ? ` · to ${auction.buyer}` : ''}</span>
        {auction.activityExtracted ? (
          <span style={mono}>
            {bids.length} bids · {items.length - bids.length} comments{auction.watchers != null ? ` · ${auction.watchers.toLocaleString()} watchers` : ''}{auction.views != null ? ` · ${auction.views.toLocaleString()} views` : ''}
          </span>
        ) : (
          <span className="auction-band__basis">bids and comments not extracted yet</span>
        )}
        {auction.photos.publishedWithListing > 0 && (
          <span style={mono}>{auction.photos.publishedWithListing} photos published with the listing (no capture time)</span>
        )}
      </div>

      {width > 0 && (
        <svg className="auction-band__svg" width={width} height={H} viewBox={`0 0 ${width} ${H}`} role="img"
             aria-label={`auction sequence: ${bids.length} bids, ${items.length - bids.length} comments`}>
          {/* days: click targets, active highlight, boundaries, labels */}
          {geom.days.map(d => {
            const x0 = Math.max(padL, x(d.start)), x1 = Math.min(width - padR, x(d.end));
            if (x1 <= x0) return null;
            const label = dayLabels.get(d.date);
            return (
              <g key={d.date}>
                {activeDay === d.date && <rect x={x0} y={4} width={x1 - x0} height={axisY - 4} fill="var(--vp-row-alt, #f4f4f4)" />}
                <rect x={x0} y={4} width={x1 - x0} height={axisY - 4} fill="transparent" style={{ cursor: 'pointer' }}
                      onClick={() => onOpenDay(d.date)}><title>{`open ${d.date}`}</title></rect>
                <line x1={x0} y1={axisY} x2={x0} y2={axisY - 4} stroke="var(--vp-ghost, #ddd)" strokeWidth={1} />
                {label && (
                  <text x={x0 + 3} y={axisY + 12} fill="var(--vp-pencil, #888)" fontSize={LABEL_FONT_PX} fontFamily="var(--vp-font-mono)">
                    {label}
                  </text>
                )}
              </g>
            );
          })}
          {/* after the close: a shaded zone the post-auction comments sit in */}
          {closeX != null && closeX < width - padR && (
            <rect x={closeX} y={4} width={width - padR - closeX} height={axisY - 4} fill="var(--vp-ghost, #ddd)" fillOpacity={0.25} pointerEvents="none" />
          )}
          <line x1={padL} y1={axisY} x2={width - padR} y2={axisY} stroke="var(--vp-ghost, #ddd)" strokeWidth={2} />

          {/* open */}
          <line x1={x(geom.openT)} y1={4} x2={x(geom.openT)} y2={axisY} stroke="var(--vp-pencil, #888)" strokeWidth={1} strokeDasharray="2 2" pointerEvents="none" />
          <text x={x(geom.openT) + 3} y={12} fill="var(--vp-pencil, #888)" fontSize={8} fontWeight={700} letterSpacing="0.08em">OPEN</text>

          {/* running high bid + every bid */}
          {stepPath && <path d={stepPath} fill="none" stroke="var(--vp-ink, #1a1a1a)" strokeWidth={1} pointerEvents="none" />}
          {bids.map(b => {
            const isFinal = b === bids[bids.length - 1];
            return (
              <a key={b.id} href={b.url} target="_blank" rel="noreferrer">
                <circle cx={x(new Date(b.at).getTime())} cy={yBid(b.amount as number)} r={isFinal ? 3.5 : 2.5}
                        fill={isFinal ? 'var(--vp-ink, #1a1a1a)' : 'var(--vp-surface, #fff)'} stroke="var(--vp-ink, #1a1a1a)" strokeWidth={1} />
                <title>{itemTitle(b)}</title>
              </a>
            );
          })}

          {/* comments: a tick each; the seller's are solid bars */}
          {items.filter(i => i.kind !== 'bid').map(c => {
            const cx = x(new Date(c.at).getTime());
            return (
              <a key={c.id} href={c.url} target="_blank" rel="noreferrer">
                {c.kind === 'seller'
                  ? <rect x={cx - 1.5} y={laneCmtTop} width={3} height={laneCmtBottom - laneCmtTop} fill="var(--vp-ink, #1a1a1a)" />
                  : <line x1={cx} y1={laneCmtTop + 2} x2={cx} y2={laneCmtBottom} stroke="var(--vp-pencil, #888)" strokeWidth={1} />}
                <title>{itemTitle(c)}</title>
              </a>
            );
          })}

          {/* close + result */}
          {closeX != null && (
            <g pointerEvents="none">
              <line x1={closeX} y1={4} x2={closeX} y2={axisY} stroke="var(--vp-ink, #1a1a1a)" strokeWidth={2} />
              <text x={closeX > width * 0.7 ? closeX - 4 : closeX + 4} y={12} textAnchor={closeX > width * 0.7 ? 'end' : 'start'}
                    fill="var(--vp-ink, #1a1a1a)" fontSize={8} fontWeight={700} letterSpacing="0.08em">
                CLOSE · {resultLabel}
              </text>
            </g>
          )}
        </svg>
      )}

      <div className="auction-band__legend">
        <span>○ bid · ● final bid · line: running high bid</span>
        <span>| comment · ▍ seller</span>
        <span>shaded: after the close</span>
        <span>a day opens its record; a mark opens its comment on BaT</span>
      </div>
    </div>
  );
};

export default AuctionSequenceBand;
