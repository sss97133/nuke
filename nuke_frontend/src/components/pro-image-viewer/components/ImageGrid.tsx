import React, { memo } from 'react';
import type { ImageData } from '../constants';
import LazyImage from '../../LazyImage';

interface ImageGridProps {
  images: ImageData[];
  onImageClick: (image: ImageData) => void;
  selectedImage?: ImageData | null;
  loading?: boolean;
  className?: string;
}

const ImageGrid: React.FC<ImageGridProps> = memo(({
  images,
  onImageClick,
  selectedImage,
  loading = false,
  className = ''
}) => {
  if (loading) {
    return (
      <div className={`image-grid-loading ${className}`}>
        <div className="loading-message">Loading images...</div>
      </div>
    );
  }

  if (images.length === 0) {
    return (
      <div className={`image-grid-empty ${className}`}>
        <div className="empty-message">No images available</div>
      </div>
    );
  }

  return (
    <div className={`image-grid ${className}`}>
      <div className="grid" style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: '16px',
        padding: '16px'
      }}>
        {images.map((image) => (
          <div
            key={image.id}
            className={`image-item ${selectedImage?.id === image.id ? 'selected' : ''}`}
            onClick={() => onImageClick(image)}
            style={{
              position: 'relative',
              aspectRatio: '1',
              cursor: 'pointer',
              border: selectedImage?.id === image.id ? '2px solid var(--primary)' : '1px solid var(--border)',
              borderRadius: '8px',
              overflow: 'hidden',
              transition: 'border-color 0.2s ease'
            }}
          >
            <LazyImage
              src={image.thumbnail_url || image.medium_url || image.image_url}
              alt={image.filename || 'Vehicle image'}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover'
              }}
            />

            {/* Image overlay with metadata */}
            <div
              className="image-overlay"
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
                color: 'white',
                padding: '8px',
                fontSize: '12px'
              }}
            >
              {image.is_primary && (
                <div className="primary-badge" style={{
                  position: 'absolute',
                  top: '8px',
                  right: '8px',
                  background: 'var(--success)',
                  color: 'white',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  fontSize: '10px',
                  fontWeight: 'bold'
                }}>
                  PRIMARY
                </div>
              )}

              {image.filename && (
                <div className="filename" style={{
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}>
                  {image.filename}
                </div>
              )}

              {image.tags && image.tags.length > 0 && (
                <div className="tag-count" style={{ fontSize: '10px', opacity: 0.8 }}>
                  {image.tags.length} tag{image.tags.length !== 1 ? 's' : ''}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

ImageGrid.displayName = 'ImageGrid';

export default ImageGrid;