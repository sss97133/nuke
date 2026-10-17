/**
 * TablePage.tsx
 *
 * Excel-style spreadsheet view of all substrate observations on a vehicle.
 * Sort any column ascending/descending, search across vendor / part / content,
 * click any row to drill into /observation/:id. Replaces the curated
 * "top vendors" / "recent activity" surfaces with one navigable table.
 *
 * Mounted at /vehicle/:vehicleId/table.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import './table-page.css';

interface ObsRow {
  id: string;
  kind: string;
  observed_at: string | null;
  ingested_at: string | null;
  source_url: string | null;
  content_text: string | null;
  confidence: string | null;
  confidence_score: number | null;
  vendor: string | null;
  part_number: string | null;
  part_description: string | null;
  total: number | null;
  lifecycle_status: string | null;
  source_slug: string | null;
  public_copy?: boolean;
  reported_work?: ReportedWork;
}

interface ReportedWork {
  observation_id: string;
  kind: 'activity';
  report_status: 'publisher_reported_completion';
  occurrence_status: 'unverified';
  performer_id: null;
  performer_status: 'unknown';
  independent_source: false;
  intent_status: 'unknown';
  observed_at_basis: 'source_testimony_recorded_at';
  reported_date: string;
  date_precision: 'month';
  reported_date_label: string;
  performed_clause: string;
  source_value: string;
  source_observation_id: string;
  source_id: string;
  source_url: string;
  source_captured_at: string;
  source_recorded_at: string;
  source_capture_sha256: string;
  source_capture_basis: 'direct_fetch' | 'protected_snapshot';
  source_witness_version: 'retained_description_reported_work_v1';
  observed_at: string;
  ingested_at: string;
  confidence_score: number;
}

interface PublicWorkRecord {
  observation_id: string;
  done_on?: string | null;
  item?: string | null;
  category?: string | null;
  supplier?: string | null;
  labor_minutes?: number | null;
  build_stage?: string | null;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const clock = (value: unknown): value is string => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));

function isPublicWorkRecord(value: unknown): value is PublicWorkRecord {
  return record(value) && text(value.observation_id) &&
    ['done_on', 'item', 'category', 'supplier', 'build_stage'].every(key => value[key] == null || typeof value[key] === 'string') &&
    (value.labor_minutes == null || typeof value.labor_minutes === 'number' && Number.isFinite(value.labor_minutes));
}

function isReportedWork(value: unknown): value is ReportedWork {
  if (!record(value) || value.kind !== 'activity' || value.report_status !== 'publisher_reported_completion' ||
    value.occurrence_status !== 'unverified' || value.performer_id !== null || value.performer_status !== 'unknown' ||
    value.independent_source !== false || value.intent_status !== 'unknown' || value.observed_at_basis !== 'source_testimony_recorded_at' ||
    value.date_precision !== 'month' || typeof value.reported_date !== 'string' || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value.reported_date) ||
    value.reported_date_label !== `${MONTHS[Number(value.reported_date.slice(5)) - 1]} ${value.reported_date.slice(0, 4)}` ||
    !['observation_id', 'source_observation_id', 'source_id'].every(key => typeof value[key] === 'string' && UUID.test(value[key])) ||
    !text(value.performed_clause) || !text(value.source_value) || !value.source_value.startsWith(value.performed_clause) ||
    !['source_captured_at', 'source_recorded_at', 'observed_at', 'ingested_at'].every(key => clock(value[key])) ||
    typeof value.source_capture_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.source_capture_sha256) ||
    !['direct_fetch', 'protected_snapshot'].includes(String(value.source_capture_basis)) ||
    value.source_witness_version !== 'retained_description_reported_work_v1' ||
    typeof value.confidence_score !== 'number' || !Number.isFinite(value.confidence_score) || value.confidence_score < 0 || value.confidence_score > 0.6 ||
    typeof value.source_url !== 'string') return false;
  try {
    const source = new URL(value.source_url);
    return source.protocol === 'https:' && !source.username && !source.password;
  } catch { return false; }
}

interface VehicleSummary {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
}

type SortKey = 'observed_at' | 'kind' | 'vendor' | 'part_number' | 'total' | 'lifecycle_status' | 'source_slug';
type SortDir = 'asc' | 'desc';

const fmtMoney = (n: number | null): string => {
  if (n === null || n === undefined) return '';
  if (n === 0) return '';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
};

const TablePage: React.FC = () => {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const [vehicle, setVehicle] = useState<VehicleSummary | null>(null);
  const [rows, setRows] = useState<ObsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [publicLogUnavailable, setPublicLogUnavailable] = useState(false);
  const [reportedWorkUnavailable, setReportedWorkUnavailable] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('observed_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [filter, setFilter] = useState('');
  const [kindFilter, setKindFilter] = useState<string | null>(null);

  useEffect(() => {
    if (!vehicleId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPublicLogUnavailable(false);
    setReportedWorkUnavailable(false);

    (async () => {
      // PostgREST caps each call at ~1000 rows; the K5 has ~1900 wire-specs that
      // would crowd out everything else if we ran one combined query. Fetch
      // each lifecycle-relevant kind separately and merge.
      const [vehRes, workRes, specRes, condRes, commentRes, sourceRes, publicWorkRes] = await Promise.all([
        supabase
          .from('vehicles')
          .select('id, year, make, model, trim')
          .eq('id', vehicleId)
          .maybeSingle(),
        supabase
          .from('vehicle_observations')
          .select('id, kind, observed_at, ingested_at, source_url, source_id, content_text, confidence, confidence_score, structured_data')
          .eq('vehicle_id', vehicleId)
          .eq('is_superseded', false)
          .eq('kind', 'work_record')
          .order('observed_at', { ascending: false })
          .limit(1000),
        supabase
          .from('vehicle_observations')
          .select('id, kind, observed_at, ingested_at, source_url, source_id, content_text, confidence, confidence_score, structured_data')
          .eq('vehicle_id', vehicleId)
          .eq('is_superseded', false)
          .eq('kind', 'specification')
          .not('structured_data->>lifecycle_status', 'is', null)
          .order('observed_at', { ascending: false })
          .limit(1000),
        supabase
          .from('vehicle_observations')
          .select('id, kind, observed_at, ingested_at, source_url, source_id, content_text, confidence, confidence_score, structured_data')
          .eq('vehicle_id', vehicleId)
          .eq('is_superseded', false)
          .eq('kind', 'condition')
          .order('observed_at', { ascending: false })
          .limit(1000),
        supabase
          .from('vehicle_observations')
          .select('id, kind, observed_at, ingested_at, source_url, source_id, content_text, confidence, confidence_score, structured_data')
          .eq('vehicle_id', vehicleId)
          .eq('is_superseded', false)
          .eq('kind', 'comment')
          .order('observed_at', { ascending: false })
          .limit(500),
        // Source slugs for the kinds we'll merge
        supabase.from('observation_sources').select('id, slug'),
        supabase.rpc('vehicle_build_log_public', { p_vehicle_id: vehicleId, p_include_reported: true }),
      ]);

      // A missing opt-in overload during deployment/rollback must not remove
      // confirmed public work. Other RPC errors remain visible failures.
      let publicLog: unknown = publicWorkRes.data;
      let publicLogError = publicWorkRes.error;
      const missingReportedReader = publicWorkRes.error?.code === 'PGRST202';
      if (missingReportedReader) {
        const legacy = await supabase.rpc('vehicle_build_log_public', { p_vehicle_id: vehicleId });
        publicLog = { work_records: legacy.data, reported_work: [] };
        publicLogError = legacy.error;
      }
      if (cancelled) return;

      if (vehRes.error) {
        setError(`Vehicle load failed: ${vehRes.error.message}`);
        setLoading(false);
        return;
      }
      setVehicle(vehRes.data as VehicleSummary | null);
      let publicLogIncomplete = true;
      let publicWork: unknown[] = [], reportedWork: unknown[] = [];
      if (!publicLogError && record(publicLog) && Array.isArray(publicLog.work_records) && Array.isArray(publicLog.reported_work)) {
        publicWork = publicLog.work_records; reportedWork = publicLog.reported_work; publicLogIncomplete = false;
      }
      setReportedWorkUnavailable(missingReportedReader);

      const sourceById = new Map<string, string>();
      for (const s of ((sourceRes.data as any[] | null) || [])) {
        sourceById.set(s.id, s.slug);
      }

      const all = [
        ...((workRes.data as any[] | null) || []),
        ...((specRes.data as any[] | null) || []),
        ...((condRes.data as any[] | null) || []),
        ...((commentRes.data as any[] | null) || []),
      ];

      const seen = new Set<string>();
      const out: ObsRow[] = [];
      for (const r of all) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        const sd = (r.structured_data || {}) as any;
        const total =
          (typeof sd.total_price === 'number' && sd.total_price) ||
          (typeof sd.total === 'number' && sd.total) ||
          (typeof sd.amount === 'number' && sd.amount) ||
          null;
        out.push({
          id: r.id,
          kind: r.kind,
          observed_at: r.observed_at,
          ingested_at: r.ingested_at,
          source_url: r.source_url,
          content_text: r.content_text,
          confidence: r.confidence,
          confidence_score: r.confidence_score,
          vendor: sd.vendor ?? sd.merchant ?? null,
          part_number: sd.part_number ?? null,
          part_description: sd.part_description ?? null,
          total,
          lifecycle_status: sd.lifecycle_status ?? null,
          source_slug: sourceById.get(r.source_id) || null,
        });
      }

      // The RPC owns masking. Keep permitted work searchable for visitors,
      // while an owner's directly readable observation wins on the same ID.
      for (const r of publicWork) {
        if (!isPublicWorkRecord(r)) { publicLogIncomplete = true; continue; }
        if (seen.has(r.observation_id)) continue;
        seen.add(r.observation_id);
        out.push({
          id: r.observation_id,
          kind: 'work_record',
          observed_at: r.done_on ?? null,
          // The public contract exposes a work date, not an ingest clock.
          ingested_at: null,
          source_url: null,
          content_text: [r.item, r.category, r.build_stage,
            r.labor_minutes != null ? `${Number(r.labor_minutes)} min` : null]
            .filter(Boolean).join(' · ') || null,
          confidence: null,
          confidence_score: null,
          vendor: r.supplier ?? null,
          part_number: null,
          part_description: null,
          total: null,
          lifecycle_status: null,
          source_slug: null,
          public_copy: true,
        });
      }

      // A publisher report is activity testimony, never a confirmed work record.
      // Its recording clocks cannot supply a day or a performer for the report.
      const reportedIds = new Set<string>();
      for (const report of reportedWork) {
        if (!isReportedWork(report) || reportedIds.has(report.observation_id)) { publicLogIncomplete = true; continue; }
        reportedIds.add(report.observation_id);
        // The qualified report wins over the same directly readable activity:
        // generic observation clocks/vendor fields cannot replace its meaning.
        const directIndex = out.findIndex(row => row.id === report.observation_id);
        if (directIndex !== -1) out.splice(directIndex, 1);
        seen.add(report.observation_id);
        out.push({ id: report.observation_id, kind: 'activity', observed_at: null, ingested_at: report.ingested_at,
          source_url: report.source_url, content_text: report.performed_clause, confidence: null, confidence_score: report.confidence_score,
          vendor: null, part_number: null, part_description: null, total: null, lifecycle_status: null,
          source_slug: sourceById.get(report.source_id) || new URL(report.source_url).hostname,
          public_copy: true, reported_work: report });
      }

      setPublicLogUnavailable(publicLogIncomplete);
      setRows(out);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [vehicleId]);

  const vehLabel = vehicle
    ? `${vehicle.year ?? ''} ${vehicle.make ?? ''} ${vehicle.model ?? ''} ${vehicle.trim ?? ''}`.replace(/\s+/g, ' ').trim()
    : 'Vehicle';

  const kinds = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.kind);
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return rows.filter((r) => {
      if (kindFilter && r.kind !== kindFilter) return false;
      if (!f) return true;
      const hay = `${r.vendor || ''} ${r.part_number || ''} ${r.part_description || ''} ${r.content_text || ''} ${r.kind} ${r.source_slug || ''} ${r.reported_work ? `reported work ${r.reported_work.reported_date_label}` : ''}`.toLowerCase();
      return hay.includes(f);
    });
  }, [rows, filter, kindFilter]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      // ISO month strings sort by the reported month without inventing a day.
      const av = sortKey === 'observed_at' && a.reported_work ? a.reported_work.reported_date : a[sortKey];
      const bv = sortKey === 'observed_at' && b.reported_work ? b.reported_work.reported_date : b[sortKey];
      if (av === null || av === undefined) return sortDir === 'asc' ? 1 : -1;
      if (bv === null || bv === undefined) return sortDir === 'asc' ? -1 : 1;
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      const cmp = String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [filtered, sortKey, sortDir]);

  const totalShown = sorted.reduce((s, r) => s + (r.total || 0), 0);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(k);
      setSortDir('desc');
    }
  };

  const HeaderCell: React.FC<{ k: SortKey; label: string; align?: 'left' | 'right' }> = ({ k, label, align = 'left' }) => (
    <button
      type="button"
      onClick={() => toggleSort(k)}
      style={{
        background: 'transparent',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        fontSize: 7,
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: sortKey === k ? 'var(--text, #1a1a1a)' : 'var(--text-secondary, #666)',
        fontFamily: 'Arial, sans-serif',
        textAlign: align,
        width: '100%',
      }}
    >
      {label}
      {sortKey === k && (sortDir === 'asc' ? ' ↑' : ' ↓')}
    </button>
  );

  return (
    <div
      style={{
        maxWidth: 1400,
        margin: '0 auto',
        padding: '16px 12px 48px',
        fontFamily: 'Arial, sans-serif',
        color: 'var(--text, #1a1a1a)',
      }}
    >
      <nav
        aria-label="breadcrumb"
        style={{
          fontSize: 8,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--text-secondary, #666)',
          marginBottom: 12,
          fontWeight: 700,
        }}
      >
        <Link to={`/vehicle/${vehicleId}`} style={{ color: 'inherit', textDecoration: 'none' }}>
          {vehLabel || 'Vehicle'}
        </Link>
        <span style={{ margin: '0 6px' }}>/</span>
        <span style={{ color: 'var(--text, #1a1a1a)' }}>Table</span>
      </nav>

      <h1
        style={{
          fontSize: 14,
          fontWeight: 700,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          margin: '0 0 8px',
          fontFamily: 'Arial, sans-serif',
        }}
      >
        Substrate Table
      </h1>

      {/* Controls */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        <input
          type="text"
          placeholder="Filter: vendor, part, text…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            flex: '1 1 240px',
            minWidth: 200,
            padding: '4px 8px',
            border: '2px solid var(--text, #1a1a1a)',
            fontFamily: 'Courier New, monospace',
            fontSize: 10,
            background: 'var(--bg, #fff)',
            color: 'var(--text, #1a1a1a)',
          }}
        />
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            type="button"
            onClick={() => setKindFilter(null)}
            style={{
              fontSize: 8,
              fontWeight: 700,
              padding: '4px 8px',
              border: `2px solid var(--text, #1a1a1a)`,
              background: kindFilter === null ? 'var(--text, #1a1a1a)' : 'transparent',
              color: kindFilter === null ? 'var(--bg, #fff)' : 'var(--text, #1a1a1a)',
              cursor: 'pointer',
              fontFamily: 'Arial, sans-serif',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            ALL
          </button>
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKindFilter(kindFilter === k ? null : k)}
              style={{
                fontSize: 8,
                fontWeight: 700,
                padding: '4px 8px',
                border: `2px solid var(--text, #1a1a1a)`,
                background: kindFilter === k ? 'var(--text, #1a1a1a)' : 'transparent',
                color: kindFilter === k ? 'var(--bg, #fff)' : 'var(--text, #1a1a1a)',
                cursor: 'pointer',
                fontFamily: 'Arial, sans-serif',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              {k}
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          fontSize: 9,
          color: 'var(--text-secondary, #666)',
          marginBottom: 12,
          fontFamily: 'Courier New, monospace',
        }}
      >
        SHOWING {sorted.length} OF {rows.length}{totalShown > 0 && ` · TOTAL $${totalShown.toLocaleString()}`}
      </div>

      {rows.some(r => r.public_copy && !r.reported_work) && (
        <p style={{ fontSize: 10 }}>
          Public build log: permitted work, suppliers, labor and stages. Receipts, amounts and full details are owner-only.
          Dates are recorded work dates; ingestion times are unavailable for these copies.
        </p>
      )}
      {rows.some(r => r.reported_work) && (
        <p className="tp-note">
          Reported work rows are publisher reports. Repeated captures may describe the same repair and do not provide independent confirmation.
        </p>
      )}
      {publicLogUnavailable && (
        <p role="status" style={{ fontSize: 10 }}>Public build log unavailable; work history may be incomplete.</p>
      )}
      {reportedWorkUnavailable && (
        <p role="status" className="tp-note">Publisher-reported work unavailable; confirmed public work is shown where available.</p>
      )}

      {loading && rows.length === 0 && (
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', padding: 12 }}>Loading…</div>
      )}

      {error && (
        <div style={{ fontSize: 10, color: 'var(--error, #c00)', padding: 12, border: '2px solid var(--error, #c00)' }}>
          {error}
        </div>
      )}

      {sorted.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <div style={{ display: 'inline-block', minWidth: '100%', border: '2px solid var(--text, #1a1a1a)' }}>
            {/* Header */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '92px 86px 160px 110px 90px 90px 1fr 110px',
                gap: 8,
                padding: '6px 8px',
                borderBottom: '2px solid var(--text, #1a1a1a)',
                background: 'var(--bg-alt, #f9f9f9)',
                position: 'sticky',
                top: 0,
              }}
            >
              <HeaderCell k="observed_at" label="Date" />
              <HeaderCell k="kind" label="Kind" />
              <HeaderCell k="vendor" label="Vendor" />
              <HeaderCell k="part_number" label="PN" />
              <HeaderCell k="total" label="$" align="right" />
              <HeaderCell k="lifecycle_status" label="Status" />
              <span
                style={{
                  fontSize: 7,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--text-secondary, #666)',
                  fontFamily: 'Arial, sans-serif',
                }}
              >
                Content
              </span>
              <HeaderCell k="source_slug" label="Source" />
            </div>

            {sorted.map((r, i) => {
              const Row: React.ElementType = r.public_copy ? 'div' : Link;
              return (
              <Row
                key={r.id}
                {...(r.public_copy ? {} : { to: `/vehicle/${vehicleId}/observation/${r.id}`, prefetch: 'intent' })}
                data-observation-id={r.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '92px 86px 160px 110px 90px 90px 1fr 110px',
                  gap: 8,
                  padding: '4px 8px',
                  borderTop: i === 0 ? 'none' : '1px solid var(--text-disabled, #ddd)',
                  fontFamily: 'Arial, sans-serif',
                  fontSize: 10,
                  color: 'var(--text, #1a1a1a)',
                  textDecoration: 'none',
                  alignItems: 'center',
                }}
              >
                <span style={{ fontFamily: 'Courier New, monospace', fontSize: 9, color: 'var(--text-secondary)' }}>
                  {r.reported_work ? <>{r.reported_work.reported_date_label}<br /><span>Reported month</span></> : r.observed_at ? r.observed_at.slice(0, 10) : '—'}
                </span>
                <span
                  style={{
                    fontSize: 7,
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    border: '1px solid var(--text, #1a1a1a)',
                    padding: '1px 4px',
                    textAlign: 'center',
                    alignSelf: 'center',
                  }}
                >
                  {r.reported_work ? 'Reported work' : r.kind}
                </span>
                <span style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                  {r.reported_work ? 'Performer unknown' : r.vendor || ''}
                </span>
                <span style={{ fontFamily: 'Courier New, monospace', fontSize: 9, fontWeight: 700 }}>
                  {r.part_number || ''}
                </span>
                <span style={{ fontFamily: 'Courier New, monospace', fontSize: 9, textAlign: 'right' }}>
                  {fmtMoney(r.total)}
                </span>
                <span
                  style={{
                    fontFamily: 'Courier New, monospace',
                    fontSize: 8,
                    color: r.lifecycle_status === 'installed' ? 'var(--success, #0a7)' : r.lifecycle_status === 'purchased' ? 'var(--warning, #cc8800)' : 'var(--text-secondary, #666)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  {r.reported_work ? <>Completion reported<br />Occurrence unverified</> : r.lifecycle_status || ''}
                </span>
                <div style={{ overflow: 'hidden', whiteSpace: r.reported_work ? 'normal' : 'nowrap', textOverflow: 'ellipsis', fontSize: 9 }}>
                  {r.content_text || r.part_description || ''}
                  {r.public_copy && !r.reported_work && <span> · Owner-only detail</span>}
                  {r.reported_work && <details className="tp-report">
                    <summary>Publisher quotation and source</summary>
                    <blockquote className="tp-report-quote">{r.reported_work.source_value}</blockquote>
                    <p><a href={r.reported_work.source_url} target="_blank" rel="noopener noreferrer">Publisher source</a></p>
                    <div>Source captured: {r.reported_work.source_captured_at}</div>
                    <div>Source recorded: {r.reported_work.source_recorded_at}</div>
                    <div>Publisher intent: unknown. Independent confirmation is not established.</div>
                    <details className="tp-report-detail">
                      <summary>Technical provenance</summary>
                      <div>Claim observed (source recording clock): {r.reported_work.observed_at}</div>
                      <div>Claim recorded (processing clock): {r.reported_work.ingested_at}</div>
                      <div>These recording clocks do not establish a work date.</div>
                      <div>Source observation: {r.reported_work.source_observation_id}</div>
                      <div>Source registry: {r.reported_work.source_id}</div>
                      <div className="tp-report-hash">Capture SHA-256: {r.reported_work.source_capture_sha256}</div>
                      <div>Capture basis: {r.reported_work.source_capture_basis}</div>
                      <div>Witness: {r.reported_work.source_witness_version}</div>
                    </details>
                  </details>}
                </div>
                <span style={{ fontFamily: 'Courier New, monospace', fontSize: 8, color: 'var(--text-secondary, #666)' }}>
                  {r.source_slug || ''}
                </span>
              </Row>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default TablePage;
