
import { useMutation } from "@tanstack/react-query";
import { trackContentInteraction } from "./interactionService";
import { toast } from "@/components/ui/use-toast";

export function useShareContent() {
  const { mutate: shareContent } = useMutation({
    mutationFn: async (options: { contentId: string; contentType: string }) => {
      const { contentId, contentType } = options;
      
      try {
        // Track the share interaction
        return await trackContentInteraction(
          contentId,
          'share',
          contentType
        );
      } catch (error) {
        console.error('Share error:', error);
        throw error; // Rethrow so the UI can handle it
      }
    },
    onSuccess: () => {
      // Show toast notification
      toast({
        title: 'Content shared!',
        description: 'This content has been shared',
        duration: 2000
      });
    },
    onError: () => {
      // Show error toast but don't break the app
      toast({
        title: 'Sharing failed',
        description: 'Unable to share this content',
        variant: 'destructive',
        duration: 3000
      });
    }
  });

  return shareContent;
}
