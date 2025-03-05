
import { useMutation } from "@tanstack/react-query";
import { trackContentInteraction } from "./interactionService";

export function useViewContent() {
  const { mutate: viewContent } = useMutation({
    mutationFn: async (options: { contentId: string; contentType: string }) => {
      const { contentId, contentType } = options;
      
      // Track the view interaction without any user feedback
      return await trackContentInteraction(
        contentId,
        'view',
        contentType
      );
    }
  });

  return viewContent;
}
