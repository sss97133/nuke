/**
 * User Profile types — mirrors vehicle-profile/types.ts pattern.
 */

export interface UserProfile {
  id: string;
  username: string | null;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  bio: string | null;
  location: string | null;
  website: string | null;
  github_url: string | null;
  linkedin_url: string | null;
  user_type: 'user' | 'professional' | 'dealer';
  verification_status: string | null;
  is_public: boolean;
  created_at: string;
  updated_at: string | null;
  member_since: string | null;
  // Stats (may come from profile_stats view or direct fields)
  total_vehicles: number | null;
  total_listings: number | null;
  total_bids: number | null;
  total_comments: number | null;
  total_auction_wins: number | null;
  total_success_stories: number | null;
  reputation_score: number | null;
  contribution_count: number | null;
}

export interface UserProfileStats {
  total_listings: number;
  total_bids: number;
  total_comments: number;
  total_auction_wins: number;
  total_success_stories: number;
  member_since: string | null;
}

export interface UserComprehensiveData {
  profile: any;
  stats: UserProfileStats;
  listings: any[];
  bids: any[];
  comments: any[];
  auction_wins: any[];
  success_stories: any[];
  comments_of_note: any[];
}

export interface ContributionEvent {
  date: string;
  type: 'image_upload' | 'timeline_event' | 'vehicle_added' | 'auction_activity' | 'comment' | 'profile_edit';
  count: number;
  label: string;
  vehicleId?: string;
  metadata?: Record<string, any>;
}

export interface ActivityEvent {
  id: string;
  date: string;
  type: string;
  description: string;
  vehicleId?: string;
  vehicleName?: string;
  vehicleThumb?: string;
  metadata?: Record<string, any>;
}

export interface GalleryFilter {
  zone?: string;
  category?: string;
  tag?: string;
  dateRange?: [string, string];
}
