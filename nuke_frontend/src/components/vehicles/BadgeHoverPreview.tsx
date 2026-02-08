import React, { useState, useEffect, useRef, useCallback } from 'react';

interface BadgeHoverPreviewProps {
  badgeRect: DOMRect | null;
  children: React.ReactNode;
}

const BadgeHoverPreview: React.FC<BadgeHoverPreviewProps> = ({ badgeRect, children }) => {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!badgeRect || !tooltipRef.current) return;
    const tooltip = tooltipRef.current;
    const rect = tooltip.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top = badgeRect.bottom + 6;
    let left = badgeRect.left + badgeRect.width / 2 - rect.width / 2;

    // Keep within viewport
    if (left < 8) left = 8;
    if (left + rect.width > vw - 8) left = vw - 8 - rect.width;
    if (top + rect.height > vh - 8) top = badgeRect.top - rect.height - 6;

    setPosition({ top, left });
  }, [badgeRect]);

  if (!badgeRect) return null;

  return (
    <div
      ref={tooltipRef}
      style={{
        position: 'fixed',
        top: position?.top ?? -9999,
        left: position?.left ?? -9999,
        zIndex: 10000,
        pointerEvents: 'none',
        background: 'rgba(15,15,15,0.95)',
        backdropFilter: 'blur(8px)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: '6px',
        padding: '8px 10px',
        color: 'white',
        fontSize: '8pt',
        lineHeight: 1.5,
        maxWidth: '240px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        opacity: position ? 1 : 0,
        transition: 'opacity 0.1s ease-in',
      }}
    >
      {children}
    </div>
  );
};

// Hook for managing badge hover state with debounce
export function useBadgeHover(debounceMs = 150) {
  const [hoveredBadge, setHoveredBadge] = useState<string | null>(null);
  const [badgeRect, setBadgeRect] = useState<DOMRect | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onBadgeEnter = useCallback((badgeType: string, e: React.MouseEvent) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setHoveredBadge(badgeType);
      setBadgeRect((e.currentTarget as HTMLElement).getBoundingClientRect());
    }, debounceMs);
  }, [debounceMs]);

  const onBadgeLeave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setHoveredBadge(null);
    setBadgeRect(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { hoveredBadge, badgeRect, onBadgeEnter, onBadgeLeave };
}

export default BadgeHoverPreview;
