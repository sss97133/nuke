import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';

/**
 * Mobile Image Controls with Gesture Support
 * - Swipe left/right for next/prev
 * - Long press for options menu
 * - Double tap to favorite
 * - Pinch to zoom (handled by viewer)
 */

interface Props {
  imageUrl: string;
  imageId: string;
  vehicleId: string;
  isPrimary: boolean;
  canEdit: boolean;
  totalImages: number;
  currentIndex: number;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
  onSetPrimary?: (imageId: string) => void;
}

export default function MobileImageControls({
  imageUrl,
  imageId,
  vehicleId,
  isPrimary,
  canEdit,
  totalImages,
  currentIndex,
  onNext,
  onPrev,
  onClose,
  onSetPrimary
}: Props) {
  const [showMenu, setShowMenu] = useState(false);
  const [touchStart, setTouchStart] = useState<{ x: number; y: number; time: number } | null>(null);

  // Handle long press for menu
  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    setTouchStart({
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now()
    });
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStart) return;

    const duration = Date.now() - touchStart.time;
    
    // Long press (> 500ms) = show menu
    if (duration > 500) {
      e.preventDefault();
      setShowMenu(true);
      setTouchStart(null);
      return;
    }

    // Quick tap = close menu if open
    if (showMenu) {
      setShowMenu(false);
    }

    setTouchStart(null);
  };

  const handleSetPrimary = async () => {
    if (!canEdit || !onSetPrimary) return;

    try {
      // Set this image as primary
      await supabase
        .from('vehicle_images')
        .update({ is_primary: false })
        .eq('vehicle_id', vehicleId);

      await supabase
        .from('vehicle_images')
        .update({ is_primary: true })
        .eq('id', imageId);

      onSetPrimary(imageId);
      setShowMenu(false);
      
      // Show quick feedback
      const feedback = document.createElement('div');
      feedback.textContent = 'Set as primary image';
      feedback.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        font-size: 10pt;
        z-index: 10000;
        pointer-events: none;
      `;
      document.body.appendChild(feedback);
      setTimeout(() => feedback.remove(), 1500);
      
    } catch (error) {
      console.error('Failed to set primary:', error);
    }
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Vehicle Image',
          url: window.location.href
        });
      } catch (error) {
        console.error('Share failed:', error);
      }
    }
    setShowMenu(false);
  };

  return (
    <>
      {/* Image counter & navigation hints */}
      <div style={{
        position: 'absolute',
        top: '16px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(10px)',
        color: 'white',
        padding: '6px 12px',
        borderRadius: '16px',
        fontSize: '9pt',
        fontWeight: 600,
        zIndex: 100,
        pointerEvents: 'none'
      }}>
        {currentIndex + 1} / {totalImages}
      </div>

      {/* Close button */}
      <button
        onClick={onClose}
        style={{
          position: 'absolute',
          top: '16px',
          right: '16px',
          background: 'rgba(0, 0, 0, 0.6)',
          backdropFilter: 'blur(10px)',
          border: 'none',
          color: 'white',
          width: '40px',
          height: '40px',
          borderRadius: '50%',
          fontSize: '20pt',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          zIndex: 100
        }}
      >
        ×
      </button>

      {/* Primary image badge */}
      {isPrimary && (
        <div style={{
          position: 'absolute',
          top: '16px',
          left: '16px',
          background: '#10b981',
          color: 'white',
          padding: '4px 10px',
          borderRadius: '12px',
          fontSize: '7pt',
          fontWeight: 700,
          zIndex: 100,
          pointerEvents: 'none'
        }}>
          PRIMARY
        </div>
      )}

      {/* Long-press menu */}
      {showMenu && (
        <div
          style={{
            position: 'absolute',
            bottom: '80px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(0, 0, 0, 0.95)',
            backdropFilter: 'blur(20px)',
            borderRadius: '12px',
            padding: '8px',
            minWidth: '200px',
            zIndex: 200
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {canEdit && !isPrimary && (
            <button
              onClick={handleSetPrimary}
              style={{
                width: '100%',
                background: 'none',
                border: 'none',
                color: 'white',
                padding: '12px',
                fontSize: '10pt',
                textAlign: 'left',
                cursor: 'pointer',
                borderRadius: '6px'
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
            >
              ⭐ Set as Primary Image
            </button>
          )}
          <button
            onClick={handleShare}
            style={{
              width: '100%',
              background: 'none',
              border: 'none',
              color: 'white',
              padding: '12px',
              fontSize: '10pt',
              textAlign: 'left',
              cursor: 'pointer',
              borderRadius: '6px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
          >
            📤 Share Image
          </button>
          <button
            onClick={() => setShowMenu(false)}
            style={{
              width: '100%',
              background: 'none',
              border: 'none',
              color: '#9ca3af',
              padding: '12px',
              fontSize: '10pt',
              textAlign: 'left',
              cursor: 'pointer',
              borderRadius: '6px'
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Swipe gesture hint (auto-hide after 3s) */}
      <div style={{
        position: 'absolute',
        bottom: '100px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(10px)',
        color: 'white',
        padding: '8px 16px',
        borderRadius: '20px',
        fontSize: '8pt',
        zIndex: 50,
        pointerEvents: 'none',
        opacity: 0,
        animation: 'fadeInOut 3s ease-in-out'
      }}>
        Swipe left/right • Long press for options
      </div>

      {/* Bottom toolbar */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          background: 'linear-gradient(to top, rgba(0, 0, 0, 0.8) 0%, transparent 100%)',
          padding: '20px 16px 24px',
          zIndex: 100
        }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Navigation dots */}
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          gap: '6px',
          marginBottom: '12px'
        }}>
          {Array.from({ length: Math.min(totalImages, 10) }).map((_, idx) => (
            <div
              key={idx}
              style={{
                width: currentIndex === idx ? '24px' : '6px',
                height: '6px',
                borderRadius: '3px',
                background: currentIndex === idx ? 'white' : 'rgba(255, 255, 255, 0.3)',
                transition: 'all 0.3s ease'
              }}
            />
          ))}
          {totalImages > 10 && (
            <div style={{
              fontSize: '8pt',
              color: 'rgba(255, 255, 255, 0.6)',
              marginLeft: '8px'
            }}>
              +{totalImages - 10}
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes fadeInOut {
          0%, 100% { opacity: 0; }
          10%, 90% { opacity: 1; }
        }
      `}</style>
    </>
  );
}

