
export interface FeedItemProfile {
  username: string | null;
  avatar_url: string | null;
}

export interface FeedItemData {
  make?: string;
  model?: string;
  name?: string;
  description?: string;
  title?: string;
}

export interface FeedItem {
  id: string;
  user_id: string;
  item_type: string;
  item_id: string;
  content: string;
  type: 'vehicle' | 'asset' | 'service' | 'auction';
  data: FeedItemData | null;
  // Removed date field since we use created_at instead
  created_at: string;
  metadata?: Record<string, any>;
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
