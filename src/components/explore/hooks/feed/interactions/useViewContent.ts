
import { useMutation } from "@tanstack/react-query";
import { trackContentInteraction } from "./interactionService";

export function useViewContent() {
  const { mutate: viewContent } = useMutation({
    mutationFn: async (options: { contentId: string; contentType: string }) => {
      const { contentId, contentType } = options;
      
      try {
        // Track the view interaction without any user feedback
        return await trackContentInteraction(
          contentId,
          'view',
          contentType
        );
      } catch (error) {
        // Log but don't break the UI flow on view errors
        console.warn('Failed to track view, but continuing:', error);
        return { success: false, error };
      }
    },
    // Don't show any errors for view tracking - it's passive
    onError: (error) => {
      console.warn('View tracking error (handled):', error);
    }
  });

  return viewContent;
}
