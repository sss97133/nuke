
export interface ContentCardItem {
  id: string;
  type: string;
  title: string;
  subtitle: string;
  image: string;
  tags: string[];
  reason: string;
  location: string;
  relevanceScore: number;
  trending?: string;
  created_at?: string;
  creator_id?: string;
  creator_name?: string;
  creator_avatar?: string;
  view_count?: number;
  like_count?: number;
  share_count?: number;
  save_count?: number;
  is_liked?: boolean;
  is_saved?: boolean;
}

export interface ContentCardProps {
  item: ContentCardItem;
  showTrending?: boolean;
  onView?: (id: string, type: string) => void;
  onLike?: (id: string, type: string) => void;
  onShare?: (id: string, type: string) => void;
  onSave?: (id: string, type: string) => void;
}
