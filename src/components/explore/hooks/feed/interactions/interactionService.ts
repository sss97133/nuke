
import type { Database } from '../types';
import { supabase } from '@/integrations/supabase/client';

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
  if (error) console.error("Database query error:", error);
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
    const { data: userData } = await supabase.auth.getUser();
  if (error) console.error("Database query error:", error);
    const userId = userData?.user?.id;
    
    if (!userId) {
      console.log('User not authenticated, tracking anonymous interaction');
      // For anonymous users, we'll just increment counters without storing the interaction
      return { success: true, anonymous: true };
    }
    
    // Insert interaction - explicitly specify only the columns we know exist
    const { data, error } = await supabase
  if (error) console.error("Database query error:", error);
      
      .insert({
        content_id: contentId,
        user_id: userId,
        interaction_type: interactionType,
        content_type: contentType,
        interaction_time: new Date().toISOString()
      })
      .select('id');
    
    if (error) {
      console.error('Error tracking interaction:', error);
      // Don't throw, just log the error and continue
      return { success: false, error };
    }
    
    return { success: true, data };
  } catch (err) {
    console.error('Error in trackContentInteraction:', err);
    return { success: false, error: err };
  }
}
