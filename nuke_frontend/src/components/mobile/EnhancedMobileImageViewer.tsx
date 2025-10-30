/**
 * Enhanced Mobile Image Viewer
 * Full-screen swipeable viewer with gestures, context, and tooling access
 */

import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { supabase } from '../../lib/supabase';
import { UserInteractionService } from '../../services/userInteractionService';

interface EnhancedMobileImageViewerProps {
  images: any[];
  initialIndex: number;
  vehicleId: string;
  session: any;
  onClose: () => void;
  onDelete?: (imageId: string) => void;
}

export const EnhancedMobileImageViewer: React.FC<EnhancedMobileImageViewerProps> = ({
  images,
  initialIndex,
  vehicleId,
  session,
  onClose,
  onDelete
}) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [scale, setScale] = useState(1);
  const [showDetails, setShowDetails] = useState(false);
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showAnimation, setShowAnimation] = useState<'like' | 'save' | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const touchStartTime = useRef(0);
  const lastTap = useRef(0);

  const currentImage = images[currentIndex];
  const isUploader = currentImage?.user_id === session?.user?.id;

  // Load user interactions for current image
  useEffect(() => {
    loadInteractions();
  }, [currentIndex]);

  const loadInteractions = async () => {
    if (!session?.user) return;
    
    try {
      const prefs = await UserInteractionService.getUserPreferences(session.user.id);
      setLiked(prefs.liked_images?.includes(currentImage.id) || false);
      setSaved(prefs.saved_images?.includes(currentImage.id) || false);
    } catch (error) {
      console.error('Failed to load interactions:', error);
    }
  };

  // Gesture Handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartX.current = touch.clientX;
    touchStartY.current = touch.clientY;
    touchStartTime.current = Date.now();

    // Detect double-tap
    const now = Date.now();
    if (now - lastTap.current < 300) {
      handleDoubleTap();
    }
    lastTap.current = now;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    const deltaX = touch.clientX - touchStartX.current;
    const deltaY = touch.clientY - touchStartY.current;
    
    // Instagram-style: Show swipe progress for horizontal swipes
    if (Math.abs(deltaX) > 30 && Math.abs(deltaX) > Math.abs(deltaY)) {
      // Only show offset if not at boundaries
      if ((deltaX < 0 && currentIndex < images.length - 1) || (deltaX > 0 && currentIndex > 0)) {
        setSwipeOffset(deltaX * 0.8); // Dampen the movement slightly
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - touchStartX.current;
    const deltaY = touch.clientY - touchStartY.current;
    const deltaTime = Date.now() - touchStartTime.current;

    // Long press detection (>500ms, minimal movement)
    if (deltaTime > 500 && Math.abs(deltaX) < 10 && Math.abs(deltaY) < 10) {
      handleLongPress();
      return;
    }

    // Reset swipe offset and animate transition
    setSwipeOffset(0);
    
    // Swipe detection - INSTAGRAM-LIKE
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) {
      setIsTransitioning(true);
      
      // Horizontal swipe - Navigate between images (SMOOTH like Instagram)
      if (deltaX < 0) {
        // Swipe left → Next image
        if (currentIndex < images.length - 1) {
          setTimeout(() => {
            setCurrentIndex(currentIndex + 1);
            setIsTransitioning(false);
          }, 50);
          vibrate(10);
        } else {
          setIsTransitioning(false);
        }
      } else {
        // Swipe right → Previous image
        if (currentIndex > 0) {
          setTimeout(() => {
            setCurrentIndex(currentIndex - 1);
            setIsTransitioning(false);
          }, 50);
          vibrate(10);
        } else {
          setIsTransitioning(false);
        }
      }
    } else if (Math.abs(deltaY) > 50) {
      // Vertical swipe
      if (deltaY > 0) {
        // Swipe down → Close (Instagram style)
        onClose();
        vibrate(20);
      } else {
        // Swipe up → Show details
        setShowDetails(true);
        vibrate(15);
      }
    }
  };

  const handleDoubleTap = async () => {
    if (!session?.user) return;
    
    // Toggle like
    if (liked) {
      await UserInteractionService.unlikeImage(session.user.id, currentImage.id, vehicleId);
      setLiked(false);
    } else {
      await UserInteractionService.likeImage(session.user.id, currentImage.id, vehicleId);
      setLiked(true);
      triggerAnimation('like');
      vibrate();
    }
  };

  const handleSwipeRight = async () => {
    if (!session?.user || saved) return;
    
    const success = await UserInteractionService.saveImage(session.user.id, currentImage.id, vehicleId);
    if (success) {
      setSaved(true);
      triggerAnimation('save');
      vibrate();
    }
  };

  const handleLongPress = () => {
    // Show quick tag menu (to be implemented)
    vibrate([50, 100, 50]);
    alert('Quick tag menu - to be implemented');
  };

  const triggerAnimation = (type: 'like' | 'save') => {
    setShowAnimation(type);
    setTimeout(() => setShowAnimation(null), 1000);
  };

  const vibrate = (pattern: number | number[] = 50) => {
    if ('vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  };

  const handleDeleteImage = async () => {
    if (!isUploader) return;
    if (!confirm('Delete this image? This cannot be undone.')) return;
    
    if (onDelete) {
      onDelete(currentImage.id);
      onClose();
    }
  };

  // Get work order context
  const workOrderContext = currentImage.timeline_events ? {
    title: currentImage.timeline_events.title,
    date: currentImage.timeline_events.event_date,
    cost: currentImage.timeline_events.cost_amount,
    hours: currentImage.timeline_events.duration_hours,
    description: currentImage.timeline_events.description
  } : null;

  // Count images in this work order
  const workOrderImageCount = workOrderContext 
    ? images.filter(img => img.timeline_event_id === currentImage.timeline_event_id).length
    : 0;
  
  const workOrderImageIndex = workOrderContext
    ? images.filter(img => img.timeline_event_id === currentImage.timeline_event_id)
        .findIndex(img => img.id === currentImage.id) + 1
    : 0;

  return ReactDOM.createPortal(
    <div style={styles.overlay}>
      {/* Main Image with Gestures */}
      <div
        style={styles.imageContainer}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <img
          src={currentImage.medium_url || currentImage.large_url || currentImage.image_url}
          alt=""
          style={{
            ...styles.image,
            transform: `translateX(${swipeOffset}px) scale(${scale})`,
            transition: swipeOffset === 0 ? 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)' : 'none',
            opacity: Math.max(0.3, 1 - Math.abs(swipeOffset) / 400) // Fade slightly during swipe
          }}
        />

        {/* Work Order Badge (if part of timeline event) */}
        {workOrderContext && (
          <div style={styles.workOrderBadge}>
            📅 {new Date(workOrderContext.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            {workOrderImageCount > 1 && ` • ${workOrderImageIndex}/${workOrderImageCount}`}
          </div>
        )}

        {/* Like Animation */}
        {showAnimation === 'like' && (
          <div style={styles.heartAnimation}>❤️</div>
        )}

        {/* Save Animation */}
        {showAnimation === 'save' && (
          <div style={styles.starAnimation}>⭐</div>
        )}
      </div>

      {/* Top Bar - Minimal */}
      <div style={styles.topBar}>
        <button onClick={onClose} style={styles.closeButton}>✕</button>
        {isUploader && (
          <button onClick={handleDeleteImage} style={styles.deleteButton}>🗑️</button>
        )}
      </div>

      {/* Bottom Bar - Info Button + Image Counter + Help Text */}
      <div style={styles.bottomBar}>
        <div style={styles.imageCounter}>
          {currentIndex + 1} / {images.length}
        </div>
        
        <div style={styles.helpText}>
          Double-tap to like • Swipe to navigate
        </div>
        
        <button 
          onClick={() => setShowDetails(!showDetails)}
          style={{
            ...styles.infoButton,
            background: showDetails ? '#000080' : '#c0c0c0'
          }}
        >
          ℹ️
        </button>
      </div>

      {/* Detail Panel - Slides up from bottom */}
      {showDetails && (
        <div style={styles.detailPanel} onClick={(e) => e.stopPropagation()}>
          <div style={styles.detailHandle} onClick={() => setShowDetails(false)} />
          
          <div style={styles.detailContent}>
            {/* Work Order Context */}
            {workOrderContext ? (
              <div style={styles.contextCard}>
                <h3 style={styles.contextTitle}>{workOrderContext.title}</h3>
                <div style={styles.contextMeta}>
                  <span>📅 {new Date(workOrderContext.date).toLocaleDateString()}</span>
                  {workOrderContext.cost && <span>💰 ${workOrderContext.cost}</span>}
                  {workOrderContext.hours && <span>⏱️ {workOrderContext.hours}h</span>}
                </div>
                {workOrderContext.description && (
                  <p style={styles.contextDescription}>{workOrderContext.description}</p>
                )}
                <div style={styles.contextBadge}>
                  Part of work session • Photo {workOrderImageIndex}/{workOrderImageCount}
                </div>
              </div>
            ) : (
              <div style={styles.contextCard}>
                <h3 style={styles.contextTitle}>Standalone Photo</h3>
                <p style={styles.contextDescription}>Not linked to a work order or timeline event</p>
              </div>
            )}

            {/* Image Metadata */}
            <div style={styles.metadataCard}>
              <h4 style={styles.sectionTitle}>Image Details</h4>
              {currentImage.taken_at && (
                <div style={styles.metaRow}>
                  <span>📸 Taken</span>
                  <span>{new Date(currentImage.taken_at).toLocaleString()}</span>
                </div>
              )}
              {currentImage.exif_data?.camera && (
                <div style={styles.metaRow}>
                  <span>📷 Camera</span>
                  <span>{currentImage.exif_data.camera}</span>
                </div>
              )}
              {currentImage.file_size && (
                <div style={styles.metaRow}>
                  <span>📦 Size</span>
                  <span>{(currentImage.file_size / 1024 / 1024).toFixed(2)} MB</span>
                </div>
              )}
              <div style={styles.metaRow}>
                <span>👁️ Views</span>
                <span>{currentImage.view_count || 0}</span>
              </div>
              <div style={styles.metaRow}>
                <span>❤️ Likes</span>
                <span>{currentImage.like_count || 0}</span>
              </div>
            </div>

            {/* Gesture Guide */}
            <div style={styles.gestureGuide}>
              <h4 style={styles.sectionTitle}>Gestures</h4>
              <div style={styles.gestureList}>
                <div>Double-tap → Like ❤️</div>
                <div>Swipe left/right → Navigate images 👈👉</div>
                <div>Swipe down → Close viewer ⬇️</div>
                <div>Swipe up → Show details ⬆️</div>
                <div>Long-press → Quick tag 🏷️</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Gesture Hint (fades out after 3s) */}
      <div style={styles.gestureHint}>
        Double-tap = Like • Swipe left/right = Navigate • Swipe down = Close
      </div>
      
      {/* Instagram-like progress dots */}
      {images.length > 1 && (
        <div style={styles.dotsContainer}>
          {images.map((_, idx) => (
            <div
              key={idx}
              style={{
                ...styles.dot,
                background: idx === currentIndex ? '#ffffff' : 'rgba(255, 255, 255, 0.3)',
                width: idx === currentIndex ? '8px' : '6px',
                height: idx === currentIndex ? '8px' : '6px'
              }}
            />
          ))}
        </div>
      )}
    </div>,
    document.body
  );
};

const styles = {
  overlay: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: '#000000',
    zIndex: 999999,
    display: 'flex',
    flexDirection: 'column' as const
  },
  imageContainer: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative' as const,
    touchAction: 'none'
  },
  image: {
    maxWidth: '100%',
    maxHeight: '100%',
    objectFit: 'contain' as const,
    transition: 'transform 0.3s ease',
    userSelect: 'none' as const
  },
  topBar: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    padding: '16px',
    display: 'flex',
    justifyContent: 'space-between',
    background: 'linear-gradient(to bottom, rgba(0,0,0,0.6), transparent)',
    zIndex: 10
  },
  closeButton: {
    background: 'rgba(192, 192, 192, 0.9)',
    border: '2px outset #ffffff',
    color: '#000',
    width: '40px',
    height: '40px',
    borderRadius: '4px',
    fontSize: '24px',
    fontWeight: 'bold' as const,
    cursor: 'pointer',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  deleteButton: {
    background: 'rgba(192, 0, 0, 0.9)',
    border: '2px outset #ff6666',
    color: '#fff',
    width: '40px',
    height: '40px',
    borderRadius: '4px',
    fontSize: '20px',
    cursor: 'pointer',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  bottomBar: {
    position: 'absolute' as const,
    bottom: 0,
    left: 0,
    right: 0,
    padding: '16px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    background: 'linear-gradient(to top, rgba(0,0,0,0.6), transparent)',
    zIndex: 10
  },
  imageCounter: {
    color: '#ffffff',
    fontSize: '14px',
    fontWeight: 'bold' as const,
    textShadow: '0 1px 3px rgba(0,0,0,0.8)',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  helpText: {
    fontSize: '10px',
    color: 'rgba(255, 255, 255, 0.9)',
    textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
    fontWeight: '500',
    textAlign: 'center' as const,
    flex: 1,
    pointerEvents: 'auto' as const
  },
  infoButton: {
    border: '2px outset #ffffff',
    color: '#000',
    width: '44px',
    height: '44px',
    borderRadius: '22px',
    fontSize: '20px',
    fontWeight: 'bold' as const,
    cursor: 'pointer',
    fontFamily: '"MS Sans Serif", sans-serif',
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
  },
  workOrderBadge: {
    position: 'absolute' as const,
    top: '80px',
    left: '16px',
    background: 'rgba(0, 0, 128, 0.9)',
    color: '#ffffff',
    padding: '8px 12px',
    borderRadius: '4px',
    fontSize: '12px',
    fontFamily: '"MS Sans Serif", sans-serif',
    border: '2px outset #ffffff',
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
  },
  heartAnimation: {
    position: 'absolute' as const,
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    fontSize: '120px',
    animation: 'heartBurst 1s ease-out',
    pointerEvents: 'none' as const,
    zIndex: 100
  },
  starAnimation: {
    position: 'absolute' as const,
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    fontSize: '120px',
    animation: 'starSparkle 1s ease-out',
    pointerEvents: 'none' as const,
    zIndex: 100
  },
  detailPanel: {
    position: 'absolute' as const,
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: '70vh',
    background: '#c0c0c0',
    border: '2px outset #ffffff',
    borderRadius: '12px 12px 0 0',
    overflow: 'auto',
    zIndex: 20,
    animation: 'slideUp 0.3s ease-out'
  },
  detailHandle: {
    width: '40px',
    height: '4px',
    background: '#808080',
    borderRadius: '2px',
    margin: '8px auto',
    cursor: 'pointer'
  },
  detailContent: {
    padding: '16px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '12px'
  },
  contextCard: {
    background: '#ffffff',
    border: '2px inset #808080',
    padding: '12px',
    borderRadius: '4px'
  },
  contextTitle: {
    margin: '0 0 8px 0',
    fontSize: '16px',
    fontWeight: 'bold' as const,
    color: '#000080',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  contextMeta: {
    display: 'flex',
    gap: '12px',
    fontSize: '12px',
    color: '#000',
    marginBottom: '8px',
    flexWrap: 'wrap' as const
  },
  contextDescription: {
    fontSize: '13px',
    color: '#000',
    margin: '8px 0',
    lineHeight: '1.4'
  },
  contextBadge: {
    background: '#000080',
    color: '#ffffff',
    padding: '4px 8px',
    borderRadius: '2px',
    fontSize: '11px',
    display: 'inline-block',
    marginTop: '4px'
  },
  metadataCard: {
    background: '#ffffff',
    border: '2px inset #808080',
    padding: '12px',
    borderRadius: '4px'
  },
  sectionTitle: {
    margin: '0 0 8px 0',
    fontSize: '14px',
    fontWeight: 'bold' as const,
    color: '#000',
    fontFamily: '"MS Sans Serif", sans-serif'
  },
  metaRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '6px 0',
    fontSize: '12px',
    color: '#000',
    borderBottom: '1px solid #e0e0e0'
  },
  gestureGuide: {
    background: '#ffffff',
    border: '2px inset #808080',
    padding: '12px',
    borderRadius: '4px'
  },
  gestureList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
    fontSize: '12px',
    color: '#000'
  },
  gestureHint: {
    position: 'absolute' as const,
    bottom: '80px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'rgba(0, 0, 0, 0.7)',
    color: '#ffffff',
    padding: '8px 16px',
    borderRadius: '20px',
    fontSize: '11px',
    fontFamily: '"MS Sans Serif", sans-serif',
    pointerEvents: 'none' as const,
    animation: 'fadeOut 3s ease-out forwards'
  },
  dotsContainer: {
    position: 'absolute' as const,
    top: '70px',
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    gap: '4px',
    zIndex: 10
  },
  dot: {
    borderRadius: '50%',
    transition: 'all 0.3s ease',
    boxShadow: '0 1px 3px rgba(0,0,0,0.5)'
  }
};

// Add CSS animations
if (typeof document !== 'undefined') {
  const styleSheet = document.styleSheets[0];
  try {
    styleSheet.insertRule(`
      @keyframes heartBurst {
        0% { transform: translate(-50%, -50%) scale(0); opacity: 1; }
        50% { transform: translate(-50%, -50%) scale(1.2); opacity: 1; }
        100% { transform: translate(-50%, -50%) scale(1.5); opacity: 0; }
      }
    `, styleSheet.cssRules.length);
    
    styleSheet.insertRule(`
      @keyframes starSparkle {
        0% { transform: translate(-50%, -50%) scale(0) rotate(0deg); opacity: 1; }
        50% { transform: translate(-50%, -50%) scale(1.2) rotate(180deg); opacity: 1; }
        100% { transform: translate(-50%, -50%) scale(1.5) rotate(360deg); opacity: 0; }
      }
    `, styleSheet.cssRules.length);
    
    styleSheet.insertRule(`
      @keyframes slideUp {
        from { transform: translateY(100%); }
        to { transform: translateY(0); }
      }
    `, styleSheet.cssRules.length);
    
    styleSheet.insertRule(`
      @keyframes fadeOut {
        0% { opacity: 1; }
        70% { opacity: 1; }
        100% { opacity: 0; }
      }
    `, styleSheet.cssRules.length);
  } catch (e) {
    // Animations already exist or CSS insertion failed
  }
}

