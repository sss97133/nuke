
import { supabase } from '@/integrations/supabase/client';

/**
 * Track content interactions (views, likes, shares, saves)
 */
export async function trackContentInteraction(
  contentId: string,
  interactionType: 'view' | 'like' | 'share' | 'save',
  contentType: string = 'post' // Set default content type
) {
  try {
    console.log(`Tracking ${interactionType} for content ${contentId} (type: ${contentType})`);
    
    // Get current authenticated user
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;
    
    if (!userId) {
      console.log('User not authenticated, skipping interaction tracking');
      return { success: false, error: 'User not authenticated' };
    }
    
    // Create an interaction record with explicit column selection
    // to avoid the schema cache issue with content_type
    const { data, error } = await supabase
      .from('content_interactions')
      .insert({
        user_id: userId,
        content_id: contentId,
        interaction_type: interactionType,
        // Skip content_type since it's causing errors
        created_at: new Date().toISOString()
      });
    
    if (error) {
      console.error(`Error tracking interaction:`, error);
      return { success: false, error };
    }
    
    return { success: true, data };
  } catch (error) {
    console.error(`Error in trackContentInteraction:`, error);
    return { success: false, error };
  }
}

/**
 * Get interactions for a specific content item
 */
export async function getContentInteractions(contentId: string) {
  try {
    // Get current authenticated user
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;
    
    // Create an interaction record
    const { data, error } = await supabase
      .from('content_interactions')
      .select('*')
      .eq('content_id', contentId);
    
    if (error) {
      console.error(`Error getting interactions:`, error);
      return { error };
    }
    
    // Filter by user if authenticated
    const userInteractions = userId 
      ? data.filter(item => item.user_id === userId) 
      : [];
    
    // Count total interactions by type
    const interactionCounts = data.reduce((acc, item) => {
      const type = item.interaction_type;
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    // Determine if the user has performed specific interactions
    const hasLiked = userInteractions.some(item => item.interaction_type === 'like');
    const hasSaved = userInteractions.some(item => item.interaction_type === 'save');
    
    return { 
      counts: interactionCounts,
      hasLiked,
      hasSaved,
      success: true
    };
  } catch (error) {
    console.error(`Error in getContentInteractions:`, error);
    return { error };
  }
}
