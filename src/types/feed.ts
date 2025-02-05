export interface FeedItemProfile {
  username: string | null;
  avatar_url: string | null;
}

export interface FeedItem {
  id: string;
  user_id: string;
  item_type: string;
  item_id: string;
  content: string;
  metadata?: Record<string, any>;
  created_at: string;
  profile?: FeedItemProfile;
}

export interface FeedInteraction {
  id: string;
  feed_item_id: string;
  user_id: string;
  interaction_type: string;
  content?: string;
  amount?: number;
  created_at: string;
}