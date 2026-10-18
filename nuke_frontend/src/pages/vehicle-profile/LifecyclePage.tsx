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
  public_copy?: boolean;
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
  publicOnly: boolean;
}

const LifecyclePage: React.FC = () => {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const [vehicle, setVehicle] = useState<VehicleSummary | null>(null);
  const [obs, setObs] = useState<ObservationLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workOnly, setWorkOnly] = useState(false);
  const [historyUnavailable, setHistoryUnavailable] = useState(false);

  useEffect(() => {
    if (!vehicleId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setObs([]);
    setHistoryUnavailable(false);

    (async () => {
      // Postgrest caps a single query at ~1000 rows AND the K5 has ~1900
      // wire-spec observations that crowd out receipts/parts. Pull each
      // lifecycle-relevant slice separately with a tight kind filter — and
      // for specifications, filter to those tagged with a lifecycle_status
      // (skip wiring specs which don't carry one).
      const [vehRes, workRes, specRes, condRes, recentRes, publicWorkRes] = await Promise.all([
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
        supabase.rpc('vehicle_build_log_public', { p_vehicle_id: vehicleId }),
      ]);

      if (cancelled) return;

      if (vehRes.error) {
        setError(`Vehicle load failed: ${vehRes.error.message}`);
        setLoading(false);
        return;
      }
      setVehicle(vehRes.data as VehicleSummary | null);
      setHistoryUnavailable([workRes, specRes, condRes, recentRes, publicWorkRes].some(r => !!r.error));

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
      // The existing RPC owns masking; directly readable rows win on ID.
      for (const r of (publicWorkRes.error ? [] : publicWorkRes.data || [])) {
        if (!r.observation_id || seen.has(r.observation_id)) continue;
        seen.add(r.observation_id);
        merged.push({
          id: r.observation_id,
          kind: 'work_record',
          observed_at: r.done_on ?? null,
          content_text: [r.item, r.category,
            r.labor_minutes != null ? `${Number(r.labor_minutes)} min` : null]
            .filter(Boolean).join(' · ') || null,
          // Build stage is not part-installation evidence. Amounts and part
          // numbers are absent from this public contract, not zero.
          structured_data: { vendor: r.supplier ?? null, build_stage: r.build_stage ?? null },
          public_copy: true,
        });
      }
      merged.sort((a, b) => (b.observed_at || '').localeCompare(a.observed_at || ''));
      setObs(merged);
      setLoading(false);
    })().catch(() => {
      if (cancelled) return;
      setError('Lifecycle history could not be loaded.');
      setLoading(false);
    });

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
      workCount: obs.filter((o) => o.kind === 'work_record').length,
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
      const r = m.get(slug) || { name: raw, slug, count: 0, totalUsd: 0, publicOnly: true };
      if (!o.public_copy) r.publicOnly = false;
      r.count += 1;
      const t = sd.total_price ?? sd.total;
      if (typeof t === 'number') r.totalUsd += t;
      m.set(slug, r);
    }
    return Array.from(m.values()).sort((a, b) => b.count - a.count).slice(0, 10);
  }, [obs]);

  const recent = useMemo(
    () => obs.filter((o) => workOnly
      ? o.kind === 'work_record'
      : o.kind === 'work_record' || o.kind === 'condition' || o.kind === 'comment').slice(0, 12),
    [obs, workOnly],
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

      {historyUnavailable && (
        <div role="status" style={{ fontSize: 10, marginBottom: 12 }}>
          Some history could not be loaded; counts and activity may be incomplete.
        </div>
      )}

      {obs.some(o => o.public_copy) && (
        <p style={{ fontSize: 10, marginBottom: 12 }}>
          Permitted work records use recorded work dates; ingestion times are unavailable.
          Build stage does not establish part installation. Amounts and full details are owner-only;
          visible spend excludes masked amounts.
        </p>
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
              ['Work records', stats.workCount],
              ['Parts purchased', stats.partsPurchased],
              ['Parts installed', stats.partsInstalled],
              ['Parts pending', stats.partsPending],
              ['Comments', stats.commentCount],
              ['Conditions', stats.conditionCount],
              ['Visible spend', stats.totalSpend > 0 ? `$${stats.totalSpend.toLocaleString()}` : '—'],
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
                {topVendors.map((v, i) => {
                  const VendorRow = v.publicOnly ? 'div' : Link;
                  return (
                    <VendorRow
                      key={v.slug}
                      to={v.publicOnly ? undefined : `/vehicle/${vehicleId}/vendor/${v.slug}`}
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
                        {v.totalUsd > 0 ? `$${v.totalUsd.toLocaleString()}` : v.publicOnly ? 'Owner-only detail' : ''}
                      </span>
                    </VendorRow>
                  );
                })}
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
                {workOnly ? 'Recorded work' : 'Recent activity'} · {recent.length}
              </h2>
              {stats.workCount > 0 && (
                <button type="button" aria-pressed={workOnly} onClick={() => setWorkOnly(value => !value)}
                  style={{ fontFamily: 'Arial, sans-serif', fontSize: 9, marginBottom: 6, padding: '4px 8px', border: '2px solid var(--text, #1a1a1a)', background: 'var(--bg, #fff)', color: 'var(--text, #1a1a1a)' }}>
                  {workOnly ? 'Show all activity' : 'Show work records'}
                </button>
              )}
              <div style={{ border: '2px solid var(--text, #1a1a1a)' }}>
                {recent.map((r, i) => {
                  const sd = (r.structured_data || {}) as any;
                  const ActivityRow = r.public_copy ? 'div' : Link;
                  return (
                    <ActivityRow
                      key={r.id}
                      to={r.public_copy ? undefined : `/vehicle/${vehicleId}/observation/${r.id}`}
                      data-observation-id={r.id}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '76px 74px minmax(0, 1fr)',
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
                      <span style={{ gridColumn: '3', fontSize: 9, color: 'var(--text-secondary)' }}>
                        {r.public_copy
                          ? [sd.build_stage ? `Build stage: ${sd.build_stage}` : null, 'Owner-only detail'].filter(Boolean).join(' · ')
                          : sd.lifecycle_status || ''}
                      </span>
                    </ActivityRow>
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
