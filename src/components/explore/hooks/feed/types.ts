
import { QueryClient } from "@tanstack/react-query";

export interface ContentItem {
  id: string;
  type: string;
  title: string;
  subtitle: string;
  image_url: string;
  tags: string[];
  reason: string;
  location: string;
  relevance_score: number;
  created_at: string;
  creator_id?: string;
  creator_name?: string;
  creator_avatar?: string;
  view_count?: number;
  like_count?: number;
  share_count?: number;
  save_count?: number;
  is_liked?: boolean;
  is_saved?: boolean;
  stream_url?: string;
}

export interface FeedOptions {
  filter?: string;
  limit?: number;
  includeStreams?: boolean;
  searchTerm?: string;
}

export interface InteractionOptions {
  contentId: string;
  contentType: string;
  interactionType: 'view' | 'like' | 'share' | 'save' | 'comment';
}

export interface UseExploreFeedReturnType {
  feedItems: ContentItem[];
  fetchNextPage: () => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  trackContentView: (contentId: string, contentType: string) => void;
  likeContent: (contentId: string, contentType: string) => void;
  shareContent: (contentId: string, contentType: string) => void;
  saveContent: (contentId: string, contentType: string) => void;
}
