import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { comparePriceToSourceSales, type DatedSourceSale } from '../lib/dealRead/batComps';
import '../styles/unified-design-system.css';
import SourceSaleDistribution from '../components/market/SourceSaleDistribution';

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
  receipt: {
    cohort: { key: string; label: string; basis: string; complete: boolean };
    eligible: DatedSourceSale[]; event_from: string; event_before: string; evidence_as_of: string; computed_at: string;
    knowledge_mode: 'retrospective' | 'known_at'; currency: string; minimum_sales: number;
    coverage: { member_rows: number; qualified_sales: number; condition_scalar_recorded: number; body_recorded: number; engine_recorded: number; transmission_recorded: number; conflicting_source_lots: number; inline_raw_verified?: number; archived_admitted?: number };
    exclusions: Record<string, number>;
  };
};

type ValuationRequest = {
  p_year: number | null; p_make: string; p_model: string | null;
  p_event_before: string | null; p_event_from: null; p_evidence_as_of: null;
  p_currency: string; p_price: null; p_subject_vehicle_id: string | null; p_knowledge_mode: 'retrospective';
};

const formatPrice = (n: number | null | undefined, currency: string) => {
  if (n == null) return '—';
  const prefix = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '£';
  if (n >= 1_000_000) return `${prefix}${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${prefix}${(n / 1_000).toFixed(0)}K`;
  return `${prefix}${n.toLocaleString()}`;
};

const formatPriceFull = (n: number | null | undefined, currency: string) =>
  n == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);

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
  const [candidatePrice, setCandidatePrice] = useState(params.get('price') ?? '');
  const [eventBefore, setEventBefore] = useState(params.get('as_of') ?? '');
  const [currency, setCurrency] = useState(params.get('currency') || 'USD');
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lookup, setLookup] = useState<{ result: ValuationResult; request: ValuationRequest; contextKey: string } | null>(null);
  const latestRequest = useRef(0);
  const filters = useRef<HTMLDetailsElement>(null);
  const result = lookup?.result ?? null;
  const subjectVehicleId = params.get('vehicle_id') || null;
  const filterKey = JSON.stringify([year.trim(),make.trim(),model.trim(),eventBefore,currency,subjectVehicleId]);
  const loading = loadingKey != null;
  const loadingThisContext = loadingKey === filterKey;

  const runLookup = useCallback(async () => {
    const requestId = ++latestRequest.current;
    const trimmedMake = make.trim();
    const trimmedModel = model.trim();
    const parsedYear = year.trim() ? parseInt(year.trim(), 10) : null;

    if (!trimmedMake || (!parsedYear && !trimmedModel)) {
      setError('Provide a make plus a year and/or model.');
      setLoadingKey(null);
      return;
    }

    setLoadingKey(filterKey);
    setError(null);
    const request: ValuationRequest = {
      p_year: parsedYear, p_make: trimmedMake, p_model: trimmedModel || null,
      p_event_before: eventBefore ? `${eventBefore}T00:00:00Z` : null,
      p_event_from: null, p_evidence_as_of: null, p_currency: currency,
      p_price: null, p_subject_vehicle_id: subjectVehicleId, p_knowledge_mode: 'retrospective',
    };

    const next = new URLSearchParams();
    if (parsedYear) next.set('year', String(parsedYear));
    next.set('make', trimmedMake);
    if (trimmedModel) next.set('model', trimmedModel);
    if (candidatePrice) next.set('price', candidatePrice);
    if (eventBefore) next.set('as_of', eventBefore);
    next.set('currency', currency);
    if (subjectVehicleId) next.set('vehicle_id', subjectVehicleId);
    setParams(next, { replace: true });

    try {
      const { data, error: rpcError } = await supabase.rpc('valuation_by_ymm', request);
      if (requestId !== latestRequest.current) return;
      if (rpcError) throw rpcError;
      if (data?.error) throw new Error(data.error);
      if (!data?.receipt?.cohort?.complete || !Array.isArray(data.receipt.eligible)) throw new Error('Qualified sale evidence is unavailable. The cohort reader must be updated before price statistics can be shown.');
      if (data.receipt.currency !== request.p_currency || data.receipt.knowledge_mode !== request.p_knowledge_mode
        || data.query?.year !== request.p_year || data.query?.make !== request.p_make || data.query?.model !== request.p_model) {
        throw new Error('Returned evidence does not match the requested comparison.');
      }
      setLookup({ result: data as ValuationResult, request, contextKey: filterKey });
    } catch (e: any) {
      if (requestId === latestRequest.current) setError(e?.message || 'Lookup failed');
    } finally {
      if (requestId === latestRequest.current) setLoadingKey(null);
    }
  }, [year, make, model, eventBefore, currency, candidatePrice, subjectVehicleId, setParams, filterKey]);

  useEffect(() => () => { latestRequest.current++; }, []);

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
      document.title = `${parts} sale-price evidence – Nuke`;
    } else {
      document.title = 'Recorded sale prices – Nuke';
    }
  }, [result]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runLookup();
  };

  const stats = result?.stats;
  const receipt = result?.receipt;
  const recordedLabels = useMemo(() => Object.fromEntries((result?.comparables ?? []).map(c => [
    c.bat_listing_url, c.bat_listing_title || [c.year, c.make, c.model].filter(Boolean).join(' '),
  ])), [result]);
  const outputCurrency = receipt?.currency || currency;
  const fmtUsd = (n: number | null | undefined) => formatPrice(n, outputCurrency);
  const fmtUsdFull = (n: number | null | undefined) => formatPriceFull(n, outputCurrency);
  const changedFilters = lookup != null && lookup.contextKey !== filterKey;
  const comparison = useMemo(() => receipt && !changedFilters ? comparePriceToSourceSales(receipt.eligible, {
    cohort: receipt.cohort,
    subject: { amount: candidatePrice.trim() ? Number(candidatePrice) : null, currency: receipt.currency, priceBasis: 'published_bid_excluding_fees', vehicleId: lookup?.request.p_subject_vehicle_id },
    eventFrom: receipt.event_from, eventBefore: receipt.event_before, evidenceAsOf: receipt.evidence_as_of,
    computedAt: receipt.computed_at, knowledgeMode: receipt.knowledge_mode, minimumSales: receipt.minimum_sales,
  }) : null, [receipt, candidatePrice, lookup, changedFilters]);
  const empty = result && stats && stats.sold_count === 0;
  const subject = result
    ? [result.query.year, result.query.make, result.query.model].filter(Boolean).join(' ')
    : '';

  return (
    <div className="sale-price-page" style={{ maxWidth: 960, margin: '0 auto', padding: '20px 12px 60px', color: 'var(--text)' }}>
      {/* HEADER */}
      <div style={{ marginBottom: 16 }}>
        <div style={{
          fontSize: FS.bodyEmph,
          fontWeight: 800,
          letterSpacing: '1.5px',
          textTransform: 'uppercase',
        }}>
          Recorded sale prices
        </div>
        <div style={{
          fontSize: FS.label,
          color: 'var(--text-secondary)',
          letterSpacing: '0.5px',
          marginTop: 2,
        }}>
          Dated BaT sale prices · cohort evidence · candidate bid percentile
        </div>
        {receipt && <button type="button" style={{ border: 0, background: 'transparent', color: 'var(--text)', padding: '6px 0', fontSize: FS.body, textDecoration: 'underline', cursor: 'pointer' }} onClick={() => {
          if (!filters.current) return;
          filters.current.open = true;
          filters.current.scrollIntoView({ block: 'start', behavior: 'smooth' });
          filters.current.querySelector('input')?.focus({ preventScroll: true });
        }}>Change cohort / sales window ↓</button>}
      </div>

      {receipt && stats && !changedFilters && <SourceSaleDistribution
        sales={receipt.eligible} currency={receipt.currency} label={receipt.cohort.label}
        basis={receipt.cohort.basis} memberRows={receipt.coverage.member_rows} minimumSales={receipt.minimum_sales}
        yearRestricted={result?.query.year != null} modelRestricted={result?.query.model != null}
        eventFrom={receipt.event_from} eventBefore={receipt.event_before}
        evidenceAsOf={receipt.evidence_as_of} knowledgeMode={receipt.knowledge_mode}
        recordedLabels={recordedLabels}
        summary={{ median: stats.median, p10: stats.p10, p90: stats.p90 }} comparison={comparison}
        candidateInput={<Field label="Candidate bid / price" value={candidatePrice} onChange={setCandidatePrice} placeholder="Amount" inputMode="decimal" minWidth={100} />} />}

      <details ref={filters} open={!receipt || changedFilters} style={{ marginBottom: 12, scrollMarginTop: 90 }}>
      <summary style={{ fontSize: FS.body, cursor: 'pointer', marginBottom: 6 }}>Change cohort, currency or sales window</summary>
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
        {(!receipt || changedFilters) && <Field label="Candidate bid / price" value={candidatePrice} onChange={setCandidatePrice} placeholder="Amount" inputMode="decimal" minWidth={100} />}
        <Field label="Sales before (UTC date)" value={eventBefore} onChange={setEventBefore} placeholder="YYYY-MM-DD" minWidth={120} />
        <label style={{ fontSize: FS.label }}>CURRENCY
          <select aria-label="Currency" value={currency} onChange={e => setCurrency(e.target.value)} style={{ display: 'block', border: '2px solid var(--text)', padding: 6 }}>
            {['USD','EUR','GBP'].map(c => <option key={c}>{c}</option>)}
          </select>
        </label>
        <button
          type="submit"
          disabled={loadingThisContext || !make.trim()}
          style={{
            background: 'var(--text)',
            color: 'var(--bg)',
            border: '2px solid var(--text)',
            padding: '7px 14px',
            fontSize: FS.label,
            fontWeight: 800,
            letterSpacing: '1.5px',
            textTransform: 'uppercase',
            cursor: loadingThisContext ? 'wait' : 'pointer',
            opacity: loadingThisContext || !make.trim() ? 0.5 : 1,
            transition: TRANSITION,
            fontFamily: 'inherit',
          }}
        >
          {loadingThisContext ? 'Looking' : result ? 'Refresh evidence' : 'Compare'}
        </button>
      </form>
      </details>
      {changedFilters && <p role="status" style={{ fontSize: FS.body }}>Filters changed. Compare again to load matching evidence; the previous receipt remains available below.</p>}
      {receipt && <details aria-label="Sale comparison evidence" style={{ border: '2px solid var(--text)', padding: 10, marginBottom: 12, fontSize: FS.body }}>
        <summary>Scope, exclusions and source receipt</summary>
        <strong>{comparison?.percentile == null ? 'Price percentile unavailable' : `${comparison.percentile.toFixed(1)} percentile in recorded sales`}</strong>
        {changedFilters && <div>Compare again to apply the changed cohort, currency, date or vehicle.</div>}
        <div>{loading ? 'Refreshing evidence. The receipt below is the last completed lookup.' : 'Refresh evidence to include newly admitted source evidence. Save this receipt to keep this calculation.'}</div>
        <div>{receipt.cohort.label} · {receipt.coverage.qualified_sales} qualified source lots from {receipt.coverage.member_rows} public cohort records · {receipt.currency}</div>
        {typeof receipt.coverage.inline_raw_verified === 'number' && typeof receipt.coverage.archived_admitted === 'number' && <div>{receipt.coverage.inline_raw_verified} verified inline source lots · {receipt.coverage.archived_admitted} admitted archived source lots</div>}
        <div>Source sales from {fmtDate(receipt.event_from)} before {fmtDate(receipt.event_before)}. Evidence through {receipt.evidence_as_of.replace('T',' ')}.</div>
        <div>Earlier sales discovered later can enter this retrospective comparison. Current recorded sale per vehicle; earlier resales may be missing.</div>
        <div>Evidence cutoff includes source capture, parsing and actual snapshot ingestion. Admitted archived sales also include when the verified sale receipt arrived. Cohort uses today's recorded year/make/model. Historical cohort membership is unavailable.</div>
        <div>Published winning bid excludes buyer fees, taxes and transport (<a href="https://bringatrailer.com/policies/" target="_blank" rel="noreferrer">BaT policy</a>). Original currency; no inflation or exchange-rate adjustment. Condition and equipment remain unmatched.</div>
        <div>Current condition field present on {receipt.coverage.condition_scalar_recorded}/{receipt.coverage.qualified_sales}; this does not establish condition at sale. Body {receipt.coverage.body_recorded}, engine {receipt.coverage.engine_recorded}, transmission {receipt.coverage.transmission_recorded}. Visual condition, comment evidence and bid-log coverage are unmeasured.</div>
        {comparison?.percentile != null && <div>{comparison.counts.below} lower · {comparison.counts.equal} equal · {comparison.counts.above} higher. Ties receive half weight. This price position does not establish fair value or a profitable bid.</div>}
        {receipt.coverage.qualified_sales < receipt.minimum_sales && <div>At least {receipt.minimum_sales} qualified sales are required for aggregate prices.</div>}
        <details><summary>Excluded evidence and receipt</summary>
          <div>{Object.entries(receipt.exclusions).map(([reason,n]) => `${reason.replace(/_/g,' ')}: ${n}`).join(' · ') || 'No excluded records'} · conflicting source lots: {receipt.coverage.conflicting_source_lots}</div>
          <button type="button" disabled={!comparison || changedFilters} onClick={() => {
            if (!comparison || !lookup) return;
            const resolvedRequest = { ...lookup.request, p_event_from: receipt.event_from, p_event_before: receipt.event_before,
              p_evidence_as_of: receipt.evidence_as_of, p_currency: receipt.currency, p_knowledge_mode: receipt.knowledge_mode };
            const url = URL.createObjectURL(new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), request: lookup.request, resolvedRequest, sourceReceipt: receipt, comparison },null,2)], { type: 'application/json' }));
            const a = document.createElement('a'); a.href=url; a.download='sale-comparison-receipt.json'; a.click(); URL.revokeObjectURL(url);
          }}>Save this evidence receipt</button>
        </details>
      </details>}

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
                onClick={() => { setYear(p.year); setMake(p.make); setModel(p.model); }}
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
            No qualified source sales for {subject}
          </div>
          <div style={{ fontSize: FS.label, color: 'var(--text-secondary)' }}>
            Try a broader model (drop trim), a nearby year, or a different make spelling.
          </div>
        </div>
      )}

      {/* RESULT */}
      {result && stats && stats.sold_count > 0 && (
        <>
          {/* Secondary numeric summary; the graph is the primary analytical surface. */}
          <details><summary style={{ fontSize: FS.body, marginBottom: 8, cursor: 'pointer' }}>Numerical summary</summary>
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
              {stats.avg_bid_count != null && <StatCell label="Avg Bids" value={String(stats.avg_bid_count)} divider />}
              {stats.avg_comment_count != null && <StatCell label="Avg Comments" value={String(stats.avg_comment_count)} divider />}
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
                {' · '}max {fmtUsd(stats.max)} is &gt;5× median. Inspect the source evidence and vehicle differences behind this amount dispersion; no data error or condition adjustment is established.
              </div>
            )}
          </div>

          </details>

          {/* COMPARABLES */}
          {result.comparables.length > 0 && (
            <details><summary style={{ fontSize: FS.body, margin: '8px 0', cursor: 'pointer' }}>Recent sale summaries · {result.comparables.length}</summary>
            <div style={{
              border: '2px solid var(--text)',
              background: 'var(--surface)',
              marginBottom: 12,
              overflowX: 'auto',
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
            </details>
          )}

          {/* Footer note */}
          <div style={{
            fontSize: FS.label,
            color: 'var(--text-secondary)',
            letterSpacing: '0.3px',
            lineHeight: 1.5,
          }}>
            Source: matching cached BaT sold-result snapshots. Latest eligible sale: {fmtDate(stats.last_sale)}.
            {stats.sold_count >= 10 ? ' P10–P90 describes the observed price distribution; it is not a condition-adjusted valuation range.' : ' Aggregate prices are withheld below 10 qualified sales.'}
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
  inputMode?: 'numeric' | 'text' | 'decimal';
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
