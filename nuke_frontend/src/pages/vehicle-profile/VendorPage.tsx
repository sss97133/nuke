/**
 * VendorPage.tsx
 *
 * Current bounded observations on this vehicle for a supplier text group (matched
 * case-insensitively against vendor, merchant and supplier testimony).
 *
 * Mounted at /vehicle/:vehicleId/vendor/:vendorSlug. The slug is a free-text
 * substring for legacy links; directory links use an exact supplier query. "holley" matches
 * "Holley", "Holley Performance Products", "Holley Performance Products, Inc.".
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

interface VendorObservation {
  id: string;
  kind: string;
  observed_at: string | null;
  source_url: string | null;
  content_text: string | null;
  merchant: string | null;
  part_number: string | null;
  part_description: string | null;
  total_price: number | null;
  shipment_number: string | null;
  parent_receipt_id: string | null;
  lifecycle_status: string | null;
  public_copy?: boolean;
}

interface VehicleSummary {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
}

const titleCase = (s: string): string =>
  s
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

const VendorPage: React.FC = () => {
  const { vehicleId, vendorSlug } = useParams<{ vehicleId: string; vendorSlug: string }>();
  const [searchParams] = useSearchParams();
  const supplier = searchParams.get('supplier');
  const unrecorded = searchParams.get('unrecorded') === '1';
  const [historyUnavailable, setHistoryUnavailable] = useState(false);
  const [vehicle, setVehicle] = useState<VehicleSummary | null>(null);
  const [items, setItems] = useState<VendorObservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const vendorLabel = useMemo(() => unrecorded ? 'Supplier unrecorded' : supplier || titleCase(vendorSlug || ''), [vendorSlug, supplier, unrecorded]);

  useEffect(() => {
    if (!vehicleId || !vendorSlug) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setItems([]);
    setHistoryUnavailable(false);

    (async () => {
      // PostgREST caps each query at ~1000 rows. The K5 has ~1900 wire-spec
      // observations that crowd out the receipts/parts we care about here.
      // Fetch each relevant kind separately so vendor matches survive the cap.
      const [vehRes, workRes, specRes, commentRes, publicWorkRes] = await Promise.all([
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
          .eq('kind', 'work_record')
          .order('observed_at', { ascending: false })
          .limit(1000),
        supabase
          .from('vehicle_observations')
          .select('id, kind, observed_at, source_url, content_text, structured_data')
          .eq('vehicle_id', vehicleId)
          .eq('is_superseded', false)
          .eq('kind', 'specification')
          .not('structured_data->>lifecycle_status', 'is', null)
          .order('observed_at', { ascending: false })
          .limit(1000),
        supabase
          .from('vehicle_observations')
          .select('id, kind, observed_at, source_url, content_text, structured_data')
          .eq('vehicle_id', vehicleId)
          .eq('is_superseded', false)
          .eq('kind', 'comment')
          .order('observed_at', { ascending: false })
          .limit(500),
        supabase.rpc('vehicle_build_log_public', { p_vehicle_id: vehicleId }),
      ]);

      if (cancelled) return;

      if (vehRes.error) {
        setError('Vehicle could not be loaded.');
        setLoading(false);
        return;
      }
      setVehicle(vehRes.data as VehicleSummary | null);

      setHistoryUnavailable([workRes, specRes, commentRes, publicWorkRes].some(r => !!r.error) ||
        (workRes.data?.length ?? 0) >= 1000 || (specRes.data?.length ?? 0) >= 1000 || (commentRes.data?.length ?? 0) >= 500);
      const combined = [
        ...((workRes.data as any[] | null) || []),
        ...((specRes.data as any[] | null) || []),
        ...((commentRes.data as any[] | null) || []),
      ];

      const seen = new Set(combined.map(r => r.id));
      for (const r of (publicWorkRes.error ? [] : publicWorkRes.data || [])) {
        if (!r.observation_id || seen.has(r.observation_id)) continue;
        seen.add(r.observation_id);
        combined.push({ id: r.observation_id, kind: 'work_record', observed_at: r.done_on ?? null,
          content_text: r.item ?? null, public_copy: true,
          structured_data: { supplier: r.supplier ?? null, category: r.category ?? null, build_stage: r.build_stage ?? null } });
      }

      const slugLower = vendorSlug.toLowerCase();
      const matches = combined.filter((r) => {
        const sd = r.structured_data || {};
        const m = (typeof sd.merchant === 'string' ? sd.merchant : '').toLowerCase();
        const v = (typeof sd.vendor === 'string' ? sd.vendor : '').toLowerCase();
        const supplied = typeof sd.supplier === 'string' ? sd.supplier.trim().toLowerCase() : '';
        const name = v.trim() || m.trim() || supplied;
        if (unrecorded) return r.kind === 'work_record' && !name;
        if (supplier !== null) return name === supplier.trim().toLowerCase();
        return m.includes(slugLower) || v.includes(slugLower) || supplied.includes(slugLower);
      });

      const merged = matches.map((r) => {
        const sd = r.structured_data || {};
        const tp = sd.total_price ?? sd.total;
        const price = typeof tp === 'number' ? tp : typeof tp === 'string' && tp.trim() ? Number(tp) : NaN;
        return {
          id: r.id,
          kind: r.kind,
          observed_at: r.kind === 'work_record' && typeof sd.transaction_date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(sd.transaction_date) ? sd.transaction_date.slice(0, 10) : r.observed_at,
          source_url: r.source_url,
          content_text: r.content_text,
          merchant: sd.merchant ?? sd.vendor ?? sd.supplier ?? null,
          part_number: sd.part_number ?? null,
          part_description: sd.part_description ?? null,
          total_price: Number.isFinite(price) ? price : null,
          shipment_number: sd.shipment_number ?? null,
          parent_receipt_id: sd.parent_receipt_id ?? sd.shipment_observation_id ?? null,
          lifecycle_status: sd.lifecycle_status ?? null,
          public_copy: !!r.public_copy,
        } as VendorObservation;
      });

      merged.sort((a, b) => {
        const ta = a.observed_at || '';
        const tb = b.observed_at || '';
        return tb.localeCompare(ta);
      });

      setItems(merged);
      setLoading(false);
    })().catch(() => {
      if (cancelled) return;
      setError('Vendor history could not be loaded.');
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [vehicleId, vendorSlug, supplier, unrecorded]);

  const vehLabel = vehicle
    ? `${vehicle.year ?? ''} ${vehicle.make ?? ''} ${vehicle.model ?? ''} ${vehicle.trim ?? ''}`.replace(/\s+/g, ' ').trim()
    : 'Vehicle';

  // Group by shipment_number (if any), else by ISO month
  const grouped = useMemo(() => {
    const m = new Map<string, VendorObservation[]>();
    for (const it of items) {
      const key = it.shipment_number
        ? `shipment:${it.shipment_number}`
        : it.observed_at
          ? `month:${it.observed_at.slice(0, 7)}`
          : 'month:unknown';
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(it);
    }
    return Array.from(m.entries()).sort((a, b) => {
      // shipments first (more specific), then months descending
      if (a[0].startsWith('shipment:') && !b[0].startsWith('shipment:')) return -1;
      if (!a[0].startsWith('shipment:') && b[0].startsWith('shipment:')) return 1;
      return b[0].localeCompare(a[0]);
    });
  }, [items]);

  const totalSpend = useMemo(
    () => items.reduce((s, it) => s + (it.total_price || 0), 0),
    [items],
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
        <span>Vendor</span>
        <span style={{ margin: '0 6px' }}>/</span>
        <span style={{ color: 'var(--text, #1a1a1a)' }}>{vendorLabel}</span>
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
        {vendorLabel}
      </h1>
      <div
        style={{
          fontSize: 9,
          color: 'var(--text-secondary, #666)',
          marginBottom: 16,
          fontFamily: 'Courier New, monospace',
        }}
      >
        {items.length} OBSERVATION{items.length === 1 ? '' : 'S'}
        {totalSpend > 0 && ` · VISIBLE TOTAL $${totalSpend.toLocaleString()}`}
      </div>

      <p style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
        Supplier names are text groups, not verified organizations. Dates are recorded work or observation dates;
        ingestion times are unavailable for public work. Visible totals exclude masked amounts.
      </p>
      {historyUnavailable && <div role="status" style={{ fontSize: 10 }}>Some vendor history could not be loaded; counts and dates may be incomplete.</div>}
      {loading && items.length === 0 && (
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', padding: 12 }}>Loading vendor history…</div>
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
          No observations match "{vendorLabel}" on this vehicle.
        </div>
      )}

      {grouped.map(([groupKey, list]) => (
        <section key={groupKey} style={{ marginBottom: 20 }}>
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
            {groupKey.startsWith('shipment:')
              ? `Shipment ${groupKey.slice('shipment:'.length)} · ${list.length}`
              : `${groupKey.slice('month:'.length)} · ${list.length}`}
          </h2>
          <div style={{ border: '2px solid var(--text, #1a1a1a)', overflowX: 'auto' }}>
            {list.map((it, i) => {
              const Row = it.public_copy ? 'div' : Link;
              return (
              <Row
                key={it.id}
                data-observation-id={it.id}
                {...(it.public_copy ? {} : { to: `/vehicle/${vehicleId}/observation/${it.id}` })}
                style={{
                  display: 'grid',
                  gridTemplateColumns: it.public_copy ? '70px 80px minmax(0, 1fr)' : '90px 86px 130px minmax(150px, 1fr) 80px',
                  minWidth: it.public_copy ? undefined : 580,
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
                  {it.observed_at ? it.observed_at.slice(0, 10) : '—'}
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
                {!it.public_copy && <span style={{ fontFamily: 'Courier New, monospace', fontSize: 10, fontWeight: 700 }}>
                  {it.part_number || ''}
                </span>}
                <span style={{ overflow: 'hidden', whiteSpace: it.public_copy ? 'normal' : 'nowrap', overflowWrap: 'anywhere', textOverflow: 'ellipsis' }}>
                  {it.part_description || it.content_text || '—'}
                </span>
                {!it.public_copy && <span style={{ fontFamily: 'Courier New, monospace', fontSize: 10, textAlign: 'right' }}>
                  {it.total_price !== null ? `$${it.total_price.toLocaleString()}` : ''}
                </span>}
              </Row>
            ); })}
          </div>
        </section>
      ))}
    </div>
  );
};

export default VendorPage;
