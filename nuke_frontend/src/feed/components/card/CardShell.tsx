/**
 * CardShell — Outer wrapper for feed vehicle cards.
 *
 * Zero click anxiety: single click opens a centered popup overlay.
 * Navigation to the vehicle profile requires an explicit action
 * (the "OPEN PROFILE" button or Cmd/Ctrl+click).
 *
 * Grid mode: click opens popup with vehicle details.
 * Gallery/Technical: click navigates (these are compact modes).
 *
 * The grid does NOT reflow on click. Popup renders via portal.
 */

import { useCallback, useRef, useState, useEffect, type ReactNode, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useViewHistory } from '../../../hooks/useViewHistory';

export interface CardShellProps {
  vehicleId: string;
  viewMode: 'grid' | 'gallery' | 'technical';
  children: ReactNode;
  /** Content shown inside the popup (grid mode only) */
  expandedContent?: ReactNode;
  /** Card thumbnail URL for popup hero image */
  popupImageUrl?: string | null;
  /** Card title for popup header */
  popupTitle?: string;
  /** Card price text for popup */
  popupPrice?: string;
  /** Numeric display price — stored in view history for price-drop detection */
  displayPrice?: number | null;
  style?: CSSProperties;
  onHoverStart?: (rect: DOMRect) => void;
  onHoverEnd?: () => void;
  /** If provided, called on click instead of internal popup (popup rhizome) */
  onCardClick?: () => void;
}

export function CardShell({
  vehicleId,
  viewMode,
  children,
  expandedContent,
  popupImageUrl,
  popupTitle,
  popupPrice,
  displayPrice,
  style,
  onHoverStart,
  onHoverEnd,
  onCardClick,
}: CardShellProps) {
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [popupOpen, setPopupOpen] = useState(false);
  const { recordView } = useViewHistory();

  // Close popup on Escape
  useEffect(() => {
    if (!popupOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPopupOpen(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [popupOpen]);

  // Lock body scroll when popup open
  useEffect(() => {
    if (!popupOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [popupOpen]);

  const handleMouseEnter = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      e.currentTarget.style.borderColor = 'var(--border-focus, var(--text))';
      if (onHoverStart) {
        hoverTimerRef.current = setTimeout(() => {
          const rect = e.currentTarget.getBoundingClientRect();
          onHoverStart(rect);
        }, 200);
      }
    },
    [onHoverStart],
  );

  const handleMouseLeave = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      e.currentTarget.style.borderColor = 'var(--border)';
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
      onHoverEnd?.();
    },
    [onHoverEnd],
  );

  // Grid mode: click opens popup. Cmd/Ctrl+click navigates.
  const handleGridClick = useCallback(
    (e: React.MouseEvent) => {
      // Don't intercept clicks on links, buttons, or badge portals inside the card
      const target = e.target as HTMLElement;
      if (target.closest('a') || target.closest('button') || target.closest('[role="button"]')) {
        return;
      }

      // Cmd/Ctrl+click -> navigate in new tab
      if (e.metaKey || e.ctrlKey) {
        window.open(`/vehicle/${vehicleId}`, '_blank');
        return;
      }

      e.preventDefault();

      // Popup rhizome: if onCardClick is provided, use it instead of internal popup
      if (onCardClick) {
        onCardClick();
        return;
      }

      recordView(vehicleId, 'feed', displayPrice);
      setPopupOpen(true);
    },
    [vehicleId, displayPrice],
  );

  // Gallery / Technical modes: use Link
  if (viewMode !== 'grid') {
    const baseStyle: CSSProperties =
      viewMode === 'gallery'
        ? {
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: '12px',
            padding: '6px 8px',
            background: 'var(--surface)',
            border: '2px solid var(--border)',
            textDecoration: 'none',
            color: 'inherit',
            transition: 'border-color 180ms cubic-bezier(0.16, 1, 0.3, 1)',
            marginBottom: '1px',
          }
        : {
            display: 'contents',
            textDecoration: 'none',
            color: 'inherit',
          };

    return (
      <Link
        to={`/vehicle/${vehicleId}`}
        state={{ fromFeed: true }}
        style={{ ...baseStyle, ...style }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {children}
      </Link>
    );
  }

  // Grid mode: card stays in place, popup overlays screen center
  return (
    <>
      <div
        role="article"
        style={{
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--surface)',
          border: '2px solid var(--border)',
          overflow: 'hidden',
          height: '100%',
          position: 'relative',
          cursor: 'pointer',
          transition: 'border-color 180ms cubic-bezier(0.16, 1, 0.3, 1)',
          ...style,
        }}
        onClick={handleGridClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {children}
      </div>

      {/* Popup portal — rendered at document root so it's above everything */}
      {popupOpen && createPortal(
        <VehiclePopupOverlay
          vehicleId={vehicleId}
          imageUrl={popupImageUrl}
          title={popupTitle}
          price={popupPrice}
          expandedContent={expandedContent}
          onClose={() => setPopupOpen(false)}
        />,
        document.body,
      )}
    </>
  );
}

/* ─── Vehicle Popup Overlay ─── */

function VehiclePopupOverlay({
  vehicleId,
  imageUrl,
  title,
  price,
  expandedContent,
  onClose,
}: {
  vehicleId: string;
  imageUrl?: string | null;
  title?: string;
  price?: string;
  expandedContent?: ReactNode;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on click outside the popup panel
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    },
    [onClose],
  );

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.3)',
        animation: 'fadeIn180 180ms ease-out',
      }}
      onClick={handleOverlayClick}
    >
      <div
        ref={panelRef}
        style={{
          width: '460px',
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: 'calc(100vh - 48px)',
          overflowY: 'auto',
          background: '#fff',
          border: '2px solid var(--text, #1a1a1a)',
          borderRadius: 0,
          boxShadow: 'none',
          animation: 'fadeIn180 180ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Hero image */}
        {imageUrl && (
          <div style={{
            width: '100%',
            paddingTop: '66.67%',
            position: 'relative',
            background: 'var(--surface-hover, #f5f5f5)',
            borderBottom: '2px solid var(--border, #e0e0e0)',
          }}>
            <img
              src={imageUrl}
              alt={title || 'Vehicle'}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
              }}
            />
          </div>
        )}

        {/* Header: title + price */}
        <div style={{
          padding: '10px 12px 8px',
          borderBottom: '1px solid var(--border, #e0e0e0)',
        }}>
          {title && (
            <div style={{
              fontFamily: 'Arial, sans-serif',
              fontSize: '13px',
              fontWeight: 700,
              textTransform: 'uppercase' as const,
              letterSpacing: '0.02em',
              lineHeight: 1.3,
              color: 'var(--text, #1a1a1a)',
              marginBottom: price ? '4px' : 0,
            }}>
              {title}
            </div>
          )}
          {price && (
            <div style={{
              fontFamily: "'Courier New', monospace",
              fontSize: '14px',
              fontWeight: 700,
              color: 'var(--text, #1a1a1a)',
              lineHeight: 1,
            }}>
              {price}
            </div>
          )}
        </div>

        {/* Expanded detail content */}
        {expandedContent && (
          <div style={{ padding: '8px 12px' }}>
            {expandedContent}
          </div>
        )}

        {/* Footer: OPEN PROFILE button */}
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          padding: '8px 12px 10px',
          borderTop: '1px solid var(--border, #e0e0e0)',
        }}>
          <Link
            to={`/vehicle/${vehicleId}`}
            state={{ fromFeed: true }}
            onClick={(e) => e.stopPropagation()}
            style={{
              fontFamily: 'Arial, sans-serif',
              fontSize: '9px',
              fontWeight: 800,
              textTransform: 'uppercase' as const,
              letterSpacing: '0.3px',
              padding: '4px 14px',
              border: '2px solid var(--text, #1a1a1a)',
              background: 'var(--text, #1a1a1a)',
              color: '#fff',
              textDecoration: 'none',
              cursor: 'pointer',
              transition: 'opacity 180ms cubic-bezier(0.16, 1, 0.3, 1)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.8'; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
          >
            OPEN PROFILE
          </Link>
        </div>
      </div>
    </div>
  );
}
