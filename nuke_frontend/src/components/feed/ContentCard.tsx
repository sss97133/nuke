import { useState, useRef } from 'react';
import type { FeedItem } from './types';
import { useActivityTracking } from '../../hooks/useActivityTracking';
import ImageLightbox from '../image/ImageLightbox';
import '../../design-system.css';
import { computePrimaryPrice, computeDelta, formatCurrency, computeReadinessScore } from '../../services/priceSignalService';

interface ContentCardProps {
  item: FeedItem;
  viewMode?: 'gallery' | 'compact' | 'technical';
  denseMode?: boolean;
}

const ContentCard = ({ item, viewMode = 'gallery', denseMode = false }: ContentCardProps) => {
  const [imageError, setImageError] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const { trackView, trackInteraction, trackEvent } = useActivityTracking();

  const getTypeLabel = (type: string) => type.replace('_', ' ');

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'vehicle': return '#3b82f6';
      case 'timeline_event': return '#10b981';
      case 'image': return '#f59e0b';
      case 'shop': return '#8b5cf6';
      case 'auction': return '#ef4444';
      case 'user_activity': return '#6b7280';
      default: return '#6b7280';
    }
  };

  const smallChipStyle: React.CSSProperties = {
    background: '#f3f4f6',
    border: '1px solid #c0c0c0',
    padding: '1px 4px',
    borderRadius: '2px',
    fontSize: '8pt',
    color: '#374151'
  };

  // Images array for swipe (vehicles may provide multiple images)
  const images = Array.isArray(item.images) && item.images.length > 0
    ? (item.images as string[])
    : (item.image_url ? [item.image_url] : []);

  const [currentImageIdx, setCurrentImageIdx] = useState(0);
  const [showUserPopover, setShowUserPopover] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const lastTapRef = useRef<number>(0);

  // Readiness (0-100) – temporary FE helper until RPC
  const readiness = item.type === 'vehicle'
    ? computeReadinessScore({ meta: (item as any).metadata || {}, imagesCount: images.length, createdAt: item.created_at })
    : { score: 0, breakdown: {} as any };

  const handleImageError = () => {
    setImageError(true);
  };

  const handleImageClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (item.type === 'vehicle') {
      goToVehicle();
    } else {
      setLightboxOpen(true);
    }
  };

  const goToVehicle = () => {
    if (item.type === 'vehicle') {
      window.location.href = `/vehicle/${item.id}`;
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const end = e.changedTouches[0].clientX;
    const start = touchStartX.current ?? end;
    const now = Date.now();
    const last = lastTapRef.current;
    const deltaX = end - start;

    if (Math.abs(deltaX) > 50 && images.length > 1) {
      setCurrentImageIdx((i) => (deltaX < 0 ? (i + 1) % images.length : (i - 1 + images.length) % images.length));
    } else {
      if (now - last < 300 && item.type === 'vehicle') {
        trackEvent({ event_type: 'like', entity_type: 'vehicle', entity_id: item.id });
      } else {
        goToVehicle();
      }
    }
    lastTapRef.current = now;
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (item.type === 'vehicle') {
      trackEvent({ event_type: 'like', entity_type: 'vehicle', entity_id: item.id });
    }
  };

  // Map feed item types to allowed tracking entity types
  const mapEntityType = (t: FeedItem['type']): 'vehicle' | 'image' | 'shop' | 'user' | 'timeline_event' | 'search' | 'page' => {
    switch (t) {
      case 'vehicle':
      case 'image':
      case 'shop':
      case 'timeline_event':
        return t;
      case 'user_activity':
        return 'user';
      case 'auction':
      default:
        return 'page';
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const handleCardClick = () => {
    // Track the view
    trackView(mapEntityType(item.type), item.id, {
      title: item.title,
      user_id: item.user_id,
      location: item.location
    });

    // Navigate to detailed view based on content type
    const baseUrl = '/';
    switch (item.type) {
      case 'vehicle':
        window.location.href = `${baseUrl}vehicle/${item.id}`;
        break;
      case 'image':
        window.location.href = `${baseUrl}images/${item.id}`;
        break;
      case 'shop':
        window.location.href = `${baseUrl}shops/${item.id}`;
        break;
      case 'timeline_event': {
        const vid = (item as any)?.metadata?.vehicle_id;
        if (vid) {
          window.location.href = `${baseUrl}vehicle/${vid}?t=timeline&event=${item.id}`;
        } else {
          window.location.href = `${baseUrl}events/${item.id}`;
        }
        break;
      }
      default:
        console.log('View item:', item);
    }
  };

  return (
    <div
      className="content-card"
      style={{
        background: 'white',
        border: '1px solid #c0c0c0',
        borderRadius: '2px',
        overflow: 'hidden',
        cursor: 'pointer'
      }}
      onClick={handleCardClick}
    >
      {/* Content Type Badge */}
      <div style={{
        position: 'absolute',
        top: '6px',
        left: '6px',
        zIndex: 10,
        border: '1px solid #c0c0c0',
        background: '#f3f4f6',
        color: '#333',
        padding: '2px 4px',
        borderRadius: '2px',
        fontSize: '8pt',
        fontWeight: 600
      }}>
        {getTypeLabel(item.type)}
      </div>

      {/* Image */}
      {images.length > 0 && !imageError && (
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: viewMode === 'gallery' ? '200px' :
                   viewMode === 'compact' ? '120px' :
                   '60px',
            overflow: 'hidden'
          }}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onDoubleClick={handleDoubleClick}
          onClick={handleImageClick}
        >
          <img
            src={images[currentImageIdx]}
            alt={item.title}
            onError={handleImageError}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              cursor: 'pointer'
            }}
          />
          {images.length > 1 && (
            <div style={{ position: 'absolute', bottom: '6px', left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: '4px' }}>
              {images.map((_, idx) => (
                <div key={idx} style={{ width: '6px', height: '6px', border: '1px solid #c0c0c0', background: idx === currentImageIdx ? '#374151' : '#f3f4f6' }} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Content */}
      <div style={{ padding: '8px' }}>
        {/* User Info */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', marginBottom: '6px' }}>
          <div style={{ flex: 1 }}>
            <div className="text" style={{ fontSize: '6pt', fontWeight: 600, cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); setShowUserPopover((s) => !s); }}>
              {item.user_name || 'User'}
            </div>
            <div className="text text-muted" style={{ fontSize: '7pt' }}>
              {formatDate(item.created_at)}
            </div>
          </div>
          {showUserPopover && (
            <div style={{ position: 'absolute', top: '18px', left: 0, zIndex: 20, background: 'white', border: '1px solid #c0c0c0', padding: '6px', width: '220px' }} onClick={(e) => e.stopPropagation()}>
              <div className="text text-bold" style={{ fontSize: '8pt', marginBottom: '4px' }}>{item.user_name || 'User'}</div>
              <div className="text text-muted" style={{ fontSize: '7pt' }}>User profile</div>
            </div>
          )}
        </div>

        {/* Title */}
        {item.type === 'vehicle' ? (
          <a href={`/vehicle/${item.id}`} onClick={(e) => e.stopPropagation()} style={{ color: 'inherit', textDecoration: 'none' }}>
            <h3 className="heading-3" style={{ margin: '0 0 4px 0', fontSize: '10pt', lineHeight: 1.3 }}>
              {item.title}
            </h3>
          </a>
        ) : (
          <h3 className="heading-3" style={{ margin: '0 0 4px 0', fontSize: '10pt', lineHeight: 1.3 }}>
            {item.title}
          </h3>
        )}

        {/* Description */}
        {item.description && (
          <p className="text" style={{
            margin: '0 0 8px 0',
            fontSize: '8pt',
            lineHeight: 1.3,
            color: '#555',
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical'
          }}>
            {item.description}
          </p>
        )}

        {/* Metadata */}
        {item.metadata && (
          <div style={{ marginBottom: '12px' }}>
            {item.type === 'vehicle' && item.metadata && (
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                {/* Readiness bar + chip */}
                {typeof (readiness as any).score === 'number' && (
                  <>
                    <div style={{ width: '100%', height: 4, background: '#e5e7eb', border: '1px solid #c0c0c0', position: 'relative' }}>
                      <div style={{ width: `${Math.round((readiness as any).score)}%`, height: '100%', background: '#1e40af' }} />
                    </div>
                    <span className="badge" style={smallChipStyle}>Ready {Math.round((readiness as any).score)}%</span>
                  </>
                )}
                {item.metadata.year && (
                  <span className="badge" style={smallChipStyle}>{item.metadata.year}</span>
                )}
                {item.metadata.make && (
                  <span className="badge" style={smallChipStyle}>{item.metadata.make}</span>
                )}
                {item.metadata.model && (
                  <span className="badge" style={smallChipStyle}>{item.metadata.model}</span>
                )}

                {/* Price chips (prefer RPC priceSignal if available) */}
                {(() => {
                  const sig: any = (item as any)?.metadata?.priceSignal;
                  const priceMeta = {
                    msrp: item.metadata?.msrp,
                    current_value: item.metadata?.current_value,
                    purchase_price: item.metadata?.purchase_price,
                    asking_price: item.metadata?.asking_price,
                    sale_price: item.metadata?.sale_price,
                    is_for_sale: item.metadata?.is_for_sale,
                  } as any;
                  const pi = sig && sig.primary_label && typeof sig.primary_value === 'number'
                    ? { label: sig.primary_label as any, amount: sig.primary_value as number }
                    : computePrimaryPrice(priceMeta);
                  const delta = sig && typeof sig.delta_pct === 'number' && typeof sig.delta_amount === 'number'
                    ? { amount: sig.delta_amount as number, percent: sig.delta_pct as number, isPositive: (sig.delta_amount as number) >= 0 }
                    : computeDelta(priceMeta);

                  // Market band chip (85%-100%-115% of current_value)
                  const currentValue = sig?.anchor_value || priceMeta.current_value;
                  const marketBand = currentValue ? {
                    low: Math.round(currentValue * 0.85),
                    mid: Math.round(currentValue),
                    high: Math.round(currentValue * 1.15)
                  } : null;

                  return (
                    <>
                      {pi.label && typeof pi.amount === 'number' && (
                        <span className="badge" style={smallChipStyle} title={Array.isArray(sig?.sources) ? `Sources: ${sig.sources.join(', ')}` : undefined}>
                          {pi.label}: {formatCurrency(pi.amount)}
                        </span>
                      )}
                      {delta && (
                        <span className="badge" style={{ ...smallChipStyle, color: delta.isPositive ? '#006400' : '#800000' }} title={Array.isArray(sig?.sources) ? `Sources: ${sig.sources.join(', ')}` : undefined}>
                          {delta.isPositive ? '↑' : '↓'} {Math.abs(delta.percent).toFixed(1)}%
                        </span>
                      )}
                      {marketBand && (
                        <span className="badge" style={smallChipStyle} title="Market band: 85%–100%–115% of current value">
                          Band: {formatCurrency(marketBand.low)}–{formatCurrency(marketBand.mid)}–{formatCurrency(marketBand.high)}
                        </span>
                      )}
                      {typeof sig?.confidence === 'number' && (
                        <span className="badge" style={smallChipStyle} title="Signal confidence">
                          conf {sig.confidence}
                        </span>
                      )}
                      {(item as any).type === 'auction' || (item.metadata?.auction_status === 'active') ? (
                        <a href={`/vehicle/${item.id}?action=bid`} onClick={(e) => e.stopPropagation()} style={{ background: '#fee2e2', border: '1px solid #c0c0c0', padding: '1px 4px', borderRadius: '2px', fontSize: '8pt', color: '#991b1b', textDecoration: 'none' }}>
                          Bid
                        </a>
                      ) : null}
                      {item.metadata?.is_for_sale ? (
                        <a href={`/vehicle/${item.id}?action=buy`} onClick={(e) => e.stopPropagation()} style={{ background: '#dcfce7', border: '1px solid #c0c0c0', padding: '1px 4px', borderRadius: '2px', fontSize: '8pt', color: '#166534', textDecoration: 'none' }}>
                          Buy
                        </a>
                      ) : null}
                    </>
                  );
                })()}
              </div>
            )}

            {item.type === 'timeline_event' && item.metadata?.event_type && (
              <span className="badge" style={smallChipStyle}>
                {item.metadata.event_type.replace('_', ' ')}
              </span>
            )}
          </div>
        )}

        {/* Engagement Stats */}
        {item.engagement && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '6px', borderTop: '1px solid #e5e7eb' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {item.engagement.likes > 0 && (<span style={smallChipStyle}>{item.engagement.likes} likes</span>)}
              {item.engagement.comments > 0 && (<span style={smallChipStyle}>{item.engagement.comments} comments</span>)}
              {item.engagement.views > 0 && (<span style={smallChipStyle}>{item.engagement.views} views</span>)}
            </div>
            <div style={{ color: '#6b7280', fontSize: '8pt' }}>Open details</div>
          </div>
        )}
      </div>

      {/* Image Lightbox */}
      {item.image_url && (
        <ImageLightbox
          imageUrl={item.image_url!}
          timelineEventId={item.type === 'timeline_event' ? item.id : undefined}
          vehicleId={item.metadata?.vehicle?.id || (item.type === 'vehicle' ? item.id : undefined)}
          isOpen={lightboxOpen}
          onClose={() => setLightboxOpen(false)}
          title={item.title}
          description={item.description}
          canEdit={true}
        />
      )}
    </div>
  );
};

export default ContentCard;