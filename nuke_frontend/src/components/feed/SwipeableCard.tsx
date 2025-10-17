import React, { useRef, useState } from 'react';

interface SwipeableCardProps {
  onSwipeLeft?: () => Promise<void> | void;   // e.g., skip / dislike
  onSwipeRight?: () => Promise<void> | void;  // e.g., save / like
  children: React.ReactNode;
}

const SWIPE_THRESHOLD = 60; // pixels

const SwipeableCard: React.FC<SwipeableCardProps> = ({ onSwipeLeft, onSwipeRight, children }) => {
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const [offsetX, setOffsetX] = useState(0);
  const [status, setStatus] = useState<'saved' | 'skipped' | null>(null);
  const blockClickRef = useRef(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY };
    setStatus(null);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const t = e.touches[0];
    const dx = t.clientX - touchStartRef.current.x;
    const dy = t.clientY - touchStartRef.current.y;
    // Horizontal intent only when horizontal displacement dominates
    if (Math.abs(dx) > Math.abs(dy)) {
      setOffsetX(dx);
    }
  };

  const handleTouchEnd = async () => {
    if (!touchStartRef.current) return;
    const dx = offsetX;
    setOffsetX(0);
    touchStartRef.current = null;

    if (Math.abs(dx) < SWIPE_THRESHOLD) return;

    try {
      if (dx > 0 && onSwipeRight) {
        await onSwipeRight();
        setStatus('saved');
        if (navigator.vibrate) navigator.vibrate(20);
        blockClickRef.current = true;
      } else if (dx < 0 && onSwipeLeft) {
        await onSwipeLeft();
        setStatus('skipped');
        if (navigator.vibrate) navigator.vibrate(15);
        blockClickRef.current = true;
      }
      // Hide status after a short delay
      setTimeout(() => setStatus(null), 900);
      setTimeout(() => { blockClickRef.current = false; }, 350);
    } catch {
      // ignore
    }
  };

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onClickCapture={(e) => { if (blockClickRef.current) { e.preventDefault(); e.stopPropagation(); } }}
      style={{ position: 'relative' }}
    >
      {/* Background indicators */}
      {offsetX !== 0 && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: offsetX > 0 ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
            pointerEvents: 'none',
            zIndex: 0
          }}
        />
      )}

      {/* Foreground content with swipe transform */}
      <div
        style={{
          transform: `translateX(${offsetX}px)`,
          transition: touchStartRef.current ? 'none' : 'transform 0.15s ease-out',
          position: 'relative',
          zIndex: 1
        }}
      >
        {children}
      </div>

      {/* Status badge */}
      {status && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            padding: '2px 6px',
            fontSize: '10px',
            borderRadius: 4,
            background: status === 'saved' ? '#10b981' : '#ef4444',
            color: '#fff',
            border: '1px solid rgba(0,0,0,0.2)',
            zIndex: 2
          }}
        >
          {status === 'saved' ? 'Saved' : 'Skipped'}
        </div>
      )}
    </div>
  );
};

export default SwipeableCard;
