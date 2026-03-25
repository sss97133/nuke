import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface SimilarSale {
  vehicle_id: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  vin: string | null;
  sale_price: number;
  mileage: number | null;
  color: string | null;
  image_url: string | null;
  location: string | null;
  listing_url: string | null;
  platform: string | null;
  platform_raw: string | null;
  sold_date: string | null;
  source_type: 'auction_event' | 'vehicle_record';
}

interface SalesSummary {
  count: number;
  avg_price: number;
  median_price: number;
  min_price: number;
  max_price: number;
  auction_event_count: number;
}

interface SimilarSalesSectionProps {
  vehicleId: string;
  vehicleYear: number;
  vehicleMake: string;
  vehicleModel: string;
}

// Platform abbreviations — no decorative colors per design system
const PLATFORM_ABBREV: Record<string, string> = {
  'Bring a Trailer': 'BAT',
  'Cars & Bids': 'C&B',
  'Mecum': 'MECUM',
  'Barrett-Jackson': 'B-J',
  "RM Sotheby's": 'RM',
  'Bonhams': 'BONHAMS',
  'Gooding & Company': 'GOODING',
  'PCarMarket': 'PCM',
  'Hagerty Marketplace': 'HAGERTY',
  'eBay Motors': 'EBAY',
};

function formatPrice(price: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays < 1) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 30) return `${diffDays}d ago`;
  const months = Math.floor(diffDays / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(diffDays / 365);
  const remMonths = Math.floor((diffDays - years * 365) / 30);
  if (remMonths > 0) return `${years}yr ${remMonths}mo ago`;
  return `${years}yr ago`;
}

function formatMileage(mileage: number | null): string {
  if (!mileage) return '';
  return `${new Intl.NumberFormat('en-US').format(mileage)} mi`;
}

const PLACEHOLDER_IMAGE = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIwIiBoZWlnaHQ9IjgwIiB2aWV3Qm94PSIwIDAgMTIwIDgwIiBmaWxsPSJub25lIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxMjAiIGhlaWdodD0iODAiIGZpbGw9IiNlNWU3ZWIiLz48cGF0aCBkPSJNMzUgNTJMMjUgNDBMMjAgNDhIMTVWNTJIMzVaIiBmaWxsPSIjOWNhM2FmIi8+PGNpcmNsZSBjeD0iNjUiIGN5PSIzNSIgcj0iMTIiIGZpbGw9IiM5Y2EzYWYiLz48cGF0aCBkPSJNMTAgNTJINTBMMzcgMzVMMjUgNDhMMjAgNDBMMTAgNTJaIiBmaWxsPSIjNmI3MjgwIi8+PC9zdmc+';

export function SimilarSalesSection({
  vehicleId,
  vehicleYear,
  vehicleMake,
  vehicleModel,
}: SimilarSalesSectionProps) {
  const [sales, setSales] = useState<SimilarSale[]>([]);
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (!vehicleId || !vehicleMake) return;
    loadSales();
  }, [vehicleId]);

  async function loadSales() {
    try {
      setLoading(true);
      setError(null);

      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL as string;

      if (!supabaseUrl) {
        setError('Configuration error');
        return;
      }

      const params = new URLSearchParams({
        vehicle_id: vehicleId,
        year_range: '2',
        limit: '20',
      });

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'apikey': (import.meta as any).env?.VITE_SUPABASE_ANON_KEY ?? '',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(
        `${supabaseUrl}/functions/v1/api-v1-comps?${params.toString()}`,
        { headers }
      );

      if (!res.ok) {
        const errBody = await res.text();
        console.error('Similar sales API error:', errBody);
        setError('Unable to load comparable sales');
        return;
      }

      const json = await res.json();
      setSales(json.data ?? []);
      setSummary(json.summary ?? null);
    } catch (err) {
      console.error('SimilarSalesSection error:', err);
      setError('Unable to load comparable sales');
    } finally {
      setLoading(false);
    }
  }

  const displayedSales = showAll ? sales : sales.slice(0, 6);

  if (loading) {
    return (
      <div style={{ padding: '10px' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '4px',
        }}>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{
              height: '80px', backgroundColor: 'var(--surface)',
              border: '2px solid var(--border)',
              opacity: 0.5,
            }} />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        padding: '10px',
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontSize: '9px',
        color: 'var(--text-disabled)',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
      }}>
        {error}
      </div>
    );
  }

  if (sales.length === 0) {
    return (
      <div style={{ padding: '16px 10px', textAlign: 'center' }}>
        <div style={{
          fontFamily: 'Arial, Helvetica, sans-serif',
          fontSize: '9px',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          color: 'var(--text-disabled)',
          marginBottom: '4px',
        }}>
          NO COMPARABLE SALES FOUND
        </div>
        <div style={{
          fontFamily: 'Arial, Helvetica, sans-serif',
          fontSize: '9px',
          color: 'var(--text-secondary)',
          lineHeight: '1.5',
        }}>
          No sold {vehicleYear ?? ''} {vehicleMake ?? ''} {vehicleModel ?? ''} (+/-2 years) in our database yet.
          More comps are added daily as auctions close.
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '10px' }}>
      {/* Summary stats */}
      {summary && (
        <div style={{
          display: 'flex',
          gap: '16px',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          marginBottom: '8px',
          paddingBottom: '8px',
          borderBottom: '1px solid var(--border)',
        }}>
          <StatPill label="MEDIAN" value={formatPrice(summary.median_price)} accent />
          <StatPill label="MEDIAN" value={formatPrice(summary.median_price)} />
          <StatPill label="RANGE" value={`${formatPrice(summary.min_price)} \u2014 ${formatPrice(summary.max_price)}`} />
          <span style={{
            fontFamily: "'Courier New', Courier, monospace",
            fontSize: '8px',
            color: 'var(--text-disabled)',
            letterSpacing: '0.06em',
          }}>
            {vehicleYear != null ? `${vehicleYear - 2}\u2013${vehicleYear + 2}` : ''} {vehicleMake} {vehicleModel} &middot; {sales.length} SOLD
          </span>
        </div>
      )}

      {/* Sales Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
        gap: '4px',
        marginBottom: '8px',
      }}>
        {displayedSales.map((sale, i) => (
          <SaleCard key={`${sale.vehicle_id ?? i}-${i}`} sale={sale} />
        ))}
      </div>

      {/* Show more / less */}
      {sales.length > 6 && (
        <div style={{ textAlign: 'center', paddingTop: '4px' }}>
          <button
            onClick={() => setShowAll(!showAll)}
            style={{
              background: 'none',
              border: '1px solid var(--border)',
              padding: '3px 10px',
              fontFamily: 'Arial, Helvetica, sans-serif',
              fontSize: '8px',
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase' as const,
              color: 'var(--text)',
              cursor: 'pointer',
            }}
          >
            {showAll ? 'SHOW FEWER' : `SHOW ALL ${sales.length} SALES`}
          </button>
        </div>
      )}
    </div>
  );
}

function StatPill({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <span style={{
        fontFamily: "'Courier New', Courier, monospace",
        fontSize: '10px',
        fontWeight: 700,
        color: accent ? '#16825d' : 'var(--text)',
        letterSpacing: '0.04em',
      }}>
        {value}
      </span>
      <span style={{
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontSize: '8px',
        fontWeight: 700,
        color: 'var(--text-disabled)',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        marginLeft: '4px',
      }}>
        {label}
      </span>
    </div>
  );
}

function SaleCard({ sale }: { sale: SimilarSale }) {
  const [imgError, setImgError] = useState(false);
  const platformAbbrev = sale.platform ? (PLATFORM_ABBREV[sale.platform] ?? sale.platform.toUpperCase()) : null;

  const cardContent = (
    <div style={{
      display: 'flex',
      gap: '8px',
      padding: '8px',
      border: '2px solid var(--border)',
      backgroundColor: 'var(--surface)',
      transition: 'border-color 180ms cubic-bezier(0.16, 1, 0.3, 1)',
      cursor: sale.listing_url ? 'pointer' : 'default',
      textDecoration: 'none',
      color: 'inherit',
    }}
    onMouseEnter={(e) => {
      if (sale.listing_url) {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--text)';
      }
    }}
    onMouseLeave={(e) => {
      (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
    }}
    >
      {/* Thumbnail */}
      <div style={{
        flexShrink: 0,
        width: '80px',
        height: '60px',
        overflow: 'hidden',
        backgroundColor: '#7a7a7a',
      }}>
        {imgError || !sale.image_url ? (
          <div style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'Arial, Helvetica, sans-serif',
            fontSize: '8px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: '#bbb',
          }}>
            {sale.make || 'N/A'}
          </div>
        ) : (
          <img
            src={sale.image_url}
            alt={`${sale.year} ${sale.make} ${sale.model}`}
            onError={() => setImgError(true)}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          />
        )}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Title */}
        <div style={{
          fontFamily: 'Arial, Helvetica, sans-serif',
          fontSize: '9px',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          color: 'var(--text)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          marginBottom: '2px',
        }}>
          {sale.year} {sale.make} {sale.model}
          {sale.trim && (
            <span style={{ fontWeight: 400, color: 'var(--text-secondary)' }}> {sale.trim}</span>
          )}
        </div>

        {/* Price */}
        <div style={{
          fontFamily: "'Courier New', Courier, monospace",
          fontSize: '10px',
          fontWeight: 700,
          color: '#16825d',
          marginBottom: '4px',
          lineHeight: 1,
        }}>
          {formatPrice(sale.sale_price)}
        </div>

        {/* Meta row */}
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
          {platformAbbrev && (
            <span style={{
              fontFamily: 'Arial, Helvetica, sans-serif',
              fontSize: '7px',
              fontWeight: 700,
              letterSpacing: '0.10em',
              textTransform: 'uppercase',
              padding: '1px 4px',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              whiteSpace: 'nowrap',
            }}>
              {platformAbbrev}
            </span>
          )}
          {sale.sold_date && (
            <span style={{
              fontFamily: 'Arial, Helvetica, sans-serif',
              fontSize: '7px',
              color: 'var(--text-disabled)',
              whiteSpace: 'nowrap',
            }}>
              {formatDate(sale.sold_date)}
            </span>
          )}
          {sale.mileage && (
            <span style={{
              fontFamily: "'Courier New', Courier, monospace",
              fontSize: '7px',
              color: 'var(--text-disabled)',
              whiteSpace: 'nowrap',
              letterSpacing: '0.06em',
            }}>
              {formatMileage(sale.mileage)}
            </span>
          )}
        </div>
      </div>
    </div>
  );

  if (sale.listing_url) {
    return (
      <a href={sale.listing_url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', display: 'block' }}>
        {cardContent}
      </a>
    );
  }

  return <div>{cardContent}</div>;
}

export default SimilarSalesSection;
