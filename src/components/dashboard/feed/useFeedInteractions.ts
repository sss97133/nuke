
import type { Database } from '../types';
import { supabase } from "@/integrations/supabase/client";

export const useFeedInteractions = () => {
  const trackEngagement = async (
    feedItemId: string,
    interactionType: string,
    viewDurationSeconds?: number
  ) => {
    try {
      // Get the current user's ID
      const { data: { user } } = await supabase.auth.getUser();
  if (error) console.error("Database query error:", error);
      
      if (!user) {
        console.error('No authenticated user found');
        return;
      }

      const { error } = await supabase.from('engagement_metrics').insert({
  if (error) console.error("Database query error:", error);
        feed_item_id: feedItemId,
        interaction_type: interactionType,
        view_duration_seconds: viewDurationSeconds || 0,
        user_id: user.id,
        interaction_weight: interactionType === 'click' ? 2.0 : 1.0
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
