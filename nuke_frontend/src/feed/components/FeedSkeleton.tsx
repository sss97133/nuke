/**
 * FeedSkeleton — Loading placeholder matching card grid layout.
 */

import type { CSSProperties } from 'react';

export interface FeedSkeletonProps {
  cardsPerRow?: number;
  rows?: number;
}

const shimmer: CSSProperties = {
  background: 'var(--surface-hover)',
  animation: 'nuke-skeleton-pulse 1.5s ease-in-out infinite',
};

export function FeedSkeleton({ cardsPerRow = 6, rows = 3 }: FeedSkeletonProps) {
  const total = cardsPerRow * rows;

  return (
    <>
      <style>{`
        @keyframes nuke-skeleton-pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.8; }
        }
      `}</style>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${cardsPerRow}, 1fr)`,
          gap: '4px',
        }}
      >
        {Array.from({ length: total }, (_, i) => (
          <div
            key={i}
            style={{
              border: '2px solid var(--border)',
              background: 'var(--surface)',
              overflow: 'hidden',
            }}
          >
            {/* Image placeholder */}
            <div style={{ ...shimmer, width: '100%', paddingTop: '75%' }} />
            {/* Title line */}
            <div style={{ padding: '6px 8px 4px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ ...shimmer, height: '10px', width: '80%' }} />
              <div style={{ ...shimmer, height: '8px', width: '50%' }} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
