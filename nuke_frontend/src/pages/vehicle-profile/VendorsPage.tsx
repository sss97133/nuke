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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!vehicleId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      // Same anti-cap pattern as VendorPage: query kinds separately.
      const [vehRes, workRes, specRes, commentRes] = await Promise.all([
        supabase
          .from('vehicles')
          .select('id, year, make, model, trim')
          .eq('id', vehicleId)
          .maybeSingle(),
        supabase
          .from('vehicle_observations')
          .select('observed_at, kind, structured_data')
          .eq('vehicle_id', vehicleId)
          .eq('is_superseded', false)
          .eq('kind', 'work_record')
          .order('observed_at', { ascending: false })
          .limit(1000),
        supabase
          .from('vehicle_observations')
          .select('observed_at, kind, structured_data')
          .eq('vehicle_id', vehicleId)
          .eq('is_superseded', false)
          .eq('kind', 'specification')
          .not('structured_data->>lifecycle_status', 'is', null)
          .order('observed_at', { ascending: false })
          .limit(1000),
        supabase
          .from('vehicle_observations')
          .select('observed_at, kind, structured_data')
          .eq('vehicle_id', vehicleId)
          .eq('is_superseded', false)
          .eq('kind', 'comment')
          .order('observed_at', { ascending: false })
          .limit(500),
      ]);

      if (cancelled) return;

      if (vehRes.error) {
        setError(`Vehicle load failed: ${vehRes.error.message}`);
        setLoading(false);
        return;
      }
      setVehicle(vehRes.data as VehicleSummary | null);

      const obsList = [
        ...((workRes.data as any[] | null) || []),
        ...((specRes.data as any[] | null) || []),
        ...((commentRes.data as any[] | null) || []),
      ];

      const map = new Map<string, VendorRollup>();
      for (const r of obsList) {
        const sd = r.structured_data || {};
        const raw =
          (typeof sd.vendor === 'string' && sd.vendor) ||
          (typeof sd.merchant === 'string' && sd.merchant) ||
          null;
        if (!raw) continue;
        const cleaned = raw.trim();
        if (cleaned.length < 2) continue;
        const slug = cleaned
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '');
        if (!slug) continue;

        let row = map.get(slug);
        if (!row) {
          row = {
            name: cleaned,
            slug,
            count: 0,
            totalUsd: 0,
            firstSeen: null,
            lastSeen: null,
            hasParts: false,
          };
          map.set(slug, row);
        }
        row.count += 1;
        const total = sd.total_price ?? sd.total;
        if (typeof total === 'number' && !isNaN(total)) row.totalUsd += total;
        const oa: string | null = r.observed_at;
        if (oa) {
          if (!row.firstSeen || oa < row.firstSeen) row.firstSeen = oa;
          if (!row.lastSeen || oa > row.lastSeen) row.lastSeen = oa;
        }
        if (r.kind === 'specification') row.hasParts = true;
      }

      const list = Array.from(map.values()).sort((a, b) => b.count - a.count);
      setVendors(list);
      setLoading(false);
    })();

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
        {vendors.length} VENDORS{totalSpend > 0 && ` · ROLLED-UP $${totalSpend.toLocaleString()}`}
      </div>

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
        <div style={{ border: '2px solid var(--text, #1a1a1a)' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 60px 110px 100px 100px',
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
            <span style={{ textAlign: 'right' }}>Total</span>
            <span style={{ textAlign: 'right' }}>First</span>
            <span style={{ textAlign: 'right' }}>Last</span>
          </div>
          {vendors.map((v, i) => (
            <Link
              key={v.slug}
              to={`/vehicle/${vehicleId}/vendor/${v.slug}`}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 60px 110px 100px 100px',
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
                {v.totalUsd > 0 ? `$${v.totalUsd.toLocaleString()}` : ''}
              </span>
              <span
                style={{
                  fontFamily: 'Courier New, monospace',
                  fontSize: 9,
                  textAlign: 'right',
                  color: 'var(--text-secondary)',
                }}
              >
                {v.firstSeen ? v.firstSeen.slice(0, 10) : ''}
              </span>
              <span
                style={{
                  fontFamily: 'Courier New, monospace',
                  fontSize: 9,
                  textAlign: 'right',
                  color: 'var(--text-secondary)',
                }}
              >
                {v.lastSeen ? v.lastSeen.slice(0, 10) : ''}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};

export default VendorsPage;
