/**
 * Instagram/Twitter-Level Smooth Fullscreen Image Viewer
 * Vertical scrolling with thumb-friendly navigation
 * Swipe right = comment, swipe left = exit
 */

import React, { useState, useEffect, useRef } from 'react';
import { MobileCommentBox } from './MobileCommentBox';

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
  const [showComment, setShowComment] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const isScrollingRef = useRef(false);

  const currentImage = images[currentIndex];
  const isOwner = currentImage?.uploaded_by === session?.user?.id;

  // Scroll to initial image on mount
  useEffect(() => {
    if (scrollContainerRef.current) {
      const targetElement = scrollContainerRef.current.children[initialIndex] as HTMLElement;
      if (targetElement) {
        targetElement.scrollIntoView({ behavior: 'instant', block: 'center' });
      }
    }
  }, []);

  // Handle scroll to update current index
  const handleScroll = () => {
    if (isScrollingRef.current) return;
    
    const container = scrollContainerRef.current;
    if (!container) return;

    const children = Array.from(container.children) as HTMLElement[];
    const containerRect = container.getBoundingClientRect();
    const containerCenter = containerRect.top + containerRect.height / 2;

    let closestIndex = 0;
    let closestDistance = Infinity;

    children.forEach((child, index) => {
      const childRect = child.getBoundingClientRect();
      const childCenter = childRect.top + childRect.height / 2;
      const distance = Math.abs(childCenter - containerCenter);

      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });

    if (closestIndex !== currentIndex) {
      setCurrentIndex(closestIndex);
    }
  };

  // Handle touch gestures
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
    isScrollingRef.current = false;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    
    const deltaX = e.touches[0].clientX - touchStartRef.current.x;
    const deltaY = Math.abs(e.touches[0].clientY - touchStartRef.current.y);
    
    // If vertical scroll is significant, mark as scrolling
    if (deltaY > 10) {
      isScrollingRef.current = true;
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartRef.current) return;

    const deltaX = e.changedTouches[0].clientX - touchStartRef.current.x;
    const deltaY = Math.abs(e.changedTouches[0].clientY - touchStartRef.current.y);
    const absDeltaX = Math.abs(deltaX);

    // Only handle horizontal swipes if not scrolling vertically
    if (!isScrollingRef.current && absDeltaX > 50 && absDeltaX > deltaY * 2) {
      if (deltaX > 0) {
        // Swipe right = show comment
        setShowComment(true);
      } else {
        // Swipe left = exit
        onClose();
      }
    }

    touchStartRef.current = null;
    setTimeout(() => {
      isScrollingRef.current = false;
    }, 100);
  };

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
    <div 
      style={styles.fullscreen}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Close button - Always visible */}
      <button onClick={onClose} style={styles.closeBtn}>
        ✕
      </button>

      {/* Image counter - Always visible */}
      <div style={styles.counter}>
        {currentIndex + 1} / {images.length}
      </div>

      {/* Vertical Scroll Container */}
      <div
        ref={scrollContainerRef}
        style={styles.scrollContainer}
        onScroll={handleScroll}
      >
        {images.map((image, index) => (
          <div key={image.id} style={styles.imageWrapper}>
            <img
              src={image.large_url || image.image_url}
              alt=""
              style={styles.image}
              draggable={false}
            />
          </div>
        ))}
      </div>

      {/* Comment Panel - Slides in from right */}
      {showComment && (
        <div style={styles.commentPanel}>
          <div style={styles.commentHeader}>
            <button onClick={() => setShowComment(false)} style={styles.commentCloseBtn}>
              ✕
            </button>
            <div style={styles.commentTitle}>Comments</div>
          </div>
          <div style={styles.commentContent}>
            <MobileCommentBox
              vehicleId={vehicleId}
              session={session}
              targetType="image"
              targetId={currentImage.id}
            />
          </div>
        </div>
      )}

      {/* Bottom toolbar - Only show when not commenting */}
      {!showComment && (
        <div style={styles.toolbar}>
          {isOwner && (
            <button onClick={handleDelete} style={styles.actionBtn}>
              DELETE
            </button>
          )}
        </div>
      )}

      {/* Swipe hint */}
      {currentIndex === initialIndex && !showComment && (
        <div style={styles.hint}>
          Scroll up/down • Swipe right for comments • Swipe left to exit
        </div>
      )}
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
    touchAction: 'pan-y', // Allow vertical scrolling
    overflow: 'hidden',
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
    fontSize: '8pt',
    fontWeight: 700,
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
    fontSize: '8pt',
    borderRadius: '20px',
    zIndex: 10001,
    fontFamily: 'var(--font-mono)',
  },
  scrollContainer: {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
    WebkitOverflowScrolling: 'touch',
    scrollSnapType: 'y mandatory',
    scrollBehavior: 'smooth',
  },
  imageWrapper: {
    width: '100vw',
    height: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    scrollSnapAlign: 'center',
    scrollSnapStop: 'always',
    position: 'relative',
  },
  image: {
    maxWidth: '100%',
    maxHeight: '100%',
    objectFit: 'contain',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitTouchCallout: 'none',
  },
  toolbar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    background: 'linear-gradient(transparent, rgba(0, 0, 0, 0.8))',
    padding: '16px',
    pointerEvents: 'all',
    zIndex: 10000,
  },
  actionBtn: {
    background: '#ff0000',
    color: '#fff',
    border: 'none',
    padding: '10px 20px',
    fontSize: '8pt',
    fontWeight: 700,
    borderRadius: 'var(--radius)',
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
    fontSize: '8pt',
    zIndex: 10002,
    pointerEvents: 'none',
    animation: 'fadeOut 3s forwards',
    textAlign: 'center',
    fontFamily: 'var(--font-family)',
  },
  commentPanel: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: '80%',
    maxWidth: '400px',
    background: 'var(--bg)',
    zIndex: 10003,
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '-4px 0 20px rgba(0, 0, 0, 0.5)',
    animation: 'slideInRight 0.3s ease',
  },
  commentHeader: {
    padding: 'var(--space-4)',
    borderBottom: '2px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
  },
  commentCloseBtn: {
    background: 'none',
    border: 'none',
    fontSize: '20px',
    cursor: 'pointer',
    color: 'var(--text)',
    padding: 0,
    width: '32px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentTitle: {
    fontSize: '8pt',
    fontWeight: 700,
    color: 'var(--text)',
  },
  commentContent: {
    flex: 1,
    overflowY: 'auto',
    padding: 'var(--space-4)',
  },
};

// Add animations
const styleSheet = document.createElement('style');
styleSheet.textContent = `
  @keyframes fadeOut {
    0% { opacity: 1; }
    100% { opacity: 0; }
  }
  @keyframes slideInRight {
    0% { transform: translateX(100%); }
    100% { transform: translateX(0); }
  }
`;
document.head.appendChild(styleSheet);
