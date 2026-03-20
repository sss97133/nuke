/**
 * HEADER POPOVER
 *
 * Shared popover wrapper for all vehicle header badge popups.
 * Desktop: absolute dropdown below trigger
 * Mobile: fixed bottom sheet
 */

import React, { useRef, useEffect } from 'react';
import { useIsMobile } from '../../hooks/useIsMobile';

interface HeaderPopoverProps {
  open: boolean;
  onClose: () => void;
  title: string;
  width?: number;
  children: React.ReactNode;
  align?: 'left' | 'right' | 'center';
}

export const HeaderPopover: React.FC<HeaderPopoverProps> = ({
  open,
  onClose,
  title,
  width = 320,
  children,
  align = 'left',
}) => {
  const isMobile = useIsMobile();
  const ref = useRef<HTMLDivElement>(null);

  // Click outside dismissal
  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open, onClose]);

  // Escape key dismissal
  useEffect(() => {
    if (!open) return;
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [open, onClose]);

  if (!open) return null;

  // Mobile: bottom sheet
  if (isMobile) {
    return (
      <>
        {/* Backdrop */}
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            zIndex: 999,
          }}
          onClick={onClose}
        />
        <div
          ref={ref}
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 1000,
            background: 'var(--bg)',
            borderTop: '2px solid var(--border)', maxHeight: '70vh',
            overflowY: 'auto', }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px 16px',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <span style={{ fontWeight: 700, fontSize: '13px' }}>{title}</span>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontSize: '19px',
                color: 'var(--text-muted)',
                lineHeight: 1,
                padding: '0 4px',
              }}
            >
              ×
            </button>
          </div>
          <div style={{ padding: '12px 16px', fontSize: '11px' }}>{children}</div>
        </div>
      </>
    );
  }

  // Desktop: absolute dropdown
  const alignStyle: React.CSSProperties =
    align === 'right'
      ? { right: 0 }
      : align === 'center'
        ? { left: '50%', transform: 'translateX(-50%)' }
        : { left: 0 };

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        top: '100%',
        marginTop: 4,
        zIndex: 1000,
        background: 'var(--bg)',
        border: '2px solid var(--border)', width,
        ...alignStyle,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 12px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <span style={{ fontWeight: 700, fontSize: '12px' }}>{title}</span>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            fontSize: '16px',
            color: 'var(--text-muted)',
            lineHeight: 1,
            padding: '0 4px',
          }}
        >
          ×
        </button>
      </div>
      <div style={{ padding: '12px', fontSize: '11px' }}>{children}</div>
    </div>
  );
};
