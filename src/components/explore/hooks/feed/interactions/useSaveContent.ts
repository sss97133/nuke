
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";
import { trackContentInteraction, checkExistingInteraction } from "./interactionService";

export function useSaveContent() {
  const queryClient = useQueryClient();

  const { mutate: saveContent } = useMutation({
    mutationFn: async (options: { contentId: string; contentType: string }) => {
      const { contentId, contentType } = options;
      
      // Get current user
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      
      if (!userId) {
        throw new Error('User not authenticated');
      }
      
      // Check if already saved
      const hasSaved = await checkExistingInteraction(contentId, userId, 'save');
      
      if (!hasSaved) {
        console.log('Adding new save');
      }
      
      // Track the save interaction
      return await trackContentInteraction({
        contentId,
        contentType,
        interactionType: 'save'
      });
    },
    onSuccess: () => {
      // Invalidate relevant queries to update UI
      queryClient.invalidateQueries({ queryKey: ['explore-feed'] });
      
      // Show toast
      toast({
        title: 'Content saved!',
        description: 'This content has been saved to your collection',
        duration: 2000
      });
    }
  });

  return saveContent;
}
