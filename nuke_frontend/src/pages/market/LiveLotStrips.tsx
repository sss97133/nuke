import React from 'react';
import { HistoryStrip } from './HistoryStrip';
import { useLiveLotTemperature, type CohortCount, type LiveLotTemperature } from './useLiveLotTemperature';

// Two history strips for a live lot: PRICE (its bid against comparable sold lots at the same time to close) and
// ACTIVITY (its bids and bidders against comparable past lots at the same time to close). Each verdict is a count
// with its basis; under the minimum number of comparables it says so instead. Renders nothing until the
// function returns a reading (not deployed, lot not live, or not read yet by bat-live-pull).

const label: React.CSSProperties = {
  fontFamily: 'Arial, sans-serif',
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--text-secondary)',
};

const basisStyle: React.CSSProperties = { fontSize: 10, color: 'var(--text-secondary)', fontFamily: 'Arial, sans-serif' };

function usd(n: number, compact = false): string {
  if (compact && Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (compact && Math.abs(n) >= 10_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

function out(hours: number): string {
  if (hours >= 48) return `${(hours / 24).toFixed(1)} days out`;
  if (hours >= 1) return `${Math.round(hours)} h out`;
  return `${Math.max(1, Math.round(hours * 60))} min out`;
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${s}`;
}

// Mid-rank percentile: lots below, plus half of those level.
function percentile(c: CohortCount): number {
  return Math.round((100 * (c.below + c.same / 2)) / c.n);
}

// "higher than 62 of 273", "more bids than 246 of 305 (6 level)": ties are said as ties, never rounded into a side.
function rank(c: CohortCount, more: string, less: string): string {
  const tied = c.same > 0 ? ` (${c.same} level)` : '';
  if (c.below === c.n) return `${more} all ${c.n}`;
  if (c.below === 0 && c.same === 0) return `${less} all ${c.n}`;
  if (c.below === 0 && c.same === c.n) return `level with all ${c.n}`;
  return `${more} ${c.below} of ${c.n}${tied}`;
}

function monthYear(ms: number | null): string {
  return ms == null ? '?' : new Date(ms).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function clock(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{children}</div>;
}

function Thin({ caption, c, t }: { caption: string; c: CohortCount; t: LiveLotTemperature }) {
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={label}>{caption}</span>
      <span style={{ ...label, color: 'var(--text)' }}>
        Not enough comparables: {c.n} of the {t.minComparables} needed
      </span>
    </span>
  );
}

export function LiveLotStripsView({ t }: { t: LiveLotTemperature }) {
  const at = out(t.hoursLeft);
  const cohort = `${t.make} ${t.model}`;
  const window = (c: CohortCount) => (c.firstClose == null ? 'none closed yet' : `closed ${monthYear(c.firstClose)}–${monthYear(c.lastClose)}`);
  const cap = `from the ${t.vehiclesCap} most recent ${cohort} vehicles on BaT`;
  const read = `as of this lot's last read, ${clock(t.readAt)}`;
  const enough = (c: CohortCount) => c.n >= t.minComparables;

  const p = t.price;
  const bid = p.bid;
  const b = t.bids;
  const w = t.bidders;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Row>
        {bid == null ? (
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <span style={label}>Price · {at}</span>
            <span style={{ ...label, color: 'var(--text)' }}>No bid yet</span>
          </span>
        ) : enough(p) ? (
          <HistoryStrip
            caption={`Price · bid ${usd(bid)} · ${at}`}
            value={bid}
            ticks={p.comps.map((v, i) => ({ key: String(i), value: v }))}
            format={(v) => usd(v, true)}
            log
            verdict={`${ordinal(percentile(p))} percentile · ${rank(p, 'higher than', 'lower than')} comparable sold lots at ${at}`}
            nowTitle={`This lot: ${usd(bid)}`}
            title={`Each tick is the high bid a sold ${cohort} lot had ${at}; the block is this lot's bid.`}
          />
        ) : (
          <Thin caption={`Price · ${at}`} c={p} t={t} />
        )}
        <span style={basisStyle}>
          Basis: {p.n} sold {cohort} lots with a bid {at}, {window(p)}, {cap}; bid {read}. Scale is logarithmic.
        </span>
      </Row>
      <Row>
        {enough(b) ? (
          <HistoryStrip
            caption={`Activity · ${b.value} bids, ${w.value} bidders · ${at}`}
            value={b.value}
            ticks={b.comps.map((v, i) => ({ key: String(i), value: v }))}
            format={(v) => `${Math.round(v)}`}
            verdict={`${rank(b, 'more bids than', 'fewer bids than')} comparable lots at ${at} · ${w.value} bidders, ${rank(w, 'more than', 'fewer than')}`}
            nowTitle={`This lot: ${b.value} bids from ${w.value} bidders`}
            title={`Each tick is how many bids a past ${cohort} lot had ${at}; the block is this lot.`}
          />
        ) : (
          <Thin caption={`Activity · ${at}`} c={b} t={t} />
        )}
        <span style={basisStyle}>
          Basis: {b.n} past {cohort} lots, sold or not, counted {at}, {window(b)}, {cap}; bids and bidders {read}.
        </span>
      </Row>
    </div>
  );
}

// `outer` frames it in its host page (the vehicle page's banner column); both wrappers exist only with a reading.
export default function LiveLotStrips({ vehicleId, style, outer }: { vehicleId: string | null | undefined; style?: React.CSSProperties; outer?: React.CSSProperties }) {
  const { data } = useLiveLotTemperature(vehicleId);
  if (!data) return null;
  const strips = (
    <div style={style}>
      <LiveLotStripsView t={data} />
    </div>
  );
  return outer ? <div style={outer}>{strips}</div> : strips;
}
