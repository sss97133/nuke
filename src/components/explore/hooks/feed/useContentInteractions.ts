
import { useCallback } from "react";
import { useLikeContent } from "./interactions/useLikeContent";
import { useSaveContent } from "./interactions/useSaveContent";
import { useViewContent } from "./interactions/useViewContent";
import { useShareContent } from "./interactions/useShareContent";

export function useContentInteractions() {
  // Get the individual interaction hooks
  const likeContent = useLikeContent();
  const saveContent = useSaveContent();
  const viewContent = useViewContent();
  const shareContent = useShareContent();

  // Method to track content view
  const trackContentView = useCallback((contentId: string, contentType: string) => {
    viewContent({ contentId, contentType });
  }, [viewContent]);

  // Method to track content like
  const trackContentLike = useCallback((contentId: string, contentType: string) => {
    likeContent({ contentId, contentType });
  }, [likeContent]);

  // Method to track content share
  const trackContentShare = useCallback((contentId: string, contentType: string) => {
    shareContent({ contentId, contentType });
  }, [shareContent]);

  // Method to track content save
  const trackContentSave = useCallback((contentId: string, contentType: string) => {
    saveContent({ contentId, contentType });
  }, [saveContent]);

  return {
    trackContentView,
    likeContent: trackContentLike,
    shareContent: trackContentShare,
    saveContent: trackContentSave
  };
}
