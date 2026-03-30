/**
 * CardImage — Vehicle thumbnail with optional overlays.
 *
 * When no image is available, renders a data block with vehicle specs
 * instead of a useless dark placeholder.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import ResilientImage from '../../../components/images/ResilientImage';

export interface CardImageProps {
  thumbnailUrl: string | null;
  alt: string;
  viewMode: 'grid' | 'gallery' | 'technical';
  fit?: 'cover' | 'contain';
  children?: ReactNode;
  /** Data to show when no image available */
  noImageData?: {
    year?: number | null;
    make?: string | null;
    model?: string | null;
    mileage?: number | null;
    transmission?: string | null;
    drivetrain?: string | null;
    bodyStyle?: string | null;
    price?: string | null;
  };
}

const ASPECT: Record<string, CSSProperties> = {
  grid: { width: '100%', paddingTop: '75%', position: 'relative' }, // 4:3
  gallery: {
    width: '72px',
    height: '72px',
    flexShrink: 0,
    position: 'relative',
  },
  technical: {
    width: '48px',
    height: '36px',
    flexShrink: 0,
    position: 'relative',
  },
};

function NoImageBlock({ data, viewMode }: { data: CardImageProps['noImageData']; viewMode: string }) {
  if (!data || viewMode !== 'grid') {
    return (
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'Arial, sans-serif', fontSize: '9px',
        color: 'var(--text-disabled)', textTransform: 'uppercase',
        letterSpacing: '1px',
      }}>
        NO IMAGE
      </div>
    );
  }

  const specs: string[] = [];
  if (data.bodyStyle) specs.push(data.bodyStyle);
  if (data.transmission) {
    const t = data.transmission.toLowerCase();
    if (t.includes('manual')) specs.push('MANUAL');
    else if (t.includes('auto')) specs.push('AUTO');
    else specs.push(data.transmission.slice(0, 15).toUpperCase());
  }
  if (data.drivetrain) {
    const d = data.drivetrain.toUpperCase();
    if (d.includes('4WD') || d.includes('4X4')) specs.push('4WD');
    else if (d.includes('AWD')) specs.push('AWD');
    else if (d.includes('RWD')) specs.push('RWD');
    else if (d.includes('FWD')) specs.push('FWD');
  }
  if (data.mileage && data.mileage > 0) specs.push(`${Math.floor(data.mileage).toLocaleString()} MI`);

  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'flex', flexDirection: 'column',
      justifyContent: 'center', alignItems: 'center',
      gap: '6px', padding: '12px',
      background: 'var(--surface)',
      border: '2px solid var(--border)',
    }}>
      {/* Vehicle name */}
      <div style={{
        fontFamily: 'Arial, sans-serif', fontSize: 'var(--feed-font-size, 10px)', fontWeight: 700,
        color: 'var(--text-secondary)', textTransform: 'uppercase',
        textAlign: 'center', lineHeight: 1.3, letterSpacing: '0.3px',
      }}>
        {[data.year, data.make, data.model].filter(Boolean).join(' ') || 'VEHICLE'}
      </div>

      {/* Price if available */}
      {data.price && data.price !== '—' && (
        <div style={{
          fontFamily: "'Courier New', monospace", fontSize: 'var(--feed-font-size, 10px)', fontWeight: 800,
          color: 'var(--text)', textAlign: 'center',
        }}>
          {data.price}
        </div>
      )}

      {/* Spec chips */}
      {specs.length > 0 && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: '3px',
          justifyContent: 'center',
        }}>
          {specs.map((s, i) => (
            <span key={i} style={{
              fontFamily: "'Courier New', monospace", fontSize: 'var(--feed-font-size-sm, 8px)', fontWeight: 700,
              padding: '2px 5px', border: '1px solid var(--border)',
              color: 'var(--text-secondary)', textTransform: 'uppercase',
              letterSpacing: '0.3px',
            }}>
              {s}
            </span>
          ))}
        </div>
      )}

      {/* NO PHOTO label */}
      <div style={{
        fontFamily: 'Arial, sans-serif', fontSize: 'var(--feed-font-size-xs, 7px)',
        color: 'var(--text-disabled)', textTransform: 'uppercase',
        letterSpacing: '1.5px', marginTop: '4px',
      }}>
        NO PHOTO
      </div>
    </div>
  );
}

export function CardImage({
  thumbnailUrl,
  alt,
  viewMode,
  fit = 'cover',
  children,
  noImageData,
}: CardImageProps) {
  const hasImage = !!thumbnailUrl;
  const [hovered, setHovered] = useState(false);
  const [popupPos, setPopupPos] = useState<{ top: number; left: number; flipLeft: boolean } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Technical mode uses contain so cars aren't awkwardly cropped at 48x36
  const effectiveFit = viewMode === 'technical' ? 'contain' : fit;

  const handleMouseEnter = useCallback(() => {
    if (viewMode !== 'technical' || !hasImage) return;
    setHovered(true);
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const flipLeft = rect.right + 248 > window.innerWidth;
      setPopupPos({
        top: rect.top,
        left: flipLeft ? rect.left - 248 : rect.right + 8,
        flipLeft,
      });
    }
  }, [viewMode, hasImage]);

  const handleMouseLeave = useCallback(() => {
    setHovered(false);
    setPopupPos(null);
  }, []);

  // Dismiss on scroll (position goes stale)
  useEffect(() => {
    if (!hovered) return;
    const dismiss = () => { setHovered(false); setPopupPos(null); };
    window.addEventListener('scroll', dismiss, { passive: true, capture: true });
    return () => window.removeEventListener('scroll', dismiss, true);
  }, [hovered]);

  return (
    <div
      ref={containerRef}
      style={{
        ...ASPECT[viewMode],
        background: 'var(--surface-hover)',
        overflow: viewMode === 'technical' ? 'visible' : 'hidden',
        border: viewMode !== 'grid' ? '2px solid var(--border)' : undefined,
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {hasImage ? (
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
          <ResilientImage
            sources={[thumbnailUrl]}
            alt={alt}
            fill
            objectFit={effectiveFit}
            placeholderSrc="/nuke.png"
            placeholderOpacity={0.2}
            optimizeSize="small"
            loading="lazy"
          />
        </div>
      ) : (
        <NoImageBlock data={noImageData} viewMode={viewMode} />
      )}
      {/* Hover preview for technical (table) view — portaled to body */}
      {viewMode === 'technical' && hasImage && hovered && popupPos && createPortal(
        <div
          style={{
            position: 'fixed',
            top: popupPos.top,
            left: popupPos.left,
            width: 240,
            height: 180,
            zIndex: 10000,
            border: '2px solid var(--border)',
            background: 'var(--surface)',
            overflow: 'hidden',
            pointerEvents: 'none',
            opacity: 1,
            animation: 'fadeIn180 180ms ease-out',
          }}
        >
          <ResilientImage
            sources={[thumbnailUrl]}
            alt={alt}
            fill
            objectFit="cover"
            placeholderSrc="/nuke.png"
            placeholderOpacity={0.2}
            optimizeSize="small"
            loading="lazy"
          />
        </div>,
        document.body,
      )}
      {children}
    </div>
  );
}
