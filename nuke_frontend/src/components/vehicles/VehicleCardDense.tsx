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
    if (!price) return null;
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
  const priceChangeColor = priceChange?.startsWith('+') ? 'var(--success)' : 'var(--error)';

  // Generate fake social metrics for demo
  const likes = showSocial ? Math.floor(Math.random() * 50) : 0;
  const comments = showSocial ? Math.floor(Math.random() * 20) : 0;

  const getCardStyle = () => {
    switch (viewMode) {
      case 'gallery':
        return {
          padding: '12px',
          background: 'var(--surface)',
          border: '2px solid var(--border)',
          borderRadius: '4px',
          display: 'flex',
          flexDirection: 'row' as const,
          gap: '12px',
          textDecoration: 'none',
          color: 'inherit',
          transition: 'all 0.12s ease',
          width: '100%',
          boxSizing: 'border-box' as const,
          cursor: 'pointer',
        };
      case 'grid':
        return {
          padding: '6px',
          background: 'var(--surface)',
          border: '2px solid var(--border)',
          borderRadius: '3px',
          display: 'flex',
          flexDirection: 'column' as const,
          gap: '4px',
          textDecoration: 'none',
          color: 'inherit',
          transition: 'all 0.12s ease',
          width: '100%',
          boxSizing: 'border-box' as const,
          cursor: 'pointer',
        };
      default: // list
        return {
          padding: '8px',
          background: 'var(--surface)',
          border: '2px solid var(--border)',
          borderRadius: '4px',
          display: 'flex',
          gap: '8px',
          textDecoration: 'none',
          color: 'inherit',
          transition: 'all 0.12s ease',
          width: '100%',
          boxSizing: 'border-box' as const,
          minWidth: 0,
        };
    }
  };

  const getImageSize = () => {
    switch (viewMode) {
      case 'gallery':
        return { width: '200px', height: '120px' };
      case 'grid':
        return { width: '100%', height: '80px' };
      default: // list
        return { width: '64px', height: '64px' };
    }
  };

  return (
    <Link
      to={`/vehicle/${vehicle.id}`}
      style={getCardStyle()}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.borderColor = '#0ea5e9';
        el.style.boxShadow = '0 0 0 3px #0ea5e922';
        el.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.borderColor = 'var(--border)';
        el.style.boxShadow = 'none';
        el.style.transform = 'translateY(0)';
      }}
    >
      {/* Image */}
      <div
        style={{
          ...getImageSize(),
          borderRadius: viewMode === 'list' ? '2px' : '3px',
          background: vehicle.primary_image_url
            ? `url(${vehicle.primary_image_url}) center/cover`
            : 'var(--border)',
          flexShrink: 0,
          position: 'relative' as const,
        }}
      >
        {/* Price change indicator for grid view */}
        {showPriceChange && priceChange && (
          <div style={{
            position: 'absolute' as const,
            top: '4px',
            right: '4px',
            background: 'var(--bg)',
            color: priceChangeColor,
            padding: '2px 4px',
            borderRadius: '2px',
            fontSize: '8px',
            fontWeight: 500,
          }}>
            {priceChange}
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ 
        flex: 1, 
        display: 'flex', 
        flexDirection: 'column', 
        gap: viewMode === 'grid' ? '2px' : '4px', 
        minWidth: 0, 
        overflow: 'hidden' 
      }}>
        {/* Title */}
        <div style={{ 
          fontSize: viewMode === 'grid' ? '10px' : '11px', 
          fontWeight: 500, 
          overflow: 'hidden', 
          textOverflow: 'ellipsis', 
          whiteSpace: 'nowrap' 
        }}>
          {vehicle.year} {vehicle.make} {vehicle.model}
        </div>

        {/* Price */}
        {displayPrice && (
          <div style={{ 
            fontSize: viewMode === 'grid' ? '9px' : '10px', 
            fontFamily: 'var(--font-mono, monospace)',
            color: 'var(--text)',
            fontWeight: 500
          }}>
            {formatPrice(displayPrice)}
          </div>
        )}

        {/* Social metrics for gallery view */}
        {showSocial && (likes > 0 || comments > 0) && (
          <div style={{ 
            fontSize: '8px', 
            color: 'var(--text-secondary)',
            display: 'flex',
            gap: '8px'
          }}>
            {likes > 0 && <span>❤️ {likes}</span>}
            {comments > 0 && <span>💬 {comments}</span>}
          </div>
        )}

        {/* Meta info */}
        <div style={{ 
          fontSize: '8px', 
          color: 'var(--text-secondary)', 
          display: 'flex', 
          gap: '6px', 
          alignItems: 'center', 
          flexWrap: 'wrap' 
        }}>
          {vehicle.location && <span>{vehicle.location}</span>}
          {!vehicle.location && timeAgo && <span>{timeAgo}</span>}
          {vehicle.event_count !== undefined && vehicle.event_count > 0 && (
            <span>{vehicle.event_count} events</span>
          )}
        </div>
      </div>
    </Link>
  );
};

export default VehicleCardDense;

