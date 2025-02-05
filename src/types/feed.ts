import { Profile } from "./profile";

export interface FeedItem {
  id: string;
  user_id: string;
  item_type: string;
  item_id: string;
  content: string;
  metadata: any;
  created_at: string;
  profile: Profile | null;
}

export interface FeedInteraction {
  id: string;
  feed_item_id: string;
  interaction_type: string;
  content?: string;
  created_at: string;
}