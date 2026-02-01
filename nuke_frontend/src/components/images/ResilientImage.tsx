import React from 'react';
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
}) => {
  const sourceList = React.useMemo(() => normalizeSources(sources, optimizeSize), [sources, optimizeSize]);
  const [idx, setIdx] = React.useState(0);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    // Reset when the sources change.
    setIdx(0);
    setFailed(false);
  }, [sourceList.join('|')]);

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

  const showPlaceholder = !current;
  const finalSrc = showPlaceholder ? placeholderSrc : current;
  const finalOpacity = showPlaceholder ? placeholderOpacity : 1;

  return (
    <div className={className} style={{ ...baseContainerStyle, ...style }}>
      <img
        src={finalSrc}
        alt={alt}
        style={{ ...baseImgStyle, ...imgStyle, opacity: finalOpacity }}
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


