'use client';

import React from 'react';

/** Cursor-style loader: same attributes as cursor.com (preload, playsinline, loop, etc.). */
export type CursorVideoLoaderProps = {
  /** Video src, e.g. /loaders/cursor-loading-physical-padded.webm */
  src: string;
  /** Optional class, e.g. page_gridCanvas__GK3dR */
  className?: string;
  /** Optional style; default matches canvas slot: 215.984×215.984 */
  style?: React.CSSProperties;
  /** Preload: "metadata" | "none" | "auto". Default metadata. */
  preload?: 'metadata' | 'none' | 'auto';
};

const DEFAULT_SIZE = 215.984;

export function CursorVideoLoader({
  src,
  className = 'page_gridCanvas__GK3dR',
  style = {},
  preload = 'metadata',
}: CursorVideoLoaderProps) {
  return (
    <video
      preload={preload}
      playsInline
      loop
      crossOrigin="anonymous"
      disableRemotePlayback
      src={src}
      className={className}
      style={{
        width: DEFAULT_SIZE,
        height: DEFAULT_SIZE,
        objectFit: 'contain',
        ...style,
      }}
      aria-label="Loading"
    />
  );
}

export default CursorVideoLoader;
