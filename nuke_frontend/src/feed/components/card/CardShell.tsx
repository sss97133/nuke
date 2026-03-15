/**
 * CardShell — Outer wrapper for feed vehicle cards.
 *
 * Handles:
 * - Link navigation to /vehicle/:id
 * - Hover state (border highlight, 200ms delay for hover card)
 * - Mobile long-press (500ms)
 * - View mode layout switching
 */

import { useCallback, useRef, type ReactNode, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';

export interface CardShellProps {
  vehicleId: string;
  viewMode: 'grid' | 'gallery' | 'technical';
  children: ReactNode;
  style?: CSSProperties;
  onHoverStart?: (rect: DOMRect) => void;
  onHoverEnd?: () => void;
}

export function CardShell({
  vehicleId,
  viewMode,
  children,
  style,
  onHoverStart,
  onHoverEnd,
}: CardShellProps) {
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      // Border highlight
      e.currentTarget.style.borderColor = 'var(--border-focus)';
      // Hover card with 200ms delay
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
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      e.currentTarget.style.borderColor = 'var(--border)';
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
      onHoverEnd?.();
    },
    [onHoverEnd],
  );

  const baseStyle: CSSProperties =
    viewMode === 'grid'
      ? {
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--surface)',
          border: '2px solid var(--border)',
          overflow: 'hidden',
          textDecoration: 'none',
          color: 'inherit',
          transition: 'border-color 180ms cubic-bezier(0.16, 1, 0.3, 1)',
        }
      : viewMode === 'gallery'
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
            // technical / table row handled by parent
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
