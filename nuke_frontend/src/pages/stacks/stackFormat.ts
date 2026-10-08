import { useEffect, useState } from 'react';
import type { BidMeasure } from './bidMeasurements';
import type { LotRow, OrderBookRead, OrderBookView } from './orderBookReader';
import type { LayerId, LayerState } from './stackDefinitions';

// Formatting and per-layer readings shared by the stack pages. Venue clock is Pacific, with the zone named.

export const VENUE_TZ = 'America/Los_Angeles';

export function usd(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

export function count(n: number): string {
  return n.toLocaleString('en-US');
}

/** Venue clock with the zone named: "Oct 6, 2026, 6:22:15 PM PDT". Seconds only where the source has them. */
export function clock(ms: number, seconds = false): string {
  return new Date(ms).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}), timeZone: VENUE_TZ, timeZoneName: 'short',
  });
}

/** A duration as days, hours and minutes, or minutes and seconds under an hour: "6d 19h 7m", "4m 12s". */
export function span(ms: number): string {
  const sign = ms < 0 ? '-' : '';
  const s = Math.floor(Math.abs(ms) / 1000);
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${sign}${d}d ${h}h ${m}m`;
  if (h > 0) return `${sign}${h}h ${m}m`;
  return `${sign}${m}m ${s % 60}s`;
}

/** A fraction as a rank out of 100: 0.619 is "62nd". */
export function ordinal(fraction: number): string {
  const n = Math.round(fraction * 100);
  const tail = n % 100;
  const suffix = tail >= 11 && tail <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
}

export function percent(numerator: number | null, denominator: number | null): string | null {
  if (numerator == null || denominator == null || denominator <= 0) return null;
  const p = (100 * numerator) / denominator;
  return `${p >= 99.95 || p === 0 ? p.toFixed(0) : p.toFixed(1)}%`;
}

export const STATE_WORD: Record<LayerState, string> = { reader: 'Reader', partial: 'Partial', missing: 'Missing' };

export function outcomeWord(lot: LotRow, open: boolean): string {
  if (open) return 'live';
  switch (lot.outcome) {
    case 'sold': return 'sold';
    case 'reserve_not_met': return 'reserve not met';
    case 'bid_to': return 'bid to';
    case 'no_sale': return 'no sale';
    case 'live': return 'closed, result not read yet';
    default: return lot.outcome ?? 'result unknown';
  }
}

/** Each layer's own number for the path; layers without a reader show none. */
export function layerReadings(read: OrderBookRead, view: OrderBookView, baseline: string | null): Partial<Record<LayerId, string>> {
  const last = view.states[view.states.length - 1];
  const lot = read.lot;
  return {
    log: `${count(view.bids.length)} bids`,
    key: `${count(last?.identities ?? 0)} identities`,
    dimension: `${count(view.kinds.length)} kinds`,
    fold: `${count(view.states.length)} states`,
    ...(baseline ? { baseline } : {}),
    ...(lot ? { outcome: view.window.open ? 'pending' : lot.winning_bid != null ? usd(Number(lot.winning_bid)) : outcomeWord(lot, false) } : {}),
  };
}

export function usePlotWidth() {
  const [node, setNode] = useState<HTMLDivElement | null>(null), [width, setWidth] = useState(360);
  useEffect(() => {
    if (!node) return;
    const resize = new ResizeObserver(([e]) => setWidth(Math.max(80, e.contentRect.width)));
    resize.observe(node); return () => resize.disconnect();
  }, [node]);
  return { ref: setNode, width };
}
export function formatMeasure(metric: BidMeasure, v: number, compact = false) {
  if (metric === 'amount' || metric === 'increment') return '$' + (compact && v >= 1000 ? (v / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 }) + 'k' : v.toLocaleString('en-US', { maximumFractionDigits: compact ? 0 : 2 }));
  if (['relative', 'typical', 'winRate', 'entry'].includes(metric)) return v.toLocaleString('en-US', { maximumFractionDigits: v > 0 && v < .1 ? 3 : compact ? 1 : 2 }) + '%';
  if (metric === 'spacing') return v >= 86400 ? (v / 86400).toFixed(1) + 'd' : v >= 3600 ? (v / 3600).toFixed(1) + 'h' : v >= 60 ? (v / 60).toFixed(1) + 'm' : v.toLocaleString('en-US', { maximumFractionDigits: 1 }) + 's';
  return v.toLocaleString('en-US', { maximumFractionDigits: 1 });
}
