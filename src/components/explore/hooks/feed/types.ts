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
  description?: string;  // For stream descriptions
  image?: string;        // Alternative to image_url for streams
  url?: string;          // For stream URLs
  author?: {             // Alternative to creator fields for streams
    name: string;
    avatar: string | null;
  };
  published?: string;    // Alternative to created_at for streams
  views?: number;        // Alternative to view_count for streams
  likes?: number;        // Alternative to like_count for streams
  comments?: number;     // For stream comments count
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
