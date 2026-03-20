import React, { useState, useRef, useEffect, useCallback } from 'react';

/**
 * MicroPortal — click-triggered floating panel for data point deep-dives.
 *
 * Wraps any data point (year, price, mileage, etc.) and shows a contextual
 * popup on click. Viewport-aware positioning, only one open at a time within
 * a parent VehicleHoverCard via the `activePortal` / `onOpen` contract.
 */

export interface MicroPortalProps {
  /** Unique id for this portal within the card */
  portalId: string;
  /** Which portal is currently active (only one at a time) */
  activePortal: string | null;
  /** Called when this portal wants to open */
  onOpen: (id: string | null) => void;
  /** The clickable trigger element */
  trigger: React.ReactNode;
  /** Portal panel content */
  children: React.ReactNode;
  /** Panel width */
  width?: number;
  /** Disable interaction (render trigger only) */
  disabled?: boolean;
}

export default function MicroPortal({
  portalId,
  activePortal,
  onOpen,
  trigger,
  children,
  width = 280,
  disabled = false,
}: MicroPortalProps) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, placement: 'below' as 'below' | 'above' });
  const isOpen = activePortal === portalId;

  // Calculate position relative to trigger
  const recalcPosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = rect.left;
    let top = rect.bottom + 6;
    let placement: 'below' | 'above' = 'below';

    // Flip above if not enough room below
    if (top + 240 > vh && rect.top > 260) {
      top = rect.top - 6;
      placement = 'above';
    }

    // Clamp horizontally
    if (left + width + 12 > vw) left = vw - width - 16;
    if (left < 8) left = 8;

    setPos({ top, left, placement });
  }, [width]);

  // Recalc on open
  useEffect(() => {
    if (isOpen) recalcPosition();
  }, [isOpen, recalcPosition]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpen(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onOpen]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const onClick = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        onOpen(null);
      }
    };
    // Delay to avoid capturing the opening click
    const timer = setTimeout(() => document.addEventListener('mousedown', onClick), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', onClick);
    };
  }, [isOpen, onOpen]);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    onOpen(isOpen ? null : portalId);
  };

  return (
    <>
      <span
        ref={triggerRef}
        onClick={handleClick}
        role="button"
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClick(e as any); }}
        style={{
          cursor: disabled ? 'default' : 'pointer',
          borderBottom: disabled ? 'none' : '1px dotted var(--text-muted, #9ca3af)',
          transition: 'border-color 0.15s',
          ...(isOpen ? { borderBottomColor: 'var(--primary, #3b82f6)' } : {}),
        }}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
      >
        {trigger}
      </span>

      {isOpen && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={`${portalId} details`}
          style={{
            position: 'fixed',
            left: pos.left,
            ...(pos.placement === 'below'
              ? { top: pos.top }
              : { bottom: window.innerHeight - pos.top }),
            zIndex: 10002,
            width: `${width}px`,
            maxHeight: '320px',
            overflowY: 'auto',
            background: 'var(--bg, #fff)',
            border: '1px solid var(--border, #e5e7eb)', fontSize: '12px',
            animation: 'microPortalAppear 0.12s ease',
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      )}
    </>
  );
}
