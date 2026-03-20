/**
 * QuickLook — Spacebar preview overlay (like macOS Finder Quick Look).
 * Portal-based, renders above everything. Shows full-size photo with metadata.
 */

import React, { useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { PersonalPhoto } from '../../services/personalPhotoLibraryService';
import { optimizeImageUrl } from '../../lib/imageOptimizer';

interface QuickLookProps {
  photo: PersonalPhoto;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
}

export const QuickLook: React.FC<QuickLookProps> = ({
  photo,
  onClose,
  onNext,
  onPrev,
}) => {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        onNext();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        onPrev();
      }
    },
    [onClose, onNext, onPrev],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const largeUrl = optimizeImageUrl(photo.image_url, 'large') || photo.image_url;

  const dateStr = photo.taken_at || photo.created_at;
  const dateDisplay = dateStr
    ? new Date(dateStr).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        background: 'rgba(0, 0, 0, 0.85)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        animation: 'quicklook-in 120ms ease-out',
      }}
    >
      <style>{`
        @keyframes quicklook-in {
          from { opacity: 0; transform: scale(0.95); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>

      {/* Image */}
      <img
        src={largeUrl}
        alt=""
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 'calc(100vw - 80px)',
          maxHeight: 'calc(100vh - 120px)',
          objectFit: 'contain',
          display: 'block',
        }}
      />

      {/* Metadata bar */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          marginTop: '8px',
          display: 'flex',
          gap: '16px',
          alignItems: 'center',
          padding: '6px 12px',
          background: 'rgba(0, 0, 0, 0.6)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
        }}
      >
        {dateDisplay && (
          <span
            style={{
              fontFamily: 'Arial, sans-serif',
              fontSize: '10px',
              color: 'rgba(255, 255, 255, 0.7)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            {dateDisplay}
          </span>
        )}

        {photo.ai_processing_status && (
          <span
            style={{
              fontFamily: 'Arial, sans-serif',
              fontSize: '9px',
              fontWeight: 700,
              padding: '2px 6px',
              background:
                photo.ai_processing_status === 'completed' || photo.ai_processing_status === 'complete'
                  ? 'rgba(76, 175, 80, 0.3)'
                  : photo.ai_processing_status === 'failed'
                    ? 'rgba(244, 67, 54, 0.3)'
                    : 'rgba(255, 255, 255, 0.15)',
              color: 'var(--surface-elevated)',
              textTransform: 'uppercase',
            }}
          >
            {photo.ai_processing_status}
          </span>
        )}

        {photo.ai_detected_vehicle && (
          <span
            style={{
              fontFamily: 'Arial, sans-serif',
              fontSize: '10px',
              color: 'var(--surface-elevated)',
              fontWeight: 700,
            }}
          >
            {photo.ai_detected_vehicle.year} {photo.ai_detected_vehicle.make}{' '}
            {photo.ai_detected_vehicle.model}
          </span>
        )}

        {photo.ai_detected_angle && (
          <span
            style={{
              fontFamily: 'Arial, sans-serif',
              fontSize: '9px',
              color: 'rgba(255, 255, 255, 0.5)',
              textTransform: 'uppercase',
            }}
          >
            {photo.ai_detected_angle.replace('_', ' ')}
          </span>
        )}
      </div>

      {/* Nav hints */}
      <div
        style={{
          marginTop: '4px',
          fontFamily: 'Arial, sans-serif',
          fontSize: '9px',
          color: 'rgba(255, 255, 255, 0.3)',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}
      >
        SPACE / ESC CLOSE &middot; ARROWS NAVIGATE
      </div>
    </div>,
    document.body,
  );
};
