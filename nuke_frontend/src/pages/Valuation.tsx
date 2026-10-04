import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { comparePriceToSourceSales, type DatedSourceSale, type SaleComparisonOptions } from '../lib/dealRead/batComps';
import { PrefetchLink } from '../components/PrefetchLink';
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

/** Sanitized ancestry already returned by the qualified public reader. */
type SaleEvidence = DatedSourceSale & {
  snapshotId?: string | null; sourceSha256?: string | null;
  snapshotFetchedAt?: string | null; snapshotCreatedAt?: string | null; parsedAt?: string | null;
  sourceVerification?: string | null; derivedObservationId?: string | null; derivedIngestedAt?: string | null;
  sourceVehicleEventId?: string | null; sourceEpisodeAncestry?: string | null; sourceParser?: string | null; admissionParser?: string | null;
};

type ValuationResult = {
  query: { year: number | null; make: string; model: string | null };
  stats: Stats;
  comparables: Comparable[];
  receipt: {
    cohort: { key: string; label: string; basis: string; complete: boolean };
    eligible: SaleEvidence[]; event_from: string; event_before: string; evidence_as_of: string; computed_at: string;
    knowledge_mode: 'retrospective' | 'known_at'; currency: string; minimum_sales: number;
    sale_population_basis?: string;
    subject?: { vehicle_id: string | null; source_key: string | null; source_url: string | null; exclusion_basis: string };
    coverage: { member_rows: number; qualified_sales: number; condition_scalar_recorded: number; body_recorded: number; engine_recorded: number; transmission_recorded: number; conflicting_source_lots: number; inline_raw_verified?: number; archived_admitted?: number;
      dated_source_rows?: number; capture_presentations?: number; qualified_capture_presentations?: number; duplicate_presentations?: number; typed_sale_episode_links?: number;
      native_episode_locators?: number; native_capture_headers?: number };
    exclusions: Record<string, number>;
  };
};

type ValuationRequest = {
  p_year: number | null; p_make: string; p_model: string | null;
  p_event_before: string | null; p_event_from: string | null; p_evidence_as_of: null;
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
const SOURCE_PAGE_SIZE = 25;
const utcClock = (value: string | null | undefined) => value
  && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))
  ? new Date(value).toISOString().replace('T', ' ').replace('Z', ' UTC') : 'Unknown';
const opaqueId = (value: string | null | undefined) => value && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value) ? value : null;
const parserReference = (value: string | null | undefined) => value && /^batParser:[a-z0-9_.:-]{1,100}$/i.test(value) ? value : 'Unknown';
function canonicalBatSource(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value), slug = /^\/listing\/([a-z0-9-]+)\/?$/i.exec(url.pathname)?.[1];
    return ['http:', 'https:'].includes(url.protocol) && /^(www\.)?bringatrailer\.com$/i.test(url.hostname)
      && !url.username && !url.password && !url.port && slug ? `https://bringatrailer.com/listing/${slug.toLowerCase()}/` : null;
  } catch { return null; }
}

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
  const [eventFrom, setEventFrom] = useState(params.get('sales_from') ?? '');
  const [currency, setCurrency] = useState(params.get('currency') || 'USD');
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lookup, setLookup] = useState<{ result: ValuationResult; request: ValuationRequest; contextKey: string } | null>(null);
  const latestRequest = useRef(0);
  const initialLookup = useRef<Promise<Awaited<ReturnType<typeof supabase.rpc>>> | null>(null);
  const filters = useRef<HTMLDetailsElement>(null);
  const [sourcePage, setSourcePage] = useState(0);
  const [recordLabels, setRecordLabels] = useState<{ key: string; labels: Record<string, string>; failed: boolean } | null>(null);
  const result = lookup?.result ?? null;
  const subjectVehicleId = params.get('vehicle_id') || null;
  const filterKey = JSON.stringify([year.trim(),make.trim(),model.trim(),eventFrom,eventBefore,currency,subjectVehicleId]);
  const loading = loadingKey != null;
  const loadingThisContext = loadingKey === filterKey;

  const runLookup = useCallback(async (yearOverride?: string, reuseInitialLookup = false) => {
    const requestId = ++latestRequest.current;
    const trimmedMake = make.trim();
    const trimmedModel = model.trim();
    const requestedYear = yearOverride ?? year;
    const parsedYear = requestedYear.trim() ? parseInt(requestedYear.trim(), 10) : null;
    const requestedContextKey = JSON.stringify([requestedYear.trim(), make.trim(), model.trim(), eventFrom, eventBefore, currency, subjectVehicleId]);

    if (!trimmedMake || (!parsedYear && !trimmedModel)) {
      setError('Provide a make plus a year and/or model.');
      setLoadingKey(null);
      return;
    }

    setLoadingKey(requestedContextKey);
    setError(null);
    const request: ValuationRequest = {
      p_year: parsedYear, p_make: trimmedMake, p_model: trimmedModel || null,
      p_event_before: eventBefore ? `${eventBefore}T00:00:00Z` : null,
      p_event_from: eventFrom ? `${eventFrom}T00:00:00Z` : null, p_evidence_as_of: null, p_currency: currency,
      p_price: null, p_subject_vehicle_id: subjectVehicleId, p_knowledge_mode: 'retrospective',
    };

    const next = new URLSearchParams();
    if (parsedYear) next.set('year', String(parsedYear));
    next.set('make', trimmedMake);
    if (trimmedModel) next.set('model', trimmedModel);
    if (candidatePrice) next.set('price', candidatePrice);
    if (eventBefore) next.set('as_of', eventBefore);
    if (eventFrom) next.set('sales_from', eventFrom);
    next.set('currency', currency);
    if (subjectVehicleId) next.set('vehicle_id', subjectVehicleId);
    setParams(next, { replace: true });

    try {
      // StrictMode may replay the arrival effect. Share its actual promise (the
      // Supabase builder is a thenable that would fetch again on each await).
      // Explicit refreshes always make a new request and retain the stale guard.
      const response = reuseInitialLookup
        ? (initialLookup.current ??= Promise.resolve(supabase.rpc('valuation_by_ymm', request)))
        : supabase.rpc('valuation_by_ymm', request);
      const { data, error: rpcError } = await response;
      if (requestId !== latestRequest.current) return;
      if (rpcError) throw rpcError;
      if (data?.error) throw new Error(data.error);
      if (!data?.receipt?.cohort?.complete || !Array.isArray(data.receipt.eligible)) throw new Error('Qualified sale evidence is unavailable. The cohort reader must be updated before price statistics can be shown.');
      if (data.receipt.currency !== request.p_currency || data.receipt.knowledge_mode !== request.p_knowledge_mode
        || data.query?.year !== request.p_year || data.query?.make !== request.p_make || data.query?.model !== request.p_model) {
        throw new Error('Returned evidence does not match the requested comparison.');
      }
      setLookup({ result: data as ValuationResult, request, contextKey: requestedContextKey });
      setSourcePage(0);
    } catch (e: any) {
      if (requestId === latestRequest.current) setError(e?.code === '57014' || /statement timeout/i.test(e?.message ?? '')
        ? 'Sale evidence took too long to load. Choose a narrower year, model or sales window and try again. No new comparison was produced.'
        : e?.message || 'Sale evidence could not be loaded. Try again.');
    } finally {
      if (requestId === latestRequest.current) setLoadingKey(null);
    }
  }, [year, make, model, eventFrom, eventBefore, currency, candidatePrice, subjectVehicleId, setParams]);

  useEffect(() => () => { latestRequest.current++; }, []);

  // Auto-run from URL params
  useEffect(() => {
    if (params.get('make') && (params.get('year') || params.get('model')) && !result && !loading) {
      runLookup(undefined, true);
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
  const outputCurrency = receipt?.currency || currency;
  const fmtUsd = (n: number | null | undefined) => formatPrice(n, outputCurrency);
  const fmtUsdFull = (n: number | null | undefined) => formatPriceFull(n, outputCurrency);
  const changedFilters = lookup != null && lookup.contextKey !== filterKey;
  const subjectEvidence = useMemo((): Pick<SaleComparisonOptions['subject'], 'vehicleId' | 'sourceUrl' | 'exclusionBasis'> => {
    const requested = lookup?.request.p_subject_vehicle_id;
    if (!requested || receipt?.sale_population_basis !== 'source_qualified_episodes_of_current_public_members') return { vehicleId: requested };
    const subject = receipt.subject, source = canonicalBatSource(subject?.source_url ?? null);
    if (opaqueId(requested) && subject?.vehicle_id === requested && subject.exclusion_basis === 'exact_source_episode'
      && source === subject.source_url && subject.source_key === source?.replace('https://', '').replace(/\/$/, '')) {
      return { vehicleId: requested, sourceUrl: source, exclusionBasis: 'exact_source_episode' };
    }
    return { vehicleId: requested, exclusionBasis: 'unestablished' };
  }, [receipt, lookup]);
  const comparison = useMemo(() => receipt && !changedFilters ? comparePriceToSourceSales(receipt.eligible, {
    cohort: receipt.cohort,
    subject: { amount: candidatePrice.trim() ? Number(candidatePrice) : null, currency: receipt.currency, priceBasis: 'published_bid_excluding_fees', ...subjectEvidence },
    eventFrom: receipt.event_from, eventBefore: receipt.event_before, evidenceAsOf: receipt.evidence_as_of,
    computedAt: receipt.computed_at, knowledgeMode: receipt.knowledge_mode, minimumSales: receipt.minimum_sales,
  }) : null, [receipt, candidatePrice, subjectEvidence, changedFilters]);
  const empty = result && stats && stats.sold_count === 0;
  const sourceEvidence = useMemo(() => receipt ? comparePriceToSourceSales(receipt.eligible, {
    cohort: receipt.cohort, subject: { amount: null, currency: receipt.currency, priceBasis: 'published_bid_excluding_fees', ...subjectEvidence },
    eventFrom: receipt.event_from, eventBefore: receipt.event_before, evidenceAsOf: receipt.evidence_as_of,
    computedAt: receipt.computed_at, knowledgeMode: receipt.knowledge_mode, minimumSales: receipt.minimum_sales,
  }) : null, [receipt, subjectEvidence]);
  // Display paging never reduces the calculation's source-sale denominator.
  const sourceSales = useMemo(() => [...(sourceEvidence?.eligible ?? [])].sort((a, b) =>
    (b.eventAt ?? '').localeCompare(a.eventAt ?? '') || (a.sourceUrl ?? '').localeCompare(b.sourceUrl ?? '')) as SaleEvidence[], [sourceEvidence]);
  const visibleSourceSales = useMemo(() => sourceSales.slice(sourcePage * SOURCE_PAGE_SIZE, (sourcePage + 1) * SOURCE_PAGE_SIZE), [sourceSales, sourcePage]);
  const labelKey = JSON.stringify(visibleSourceSales.map(s => [s.vehicleId, s.sourceUrl]));
  useEffect(() => {
    // One bounded public metadata read for the visible page. These are current
    // labels, never source-sale features or inputs to the amount calculation.
    const ids = [...new Set(visibleSourceSales.map(s => opaqueId(s.vehicleId)).filter((id): id is string => id != null))];
    if (!ids.length) return;
    let cancelled = false;
    void (async () => {
      try {
        const { data, error: labelError } = await supabase.from('vehicles').select('id,title,bat_listing_title,listing_url,discovery_url')
          .in('id', ids).eq('is_public', true).is('deleted_at', null)
          .or('listing_kind.is.null,listing_kind.neq.non_vehicle_item');
        if (cancelled) return;
        if (labelError) throw labelError;
        const labels: Record<string, string> = {};
        for (const sale of visibleSourceSales) {
          const matches = (data ?? []).filter(row => row.id === sale.vehicleId
            && (canonicalBatSource(row.listing_url) || canonicalBatSource(row.discovery_url)) === sale.sourceUrl);
          const title = matches.length === 1 ? matches[0].bat_listing_title || matches[0].title : null;
          if (typeof title === 'string' && title.trim()) labels[sale.sourceUrl!] = title;
        }
        setRecordLabels({ key: labelKey, labels, failed: false });
      } catch {
        if (!cancelled) setRecordLabels({ key: labelKey, labels: {}, failed: true });
      }
    })();
    return () => { cancelled = true; };
  }, [labelKey, visibleSourceSales]);
  const recordedLabels = useMemo(() => {
    const titles = new Map<string, string[]>();
    for (const c of result?.comparables ?? []) {
      if (c.bat_listing_title?.trim() && canonicalBatSource(c.bat_listing_url) === c.bat_listing_url) {
        titles.set(c.bat_listing_url, [...(titles.get(c.bat_listing_url) ?? []), c.bat_listing_title]);
      }
    }
    const labels = Object.fromEntries([...titles].filter(([, values]) => values.length === 1).map(([url, values]) => [url, values[0]]));
    return { ...labels, ...(recordLabels?.key === labelKey ? recordLabels.labels : {}) };
  }, [result, recordLabels, labelKey]);
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
          Bring a Trailer · recorded sale evidence
        </div>
        {receipt && <button type="button" style={{ border: 0, background: 'transparent', color: 'var(--text)', padding: '6px 0', fontSize: FS.body, textDecoration: 'underline', cursor: 'pointer' }} onClick={() => {
          if (!filters.current) return;
          filters.current.open = true;
          filters.current.scrollIntoView({ block: 'start', behavior: 'smooth' });
          filters.current.querySelector('input')?.focus({ preventScroll: true });
        }}>Change cohort / sales window ↓</button>}
      </div>

      {subjectEvidence.exclusionBasis === 'unestablished' && <p role="status" style={{ fontSize: FS.body }}>The vehicle’s exact comparison sale is unestablished. Source records remain available; its price percentile is withheld.</p>}
      {receipt && stats && !changedFilters && <SourceSaleDistribution
        sales={sourceSales} currency={receipt.currency} label={receipt.cohort.label}
        basis={receipt.cohort.basis} memberRows={receipt.coverage.member_rows} minimumSales={receipt.minimum_sales}
        yearRestricted={result?.query.year != null} modelRestricted={result?.query.model != null}
        eventFrom={receipt.event_from} eventBefore={receipt.event_before}
        evidenceAsOf={receipt.evidence_as_of} knowledgeMode={receipt.knowledge_mode}
        recordedLabels={recordedLabels} renderEvidence={sale => <SaleAncestry sale={sale} />}
        page={sourcePage} onPageChange={setSourcePage}
        cohortAction={result?.query.year != null && result.query.model && <button type="button" disabled={loading || changedFilters}
          title="Use exact recorded model labels across years; registered model variants may be absent"
          onClick={() => { setYear(''); void runLookup(''); }}>All recorded model years</button>}
        summary={{ median: stats.median, p10: stats.p10, p90: stats.p90 }} comparison={comparison}
        candidateInput={<Field label="Amount reference" value={candidatePrice} onChange={setCandidatePrice} placeholder="Amount" inputMode="decimal" minWidth={100} />} />}
      {recordLabels?.key === labelKey && recordLabels.failed && !changedFilters && <p role="status" style={{ fontSize: FS.body }}>Current vehicle labels could not be read. Sale amounts and source links remain available.</p>}

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
        <Field label="Sales from (UTC date)" value={eventFrom} onChange={setEventFrom} placeholder="Default: last 36 months" minWidth={160} />
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
        <div>{result?.query.year == null ? 'All recorded model years' : `Recorded model year ${result.query.year}`} · {result?.query.make} {result?.query.model}. Recorded membership is browse context; generations, condition and equipment are not matched.</div>
        {result?.query.year == null && ['exact_recorded_year_model_context', 'exact_recorded_make_model_context_all_years'].includes(receipt.cohort.basis) && <div>Exact recorded make/model labels across years. Related model variants may be absent; this is a different population from a registered model context.</div>}
        <div>{receipt.coverage.dated_source_rows ?? 'Unknown'} dated source vehicle records · {receipt.coverage.capture_presentations ?? 'Unknown'} linked source captures · {receipt.coverage.qualified_capture_presentations ?? 'Unknown'} qualified capture presentations · {receipt.coverage.duplicate_presentations ?? 'Unknown'} duplicate presentations collapsed.</div>
        <div>Vehicle records, source captures and source lots have different denominators. Exclusion counts describe capture presentations, not missing market sales. Platform-wide coverage is unknown.</div>
        <div>{receipt.coverage.typed_sale_episode_links ?? 'Unknown'} qualified source lots have revalidated native sale-event links.</div>
        {typeof receipt.coverage.inline_raw_verified === 'number' && typeof receipt.coverage.archived_admitted === 'number' && <div>{receipt.coverage.inline_raw_verified} verified inline source lots · {receipt.coverage.archived_admitted} admitted archived source lots</div>}
        <div>Source sales from {fmtDate(receipt.event_from)} before {fmtDate(receipt.event_before)}. Evidence through {receipt.evidence_as_of.replace('T',' ')}.</div>
        <div>Earlier sales discovered later can enter this retrospective comparison. {receipt.sale_population_basis === 'source_qualified_episodes_of_current_public_members'
          ? 'Each verified source sale is a separate episode; earlier resales can count for the same vehicle. Stored source coverage remains incomplete.'
          : 'Current recorded sale per vehicle; earlier resales may be missing.'}</div>
        {receipt.sale_population_basis === 'source_qualified_episodes_of_current_public_members' && <div>{receipt.coverage.native_episode_locators ?? 'Unknown'} native source episode locators · {receipt.coverage.native_capture_headers ?? 'Unknown'} linked capture headers. Locators identify sources; captured evidence must establish the sale, amount, currency and date.</div>}
        <div>Evidence cutoff includes source capture, parsing and actual snapshot ingestion. Admitted archived sales also include when the verified sale receipt arrived. Cohort uses today's recorded year/make/model. Historical cohort membership is unavailable.</div>
        <div>Published winning bid excludes buyer fees, taxes and transport (<a href="https://bringatrailer.com/policies/" target="_blank" rel="noreferrer">BaT policy</a>). Original currency; no inflation or exchange-rate adjustment. Condition and equipment remain unmatched.</div>
        <div>Current condition field present on {receipt.coverage.condition_scalar_recorded}/{receipt.coverage.qualified_sales}; this does not establish condition at sale. Body {receipt.coverage.body_recorded}, engine {receipt.coverage.engine_recorded}, transmission {receipt.coverage.transmission_recorded}. Visual condition, comment evidence and bid-log coverage are unmeasured.</div>
        <div>Receipt computed {utcClock(receipt.computed_at)} · cohort basis: {receipt.cohort.basis === 'registered_same_year_model_context' ? 'registered recorded make/model context' : ['exact_recorded_year_model_context', 'exact_recorded_make_model_context_all_years'].includes(receipt.cohort.basis) ? 'exact recorded make/model context' : 'reader-declared context; matching basis unavailable'}.</div>
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
        <div role="alert" style={{
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

          {sourceSales.length > 0 && <details aria-label="Qualified sale source records" style={{ border: '2px solid var(--text)', marginBottom: 12, fontSize: FS.body }}>
            <summary style={{ padding: 10, cursor: 'pointer' }}>Source receipts · {sourceSales.length}</summary>
            <div style={{ padding: 10, borderBottom: '2px solid var(--text)' }}>
              <strong>Qualified source sales · {sourceSales.length}</strong>
              <div>Showing {sourcePage * SOURCE_PAGE_SIZE + 1}–{Math.min((sourcePage + 1) * SOURCE_PAGE_SIZE, sourceSales.length)} of {sourceSales.length} source lots. Display paging does not sample the price calculation.</div>
              {changedFilters && <div>These records belong to the last completed lookup shown above.</div>}
            </div>
            <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {visibleSourceSales.map((sale, index) => {
                const source = canonicalBatSource(sale.sourceUrl), vehicle = opaqueId(sale.vehicleId);
                return <li key={`${sale.sourceUrl}:${index}`} style={{ borderBottom: '1px solid var(--border)', padding: 10, overflowWrap: 'anywhere' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
                    <strong style={{ fontFamily: MONO }}>{formatPriceFull(sale.amount, sale.currency || receipt!.currency)}</strong>
                    <span>Sale {/^\d{4}-\d{2}-\d{2}$/.test(sale.eventAt ?? '') ? `${sale.eventAt} (day grain)` : utcClock(sale.eventAt)}</span>
                    {source ? <a href={source} target="_blank" rel="noreferrer">BaT source</a> : <span>Source link unavailable</span>}
                    {vehicle && <PrefetchLink to={`/vehicle/${vehicle}`}>Vehicle record</PrefetchLink>}
                    {comparison?.percentile != null && <span>{sale.amount === comparison.subject.amount ? 'Equal to candidate' : sale.amount! < comparison.subject.amount! ? 'Lower than candidate' : 'Higher than candidate'}</span>}
                  </div>
                  <div>Evidence known {utcClock(sale.knownAt)} · {sale.currency || 'Currency unknown'} · {sale.priceBasis === 'published_bid_excluding_fees' ? 'published winning bid; fees excluded' : sale.priceBasis === 'buyer_total' ? 'buyer total' : 'fee basis unknown'}</div>
                  <SaleAncestry sale={sale} />
                </li>;
              })}
            </ol>
            {sourceSales.length > SOURCE_PAGE_SIZE && <nav aria-label="Source sale pages" style={{ display: 'flex', gap: 8, padding: 10 }}>
              <button type="button" style={chipBtn} disabled={sourcePage === 0} onClick={() => setSourcePage(p => p - 1)}>Previous source lots</button>
              <button type="button" style={chipBtn} disabled={(sourcePage + 1) * SOURCE_PAGE_SIZE >= sourceSales.length} onClick={() => setSourcePage(p => p + 1)}>Next source lots</button>
            </nav>}
          </details>}


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

function SaleAncestry({ sale }: { sale: SaleEvidence }) {
  const knownAncestry = sale.sourceVerification === 'per_read_inline_hash_parser' ? 'Inline source hash and parser verified'
    : sale.sourceVerification === 'producer_attested_archived_hash_parser' ? 'Admitted archived source receipt' : 'Verification ancestry unavailable';
  return <details><summary>Source evidence ancestry</summary>
    <div>{knownAncestry}. This is source-sale evidence, not condition matching.</div>
    <div>Snapshot reference: {opaqueId(sale.snapshotId) || 'Unknown'}</div>
    <div>Source capture: {utcClock(sale.snapshotFetchedAt)} · snapshot ingested: {utcClock(sale.snapshotCreatedAt)} · parsed: {utcClock(sale.parsedAt)}</div>
    <div>Admitted observation: {opaqueId(sale.derivedObservationId) || (sale.derivedObservationId === null ? 'None recorded' : 'Unknown')} · observation ingested: {utcClock(sale.derivedIngestedAt)}</div>
    <div>Native sale-event reference: {opaqueId(sale.sourceVehicleEventId) || 'Unknown'}</div>
    <div>Native episode ancestry: {sale.sourceEpisodeAncestry === 'canonical_current_context_verified' ? 'current canonical sale-event link verified; earlier episode history remains incomplete' : 'Unestablished'}</div>
    <div>Source parser: {parserReference(sale.sourceParser)} · admission parser: {parserReference(sale.admissionParser)}</div>
    <div>Source SHA-256: {sale.sourceSha256 && /^[a-f0-9]{64}$/i.test(sale.sourceSha256) ? sale.sourceSha256 : 'Unknown'}</div>
    <div>Capture, ingestion and parse clocks describe evidence availability, not a later sale or a live source read.</div>
  </details>;
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
