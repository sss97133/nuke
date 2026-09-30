import React from 'react';

// The history strip (docs/schematics/homepage.md, "The building block"): one number placed in its own history or
// cohort. The range at each end, a tick for each past value, a block for now, and a counted verdict. First drawn as
// the homepage's "same time on <weekday>s" bar (RangeBar in MarketPulse.tsx), which now renders through this.

const label: React.CSSProperties = {
  fontFamily: 'Arial, sans-serif',
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--text-secondary)',
};

const mono: React.CSSProperties = { fontFamily: "'Courier New', monospace" };

export interface StripTick {
  key: string;
  value: number;
  title?: string;
}

// Past this many ticks they are drawn thin and faint, so a cohort of a few hundred reads as a density.
const DENSE = 40;

export function HistoryStrip({
  caption,
  value,
  ticks,
  format,
  verdict,
  title,
  nowTitle,
  log = false,
  width = 160,
}: {
  caption: string;
  value: number;
  ticks: StripTick[];
  format: (n: number) => string;
  verdict: string | null;
  title?: string;
  nowTitle?: string;
  log?: boolean; // for prices spanning more than one order of magnitude; every value must be > 0
  width?: number;
}) {
  let lo = value;
  let hi = value;
  for (const t of ticks) {
    if (t.value < lo) lo = t.value;
    if (t.value > hi) hi = t.value;
  }
  const useLog = log && lo > 0;
  const f = (v: number) => (useLog ? Math.log(v) : v);
  const span = f(hi) - f(lo);
  const x = (v: number) => (span > 0 ? (f(v) - f(lo)) / span : 0.5);
  const dense = ticks.length > DENSE;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }} title={title}>
      <span style={label}>{caption}</span>
      <span style={{ ...mono, fontSize: 11 }}>{format(lo)}</span>
      <span style={{ position: 'relative', width, height: 12 }}>
        <span style={{ position: 'absolute', top: 5, left: 0, right: 0, height: 2, background: 'var(--border)' }} />
        {ticks.map((t) => (
          <span
            key={t.key}
            title={t.title}
            style={{
              position: 'absolute',
              top: 2,
              left: `calc(${x(t.value) * 100}% - 1px)`,
              width: dense ? 1 : 2,
              height: 8,
              background: 'var(--text-secondary)',
              opacity: dense ? 0.35 : 1,
            }}
          />
        ))}
        <span title={nowTitle} style={{ position: 'absolute', top: 0, left: `calc(${x(value) * 100}% - 3px)`, width: 6, height: 12, background: 'var(--text)' }} />
      </span>
      <span style={{ ...mono, fontSize: 11 }}>{format(hi)}</span>
      {verdict && <span style={{ ...label, color: 'var(--text)' }}>{verdict}</span>}
    </span>
  );
}
