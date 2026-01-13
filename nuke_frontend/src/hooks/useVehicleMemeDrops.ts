import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { ContentActionEvent } from '../services/streamActionsService';

const FEATURE_CONTENT_ACTION_EVENTS_UNAVAILABLE_KEY = 'featureContentActionEventsUnavailable';

function isFeatureUnavailable(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    return window.localStorage?.getItem(FEATURE_CONTENT_ACTION_EVENTS_UNAVAILABLE_KEY) === '1';
  } catch {
    return false;
  }
}

export function useVehicleMemeDrops(vehicleId?: string | null): {
  lastMemeDrop: ContentActionEvent | null;
} {
  const [lastMemeDrop, setLastMemeDrop] = useState<ContentActionEvent | null>(null);

  useEffect(() => {
    if (!vehicleId) return;
    if (isFeatureUnavailable()) return;

    const targetKey = `vehicle:${vehicleId}`;
    const channel = supabase
      .channel(`meme-drops:${vehicleId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'content_action_events',
          filter: `target_key=eq.${targetKey}`,
        },
        (payload) => {
          const row = (payload as any)?.new as any;
          if (!row) return;
          setLastMemeDrop(row as ContentActionEvent);
        },
      )
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {
        try {
          channel.unsubscribe();
        } catch {
          // ignore
        }
      }
    };
  }, [vehicleId]);

  return { lastMemeDrop };
}

