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

interface ObsRow {
  id: string;
  kind: string;
  observed_at: string | null;
  ingested_at: string;
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
  const [sortKey, setSortKey] = useState<SortKey>('observed_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [filter, setFilter] = useState('');
  const [kindFilter, setKindFilter] = useState<string | null>(null);

  useEffect(() => {
    if (!vehicleId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      // PostgREST caps each call at ~1000 rows; the K5 has ~1900 wire-specs that
      // would crowd out everything else if we ran one combined query. Fetch
      // each lifecycle-relevant kind separately and merge.
      const [vehRes, workRes, specRes, condRes, commentRes, sourceRes] = await Promise.all([
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
      ]);

      if (cancelled) return;

      if (vehRes.error) {
        setError(`Vehicle load failed: ${vehRes.error.message}`);
        setLoading(false);
        return;
      }
      setVehicle(vehRes.data as VehicleSummary | null);

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
      const hay = `${r.vendor || ''} ${r.part_number || ''} ${r.part_description || ''} ${r.content_text || ''} ${r.kind} ${r.source_slug || ''}`.toLowerCase();
      return hay.includes(f);
    });
  }, [rows, filter, kindFilter]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      const av = (a as any)[sortKey];
      const bv = (b as any)[sortKey];
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

            {sorted.map((r, i) => (
              <Link
                key={r.id}
                to={`/vehicle/${vehicleId}/observation/${r.id}`}
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
                  {r.observed_at ? r.observed_at.slice(0, 10) : '—'}
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
                  {r.kind}
                </span>
                <span style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                  {r.vendor || ''}
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
                  {r.lifecycle_status || ''}
                </span>
                <span style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontSize: 9 }}>
                  {r.content_text || r.part_description || ''}
                </span>
                <span style={{ fontFamily: 'Courier New, monospace', fontSize: 8, color: 'var(--text-secondary, #666)' }}>
                  {r.source_slug || ''}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default TablePage;
