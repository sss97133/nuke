
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";
import { trackContentInteraction, checkExistingInteraction } from "./interactionService";

export function useLikeContent() {
  const queryClient = useQueryClient();

  const { mutate: likeContent } = useMutation({
    mutationFn: async (options: { contentId: string; contentType: string }) => {
      const { contentId, contentType } = options;
      
      try {
        // Get current user
        const { data: userData } = await supabase.auth.getUser();
        const userId = userData.user?.id;
        
        if (!userId) {
          toast({
            title: 'Authentication required',
            description: 'Please log in to like content',
            variant: 'destructive',
            duration: 3000
          });
          throw new Error('User not authenticated');
        }
        
        // Check if already liked
        const hasLiked = await checkExistingInteraction(contentId, userId, 'like');
        
        if (!hasLiked) {
          console.log('Adding new like');
        }
        
        // Track the like interaction
        return await trackContentInteraction(
          contentId,
          'like',
          contentType
        );
      } catch (error) {
        console.error('Like error:', error);
        throw error;
      }
    },
    onSuccess: () => {
      // Invalidate relevant queries to update UI
      queryClient.invalidateQueries({ queryKey: ['explore-feed'] });
      
      // Show toast
      toast({
        title: 'Content liked!',
        description: 'This content has been added to your likes',
        duration: 2000
      });
    },
    onError: () => {
      toast({
        title: 'Like failed',
        description: 'Unable to like this content',
        variant: 'destructive',
        duration: 3000
      });
    }
  });

  return likeContent;
}
