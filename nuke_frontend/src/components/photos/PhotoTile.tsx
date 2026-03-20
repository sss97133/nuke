/**
 * PhotoTile — Single image cell for the virtualized photo grid.
 * React.memo'd for virtualization performance.
 */

import React, { useState, useCallback } from 'react';
import type { PersonalPhoto } from '../../services/personalPhotoLibraryService';
import { optimizeImageUrl } from '../../lib/imageOptimizer';
import type { ImageSize } from '../../lib/imageOptimizer';

interface PhotoTileProps {
  photo: PersonalPhoto;
  isSelected: boolean;
  columns: number;
  onClick: (photoId: string, event: React.MouseEvent) => void;
  /** All currently selected photo IDs — used for drag payload */
  selectedPhotoIds?: Set<string>;
}

export const PhotoTile = React.memo(function PhotoTile({
  photo,
  isSelected,
  columns,
  onClick,
  selectedPhotoIds,
}: PhotoTileProps) {
  const [loaded, setLoaded] = useState(false);

  const handleLoad = useCallback(() => setLoaded(true), []);

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      // If this photo is in the selection, drag all selected; otherwise just this one
      const ids =
        selectedPhotoIds && selectedPhotoIds.has(photo.id)
          ? Array.from(selectedPhotoIds)
          : [photo.id];
      e.dataTransfer.setData('application/x-nuke-photos', JSON.stringify(ids));
      e.dataTransfer.effectAllowed = 'copy';

      // Custom drag image: small badge showing count
      const badge = document.createElement('div');
      badge.textContent = `${ids.length} photo${ids.length > 1 ? 's' : ''}`;
      badge.style.cssText =
        'position:fixed;top:-100px;left:-100px;padding:4px 8px;background:#333;color:#fff;font:bold 11px Arial;';
      document.body.appendChild(badge);
      e.dataTransfer.setDragImage(badge, 0, 0);
      requestAnimationFrame(() => badge.remove());

      window.dispatchEvent(new Event('nuke:photo-drag-start'));
    },
    [photo.id, selectedPhotoIds],
  );

  const handleDragEnd = useCallback(() => {
    window.dispatchEvent(new Event('nuke:photo-drag-end'));
  }, []);

  // Derive image size from column count
  const size: ImageSize = columns >= 13 ? 'micro' : columns >= 7 ? 'thumbnail' : columns >= 4 ? 'small' : 'medium';
  const thumbnailUrl =
    columns <= 3
      ? (photo.variants?.medium || photo.variants?.large || optimizeImageUrl(photo.image_url, size) || photo.image_url)
      : columns <= 6
        ? (photo.variants?.small || photo.variants?.medium || optimizeImageUrl(photo.image_url, size) || photo.image_url)
        : (photo.variants?.thumbnail || photo.variants?.small || optimizeImageUrl(photo.image_url, size) || photo.image_url);

  return (
    <div
      data-photo-id={photo.id}
      draggable
      onClick={(e) => onClick(photo.id, e)}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      style={{
        position: 'relative',
        paddingBottom: '100%',
        background: '#1a1a1a',
        border: isSelected ? '2px solid #fff' : 'none',
        cursor: 'pointer',
        boxSizing: 'border-box',
      }}
    >
      <img
        src={thumbnailUrl}
        alt=""
        loading="lazy"
        decoding="async"
        onLoad={handleLoad}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          opacity: loaded ? 1 : 0,
          transition: 'opacity 120ms ease-out',
        }}
      />

      {/* Album count badge */}
      {photo.album_count > 0 && (
        <div style={{
          position: 'absolute',
          bottom: '4px',
          right: '4px',
          padding: '2px 4px',
          background: 'rgba(0,0,0,0.75)',
          color: '#fff',
          fontSize: '9px',
          border: '1px solid var(--border)',
        }}>
          {photo.album_count} ALBUM{photo.album_count > 1 ? 'S' : ''}
        </div>
      )}

      {/* Selection checkmark */}
      {isSelected && (
        <div style={{
          position: 'absolute',
          top: '6px',
          left: '6px',
          width: '18px',
          height: '18px',
          background: 'var(--primary)',
          border: '2px solid var(--border)',
          color: 'var(--accent-bright)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '11px',
          fontWeight: 'bold',
        }}>
          ✓
        </div>
      )}

      {/* AI Status badge (hidden at high density) */}
      {photo.ai_processing_status !== 'complete' && photo.ai_processing_status !== 'completed' && columns <= 6 && (
        <div style={{
          position: 'absolute',
          top: '6px',
          right: '6px',
          padding: '2px 5px',
          background: photo.ai_processing_status === 'processing' ? 'var(--warning)' : 'var(--text-disabled)',
          color: '#fff',
          fontSize: '9px',
          fontWeight: 'bold',
        }}>
          {photo.ai_processing_status === 'processing'
            ? 'AI'
            : photo.ai_processing_status === 'pending'
              ? 'PEND'
              : photo.ai_processing_status === 'failed'
                ? 'ERR'
                : 'AI'}
        </div>
      )}

      {/* Vehicle info overlay (shown at low density) */}
      {columns <= 4 && photo.ai_detected_vehicle && (
        <div style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          background: 'var(--surface-glass)',
          borderTop: '1px solid var(--border)',
          padding: '4px 6px',
        }}>
          <div className="text font-bold" style={{ fontSize: '11px' }}>
            {photo.ai_detected_vehicle.year} {photo.ai_detected_vehicle.make}
          </div>
          {photo.ai_detected_angle && (
            <div className="text text-muted" style={{ fontSize: '9px' }}>
              {photo.ai_detected_angle.replace('_', ' ').toUpperCase()}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
