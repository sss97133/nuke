import type { Database } from '@/types/database';
import { supabase } from '@/integrations/supabase/client';

// Add content_interactions table type to Database interface
interface ContentInteraction {
  id: string;
  content_id: string;
  user_id: string;
  interaction_type: 'view' | 'like' | 'share' | 'save';
  content_type: string;
  interaction_time: string;
  created_at?: string;
}

/**
 * Check if an interaction already exists
 */
export async function checkExistingInteraction(
  contentId: string, 
  userId: string, 
  interactionType: 'view' | 'like' | 'share' | 'save'
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('content_interactions')
      .select('id')
      .eq('content_id', contentId)
      .eq('user_id', userId)
      .eq('interaction_type', interactionType)
      .single();
    
    if (error) {
      console.log(`No existing ${interactionType} interaction found`);
      return false;
    }
    
    return !!data;
  } catch (error) {
    console.error(`Error checking existing interaction:`, error);
    return false;
  }
}

/**
 * Track content interactions (views, likes, shares, saves)
 */
export async function trackContentInteraction(
  contentId: string,
  interactionType: 'view' | 'like' | 'share' | 'save',
  contentType: string
) {
  try {
    // Get current user
    const { data: userData, error: authError } = await supabase.auth.getUser();
    
    if (authError) {
      console.error("Authentication error:", authError);
      return { success: false, error: authError };
    }
    
    const userId = userData?.user?.id;
    
    if (!userId) {
      console.log('User not authenticated, tracking anonymous interaction');
      // For anonymous users, we'll just increment counters without storing the interaction
      return { success: true, anonymous: true };
    }
    
    // Insert interaction with proper typing
    const interaction: Omit<ContentInteraction, 'id' | 'created_at'> = {
      content_id: contentId,
      user_id: userId,
      interaction_type: interactionType,
      content_type: contentType,
      interaction_time: new Date().toISOString()
    };

    const { data, error: insertError } = await supabase
      .from('content_interactions')
      .insert(interaction)
      .select('id');
    
    if (insertError) {
      console.error('Error tracking interaction:', insertError);
      // Don't throw, just log the error and continue
      return { success: false, error: insertError };
    }
    
    return { success: true, data };
  } catch (err) {
    console.error('Error in trackContentInteraction:', err);
    return { success: false, error: err };
  }
}
