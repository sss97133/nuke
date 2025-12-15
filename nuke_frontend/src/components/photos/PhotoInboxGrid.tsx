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
      <div className="card">
        <div className="card-body" style={{
          textAlign: 'center',
          padding: '60px 20px'
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>📷</div>
          <div className="text font-bold" style={{ fontSize: '14px', marginBottom: '8px' }}>No photos to show</div>
          <div className="text text-small text-muted">Upload photos to get started</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Select All Button */}
      {showSelectionMode && (
        <div style={{ marginBottom: '16px' }}>
          <button
            onClick={onSelectAll}
            className="button button-secondary"
            style={{
              fontSize: '11px',
              padding: '8px 16px'
            }}
          >
            {selectedImages.length === photos.length ? 'Deselect All' : 'Select All'} ({photos.length})
          </button>
        </div>
      )}

      {/* Grid */}
      <div className="card">
        <div className="card-body" style={{ padding: '8px' }}>
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
                background: 'var(--grey-200)',
                border: selected ? '2px solid var(--primary)' : '1px solid var(--border-light)',
                overflow: 'hidden',
                cursor: showSelectionMode ? 'pointer' : 'default',
                transition: 'all 0.12s ease',
                boxShadow: selected ? '0 0 0 2px var(--primary)' : 'none'
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
                  top: '6px',
                  left: '6px',
                  width: '20px',
                  height: '20px',
                  background: selected ? 'var(--primary)' : 'rgba(255, 255, 255, 0.9)',
                  border: '2px solid ' + (selected ? 'var(--primary)' : 'var(--border-dark)'),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: selected ? '#fff' : 'transparent',
                  fontSize: '12px',
                  fontWeight: '700'
                }}>
                  {selected && '✓'}
                </div>
              )}

              {/* AI Status Badge (top-right) */}
              {gridDensity !== 'small' && (
                <div style={{
                  position: 'absolute',
                  top: '6px',
                  right: '6px',
                  padding: '3px 6px',
                  background: 'var(--surface-glass)',
                  color: getStatusColor(photo.ai_processing_status),
                  fontSize: '8px',
                  fontWeight: '700',
                  border: '1px solid var(--border-medium)',
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
                  padding: '6px',
                  background: 'var(--surface-glass)',
                  borderTop: '1px solid var(--border)',
                  fontSize: '9px'
                }}>
                  <div className="text font-bold" style={{ fontSize: '9px' }}>
                    {photo.ai_detected_vehicle.year} {photo.ai_detected_vehicle.make}
                  </div>
                  {photo.ai_detected_vehicle.model && (
                    <div className="text text-muted" style={{ fontSize: '8px' }}>
                      {photo.ai_detected_vehicle.model}
                    </div>
                  )}
                  {photo.ai_detected_angle && (
                    <div style={{ 
                      marginTop: '3px',
                      padding: '2px 4px',
                      background: 'var(--grey-300)',
                      border: '1px solid var(--border-medium)',
                      display: 'inline-block',
                      fontSize: '7px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
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
      </div>
    </div>
  );
};

