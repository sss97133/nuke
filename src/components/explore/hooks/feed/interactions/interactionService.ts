
import { supabase } from "@/integrations/supabase/client";
import { InteractionOptions, InteractionResponse } from "./types";

/**
 * Tracks a content interaction in the database
 */
export async function trackContentInteraction(
  options: InteractionOptions
): Promise<InteractionResponse> {
  const { contentId, contentType, interactionType } = options;
  
  try {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    
    if (!userId) {
      console.warn('User not authenticated, skipping interaction tracking');
      return { success: false, message: 'User not authenticated' };
    }
    
    // Insert interaction
    const { error: interactionError } = await supabase
      .from('content_interactions')
      .insert({
        content_id: contentId,
        content_type: contentType,
        interaction_type: interactionType,
        user_id: userId
      });
    
    if (interactionError) {
      console.error('Error tracking interaction:', interactionError);
      throw interactionError;
    }
    
    return { success: true };
  } catch (error) {
    console.error('Error in trackContentInteraction:', error);
    return { 
      success: false, 
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

/**
 * Checks if a user has already performed a specific interaction
 */
export async function checkExistingInteraction(
  contentId: string,
  userId: string,
  interactionType: string
): Promise<boolean> {
  try {
    const { data: existingInteraction } = await supabase
      .from('content_interactions')
      .select('id')
      .eq('content_id', contentId)
      .eq('user_id', userId)
      .eq('interaction_type', interactionType)
      .single();
      
    return !!existingInteraction;
  } catch (error) {
    console.error('Error checking existing interaction:', error);
    return false;
  }
}
