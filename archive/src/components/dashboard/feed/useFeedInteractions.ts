
import { supabase } from "@/integrations/supabase/client";
import { checkQueryError } from "@/utils/supabase-helpers";

export const useFeedInteractions = () => {
  const trackEngagement = async (
    feedItemId: string,
    interactionType: string,
    viewDurationSeconds?: number
  ) => {
    try {
      // Get the current user's ID
      const { data: { user }, error } = await supabase.auth.getUser();
      checkQueryError(error);
      
      if (!user) {
        console.error('No authenticated user found');
        return;
      }

      const { error: insertError } = await supabase.from('engagement_metrics').insert({
        feed_item_id: feedItemId,
        interaction_type: interactionType,
        view_duration_seconds: viewDurationSeconds || 0,
        user_id: user.id,
        interaction_weight: interactionType === 'click' ? 2.0 : 1.0
      });

      checkQueryError(insertError);
    } catch (err) {
      console.error('Failed to track engagement:', err);
    }
  };

  return { trackEngagement };
};
