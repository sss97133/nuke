import React from 'react';

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
}

function normalizeSources(sources: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const s of sources) {
    const v = typeof s === 'string' ? s.trim() : '';
    if (!v) continue;
    if (!out.includes(v)) out.push(v);
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
  objectFit = 'cover',
  placeholderSrc = DEFAULT_PLACEHOLDER,
  placeholderOpacity = 0.3,
}) => {
  const sourceList = React.useMemo(() => normalizeSources(sources), [sources]);
  // #region agent log
  React.useEffect(()=>{if(sourceList.length>0){fetch('http://127.0.0.1:7242/ingest/4d355282-c690-469e-97e1-0114c2a0ef69',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ResilientImage.tsx:43',message:'ResilientImage sources initialized',data:{sourceCount:sourceList.length,sources:sourceList,alt},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H1'})}).catch(()=>{});}},[sourceList.join('|'),alt]);
  // #endregion
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
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/4d355282-c690-469e-97e1-0114c2a0ef69',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ResilientImage.tsx:79',message:'Image load error',data:{currentSrc:current,idx,failed,sourceListLength:sourceList.length,allSources:sourceList},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H4'})}).catch(()=>{});
          // #endregion
          if (showPlaceholder) return;
          const next = idx + 1;
          if (next < sourceList.length) {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/4d355282-c690-469e-97e1-0114c2a0ef69',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ResilientImage.tsx:85',message:'Trying next source',data:{nextIdx:next,totalSources:sourceList.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H4'})}).catch(()=>{});
            // #endregion
            setIdx(next);
          } else {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/4d355282-c690-469e-97e1-0114c2a0ef69',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ResilientImage.tsx:89',message:'All sources failed',data:{sourceList},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H4'})}).catch(()=>{});
            // #endregion
            setFailed(true);
          }
        }}
      />
    </div>
  );
};

export default ResilientImage;


