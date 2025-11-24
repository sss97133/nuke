/**
 * Photo Inbox Grid
 * 
 * Displays photos in a grid with adjustable density (like Apple Photos)
 * Supports multi-select and shows AI processing status
 */

import React from 'react';
import { PersonalPhoto } from '../../services/personalPhotoLibraryService';

interface PhotoInboxGridProps {
  photos: PersonalPhoto[];
  gridDensity: 'small' | 'medium' | 'large';
  selectedImages: string[];
  onToggleImage: (imageId: string) => void;
  onSelectAll: () => void;
  isSelected: (imageId: string) => boolean;
  showSelectionMode: boolean;
}

export const PhotoInboxGrid: React.FC<PhotoInboxGridProps> = ({
  photos,
  gridDensity,
  selectedImages,
  onToggleImage,
  onSelectAll,
  isSelected,
  showSelectionMode
}) => {
  // Calculate grid columns based on density
  const getGridColumns = () => {
    switch (gridDensity) {
      case 'small': return 10;   // ~200 images visible
      case 'medium': return 6;   // ~100 images visible
      case 'large': return 3;    // ~30 images visible
      default: return 6;
    }
  };

  // Get AI status badge color
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return '#666';
      case 'processing': return '#ff9d00';
      case 'complete': return '#00c853';
      case 'failed': return '#ff4444';
      default: return '#666';
    }
  };

  // Get AI status label
  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'pending': return 'Pending';
      case 'processing': return 'Processing';
      case 'complete': return 'AI';
      case 'failed': return 'Failed';
      default: return '';
    }
  };

  if (photos.length === 0) {
    return (
      <div style={{
        textAlign: 'center',
        padding: '80px 20px',
        color: '#666'
      }}>
        <div style={{ fontSize: '48px', marginBottom: '20px' }}>📷</div>
        <div style={{ fontSize: '18px', marginBottom: '10px' }}>No photos to show</div>
        <div style={{ fontSize: '14px' }}>Upload photos to get started</div>
      </div>
    );
  }

  return (
    <div>
      {/* Select All Button */}
      {showSelectionMode && (
        <div style={{ marginBottom: '20px' }}>
          <button
            onClick={onSelectAll}
            style={{
              padding: '10px 20px',
              background: '#222',
              color: '#fff',
              border: '2px solid #333',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '500'
            }}
          >
            {selectedImages.length === photos.length ? 'Deselect All' : 'Select All'} ({photos.length})
          </button>
        </div>
      )}

      {/* Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${getGridColumns()}, 1fr)`,
        gap: gridDensity === 'small' ? '4px' : gridDensity === 'medium' ? '8px' : '12px'
      }}>
        {photos.map(photo => {
          const selected = isSelected(photo.id);
          const thumbnailUrl = photo.variants?.thumbnail || photo.variants?.small || photo.image_url;

          return (
            <div
              key={photo.id}
              onClick={() => showSelectionMode && onToggleImage(photo.id)}
              style={{
                position: 'relative',
                paddingBottom: '100%', // Square aspect ratio
                background: '#1a1a1a',
                borderRadius: gridDensity === 'small' ? '2px' : '4px',
                overflow: 'hidden',
                cursor: showSelectionMode ? 'pointer' : 'default',
                border: '2px solid ' + (selected ? '#4a9eff' : 'transparent'),
                transition: 'all 0.12s ease',
                transform: selected ? 'scale(0.95)' : 'scale(1)'
              }}
            >
              {/* Image */}
              <img
                src={thumbnailUrl}
                alt={photo.file_name}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover'
                }}
                loading="lazy"
              />

              {/* Selection Checkbox (top-left) */}
              {showSelectionMode && (
                <div style={{
                  position: 'absolute',
                  top: '8px',
                  left: '8px',
                  width: '24px',
                  height: '24px',
                  borderRadius: '4px',
                  background: selected ? '#4a9eff' : 'rgba(0, 0, 0, 0.6)',
                  border: '2px solid ' + (selected ? '#4a9eff' : '#fff'),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontSize: '14px',
                  fontWeight: '700'
                }}>
                  {selected && '✓'}
                </div>
              )}

              {/* AI Status Badge (top-right) */}
              {gridDensity !== 'small' && (
                <div style={{
                  position: 'absolute',
                  top: '8px',
                  right: '8px',
                  padding: '4px 8px',
                  background: getStatusColor(photo.ai_processing_status),
                  color: '#fff',
                  fontSize: '10px',
                  fontWeight: '600',
                  borderRadius: '4px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px'
                }}>
                  {getStatusLabel(photo.ai_processing_status)}
                </div>
              )}

              {/* AI Detected Info (bottom) - only in medium/large */}
              {gridDensity === 'large' && photo.ai_detected_vehicle && (
                <div style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  padding: '8px',
                  background: 'linear-gradient(transparent, rgba(0,0,0,0.9))',
                  color: '#fff',
                  fontSize: '11px'
                }}>
                  <div style={{ fontWeight: '600' }}>
                    {photo.ai_detected_vehicle.year} {photo.ai_detected_vehicle.make}
                  </div>
                  {photo.ai_detected_vehicle.model && (
                    <div style={{ opacity: 0.8, fontSize: '10px' }}>
                      {photo.ai_detected_vehicle.model}
                    </div>
                  )}
                  {photo.ai_detected_angle && (
                    <div style={{ 
                      marginTop: '4px',
                      padding: '2px 6px',
                      background: 'rgba(74, 158, 255, 0.3)',
                      borderRadius: '3px',
                      display: 'inline-block',
                      fontSize: '9px',
                      textTransform: 'uppercase'
                    }}>
                      {photo.ai_detected_angle}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

