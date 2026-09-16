import React from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

type SkeletonVariant = 'text' | 'card' | 'card-list' | 'table-row' | 'avatar' | 'header' | 'badge';

interface LoadingSkeletonProps {
  variant: SkeletonVariant;
  count?: number;
  className?: string;
  ariaLabel?: string;
}

// ─── Variant classes ─────────────────────────────────────────────────────────

// Skeletons are static fills (V-10: no pulse, no shimmer).
// Each variant matches the dimensions of the loaded content it replaces.
const VARIANT_CLASS: Record<SkeletonVariant, string> = {
  text:        'h-3 w-3/4',
  card:        'h-40 w-full border-2 border-[var(--border)]',
  'card-list': 'grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2',
  'table-row': 'h-8 grid grid-cols-[120px_60px_80px_1fr] gap-4',
  avatar:      'h-10 w-10',
  header:      'h-8 w-1/3',
  badge:       'h-4 w-12',
};

const FILL = 'bg-[var(--surface)]';

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Canonical loading placeholder.
 *
 * Static fill — no animation. Matches the dimensions of the loaded content.
 * Replaces every ad-hoc `LOADING…` text fallback and blank div across the app.
 *
 * Usage:
 *   <LoadingSkeleton variant="card-list" count={6} />
 *   <LoadingSkeleton variant="table-row" count={10} />
 *   <LoadingSkeleton variant="avatar" />
 */
export const LoadingSkeleton: React.FC<LoadingSkeletonProps> = ({
  variant,
  count = 1,
  className,
  ariaLabel = 'Loading',
}) => {
  // card-list is itself a grid — render N card skeletons inside it.
  if (variant === 'card-list') {
    return (
      <div
        className={[VARIANT_CLASS[variant], className].filter(Boolean).join(' ')}
        role="status"
        aria-busy="true"
        aria-label={ariaLabel}
      >
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className={`${FILL} ${VARIANT_CLASS.card}`} aria-hidden="true" />
        ))}
      </div>
    );
  }

  // Single-element variants
  if (count === 1) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label={ariaLabel}
        className={[FILL, VARIANT_CLASS[variant], className].filter(Boolean).join(' ')}
      />
    );
  }

  // Repeated variants — caller controls layout via wrapping element
  return (
    <div role="status" aria-busy="true" aria-label={ariaLabel} className={className}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={`${FILL} ${VARIANT_CLASS[variant]}`} aria-hidden="true" />
      ))}
    </div>
  );
};

export default LoadingSkeleton;
