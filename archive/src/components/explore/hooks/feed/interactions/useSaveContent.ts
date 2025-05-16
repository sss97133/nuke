
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";
import { trackContentInteraction, checkExistingInteraction } from "./interactionService";

export function useSaveContent() {
  const queryClient = useQueryClient();

  const { mutate: saveContent } = useMutation({
    mutationFn: async (options: { contentId: string; contentType: string }) => {
      const { contentId, contentType } = options;
      
      try {
        // Get current user
        const { data: userData } = await supabase.auth.getUser();
  if (error) console.error("Database query error:", error);
        const userId = userData.user?.id;
        
        if (!userId) {
          toast({
            title: 'Authentication required',
            description: 'Please log in to save content',
            variant: 'destructive',
            duration: 3000
          });
          throw new Error('User not authenticated');
        }
        
        // Check if already saved
        const hasSaved = await checkExistingInteraction(contentId, userId, 'save');
        
        if (!hasSaved) {
          console.log('Adding new save');
        }
        
        // Track the save interaction
        return await trackContentInteraction(
          contentId,
          'save',
          contentType
        );
      } catch (error) {
        console.error('Save error:', error);
        throw error;
      }
    },
    onSuccess: () => {
      // Invalidate relevant queries to update UI
      queryClient.invalidateQueries({ queryKey: ['explore-feed'] });
      
      // Show toast
      toast({
        title: 'Content saved!',
        description: 'This content has been added to your saved items',
        duration: 2000
      });
    },
    onError: () => {
      toast({
        title: 'Save failed',
        description: 'Unable to save this content',
        variant: 'destructive',
        duration: 3000
      });
    }
  });

  return saveContent;
}
