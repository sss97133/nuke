import React, { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import '../styles/unified-design-system.css';

// Top 25 BaT makes by sold_count from mv_treemap_by_brand on 2026-05-26.
// Powers the <datalist> autocomplete + benchmark hints.
const POPULAR_MAKES = [
  'Chevrolet', 'Ford', 'Porsche', 'Mercedes-Benz', 'BMW',
  'Toyota', 'Ferrari', 'Volkswagen', 'Honda', 'Dodge',
  'Jaguar', 'Pontiac', 'Jeep', 'Cadillac', 'Land Rover',
  'Plymouth', 'Buick', 'Oldsmobile', 'Lincoln', 'Bentley',
  'Audi', 'Lexus', 'Nissan', 'Rolls-Royce', 'GMC',
];

type Comparable = {
  sale_date: string | null;
  sale_price: number;
  bid_count: number | null;
  comment_count: number | null;
  bat_listing_url: string;
  bat_listing_title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
};

type Stats = {
  sold_count: number;
  median: number | null;
  p10: number | null;
  p90: number | null;
  min: number | null;
  max: number | null;
  avg: number | null;
  last_sale: string | null;
  first_sale: string | null;
  avg_bid_count: number | null;
  avg_comment_count: number | null;
  possible_outlier?: boolean;
};

type ValuationResult = {
  query: { year: number | null; make: string; model: string | null };
  stats: Stats;
  comparables: Comparable[];
};

const fmtUsd = (n: number | null | undefined) => {
  if (n == null) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
};

const fmtUsdFull = (n: number | null | undefined) =>
  n == null ? '—' : `$${n.toLocaleString()}`;

const fmtDate = (d: string | null) => (d ? d.slice(0, 10) : '—');

// Design system tokens (strict — 8 to 12px only)
const FS = {
  micro: 'var(--fs-8)',
  label: 'var(--fs-9)',
  body: 'var(--fs-10)',
  bodyEmph: 'var(--fs-11)',
  number: 'var(--fs-12)',
} as const;

const MONO = "'Courier New', monospace";
const TRANSITION = '0.12s ease';

export default function Valuation() {
  const [params, setParams] = useSearchParams();
  const [year, setYear] = useState(params.get('year') ?? '');
  const [make, setMake] = useState(params.get('make') ?? '');
  const [model, setModel] = useState(params.get('model') ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ValuationResult | null>(null);

  const runLookup = useCallback(async () => {
    const trimmedMake = make.trim();
    const trimmedModel = model.trim();
    const parsedYear = year.trim() ? parseInt(year.trim(), 10) : null;

    if (!trimmedMake || (!parsedYear && !trimmedModel)) {
      setError('Provide a make plus a year and/or model.');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    const next = new URLSearchParams();
    if (parsedYear) next.set('year', String(parsedYear));
    next.set('make', trimmedMake);
    if (trimmedModel) next.set('model', trimmedModel);
    setParams(next, { replace: true });

    try {
      const { data, error: rpcError } = await supabase.rpc('valuation_by_ymm', {
        p_year: parsedYear,
        p_make: trimmedMake,
        p_model: trimmedModel || null,
      });
      if (rpcError) throw rpcError;
      setResult(data as ValuationResult);
    } catch (e: any) {
      setError(e?.message || 'Lookup failed');
    } finally {
      setLoading(false);
    }
  }, [year, make, model, setParams]);

  // Auto-run from URL params
  useEffect(() => {
    if (params.get('make') && (params.get('year') || params.get('model')) && !result && !loading) {
      runLookup();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // SEO title
  useEffect(() => {
    const q = result?.query;
    if (q && q.make) {
      const parts = [q.year, q.make, q.model].filter(Boolean).join(' ');
      document.title = `${parts} BaT valuation – Nuke`;
    } else {
      document.title = 'Vehicle Valuation – Nuke';
    }
  }, [result]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runLookup();
  };

  const stats = result?.stats;
  const empty = result && stats && stats.sold_count === 0;
  const subject = result
    ? [result.query.year, result.query.make, result.query.model].filter(Boolean).join(' ')
    : '';

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '20px 12px 60px', color: 'var(--text)' }}>
      {/* HEADER */}
      <div style={{ marginBottom: 16 }}>
        <div style={{
          fontSize: FS.bodyEmph,
          fontWeight: 800,
          letterSpacing: '1.5px',
          textTransform: 'uppercase',
        }}>
          Vehicle Valuation
        </div>
        <div style={{
          fontSize: FS.label,
          color: 'var(--text-secondary)',
          letterSpacing: '0.5px',
          marginTop: 2,
        }}>
          BaT sold-price lookup · median, range, comparables
        </div>
      </div>

      {/* SEARCH FORM */}
      <form onSubmit={onSubmit} style={{
        border: '2px solid var(--text)',
        background: 'var(--surface)',
        padding: 10,
        marginBottom: 12,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        alignItems: 'flex-end',
      }}>
        <datalist id="valuation-makes">
          {POPULAR_MAKES.map((m) => <option key={m} value={m} />)}
        </datalist>
        <Field label="Year" value={year} onChange={setYear} placeholder="1989" inputMode="numeric" minWidth={80} />
        <Field label="Make *" value={make} onChange={setMake} placeholder="Ferrari" required minWidth={150} list="valuation-makes" />
        <Field label="Model" value={model} onChange={setModel} placeholder="328" minWidth={150} />
        <button
          type="submit"
          disabled={loading || !make.trim()}
          style={{
            background: 'var(--text)',
            color: 'var(--bg)',
            border: '2px solid var(--text)',
            padding: '7px 14px',
            fontSize: FS.label,
            fontWeight: 800,
            letterSpacing: '1.5px',
            textTransform: 'uppercase',
            cursor: loading ? 'wait' : 'pointer',
            opacity: loading || !make.trim() ? 0.5 : 1,
            transition: TRANSITION,
            fontFamily: 'inherit',
          }}
        >
          {loading ? 'Looking' : 'Value It'}
        </button>
      </form>

      {/* ERROR */}
      {error && (
        <div style={{
          border: '2px solid var(--error)',
          background: 'var(--error-dim)',
          padding: '8px 10px',
          marginBottom: 12,
          fontSize: FS.body,
          color: 'var(--error)',
          letterSpacing: '0.3px',
        }}>
          {error}
        </div>
      )}

      {/* EMPTY (pre-search) state — benchmark chips */}
      {!result && !loading && !error && (
        <div>
          <div style={{
            fontSize: FS.micro,
            fontWeight: 800,
            letterSpacing: '1.5px',
            textTransform: 'uppercase',
            color: 'var(--text-secondary)',
            marginBottom: 6,
          }}>Try a benchmark</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {[
              { year: '1989', make: 'Ferrari', model: '328' },
              { year: '1969', make: 'Chevrolet', model: 'Camaro' },
              { year: '1995', make: 'Toyota', model: 'Land Cruiser' },
              { year: '2015', make: 'Porsche', model: '911' },
              { year: '1965', make: 'Shelby', model: 'Cobra' },
              { year: '2002', make: 'BMW', model: 'Z8' },
            ].map((p) => (
              <button
                key={`${p.year}-${p.make}-${p.model}`}
                onClick={() => { setYear(p.year); setMake(p.make); setModel(p.model); setTimeout(runLookup, 0); }}
                style={chipBtn}
              >
                {p.year} {p.make} {p.model}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* EMPTY (post-search, 0 results) state */}
      {empty && (
        <div style={{
          border: '2px solid var(--border)',
          background: 'var(--surface)',
          padding: 12,
          fontSize: FS.body,
          color: 'var(--text)',
          letterSpacing: '0.3px',
        }}>
          <div style={{ fontWeight: 800, marginBottom: 4 }}>
            No BaT sales for {subject}
          </div>
          <div style={{ fontSize: FS.label, color: 'var(--text-secondary)' }}>
            Try a broader model (drop trim), a nearby year, or a different make spelling.
          </div>
        </div>
      )}

      {/* RESULT */}
      {result && stats && stats.sold_count > 0 && (
        <>
          {/* Subject + hero stats card */}
          <div style={{
            border: '2px solid var(--text)',
            background: 'var(--surface)',
            marginBottom: 12,
          }}>
            {/* Header strip */}
            <div style={{
              borderBottom: '2px solid var(--text)',
              padding: '6px 10px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
              background: 'var(--bg)',
            }}>
              <div style={{
                fontSize: FS.body,
                fontWeight: 800,
                letterSpacing: '1.5px',
                textTransform: 'uppercase',
              }}>
                {subject}
              </div>
              <div style={{
                fontSize: FS.micro,
                fontWeight: 800,
                letterSpacing: '1.5px',
                textTransform: 'uppercase',
                color: 'var(--text-secondary)',
              }}>
                n = {stats.sold_count} · last sale {fmtDate(stats.last_sale)}
              </div>
            </div>

            {/* Hero numbers: median + 80% range */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              borderBottom: '2px solid var(--text)',
            }}>
              <HeroCell label="BaT Median" value={fmtUsdFull(stats.median)} />
              <HeroCell label="80% Range (P10–P90)" value={`${fmtUsd(stats.p10)} – ${fmtUsd(stats.p90)}`} divider />
            </div>

            {/* Stats grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
            }}>
              <StatCell label="Min" value={fmtUsd(stats.min)} mono />
              <StatCell label="Max" value={fmtUsd(stats.max)} mono divider />
              <StatCell label="Avg" value={fmtUsd(stats.avg)} mono divider />
              <StatCell label="Avg Bids" value={stats.avg_bid_count != null ? String(stats.avg_bid_count) : '—'} divider />
              <StatCell label="Avg Comments" value={stats.avg_comment_count != null ? String(stats.avg_comment_count) : '—'} divider />
            </div>

            {/* Outlier inline note */}
            {stats.possible_outlier && (
              <div style={{
                borderTop: '2px solid var(--text)',
                padding: '6px 10px',
                fontSize: FS.label,
                color: 'var(--warning)',
                background: 'var(--warning-dim)',
                letterSpacing: '0.3px',
              }}>
                <span style={{ fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1.5px' }}>Outlier flagged</span>
                {' · '}max {fmtUsd(stats.max)} is &gt;5× median. Likely bad data. Trust the median, not the average.
              </div>
            )}
          </div>

          {/* COMPARABLES */}
          {result.comparables.length > 0 && (
            <div style={{
              border: '2px solid var(--text)',
              background: 'var(--surface)',
              marginBottom: 12,
            }}>
              <div style={{
                padding: '6px 10px',
                borderBottom: '2px solid var(--text)',
                fontSize: FS.body,
                fontWeight: 800,
                letterSpacing: '1.5px',
                textTransform: 'uppercase',
                background: 'var(--bg)',
              }}>
                Recent Sales · {result.comparables.length}
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--bg)' }}>
                    <Th>Date</Th>
                    <Th right>Price</Th>
                    <Th right>Bids</Th>
                    <Th right>Comments</Th>
                    <Th>Vehicle</Th>
                    <Th>Listing</Th>
                  </tr>
                </thead>
                <tbody>
                  {result.comparables.map((c, i) => {
                    const ymm = [c.year, c.make, c.model].filter(Boolean).join(' ');
                    const slug = c.bat_listing_url.replace(/^https?:\/\/[^/]+\/listing\//, '').replace(/\/$/, '');
                    return (
                      <tr key={c.bat_listing_url + i} style={{ borderTop: '1px solid var(--border)' }}>
                        <Td mono>{fmtDate(c.sale_date)}</Td>
                        <Td mono right bold>{fmtUsdFull(c.sale_price)}</Td>
                        <Td mono right>{c.bid_count ?? '—'}</Td>
                        <Td mono right>{c.comment_count ?? '—'}</Td>
                        <Td>{ymm || <span style={{ color: 'var(--text-secondary)' }}>—</span>}</Td>
                        <Td>
                          <a href={c.bat_listing_url} target="_blank" rel="noreferrer" style={{
                            color: 'var(--text)',
                            textDecoration: 'underline',
                            fontFamily: MONO,
                            fontSize: FS.body,
                          }}>
                            {slug}
                          </a>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Footer note */}
          <div style={{
            fontSize: FS.label,
            color: 'var(--text-secondary)',
            letterSpacing: '0.3px',
            lineHeight: 1.5,
          }}>
            Source: bringatrailer.com sold listings, scraped through {fmtDate(stats.last_sale)}.
            Median is the trustworthy single number; the P10–P90 range covers 80% of sales.
            {stats.sold_count < 5 && ' Small sample — treat as directional.'}
          </div>
        </>
      )}
    </div>
  );
}

const chipBtn: React.CSSProperties = {
  background: 'var(--surface)',
  border: '2px solid var(--text)',
  padding: '5px 8px',
  fontSize: FS.label,
  fontWeight: 700,
  color: 'var(--text)',
  cursor: 'pointer',
  fontFamily: 'inherit',
  letterSpacing: '0.5px',
  transition: TRANSITION,
};

function Field({ label, value, onChange, placeholder, required, inputMode, minWidth, list }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  inputMode?: 'numeric' | 'text';
  minWidth?: number;
  list?: string;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: '1 1 auto', minWidth: minWidth ?? 120 }}>
      <span style={{
        fontSize: FS.micro,
        fontWeight: 800,
        letterSpacing: '1.5px',
        textTransform: 'uppercase',
        color: 'var(--text-secondary)',
      }}>{label}</span>
      <input
        type="text"
        inputMode={inputMode}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        list={list}
        style={{
          border: '2px solid var(--text)',
          background: 'var(--bg)',
          padding: '6px 8px',
          fontSize: FS.bodyEmph,
          fontFamily: 'Arial, sans-serif',
          color: 'var(--text)',
          outline: 'none',
          width: '100%',
          boxSizing: 'border-box',
        }}
      />
    </label>
  );
}

function HeroCell({ label, value, divider }: { label: string; value: string; divider?: boolean }) {
  return (
    <div style={{
      padding: '10px 12px',
      borderLeft: divider ? '2px solid var(--text)' : undefined,
    }}>
      <div style={{
        fontSize: FS.micro,
        fontWeight: 800,
        letterSpacing: '1.5px',
        textTransform: 'uppercase',
        color: 'var(--text-secondary)',
        marginBottom: 2,
      }}>{label}</div>
      <div style={{
        fontSize: FS.number,
        fontFamily: MONO,
        fontWeight: 800,
        letterSpacing: '0px',
      }}>{value}</div>
    </div>
  );
}

function StatCell({ label, value, mono, divider }: { label: string; value: string; mono?: boolean; divider?: boolean }) {
  return (
    <div style={{
      padding: '8px 10px',
      borderLeft: divider ? '1px solid var(--border)' : undefined,
    }}>
      <div style={{
        fontSize: FS.micro,
        fontWeight: 800,
        letterSpacing: '1.5px',
        textTransform: 'uppercase',
        color: 'var(--text-secondary)',
        marginBottom: 2,
      }}>{label}</div>
      <div style={{
        fontSize: FS.bodyEmph,
        fontFamily: mono ? MONO : 'inherit',
        fontWeight: 800,
      }}>{value}</div>
    </div>
  );
}

const thTdBase: React.CSSProperties = {
  padding: '6px 10px',
  textAlign: 'left',
  fontSize: 'var(--fs-10)',
};

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th style={{
      ...thTdBase,
      textAlign: right ? 'right' : 'left',
      fontSize: FS.micro,
      fontWeight: 800,
      letterSpacing: '1.5px',
      textTransform: 'uppercase',
      color: 'var(--text-secondary)',
    }}>{children}</th>
  );
}

function Td({ children, right, bold, mono }: { children: React.ReactNode; right?: boolean; bold?: boolean; mono?: boolean }) {
  return (
    <td style={{
      ...thTdBase,
      textAlign: right ? 'right' : 'left',
      fontWeight: bold ? 800 : 400,
      fontFamily: mono ? MONO : 'inherit',
    }}>{children}</td>
  );
}
