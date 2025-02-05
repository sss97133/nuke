import { Profile } from "./profile";

export interface FeedItem {
  id: string;
  user_id: string;
  item_type: string;
  item_id: string;
  content: string;
  metadata: any;
  created_at: string;
  updated_at: string;
  profile: {
    username: string | null;
    avatar_url: string | null;
  } | null;
}

export interface FeedInteraction {
  id: string;
  feed_item_id: string;
  interaction_type: string;
  content?: string;
  created_at: string;
}