
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";
import { useCallback } from "react";
import { InteractionOptions } from "./types";

export function useContentInteractions() {
  const queryClient = useQueryClient();

  // Track content interaction with improved analytics
  const { mutate: trackInteraction } = useMutation({
    mutationFn: async ({ 
      contentId, 
      contentType,
      interactionType 
    }: InteractionOptions) => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      
      if (!userId) {
        console.warn('User not authenticated, skipping interaction tracking');
        return { success: false };
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
      
      // For likes and saves, we need to track the user's specific action separately
      if (interactionType === 'like') {
        // Check if already liked
        const { data: existingLike } = await supabase
          .from('content_interactions')
          .select('id')
          .eq('content_id', contentId)
          .eq('user_id', userId)
          .eq('interaction_type', 'like')
          .single();
          
        if (!existingLike) {
          console.log('Adding new like');
        }
      }
      
      if (interactionType === 'save') {
        // Check if already saved
        const { data: existingSave } = await supabase
          .from('content_interactions')
          .select('id')
          .eq('content_id', contentId)
          .eq('user_id', userId)
          .eq('interaction_type', 'save')
          .single();
          
        if (!existingSave) {
          console.log('Adding new save');
        }
      }
      
      return { success: true };
    },
    onSuccess: (_, variables) => {
      // Invalidate relevant queries to update UI
      if (variables.interactionType === 'like' || variables.interactionType === 'save') {
        queryClient.invalidateQueries({ queryKey: ['explore-feed'] });
        
        // Show toast for likes and saves
        toast({
          title: variables.interactionType === 'like' ? 'Content liked!' : 'Content saved!',
          description: variables.interactionType === 'like' 
            ? 'This content has been added to your likes'
            : 'This content has been saved to your collection',
          duration: 2000
        });
      }
    }
  });

  // Method to track content view
  const trackContentView = useCallback((contentId: string, contentType: string) => {
    trackInteraction({ contentId, contentType, interactionType: 'view' });
  }, [trackInteraction]);

  // Method to track content like
  const likeContent = useCallback((contentId: string, contentType: string) => {
    trackInteraction({ contentId, contentType, interactionType: 'like' });
  }, [trackInteraction]);

  // Method to track content share
  const shareContent = useCallback((contentId: string, contentType: string) => {
    trackInteraction({ contentId, contentType, interactionType: 'share' });
  }, [trackInteraction]);

  // Method to track content save
  const saveContent = useCallback((contentId: string, contentType: string) => {
    trackInteraction({ contentId, contentType, interactionType: 'save' });
  }, [trackInteraction]);

  return {
    trackContentView,
    likeContent,
    shareContent,
    saveContent
  };
}
