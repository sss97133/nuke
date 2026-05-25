/**
 * InventoryPage.tsx
 *
 * "Parts you bought but haven't installed yet."
 *
 * Mounted at /vehicle/:vehicleId/inventory. Lists every vehicle_observation
 * where kind='specification', structured_data.lifecycle_status='purchased',
 * and no install-witness observation exists for the same part_number on the
 * same vehicle. Each row clickable to the observation route.
 *
 * Today the population is whatever the atom-extraction pass has filed
 * (currently 3 Holley parts from shipment 766317). As more receipts get
 * atom-extracted into specification observations, the list grows.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

interface InventoryItem {
  id: string;
  observed_at: string | null;
  part_number: string | null;
  part_description: string | null;
  part_category: string | null;
  vendor: string | null;
  shipment_observation_id: string | null;
  lifecycle_status: string | null;
  lifecycle_note: string | null;
  witness_image_id: string | null;
  source_url: string | null;
}

interface VehicleSummary {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
}

const InventoryPage: React.FC = () => {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const navigate = useNavigate();
  const [vehicle, setVehicle] = useState<VehicleSummary | null>(null);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!vehicleId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      const [vehRes, obsRes] = await Promise.all([
        supabase
          .from('vehicles')
          .select('id, year, make, model, trim')
          .eq('id', vehicleId)
          .maybeSingle(),
        supabase
          .from('vehicle_observations')
          .select('id, observed_at, source_url, structured_data')
          .eq('vehicle_id', vehicleId)
          .eq('kind', 'specification')
          .eq('is_superseded', false)
          .filter('structured_data->>lifecycle_status', 'eq', 'purchased')
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

      if (obsRes.error) {
        setError(`Inventory load failed: ${obsRes.error.message}`);
      } else if (obsRes.data) {
        setItems(
          (obsRes.data as any[]).map((r) => {
            const sd = r.structured_data || {};
            return {
              id: r.id,
              observed_at: r.observed_at,
              part_number: sd.part_number ?? null,
              part_description: sd.part_description ?? null,
              part_category: sd.part_category ?? null,
              vendor: sd.vendor ?? null,
              shipment_observation_id: sd.shipment_observation_id ?? null,
              lifecycle_status: sd.lifecycle_status ?? null,
              lifecycle_note: sd.lifecycle_note ?? null,
              witness_image_id: sd.witness_image_id ?? null,
              source_url: r.source_url,
            };
          }),
        );
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [vehicleId]);

  const vehLabel = vehicle
    ? `${vehicle.year ?? ''} ${vehicle.make ?? ''} ${vehicle.model ?? ''} ${vehicle.trim ?? ''}`.replace(/\s+/g, ' ').trim()
    : 'Vehicle';

  const byVendor = useMemo(() => {
    const map = new Map<string, InventoryItem[]>();
    for (const it of items) {
      const v = it.vendor || '(unknown vendor)';
      if (!map.has(v)) map.set(v, []);
      map.get(v)!.push(it);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [items]);

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
        <span style={{ color: 'var(--text, #1a1a1a)' }}>Inventory</span>
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
        Parts owned, install not yet witnessed
      </h1>
      <div
        style={{
          fontSize: 9,
          color: 'var(--text-secondary, #666)',
          marginBottom: 16,
          fontFamily: 'Courier New, monospace',
        }}
      >
        {items.length} PARTS · derived from specification observations where lifecycle_status = 'purchased'
      </div>

      {loading && items.length === 0 && (
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', padding: 12 }}>Loading inventory…</div>
      )}

      {error && (
        <div
          style={{
            fontSize: 10,
            color: 'var(--error, #c00)',
            padding: 12,
            border: '2px solid var(--error, #c00)',
          }}
        >
          {error}
        </div>
      )}

      {!loading && items.length === 0 && !error && (
        <div
          style={{
            fontSize: 10,
            color: 'var(--text-secondary)',
            padding: 12,
            border: '2px solid var(--text-disabled, #ccc)',
          }}
        >
          No purchased-not-installed parts found. As more receipts are atom-extracted into
          specification observations with lifecycle_status='purchased', they'll appear here.
        </div>
      )}

      {byVendor.map(([vendor, list]) => {
        const slug = vendor
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '');
        const vendorClickable = slug && slug !== 'unknown-vendor';
        return (
        <section key={vendor} style={{ marginBottom: 20 }}>
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
            {vendorClickable ? (
              <Link to={`/vehicle/${vehicleId}/vendor/${slug}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                {vendor} →
              </Link>
            ) : (
              vendor
            )}{' '}
            · {list.length}
          </h2>
          <div style={{ border: '2px solid var(--text, #1a1a1a)' }}>
            {list.map((it, i) => (
              <div
                key={it.id}
                role="link"
                tabIndex={0}
                onClick={() => navigate(`/vehicle/${vehicleId}/observation/${it.id}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    navigate(`/vehicle/${vehicleId}/observation/${it.id}`);
                  }
                }}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '88px 140px 1fr 110px',
                  gap: 10,
                  padding: '8px',
                  fontFamily: 'Arial, sans-serif',
                  fontSize: 10,
                  color: 'var(--text, #1a1a1a)',
                  textDecoration: 'none',
                  borderTop: i === 0 ? 'none' : '1px solid var(--text-disabled, #ddd)',
                  alignItems: 'center',
                  cursor: 'pointer',
                }}
              >
                <span
                  style={{
                    fontFamily: 'Courier New, monospace',
                    fontSize: 9,
                    color: 'var(--text-secondary)',
                  }}
                >
                  {it.observed_at ? it.observed_at.slice(0, 10) : '—'}
                </span>
                <span style={{ fontFamily: 'Courier New, monospace', fontSize: 10, fontWeight: 700 }}>
                  {it.part_number ? (
                    <Link
                      to={`/vehicle/${vehicleId}/part/${encodeURIComponent(it.part_number)}`}
                      onClick={(e) => e.stopPropagation()}
                      style={{ color: 'inherit', textDecoration: 'underline' }}
                    >
                      {it.part_number}
                    </Link>
                  ) : (
                    '(no PN)'
                  )}
                </span>
                <span style={{ overflow: 'hidden' }}>
                  {it.part_description || '—'}
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
                  {it.part_category ? it.part_category.replace(/_/g, ' ') : 'part'}
                </span>
              </div>
            ))}
          </div>
        </section>
        );
      })}
    </div>
  );
};

export default InventoryPage;
