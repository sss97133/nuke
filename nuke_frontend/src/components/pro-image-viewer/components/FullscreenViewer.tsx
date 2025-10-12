import React, { memo, useState, useCallback } from 'react';
import { ImageData, SpatialTag, TagType, getTagColor } from '../constants';
import TagOverlay from './TagOverlay';

interface FullscreenViewerProps {
  image: ImageData;
  tags: SpatialTag[];
  showTags: boolean;
  tagSaving: boolean;
  onClose: () => void;
  onTagClick: (x: number, y: number) => void;
  onTagSave: (tagId: string) => void;
  onTagDelete: (tagId: string) => void;
  onTagTextChange: (text: string) => void;
  onTagTypeChange: (type: TagType) => void;
  onToggleTags?: () => void;
  activeTagId?: string | null;
  tagText?: string;
  selectedTagType?: TagType;
}

const FullscreenViewer: React.FC<FullscreenViewerProps> = memo(({
  image,
  tags,
  showTags,
  tagSaving,
  onClose,
  onTagClick,
  onTagSave,
  onTagDelete,
  onTagTextChange,
  onTagTypeChange,
  onToggleTags,
  activeTagId,
  tagText,
  selectedTagType
}) => {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  const handleImageClick = useCallback((event: React.MouseEvent<HTMLImageElement>) => {
    if (!showTags) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;

    onTagClick(x, y);
  }, [showTags, onTagClick]);

  const handleImageLoad = useCallback(() => {
    setImageLoaded(true);
    setImageError(false);
  }, []);

  const handleImageError = useCallback(() => {
    setImageLoaded(false);
    setImageError(true);
  }, []);

  return (
    <div
      className="fullscreen-viewer"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.95)',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      {/* Header with controls */}
      <div
        className="viewer-header"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '16px',
          color: 'white',
          backgroundColor: 'rgba(0, 0, 0, 0.7)'
        }}
      >
        <div className="image-info">
          <h3 style={{ margin: 0, fontSize: '18px' }}>
            {image.filename || 'Untitled Image'}
          </h3>
          {image.created_at && (
            <p style={{ margin: 0, fontSize: '14px', opacity: 0.7 }}>
              {new Date(image.created_at).toLocaleDateString()}
            </p>
          )}
        </div>

        <div className="viewer-controls" style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <button
            onClick={onToggleTags}
            style={{
              background: showTags ? 'var(--primary)' : 'transparent',
              color: 'white',
              border: '1px solid var(--primary)',
              padding: '8px 16px',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            {showTags ? 'Hide Tags' : 'Show Tags'} ({tags.length})
          </button>

          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              color: 'white',
              border: '1px solid white',
              padding: '8px 16px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '16px'
            }}
          >
            ✕ Close
          </button>
        </div>
      </div>

      {/* Main image area */}
      <div
        className="image-container"
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px',
          position: 'relative'
        }}
      >
        {!imageLoaded && !imageError && (
          <div style={{ color: 'white', fontSize: '18px' }}>Loading image...</div>
        )}

        {imageError && (
          <div style={{ color: '#ff6b6b', fontSize: '18px', textAlign: 'center' }}>
            <p>Failed to load image</p>
            <p style={{ fontSize: '14px', opacity: 0.7 }}>
              {image.image_url}
            </p>
          </div>
        )}

        <div
          className="image-wrapper"
          style={{
            position: 'relative',
            maxWidth: '90vw',
            maxHeight: '80vh'
          }}
        >
          <img
            src={image.large_url || image.image_url}
            alt={image.filename || 'Vehicle image'}
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              cursor: showTags ? 'crosshair' : 'default',
              display: imageError ? 'none' : 'block'
            }}
            onClick={handleImageClick}
            onLoad={handleImageLoad}
            onError={handleImageError}
          />

          {/* Tag overlay */}
          {showTags && imageLoaded && (
            <TagOverlay
              tags={tags}
              activeTagId={activeTagId}
              tagText={tagText}
              selectedTagType={selectedTagType}
              tagSaving={tagSaving}
              onTagSave={onTagSave}
              onTagDelete={onTagDelete}
              onTagTextChange={onTagTextChange}
              onTagTypeChange={onTagTypeChange}
            />
          )}
        </div>
      </div>

      {/* Footer with instructions */}
      {showTags && (
        <div
          className="viewer-footer"
          style={{
            padding: '16px',
            color: 'white',
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            textAlign: 'center',
            fontSize: '14px',
            opacity: 0.8
          }}
        >
          Click on the image to add tags • Press ESC to close
        </div>
      )}
    </div>
  );
});

FullscreenViewer.displayName = 'FullscreenViewer';

export default FullscreenViewer;