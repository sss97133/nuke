/**
 * PrefetchLink — react-router-dom Link wrapper that warms the destination route's
 * code-split chunk on mouseEnter, so the click feels instant.
 *
 * Pattern stolen from McMaster-Carr (see
 * docs/library/intellectual/studies/2026-05-24_mcmaster-carr-speed-benchmark-study.md).
 * react-router v6 has no built-in prefetch — this is the cheapest manual equivalent.
 *
 * Scope: only the canonical chunk map below is recognized. Unknown hrefs fall
 * through to a plain <Link>. Adding a route here is a deliberate, surgical edit.
 */
import React, { useCallback, useRef } from 'react';
import { Link, type LinkProps } from 'react-router-dom';

// Map of href pattern → dynamic import. Keys are matched in order (first wins).
// Each value MUST be a static import() expression so Vite can code-split it.
const CHUNK_MAP: { test: (href: string) => boolean; load: () => Promise<unknown> }[] = [
  { test: (h) => h.startsWith('/u/') || h === '/profile' || h.startsWith('/profile/'),
    load: () => import('../pages/UserProfile') },
  { test: (h) => h.startsWith('/vehicle/'),
    load: () => import('../modules/vehicle/routes') },
  { test: (h) => h === '/search' || h.startsWith('/search?'),
    load: () => import('../pages/Search') },
  { test: (h) => h === '/browse',
    load: () => import('../pages/BrowseVehicles') },
  { test: (h) => h === '/journal' || h === '/journal/',
    load: () => import('../pages/journal/JournalIndex') },
];

function resolveChunk(href: string): (() => Promise<unknown>) | null {
  for (const entry of CHUNK_MAP) {
    if (entry.test(href)) return entry.load;
  }
  return null;
}

export interface PrefetchLinkProps extends LinkProps {
  /** Disable prefetch (e.g. for current-page links). */
  noPrefetch?: boolean;
}

export const PrefetchLink = React.forwardRef<HTMLAnchorElement, PrefetchLinkProps>(
  function PrefetchLink({ to, onMouseEnter, onFocus, noPrefetch, ...rest }, ref) {
    const warmedRef = useRef(false);

    const warm = useCallback(() => {
      if (warmedRef.current || noPrefetch) return;
      const href = typeof to === 'string' ? to : (to as { pathname?: string }).pathname || '';
      const loader = resolveChunk(href);
      if (loader) {
        warmedRef.current = true;
        // Fire and forget — Vite will cache the resolved chunk for the real navigation.
        loader().catch(() => { warmedRef.current = false; });
      }
    }, [to, noPrefetch]);

    const handleMouseEnter = useCallback((e: React.MouseEvent<HTMLAnchorElement>) => {
      warm();
      onMouseEnter?.(e);
    }, [warm, onMouseEnter]);

    const handleFocus = useCallback((e: React.FocusEvent<HTMLAnchorElement>) => {
      warm();
      onFocus?.(e);
    }, [warm, onFocus]);

    return (
      <Link
        ref={ref}
        to={to}
        onMouseEnter={handleMouseEnter}
        onFocus={handleFocus}
        {...rest}
      />
    );
  }
);

export default PrefetchLink;
