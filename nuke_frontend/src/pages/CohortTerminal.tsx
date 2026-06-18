/**
 * CohortTerminal — the Bloomberg-terminal-for-a-cohort page.
 *
 * Landing surface for a year-make-model search ("1966 Ford Mustang").
 * Renders the `get_make_model_terminal` RPC envelope: live aggregates
 * assembled from the substrate + curated consensus fields.
 *
 * CARDINAL RULE: never fabricate, placeholder, or stand-in data. A block
 * whose `populated` flag is false renders an honest DARK state ("Intake gap
 * — not yet recorded"), never a fake number, zero, or "—" that reads as a
 * value. Real data only, quoted exactly as returned.
 *
 * Route: /cohort/:make/:model/:year
 */

import React, { useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { supabase } from '../lib/supabase';
import '../styles/unified-design-system.css';

// ─── Envelope types (mirror the RPC contract) ───────────────────────────

interface PopulatedFlag { populated: boolean }

interface CohortTerminalEnvelope {
  resolved: boolean;
  note?: string;
  subject_id?: string;
  cohort?: { make: string; model: string; year: number | null; grain?: string };
  cohort_count?: PopulatedFlag & { value?: number; source?: string };
  price_distribution?: PopulatedFlag & {
    n?: number; median?: number; p25?: number; p75?: number;
    min?: number; max?: number; observed_at?: string;
  };
  market_flow?: PopulatedFlag & {
    series?: Array<{ quarter: string; sales: number; median_price: number }>;
  };
  sentiment?: PopulatedFlag & { avg_sentiment_score?: number; n?: number };
  dealer_flow?: PopulatedFlag & {
    top?: Array<{ seller: string | null; events: number; median_price: number }>;
  };
  production?: PopulatedFlag & Record<string, unknown>;
  survival?: PopulatedFlag & { floor_known_members?: number };
  comps?: PopulatedFlag & {
    n?: number;
    rows?: Array<{
      vehicle_id: string; year: number | null; make: string | null;
      model: string | null; trim: string | null; sale_price: number | null;
      miles: number | null; platform: string | null; sold_date: string | null;
      listing_url: string | null; image_url: string | null;
    }>;
  };
  cited_fields?: Array<Record<string, unknown>>;
}

// ─── Formatting helpers ─────────────────────────────────────────────────

const fmtUsd = (n: number | null | undefined): string => {
  if (n == null || !isFinite(n)) return '';
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2).replace(/\.00$/, '')}M`;
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n).toLocaleString()}`;
};

const fmtUsdExact = (n: number | null | undefined): string =>
  n == null || !isFinite(n) ? '' : `$${Math.round(n).toLocaleString()}`;

const fmtInt = (n: number | null | undefined): string =>
  n == null || !isFinite(n) ? '' : Math.round(n).toLocaleString();

const fmtMiles = (n: number | null | undefined): string =>
  n == null || !isFinite(n) ? '' : `${Math.round(n).toLocaleString()} mi`;

const fmtQuarter = (iso: string): string => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `Q${q} '${String(d.getUTCFullYear()).slice(2)}`;
};

const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

// Title-case a route slug ("ford" -> "Ford", "f-100" -> "F-100").
const titleCase = (s: string): string =>
  decodeURIComponent(s)
    .split(/(\s|-)/)
    .map(part => (/^[a-z]/.test(part) ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join('');

// ─── Data hook ──────────────────────────────────────────────────────────

function useCohortTerminal(make: string, model: string, year: number | null) {
  return useQuery<CohortTerminalEnvelope>({
    queryKey: ['cohort-terminal', make, model, year],
    queryFn: async () => {
      // Self-register the cohort subject (idempotent, alias-canonicalizing) so ANY
      // year-make-model resolves on first view — from the treemap, search, or a
      // direct URL — not just pre-registered cohorts. Failures are non-fatal.
      if (year) {
        const { error: regErr } = await supabase.rpc('register_make_model_subject', {
          p_make: make,
          p_model: model,
          p_year: year,
        });
        if (regErr) console.warn('cohort self-register skipped:', regErr.message);
      }
      const { data, error } = await supabase.rpc('get_make_model_terminal', {
        p_make: make,
        p_model: model,
        p_year: year,
      });
      if (error) throw error;
      return (data ?? { resolved: false }) as CohortTerminalEnvelope;
    },
    staleTime: 5 * 60 * 1000,
    enabled: !!make && !!model,
  });
}

// ─── Shared layout pieces ───────────────────────────────────────────────

function SectionHeader({ label, meta }: { label: string; meta?: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      marginBottom: '8px',
    }}>
      <div style={{
        fontSize: '9px', fontWeight: 800, letterSpacing: '1px',
        textTransform: 'uppercase', color: 'var(--text)',
      }}>
        {label}
      </div>
      {meta && (
        <div style={{
          fontFamily: "'Courier New', monospace", fontSize: '9px',
          color: 'var(--text-muted)',
        }}>
          {meta}
        </div>
      )}
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  border: '2px solid var(--border)',
  background: 'var(--surface)',
  padding: '12px',
};

// Honest DARK state — an intake gap, NOT a market verdict, NOT a fake value.
// Dashed 2px border + a quiet awaiting-intake glyph reads as "reserved slot,
// not yet recorded" — deliberate, never broken or empty.
function DarkBlock({ label, reason }: { label: string; reason: string }) {
  return (
    <div style={{
      ...panelStyle,
      borderStyle: 'dashed',
      background: 'var(--bg)',
    }}>
      <SectionHeader label={label} meta="INTAKE GAP" />
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
        {/* awaiting-intake glyph — a hollow square, the "no signal yet" mark */}
        <div style={{
          flexShrink: 0, width: '8px', height: '8px', marginTop: '2px',
          border: '1px solid var(--text-muted)',
        }} />
        <div style={{
          fontFamily: "'Courier New', monospace",
          fontSize: '10px',
          color: 'var(--text-muted)',
          lineHeight: 1.5,
        }}>
          {reason}
        </div>
      </div>
    </div>
  );
}

// ─── Price distribution range bar ───────────────────────────────────────

function PriceDistribution({ pd }: { pd: NonNullable<CohortTerminalEnvelope['price_distribution']> }) {
  const { min, p25, median, p75, max, n } = pd;
  if (min == null || max == null || median == null || max <= min) {
    return <DarkBlock label="Price Distribution" reason="No defensible price spread captured yet." />;
  }
  const pct = (v: number | undefined): number =>
    v == null ? 0 : Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));

  const marks: Array<{ key: string; label: string; value: number | undefined; strong?: boolean }> = [
    { key: 'min', label: 'MIN', value: min },
    { key: 'p25', label: 'P25', value: p25 },
    { key: 'median', label: 'MEDIAN', value: median, strong: true },
    { key: 'p75', label: 'P75', value: p75 },
    { key: 'max', label: 'MAX', value: max },
  ];

  // Anti-collision: when adjacent marks sit within ~8% of the track, alternate
  // their price labels above/below so they never overlap. The median always
  // takes the top, anchored row; crowded neighbors drop to a second tier.
  const present = marks.filter(m => m.value != null);
  const tierOf = (i: number): 0 | 1 => {
    const m = present[i];
    if (m.strong) return 0;
    const prev = present[i - 1];
    if (prev && Math.abs(pct(m.value) - pct(prev.value)) < 9 && tierOf(i - 1) === 0) return 1;
    return 0;
  };

  return (
    <div style={panelStyle}>
      <SectionHeader
        label="Price Distribution"
        meta={n != null ? `n=${fmtInt(n)} sales` : undefined}
      />
      {/* Headline IQR band */}
      <div style={{ position: 'relative', height: '36px', marginTop: '40px', marginBottom: '40px' }}>
        {/* full-range track */}
        <div style={{
          position: 'absolute', top: '15px', left: 0, right: 0, height: '2px',
          background: 'var(--border)',
        }} />
        {/* IQR band (p25 -> p75) — the interquartile "fairway", solid + quiet */}
        {p25 != null && p75 != null && (
          <div style={{
            position: 'absolute', top: '11px', height: '10px',
            left: `${pct(p25)}%`, width: `${Math.max(0, pct(p75) - pct(p25))}%`,
            background: 'var(--text)', opacity: 0.18,
          }} />
        )}
        {present.map((m, i) => {
          const tier = tierOf(i);
          return (
            <div key={m.key} style={{ position: 'absolute', left: `${pct(m.value)}%`, top: 0, transform: 'translateX(-50%)' }}>
              {/* tick — median is a full 2px stem, quartiles thin, extremes thinnest */}
              <div style={{
                width: m.strong ? '2px' : '1px',
                height: m.strong ? '32px' : '24px',
                background: m.strong ? 'var(--text)' : 'var(--text-secondary)',
                margin: '0 auto',
              }} />
              {/* price label — median anchored, neighbors tier up to clear it */}
              <div style={{
                position: 'absolute',
                bottom: tier === 0 ? '36px' : '52px',
                left: '50%', transform: 'translateX(-50%)',
                whiteSpace: 'nowrap',
                fontFamily: "'Courier New', monospace",
                fontSize: m.strong ? '14px' : '10px',
                fontWeight: m.strong ? 800 : 600,
                color: m.strong ? 'var(--text)' : 'var(--text-secondary)',
              }}>
                {fmtUsd(m.value)}
              </div>
              {/* tier-1 leader line bridging the dropped label down to its tick */}
              {tier === 1 && (
                <div style={{
                  position: 'absolute', bottom: '38px', left: '50%', width: '1px', height: '12px',
                  background: 'var(--border)',
                }} />
              )}
              {/* label below */}
              <div style={{
                position: 'absolute', top: '34px', left: '50%', transform: 'translateX(-50%)',
                whiteSpace: 'nowrap',
                fontSize: '8px', fontWeight: 800, letterSpacing: '1px',
                color: m.strong ? 'var(--text)' : 'var(--text-muted)',
              }}>
                {m.label}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        {/* IQR spread readout — the one fact a buyer actually scans for */}
        {p25 != null && p75 != null && (
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: '9px', color: 'var(--text-muted)', letterSpacing: '0.5px' }}>
            IQR {fmtUsd(p25)}–{fmtUsd(p75)}
          </div>
        )}
        {pd.observed_at && (
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: '8px', color: 'var(--text-muted)' }}>
            observed {fmtDate(pd.observed_at)}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Market flow chart ──────────────────────────────────────────────────

function MarketFlowTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const sales = payload.find((p: any) => p.dataKey === 'sales')?.value;
  const price = payload.find((p: any) => p.dataKey === 'median_price')?.value;
  return (
    <div style={{
      background: 'var(--text)', color: 'var(--bg)', padding: '5px 8px',
      fontFamily: "'Courier New', monospace", fontSize: '10px',
    }}>
      <div style={{ fontWeight: 700 }}>{fmtQuarter(label)}</div>
      {sales != null && <div>{fmtInt(sales)} sales</div>}
      {price != null && <div>med {fmtUsdExact(price)}</div>}
    </div>
  );
}

function MarketFlow({ mf }: { mf: NonNullable<CohortTerminalEnvelope['market_flow']> }) {
  const series = (mf.series ?? []).filter(s => s && s.quarter);
  if (series.length < 2) {
    return <DarkBlock label="Market Flow" reason="Not enough quarterly sales history to chart a trend yet." />;
  }
  const totalSales = series.reduce((sum, s) => sum + (s.sales || 0), 0);
  return (
    <div style={panelStyle}>
      <SectionHeader
        label="Market Flow"
        meta={`${series.length} quarters · ${fmtInt(totalSales)} sales · bars=volume line=median`}
      />
      <div style={{ width: '100%', height: 176 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={series} margin={{ top: 6, right: 6, left: 2, bottom: 2 }} barCategoryGap="28%">
            <CartesianGrid stroke="var(--border)" strokeOpacity={0.4} vertical={false} />
            <XAxis
              dataKey="quarter"
              tickFormatter={fmtQuarter}
              tick={{ fontSize: 8, fill: 'var(--text-muted)', fontFamily: "'Courier New', monospace" }}
              axisLine={{ stroke: 'var(--border)' }} tickLine={false} minTickGap={18} tickMargin={6}
            />
            <YAxis
              yAxisId="vol"
              tickFormatter={(v) => fmtInt(v)}
              tick={{ fontSize: 8, fill: 'var(--text-muted)', fontFamily: "'Courier New', monospace" }}
              axisLine={false} tickLine={false} width={26} tickCount={4}
            />
            <YAxis
              yAxisId="price"
              orientation="right"
              tickFormatter={(v) => fmtUsd(v)}
              tick={{ fontSize: 8, fill: 'var(--text-muted)', fontFamily: "'Courier New', monospace" }}
              axisLine={false} tickLine={false} width={38} tickCount={4}
            />
            <Tooltip content={<MarketFlowTooltip />} cursor={{ fill: 'var(--text)', fillOpacity: 0.05 }} />
            <Bar yAxisId="vol" dataKey="sales" fill="var(--text-muted)" fillOpacity={0.4} isAnimationActive={false} />
            <Line
              yAxisId="price" dataKey="median_price" type="monotone"
              stroke="var(--text)" strokeWidth={1.5} dot={false} isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── Sentiment gauge ────────────────────────────────────────────────────

function Sentiment({ s }: { s: NonNullable<CohortTerminalEnvelope['sentiment']> }) {
  const score = s.avg_sentiment_score;
  if (score == null || !isFinite(score)) {
    return <DarkBlock label="Sentiment" reason="No scored auction commentary captured yet." />;
  }
  // map -1..1 to 0..100 for the needle position
  const clamped = Math.max(-1, Math.min(1, score));
  const pos = ((clamped + 1) / 2) * 100;
  const verdict = score > 0.15 ? 'POSITIVE' : score < -0.15 ? 'NEGATIVE' : 'NEUTRAL';
  return (
    <div style={panelStyle}>
      <SectionHeader label="Sentiment" meta={s.n != null ? `n=${fmtInt(s.n)} comments` : undefined} />
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '10px' }}>
        <div style={{ fontFamily: "'Courier New', monospace", fontSize: '20px', fontWeight: 800, color: 'var(--text)' }}>
          {score.toFixed(2)}
        </div>
        <div style={{ fontSize: '9px', fontWeight: 800, letterSpacing: '0.5px', color: 'var(--text-muted)' }}>
          {verdict}
        </div>
      </div>
      {/* gauge track -1 .. +1 */}
      <div style={{ position: 'relative', height: '8px', background: 'var(--border)', marginBottom: '4px' }}>
        {/* center line */}
        <div style={{ position: 'absolute', left: '50%', top: '-3px', bottom: '-3px', width: '1px', background: 'var(--text-muted)' }} />
        {/* needle */}
        <div style={{
          position: 'absolute', left: `${pos}%`, top: '-3px', bottom: '-3px',
          width: '3px', background: 'var(--text)', transform: 'translateX(-50%)',
        }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: "'Courier New', monospace", fontSize: '8px', color: 'var(--text-muted)' }}>
        <span>-1.0</span><span>0</span><span>+1.0</span>
      </div>
    </div>
  );
}

// ─── Dealer flow ────────────────────────────────────────────────────────

function DealerFlow({ df }: { df: NonNullable<CohortTerminalEnvelope['dealer_flow']> }) {
  // Filter out blank / null sellers client-side per spec.
  const rows = (df.top ?? []).filter(r => r && r.seller != null && String(r.seller).trim() !== '');
  if (rows.length === 0) {
    return <DarkBlock label="Dealer Flow" reason="No named sellers above the noise floor yet." />;
  }
  return (
    <div style={panelStyle}>
      <SectionHeader label="Dealer Flow" meta={`top ${rows.length} sellers`} />
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: "'Courier New', monospace", fontSize: '10px' }}>
        <thead>
          <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: '8px', letterSpacing: '1px' }}>
            <th style={{ padding: '0 6px 5px 0', fontWeight: 800 }}>SELLER</th>
            <th style={{ padding: '0 0 5px 6px', fontWeight: 800, textAlign: 'right' }}>SALES</th>
            <th style={{ padding: '0 0 5px 6px', fontWeight: 800, textAlign: 'right' }}>MED PRICE</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '3px 6px 3px 0', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '180px', whiteSpace: 'nowrap' }}>
                {r.seller}
              </td>
              <td style={{ padding: '3px 0 3px 6px', textAlign: 'right', color: 'var(--text)' }}>{fmtInt(r.events)}</td>
              <td style={{ padding: '3px 0 3px 6px', textAlign: 'right', color: 'var(--text)' }}>
                {r.median_price != null ? fmtUsdExact(r.median_price) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Survival (DARK but real floor) ─────────────────────────────────────

function Survival({ sv }: { sv: NonNullable<CohortTerminalEnvelope['survival']> }) {
  const floor = sv.floor_known_members;
  return (
    <div style={{ ...panelStyle, borderStyle: 'dashed', background: 'var(--bg)' }}>
      <SectionHeader label="Survival" meta="INTAKE GAP" />
      {floor != null ? (
        <div>
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: '18px', fontWeight: 800, color: 'var(--text)' }}>
            ≥ {fmtInt(floor)}
          </div>
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: '9px', color: 'var(--text-muted)', marginTop: '2px', lineHeight: 1.5 }}>
            known examples (floor). True survival rate needs production figures —
            not yet recorded.
          </div>
        </div>
      ) : (
        <div style={{ fontFamily: "'Courier New', monospace", fontSize: '10px', color: 'var(--text-muted)' }}>
          No survival data captured yet.
        </div>
      )}
    </div>
  );
}

// ─── Production / rarity (PARTIAL — seed-only) ──────────────────────────

function Production({ prod }: { prod: NonNullable<CohortTerminalEnvelope['production']> }) {
  const total = prod.total_produced as number | null | undefined;
  const rarity = prod.rarity_level as string | null | undefined;
  const demand = prod.collector_demand_score as number | null | undefined;
  return (
    <div style={panelStyle}>
      <SectionHeader label="Production" meta={prod.source ? String(prod.source) : undefined} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontFamily: "'Courier New', monospace", fontSize: '10px' }}>
        {total != null && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-muted)' }}>BUILT</span>
            <span style={{ color: 'var(--text)', fontWeight: 700 }}>{fmtInt(total)}</span>
          </div>
        )}
        {rarity && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-muted)' }}>RARITY</span>
            <span style={{ color: 'var(--text)', fontWeight: 700, textTransform: 'uppercase' }}>{rarity}</span>
          </div>
        )}
        {demand != null && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-muted)' }}>DEMAND</span>
            <span style={{ color: 'var(--text)', fontWeight: 700 }}>{fmtInt(demand)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Comps table (the heart) ────────────────────────────────────────────

function Comps({ comps }: { comps: NonNullable<CohortTerminalEnvelope['comps']> }) {
  const rows = comps.rows ?? [];
  if (rows.length === 0) {
    return <DarkBlock label="Comparable Sales" reason="No comparable sales captured for this cohort yet." />;
  }
  return (
    <div style={panelStyle}>
      <SectionHeader label="Comparable Sales" meta={comps.n != null ? `n=${fmtInt(comps.n)}` : `${rows.length} rows`} />
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: "'Courier New', monospace", fontSize: '10px', tableLayout: 'auto' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: '8px', letterSpacing: '1px' }}>
              <th style={{ padding: '0 6px 5px 0', fontWeight: 800 }}></th>
              <th style={{ padding: '0 6px 5px', fontWeight: 800 }}>VEHICLE</th>
              <th style={{ padding: '0 6px 5px', fontWeight: 800, textAlign: 'right' }}>PRICE</th>
              <th style={{ padding: '0 6px 5px', fontWeight: 800, textAlign: 'right' }}>MILES</th>
              <th style={{ padding: '0 6px 5px', fontWeight: 800 }}>PLATFORM</th>
              <th style={{ padding: '0 6px 5px', fontWeight: 800 }}>SOLD</th>
              <th style={{ padding: '0 0 5px', fontWeight: 800, textAlign: 'right' }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const vehicleLabel = [r.year, r.make, r.model, r.trim].filter(Boolean).join(' ');
              return (
                <tr key={r.vehicle_id || i} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '3px 6px 3px 0', width: '44px' }}>
                    {r.image_url ? (
                      <Link to={`/vehicle/${r.vehicle_id}`} style={{ display: 'block' }}>
                        <img
                          src={r.image_url}
                          alt={vehicleLabel}
                          width={40}
                          height={28}
                          loading="lazy"
                          style={{ width: '40px', height: '28px', objectFit: 'cover', border: '1px solid var(--border)', display: 'block' }}
                        />
                      </Link>
                    ) : (
                      <div style={{ width: '40px', height: '28px', border: '1px solid var(--border)', background: 'var(--bg)' }} />
                    )}
                  </td>
                  <td style={{ padding: '3px 6px', color: 'var(--text)', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <Link to={`/vehicle/${r.vehicle_id}`} style={{ color: 'var(--text)', textDecoration: 'none' }}>
                      {vehicleLabel || '—'}
                    </Link>
                  </td>
                  <td style={{ padding: '3px 6px', textAlign: 'right', color: 'var(--text)', fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {r.sale_price != null ? fmtUsdExact(r.sale_price) : <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>not recorded</span>}
                  </td>
                  <td style={{ padding: '3px 6px', textAlign: 'right', color: 'var(--text)', whiteSpace: 'nowrap' }}>
                    {r.miles != null ? fmtMiles(r.miles) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <td style={{ padding: '3px 6px', color: 'var(--text-secondary)', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                    {r.platform || <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <td style={{ padding: '3px 6px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    {fmtDate(r.sold_date) || <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <td style={{ padding: '3px 0', textAlign: 'right' }}>
                    {r.listing_url && (
                      <a href={r.listing_url} target="_blank" rel="noreferrer" style={{ color: 'var(--text)', textDecoration: 'underline', fontSize: '9px', whiteSpace: 'nowrap' }}>
                        listing↗
                      </a>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────

export default function CohortTerminal() {
  const params = useParams<{ make: string; model: string; year: string }>();
  const make = titleCase(params.make || '');
  const model = titleCase(params.model || '');
  const yearNum = params.year ? parseInt(params.year, 10) : null;
  const year = yearNum != null && !isNaN(yearNum) ? yearNum : null;

  const { data, isLoading, error } = useCohortTerminal(make, model, year);

  const headline = useMemo(() => {
    const c = data?.cohort;
    const yr = c?.year ?? year;
    return [yr, c?.make ?? make, c?.model ?? model].filter(Boolean).join(' ');
  }, [data, make, model, year]);

  if (isLoading) {
    return (
      <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '24px 12px' }}>
        <div style={{ fontFamily: "'Courier New', monospace", fontSize: '11px', color: 'var(--text-muted)' }}>
          Loading cohort terminal…
        </div>
      </div>
    );
  }

  if (error || !data || data.resolved === false) {
    return (
      <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '24px 12px' }}>
        <div style={{ ...panelStyle, borderStyle: 'dashed', background: 'var(--bg)' }}>
          <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--text)', marginBottom: '6px' }}>
            {headline || 'This cohort'} isn't indexed yet
          </div>
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: '10px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            {data?.note || error?.message || 'No terminal data has been assembled for this year-make-model. This is an intake gap, not a market verdict.'}
          </div>
          <div style={{ marginTop: '12px' }}>
            <Link to="/search" style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text)', textDecoration: 'underline' }}>
              ← Back to search
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const cc = data.cohort_count;
  const pd = data.price_distribution;
  const mf = data.market_flow;
  const sent = data.sentiment;
  const df = data.dealer_flow;
  const prod = data.production;
  const sv = data.survival;
  const comps = data.comps;
  const cited = data.cited_fields ?? [];

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>

      {/* ── Header — the instrument masthead ── */}
      <div style={{ ...panelStyle, borderColor: 'var(--text)', padding: '14px 14px 0' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '8px', fontWeight: 800, letterSpacing: '2px', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '5px' }}>
              Cohort Terminal{data.cohort?.grain ? ` · ${data.cohort.grain}` : ''}
            </div>
            <div style={{ fontSize: '27px', fontWeight: 800, color: 'var(--text)', lineHeight: 1.02, letterSpacing: '-0.01em' }}>
              {headline}
            </div>
            <div style={{ fontFamily: "'Courier New', monospace", fontSize: '10px', color: 'var(--text-muted)', marginTop: '5px' }}>
              {cc?.populated && cc.value != null
                ? `${fmtInt(cc.value)} examples tracked${cc.source ? ` · ${cc.source}` : ''}`
                : 'Cohort count not yet recorded'}
            </div>
          </div>

          {/* Headline median — the one number the page exists to deliver */}
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            {pd?.populated && pd.median != null ? (
              <>
                <div style={{ fontSize: '8px', fontWeight: 800, letterSpacing: '1.5px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  Median Sale
                </div>
                <div style={{ fontFamily: "'Courier New', monospace", fontSize: '32px', fontWeight: 800, color: 'var(--text)', lineHeight: 1, letterSpacing: '-0.01em' }}>
                  {fmtUsdExact(pd.median)}
                </div>
                {pd.n != null && (
                  <div style={{ fontFamily: "'Courier New', monospace", fontSize: '9px', color: 'var(--text-muted)', marginTop: '1px' }}>
                    across {fmtInt(pd.n)} sales
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontFamily: "'Courier New', monospace", fontSize: '10px', color: 'var(--text-muted)' }}>
                No median — not priced yet
              </div>
            )}
          </div>
        </div>
        {/* ledger rule + provenance strip — closes the masthead like a terminal status line */}
        <div style={{
          marginTop: '12px', borderTop: '1px solid var(--border)',
          padding: '5px 0 6px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontFamily: "'Courier New', monospace", fontSize: '8px', color: 'var(--text-muted)',
          letterSpacing: '0.5px',
        }}>
          <span>{data.subject_id ? `FINITE ASSET · SUBJECT ${data.subject_id.slice(0, 8)}` : 'LIVE COHORT AGGREGATE'}</span>
          <span>get_make_model_terminal</span>
        </div>
      </div>

      {/* ── Price distribution ── */}
      {pd?.populated
        ? <PriceDistribution pd={pd} />
        : <DarkBlock label="Price Distribution" reason="No defensible price spread captured yet." />}

      {/* ── Market flow ── */}
      {mf?.populated
        ? <MarketFlow mf={mf} />
        : <DarkBlock label="Market Flow" reason="No quarterly sales history captured yet." />}

      {/* ── Sentiment + Dealer flow row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px' }}>
        {sent?.populated
          ? <Sentiment s={sent} />
          : <DarkBlock label="Sentiment" reason="No scored commentary captured yet." />}
        {df?.populated
          ? <DealerFlow df={df} />
          : <DarkBlock label="Dealer Flow" reason="No named-seller flow captured yet." />}
      </div>

      {/* ── Comps (heart) ── */}
      {comps?.populated
        ? <Comps comps={comps} />
        : <DarkBlock label="Comparable Sales" reason="No comparable sales captured for this cohort yet." />}

      {/* ── Dark blocks: production / survival / verified facts ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px' }}>
        {prod?.populated
          ? <Production prod={prod} />
          : <DarkBlock label="Production" reason="No production figures captured yet. Factory build numbers haven't been ingested for this cohort." />}

        {sv ? <Survival sv={sv} /> : <DarkBlock label="Survival" reason="No survival data captured yet." />}

        {cited.length > 0
          ? (
            <div style={panelStyle}>
              <SectionHeader label="Verified Cohort Facts" meta={`${cited.length} consensus`} />
              <div style={{ fontFamily: "'Courier New', monospace", fontSize: '10px', color: 'var(--text)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {cited.map((f, i) => (
                  <div key={i} style={{ borderTop: i ? '1px solid var(--border)' : 'none', paddingTop: i ? '4px' : 0 }}>
                    {String((f as any).attribute_name ?? (f as any).name ?? 'fact')}:{' '}
                    <span style={{ fontWeight: 700 }}>{String((f as any).consensus_value ?? (f as any).value ?? '')}</span>
                  </div>
                ))}
              </div>
            </div>
          )
          : <DarkBlock label="Verified Cohort Facts" reason="No verified cohort facts yet. Curated consensus attributes haven't reached threshold for this cohort." />}
      </div>

      {/* footer note */}
      {data.note && (
        <div style={{ fontFamily: "'Courier New', monospace", fontSize: '8px', color: 'var(--text-muted)', lineHeight: 1.5, paddingTop: '4px' }}>
          {data.note}
        </div>
      )}
    </div>
  );
}
