/**
 * PriceContextPopup — Shows price context for a vehicle in a stacking popup.
 *
 * Nuke estimate vs actual price.
 * Comparable sales (same make/model).
 * Price vs median for this model.
 * Price trend if historical data exists.
 */

import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { usePopup } from './usePopup';
import { VehiclePopup } from './VehiclePopup';
import type { FeedVehicle } from '../../feed/types/feed';

interface Props {
  vehicleId: string;
  price: number | null;
  nukeEstimate?: number | null;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  isSold?: boolean;
}

interface Comparable {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  sale_price: number | null;
  primary_image_url: string | null;
  sold_date: string | null;
}

const MONO = "'Courier New', Courier, monospace";
const SANS = 'Arial, Helvetica, sans-serif';

function formatPrice(n: number | null): string {
  if (n == null || n <= 0) return '--';
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export function PriceContextPopup({ vehicleId, price, nukeEstimate, make, model, year, isSold }: Props) {
  const { openPopup } = usePopup();
  const [comparables, setComparables] = useState<Comparable[]>([]);
  const [medianPrice, setMedianPrice] = useState<number | null>(null);
  const [sampleCount, setSampleCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!make || !model) {
        setLoading(false);
        return;
      }

      try {
        // Fetch comparable sales
        const { data: comps } = await supabase
          .from('vehicles')
          .select('id, year, make, model, sale_price, primary_image_url, sold_date')
          .ilike('make', make)
          .ilike('model', model)
          .neq('id', vehicleId)
          .not('sale_price', 'is', null)
          .gt('sale_price', 0)
          .order('sale_price', { ascending: false })
          .limit(8);

        if (!cancelled && comps) setComparables(comps as Comparable[]);

        // Compute median
        const { data: priceData } = await supabase
          .from('vehicles')
          .select('sale_price')
          .ilike('make', make)
          .ilike('model', model)
          .not('sale_price', 'is', null)
          .gt('sale_price', 0)
          .limit(300);

        if (!cancelled && priceData && priceData.length > 0) {
          const prices = (priceData as { sale_price: number }[])
            .map(r => r.sale_price)
            .sort((a, b) => a - b);
          const mid = Math.floor(prices.length / 2);
          const median = prices.length % 2 === 0
            ? Math.round((prices[mid - 1] + prices[mid]) / 2)
            : prices[mid];
          setMedianPrice(median);
          setSampleCount(prices.length);
        }
      } catch {
        // ignore
      }
      if (!cancelled) setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [vehicleId, make, model]);

  // Calculations
  const vsEstimate = price && nukeEstimate && nukeEstimate > 0
    ? Math.round(((price - nukeEstimate) / nukeEstimate) * 100)
    : null;

  const vsMedian = price && medianPrice && medianPrice > 0
    ? Math.round(((price - medianPrice) / medianPrice) * 100)
    : null;

  const handleCompClick = (comp: Comparable) => {
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Price hero */}
      <div style={{
        padding: '12px',
        borderBottom: '2px solid #2a2a2a',
        textAlign: 'center',
      }}>
        <div style={{
          fontFamily: MONO, fontSize: 24, fontWeight: 700,
          color: isSold ? '#004225' : '#1a1a1a', lineHeight: 1,
        }}>
          {price != null && price > 0 ? formatPrice(price) : '--'}
        </div>
        <div style={{
          fontFamily: SANS, fontSize: 8, fontWeight: 800,
          textTransform: 'uppercase' as const, letterSpacing: '0.5px',
          color: isSold ? '#004225' : '#999', marginTop: 4,
        }}>
          {isSold ? 'SOLD PRICE' : 'CURRENT HIGH BID'}
        </div>
      </div>

      {/* Estimate vs actual */}
      {nukeEstimate != null && nukeEstimate > 0 && price != null && price > 0 && (
        <div style={{
          padding: '8px 12px',
          borderBottom: '1px solid #e0e0e0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div>
            <div style={{
              fontFamily: SANS, fontSize: 7, fontWeight: 800,
              textTransform: 'uppercase' as const, letterSpacing: '0.5px', color: '#999',
            }}>
              NUKE ESTIMATE
            </div>
            <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>
              {formatPrice(nukeEstimate)}
            </div>
          </div>
          {vsEstimate != null && (
            <div style={{
              fontFamily: MONO, fontSize: 11, fontWeight: 700,
              color: vsEstimate > 5 ? '#8a0020' : vsEstimate < -5 ? '#004225' : '#666',
              padding: '4px 8px',
              border: '2px solid currentColor',
            }}>
              {vsEstimate > 0 ? '+' : ''}{vsEstimate}%
              <span style={{ fontSize: 8, fontWeight: 400, marginLeft: 4 }}>
                {vsEstimate > 5 ? 'OVER' : vsEstimate < -5 ? 'UNDER' : 'FAIR'}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Median comparison */}
      {medianPrice != null && medianPrice > 0 && (
        <div style={{
          padding: '8px 12px',
          borderBottom: '1px solid #e0e0e0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div>
            <div style={{
              fontFamily: SANS, fontSize: 7, fontWeight: 800,
              textTransform: 'uppercase' as const, letterSpacing: '0.5px', color: '#999',
            }}>
              MEDIAN ({sampleCount} SALES)
            </div>
            <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>
              {formatPrice(medianPrice)}
            </div>
          </div>
          {vsMedian != null && price != null && price > 0 && (
            <div style={{
              fontFamily: MONO, fontSize: 11, fontWeight: 700,
              color: vsMedian > 10 ? '#8a0020' : vsMedian < -10 ? '#004225' : '#666',
            }}>
              {vsMedian > 0 ? '+' : ''}{vsMedian}% vs median
            </div>
          )}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ padding: '16px 12px', textAlign: 'center' }}>
          <span style={{ fontFamily: MONO, fontSize: 9, color: '#999', textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>
            Loading comparables...
          </span>
        </div>
      )}

      {/* Comparable sales */}
      {!loading && comparables.length > 0 && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #e0e0e0' }}>
          <div style={{
            fontFamily: SANS, fontSize: 7, fontWeight: 800,
            textTransform: 'uppercase' as const, letterSpacing: '0.5px',
            color: '#999', marginBottom: 6,
          }}>
            COMPARABLE SALES
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {comparables.map((c) => {
              const diff = price && c.sale_price ? Math.round(((c.sale_price - price) / price) * 100) : null;

              return (
                <div
                  key={c.id}
                  onClick={() => handleCompClick(c)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '4px 0', borderBottom: '1px solid #f0f0f0',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#f5f5f5'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  {c.primary_image_url && (
                    <img
                      src={c.primary_image_url}
                      alt=""
                      loading="lazy"
                      style={{ width: 36, height: 24, objectFit: 'cover', flexShrink: 0, border: '1px solid #e0e0e0' }}
                    />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{
                      fontFamily: SANS, fontSize: 9, fontWeight: 700,
                      color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      display: 'block',
                    }}>
                      {[c.year, c.model].filter(Boolean).join(' ')}
                    </span>
                  </div>
                  <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: '#1a1a1a', flexShrink: 0 }}>
                    {formatPrice(c.sale_price)}
                  </span>
                  {diff != null && (
                    <span style={{
                      fontFamily: MONO, fontSize: 8, fontWeight: 700,
                      color: diff > 0 ? '#004225' : diff < 0 ? '#8a0020' : '#666',
                      flexShrink: 0, width: 40, textAlign: 'right',
                    }}>
                      {diff > 0 ? '+' : ''}{diff}%
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* No data fallback */}
      {!loading && !medianPrice && comparables.length === 0 && (
        <div style={{ padding: '16px 12px', textAlign: 'center' }}>
          <span style={{ fontFamily: MONO, fontSize: 9, color: '#999', textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>
            {make && model
              ? `No comparable sales data for ${make} ${model}`
              : 'No comparable sales data available'}
          </span>
        </div>
      )}
    </div>
  );
}
