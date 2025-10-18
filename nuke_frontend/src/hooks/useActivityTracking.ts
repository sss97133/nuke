import React, { useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';

interface TrackEventParams {
  event_type: 'view' | 'like' | 'comment' | 'share' | 'search' | 'filter' | 'upload' | 'contribute' | 'visit' | 'interaction';
  entity_type: 'vehicle' | 'image' | 'shop' | 'user' | 'timeline_event' | 'search' | 'page';
  entity_id?: string;
  metadata?: Record<string, any>;
  location?: {
    lat: number;
    lng: number;
    address?: string;
  };
}

export const useActivityTracking = () => {
  const lastTrackedRef = useRef<Map<string, number>>(new Map());

  const trackEvent = useCallback(async ({
    event_type,
    entity_type,
    entity_id,
    metadata = {},
    location
  }: TrackEventParams) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Prevent duplicate tracking within 5 seconds
      const key = `${event_type}-${entity_type}-${entity_id || 'null'}`;
      const now = Date.now();
      const lastTracked = lastTrackedRef.current.get(key);

      if (lastTracked && now - lastTracked < 5000) {
        return;
      }

      lastTrackedRef.current.set(key, now);

      // Map entity_type to allowed target_type on user_interactions
      const targetType = (() => {
        switch (entity_type) {
          case 'vehicle': return 'vehicle';
          case 'image': return 'image';
          case 'shop': return 'shop';
          case 'user': return 'user';
          case 'timeline_event':
          case 'page':
          case 'search':
          default: return 'event';
        }
      })();

      await supabase.from('user_interactions').insert({
        user_id: user.id,
        interaction_type: event_type,
        target_type: targetType,
        target_id: entity_id ?? null,
        context: { ...(metadata || {}), location }
      });

    } catch (error) {
      console.error('Error tracking activity:', error);
    }
  }, []);

  // Convenience methods for common events
  const trackView = useCallback((entity_type: TrackEventParams['entity_type'], entity_id: string, metadata?: Record<string, any>) => {
    trackEvent({ event_type: 'view', entity_type, entity_id, metadata });
  }, [trackEvent]);

  const trackSearch = useCallback((query: string, filters: Record<string, any>, results_count: number) => {
    trackEvent({
      event_type: 'search',
      entity_type: 'search',
      metadata: { query, filters, results_count }
    });
  }, [trackEvent]);

  const trackUpload = useCallback((entity_type: TrackEventParams['entity_type'], entity_id: string, metadata?: Record<string, any>) => {
    trackEvent({ event_type: 'upload', entity_type, entity_id, metadata });
  }, [trackEvent]);

  const trackPageVisit = useCallback((page_name: string, metadata?: Record<string, any>) => {
    trackEvent({
      event_type: 'visit',
      entity_type: 'page',
      entity_id: page_name,
      metadata
    });
  }, [trackEvent]);

  const trackInteraction = useCallback((entity_type: TrackEventParams['entity_type'], entity_id: string, interaction_type: string, metadata?: Record<string, any>) => {
    trackEvent({
      event_type: 'interaction',
      entity_type,
      entity_id,
      metadata: { interaction_type, ...metadata }
    });
  }, [trackEvent]);

  return {
    trackEvent,
    trackView,
    trackSearch,
    trackUpload,
    trackPageVisit,
    trackInteraction
  };
};

// Helper hook for automatic page tracking
export const usePageTracking = (pageName: string, metadata?: Record<string, any>) => {
  const { trackPageVisit } = useActivityTracking();

  React.useEffect(() => {
    trackPageVisit(pageName, metadata);
  }, [pageName, trackPageVisit]);
};

export default useActivityTracking;