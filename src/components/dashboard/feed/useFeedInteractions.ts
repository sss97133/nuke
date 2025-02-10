
import { supabase } from "@/integrations/supabase/client";

export const useFeedInteractions = () => {
  const trackEngagement = async (
    feedItemId: string,
    interactionType: string,
    viewDurationSeconds?: number
  ) => {
    try {
      const { error } = await supabase.from('engagement_metrics').insert({
        feed_item_id: feedItemId,
        interaction_type: interactionType,
        view_duration_seconds: viewDurationSeconds || 0
      });

      if (error) {
        console.error('Error tracking engagement:', error);
      }
    } catch (err) {
      console.error('Failed to track engagement:', err);
    }
  };

  return { trackEngagement };
};
