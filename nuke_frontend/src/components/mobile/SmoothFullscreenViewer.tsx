/**
 * Instagram/Twitter-Level Smooth Fullscreen Image Viewer
 * Buttery smooth swipes, pinch zoom, momentum scrolling
 */

import React, { useState, useEffect } from 'react';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Zoom, Virtual } from 'swiper/modules';
import 'swiper/css';
import 'swiper/css/zoom';
import 'swiper/css/virtual';

interface SmoothFullscreenViewerProps {
  images: any[];
  initialIndex: number;
  onClose: () => void;
  onDelete?: (imageId: string) => void;
  vehicleId: string;
  session: any;
}

export const SmoothFullscreenViewer: React.FC<SmoothFullscreenViewerProps> = ({
  images,
  initialIndex,
  onClose,
  onDelete,
  vehicleId,
  session,
}) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [showControls, setShowControls] = useState(true);
  const currentImage = images[currentIndex];
  const isOwner = currentImage?.uploaded_by === session?.user?.id;

  // Auto-hide controls after 3 seconds
  useEffect(() => {
    const timer = setTimeout(() => setShowControls(false), 3000);
    return () => clearTimeout(timer);
  }, [currentIndex]);

  const handleDelete = () => {
    if (!isOwner) {
      alert('You can only delete your own images');
      return;
    }
    
    if (confirm('Delete this image? Cannot be undone.')) {
      onDelete?.(currentImage.id);
    }
  };

  return (
    <div style={styles.fullscreen} onClick={() => setShowControls(true)}>
      {/* Close button - Always visible */}
      <button onClick={onClose} style={styles.closeBtn}>
        ✕
      </button>

      {/* Image counter - Always visible */}
      <div style={styles.counter}>
        {currentIndex + 1} / {images.length}
      </div>

      {/* Swiper - Buttery smooth */}
      <Swiper
        modules={[Zoom, Virtual]}
        initialSlide={initialIndex}
        spaceBetween={0}
        slidesPerView={1}
        speed={250} // Fast but smooth
        touchRatio={1.5} // Very responsive
        resistance={true}
        resistanceRatio={0.65}
        threshold={3} // Very sensitive
        virtual={true} // Only render visible slides + 2 on each side
        zoom={{
          maxRatio: 4,
          minRatio: 1,
          toggle: true, // Double tap to zoom
        }}
        onSlideChange={(swiper) => {
          setCurrentIndex(swiper.activeIndex);
          setShowControls(true);
        }}
        style={styles.swiper}
      >
        {images.map((image, index) => (
          <SwiperSlide key={image.id} virtualIndex={index}>
            <div className="swiper-zoom-container" style={styles.slideContainer}>
              <img
                src={image.large_url || image.image_url}
                alt=""
                style={styles.image}
                draggable={false}
              />
            </div>
          </SwiperSlide>
        ))}
      </Swiper>

      {/* Controls - Fade in/out */}
      {showControls && (
        <div style={styles.controls}>
          {/* Navigation arrows */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (currentIndex > 0) {
                setCurrentIndex(currentIndex - 1);
              }
            }}
            disabled={currentIndex === 0}
            style={{
              ...styles.navBtn,
              ...styles.navBtnLeft,
              opacity: currentIndex === 0 ? 0.3 : 1,
            }}
          >
            ←
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              if (currentIndex < images.length - 1) {
                setCurrentIndex(currentIndex + 1);
              }
            }}
            disabled={currentIndex === images.length - 1}
            style={{
              ...styles.navBtn,
              ...styles.navBtnRight,
              opacity: currentIndex === images.length - 1 ? 0.3 : 1,
            }}
          >
            →
          </button>

          {/* Bottom toolbar */}
          <div style={styles.toolbar}>
            {/* Image info */}
            <div style={styles.imageInfo}>
              {currentImage.metadata?.taken_at && (
                <span style={styles.infoText}>
                  {new Date(currentImage.metadata.taken_at).toLocaleDateString()}
                </span>
              )}
            </div>

            {/* Actions */}
            <div style={styles.actions}>
              {isOwner && (
                <button onClick={handleDelete} style={styles.actionBtn}>
                  DELETE
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Swipe hint - Fade out after first swipe */}
      {currentIndex === initialIndex && (
        <div style={styles.hint}>
          Swipe • Pinch to zoom • Double tap
        </div>
      )}

      <style>{`
        /* Smooth Swiper overrides */
        .swiper {
          --swiper-theme-color: #00ff00;
        }
        
        .swiper-slide {
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        }

        .swiper-zoom-container {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        /* Pagination dots - minimalist */
        .swiper-pagination-bullet {
          background: rgba(255, 255, 255, 0.5);
          opacity: 1;
          width: 6px;
          height: 6px;
        }

        .swiper-pagination-bullet-active {
          background: #00ff00;
          width: 8px;
          height: 8px;
        }

        /* Momentum scrolling for iOS */
        .swiper-wrapper {
          -webkit-overflow-scrolling: touch;
        }

        /* Performance boost */
        .swiper-slide img {
          will-change: transform;
          -webkit-transform: translateZ(0);
          transform: translateZ(0);
        }
      `}</style>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  fullscreen: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: '#000',
    zIndex: 9999,
    display: 'flex',
    flexDirection: 'column',
    touchAction: 'none', // Prevent default gestures
  },
  closeBtn: {
    position: 'absolute',
    top: '12px',
    right: '12px',
    width: '44px',
    height: '44px',
    background: 'rgba(0, 0, 0, 0.6)',
    border: '2px solid rgba(255, 255, 255, 0.3)',
    color: '#fff',
    fontSize: '24px',
    cursor: 'pointer',
    zIndex: 10001,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.15s ease',
    WebkitTapHighlightColor: 'transparent',
  },
  counter: {
    position: 'absolute',
    top: '12px',
    left: '12px',
    background: 'rgba(0, 0, 0, 0.6)',
    color: '#fff',
    padding: '8px 12px',
    fontSize: '14px',
    borderRadius: '20px',
    zIndex: 10001,
    fontFamily: 'monospace',
  },
  swiper: {
    width: '100%',
    height: '100%',
  } as React.CSSProperties,
  slideContainer: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    maxWidth: '100%',
    maxHeight: '100%',
    objectFit: 'contain',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitTouchCallout: 'none',
    pointerEvents: 'none', // Let Swiper handle all interactions
  },
  controls: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    pointerEvents: 'none', // Let swipes pass through
    zIndex: 10000,
  },
  navBtn: {
    position: 'absolute',
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'rgba(0, 0, 0, 0.5)',
    border: 'none',
    color: '#fff',
    fontSize: '32px',
    width: '50px',
    height: '80px',
    cursor: 'pointer',
    pointerEvents: 'all', // Re-enable for buttons
    transition: 'all 0.15s ease',
    WebkitTapHighlightColor: 'transparent',
  },
  navBtnLeft: {
    left: 0,
    borderTopRightRadius: '8px',
    borderBottomRightRadius: '8px',
  },
  navBtnRight: {
    right: 0,
    borderTopLeftRadius: '8px',
    borderBottomLeftRadius: '8px',
  },
  toolbar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    background: 'linear-gradient(transparent, rgba(0, 0, 0, 0.8))',
    padding: '60px 16px 16px 16px',
    pointerEvents: 'all',
  },
  imageInfo: {
    marginBottom: '12px',
  },
  infoText: {
    color: '#fff',
    fontSize: '13px',
    fontFamily: 'monospace',
  },
  actions: {
    display: 'flex',
    gap: '8px',
    justifyContent: 'flex-end',
  },
  actionBtn: {
    background: '#ff0000',
    color: '#fff',
    border: 'none',
    padding: '10px 20px',
    fontSize: '12px',
    fontWeight: 'bold',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'all 0.1s ease',
    WebkitTapHighlightColor: 'transparent',
  },
  hint: {
    position: 'absolute',
    bottom: '80px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'rgba(0, 0, 0, 0.7)',
    color: '#fff',
    padding: '10px 16px',
    borderRadius: '20px',
    fontSize: '13px',
    zIndex: 10002,
    pointerEvents: 'none',
    animation: 'fadeOut 3s forwards',
  },
};

