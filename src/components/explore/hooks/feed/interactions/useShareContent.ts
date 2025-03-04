
import { useMutation } from "@tanstack/react-query";
import { trackContentInteraction } from "./interactionService";
import { toast } from "@/components/ui/use-toast";

export function useShareContent() {
  const { mutate: shareContent } = useMutation({
    mutationFn: async (options: { contentId: string; contentType: string }) => {
      const { contentId, contentType } = options;
      
      // Track the share interaction
      return await trackContentInteraction({
        contentId,
        contentType,
        interactionType: 'share'
      });
    },
    onSuccess: () => {
      // Show toast notification
      toast({
        title: 'Content shared!',
        description: 'This content has been shared',
        duration: 2000
      });
    }
  });

  return shareContent;
}
