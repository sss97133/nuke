import React, { useState, useRef, useEffect, useCallback } from 'react';

/**
 * HoverCard — universal hover preview component.
 * 300ms delay, viewport-aware positioning, pointer-events passthrough.
 *
 * Usage:
 *   <HoverCard content={<div>Preview content</div>}>
 *     <span>Hover me</span>
 *   </HoverCard>
 */

interface HoverCardProps {
  children: React.ReactNode;
  content: React.ReactNode;
  width?: number;
  delay?: number;
  disabled?: boolean;
}

export default function HoverCard({ children, content, width = 300, delay = 300, disabled = false }: HoverCardProps) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLSpanElement>(null);

  const handleEnter = useCallback(() => {
    if (disabled) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = rect.left;
      let top = rect.bottom + 6;
      if (left + width + 12 > vw) left = vw - width - 16;
      if (left < 8) left = 8;
      if (top + 200 > vh) top = rect.top - 210;
      if (top < 8) top = 8;
      setPos({ top, left });
    }
    timeoutRef.current = setTimeout(() => setShow(true), delay);
  }, [disabled, width, delay]);

  const handleLeave = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setShow(false);
  }, []);

  useEffect(() => {
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, []);

  return (
    <span
      ref={containerRef}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      style={{ position: 'relative' }}
    >
      {children}
      {show && (
        <div
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            zIndex: 10001,
            width: `${width}px`,
            background: 'var(--bg, #fff)',
            border: '2px solid var(--border)', pointerEvents: 'none',
            overflow: 'hidden',
            fontSize: '12px',
          }}
        >
          {content}
        </div>
      )}
    </span>
  );
}

/** Mini stat row for hover cards */
export function HoverStat({ label, value, color }: { label: string; value: any; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 0', fontSize: '11px' }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontWeight: 700, color: color || 'var(--text)' }}>{value}</span>
    </div>
  );
}
