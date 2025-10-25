import React from 'react';
import { Link } from 'react-router-dom';

interface VehicleCardDenseProps {
  vehicle: {
    id: string;
    year?: number;
    make?: string;
    model?: string;
    vin?: string;
    mileage?: number;
    image_url?: string;
    image_variants?: {
      thumbnail?: string;
      medium?: string;
      large?: string;
    };
    primary_image_url?: string;
    sale_price?: number;
    current_value?: number;
    purchase_price?: number;
    asking_price?: number;
    condition_rating?: number;
    location?: string;
    updated_at?: string;
    created_at?: string;
    is_for_sale?: boolean;
    uploader_name?: string;
    event_count?: number;
    image_count?: number;
  };
  viewMode?: 'list' | 'gallery' | 'grid';
  showSocial?: boolean;
  showPriceChange?: boolean;
}

const VehicleCardDense: React.FC<VehicleCardDenseProps> = ({ 
  vehicle, 
  viewMode = 'list', 
  showSocial = false, 
  showPriceChange = false 
}) => {
  const formatPrice = (price?: number) => {
    if (!price) return '—';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(price);
  };

  const formatTimeAgo = (dateString?: string) => {
    if (!dateString) return null;
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));

    if (diffInHours < 1) return 'Just now';
    if (diffInHours < 24) return `${diffInHours}h ago`;
    if (diffInHours < 168) return `${Math.floor(diffInHours / 24)}d ago`;
    return `${Math.floor(diffInHours / 168)}w ago`;
  };

  // Get optimal image for this view mode
  const getImageUrl = () => {
    const variants = vehicle.image_variants || {};
    switch (viewMode) {
      case 'list':
        // 120px thumbnail - use smallest
        return variants.thumbnail || variants.medium || vehicle.image_url || null;
      case 'grid':
        // ~200px squares - use medium
        return variants.medium || variants.thumbnail || vehicle.image_url || null;
      case 'gallery':
        // 300px hero - use large
        return variants.large || variants.medium || vehicle.image_url || null;
      default:
        return vehicle.primary_image_url;
    }
  };

  const imageUrl = getImageUrl();
  const displayPrice = vehicle.sale_price || vehicle.current_value;
  const timeAgo = formatTimeAgo(vehicle.updated_at || vehicle.created_at);

  // LIST VIEW: Cursor-style - compact, dense, single row
  if (viewMode === 'list') {
    return (
      <Link
        to={`/vehicle/${vehicle.id}`}
        style={{
          display: 'grid',
          gridTemplateColumns: '60px 2fr 1fr 1fr 80px 60px',
          gap: '12px',
          alignItems: 'center',
          padding: '6px 8px',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '0px',
          textDecoration: 'none',
          color: 'inherit',
          transition: 'all 0.12s ease',
          marginBottom: '1px',
          fontSize: '8pt',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--grey-50)';
          e.currentTarget.style.borderColor = 'var(--text)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'var(--surface)';
          e.currentTarget.style.borderColor = 'var(--border)';
        }}
      >
        {/* Compact thumbnail - 60px */}
        <div style={{
          width: '60px',
          height: '60px',
          flexShrink: 0,
          borderRadius: '0px',
          border: '1px solid var(--border)',
          background: imageUrl ? `url(${imageUrl}) center/cover` : 'var(--grey-200)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '20px',
        }}>
          {!imageUrl && '🚗'}
        </div>
        
        {/* Vehicle - single line */}
        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <span style={{ fontWeight: 700, fontSize: '9pt' }}>
            {vehicle.year} {vehicle.make} {vehicle.model}
          </span>
          <span style={{ color: 'var(--text-muted)', marginLeft: '8px' }}>
            {vehicle.uploader_name && `by ${vehicle.uploader_name}`}
          </span>
        </div>
        
        {/* Stats - compact */}
        <div style={{ fontSize: '8pt', color: 'var(--text-secondary)' }}>
          {vehicle.mileage ? `${(vehicle.mileage / 1000).toFixed(0)}k mi` : '—'}
          {vehicle.condition_rating && ` • C:${vehicle.condition_rating}`}
          {vehicle.vin && ` • ${vehicle.vin.slice(-4)}`}
        </div>
        
        {/* Counts */}
        <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
          {vehicle.image_count || 0} img • {vehicle.event_count || 0} evt
        </div>
        
        {/* Value */}
        <div style={{ textAlign: 'right', fontWeight: 700, fontSize: '9pt' }}>
          {formatPrice(vehicle.current_value)}
        </div>
        
        {/* Profit (if valid) */}
        <div style={{ textAlign: 'right', fontSize: '8pt', fontWeight: 600 }}>
          {vehicle.current_value && vehicle.purchase_price && 
           vehicle.purchase_price > 0 && 
           vehicle.purchase_price < vehicle.current_value * 5 ? (
            <span style={{ color: vehicle.current_value > vehicle.purchase_price ? '#10b981' : '#ef4444' }}>
              {vehicle.current_value > vehicle.purchase_price ? '+' : ''}
              {formatPrice(vehicle.current_value - vehicle.purchase_price)}
            </span>
          ) : (
            <span style={{ color: 'var(--text-muted)' }}>—</span>
          )}
        </div>
      </Link>
    );
  }

  // GALLERY VIEW: Full-width, information-dense overlay
  if (viewMode === 'gallery') {
    // Only calculate profit if data makes sense
    const profit = vehicle.current_value && vehicle.purchase_price &&
                   vehicle.purchase_price > 0 &&
                   vehicle.purchase_price < vehicle.current_value * 5
      ? vehicle.current_value - vehicle.purchase_price 
      : null;
    
    return (
      <Link
        to={`/vehicle/${vehicle.id}`}
        style={{
          display: 'block',
          background: 'var(--surface)',
          border: '2px solid var(--border)',
          borderRadius: '0px',
          overflow: 'hidden',
          textDecoration: 'none',
          color: 'inherit',
          transition: 'all 0.12s ease',
          marginBottom: '4px',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = 'var(--text)';
          e.currentTarget.style.transform = 'translateX(4px)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = 'var(--border)';
          e.currentTarget.style.transform = 'translateX(0)';
        }}
      >
        {/* Large hero image (uses large variant) */}
        <div style={{
          width: '100%',
          height: '300px',
          background: imageUrl ? `url(${imageUrl}) center/cover` : 'var(--grey-200)',
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '48px',
        }}>
          {!imageUrl && '🚗'}
          
          {/* Data overlay - bottom */}
          <div style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            background: 'rgba(0,0,0,0.85)',
            padding: '12px 16px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              {/* Left: Vehicle info */}
              <div>
                <div style={{ fontSize: '13pt', fontWeight: 700, color: 'white', marginBottom: '2px' }}>
                  {vehicle.year} {vehicle.make} {vehicle.model}
                </div>
                <div style={{ fontSize: '8pt', color: 'rgba(255,255,255,0.7)' }}>
                  {vehicle.uploader_name && `by ${vehicle.uploader_name}`}
                  {vehicle.mileage && ` • ${vehicle.mileage.toLocaleString()} mi`}
                  {vehicle.vin && ` • VIN: ${vehicle.vin.slice(-6)}`}
                </div>
              </div>
              
              {/* Right: Finance */}
              <div style={{ textAlign: 'right' }}>
                {vehicle.current_value && (
                  <div style={{ fontSize: '12pt', fontWeight: 700, color: 'white' }}>
                    {formatPrice(vehicle.current_value)}
                  </div>
                )}
                {profit !== null && (
                  <div style={{ 
                    fontSize: '9pt', 
                    fontWeight: 600,
                    color: profit > 0 ? '#10b981' : '#ef4444'
                  }}>
                    {profit > 0 ? '+' : ''}{formatPrice(profit)}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        
        {/* Bottom bar with counts */}
        <div style={{
          padding: '8px 16px',
          background: 'var(--surface)',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          gap: '12px',
          fontSize: '8pt',
          color: 'var(--text-secondary)',
        }}>
          {vehicle.image_count ? <span>{vehicle.image_count} images</span> : null}
          {vehicle.event_count ? <span>{vehicle.event_count} events</span> : null}
          {vehicle.condition_rating && <span>Condition: {vehicle.condition_rating}/10</span>}
        </div>
      </Link>
    );
  }

  // GRID VIEW: Compact but information-dense
  // Only calculate profit if data makes sense
  const profit = vehicle.current_value && vehicle.purchase_price &&
                 vehicle.purchase_price > 0 &&
                 vehicle.purchase_price < vehicle.current_value * 5
    ? vehicle.current_value - vehicle.purchase_price 
    : null;
  
  return (
    <Link
      to={`/vehicle/${vehicle.id}`}
      style={{
        display: 'block',
        background: 'var(--surface)',
        border: '2px solid var(--border)',
        borderRadius: '0px',
        overflow: 'hidden',
        textDecoration: 'none',
        color: 'inherit',
        transition: 'all 0.12s ease',
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--text)';
        e.currentTarget.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border)';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      {/* Square image (uses medium variant) */}
      <div style={{
        width: '100%',
        paddingBottom: '100%',
        background: imageUrl ? `url(${imageUrl}) center/cover` : 'var(--grey-200)',
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '32px',
      }}>
        {!imageUrl && '🚗'}
        
        {/* Value tag */}
        {vehicle.current_value && (
          <div style={{
            position: 'absolute',
            bottom: '6px',
            left: '6px',
            background: 'rgba(0,0,0,0.85)',
            color: 'white',
            padding: '4px 8px',
            borderRadius: '0px',
            border: '1px solid rgba(255,255,255,0.2)',
            fontSize: '9pt',
            fontWeight: 700,
          }}>
            {formatPrice(vehicle.current_value)}
          </div>
        )}
        
        {/* Profit badge (if we have data) */}
        {profit !== null && profit !== 0 && (
          <div style={{
            position: 'absolute',
            top: '6px',
            right: '6px',
            background: profit > 0 ? '#10b981' : '#ef4444',
            color: 'white',
            padding: '4px 8px',
            borderRadius: '0px',
            fontSize: '8pt',
            fontWeight: 700,
          }}>
            {profit > 0 ? '+' : ''}{formatPrice(profit)}
          </div>
        )}
      </div>
      
      {/* Dense info panel */}
      <div style={{ padding: '8px', borderTop: '2px solid var(--border)' }}>
        <div style={{ 
          fontSize: '10pt', 
          fontWeight: 700, 
          overflow: 'hidden', 
          textOverflow: 'ellipsis', 
          whiteSpace: 'nowrap',
          marginBottom: '2px'
        }}>
          {vehicle.year} {vehicle.make}
        </div>
        <div style={{ 
          fontSize: '9pt', 
          color: 'var(--text-secondary)',
          overflow: 'hidden', 
          textOverflow: 'ellipsis', 
          whiteSpace: 'nowrap',
          marginBottom: '4px'
        }}>
          {vehicle.model}
        </div>
        <div style={{
          fontSize: '8pt',
          color: 'var(--text-muted)',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '4px',
        }}>
          {vehicle.mileage && <span>{(vehicle.mileage / 1000).toFixed(0)}k mi</span>}
          {vehicle.condition_rating && <span>C:{vehicle.condition_rating}/10</span>}
          {vehicle.image_count ? <span>{vehicle.image_count} img</span> : null}
          {vehicle.event_count ? <span>{vehicle.event_count} evt</span> : null}
        </div>
      </div>
    </Link>
  );
};

export default VehicleCardDense;

