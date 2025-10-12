export interface FeedItem {
  id: string;
  type: 'vehicle' | 'timeline_event' | 'shop' | 'auction' | 'image' | 'user_activity';
  title: string;
  description: string;
  image_url?: string;
  images?: string[];
  user_id: string;
  user_name?: string;
  user_avatar?: string;
  location?: {
    lat: number;
    lng: number;
    address?: string;
  };
  metadata?: any;
  created_at: string;
  engagement?: {
    likes: number;
    comments: number;
    views: number;
  };
}

export interface DiscoveryFeedProps {
  viewMode?: 'gallery' | 'compact' | 'technical';
  denseMode?: boolean;
  initialLocation?: { lat: number; lng: number };
}

export interface SearchFilters {
  contentTypes: string[];
  location?: { lat: number; lng: number };
  radius: number;
  dateRange: 'today' | 'week' | 'month' | 'all';
  sortBy: 'recent' | 'popular' | 'nearby';
}

export interface UserRating {
  user_id: string;
  overall_rating: number;
  contribution_score: number;
  verification_level: 'unverified' | 'email_verified' | 'phone_verified' | 'business_verified' | 'expert_verified';
  reputation_points: number;
  badges: string[];
  trust_level: number;
  created_at: string;
  updated_at: string;
}

export interface UserContribution {
  id: string;
  user_id: string;
  contribution_type: 'vehicle_add' | 'image_upload' | 'timeline_event' | 'verification' | 'review' | 'data_correction';
  entity_id: string;
  entity_type: 'vehicle' | 'image' | 'shop' | 'user';
  quality_score: number;
  verified: boolean;
  created_at: string;
}