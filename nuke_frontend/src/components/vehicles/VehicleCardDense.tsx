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
        {/* Thumbnail - 120px (uses thumbnail variant) */}
        <div style={{
          width: '120px',
          height: '120px',
          flexShrink: 0,
          borderRadius: '0px',
          border: '2px solid var(--border)',
          background: imageUrl ? `url(${imageUrl}) center/cover` : 'var(--grey-200)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '32px',
        }}>
          {!imageUrl && '🚗'}
        </div>
        
        {/* Main content - Information dense */}
        <div style={{ flex: 1, minWidth: 0, display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '16px' }}>
          {/* Left: Vehicle facts */}
          <div>
            <div style={{ 
              fontSize: '11pt', 
              fontWeight: 700, 
              marginBottom: '2px',
              overflow: 'hidden', 
              textOverflow: 'ellipsis', 
              whiteSpace: 'nowrap' 
            }}>
              {vehicle.year} {vehicle.make} {vehicle.model}
            </div>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>
              {vehicle.uploader_name && `by ${vehicle.uploader_name}`}
              {vehicle.vin && ` • VIN: ${vehicle.vin.slice(-6)}`}
            </div>
            <div style={{ 
              fontSize: '8pt', 
              color: 'var(--text-secondary)',
              display: 'flex',
              gap: '8px',
            }}>
              {vehicle.mileage && <span>{vehicle.mileage.toLocaleString()} mi</span>}
              {vehicle.condition_rating && <span>Cond: {vehicle.condition_rating}/10</span>}
              {vehicle.image_count ? <span>{vehicle.image_count} images</span> : null}
              {vehicle.event_count ? <span>{vehicle.event_count} events</span> : null}
            </div>
          </div>
          
          {/* Center: Finance */}
          <div>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '2px' }}>VALUE</div>
            <div style={{ fontSize: '10pt', fontWeight: 700 }}>
              {formatPrice(vehicle.current_value)}
            </div>
            {vehicle.purchase_price && (
              <>
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '6px', marginBottom: '2px' }}>PAID</div>
                <div style={{ fontSize: '9pt', color: 'var(--text-secondary)' }}>
                  {formatPrice(vehicle.purchase_price)}
                </div>
              </>
            )}
          </div>
          
          {/* Right: Status & Profit */}
          <div>
            {vehicle.asking_price && (
              <>
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '2px' }}>ASKING</div>
                <div style={{ fontSize: '10pt', fontWeight: 700, color: 'var(--accent)' }}>
                  {formatPrice(vehicle.asking_price)}
                </div>
              </>
            )}
            {vehicle.current_value && vehicle.purchase_price && (
              <>
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '6px', marginBottom: '2px' }}>GAIN</div>
                <div style={{ 
                  fontSize: '9pt', 
                  fontWeight: 600,
                  color: vehicle.current_value > vehicle.purchase_price ? '#10b981' : '#ef4444' 
                }}>
                  {formatPrice(vehicle.current_value - vehicle.purchase_price)}
                </div>
              </>
            )}
          </div>
        </div>
      </Link>
    );
  }

  // GALLERY VIEW: Full-width, information-dense overlay
  if (viewMode === 'gallery') {
    const profit = vehicle.current_value && vehicle.purchase_price 
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
  const profit = vehicle.current_value && vehicle.purchase_price 
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

