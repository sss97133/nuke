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
  const [touchStart, setTouchStart] = useState<{x: number, y: number} | null>(null);
  const [touchEnd, setTouchEnd] = useState<{x: number, y: number} | null>(null);
  const [scale, setScale] = useState(1);
  const [lastScale, setLastScale] = useState(1);
  const [initialPinchDistance, setInitialPinchDistance] = useState<number | null>(null);
  const [showLiveStream, setShowLiveStream] = useState(!!liveStreamUrl);
  const imageRef = useRef<HTMLImageElement>(null);

  const getDistance = (touch1: Touch, touch2: Touch) => {
    const dx = touch1.clientX - touch2.clientX;
    const dy = touch1.clientY - touch2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      // Single touch - track for swipe
      setTouchStart({ x: e.touches[0].clientX, y: e.touches[0].clientY });
    } else if (e.touches.length === 2) {
      // Two fingers - pinch zoom
      const distance = getDistance(e.touches[0], e.touches[1]);
      setInitialPinchDistance(distance);
      setLastScale(scale);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 1 && touchStart) {
      // Single touch - track swipe
      setTouchEnd({ x: e.touches[0].clientX, y: e.touches[0].clientY });
    } else if (e.touches.length === 2 && initialPinchDistance) {
      // Pinch zoom - only affects image
      e.preventDefault(); // Prevent page zoom
      const currentDistance = getDistance(e.touches[0], e.touches[1]);
      const newScale = (currentDistance / initialPinchDistance) * lastScale;
      setScale(Math.min(Math.max(1, newScale), 4)); // Clamp between 1x and 4x
    }
  };

  const handleTouchEnd = () => {
    if (scale > 1) {
      // Zoomed - don't swipe
      setInitialPinchDistance(null);
      return;
    }
    
    if (!touchStart || !touchEnd) return;
    
    const minSwipeDistance = 50;
    const distance = touchStart.x - touchEnd.x;
    
    if (Math.abs(distance) < minSwipeDistance) {
      setTouchStart(null);
      setTouchEnd(null);
      return;
    }
    
    if (distance > 0 && currentIndex < images.length - 1) {
      // Swipe left - next image
      goToNext();
    } else if (distance < 0 && currentIndex > 0) {
      // Swipe right - previous image
      goToPrevious();
    }
    
    setTouchStart(null);
    setTouchEnd(null);
    setInitialPinchDistance(null);
  };

  const goToNext = () => {
    if (currentIndex < images.length - 1) {
      const newIndex = currentIndex + 1;
      setCurrentIndex(newIndex);
      setScale(1); // Reset zoom on image change
      setLastScale(1);
      onImageChange?.(newIndex);
    }
  };

  const goToPrevious = () => {
    if (currentIndex > 0) {
      const newIndex = currentIndex - 1;
      setCurrentIndex(newIndex);
      setScale(1); // Reset zoom on image change
      setLastScale(1);
      onImageChange?.(newIndex);
    }
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
              transform: `scale(${scale})`,
              transformOrigin: 'center center',
              transition: scale === 1 ? 'transform 0.3s ease' : 'none'
            }}
          />
        )}
      </div>


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
      {scale > 1 && (
        <div style={styles.zoomIndicator}>
          {scale.toFixed(1)}x • Pinch to zoom out
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
    background: '#f0f0f0',
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
    width: '100%',
    height: '100%',
    objectFit: 'cover' as const,
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

