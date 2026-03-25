/**
 * CardShell — Outer wrapper for feed vehicle cards.
 *
 * Zero click anxiety: single click expands the card in-place.
 * Navigation to the vehicle profile requires an explicit action
 * (the "OPEN" link or Cmd/Ctrl+click).
 *
 * Grid mode: click expands/collapses inline detail view.
 * Gallery/Technical: click navigates (these are compact modes where
 * inline expansion doesn't make sense).
 */

import { useCallback, useRef, useState, useEffect, type ReactNode, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';

export interface CardShellProps {
  vehicleId: string;
  viewMode: 'grid' | 'gallery' | 'technical';
  children: ReactNode;
  /** Content shown when card is expanded (grid mode only) */
  expandedContent?: ReactNode;
  style?: CSSProperties;
  onHoverStart?: (rect: DOMRect) => void;
  onHoverEnd?: () => void;
  /** If provided, called on click instead of default expand behavior (popup rhizome) */
  onCardClick?: () => void;
}

export function CardShell({
  vehicleId,
  viewMode,
  children,
  expandedContent,
  style,
  onHoverStart,
  onHoverEnd,
}: CardShellProps) {
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [expanded, setExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Collapse on Escape
  useEffect(() => {
    if (!expanded) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setExpanded(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [expanded]);

  // Collapse on click outside
  useEffect(() => {
    if (!expanded) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    const raf = requestAnimationFrame(() => {
      document.addEventListener('mousedown', handler);
    });
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('mousedown', handler);
    };
  }, [expanded]);

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
      if (!expanded) {
        e.currentTarget.style.borderColor = 'var(--border)';
      }
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
      onHoverEnd?.();
    },
    [onHoverEnd, expanded],
  );

  // Grid mode: click toggles expand. Cmd/Ctrl+click navigates.
  const handleGridClick = useCallback(
    (e: React.MouseEvent) => {
      // Don't intercept clicks on links, buttons, or badge portals inside the card
      const target = e.target as HTMLElement;
      if (target.closest('a') || target.closest('button') || target.closest('[role="button"]')) {
        return;
      }

      // Cmd/Ctrl+click → navigate in new tab behavior (let browser handle)
      if (e.metaKey || e.ctrlKey) {
        window.open(`/vehicle/${vehicleId}`, '_blank');
        return;
      }

      e.preventDefault();
      setExpanded((prev) => !prev);
    },
    [vehicleId],
  );

  // Gallery / Technical modes: use Link (these are compact, expansion doesn't fit)
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

  // Grid mode: div with click-to-expand.
  // Expanded content is absolutely positioned so it overlays subsequent rows
  // instead of pushing them down. The card stays in its grid cell at fixed height.
  return (
    <div
      ref={containerRef}
      role="article"
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--surface)',
        border: `2px solid ${expanded ? 'var(--text)' : 'var(--border)'}`,
        overflow: expanded ? 'visible' : 'hidden',
        height: '100%',
        position: 'relative',
        zIndex: expanded ? 10 : undefined,
        cursor: 'pointer',
        transition: 'border-color 180ms cubic-bezier(0.16, 1, 0.3, 1)',
        ...style,
      }}
      onClick={handleGridClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}

      {/* Expanded detail view — absolutely positioned, overlays below the card */}
      {expanded && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: '-2px',
            right: '-2px',
            border: '2px solid var(--text)',
            borderTop: '2px solid var(--border)',
            background: 'var(--bg)',
            padding: '8px',
            animation: 'fadeIn180 180ms ease-out',
            zIndex: 10,
          }}
        >
          {/* Custom expanded content (badges, specs) */}
          {expandedContent}

          {/* OPEN PROFILE footer — always renders */}
          <div style={{
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            marginTop: expandedContent ? '8px' : 0,
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
                padding: '3px 10px',
                border: '2px solid var(--text)',
                background: 'var(--text)',
                color: 'var(--surface)',
                textDecoration: 'none',
                cursor: 'pointer',
                transition: 'opacity 180ms cubic-bezier(0.16, 1, 0.3, 1)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.8'; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
            >
              OPEN PROFILE →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
