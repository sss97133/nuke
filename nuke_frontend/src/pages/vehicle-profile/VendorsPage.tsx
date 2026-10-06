/**
 * VendorsPage.tsx
 *
 * Vendor directory for one vehicle. Lists every distinct merchant/vendor
 * across non-superseded observations, with counts, total $ when known,
 * and first/last purchase dates. Each row links to /vendor/:slug.
 *
 * Mounted at /vehicle/:vehicleId/vendors. The per-vendor detail lives at
 * /vehicle/:vehicleId/vendor/:vendorSlug — this is the index, that is the leaf.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

interface VendorRollup {
  name: string;
  slug: string;
  count: number;
  totalUsd: number;
  firstSeen: string | null;
  lastSeen: string | null;
  hasParts: boolean;
  maskedCount: number;
  groupKey: string;
}

interface VehicleSummary {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
}

const VendorsPage: React.FC = () => {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const [vehicle, setVehicle] = useState<VehicleSummary | null>(null);
  const [vendors, setVendors] = useState<VendorRollup[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyUnavailable, setHistoryUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!vehicleId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setHistoryUnavailable(false);
    setVendors([]);

    (async () => {
      // Same anti-cap pattern as VendorPage: query kinds separately.
      const [vehRes, workRes, specRes, commentRes, publicWorkRes] = await Promise.all([
        supabase
          .from('vehicles')
          .select('id, year, make, model, trim')
          .eq('id', vehicleId)
          .maybeSingle(),
        supabase
          .from('vehicle_observations')
          .select('id, observed_at, kind, structured_data')
          .eq('vehicle_id', vehicleId)
          .eq('is_superseded', false)
          .eq('kind', 'work_record')
          .order('observed_at', { ascending: false })
          .limit(1000),
        supabase
          .from('vehicle_observations')
          .select('id, observed_at, kind, structured_data')
          .eq('vehicle_id', vehicleId)
          .eq('is_superseded', false)
          .eq('kind', 'specification')
          .not('structured_data->>lifecycle_status', 'is', null)
          .order('observed_at', { ascending: false })
          .limit(1000),
        supabase
          .from('vehicle_observations')
          .select('id, observed_at, kind, structured_data')
          .eq('vehicle_id', vehicleId)
          .eq('is_superseded', false)
          .eq('kind', 'comment')
          .order('observed_at', { ascending: false })
          .limit(500),
        supabase.rpc('vehicle_build_log_public', { p_vehicle_id: vehicleId }),
      ]);

      if (cancelled) return;

      if (vehRes.error) {
        setError(`Vehicle load failed: ${vehRes.error.message}`);
        setLoading(false);
        return;
      }
      setVehicle(vehRes.data as VehicleSummary | null);

      setHistoryUnavailable([workRes, specRes, commentRes, publicWorkRes].some(r => !!r.error));
      const obsList: any[] = [
        ...((workRes.data as any[] | null) || []),
        ...((specRes.data as any[] | null) || []),
        ...((commentRes.data as any[] | null) || []),
      ];

      // Canonical observation ID prevents the masked copy doubling owner rows.
      const seen = new Set(obsList.map(r => r.id));
      for (const r of (publicWorkRes.error ? [] : publicWorkRes.data || [])) {
        if (!r.observation_id || seen.has(r.observation_id)) continue;
        seen.add(r.observation_id);
        obsList.push({ id: r.observation_id, kind: 'work_record', observed_at: r.done_on ?? null,
          structured_data: { supplier: r.supplier ?? null }, public_copy: true });
      }

      const map = new Map<string, VendorRollup>();
      for (const r of obsList) {
        const sd = r.structured_data || {};
        const raw =
          (typeof sd.vendor === 'string' && sd.vendor) ||
          (typeof sd.merchant === 'string' && sd.merchant) ||
          (typeof sd.supplier === 'string' && sd.supplier) ||
          null;
        // Unnamed work is evidence too; keep it explicitly unresolved.
        const unknownSupplier = !raw?.trim();
        if (unknownSupplier && r.kind !== 'work_record') continue;
        const cleaned = unknownSupplier ? 'Supplier unrecorded' : raw!.trim();
        const slug = cleaned
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '');

        // Presentation grouping only; this is not an organization identity.
        const groupKey = unknownSupplier ? '__unrecorded__' : cleaned.toLowerCase();
        let row = map.get(groupKey);
        if (!row) {
          row = {
            name: cleaned,
            groupKey,
            slug,
            count: 0,
            totalUsd: 0,
            firstSeen: null,
            lastSeen: null,
            hasParts: false,
            maskedCount: 0,
          };
          map.set(groupKey, row);
        }
        row.count += 1;
        if (r.public_copy || unknownSupplier || !slug) row.maskedCount += 1;
        const total = sd.total_price ?? sd.total;
        if (typeof total === 'number' && !isNaN(total)) row.totalUsd += total;
        const oa: string | null = r.kind === 'work_record' && typeof sd.transaction_date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(sd.transaction_date)
          ? sd.transaction_date.slice(0, 10) : r.observed_at;
        if (oa) {
          if (!row.firstSeen || oa < row.firstSeen) row.firstSeen = oa;
          if (!row.lastSeen || oa > row.lastSeen) row.lastSeen = oa;
        }
        if (r.kind === 'specification') row.hasParts = true;
      }

      const list = Array.from(map.values()).sort((a, b) => b.count - a.count);
      setVendors(list);
      setLoading(false);
    })().catch(() => {
      if (cancelled) return;
      setError('Vendor history could not be loaded.');
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [vehicleId]);

  const vehLabel = vehicle
    ? `${vehicle.year ?? ''} ${vehicle.make ?? ''} ${vehicle.model ?? ''} ${vehicle.trim ?? ''}`.replace(/\s+/g, ' ').trim()
    : 'Vehicle';

  const totalSpend = useMemo(
    () => vendors.reduce((s, v) => s + v.totalUsd, 0),
    [vendors],
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
        <span style={{ color: 'var(--text, #1a1a1a)' }}>Vendors</span>
      </nav>

      <h1
        style={{
          fontSize: 14,
          fontWeight: 700,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          margin: '0 0 4px',
          fontFamily: 'Arial, sans-serif',
        }}
      >
        Vendors
      </h1>
      <div
        style={{
          fontSize: 9,
          color: 'var(--text-secondary, #666)',
          marginBottom: 16,
          fontFamily: 'Courier New, monospace',
        }}
      >
        {vendors.length} SUPPLIER GROUPS{totalSpend > 0 && ` · VISIBLE $${totalSpend.toLocaleString()}`}
      </div>

      <p style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 12 }}>
        Supplier names group readable observations, not verified organizations. Dates are recorded work or observation dates;
        ingestion times are unavailable for public work. Visible totals exclude masked amounts.
        {' '}<Link to={`/vehicle/${vehicleId}/table`}>View work evidence</Link>
      </p>
      {historyUnavailable && <div role="status" style={{ fontSize: 10, marginBottom: 12 }}>
        Some vendor history could not be loaded; counts and dates may be incomplete.
      </div>}

      {loading && vendors.length === 0 && (
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', padding: 12 }}>Loading vendors…</div>
      )}

      {error && (
        <div style={{ fontSize: 10, color: 'var(--error, #c00)', padding: 12, border: '2px solid var(--error, #c00)' }}>
          {error}
        </div>
      )}

      {!loading && vendors.length === 0 && !error && (
        <div
          style={{
            fontSize: 10,
            color: 'var(--text-secondary)',
            padding: 12,
            border: '2px solid var(--text-disabled, #ccc)',
          }}
        >
          No vendors found on this vehicle's observations.
        </div>
      )}

      {vendors.length > 0 && (
        <div style={{ border: '2px solid var(--text, #1a1a1a)', overflowX: 'auto' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(150px, 1fr) 40px 80px 80px 80px',
              minWidth: 470,
              gap: 10,
              padding: '6px 8px',
              fontFamily: 'Arial, sans-serif',
              fontSize: 7,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--text-secondary, #666)',
              borderBottom: '2px solid var(--text, #1a1a1a)',
            }}
          >
            <span>Vendor</span>
            <span style={{ textAlign: 'right' }}>Obs</span>
            <span style={{ textAlign: 'right' }}>Visible total</span>
            <span style={{ textAlign: 'right' }}>First</span>
            <span style={{ textAlign: 'right' }}>Last</span>
          </div>
          {vendors.map((v, i) => {
            return <Link
              key={v.groupKey}
              data-vendor-group={v.groupKey}
              to={`/vehicle/${vehicleId}/vendor/${v.slug || 'supplier'}?${v.groupKey === '__unrecorded__' ? 'unrecorded=1' : `supplier=${encodeURIComponent(v.name)}`}`}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(150px, 1fr) 40px 80px 80px 80px',
                minWidth: 470,
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
              <span style={{ fontWeight: 700, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                {v.name}
                {v.maskedCount > 0 && <small style={{ display: 'block', fontSize: 8 }}>View permitted work</small>}
                {v.hasParts && (
                  <span
                    style={{
                      marginLeft: 6,
                      fontSize: 7,
                      fontWeight: 700,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      border: '1px solid var(--success, #0a7)',
                      color: 'var(--success, #0a7)',
                      padding: '1px 4px',
                    }}
                  >
                    Parts
                  </span>
                )}
              </span>
              <span style={{ fontFamily: 'Courier New, monospace', textAlign: 'right' }}>{v.count}</span>
              <span style={{ fontFamily: 'Courier New, monospace', textAlign: 'right' }}>
                {v.totalUsd > 0 ? `$${v.totalUsd.toLocaleString()}` : '—'}
              </span>
              <span
                style={{
                  fontFamily: 'Courier New, monospace',
                  fontSize: 9,
                  textAlign: 'right',
                  color: 'var(--text-secondary)',
                }}
              >
                {v.firstSeen ? v.firstSeen.slice(0, 10) : '—'}
              </span>
              <span
                style={{
                  fontFamily: 'Courier New, monospace',
                  fontSize: 9,
                  textAlign: 'right',
                  color: 'var(--text-secondary)',
                }}
              >
                {v.lastSeen ? v.lastSeen.slice(0, 10) : '—'}
              </span>
            </Link>;
          })}
        </div>
      )}
    </div>
  );
};

export default VendorsPage;
