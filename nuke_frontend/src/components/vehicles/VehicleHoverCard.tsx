import React, { useState, useEffect, useRef } from 'react';
import { formatCurrencyAmount } from '../../utils/currency';
import { FaviconIcon } from '../common/FaviconIcon';

interface VehicleHoverCardProps {
  vehicle: {
    id: string;
    year?: number;
    make?: string;
    model?: string;
    series?: string;
    trim?: string;
    vin?: string;
    mileage?: number;
    sale_price?: number;
    current_value?: number;
    asking_price?: number;
    sale_date?: string;
    auction_end_date?: string;
    sale_status?: string;
    auction_outcome?: string;
    location?: string;
    discovery_source?: string;
    discovery_url?: string;
    profile_origin?: string;
    updated_at?: string;
    created_at?: string;
    image_count?: number;
    event_count?: number;
    receipt_count?: number;
    transmission?: string;
    engine?: string;
    exterior_color?: string;
  };
  position: { x: number; y: number };
  onClose: () => void;
  onAction?: (action: 'follow' | 'compare' | 'details') => void;
}

const VehicleHoverCard: React.FC<VehicleHoverCardProps> = ({
  vehicle,
  position,
  onClose,
  onAction,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [adjustedPosition, setAdjustedPosition] = useState(position);

  // Adjust position to keep card in viewport
  useEffect(() => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let x = position.x;
    let y = position.y;

    // Keep card within viewport bounds
    if (x + rect.width > viewportWidth - 20) {
      x = position.x - rect.width - 20;
    }
    if (y + rect.height > viewportHeight - 20) {
      y = viewportHeight - rect.height - 20;
    }
    if (x < 20) x = 20;
    if (y < 20) y = 20;

    setAdjustedPosition({ x, y });
  }, [position]);

  // Format price with fallbacks
  const price = vehicle.sale_price || vehicle.current_value || vehicle.asking_price;
  const priceLabel = vehicle.sale_price ? 'Sold' : vehicle.asking_price ? 'Asking' : 'Est. Value';

  // Get status
  const getStatus = () => {
    if (vehicle.auction_outcome === 'sold' || vehicle.sale_status === 'sold') return { label: 'SOLD', color: '#22c55e' };
    if (vehicle.auction_outcome === 'bid_to' || vehicle.sale_status === 'bid_to') return { label: 'BID TO', color: '#f59e0b' };
    if (vehicle.auction_outcome === 'not_sold' || vehicle.sale_status === 'not_sold') return { label: 'NOT SOLD', color: '#ef4444' };
    if (vehicle.sale_status === 'for_sale') return { label: 'FOR SALE', color: '#3b82f6' };
    return null;
  };
  const status = getStatus();

  // Get source info
  const getSourceInfo = () => {
    const source = vehicle.discovery_source || vehicle.profile_origin;
    if (!source) return null;

    const sourceMap: Record<string, { name: string; color: string }> = {
      'bringatrailer': { name: 'BaT', color: '#dc2626' },
      'bat_import': { name: 'BaT', color: '#dc2626' },
      'carsandbids': { name: 'C&B', color: '#7c3aed' },
      'url_scraper': { name: 'Web', color: '#6b7280' },
      'user_upload': { name: 'User', color: '#3b82f6' },
    };

    const key = source.toLowerCase().replace(/[^a-z]/g, '');
    for (const [k, v] of Object.entries(sourceMap)) {
      if (key.includes(k.replace(/[^a-z]/g, ''))) return v;
    }
    return { name: source.slice(0, 8), color: '#6b7280' };
  };
  const sourceInfo = getSourceInfo();

  // Format date
  const formatDate = (dateStr?: string) => {
    if (!dateStr) return null;
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    } catch {
      return null;
    }
  };

  const saleDate = formatDate(vehicle.sale_date || vehicle.auction_end_date);
  const lastUpdated = formatDate(vehicle.updated_at);

  // Data completeness score
  const dataFields = [
    vehicle.year, vehicle.make, vehicle.model, vehicle.vin,
    vehicle.mileage, price, vehicle.transmission, vehicle.engine,
    vehicle.exterior_color, vehicle.location
  ];
  const filledFields = dataFields.filter(f => f !== null && f !== undefined).length;
  const completeness = Math.round((filledFields / dataFields.length) * 100);

  return (
    <div
      ref={cardRef}
      style={{
        position: 'fixed',
        left: adjustedPosition.x,
        top: adjustedPosition.y,
        zIndex: 9999,
        background: 'var(--bg, #fff)',
        border: '1px solid var(--border, #e5e7eb)',
        borderRadius: '6px',
        boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
        padding: '12px',
        minWidth: '280px',
        maxWidth: '320px',
        fontSize: '9pt',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        pointerEvents: 'auto',
      }}
      onMouseLeave={onClose}
    >
      {/* Header: Year Make Model */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px', marginBottom: '8px' }}>
        <div style={{ fontWeight: 600, fontSize: '10pt', lineHeight: 1.2 }}>
          {vehicle.year} {vehicle.make} {vehicle.model}
          {vehicle.series && <span style={{ fontWeight: 400, opacity: 0.7 }}> {vehicle.series}</span>}
        </div>
        {status && (
          <span style={{
            background: status.color,
            color: 'white',
            padding: '2px 6px',
            borderRadius: '3px',
            fontSize: '7pt',
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}>
            {status.label}
          </span>
        )}
      </div>

      {/* Price row */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '10px' }}>
        {price ? (
          <>
            <span style={{ fontSize: '14pt', fontWeight: 700, color: 'var(--text)' }}>
              {formatCurrencyAmount(price)}
            </span>
            <span style={{ fontSize: '7pt', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              {priceLabel}
            </span>
          </>
        ) : (
          <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No price data</span>
        )}
        {saleDate && (
          <span style={{ marginLeft: 'auto', fontSize: '8pt', color: 'var(--text-muted)' }}>
            {saleDate}
          </span>
        )}
      </div>

      {/* Quick stats grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '8px',
        marginBottom: '10px',
        padding: '8px',
        background: 'var(--bg-secondary, #f9fafb)',
        borderRadius: '4px',
      }}>
        <div>
          <div style={{ fontSize: '7pt', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Miles</div>
          <div style={{ fontWeight: 600 }}>
            {vehicle.mileage ? vehicle.mileage.toLocaleString() : '—'}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '7pt', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Trans</div>
          <div style={{ fontWeight: 600 }}>
            {vehicle.transmission?.slice(0, 6) || '—'}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '7pt', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Color</div>
          <div style={{ fontWeight: 600 }}>
            {vehicle.exterior_color?.slice(0, 8) || '—'}
          </div>
        </div>
      </div>

      {/* Source and data info */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {vehicle.discovery_url && (
            <FaviconIcon url={vehicle.discovery_url} size={14} />
          )}
          {sourceInfo && (
            <span style={{
              background: sourceInfo.color + '20',
              color: sourceInfo.color,
              padding: '2px 6px',
              borderRadius: '3px',
              fontSize: '7pt',
              fontWeight: 500,
            }}>
              {sourceInfo.name}
            </span>
          )}
          {vehicle.location && (
            <span style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
              {vehicle.location.slice(0, 20)}
            </span>
          )}
        </div>

        {/* Data completeness indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <div style={{
            width: '40px',
            height: '4px',
            background: 'var(--border)',
            borderRadius: '2px',
            overflow: 'hidden',
          }}>
            <div style={{
              width: `${completeness}%`,
              height: '100%',
              background: completeness > 70 ? '#22c55e' : completeness > 40 ? '#f59e0b' : '#ef4444',
            }} />
          </div>
          <span style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>{completeness}%</span>
        </div>
      </div>

      {/* Metrics row */}
      {(vehicle.image_count || vehicle.event_count || vehicle.receipt_count) && (
        <div style={{
          display: 'flex',
          gap: '12px',
          fontSize: '8pt',
          color: 'var(--text-muted)',
          marginBottom: '10px',
        }}>
          {vehicle.image_count !== undefined && vehicle.image_count > 0 && (
            <span>{vehicle.image_count} images</span>
          )}
          {vehicle.event_count !== undefined && vehicle.event_count > 0 && (
            <span>{vehicle.event_count} events</span>
          )}
          {vehicle.receipt_count !== undefined && vehicle.receipt_count > 0 && (
            <span>{vehicle.receipt_count} receipts</span>
          )}
        </div>
      )}

      {/* Quick actions */}
      <div style={{ display: 'flex', gap: '6px', borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onAction?.('details'); }}
          style={{
            flex: 1,
            padding: '6px 10px',
            background: 'var(--primary, #3b82f6)',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            fontSize: '8pt',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          View Details
        </button>
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onAction?.('follow'); }}
          style={{
            padding: '6px 10px',
            background: 'var(--bg-secondary, #f3f4f6)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            fontSize: '8pt',
            cursor: 'pointer',
          }}
        >
          Follow
        </button>
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onAction?.('compare'); }}
          style={{
            padding: '6px 10px',
            background: 'var(--bg-secondary, #f3f4f6)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            fontSize: '8pt',
            cursor: 'pointer',
          }}
        >
          Compare
        </button>
      </div>

      {/* Last updated */}
      {lastUpdated && (
        <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: '8px', textAlign: 'right' }}>
          Updated {lastUpdated}
        </div>
      )}
    </div>
  );
};

export default VehicleHoverCard;
