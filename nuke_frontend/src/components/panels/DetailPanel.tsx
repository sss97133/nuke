/**
 * DetailPanel — Slide-in overlay panel for vehicle detail.
 *
 * Context stacking, not context switching: the panel slides in from the right,
 * the feed stays visible underneath. Escape or click the backdrop to close.
 * The user never loses their scroll position.
 */

import React, { useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';

export interface DetailPanelProps {
  vehicleId: string;
  isOpen: boolean;
  onClose: () => void;
  children?: React.ReactNode;
}

export function DetailPanel({ vehicleId, isOpen, onClose, children }: DetailPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  // Prevent body scroll when panel is open
  useEffect(() => {
    if (isOpen) {
      const scrollY = window.scrollY;
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.width = '100%';
      return () => {
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.width = '';
        window.scrollTo(0, scrollY);
      };
    }
  }, [isOpen]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 900,
        display: 'flex',
        justifyContent: 'flex-end',
      }}
      onClick={handleBackdropClick}
    >
      {/* Backdrop — semi-transparent, shows feed underneath */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.25)',
          transition: 'opacity 180ms ease',
        }}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        style={{
          position: 'relative',
          width: '560px',
          maxWidth: '90vw',
          height: '100vh',
          background: 'var(--surface)',
          borderLeft: '2px solid var(--text)',
          overflowY: 'auto',
          animation: 'slideInRight 180ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Panel header */}
        <div style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 12px',
          borderBottom: '2px solid var(--border)',
          background: 'var(--surface)',
        }}>
          <Link
            to={`/vehicle/${vehicleId}`}
            style={{
              fontFamily: 'Arial, sans-serif',
              fontSize: '9px',
              fontWeight: 800,
              textTransform: 'uppercase' as const,
              letterSpacing: '0.3px',
              color: 'var(--text)',
              textDecoration: 'none',
            }}
          >
            OPEN FULL PROFILE →
          </Link>
          <button
            type="button"
            onClick={onClose}
            style={{
              fontFamily: 'Arial, sans-serif',
              fontSize: '9px',
              fontWeight: 700,
              textTransform: 'uppercase' as const,
              letterSpacing: '0.3px',
              padding: '2px 8px',
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            ESC
          </button>
        </div>

        {/* Panel content */}
        {children || (
          <div style={{
            padding: '24px 12px',
            fontFamily: 'Arial, sans-serif',
            fontSize: '9px',
            color: 'var(--text-disabled)',
            textAlign: 'center',
            textTransform: 'uppercase' as const,
            letterSpacing: '0.5px',
          }}>
            LOADING VEHICLE DATA...
          </div>
        )}
      </div>

      {/* Animation keyframes */}
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </div>,
    document.body,
  );
}
