/**
 * CardAuctionTimer — Live auction countdown.
 *
 * Uses the shared AuctionClockProvider instead of per-card setInterval.
 * Positioned in top-left of image area.
 */

import { useMemo } from 'react';
import { useAuctionClock } from '../AuctionClockProvider';

export interface CardAuctionTimerProps {
  endDate: string;
  isLive?: boolean;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');

  if (totalSeconds > 7 * 86400) return `${days}d ${hours}h`;
  if (totalSeconds > 86400) return `${days}d`;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export function CardAuctionTimer({ endDate, isLive }: CardAuctionTimerProps) {
  const now = useAuctionClock();

  const timerText = useMemo(() => {
    const end = new Date(endDate).getTime();
    if (!Number.isFinite(end)) return null;
    const diffMs = end - now;
    // Cap at 60 days
    if (diffMs > 60 * 24 * 60 * 60 * 1000) return null;

    if (diffMs >= 0) return formatDuration(diffMs);
    if (isLive) return `OT ${formatDuration(Math.abs(diffMs))}`;
    return null; // ended
  }, [endDate, now, isLive]);

  if (!timerText) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: '6px',
        left: '6px',
        background: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(6px)',
        color: 'white',
        padding: '3px 6px',
        fontSize: '9px',
        fontWeight: 700,
        fontFamily: "'Courier New', monospace",
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        border: '1px solid rgba(255,255,255,0.18)',
        zIndex: 10,
        pointerEvents: 'none',
      }}
    >
      {timerText}
    </div>
  );
}
