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
    view_count?: number;
    active_viewers?: number;
    is_streaming?: boolean;
    price_change?: number;
    all_images?: Array<{ id: string; url: string; is_primary: boolean }>;
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

  // GALLERY VIEW: Horizontal swipeable card
  if (viewMode === 'gallery') {
    const sharePrice = vehicle.current_value ? vehicle.current_value / 100 : null;
    
    return (
      <Link
        to={`/vehicle/${vehicle.id}`}
        style={{
          display: 'block',
          background: 'rgba(255, 255, 255, 0.75)',
          backdropFilter: 'blur(15px)',
          border: '1px solid rgba(0, 0, 0, 0.08)',
          borderRadius: '8px',
          overflow: 'hidden',
          textDecoration: 'none',
          color: 'inherit',
          transition: 'all 0.12s ease',
          marginBottom: '8px',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.95)';
          e.currentTarget.style.transform = 'translateY(-2px)';
          e.currentTarget.style.boxShadow = '0 6px 16px rgba(0,0,0,0.12)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.75)';
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = 'none';
        }}
      >
        {/* Image preview */}
        <div style={{
          width: '100%',
          height: '200px',
          background: imageUrl ? `url(${imageUrl}) center/cover` : 'url(/n-zero.png) center/contain',
          backgroundSize: imageUrl ? 'cover' : 'contain',
          backgroundColor: '#f5f5f5',
          position: 'relative',
        }}>
          {/* LIVE badge - top left */}
          {vehicle.is_streaming && (
            <div style={{
              position: 'absolute',
              top: '8px',
              left: '8px',
              background: '#ef4444',
              color: 'white',
              padding: '4px 10px',
              borderRadius: '4px',
              fontSize: '7pt',
              fontWeight: 700,
              letterSpacing: '0.5px',
              boxShadow: '0 2px 8px rgba(239, 68, 68, 0.5)',
            }}>
              LIVE
            </div>
          )}
          
          {/* Price - top right */}
          {vehicle.current_value && (
            <div style={{
              position: 'absolute',
              top: '8px',
              right: '8px',
              background: 'rgba(0, 0, 0, 0.8)',
              backdropFilter: 'blur(8px)',
              color: 'white',
              padding: '6px 12px',
              borderRadius: '6px',
              fontSize: '9pt',
              fontWeight: 700,
            }}>
              {formatPrice(vehicle.current_value)}
            </div>
          )}
          
          {/* Active viewers - bottom left */}
          {vehicle.active_viewers > 0 && (
            <div style={{
              position: 'absolute',
              bottom: '8px',
              left: '8px',
              background: 'rgba(0, 0, 0, 0.7)',
              color: 'white',
              padding: '3px 8px',
              borderRadius: '12px',
              fontSize: '7pt',
              fontWeight: 600,
            }}>
              {vehicle.active_viewers} watching
            </div>
          )}
        </div>
        
        {/* Info panel - compact, all key data */}
        <div style={{ 
          padding: '10px 12px',
          background: 'transparent'
        }}>
          {/* Share price line */}
          {sharePrice && (
            <div style={{
              fontSize: '7pt',
              color: '#888',
              marginBottom: '6px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderBottom: '1px solid rgba(0,0,0,0.05)',
              paddingBottom: '4px'
            }}>
              <span>Share: ${sharePrice.toFixed(2)}</span>
              {vehicle.price_change && (
                <span style={{ 
                  color: vehicle.price_change > 0 ? '#10b981' : '#ef4444',
                  fontWeight: 700
                }}>
                  {vehicle.price_change > 0 ? '+' : ''}{vehicle.price_change.toFixed(1)}%
                </span>
              )}
            </div>
          )}
          
          {/* Vehicle name */}
          <div style={{ 
            fontSize: '10pt', 
            fontWeight: 700, 
            lineHeight: 1.2,
            marginBottom: '6px',
            color: '#000'
          }}>
            {vehicle.year} {vehicle.make} {vehicle.model}
          </div>
          
          {/* Metadata row - shop, views, rating, update */}
          <div style={{
            fontSize: '7pt',
            color: '#666',
            display: 'flex',
            gap: '6px',
            flexWrap: 'wrap',
            alignItems: 'center'
          }}>
            {/* Shop/User */}
            {vehicle.uploader_name && (
              <span style={{ fontWeight: 600 }}>{vehicle.uploader_name}</span>
            )}
            {vehicle.uploader_name && <span>•</span>}
            
            {/* Views */}
            {vehicle.view_count > 0 && (
              <span>{vehicle.view_count} views</span>
            )}
            
            {/* Letter rating */}
            {vehicle.condition_rating && (
              <>
                <span>•</span>
                <span style={{ 
                  fontWeight: 700, 
                  color: vehicle.condition_rating >= 8 ? '#10b981' : vehicle.condition_rating >= 6 ? '#f59e0b' : '#ef4444'
                }}>
                  Grade: {vehicle.condition_rating >= 9 ? 'A+' : 
                          vehicle.condition_rating >= 8 ? 'A' :
                          vehicle.condition_rating >= 7 ? 'B+' :
                          vehicle.condition_rating >= 6 ? 'B' :
                          vehicle.condition_rating >= 5 ? 'C' : 'D'}
                </span>
              </>
            )}
            
            {/* Recent update */}
            {timeAgo && (
              <>
                <span>•</span>
                <span style={{ opacity: 0.7 }}>
                  {timeAgo}
                </span>
              </>
            )}
          </div>
        </div>
      </Link>
    );
  }

  // GRID VIEW: Mobile-optimized card with horizontal swipeable image carousel
  // Shows multiple images in a grid that user can swipe through
  const sharePrice = vehicle.current_value ? vehicle.current_value / 100 : null;
  const [currentImageIndex, setCurrentImageIndex] = React.useState(0);
  const [touchStart, setTouchStart] = React.useState(0);
  
  // Use all_images array from homepage query (up to 5 images)
  const vehicleImages = vehicle.all_images?.map(img => img.url) || [imageUrl].filter(Boolean);
  const currentImageUrl = vehicleImages[currentImageIndex] || imageUrl;
  
  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStart(e.touches[0].clientX);
  };
  
  const handleTouchEnd = (e: React.TouchEvent) => {
    const touchEnd = e.changedTouches[0].clientX;
    const diff = touchStart - touchEnd;
    
    if (Math.abs(diff) > 50) {
      e.preventDefault();
      e.stopPropagation();
      
      if (diff > 0 && currentImageIndex < vehicleImages.length - 1) {
        setCurrentImageIndex(currentImageIndex + 1);
      } else if (diff < 0 && currentImageIndex > 0) {
        setCurrentImageIndex(currentImageIndex - 1);
      }
    }
  };
  
  return (
    <Link
      to={`/vehicle/${vehicle.id}`}
      style={{
        display: 'block',
        background: '#000',
        border: 'none',
        borderRadius: '0',
        overflow: 'hidden',
        textDecoration: 'none',
        color: 'inherit',
        transition: 'all 0.12s ease',
        cursor: 'pointer',
        position: 'relative'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.opacity = '0.85';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.opacity = '1';
      }}
    >
      {/* Horizontal swipeable image grid (1:1 ratio) */}
      <div 
        style={{
          width: '100%',
          paddingBottom: '100%',
          background: currentImageUrl ? `url(${currentImageUrl}) center/cover` : 'url(/n-zero.png) center/contain',
          backgroundSize: currentImageUrl ? 'cover' : 'contain',
          backgroundColor: '#f5f5f5',
          position: 'relative',
        }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Price overlay - top right */}
        {vehicle.current_value && (
          <div style={{
            position: 'absolute',
            top: '6px',
            right: '6px',
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(5px)',
            color: 'white',
            padding: '4px 8px',
            borderRadius: '4px',
            fontSize: '8pt',
            fontWeight: 700,
          }}>
            {formatPrice(vehicle.current_value)}
          </div>
        )}
        
        {/* LIVE badge - top left */}
        {vehicle.is_streaming && (
          <div style={{
            position: 'absolute',
            top: '6px',
            left: '6px',
            background: '#ef4444',
            color: 'white',
            padding: '3px 8px',
            borderRadius: '3px',
            fontSize: '7pt',
            fontWeight: 700,
            letterSpacing: '0.5px',
            animation: 'pulse 2s ease-in-out infinite'
          }}>
            LIVE
          </div>
        )}
      </div>
      
      {/* Compact info panel */}
      <div style={{ 
        padding: '8px',
        background: 'transparent'
      }}>
        {/* Share price line */}
        {sharePrice && (
          <div style={{
            fontSize: '7pt',
            color: '#666',
            marginBottom: '4px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span>Share: ${sharePrice.toFixed(2)}</span>
            {vehicle.price_change && (
              <span style={{ 
                color: vehicle.price_change > 0 ? '#10b981' : '#ef4444',
                fontWeight: 600
              }}>
                {vehicle.price_change > 0 ? '+' : ''}{vehicle.price_change.toFixed(1)}%
              </span>
            )}
          </div>
        )}
        
        {/* Vehicle name */}
        <div style={{ 
          fontSize: '9pt', 
          fontWeight: 700, 
          lineHeight: 1.1,
          marginBottom: '4px',
          color: '#000'
        }}>
          {vehicle.year} {vehicle.make} {vehicle.model}
        </div>
        
        {/* Metadata row - all small, single line */}
        <div style={{
          fontSize: '7pt',
          color: '#666',
          display: 'flex',
          gap: '6px',
          flexWrap: 'wrap',
          alignItems: 'center'
        }}>
          {/* Shop/User responsible */}
          {vehicle.uploader_name && (
            <span style={{ fontWeight: 500 }}>{vehicle.uploader_name}</span>
          )}
          {vehicle.uploader_name && <span>•</span>}
          
          {/* Views / Active viewers */}
          {vehicle.view_count > 0 && (
            <span>{vehicle.view_count} views</span>
          )}
          {vehicle.active_viewers > 0 && (
            <span>({vehicle.active_viewers} watching)</span>
          )}
          
          {/* Letter rating */}
          {vehicle.condition_rating && (
            <span style={{ 
              fontWeight: 700, 
              color: vehicle.condition_rating >= 8 ? '#10b981' : vehicle.condition_rating >= 6 ? '#f59e0b' : '#ef4444'
            }}>
              {vehicle.condition_rating >= 9 ? 'A+' : 
               vehicle.condition_rating >= 8 ? 'A' :
               vehicle.condition_rating >= 7 ? 'B+' :
               vehicle.condition_rating >= 6 ? 'B' :
               vehicle.condition_rating >= 5 ? 'C' : 'D'}
            </span>
          )}
          
          {/* Recent update note */}
          {timeAgo && (
            <span style={{ opacity: 0.7, marginLeft: 'auto' }}>
              {timeAgo}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
};

export default VehicleCardDense;

