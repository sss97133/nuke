import React, { useRef, useEffect, useState, useMemo } from 'react';
import { optimizeImageUrl, type ImageSize } from '../../lib/imageOptimizer';

type ObjectFit = 'cover' | 'contain';

export interface ResilientImageProps {
  sources: Array<string | null | undefined>;
  alt: string;
  /** When true, the <img> is absolutely positioned to fill its container. */
  fill?: boolean;
  /** Applied to the wrapping <div>. */
  style?: React.CSSProperties;
  className?: string;
  /** Applied to the <img>. Ignored when `fill` is true (we still merge it). */
  imgStyle?: React.CSSProperties;
  objectFit?: ObjectFit;
  placeholderSrc?: string;
  placeholderOpacity?: number;
  /** Image optimization size. Defaults to 'small' for grid display. Set to 'full' to disable optimization. */
  optimizeSize?: ImageSize;
  /** Set to 'eager' for above-the-fold images. Default is 'lazy'. */
  loading?: 'lazy' | 'eager';
  /** Priority hint for fetch. Use 'high' for critical images. */
  fetchPriority?: 'high' | 'low' | 'auto';
}

function normalizeSources(sources: Array<string | null | undefined>, size: ImageSize): string[] {
  const out: string[] = [];
  for (const s of sources) {
    const v = typeof s === 'string' ? s.trim() : '';
    if (!v) continue;
    // Apply CDN optimization (BaT ?w=, Supabase render API, etc.)
    const optimized = optimizeImageUrl(v, size) || v;
    if (!out.includes(optimized)) out.push(optimized);
  }
  return out;
}

const DEFAULT_PLACEHOLDER = '/n-zero.png';

// Shared preload cache to avoid duplicate preloads
const preloadedUrls = new Set<string>();

// Preload an image URL (browser will cache it)
function preloadImage(url: string): void {
  if (!url || preloadedUrls.has(url)) return;
  preloadedUrls.add(url);
  const img = new Image();
  img.src = url;
}

const ResilientImage: React.FC<ResilientImageProps> = ({
  sources,
  alt,
  fill = true,
  style,
  className,
  imgStyle,
  objectFit = 'contain',
  placeholderSrc = DEFAULT_PLACEHOLDER,
  placeholderOpacity = 0.3,
  optimizeSize = 'small', // Default to small (300px) for grid cards
  loading = 'lazy',
  fetchPriority = 'auto',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sourceList = useMemo(() => normalizeSources(sources, optimizeSize), [sources, optimizeSize]);
  const [idx, setIdx] = useState(0);
  const [failed, setFailed] = useState(false);
  const [isNearViewport, setIsNearViewport] = useState(loading === 'eager');

  useEffect(() => {
    // Reset when the sources change.
    setIdx(0);
    setFailed(false);
  }, [sourceList.join('|')]);

  // IntersectionObserver to preload images BEFORE they enter viewport
  // rootMargin of 1000px means we start loading when within 1000px of viewport
  useEffect(() => {
    if (loading === 'eager') {
      setIsNearViewport(true);
      return;
    }

    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setIsNearViewport(true);
            // Also preload the image immediately
            if (sourceList[0]) {
              preloadImage(sourceList[0]);
            }
            observer.disconnect();
          }
        }
      },
      {
        // Start loading when image is within 1000px of viewport
        // This gives us a large buffer for smooth scrolling
        rootMargin: '1000px',
        threshold: 0,
      }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [sourceList, loading]);

  const current = !failed ? (sourceList[idx] || '') : '';

  const baseContainerStyle: React.CSSProperties = fill
    ? { position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }
    : {};

  const baseImgStyle: React.CSSProperties = fill
    ? {
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        objectFit,
      }
    : { objectFit };

  const showPlaceholder = !current || !isNearViewport;
  const finalSrc = showPlaceholder ? placeholderSrc : current;
  const finalOpacity = showPlaceholder ? placeholderOpacity : 1;

  return (
    <div ref={containerRef} className={className} style={{ ...baseContainerStyle, ...style }}>
      <img
        src={finalSrc}
        alt={alt}
        loading={loading}
        decoding="async"
        // @ts-ignore - fetchPriority is valid but not in older TS types
        fetchpriority={fetchPriority}
        style={{ ...baseImgStyle, ...imgStyle, opacity: finalOpacity }}
        onLoad={(e) => {
          // Some broken URLs fire onLoad with a 0×0 image; treat as error
          const img = e.currentTarget;
          if (img.naturalWidth === 0) {
            const next = idx + 1;
            if (next < sourceList.length) {
              setIdx(next);
            } else {
              setFailed(true);
            }
          }
        }}
        onError={() => {
          if (showPlaceholder) return;
          const next = idx + 1;
          if (next < sourceList.length) {
            setIdx(next);
          } else {
            setFailed(true);
          }
        }}
      />
    </div>
  );
};

export default ResilientImage;
