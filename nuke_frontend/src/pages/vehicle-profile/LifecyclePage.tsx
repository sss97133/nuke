/**
 * LifecyclePage.tsx
 *
 * Substrate dashboard for one vehicle: aggregate counts and spend across
 * the lifecycle states (purchased / installed / unknown), top vendors,
 * recent activity. Read-only aggregation; no new substrate writes.
 *
 * Mounted at /vehicle/:vehicleId/lifecycle.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

interface ObservationLite {
  id: string;
  kind: string;
  observed_at: string | null;
  content_text: string | null;
  structured_data: Record<string, unknown> | null;
}

interface VehicleSummary {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
}

interface VendorCount {
  name: string;
  slug: string;
  count: number;
  totalUsd: number;
}

const LifecyclePage: React.FC = () => {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const [vehicle, setVehicle] = useState<VehicleSummary | null>(null);
  const [obs, setObs] = useState<ObservationLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!vehicleId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      // Postgrest caps a single query at ~1000 rows AND the K5 has ~1900
      // wire-spec observations that crowd out receipts/parts. Pull each
      // lifecycle-relevant slice separately with a tight kind filter — and
      // for specifications, filter to those tagged with a lifecycle_status
      // (skip wiring specs which don't carry one).
      const [vehRes, workRes, specRes, condRes, recentRes] = await Promise.all([
        supabase
          .from('vehicles')
          .select('id, year, make, model, trim')
          .eq('id', vehicleId)
          .maybeSingle(),
        supabase
          .from('vehicle_observations')
          .select('id, kind, observed_at, content_text, structured_data')
          .eq('vehicle_id', vehicleId)
          .eq('is_superseded', false)
          .eq('kind', 'work_record')
          .order('observed_at', { ascending: false })
          .limit(1000),
        supabase
          .from('vehicle_observations')
          .select('id, kind, observed_at, content_text, structured_data')
          .eq('vehicle_id', vehicleId)
          .eq('is_superseded', false)
          .eq('kind', 'specification')
          .not('structured_data->>lifecycle_status', 'is', null)
          .order('observed_at', { ascending: false })
          .limit(1000),
        supabase
          .from('vehicle_observations')
          .select('id, kind, observed_at, content_text, structured_data')
          .eq('vehicle_id', vehicleId)
          .eq('is_superseded', false)
          .eq('kind', 'condition')
          .order('observed_at', { ascending: false })
          .limit(1000),
        // Recent activity uses the same filtered set (no wire-specs).
        supabase
          .from('vehicle_observations')
          .select('id, kind, observed_at, content_text, structured_data')
          .eq('vehicle_id', vehicleId)
          .eq('is_superseded', false)
          .in('kind', ['work_record', 'condition', 'comment'])
          .order('observed_at', { ascending: false })
          .limit(20),
      ]);

      if (cancelled) return;

      if (vehRes.error) {
        setError(`Vehicle load failed: ${vehRes.error.message}`);
        setLoading(false);
        return;
      }
      setVehicle(vehRes.data as VehicleSummary | null);

      const combined: any[] = [
        ...((workRes.data as any[] | null) || []),
        ...((specRes.data as any[] | null) || []),
        ...((condRes.data as any[] | null) || []),
        ...((recentRes.data as any[] | null) || []),
      ];
      // Dedupe by id (recentRes overlaps with workRes/condRes)
      const seen = new Set<string>();
      const merged: any[] = [];
      for (const r of combined) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        merged.push(r);
      }
      merged.sort((a, b) => (b.observed_at || '').localeCompare(a.observed_at || ''));
      setObs(merged);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [vehicleId]);

  const vehLabel = vehicle
    ? `${vehicle.year ?? ''} ${vehicle.make ?? ''} ${vehicle.model ?? ''} ${vehicle.trim ?? ''}`.replace(/\s+/g, ' ').trim()
    : 'Vehicle';

  const stats = useMemo(() => {
    const specs = obs.filter((o) => o.kind === 'specification');
    const conditions = obs.filter((o) => o.kind === 'condition');
    const purchased = specs.filter((o) => {
      const sd = (o.structured_data || {}) as any;
      return sd.lifecycle_status === 'purchased';
    });
    const installed = conditions.filter((o) => {
      const sd = (o.structured_data || {}) as any;
      return sd.lifecycle_status === 'installed';
    });

    // Set of part_numbers with install evidence
    const installedPNs = new Set<string>();
    for (const c of installed) {
      const sd = (c.structured_data || {}) as any;
      if (typeof sd.part_number === 'string') installedPNs.add(sd.part_number.toLowerCase());
    }
    const purchasedPNs = new Set<string>();
    for (const p of purchased) {
      const sd = (p.structured_data || {}) as any;
      if (typeof sd.part_number === 'string') purchasedPNs.add(sd.part_number.toLowerCase());
    }

    const stillPending = Array.from(purchasedPNs).filter((pn) => !installedPNs.has(pn));

    let totalSpend = 0;
    for (const o of obs) {
      const sd = (o.structured_data || {}) as any;
      const t = sd.total_price ?? sd.total;
      if (typeof t === 'number') totalSpend += t;
    }

    return {
      totalObservations: obs.length,
      partsPurchased: purchasedPNs.size,
      partsInstalled: installedPNs.size,
      partsPending: stillPending.length,
      totalSpend,
      receiptCount: obs.filter((o) => o.kind === 'work_record').length,
      commentCount: obs.filter((o) => o.kind === 'comment').length,
      conditionCount: conditions.length,
    };
  }, [obs]);

  const topVendors = useMemo<VendorCount[]>(() => {
    const m = new Map<string, VendorCount>();
    for (const o of obs) {
      const sd = (o.structured_data || {}) as any;
      const raw = (typeof sd.vendor === 'string' && sd.vendor) || (typeof sd.merchant === 'string' && sd.merchant) || null;
      if (!raw) continue;
      const slug = raw
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      if (!slug || slug === 'unknown-vendor') continue;
      const r = m.get(slug) || { name: raw, slug, count: 0, totalUsd: 0 };
      r.count += 1;
      const t = sd.total_price ?? sd.total;
      if (typeof t === 'number') r.totalUsd += t;
      m.set(slug, r);
    }
    return Array.from(m.values()).sort((a, b) => b.count - a.count).slice(0, 10);
  }, [obs]);

  const recent = useMemo(
    () => obs.filter((o) => o.kind === 'work_record' || o.kind === 'condition' || o.kind === 'comment').slice(0, 12),
    [obs],
  );

  return (
    <div
      style={{
        maxWidth: 1100,
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
        <span style={{ color: 'var(--text, #1a1a1a)' }}>Lifecycle</span>
      </nav>

      <h1
        style={{
          fontSize: 14,
          fontWeight: 700,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          margin: '0 0 16px',
          fontFamily: 'Arial, sans-serif',
        }}
      >
        Substrate lifecycle
      </h1>

      {loading && obs.length === 0 && (
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', padding: 12 }}>Loading lifecycle stats…</div>
      )}

      {error && (
        <div style={{ fontSize: 10, color: 'var(--error, #c00)', padding: 12, border: '2px solid var(--error, #c00)' }}>
          {error}
        </div>
      )}

      {obs.length > 0 && (
        <>
          {/* Stat tiles */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 8,
              marginBottom: 24,
            }}
          >
            {([
              ['Observations', stats.totalObservations],
              ['Receipts', stats.receiptCount],
              ['Parts purchased', stats.partsPurchased],
              ['Parts installed', stats.partsInstalled],
              ['Parts pending', stats.partsPending],
              ['Comments', stats.commentCount],
              ['Conditions', stats.conditionCount],
              ['Rolled-up spend', stats.totalSpend > 0 ? `$${stats.totalSpend.toLocaleString()}` : '—'],
            ] as [string, number | string][]).map(([label, value]) => (
              <div
                key={label}
                style={{
                  border: '2px solid var(--text, #1a1a1a)',
                  padding: '8px 10px',
                }}
              >
                <div
                  style={{
                    fontSize: 7,
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: 'var(--text-secondary, #666)',
                  }}
                >
                  {label}
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'Courier New, monospace', marginTop: 4 }}>
                  {value}
                </div>
              </div>
            ))}
          </div>

          {/* Top vendors */}
          {topVendors.length > 0 && (
            <section style={{ marginBottom: 24 }}>
              <h2
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  margin: '0 0 6px',
                  paddingBottom: 2,
                  borderBottom: '2px solid var(--text, #1a1a1a)',
                  fontFamily: 'Arial, sans-serif',
                }}
              >
                Top vendors · {topVendors.length}
              </h2>
              <div style={{ border: '2px solid var(--text, #1a1a1a)' }}>
                {topVendors.map((v, i) => (
                  <Link
                    key={v.slug}
                    to={`/vehicle/${vehicleId}/vendor/${v.slug}`}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 70px 110px',
                      gap: 10,
                      padding: '6px 8px',
                      fontFamily: 'Arial, sans-serif',
                      fontSize: 10,
                      color: 'var(--text, #1a1a1a)',
                      textDecoration: 'none',
                      borderTop: i === 0 ? 'none' : '1px solid var(--text-disabled, #ddd)',
                      alignItems: 'center',
                    }}
                  >
                    <span style={{ fontWeight: 700 }}>{v.name}</span>
                    <span style={{ fontFamily: 'Courier New, monospace', textAlign: 'right' }}>{v.count}</span>
                    <span style={{ fontFamily: 'Courier New, monospace', textAlign: 'right' }}>
                      {v.totalUsd > 0 ? `$${v.totalUsd.toLocaleString()}` : ''}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Recent activity */}
          {recent.length > 0 && (
            <section style={{ marginBottom: 24 }}>
              <h2
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  margin: '0 0 6px',
                  paddingBottom: 2,
                  borderBottom: '2px solid var(--text, #1a1a1a)',
                  fontFamily: 'Arial, sans-serif',
                }}
              >
                Recent activity · {recent.length}
              </h2>
              <div style={{ border: '2px solid var(--text, #1a1a1a)' }}>
                {recent.map((r, i) => {
                  const sd = (r.structured_data || {}) as any;
                  return (
                    <Link
                      key={r.id}
                      to={`/vehicle/${vehicleId}/observation/${r.id}`}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '92px 86px 1fr 100px',
                        gap: 8,
                        padding: '6px 8px',
                        fontFamily: 'Arial, sans-serif',
                        fontSize: 10,
                        color: 'var(--text, #1a1a1a)',
                        textDecoration: 'none',
                        borderTop: i === 0 ? 'none' : '1px solid var(--text-disabled, #ddd)',
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
                        }}
                      >
                        {r.kind}
                      </span>
                      <span style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                        {(() => {
                          const raw = r.content_text || sd.part_description || sd.merchant || '—';
                          // Truncate to first sentence-ish so a long commingling
                          // comment doesn't dominate the row.
                          const cut = raw.length > 90 ? raw.slice(0, 90).replace(/\s+\S*$/, '') + '…' : raw;
                          return cut;
                        })()}
                      </span>
                      <span style={{ fontFamily: 'Courier New, monospace', fontSize: 9, color: 'var(--text-secondary)', textAlign: 'right' }}>
                        {sd.lifecycle_status || ''}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
};

export default LifecyclePage;
