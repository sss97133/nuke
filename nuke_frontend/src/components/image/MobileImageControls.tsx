/**
 * Mobile Image Controls - Swipe & Gesture Interface
 * Social media style interactions for image viewer
 */

import React, { useState, useRef, useEffect } from 'react';

interface MobileImageControlsProps {
  onSwipeLeft?: () => void;   // Next image
  onSwipeRight?: () => void;  // Previous image
  onSwipeUp?: () => void;     // Like/Save
  onSwipeDown?: () => void;   // Dislike/Skip
  onDoubleTap?: () => void;   // Quick action (like)
  onLongPress?: () => void;   // Show options menu
  children: React.ReactNode;
}

export const MobileImageControls: React.FC<MobileImageControlsProps> = ({
  onSwipeLeft,
  onSwipeRight,
  onSwipeUp,
  onSwipeDown,
  onDoubleTap,
  onLongPress,
  children
}) => {
  const [touchStart, setTouchStart] = useState<{ x: number; y: number; time: number } | null>(null);
  const [lastTap, setLastTap] = useState<number>(0);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const SWIPE_THRESHOLD = 50; // pixels
  const DOUBLE_TAP_DELAY = 300; // ms
  const LONG_PRESS_DELAY = 500; // ms

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    setTouchStart({
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now()
    });

    // Start long press timer
    if (onLongPress) {
      longPressTimer.current = setTimeout(() => {
        onLongPress();
        // Haptic feedback if available
        if (navigator.vibrate) {
          navigator.vibrate(50);
        }
      }, LONG_PRESS_DELAY);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    // Cancel long press if user moves
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    // Cancel long press
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }

    if (!touchStart) return;

    if (!e.changedTouches || e.changedTouches.length === 0) {
      setTouchStart(null);
      return;
    }
    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - touchStart.x;
    const deltaY = touch.clientY - touchStart.y;
    const deltaTime = Date.now() - touchStart.time;

    // Detect double tap
    if (deltaTime < 200 && Math.abs(deltaX) < 10 && Math.abs(deltaY) < 10) {
      if (Date.now() - lastTap < DOUBLE_TAP_DELAY && onDoubleTap) {
        onDoubleTap();
        // Haptic feedback
        if (navigator.vibrate) {
          navigator.vibrate([20, 10, 20]);
        }
        setLastTap(0);
        setTouchStart(null);
        return;
      }
      setLastTap(Date.now());
    }

    // Detect swipe (prioritize horizontal over vertical)
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      // Horizontal swipe
      if (Math.abs(deltaX) > SWIPE_THRESHOLD) {
        if (deltaX > 0 && onSwipeRight) {
          onSwipeRight();
          if (navigator.vibrate) navigator.vibrate(20);
        } else if (deltaX < 0 && onSwipeLeft) {
          onSwipeLeft();
          if (navigator.vibrate) navigator.vibrate(20);
        }
      }
    } else {
      // Vertical swipe
      if (Math.abs(deltaY) > SWIPE_THRESHOLD) {
        if (deltaY < 0 && onSwipeUp) {
          onSwipeUp();
          if (navigator.vibrate) navigator.vibrate(30);
        } else if (deltaY > 0 && onSwipeDown) {
          onSwipeDown();
          if (navigator.vibrate) navigator.vibrate(30);
        }
      }
    }

    setTouchStart(null);
  };

  return (
    <div
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{
        touchAction: 'none',
        userSelect: 'none',
        width: '100%',
        height: '100%'
      }}
    >
      {children}
    </div>
  );
};

interface MobileTagActionsProps {
  tagId: string;
  tagName: string;
  verified: boolean;
  onVerify: (tagId: string) => void;
  onReject: (tagId: string) => void;
  onLike?: (tagId: string) => void;
  onDislike?: (tagId: string) => void;
}

/**
 * Mobile-optimized tag action buttons
 * Swipe left/right to approve/reject
 */
export const MobileTagActions: React.FC<MobileTagActionsProps> = ({
  tagId,
  tagName,
  verified,
  onVerify,
  onReject,
  onLike,
  onDislike
}) => {
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [action, setAction] = useState<'verify' | 'reject' | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStart(e.touches[0].clientX);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStart === null) return;
    
    const currentX = e.touches[0].clientX;
    const offset = currentX - touchStart;
    setSwipeOffset(offset);

    // Show action preview
    if (offset > 80) {
      setAction('verify');
    } else if (offset < -80) {
      setAction('reject');
    } else {
      setAction(null);
    }
  };

  const handleTouchEnd = () => {
    if (swipeOffset > 100) {
      onVerify(tagId);
      if (navigator.vibrate) navigator.vibrate([30, 10, 30]);
    } else if (swipeOffset < -100) {
      onReject(tagId);
      if (navigator.vibrate) navigator.vibrate(50);
    }
    
    setSwipeOffset(0);
    setTouchStart(null);
    setAction(null);
  };

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{
        position: 'relative',
        overflow: 'hidden',
        background: '#ffffff',
        border: '1px solid #808080',
        marginBottom: '4px'
      }}
    >
      {/* Background action indicators */}
      {action === 'verify' && (
        <div style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: '100%',
          background: '#008000',
          display: 'flex',
          alignItems: 'center',
          paddingLeft: '8px',
          color: '#ffffff',
          fontSize: '11px',
          fontFamily: '"MS Sans Serif", sans-serif'
        }}>
          VERIFY →
        </div>
      )}
      {action === 'reject' && (
        <div style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: '100%',
          background: '#ff0000',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          paddingRight: '8px',
          color: '#ffffff',
          fontSize: '11px',
          fontFamily: '"MS Sans Serif", sans-serif'
        }}>
          ← REJECT
        </div>
      )}

      {/* Tag content that swipes */}
      <div
        style={{
          transform: `translateX(${swipeOffset}px)`,
          transition: touchStart === null ? 'transform 0.2s ease' : 'none',
          background: verified ? '#c0c0c0' : '#ffffff',
          padding: '8px',
          position: 'relative',
          zIndex: 1
        }}
      >
        <div style={{ 
          fontWeight: 'bold', 
          color: '#000000',
          fontSize: '11px',
          fontFamily: '"MS Sans Serif", sans-serif'
        }}>
          {tagName}
        </div>
      </div>
    </div>
  );
};

/**
 * Mobile floating action buttons for quick interactions
 */
interface MobileFloatingActionsProps {
  onLike: () => void;
  onSave: () => void;
  onDislike: () => void;
  liked?: boolean;
  saved?: boolean;
  disliked?: boolean;
}

export const MobileFloatingActions: React.FC<MobileFloatingActionsProps> = ({
  onLike,
  onSave,
  onDislike,
  liked = false,
  saved = false,
  disliked = false
}) => {
  return (
    <div style={{
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      zIndex: 10003
    }}>
      {/* Like Button */}
      <button
        onClick={() => {
          onLike();
          if (navigator.vibrate) navigator.vibrate(20);
        }}
        style={{
          width: '48px',
          height: '48px',
          background: liked ? '#008000' : '#c0c0c0',
          color: liked ? '#ffffff' : '#000000',
          border: liked ? '2px inset #808080' : '2px outset #ffffff',
          fontSize: '20px',
          cursor: 'pointer',
          fontFamily: '"MS Sans Serif", sans-serif'
        }}
      >
        ♥
      </button>

      {/* Save Button */}
      <button
        onClick={() => {
          onSave();
          if (navigator.vibrate) navigator.vibrate(20);
        }}
        style={{
          width: '48px',
          height: '48px',
          background: saved ? '#000080' : '#c0c0c0',
          color: saved ? '#ffffff' : '#000000',
          border: saved ? '2px inset #808080' : '2px outset #ffffff',
          fontSize: '16px',
          cursor: 'pointer',
          fontFamily: '"MS Sans Serif", sans-serif'
        }}
      >
        ★
      </button>

      {/* Dislike Button */}
      <button
        onClick={() => {
          onDislike();
          if (navigator.vibrate) navigator.vibrate(40);
        }}
        style={{
          width: '48px',
          height: '48px',
          background: disliked ? '#ff0000' : '#c0c0c0',
          color: disliked ? '#ffffff' : '#000000',
          border: disliked ? '2px inset #808080' : '2px outset #ffffff',
          fontSize: '20px',
          cursor: 'pointer',
          fontFamily: '"MS Sans Serif", sans-serif'
        }}
      >
        ✕
      </button>
    </div>
  );
};

