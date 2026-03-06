/**
 * CardActions — Follow/bookmark button for authenticated users.
 *
 * Renders a small heart icon in the top-right area of the card.
 * Only mounts when the user is authenticated (check upstream).
 */

import { useCallback, type MouseEvent } from 'react';

export interface CardActionsProps {
  isFollowing: boolean;
  isLoading: boolean;
  onToggleFollow: () => void;
}

export function CardActions({
  isFollowing,
  isLoading,
  onToggleFollow,
}: CardActionsProps) {
  const handleClick = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isLoading) onToggleFollow();
    },
    [isLoading, onToggleFollow],
  );

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isLoading}
      aria-label={isFollowing ? 'Unfollow vehicle' : 'Follow vehicle'}
      style={{
        position: 'absolute',
        top: '6px',
        right: '6px',
        width: '28px',
        height: '28px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: isFollowing ? 'var(--error)' : 'rgba(0,0,0,0.5)',
        border: '1px solid rgba(255,255,255,0.2)',
        color: 'white',
        cursor: isLoading ? 'wait' : 'pointer',
        fontSize: '14px',
        lineHeight: 1,
        zIndex: 11,
        transition: 'background 180ms cubic-bezier(0.16, 1, 0.3, 1)',
        padding: 0,
      }}
    >
      {isFollowing ? '\u2665' : '\u2661'}
    </button>
  );
}
