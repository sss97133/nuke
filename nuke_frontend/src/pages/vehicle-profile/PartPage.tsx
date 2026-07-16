/**
 * PartPage.tsx
 *
 * Lifecycle view for a single part number — every observation that mentions
 * this PN, ordered chronologically with purchase / install / supersession
 * markers when present. Mounted at /vehicle/:vehicleId/part/:partNumber.
 *
 * The partNumber URL segment is matched case-insensitively against
 * structured_data.part_number across all non-superseded observations on the
 * vehicle. Several spellings collapse to one view.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { optimizeImageUrl } from '../../lib/imageOptimizer';

interface PartObservation {
  id: string;
  kind: string;
  observed_at: string | null;
  source_url: string | null;
  content_text: string | null;
  vendor: string | null;
  part_number: string | null;
  part_description: string | null;
  part_category: string | null;
  lifecycle_status: string | null;
  shipment_observation_id: string | null;
  parent_receipt_id: string | null;
  witness_image_id: string | null;
  total_price: number | null;
}

interface VehicleSummary {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
}

const formatDate = (iso: string | null): string => {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
};

const PartPage: React.FC = () => {
  const { vehicleId, partNumber } = useParams<{ vehicleId: string; partNumber: string }>();
  const [vehicle, setVehicle] = useState<VehicleSummary | null>(null);
  const [items, setItems] = useState<PartObservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const partLabel = useMemo(() => {
    if (!partNumber) return '';
    return decodeURIComponent(partNumber).toUpperCase();
  }, [partNumber]);

  useEffect(() => {
    if (!vehicleId || !partNumber) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      // Same anti-cap pattern: query each kind separately so wire-specs
      // don't crowd out the part-bearing observations.
      const [vehRes, specRes, condRes, workRes] = await Promise.all([
        supabase
          .from('vehicles')
          .select('id, year, make, model, trim')
          .eq('id', vehicleId)
          .maybeSingle(),
        supabase
          .from('vehicle_observations')
          .select('id, kind, observed_at, source_url, content_text, structured_data')
          .eq('vehicle_id', vehicleId)
          .eq('is_superseded', false)
          .eq('kind', 'specification')
          .not('structured_data->>part_number', 'is', null)
          .order('observed_at', { ascending: true })
          .limit(1000),
        supabase
          .from('vehicle_observations')
          .select('id, kind, observed_at, source_url, content_text, structured_data')
          .eq('vehicle_id', vehicleId)
          .eq('is_superseded', false)
          .eq('kind', 'condition')
          .order('observed_at', { ascending: true })
          .limit(500),
        supabase
          .from('vehicle_observations')
          .select('id, kind, observed_at, source_url, content_text, structured_data')
          .eq('vehicle_id', vehicleId)
          .eq('is_superseded', false)
          .eq('kind', 'work_record')
          .order('observed_at', { ascending: true })
          .limit(1000),
      ]);

      if (cancelled) return;

      if (vehRes.error) {
        setError(`Vehicle load failed: ${vehRes.error.message}`);
        setLoading(false);
        return;
      }
      setVehicle(vehRes.data as VehicleSummary | null);

      const target = decodeURIComponent(partNumber).toLowerCase().trim();
      const combined = [
        ...((specRes.data as any[] | null) || []),
        ...((condRes.data as any[] | null) || []),
        ...((workRes.data as any[] | null) || []),
      ];
      const matches = combined.filter((r) => {
        const sd = r.structured_data || {};
        const pn = typeof sd.part_number === 'string' ? sd.part_number.toLowerCase() : '';
        return pn && pn.includes(target);
      });

      setItems(
        matches.map((r) => {
          const sd = r.structured_data || {};
          const tp = sd.total_price;
          return {
            id: r.id,
            kind: r.kind,
            observed_at: r.observed_at,
            source_url: r.source_url,
            content_text: r.content_text,
            vendor: sd.vendor ?? sd.merchant ?? null,
            part_number: sd.part_number ?? null,
            part_description: sd.part_description ?? null,
            part_category: sd.part_category ?? null,
            lifecycle_status: sd.lifecycle_status ?? null,
            shipment_observation_id: sd.shipment_observation_id ?? null,
            parent_receipt_id: sd.parent_receipt_id ?? null,
            witness_image_id: sd.witness_image_id ?? sd.install_witness_image_id ?? null,
            total_price: typeof tp === 'number' ? tp : tp ? Number(tp) : null,
          } as PartObservation;
        }),
      );
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [vehicleId, partNumber]);

  const vehLabel = vehicle
    ? `${vehicle.year ?? ''} ${vehicle.make ?? ''} ${vehicle.model ?? ''} ${vehicle.trim ?? ''}`.replace(/\s+/g, ' ').trim()
    : 'Vehicle';

  // Compute lifecycle state — has install evidence?
  const hasInstallEvidence = useMemo(() => {
    // Heuristic: any non-specification observation referencing this PN
    // counts as install/work evidence. A future install-witness pipeline can
    // promote this to a stricter check.
    return items.some((it) => it.kind !== 'specification');
  }, [items]);

  const purchaseObs = useMemo(
    () => items.filter((it) => it.lifecycle_status === 'purchased' || it.kind === 'specification'),
    [items],
  );

  const firstPurchase = purchaseObs[0] || null;
  const witness = firstPurchase?.witness_image_id || null;

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
        <Link to={`/vehicle/${vehicleId}/inventory`} style={{ color: 'inherit', textDecoration: 'none' }}>
          Inventory
        </Link>
        <span style={{ margin: '0 6px' }}>/</span>
        <span style={{ color: 'var(--text, #1a1a1a)' }}>{partLabel}</span>
      </nav>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
        <h1
          style={{
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            margin: 0,
            fontFamily: 'Courier New, monospace',
          }}
        >
          {partLabel}
        </h1>
        <span
          style={{
            fontSize: 8,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            border: `2px solid ${hasInstallEvidence ? 'var(--success, #0a7)' : 'var(--warning, #cc8800)'}`,
            color: hasInstallEvidence ? 'var(--success, #0a7)' : 'var(--warning, #cc8800)',
            padding: '2px 6px',
            fontFamily: 'Arial, sans-serif',
          }}
        >
          {hasInstallEvidence ? 'Install evidence on file' : 'Purchased, install pending'}
        </span>
      </div>
      <div
        style={{
          fontSize: 9,
          color: 'var(--text-secondary, #666)',
          marginBottom: 16,
          fontFamily: 'Courier New, monospace',
        }}
      >
        {items.length} OBSERVATION{items.length === 1 ? '' : 'S'}
        {firstPurchase?.vendor && ` · VENDOR ${firstPurchase.vendor.toUpperCase()}`}
        {firstPurchase?.part_description && ` · ${firstPurchase.part_description}`}
      </div>

      {loading && items.length === 0 && (
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', padding: 12 }}>Loading part history…</div>
      )}

      {error && (
        <div style={{ fontSize: 10, color: 'var(--error, #c00)', padding: 12, border: '2px solid var(--error, #c00)' }}>
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
          No observations match part number "{partLabel}" on this vehicle.
        </div>
      )}

      {witness && (
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
            Purchase witness image
          </h2>
          {firstPurchase?.source_url && (
            <Link
              to={`/vehicle/${vehicleId}/image/${witness}`}
              style={{ display: 'inline-block', border: '2px solid var(--text, #1a1a1a)' }}
            >
              <img
                src={optimizeImageUrl(firstPurchase.source_url, 'medium') || firstPurchase.source_url}
                alt={partLabel}
                loading="lazy"
                style={{
                  display: 'block',
                  maxWidth: '100%',
                  maxHeight: 480,
                  objectFit: 'contain',
                  background: 'var(--bg, #fff)',
                }}
              />
            </Link>
          )}
        </section>
      )}

      {/* Install-witness images: condition observations carrying
          install_witness_image_id. Surfaces the "current state / last known
          state" view of this part on the vehicle. */}
      {(() => {
        const installWitnesses = items
          .filter((it) => it.kind === 'condition')
          .map((it) => {
            const id = it.witness_image_id;
            return id ? { id, src: it.source_url, observed_at: it.observed_at, lifecycle: it.lifecycle_status } : null;
          })
          .filter(Boolean) as Array<{ id: string; src: string | null; observed_at: string | null; lifecycle: string | null }>;
        if (installWitnesses.length === 0) return null;
        return (
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
              Install evidence · {installWitnesses.length}
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
              {installWitnesses.map((w) => (
                <Link
                  key={w.id}
                  to={`/vehicle/${vehicleId}/image/${w.id}`}
                  style={{ display: 'block', border: '2px solid var(--text, #1a1a1a)', textDecoration: 'none', color: 'inherit' }}
                >
                  {w.src && (
                    <img
                      src={optimizeImageUrl(w.src, 'small') || w.src}
                      alt={`${partLabel} install`}
                      loading="lazy"
                      style={{
                        display: 'block',
                        width: '100%',
                        maxHeight: 220,
                        objectFit: 'cover',
                        background: 'var(--bg, #fff)',
                      }}
                    />
                  )}
                  <div style={{ padding: 4, fontSize: 8, fontFamily: 'Courier New, monospace', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>{w.observed_at ? w.observed_at.slice(0, 10) : '—'}</span>
                    {w.lifecycle && (
                      <span style={{ color: w.lifecycle === 'installed' ? 'var(--success, #0a7)' : 'var(--text-secondary, #666)' }}>
                        {w.lifecycle.toUpperCase()}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        );
      })()}

      {items.length > 0 && (
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
            Timeline · {items.length}
          </h2>
          <div style={{ border: '2px solid var(--text, #1a1a1a)' }}>
            {items.map((it, i) => (
              <Link
                key={it.id}
                to={`/vehicle/${vehicleId}/observation/${it.id}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '100px 100px 130px 1fr 80px',
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
                  {formatDate(it.observed_at)}
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
                  {it.kind}
                </span>
                <span style={{ fontFamily: 'Courier New, monospace', fontSize: 10 }}>{it.vendor || ''}</span>
                <span style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                  {it.part_description || it.content_text || '—'}
                </span>
                <span style={{ fontFamily: 'Courier New, monospace', fontSize: 10, textAlign: 'right' }}>
                  {it.lifecycle_status ? it.lifecycle_status.toUpperCase() : ''}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

export default PartPage;
