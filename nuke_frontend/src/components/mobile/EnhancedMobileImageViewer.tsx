/**
 * Enhanced Mobile Image Viewer
 * Full-screen swipeable viewer with gestures, context, and tooling access
 */

import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { supabase } from '../../lib/supabase';
import { UserInteractionService } from '../../services/userInteractionService';
import { useVehiclePermissions } from '../../hooks/useVehiclePermissions';
import MobileBottomToolbar from './MobileBottomToolbar';
import ImageTagPlacer from './ImageTagPlacer';

interface EnhancedMobileImageViewerProps {
  images: any[];
  initialIndex: number;
  vehicleId: string;
  session: any;
  onClose: () => void;
  onDelete?: (imageId: string) => void;
  vehicle?: any;
}

export const EnhancedMobileImageViewer: React.FC<EnhancedMobileImageViewerProps> = ({
  images,
  initialIndex,
  vehicleId,
  session,
  onClose,
  onDelete,
  vehicle
}) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [scale, setScale] = useState(1);
  const [showDetails, setShowDetails] = useState(false);
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showAnimation, setShowAnimation] = useState<'like' | 'save' | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [tagMode, setTagMode] = useState(false);
  
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const touchStartTime = useRef(0);
  const lastTap = useRef(0);

  const currentImage = images[currentIndex];
  const isUploader = currentImage?.uploaded_by === session?.user?.id;
  
  const { isOwner, hasContributorAccess } = useVehiclePermissions(vehicleId, session, vehicle);

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
    } else if (Math.abs(deltaY) > 80) {
      // Vertical swipe - Twitter/Instagram style (higher threshold for less accidental triggers)
      if (deltaY > 0) {
        // Swipe down → Close
        onClose();
        vibrate(20);
      }
      // Removed swipe up → details (buggy, use toolbar instead)
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
      {/* Main Image with Gestures and Tag Placement */}
      {tagMode ? (
        <ImageTagPlacer
          imageId={currentImage.id}
          imageUrl={currentImage.large_url || currentImage.image_url}
          isActive={tagMode}
          onTagPlaced={() => {
            setTagMode(false);
          }}
        />
      ) : (
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
              {new Date(workOrderContext.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              {workOrderImageCount > 1 && ` • ${workOrderImageIndex}/${workOrderImageCount}`}
            </div>
          )}

          {/* Like Animation */}
          {showAnimation === 'like' && (
            <div style={styles.heartAnimation}>♥</div>
          )}

          {/* Save Animation */}
          {showAnimation === 'save' && (
            <div style={styles.starAnimation}>★</div>
          )}
        </div>
      )}

      {/* Top Bar - Twitter style */}
      <div style={styles.topBar}>
        <button
          onClick={onClose}
          style={{
            background: 'rgba(0, 0, 0, 0.5)',
            border: 'none',
            color: 'white',
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            fontSize: '16px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backdropFilter: 'blur(10px)'
          }}
        >
          ×
        </button>
        <div style={{ fontSize: '8pt', color: 'rgba(255,255,255,0.9)', fontWeight: 600 }}>
          {currentIndex + 1} / {images.length}
        </div>
        <div style={{ width: '32px' }} /> {/* Spacer for centering */}
      </div>

      {/* Bottom Toolbar removed - using single instance below */}

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
                  <span>Date: {new Date(workOrderContext.date).toLocaleDateString()}</span>
                  {workOrderContext.cost && <span>Cost: ${workOrderContext.cost}</span>}
                  {workOrderContext.hours && <span>Hours: {workOrderContext.hours}h</span>}
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
                  <span>Taken</span>
                  <span>{new Date(currentImage.taken_at).toLocaleString()}</span>
                </div>
              )}
              {currentImage.exif_data?.camera && (
                <div style={styles.metaRow}>
                  <span>Camera</span>
                  <span>{currentImage.exif_data.camera}</span>
                </div>
              )}
              {currentImage.file_size && (
                <div style={styles.metaRow}>
                  <span>Size</span>
                  <span>{(currentImage.file_size / 1024 / 1024).toFixed(2)} MB</span>
                </div>
              )}
              <div style={styles.metaRow}>
                <span>Views</span>
                <span>{currentImage.view_count || 0}</span>
              </div>
              <div style={styles.metaRow}>
                <span>Likes</span>
                <span>{currentImage.like_count || 0}</span>
              </div>
            </div>

            {/* Gesture Guide - Removed for cleaner interface */}
          </div>
        </div>
      )}

      {/* Gesture Hint - Removed for clean interface */}
      
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

      {/* Bottom Toolbar for comment/tag/camera tools */}
      <MobileBottomToolbar
        vehicleId={vehicleId}
        session={session}
        isOwner={isOwner}
        hasContributorAccess={hasContributorAccess}
        currentImage={currentImage}
        vehicle={vehicle}
        onToolSelect={(tool) => {
          if (tool === 'tag') {
            setTagMode(!tagMode);
          }
          if (tool === 'comment') {
            // Scroll to comment box and focus
            const commentBox = document.querySelector('[data-comment-box="true"]') as HTMLTextAreaElement;
            if (commentBox) {
              commentBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
              commentBox.focus();
            }
          }
        }}
      />
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
    padding: '12px 16px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    background: 'linear-gradient(to bottom, rgba(0,0,0,0.5), transparent)',
    zIndex: 10,
    paddingBottom: '40px' // Extend gradient fade
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
    top: '60px',
    left: '12px',
    background: 'rgba(0, 0, 0, 0.6)',
    color: '#ffffff',
    padding: '6px 10px',
    borderRadius: '6px',
    fontSize: '11px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    backdropFilter: 'blur(10px)',
    border: '1px solid rgba(255,255,255,0.1)'
  },
  heartAnimation: {
    position: 'absolute' as const,
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    fontSize: '80px',
    animation: 'heartBurst 0.6s ease-out',
    pointerEvents: 'none' as const,
    zIndex: 100,
    color: '#22c55e',
    fontWeight: 'normal' as const
  },
  starAnimation: {
    position: 'absolute' as const,
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    fontSize: '80px',
    animation: 'starSparkle 0.6s ease-out',
    pointerEvents: 'none' as const,
    zIndex: 100,
    color: '#fbbf24',
    fontWeight: 'normal' as const
  },
  detailPanel: {
    position: 'absolute' as const,
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: '70vh',
    background: 'rgba(0, 0, 0, 0.95)',
    backdropFilter: 'blur(20px)',
    borderRadius: '16px 16px 0 0',
    overflow: 'auto',
    zIndex: 20,
    animation: 'slideUp 0.3s ease-out',
    border: '1px solid rgba(255,255,255,0.1)'
  },
  detailHandle: {
    width: '40px',
    height: '4px',
    background: 'rgba(255,255,255,0.3)',
    borderRadius: '2px',
    margin: '10px auto',
    cursor: 'pointer'
  },
  detailContent: {
    padding: '16px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '16px'
  },
  contextCard: {
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    padding: '14px',
    borderRadius: '8px'
  },
  contextTitle: {
    margin: '0 0 10px 0',
    fontSize: '16px',
    fontWeight: '600' as const,
    color: '#ffffff',
    fontFamily: 'system-ui, -apple-system, sans-serif'
  },
  contextMeta: {
    display: 'flex',
    gap: '12px',
    fontSize: '12px',
    color: 'rgba(255,255,255,0.8)',
    marginBottom: '8px',
    flexWrap: 'wrap' as const
  },
  contextDescription: {
    fontSize: '13px',
    color: 'rgba(255,255,255,0.9)',
    margin: '8px 0',
    lineHeight: '1.5'
  },
  contextBadge: {
    background: 'rgba(34, 197, 94, 0.2)',
    color: '#22c55e',
    padding: '6px 10px',
    borderRadius: '6px',
    fontSize: '11px',
    display: 'inline-block',
    marginTop: '6px',
    border: '1px solid rgba(34, 197, 94, 0.3)'
  },
  metadataCard: {
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    padding: '14px',
    borderRadius: '8px'
  },
  sectionTitle: {
    margin: '0 0 12px 0',
    fontSize: '14px',
    fontWeight: '600' as const,
    color: '#ffffff',
    fontFamily: 'system-ui, -apple-system, sans-serif'
  },
  metaRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '8px 0',
    fontSize: '12px',
    color: 'rgba(255,255,255,0.9)',
    borderBottom: '1px solid rgba(255,255,255,0.05)'
  },
  gestureGuide: {
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    padding: '14px',
    borderRadius: '8px'
  },
  gestureList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px',
    fontSize: '12px',
    color: 'rgba(255,255,255,0.8)'
  },
  gestureHint: {
    position: 'absolute' as const,
    bottom: '100px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'rgba(0, 0, 0, 0.8)',
    color: '#ffffff',
    padding: '6px 12px',
    borderRadius: '16px',
    fontSize: '11px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    pointerEvents: 'none' as const,
    animation: 'fadeOut 2s ease-out forwards',
    backdropFilter: 'blur(10px)'
  },
  dotsContainer: {
    position: 'absolute' as const,
    top: '50px',
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    gap: '6px',
    zIndex: 10
  },
  dot: {
    borderRadius: '50%',
    transition: 'all 0.2s ease',
    boxShadow: '0 1px 2px rgba(0,0,0,0.3)'
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

