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

const PLATFORM_COLORS: Record<string, string> = {
  'Bring a Trailer': '#e85d04',
  'Cars & Bids': 'var(--info)',
  'Mecum': '#7c3aed',
  'Barrett-Jackson': 'var(--error-dark, var(--error))',
  "RM Sotheby's": '#1e40af',
  'Bonhams': '#065f46',
  'Gooding & Company': '#92400e',
  'PCarMarket': '#0e7490',
  'Hagerty Marketplace': '#0369a1',
  'eBay Motors': '#0064d2',
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
      <div style={{ padding: '20px 20px 16px' }}>
        <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '16px', color: 'var(--text)' }}>
          Similar Sales
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '10px' }}>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{
              height: '100px', backgroundColor: 'var(--surface)',
              border: '1px solid var(--border-light)',
              opacity: 0.6,
            }} />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '24px', color: 'var(--text-muted)', fontSize: '14px' }}>
        {error}
      </div>
    );
  }

  if (sales.length === 0) {
    return (
      <div style={{ padding: '32px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)', marginBottom: '6px' }}>
          No comparable sales found
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
          No sold {vehicleYear ?? ''} {vehicleMake ?? ''} {vehicleModel ?? ''} (±2 years) in our database yet.
          <br />
          More comps are added daily as auctions close.
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px 20px 16px' }}>
      {/* Header + Stats */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: '16px',
        flexWrap: 'wrap',
        gap: '12px',
      }}>
        <div>
          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)', marginBottom: '3px' }}>
            Similar Sales
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            {vehicleYear != null ? `${vehicleYear - 2}–${vehicleYear + 2} ` : ''}{vehicleMake} {vehicleModel}
            {' '}&middot; {sales.length} sold
          </div>
        </div>

        {summary && (
          <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <StatPill label="Avg" value={formatPrice(summary.avg_price)} accent />
            <StatPill label="Median" value={formatPrice(summary.median_price)} />
            <StatPill label="Range" value={`${formatPrice(summary.min_price)} – ${formatPrice(summary.max_price)}`} />
          </div>
        )}
      </div>

      {/* Sales Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: '10px',
        marginBottom: '12px',
      }}>
        {displayedSales.map((sale, i) => (
          <SaleCard key={`${sale.vehicle_id ?? i}-${i}`} sale={sale} />
        ))}
      </div>

      {/* Show more / less */}
      {sales.length > 6 && (
        <div style={{ textAlign: 'center', paddingTop: '8px' }}>
          <button
            onClick={() => setShowAll(!showAll)}
            style={{
              background: 'none',
              border: '1px solid var(--border-light)', padding: '5px 16px',
              fontSize: '12px',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              letterSpacing: '0.02em',
            }}
          >
            {showAll ? 'Show fewer' : `Show all ${sales.length} sales`}
          </button>
        </div>
      )}
    </div>
  );
}

function StatPill({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{
        fontSize: '15px',
        fontWeight: 700,
        color: accent ? 'var(--primary)' : 'var(--text)',
        lineHeight: 1.2,
      }}>
        {value}
      </div>
      <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {label}
      </div>
    </div>
  );
}

function SaleCard({ sale }: { sale: SimilarSale }) {
  const [imgError, setImgError] = useState(false);
  const platformColor = sale.platform ? (PLATFORM_COLORS[sale.platform] ?? 'var(--text-secondary)') : 'var(--text-secondary)';

  const cardContent = (
    <div style={{
      display: 'flex',
      gap: '12px',
      padding: '12px', border: '1px solid var(--border-light)',
      backgroundColor: 'var(--surface)',
      transition: 'border-color 0.12s ease',
      cursor: sale.listing_url ? 'pointer' : 'default',
      textDecoration: 'none',
      color: 'inherit',
    }}
    onMouseEnter={(e) => {
      if (sale.listing_url) {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--primary)';
      }
    }}
    onMouseLeave={(e) => {
      (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-light)';
    }}
    >
      {/* Thumbnail */}
      <div style={{
        flexShrink: 0,
        width: '100px',
        height: '70px', overflow: 'hidden',
        backgroundColor: 'var(--bg)',
      }}>
        <img
          src={imgError || !sale.image_url ? PLACEHOLDER_IMAGE : sale.image_url}
          alt={`${sale.year} ${sale.make} ${sale.model}`}
          onError={() => setImgError(true)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Title */}
        <div style={{
          fontSize: '14px',
          fontWeight: 600,
          color: 'var(--text)',
          marginBottom: '2px',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {sale.year} {sale.make} {sale.model}
          {sale.trim && (
            <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}> {sale.trim}</span>
          )}
        </div>

        {/* Price */}
        <div style={{
          fontSize: '16px',
          fontWeight: 700,
          color: 'var(--text)',
          marginBottom: '6px',
          lineHeight: 1.2,
        }}>
          {formatPrice(sale.sale_price)}
        </div>

        {/* Meta row */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          {sale.platform && (
            <span style={{
              fontSize: '11px',
              fontWeight: 600,
              color: platformColor,
              backgroundColor: `${platformColor}15`,
              padding: '2px 6px', whiteSpace: 'nowrap',
            }}>
              {sale.platform}
            </span>
          )}
          {sale.sold_date && (
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
              {formatDate(sale.sold_date)}
            </span>
          )}
          {sale.mileage && (
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
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
