/**
 * Mobile Image Carousel
 * Swipeable image viewer with zoom and live stream support
 */

import React, { useState, useRef, useEffect } from 'react';

interface MobileImageCarouselProps {
  images: string[];
  initialIndex?: number;
  liveStreamUrl?: string | null;
  onImageChange?: (index: number) => void;
}

export const MobileImageCarousel: React.FC<MobileImageCarouselProps> = ({ 
  images, 
  initialIndex = 0,
  liveStreamUrl,
  onImageChange 
}) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [touchStart, setTouchStart] = useState(0);
  const [touchEnd, setTouchEnd] = useState(0);
  const [isZoomed, setIsZoomed] = useState(false);
  const [showLiveStream, setShowLiveStream] = useState(!!liveStreamUrl);
  const imageRef = useRef<HTMLImageElement>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStart(e.targetTouches[0].clientX);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const handleTouchEnd = () => {
    if (isZoomed) return; // Don't swipe when zoomed
    
    const minSwipeDistance = 50;
    const distance = touchStart - touchEnd;
    
    if (Math.abs(distance) < minSwipeDistance) return;
    
    if (distance > 0 && currentIndex < images.length - 1) {
      // Swipe left - next image
      goToNext();
    } else if (distance < 0 && currentIndex > 0) {
      // Swipe right - previous image
      goToPrevious();
    }
  };

  const goToNext = () => {
    if (currentIndex < images.length - 1) {
      const newIndex = currentIndex + 1;
      setCurrentIndex(newIndex);
      onImageChange?.(newIndex);
    }
  };

  const goToPrevious = () => {
    if (currentIndex > 0) {
      const newIndex = currentIndex - 1;
      setCurrentIndex(newIndex);
      onImageChange?.(newIndex);
    }
  };

  const handleDoubleClick = () => {
    setIsZoomed(!isZoomed);
  };

  useEffect(() => {
    // Auto-switch to live stream if available
    if (liveStreamUrl) {
      setShowLiveStream(true);
    }
  }, [liveStreamUrl]);

  return (
    <div style={styles.container}>
      {/* Image/Stream Display */}
      <div 
        style={styles.imageContainer}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onDoubleClick={handleDoubleClick}
      >
        {showLiveStream && liveStreamUrl ? (
          <iframe
            src={liveStreamUrl}
            style={styles.liveStream}
            allow="autoplay; fullscreen"
          />
        ) : (
          <img
            ref={imageRef}
            src={images[currentIndex]}
            alt=""
            style={{
              ...styles.image,
              transform: isZoomed ? 'scale(2)' : 'scale(1)',
              cursor: isZoomed ? 'zoom-out' : 'zoom-in'
            }}
          />
        )}
      </div>

      {/* Navigation Arrows */}
      {!showLiveStream && images.length > 1 && (
        <>
          {currentIndex > 0 && (
            <button style={{...styles.navButton, left: '8px'}} onClick={goToPrevious}>
              ‹
            </button>
          )}
          {currentIndex < images.length - 1 && (
            <button style={{...styles.navButton, right: '8px'}} onClick={goToNext}>
              ›
            </button>
          )}
        </>
      )}

      {/* Dots Indicator */}
      {!showLiveStream && images.length > 1 && (
        <div style={styles.dotsContainer}>
          {images.map((_, idx) => (
            <div
              key={idx}
              style={{
                ...styles.dot,
                background: idx === currentIndex ? '#ffffff' : 'rgba(255, 255, 255, 0.5)'
              }}
              onClick={() => {
                setCurrentIndex(idx);
                onImageChange?.(idx);
              }}
            />
          ))}
        </div>
      )}

      {/* Live Stream Toggle */}
      {liveStreamUrl && (
        <button 
          style={styles.streamToggle}
          onClick={() => setShowLiveStream(!showLiveStream)}
        >
          {showLiveStream ? '📷 Photos' : '🔴 LIVE'}
        </button>
      )}

      {/* Zoom indicator */}
      {isZoomed && (
        <div style={styles.zoomIndicator}>
          Pinch or double-tap to zoom out
        </div>
      )}
    </div>
  );
};

const styles = {
  container: {
    position: 'relative' as const,
    width: '100%',
    height: '300px',
    background: '#000000',
    overflow: 'hidden'
  },
  imageContainer: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    touchAction: 'pan-y pinch-zoom' as const
  },
  image: {
    maxWidth: '100%',
    maxHeight: '100%',
    objectFit: 'contain' as const,
    transition: 'transform 0.3s ease',
    userSelect: 'none' as const
  },
  liveStream: {
    width: '100%',
    height: '100%',
    border: 'none'
  },
  navButton: {
    position: 'absolute' as const,
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'rgba(0, 0, 0, 0.6)',
    color: '#ffffff',
    border: 'none',
    borderRadius: '50%',
    width: '40px',
    height: '40px',
    fontSize: '24px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10
  },
  dotsContainer: {
    position: 'absolute' as const,
    bottom: '12px',
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    gap: '8px',
    zIndex: 10
  },
  dot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    cursor: 'pointer',
    transition: 'background 0.2s'
  },
  streamToggle: {
    position: 'absolute' as const,
    top: '12px',
    right: '12px',
    background: '#ff0000',
    color: '#ffffff',
    border: 'none',
    borderRadius: '20px',
    padding: '6px 12px',
    fontSize: '12px',
    fontWeight: 'bold' as const,
    cursor: 'pointer',
    zIndex: 10
  },
  zoomIndicator: {
    position: 'absolute' as const,
    bottom: '40px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'rgba(0, 0, 0, 0.8)',
    color: '#ffffff',
    padding: '8px 16px',
    borderRadius: '20px',
    fontSize: '11px',
    zIndex: 10
  }
};

