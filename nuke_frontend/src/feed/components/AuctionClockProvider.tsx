/**
 * AuctionClockProvider — Single RAF-based clock for all auction countdowns.
 *
 * Replaces the per-card setInterval pattern in VehicleCardDense.tsx (lines 756-793).
 * With 400 cards on screen, that was 400 concurrent setIntervals updating every second.
 * This provides ONE requestAnimationFrame loop that publishes `now` every ~1s via context.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

const AuctionClockContext = createContext<number>(Date.now());

export function useAuctionClock(): number {
  return useContext(AuctionClockContext);
}

export function AuctionClockProvider({ children }: { children: ReactNode }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let rafId: number;
    let lastTick = 0;

    const tick = (time: number) => {
      if (time - lastTick >= 1000) {
        setNow(Date.now());
        lastTick = time;
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);

    // Also update when tab becomes visible again (catch up after tab switch)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        setNow(Date.now());
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelAnimationFrame(rafId);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <AuctionClockContext.Provider value={now}>
      {children}
    </AuctionClockContext.Provider>
  );
}
