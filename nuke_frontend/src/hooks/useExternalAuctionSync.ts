import { useEffect, useState, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';

interface ExternalAuctionSyncOptions {
  /** External listing ID to sync */
  externalListingId: string | null;
  /** Auction end date (ISO string) - used to determine polling frequency */
  endDate: string | null;
  /** Whether the auction is currently active */
  isActive: boolean;
  /** Enable or disable syncing */
  enabled?: boolean;
}

interface SyncResult {
  current_bid: number | null;
  bid_count: number | null;
  watcher_count: number | null;
  view_count: number | null;
  listing_status: string | null;
  end_date: string | null;
}

/**
 * Hook for syncing external auction data (BaT, C&B, etc.) in real-time.
 *
 * This hook:
 * 1. Calls the sync-bat-listing edge function to fetch fresh data from the source
 * 2. Uses adaptive polling intervals based on auction urgency:
 *    - < 2 min remaining: 5 seconds
 *    - < 10 min remaining: 15 seconds
 *    - < 1 hour remaining: 30 seconds
 *    - > 1 hour remaining: 60 seconds
 * 3. Stops polling when auction ends or page is not visible
 */
export function useExternalAuctionSync({
  externalListingId,
  endDate,
  isActive,
  enabled = true,
}: ExternalAuctionSyncOptions) {
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const intervalRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  // Calculate time remaining until auction ends
  const getTimeRemainingMs = useCallback(() => {
    if (!endDate) return Infinity;
    return new Date(endDate).getTime() - Date.now();
  }, [endDate]);

  // Determine polling interval based on urgency
  const getPollingInterval = useCallback(() => {
    const remainingMs = getTimeRemainingMs();

    if (remainingMs <= 0) return null; // Auction ended
    if (remainingMs < 2 * 60 * 1000) return 5000;   // < 2 min: every 5s
    if (remainingMs < 10 * 60 * 1000) return 15000; // < 10 min: every 15s
    if (remainingMs < 60 * 60 * 1000) return 30000; // < 1 hour: every 30s
    return 60000; // > 1 hour: every 60s
  }, [getTimeRemainingMs]);

  // Call the sync edge function
  const syncNow = useCallback(async () => {
    if (!externalListingId || !enabled || syncing) return;
    if (document.visibilityState !== 'visible') return;

    try {
      setSyncing(true);
      setError(null);

      const { data, error: fnError } = await supabase.functions.invoke('sync-bat-listing', {
        body: { externalListingId },
      });

      if (!mountedRef.current) return;

      if (fnError) {
        console.warn('[useExternalAuctionSync] Sync error:', fnError.message);
        setError(fnError.message);
        return;
      }

      if (data?.success && data?.listing) {
        setLastSyncTime(new Date());
        // The edge function returns camelCase fields nested under `listing`
        setSyncResult({
          current_bid: data.listing.currentBid ?? null,
          bid_count: data.listing.bidCount ?? null,
          watcher_count: data.listing.watcherCount ?? null,
          view_count: data.listing.viewCount ?? null,
          listing_status: data.listing.status ?? null,
          end_date: null, // end_date is not returned directly, comes from DB update via realtime
        });
      }
    } catch (err: any) {
      if (!mountedRef.current) return;
      console.warn('[useExternalAuctionSync] Sync exception:', err?.message);
      setError(err?.message || 'Sync failed');
    } finally {
      if (mountedRef.current) {
        setSyncing(false);
      }
    }
  }, [externalListingId, enabled, syncing]);

  // Setup adaptive polling
  useEffect(() => {
    mountedRef.current = true;

    if (!externalListingId || !isActive || !enabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Initial sync
    syncNow();

    // Setup interval with adaptive timing
    const setupInterval = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }

      const interval = getPollingInterval();
      if (!interval) {
        // Auction ended
        return;
      }

      console.log(`[useExternalAuctionSync] Polling every ${interval / 1000}s for listing ${externalListingId}`);

      intervalRef.current = window.setInterval(() => {
        // Re-check interval in case auction is ending soon
        const currentInterval = getPollingInterval();
        if (!currentInterval) {
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          return;
        }

        // If interval should change, restart with new timing
        if (currentInterval !== interval) {
          setupInterval();
          return;
        }

        syncNow();
      }, interval);
    };

    setupInterval();

    // Re-sync when page becomes visible
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncNow();
        setupInterval();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      mountedRef.current = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [externalListingId, isActive, enabled, getPollingInterval, syncNow]);

  return {
    lastSyncTime,
    syncing,
    error,
    syncResult,
    syncNow,
    pollingInterval: getPollingInterval(),
  };
}
