import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { UnifiedPricingService } from '../../services/unifiedPricingService';

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
    roi_pct?: number;
    hype_reason?: string;
    all_images?: Array<{ id: string; url: string; is_primary: boolean }>;
    tier?: string;
    tier_label?: string;
    profile_origin?: string; // 'bat_import', 'url_scraper', 'user_upload', etc.
    activity_7d?: number; // Recent activity (timeline events in last 7 days)
    receipt_count?: number; // Number of receipts (build documentation)
    ownership_verified?: boolean; // Has verified ownership records
  };
  viewMode?: 'list' | 'gallery' | 'grid';
  showSocial?: boolean;
  showPriceChange?: boolean;
  /** Controls whether price badges/overlays are shown on cards */
  showPriceOverlay?: boolean;
  /** Controls whether the semi-transparent detail overlay is shown on image */
  showDetailOverlay?: boolean;
}

const VehicleCardDense: React.FC<VehicleCardDenseProps> = ({
  vehicle,
  viewMode = 'list',
  showSocial = false,
  showPriceChange = false,
  showPriceOverlay = true,
  showDetailOverlay = true
}) => {
  const [displayPrice, setDisplayPrice] = useState<string>('—');
  const [priceLabel, setPriceLabel] = useState<string>('');

  // Load unified price on component mount
  useEffect(() => {
    const loadPrice = async () => {
      try {
        const price = await UnifiedPricingService.getDisplayPrice(vehicle.id);
        setDisplayPrice(UnifiedPricingService.formatPrice(price.displayValue));
        setPriceLabel(price.displayLabel);
      } catch (error) {
        setDisplayPrice('—');
        setPriceLabel('');
      }
    };
    loadPrice();
  }, [vehicle.id]);

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
    const diffInMs = now.getTime() - date.getTime();
    const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
    const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60));

    // Show minutes for anything less than 1 hour
    if (diffInMinutes < 1) return 'Just now';
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    if (diffInHours < 24) return `${diffInHours}h ago`;
    if (diffInHours < 168) return `${Math.floor(diffInHours / 24)}d ago`;
    return `${Math.floor(diffInHours / 168)}w ago`;
  };

  // Calculate alphabet-based tier (F, E, D, C, B, A, S, SSS)
  // Tier is based on COMPLETENESS and QUALITY of information
  // Tiers increase as users provide more information - NOT locked in
  // S and SSS are ONLY manually assigned (never auto-calculated)
  const calculateVehicleTier = (vehicle: VehicleCardDenseProps['vehicle']): string => {
    // If tier is manually set to S or SSS, use it (never override manual assignments)
    if (vehicle.tier_label === 'S' || vehicle.tier_label === 'SSS') {
      return vehicle.tier_label;
    }
    if (vehicle.tier === 'S' || vehicle.tier === 'SSS') {
      return vehicle.tier;
    }
    
    // Completeness scoring factors (can be extended/modified as requirements evolve)
    const completenessFactors = {
      // Basic identification (required for any tier above F)
      hasVIN: vehicle.vin && vehicle.vin.length === 17,
      hasPrice: !!(vehicle.asking_price || vehicle.current_value || vehicle.sale_price),
      hasYearMakeModel: !!(vehicle.year && vehicle.make && vehicle.model),
      
      // Visual documentation
      imageCount: vehicle.all_images?.length || vehicle.image_count || 0,
      
      // Engagement & activity (shows user investment)
      eventCount: vehicle.event_count || 0,
      recentActivity: vehicle.activity_7d || 0,
      viewCount: vehicle.view_count || 0,
      
      // Documentation quality
      receiptCount: vehicle.receipt_count || 0,
      ownershipVerified: vehicle.ownership_verified || false,
      
      // Source quality
      isBATImport: vehicle.profile_origin === 'bat_import',
      isScraped: vehicle.profile_origin === 'url_scraper' || 
                 vehicle.profile_origin === 'craigslist_scrape' || 
                 vehicle.profile_origin === 'ksl_import',
      isDealer: vehicle.profile_origin === 'url_scraper' || vehicle.profile_origin === 'craigslist_scrape',
      isFlipper: (vehicle.profile_origin === 'url_scraper' || vehicle.profile_origin === 'craigslist_scrape') && vehicle.is_for_sale,
    };
    
    const { hasVIN, hasPrice, hasYearMakeModel, imageCount, eventCount, recentActivity, viewCount, 
            receiptCount, ownershipVerified, isBATImport, isScraped, isDealer, isFlipper } = completenessFactors;
    
    // Calculate completeness score (0-100)
    // This scoring system can be adjusted as requirements evolve
    let completenessScore = 0;
    
    // Basic identification (20 points)
    if (hasYearMakeModel) completenessScore += 5;
    if (hasVIN) completenessScore += 10;
    if (hasPrice) completenessScore += 5;
    
    // Visual documentation (30 points)
    if (imageCount >= 1) completenessScore += 5;
    if (imageCount >= 5) completenessScore += 10;
    if (imageCount >= 10) completenessScore += 10;
    if (imageCount >= 20) completenessScore += 5;
    
    // Engagement & activity (25 points)
    if (eventCount >= 1) completenessScore += 5;
    if (eventCount >= 5) completenessScore += 10;
    if (eventCount >= 10) completenessScore += 10;
    if (recentActivity >= 3) completenessScore += 5;
    if (viewCount >= 50) completenessScore += 5;
    
    // Documentation quality (15 points)
    if (receiptCount >= 1) completenessScore += 5;
    if (receiptCount >= 5) completenessScore += 5;
    if (receiptCount >= 10) completenessScore += 5;
    if (ownershipVerified) completenessScore += 5;
    
    // Source quality adjustments (penalties for dealers/flippers)
    if (isDealer || isFlipper) {
      // Dealers/flippers need to prove quality through engagement
      if (!hasVIN || !hasPrice) completenessScore -= 10;
      if (eventCount < 2 && viewCount < 50) completenessScore -= 5;
    }
    
    // Map completeness score to tier
    // These thresholds can be adjusted as the system evolves
    if (completenessScore < 10) return 'F'; // No/minimal data
    if (completenessScore < 20) return 'E'; // Very basic
    if (completenessScore < 35) return 'D'; // Has potential, good bones
    if (completenessScore < 50) return 'C'; // Vast majority - baseline
    if (completenessScore < 65) return 'B'; // Making an effort / cool BAT cars
    if (completenessScore < 80) return 'A'; // Strong engagement and documentation
    // 80+ would be S tier, but that's manually assigned only
    
    // Fallback to C for anything with basic data
    if (hasVIN || hasPrice || imageCount >= 5) return 'C';
    return 'F';
  };

  // Get optimal image for this view mode
  // PRIORITY: primary_image_url > all_images[0] > image_variants > image_url
  const getImageUrl = () => {
    // Always prefer primary_image_url if available
    if (vehicle.primary_image_url) {
      return vehicle.primary_image_url;
    }
    
    // Fallback to first image in all_images array
    if (vehicle.all_images && vehicle.all_images.length > 0 && vehicle.all_images[0]?.url) {
      return vehicle.all_images[0].url;
    }
    
    // Then check image_variants
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
        return vehicle.image_url || null;
    }
  };

  const imageUrl = getImageUrl();
  // Use created_at (upload time) for time display
  const timeAgo = formatTimeAgo(vehicle.created_at);

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
          background: (imageUrl || vehicle.primary_image_url) ? `url(${imageUrl || vehicle.primary_image_url}) center/cover` : 'var(--grey-200)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '20px',
        }}>
          {!(imageUrl || vehicle.primary_image_url) && '🚗'}
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
          {displayPrice}
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

  // GALLERY VIEW: card with image and semi-transparent detail overlay
  if (viewMode === 'gallery') {
    return (
      <Link
        to={`/vehicle/${vehicle.id}`}
        style={{
          display: 'block',
          background: 'rgba(0, 0, 0, 0.9)',
          borderRadius: '8px',
          overflow: 'hidden',
          textDecoration: 'none',
          color: 'inherit',
          transition: 'all 0.12s ease',
          marginBottom: '8px',
        }}
      >
        {/* Image preview with overlays */}
        <div
          style={{
            width: '100%',
            height: '220px',
            background: (imageUrl || vehicle.primary_image_url) ? `url(${imageUrl || vehicle.primary_image_url}) center/cover` : 'url(/n-zero.png) center/contain',
            backgroundSize: (imageUrl || vehicle.primary_image_url) ? 'cover' : 'contain',
            backgroundColor: '#000',
            position: 'relative',
          }}
        >
          {/* LIVE badge - top left */}
          {vehicle.is_streaming && (
            <div
              style={{
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
              }}
            >
              LIVE
            </div>
          )}

          {/* Price - top right (toggleable) */}
          {showPriceOverlay && displayPrice !== '—' && (
            <div
              style={{
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
              }}
            >
              {displayPrice}
            </div>
          )}

          {/* Detail overlay along bottom of image */}
          {showDetailOverlay && (
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                padding: '10px 12px',
                background: 'linear-gradient(to top, rgba(0,0,0,0.9), rgba(0,0,0,0.45))',
                color: '#fff',
              }}
            >
              {/* Vehicle name */}
              <div
                style={{
                  fontSize: '10pt',
                  fontWeight: 700,
                  lineHeight: 1.2,
                  marginBottom: '4px',
                }}
              >
                {vehicle.year} {vehicle.make} {vehicle.model}
              </div>

              {/* Metadata row - uploader, views, images, ROI, rating, updated */}
              <div
                style={{
                  fontSize: '7pt',
                  display: 'flex',
                  gap: '6px',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  opacity: 0.9,
                }}
              >
                {vehicle.uploader_name && (
                  <span style={{ fontWeight: 600 }}>{vehicle.uploader_name}</span>
                )}
                {vehicle.uploader_name && <span>•</span>}

                {/* Accurate view count - use actual count from database */}
                {vehicle.view_count !== undefined && vehicle.view_count > 0 && (
                  <>
                    <span>{vehicle.view_count} {vehicle.view_count === 1 ? 'view' : 'views'}</span>
                    <span>•</span>
                  </>
                )}

                {/* Accurate image count - use all_images length or image_count */}
                {(() => {
                  const imageCount = vehicle.all_images?.length || vehicle.image_count || 0;
                  if (imageCount > 0) {
                    return (
                      <>
                        <span>{imageCount} {imageCount === 1 ? 'image' : 'images'}</span>
                        <span>•</span>
                      </>
                    );
                  }
                  return null;
                })()}

                {/* Vehicle Tier - alphabet-based (F, E, D, C, B, A, S, SSS) */}
                {(() => {
                  const tierLabel = vehicle.tier_label || calculateVehicleTier(vehicle);
                  
                  // Color mapping for alphabet tiers
                  const getTierColor = (tier: string) => {
                    switch (tier) {
                      case 'SSS': return '#9333ea'; // Purple - highest
                      case 'SS': return '#7c3aed';
                      case 'S': return '#8b5cf6';
                      case 'A': return '#10b981'; // Green - excellent
                      case 'B': return '#3b82f6'; // Blue - good
                      case 'C': return '#f59e0b'; // Orange - fair
                      case 'D': return '#f97316'; // Dark orange - minimal
                      case 'E': return '#ef4444'; // Red - poor
                      case 'F': return '#6b7280'; // Gray - pending/no data
                      default: return '#6b7280';
                    }
                  };
                  
                  if (tierLabel) {
                    return (
                      <>
                        <span
                          style={{
                            fontWeight: 600,
                            color: getTierColor(tierLabel)
                          }}
                        >
                          {tierLabel}
                        </span>
                        <span>•</span>
                      </>
                    );
                  }
                  return null;
                })()}

                {vehicle.condition_rating && (
                  <>
                    <span>•</span>
                    <span
                      style={{
                        fontWeight: 700,
                        color:
                          vehicle.condition_rating >= 8
                            ? '#10b981'
                            : vehicle.condition_rating >= 6
                            ? '#f59e0b'
                            : '#ef4444',
                      }}
                    >
                      Grade:{' '}
                      {vehicle.condition_rating >= 9
                        ? 'A+'
                        : vehicle.condition_rating >= 8
                        ? 'A'
                        : vehicle.condition_rating >= 7
                        ? 'B+'
                        : vehicle.condition_rating >= 6
                        ? 'B'
                        : vehicle.condition_rating >= 5
                        ? 'C'
                        : 'D'}
                    </span>
                  </>
                )}

                {vehicle.hype_reason && (
                  <>
                    <span>•</span>
                    <span>{vehicle.hype_reason}</span>
                  </>
                )}

                {timeAgo && <span style={{ marginLeft: 'auto' }}>{timeAgo}</span>}
              </div>
            </div>
          )}

          {/* Active viewers - small pill above overlay */}
          {vehicle.active_viewers > 0 && (
            <div
              style={{
                position: 'absolute',
                bottom: '8px',
                left: '8px',
                background: 'rgba(0, 0, 0, 0.75)',
                color: 'white',
                padding: '3px 8px',
                borderRadius: '12px',
                fontSize: '7pt',
                fontWeight: 600,
              }}
            >
              {vehicle.active_viewers} watching
            </div>
          )}
        </div>
      </Link>
    );
  }

  // GRID VIEW: Mobile-optimized card with horizontal swipeable image carousel
  // Shows multiple images in a grid that user can swipe through
  const [currentImageIndex, setCurrentImageIndex] = React.useState(0);
  const [touchStart, setTouchStart] = React.useState(0);
  
  // Build image array with proper fallback chain
  // Priority: all_images[0] > primary_image_url > imageUrl > image_variants > image_url
  const vehicleImages: string[] = [];
  
  // First, try all_images array
  if (vehicle.all_images && vehicle.all_images.length > 0) {
    const urls = vehicle.all_images.map(img => img.url).filter(Boolean);
    if (urls.length > 0) {
      vehicleImages.push(...urls);
    }
  }
  
  // Then try primary_image_url (if not already in array)
  if (vehicle.primary_image_url && !vehicleImages.includes(vehicle.primary_image_url)) {
    vehicleImages.push(vehicle.primary_image_url);
  }
  
  // Then try imageUrl from getImageUrl() (if not already in array)
  if (imageUrl && !vehicleImages.includes(imageUrl)) {
    vehicleImages.push(imageUrl);
  }
  
  // Then try image_variants
  if (vehicle.image_variants) {
    const variants = vehicle.image_variants;
    const variantUrls = [variants.medium, variants.large, variants.thumbnail].filter(Boolean);
    variantUrls.forEach(url => {
      if (url && !vehicleImages.includes(url)) {
        vehicleImages.push(url);
      }
    });
  }
  
  // Finally try image_url
  if (vehicle.image_url && !vehicleImages.includes(vehicle.image_url)) {
    vehicleImages.push(vehicle.image_url);
  }
  
  // Get current image URL
  const currentImageUrl = vehicleImages[currentImageIndex] || vehicleImages[0] || null;
  
  // Debug logging for grid view (first few vehicles only)
  if (viewMode === 'grid' && vehicle.id) {
    const vehicleIndex = (window as any).__debugVehicleIndex = ((window as any).__debugVehicleIndex || 0) + 1;
    if (vehicleIndex <= 5) {
      console.log(`🔍 Grid view - Vehicle ${vehicle.id}:`, {
        vehicleId: vehicle.id,
        all_images: vehicle.all_images,
        primary_image_url: vehicle.primary_image_url,
        image_url: vehicle.image_url,
        image_variants: vehicle.image_variants,
        imageUrl,
        vehicleImages,
        currentImageIndex,
        currentImageUrl
      });
    }
  }
  
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
        {showPriceOverlay && displayPrice !== '—' && (
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
            {displayPrice}
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
      
      {/* Detail overlay on image instead of separate panel */}
      {showDetailOverlay && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            padding: '8px',
            background: 'linear-gradient(to top, rgba(0,0,0,0.9), rgba(0,0,0,0.4))',
            color: '#fff',
          }}
        >
          {/* Vehicle name */}
          <div
            style={{
              fontSize: '9pt',
              fontWeight: 700,
              lineHeight: 1.1,
              marginBottom: '4px',
            }}
          >
            {vehicle.year} {vehicle.make} {vehicle.model}
          </div>

          {/* Metadata row - uploader, views, images, ROI, rating, time */}
          <div
            style={{
              fontSize: '7pt',
              display: 'flex',
              gap: '6px',
              flexWrap: 'wrap',
              alignItems: 'center',
              opacity: 0.9,
            }}
          >
            {vehicle.uploader_name && (
              <span style={{ fontWeight: 500 }}>{vehicle.uploader_name}</span>
            )}
            {vehicle.uploader_name && <span>•</span>}

            {/* Accurate view count */}
            {vehicle.view_count !== undefined && vehicle.view_count > 0 && (
              <>
                <span>{vehicle.view_count} {vehicle.view_count === 1 ? 'view' : 'views'}</span>
                <span>•</span>
              </>
            )}

            {vehicle.active_viewers > 0 && (
              <>
                <span>({vehicle.active_viewers} watching)</span>
                <span>•</span>
              </>
            )}

            {/* Accurate image count */}
            {(() => {
              const imageCount = vehicle.all_images?.length || vehicle.image_count || 0;
              if (imageCount > 0) {
                return (
                  <>
                    <span>{imageCount} {imageCount === 1 ? 'image' : 'images'}</span>
                    <span>•</span>
                  </>
                );
              }
              return null;
            })()}

            {/* Vehicle Tier - alphabet-based (F, E, D, C, B, A, S, SSS) */}
            {(() => {
              const tierLabel = vehicle.tier_label || calculateVehicleTier(vehicle);
              
              // Color mapping for alphabet tiers
              const getTierColor = (tier: string) => {
                switch (tier) {
                  case 'SSS': return '#9333ea'; // Purple - highest
                  case 'SS': return '#7c3aed';
                  case 'S': return '#8b5cf6';
                  case 'A': return '#10b981'; // Green - excellent
                  case 'B': return '#3b82f6'; // Blue - good
                  case 'C': return '#f59e0b'; // Orange - fair
                  case 'D': return '#f97316'; // Dark orange - minimal
                  case 'E': return '#ef4444'; // Red - poor
                  case 'F': return '#6b7280'; // Gray - pending/no data
                  default: return '#6b7280';
                }
              };
              
              if (tierLabel) {
                return (
                  <>
                    <span
                      style={{
                        fontWeight: 600,
                        color: getTierColor(tierLabel)
                      }}
                    >
                      {tierLabel}
                    </span>
                    <span>•</span>
                  </>
                );
              }
              return null;
            })()}

            {vehicle.condition_rating && (
              <span
                style={{
                  fontWeight: 700,
                  color:
                    vehicle.condition_rating >= 8
                      ? '#10b981'
                      : vehicle.condition_rating >= 6
                      ? '#f59e0b'
                      : '#ef4444',
                }}
              >
                {vehicle.condition_rating >= 9
                  ? 'A+'
                  : vehicle.condition_rating >= 8
                  ? 'A'
                  : vehicle.condition_rating >= 7
                  ? 'B+'
                  : vehicle.condition_rating >= 6
                  ? 'B'
                  : vehicle.condition_rating >= 5
                  ? 'C'
                  : 'D'}
              </span>
            )}

            {timeAgo && <span style={{ marginLeft: 'auto' }}>{timeAgo}</span>}
          </div>
        </div>
      )}
    </Link>
  );
};

export default VehicleCardDense;

