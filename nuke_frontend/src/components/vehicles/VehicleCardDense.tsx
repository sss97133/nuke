import React from 'react';
import { Link } from 'react-router-dom';

interface VehicleCardDenseProps {
  vehicle: {
    id: string;
    year?: number;
    make?: string;
    model?: string;
    primary_image_url?: string;
    sale_price?: number;
    current_value?: number;
    location?: string;
    updated_at?: string;
    created_at?: string;
    is_for_sale?: boolean;
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

  const displayPrice = vehicle.sale_price || vehicle.current_value;
  const timeAgo = formatTimeAgo(vehicle.updated_at || vehicle.created_at);

  // Generate fake price change for demo
  const priceChange = showPriceChange ? (Math.random() > 0.5 ? '+' : '-') + (Math.random() * 10).toFixed(1) + '%' : null;
  const priceChangeColor = priceChange?.startsWith('+') ? '#10b981' : '#ef4444';

  // Generate fake social metrics for demo
  const views = showSocial ? Math.floor(Math.random() * 500 + 100) : 0;
  const bids = showSocial ? Math.floor(Math.random() * 15) : 0;

  // LIST VIEW: Clean, scannable, proper marketplace
  if (viewMode === 'list') {
    return (
      <Link
        to={`/vehicle/${vehicle.id}`}
        style={{
          display: 'flex',
          gap: '16px',
          alignItems: 'center',
          padding: '12px',
          background: 'var(--surface)',
          border: '2px solid var(--border)',
          borderRadius: '0px',
          textDecoration: 'none',
          color: 'inherit',
          transition: 'all 0.12s ease',
          marginBottom: '2px',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--grey-50)';
          e.currentTarget.style.borderColor = 'var(--text)';
          e.currentTarget.style.transform = 'translateX(4px)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'var(--surface)';
          e.currentTarget.style.borderColor = 'var(--border)';
          e.currentTarget.style.transform = 'translateX(0)';
        }}
      >
        {/* Bigger thumbnail - 120px square */}
        <div style={{
          width: '120px',
          height: '120px',
          flexShrink: 0,
          borderRadius: '0px',
          border: '2px solid var(--border)',
          background: vehicle.primary_image_url ? `url(${vehicle.primary_image_url}) center/cover` : 'var(--grey-200)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '32px',
        }}>
          {!vehicle.primary_image_url && '🚗'}
        </div>
        
        {/* Main content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Vehicle name */}
          <div style={{ 
            fontSize: '11pt', 
            fontWeight: 700, 
            marginBottom: '4px',
            overflow: 'hidden', 
            textOverflow: 'ellipsis', 
            whiteSpace: 'nowrap' 
          }}>
            {vehicle.year} {vehicle.make} {vehicle.model}
          </div>
          
          {/* Value */}
          {displayPrice && (
            <div style={{ 
              fontSize: '9pt', 
              color: 'var(--text-secondary)',
              marginBottom: '4px' 
            }}>
              {formatPrice(displayPrice)}
            </div>
          )}
          
          {/* Meta info */}
          <div style={{ 
            fontSize: '8pt', 
            color: 'var(--text-muted)',
            display: 'flex',
            gap: '12px',
            flexWrap: 'wrap'
          }}>
            {vehicle.event_count && (
              <span>{vehicle.event_count} events</span>
            )}
            {timeAgo && <span>Updated {timeAgo}</span>}
          </div>
        </div>
      </Link>
    );
  }

  // GALLERY VIEW: BAT-style, full-width hero images
  if (viewMode === 'gallery') {
    return (
      <Link
        to={`/vehicle/${vehicle.id}`}
        style={{
          display: 'block',
          background: 'var(--surface)',
          border: '2px solid var(--border)',
          borderRadius: '4px',
          overflow: 'hidden',
          textDecoration: 'none',
          color: 'inherit',
          transition: 'all 0.12s ease',
          marginBottom: '16px',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = 'var(--accent)';
          e.currentTarget.style.transform = 'translateY(-2px)';
          e.currentTarget.style.boxShadow = '0 8px 16px rgba(0,0,0,0.1)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = 'var(--border)';
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = 'none';
        }}
      >
        {/* Full-width hero image */}
        <div style={{
          width: '100%',
          height: '400px',
          background: vehicle.primary_image_url ? `url(${vehicle.primary_image_url}) center/cover` : 'var(--border)',
          position: 'relative',
        }}>
          {/* Overlay gradient */}
          <div style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: '120px',
            background: 'linear-gradient(to top, rgba(0,0,0,0.8), transparent)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            padding: '20px',
          }}>
            {/* Title */}
            <div style={{ fontSize: '20px', fontWeight: 700, color: 'white', marginBottom: '4px' }}>
              {vehicle.year} {vehicle.make} {vehicle.model}
            </div>
            
            {/* Stats bar */}
            <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: 'rgba(255,255,255,0.9)' }}>
              {displayPrice && (
                <span style={{ fontWeight: 600 }}>{formatPrice(displayPrice)}</span>
              )}
              {showSocial && views > 0 && <span>👁 {views.toLocaleString()}</span>}
              {showSocial && bids > 0 && <span>🔨 {bids} bids</span>}
              {timeAgo && <span>{timeAgo}</span>}
            </div>
          </div>
        </div>
      </Link>
    );
  }

  // GRID VIEW: Instagram/Craigslist style, compact squares
  return (
    <Link
      to={`/vehicle/${vehicle.id}`}
      style={{
        display: 'block',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '2px',
        overflow: 'hidden',
        textDecoration: 'none',
        color: 'inherit',
        transition: 'all 0.12s ease',
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--accent)';
        e.currentTarget.style.transform = 'scale(1.02)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border)';
        e.currentTarget.style.transform = 'scale(1)';
      }}
    >
      {/* Square image */}
      <div style={{
        width: '100%',
        paddingBottom: '100%', // 1:1 aspect ratio
        background: vehicle.primary_image_url ? `url(${vehicle.primary_image_url}) center/cover` : 'var(--border)',
        position: 'relative',
      }}>
        {/* Price overlay */}
        {displayPrice && (
          <div style={{
            position: 'absolute',
            bottom: '6px',
            left: '6px',
            background: 'rgba(0,0,0,0.75)',
            color: 'white',
            padding: '3px 6px',
            borderRadius: '2px',
            fontSize: '10px',
            fontWeight: 600,
          }}>
            {formatPrice(displayPrice)}
          </div>
        )}
        
        {/* Price change badge */}
        {showPriceChange && priceChange && (
          <div style={{
            position: 'absolute',
            top: '6px',
            right: '6px',
            background: priceChangeColor,
            color: 'white',
            padding: '3px 6px',
            borderRadius: '2px',
            fontSize: '9px',
            fontWeight: 700,
          }}>
            {priceChange}
          </div>
        )}
      </div>
      
      {/* Compact info */}
      <div style={{ padding: '6px' }}>
        <div style={{ 
          fontSize: '10px', 
          fontWeight: 600, 
          overflow: 'hidden', 
          textOverflow: 'ellipsis', 
          whiteSpace: 'nowrap',
          marginBottom: '2px'
        }}>
          {vehicle.year} {vehicle.make}
        </div>
        <div style={{ 
          fontSize: '9px', 
          color: 'var(--text-secondary)',
          overflow: 'hidden', 
          textOverflow: 'ellipsis', 
          whiteSpace: 'nowrap'
        }}>
          {vehicle.model}
        </div>
      </div>
    </Link>
  );
};

export default VehicleCardDense;

