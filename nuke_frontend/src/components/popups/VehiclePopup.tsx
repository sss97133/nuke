/**
 * VehiclePopup — Full vehicle detail in a stacking popup.
 *
 * Hero image, title, price, key specs, description snippet,
 * comparable sales (3 similar), price vs median context,
 * source + observation count.
 *
 * EVERY data point is clickable -> opens another popup deeper in the stack.
 */

import React, { useEffect, useState } from 'react';
import type { FeedVehicle } from '../../feed/types/feed';
import { resolveVehiclePrice } from '../../feed/utils/feedPriceResolution';
import { supabase } from '../../lib/supabase';
import { usePopup } from './usePopup';
import { useViewHistory } from '../../hooks/useViewHistory';
import { useInterests } from '../../hooks/useInterests';
import { MakePopup } from './MakePopup';
import { ModelPopup } from './ModelPopup';
import { SourcePopup } from './SourcePopup';

interface Props {
  vehicle: FeedVehicle;
  searchQuery?: string;
}

interface Comparable {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  sale_price: number | null;
  primary_image_url: string | null;
}

interface MedianData {
  median_price: number | null;
  total_count: number;
}

function formatPrice(n: number | null): string {
  if (n == null || n <= 0) return '--';
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export function VehiclePopup({ vehicle, searchQuery }: Props) {
  const { openPopup } = usePopup();
  const { recordView, endView } = useViewHistory();
  const { recordInterest } = useInterests();
  const price = resolveVehiclePrice(vehicle);
  const [comparables, setComparables] = useState<Comparable[]>([]);
  const [medianData, setMedianData] = useState<MedianData | null>(null);
  const [obsCount, setObsCount] = useState<number | null>(null);

  // Track view on popup open, end on unmount.
  // Also boost interest memory — viewing a vehicle is a stronger signal.
  useEffect(() => {
    recordView(vehicle.id, 'popup');
    if (vehicle.make) recordInterest('make', vehicle.make);
    if (vehicle.model) recordInterest('model', vehicle.model);
    return () => { endView(vehicle.id); };
  }, [vehicle.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch comparables + median
  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      // Fetch 3 comparable vehicles (same make+model, different id, with price)
      if (vehicle.make && vehicle.model) {
        const { data: comps } = await supabase
          .from('vehicles')
          .select('id, year, make, model, sale_price, primary_image_url')
          .eq('is_public', true)
          .eq('make', vehicle.make)
          .eq('model', vehicle.model)
          .neq('id', vehicle.id)
          .not('sale_price', 'is', null)
          .gt('sale_price', 0)
          .order('sale_price', { ascending: false })
          .limit(3);
        if (!cancelled && comps) setComparables(comps as Comparable[]);

        // Compute median from a sample
        const { data: priceData } = await supabase
          .from('vehicles')
          .select('sale_price')
          .eq('is_public', true)
          .eq('make', vehicle.make)
          .eq('model', vehicle.model)
          .not('sale_price', 'is', null)
          .gt('sale_price', 0)
          .limit(200);
        if (!cancelled && priceData && priceData.length > 0) {
          const prices = (priceData as { sale_price: number }[])
            .map((r) => r.sale_price)
            .sort((a, b) => a - b);
          const mid = Math.floor(prices.length / 2);
          const median = prices.length % 2 === 0
            ? Math.round((prices[mid - 1] + prices[mid]) / 2)
            : prices[mid];
          if (!cancelled) setMedianData({ median_price: median, total_count: prices.length });
        }
      }

      // Observation count
      const { count } = await supabase
        .from('vehicle_observations')
        .select('id', { count: 'exact', head: true })
        .eq('vehicle_id', vehicle.id);
      if (!cancelled && typeof count === 'number') setObsCount(count);
    }

    fetchData();
    return () => { cancelled = true; };
  }, [vehicle.id, vehicle.make, vehicle.model]);

  const title = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle';
  const mono = "'Courier New', monospace";
  const sans = 'Arial, sans-serif';

  const handleMakeClick = () => {
    if (vehicle.make) {
      openPopup(<MakePopup make={vehicle.make} />, vehicle.make, 360);
    }
  };

  const handleModelClick = () => {
    if (vehicle.make && vehicle.model) {
      openPopup(<ModelPopup make={vehicle.make} model={vehicle.model} />, vehicle.model, 360);
    }
  };

  const handleSourceClick = () => {
    if (vehicle.discovery_source || vehicle.profile_origin) {
      const source = vehicle.discovery_source || vehicle.profile_origin || 'unknown';
      openPopup(<SourcePopup source={source} />, source.toUpperCase(), 360);
    }
  };

  const handleCompClick = (comp: Comparable) => {
    // Open a new VehiclePopup for the comparable -- fetch full vehicle data
    supabase
      .from('vehicles')
      .select('*')
      .eq('id', comp.id)
      .single()
      .then(({ data }) => {
        if (data) {
          openPopup(
            <VehiclePopup vehicle={data as unknown as FeedVehicle} />,
            [comp.year, comp.make, comp.model].filter(Boolean).join(' '),
            420,
          );
        }
      });
  };

  const sq = (searchQuery || '').toLowerCase().trim();
  const allSpecs = buildSpecs(vehicle, handleMakeClick, handleModelClick);
  const filteredSpecs = sq
    ? allSpecs.filter(s =>
        s.label.toLowerCase().includes(sq) ||
        s.value.toLowerCase().includes(sq))
    : allSpecs;
  const filteredComps = sq
    ? comparables.filter(c =>
        String(c.year || '').includes(sq) ||
        (c.model || '').toLowerCase().includes(sq) ||
        (c.make || '').toLowerCase().includes(sq) ||
        formatPrice(c.sale_price).toLowerCase().includes(sq))
    : comparables;

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Hero image */}
      {vehicle.thumbnail_url && (
        <div style={{ width: '100%', height: 220, overflow: 'hidden', background: '#e0e0e0' }}>
          <img
            src={vehicle.thumbnail_url}
            alt={title}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        </div>
      )}

      {/* Title + Price */}
      <div style={{ padding: '10px 12px 6px', borderBottom: '1px solid #ccc' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontFamily: sans, fontSize: 13, fontWeight: 800, color: '#1a1a1a', lineHeight: 1.2 }}>
            {vehicle.year && (
              <span style={{ color: '#666' }}>{vehicle.year} </span>
            )}
            {vehicle.make && (
              <ClickableText onClick={handleMakeClick}>{vehicle.make}</ClickableText>
            )}
            {vehicle.model && (
              <>
                {' '}
                <ClickableText onClick={handleModelClick}>{vehicle.model}</ClickableText>
              </>
            )}
            {vehicle.series && (
              <span style={{ fontWeight: 400, color: '#666' }}> {vehicle.series}</span>
            )}
          </span>
          <span style={{
            fontFamily: mono, fontSize: 14, fontWeight: 700,
            color: price.isSold ? '#16825d' : '#1a1a1a',
            flexShrink: 0, whiteSpace: 'nowrap',
          }}>
            {price.formatted}
          </span>
        </div>
        {price.isSold && price.showSoldBadge && (
          <span style={{
            fontFamily: sans, fontSize: 7, fontWeight: 800,
            textTransform: 'uppercase', letterSpacing: '0.5px',
            color: '#16825d',
          }}>
            SOLD
          </span>
        )}
        {vehicle.is_for_sale && !price.isSold && (
          <span style={{
            fontFamily: sans, fontSize: 7, fontWeight: 800,
            textTransform: 'uppercase', letterSpacing: '0.5px',
            color: '#0078d4',
          }}>
            FOR SALE
          </span>
        )}
      </div>

      {/* Key specs — no duplicates */}
      {filteredSpecs.length > 0 && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #ccc' }}>
          <SpecGrid specs={filteredSpecs} />
        </div>
      )}

      {/* Price vs median context */}
      {medianData && medianData.median_price && price.amount && (
        <div style={{
          padding: '8px 12px', borderBottom: '1px solid #ccc',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <Label>MEDIAN ({medianData.total_count} SALES)</Label>
            <span style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, color: '#1a1a1a', marginLeft: 6 }}>
              {formatPrice(medianData.median_price)}
            </span>
          </div>
          <div>
            {(() => {
              const diff = price.amount! - medianData.median_price!;
              const pct = Math.round((diff / medianData.median_price!) * 100);
              const color = pct < -5 ? '#16825d' : pct > 5 ? '#d13438' : '#666';
              const dir = pct > 0 ? 'above' : pct < 0 ? 'below' : 'at';
              return (
                <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, color }}>
                  {Math.abs(pct)}% {dir} MEDIAN
                </span>
              );
            })()}
          </div>
        </div>
      )}

      {/* Comparable sales */}
      {filteredComps.length > 0 && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #ccc' }}>
          <Label>COMPARABLE SALES</Label>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            {filteredComps.map((c) => (
              <div
                key={c.id}
                onClick={() => handleCompClick(c)}
                style={{
                  flex: 1, cursor: 'pointer', border: '1px solid #ccc',
                  background: '#fff', overflow: 'hidden',
                  transition: 'border-color 150ms ease',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#2a2a2a'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#ccc'; }}
              >
                <div style={{ width: '100%', paddingTop: '66%', position: 'relative', background: '#e0e0e0' }}>
                  {c.primary_image_url && (
                    <img
                      src={c.primary_image_url}
                      alt={[c.year, c.make, c.model].filter(Boolean).join(' ')}
                      loading="lazy"
                      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  )}
                </div>
                <div style={{ padding: '3px 4px' }}>
                  <div style={{
                    fontFamily: sans, fontSize: 8, fontWeight: 700,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    color: '#1a1a1a',
                  }}>
                    {[c.year, c.model].filter(Boolean).join(' ')}
                  </div>
                  <div style={{ fontFamily: mono, fontSize: 9, fontWeight: 700, color: '#666' }}>
                    {formatPrice(c.sale_price)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Source + observations */}
      <div style={{
        padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div>
          {(vehicle.discovery_source || vehicle.profile_origin) && (
            <ClickableText onClick={handleSourceClick}>
              <span style={{
                fontFamily: mono, fontSize: 8, fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.5px',
                padding: '2px 5px', border: '1px solid #ccc',
                color: '#666',
              }}>
                {vehicle.discovery_source || vehicle.profile_origin}
              </span>
            </ClickableText>
          )}
        </div>
        {obsCount != null && obsCount > 0 && (
          <span style={{
            fontFamily: mono, fontSize: 8, fontWeight: 700,
            color: '#999', textTransform: 'uppercase',
          }}>
            {obsCount} OBSERVATION{obsCount !== 1 ? 'S' : ''}
          </span>
        )}
      </div>

      {/* Description snippet */}
      {vehicle.description && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #ccc' }}>
          <Label>DESCRIPTION</Label>
          <p style={{
            fontFamily: sans, fontSize: 10, color: '#444',
            lineHeight: 1.4, margin: '4px 0 0',
          }}>
            {vehicle.description.length > 200
              ? vehicle.description.slice(0, 200) + '...'
              : vehicle.description}
            {vehicle.description.length > 200 && (
              <a
                href={`/vehicle/${vehicle.id}`}
                style={{
                  fontFamily: sans, fontSize: 9, fontWeight: 700,
                  color: '#2a2a2a', textDecoration: 'none',
                  marginLeft: 4, borderBottom: '1px dashed #999',
                }}
              >
                READ MORE
              </a>
            )}
          </p>
        </div>
      )}

      {/* Source listing link */}
      {(vehicle.discovery_url || vehicle.listing_url) && (
        <div style={{ padding: '6px 12px', borderBottom: '1px solid #ccc' }}>
          <a
            href={vehicle.discovery_url || vehicle.listing_url || '#'}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontFamily: mono, fontSize: 9, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.3px',
              color: '#2a2a2a', textDecoration: 'none',
              borderBottom: '1px dashed #999',
              transition: 'border-color 150ms ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderBottomColor = '#2a2a2a'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderBottomColor = '#999'; }}
          >
            VIEW ON SOURCE &rarr;
          </a>
        </div>
      )}

      {/* View full profile link */}
      <div style={{ padding: '0 12px 10px', textAlign: 'right' }}>
        <a
          href={`/vehicle/${vehicle.id}`}
          style={{
            fontFamily: sans, fontSize: 9, fontWeight: 800,
            textTransform: 'uppercase', letterSpacing: '0.3px',
            padding: '4px 12px', border: '2px solid #2a2a2a',
            background: '#2a2a2a', color: '#fff',
            textDecoration: 'none', display: 'inline-block',
            transition: 'opacity 150ms ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.8'; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
        >
          OPEN FULL PROFILE
        </a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontFamily: 'Arial, sans-serif', fontSize: 7, fontWeight: 800,
      textTransform: 'uppercase', letterSpacing: '0.5px',
      color: '#999', lineHeight: 1,
    }}>
      {children}
    </span>
  );
}

function ClickableText({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onKeyDown={(e) => { if (e.key === 'Enter') onClick(); }}
      style={{
        cursor: 'pointer',
        borderBottom: '1px dashed #999',
        transition: 'border-color 150ms ease',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderBottomColor = '#2a2a2a'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderBottomColor = '#999'; }}
    >
      {children}
    </span>
  );
}

interface SpecItem {
  label: string;
  value: string;
  onClick?: () => void;
}

function buildSpecs(v: FeedVehicle, onMakeClick: () => void, onModelClick: () => void): SpecItem[] {
  const specs: SpecItem[] = [];
  if (v.mileage) specs.push({ label: 'MILEAGE', value: `${Math.floor(v.mileage).toLocaleString()} mi` });
  if (v.transmission) specs.push({ label: 'TRANS', value: v.transmission });
  if (v.drivetrain) specs.push({ label: 'DRIVE', value: v.drivetrain });
  if (v.engine_size) specs.push({ label: 'ENGINE', value: v.engine_size });
  if (v.canonical_body_style || v.body_style) {
    specs.push({ label: 'BODY', value: v.canonical_body_style || v.body_style || '' });
  }
  if (v.fuel_type) specs.push({ label: 'FUEL', value: v.fuel_type });
  if (v.vin) specs.push({ label: 'VIN', value: `...${v.vin.slice(-8)}` });
  if (v.location) specs.push({ label: 'LOCATION', value: v.location });
  return specs;
}

function SpecGrid({ specs }: { specs: SpecItem[] }) {
  if (specs.length === 0) return null;
  const mono = "'Courier New', monospace";
  const sans = 'Arial, sans-serif';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '4px 12px' }}>
      {specs.map((s) => (
        <div key={s.label} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{
            fontFamily: sans, fontSize: 7, fontWeight: 800,
            textTransform: 'uppercase', letterSpacing: '0.5px',
            color: '#999', lineHeight: 1,
          }}>
            {s.label}
          </span>
          {s.onClick ? (
            <span
              role="button"
              tabIndex={0}
              onClick={s.onClick}
              style={{
                fontFamily: mono, fontSize: 10, fontWeight: 700, color: '#1a1a1a',
                lineHeight: 1.2, cursor: 'pointer',
                borderBottom: '1px dashed #999',
                width: 'fit-content',
              }}
            >
              {s.value}
            </span>
          ) : (
            <span style={{
              fontFamily: mono, fontSize: 10, fontWeight: 700, color: '#1a1a1a',
              lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {s.value}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
