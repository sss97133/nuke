import { useState } from 'react';
import type { FeedItem } from './types';
import { useActivityTracking } from '../../hooks/useActivityTracking';
import ImageLightbox from '../image/ImageLightbox';
import VehicleQuickView from './VehicleQuickView';
import '../../design-system.css';
import { computePrimaryPrice, computeDelta, formatCurrency } from '../../services/priceSignalService';

interface ContentCardProps {
  item: FeedItem;
  viewMode?: 'gallery' | 'compact' | 'technical';
  denseMode?: boolean;
}

const ContentCard = ({ item, viewMode = 'gallery', denseMode = false }: ContentCardProps) => {
  const [imageError, setImageError] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [quickViewOpen, setQuickViewOpen] = useState(false);
  const { trackView, trackInteraction } = useActivityTracking();

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

  const handleImageError = () => {
    setImageError(true);
  };

  const handleImageClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent card click
    setLightboxOpen(true);
  };

  const handleCardClick = () => {
    // Track the view
    trackView(mapEntityType(item.type), item.id, {
      title: item.title,
      user_id: item.user_id,
      location: item.location
    });

    // Open quick view for vehicles, navigate for other types
    if (item.type === 'vehicle') {
      setQuickViewOpen(true);
    } else {
      // Navigate to detailed view for non-vehicle content
      const baseUrl = '/';
      switch (item.type) {
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
        cursor: 'pointer',
        position: 'relative'
      }}
      onClick={handleCardClick}
    >
      {/* Image */}
      {item.image_url && !imageError ? (
        <div style={{
          position: 'relative',
          width: '100%',
          height: viewMode === 'gallery' ? '200px' : 
                 viewMode === 'compact' ? '140px' : 
                 '80px',
          overflow: 'hidden',
          background: '#000'
        }}>
          <img
            src={item.image_url}
            alt={item.title}
            onError={handleImageError}
            onClick={handleImageClick}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              cursor: 'pointer'
            }}
          />
        </div>
      ) : (
        <div style={{
          width: '100%',
          height: viewMode === 'gallery' ? '200px' : 
                 viewMode === 'compact' ? '140px' : 
                 '80px',
          background: '#f3f4f6',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '48px',
          color: '#d1d5db'
        }}>
          🚗
        </div>
      )}

      {/* Content */}
      <div style={{ padding: '8px' }}>
        {/* Title */}
        <h3 className="heading-3" style={{
          margin: '0 0 6px 0',
          fontSize: '10pt',
          lineHeight: 1.2,
          fontWeight: 600
        }}>
          {item.title}
        </h3>

        {/* Price Information - Clean and Prominent */}
        {item.type === 'vehicle' && item.metadata && (() => {
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

          return (
            <div style={{ marginTop: '8px' }}>
              {/* Primary Price Display */}
              {pi.label && typeof pi.amount === 'number' && (
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginBottom: '4px' }}>
                  <span style={{ 
                    fontSize: '14pt', 
                    fontWeight: 'bold', 
                    color: '#000',
                    fontFamily: 'monospace'
                  }}>
                    {formatCurrency(pi.amount)}
                  </span>
                  <span style={{ 
                    fontSize: '8pt', 
                    color: '#666',
                    fontWeight: 600
                  }}>
                    {pi.label}
                  </span>
                  {delta && (
                    <span style={{ 
                      fontSize: '8pt',
                      fontWeight: 600,
                      color: delta.isPositive ? '#16a34a' : '#dc2626'
                    }}>
                      {delta.isPositive ? '↑' : '↓'} {Math.abs(delta.percent).toFixed(0)}%
                    </span>
                  )}
                </div>
              )}
              
              {/* Secondary info chips */}
              {(Array.isArray(sig?.sources) || typeof sig?.confidence === 'number') && (
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  {Array.isArray(sig?.sources) && sig.sources.length > 0 && (
                    <span style={{ ...smallChipStyle, fontSize: '7pt' }} title={`Data sources: ${sig.sources.join(', ')}`}>
                      {sig.sources.length} {sig.sources.length === 1 ? 'source' : 'sources'}
                    </span>
                  )}
                  {typeof sig?.confidence === 'number' && sig.confidence > 0 && (
                    <span style={{ ...smallChipStyle, fontSize: '7pt' }} title="Price signal confidence score">
                      {sig.confidence}% confidence
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })()}
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

      {/* Vehicle Quick View Modal */}
      {item.type === 'vehicle' && (
        <VehicleQuickView
          vehicleId={item.id}
          isOpen={quickViewOpen}
          onClose={() => setQuickViewOpen(false)}
        />
      )}
    </div>
  );
};

export default ContentCard;