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
  location: string | null; // free-text legacy field — prefer city/state below
  city: string | null;
  state: string | null;
  website: string | null;
  github_url: string | null;
  linkedin_url: string | null;
  user_type: 'user' | 'professional' | 'dealer';
  is_verified: boolean | null;
  verification_level: string | null; // e.g. 'fully_verified'
  is_public: boolean;
  created_at: string;
  updated_at: string | null;
  member_since: string | null;
  // profiles.total_* columns exist in prod but are all 0 (stats RPC never ran).
  // Do not use for display — read UserProfileStats instead.
  total_listings: number | null;
  total_bids: number | null;
  total_comments: number | null;
  total_auction_wins: number | null;
  total_success_stories: number | null;
  // DEAD FIELDS — these columns DO NOT EXIST on profiles in prod; they are
  // always undefined at runtime. Kept only because legacy widgets
  // (UserDossierPanel, UserReputationWidget) still reference them.
  verification_status: string | null;
  total_vehicles: number | null;
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
  // From the profile_stats table (refreshed by recompute_profile_stats).
  // null = no row computed for this user yet.
  total_vehicles?: number | null;
  vehicles_count?: number | null;
  total_images?: number | null;
  total_contributions?: number | null;
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
  // Open facet set (skill-fingerprint doctrine): new kinds land here and get a
  // pill in UserBarcodeTimeline only when they have data — never empty chrome.
  type: 'image_upload' | 'timeline_event' | 'vehicle_added' | 'auction_activity' | 'comment' | 'profile_edit' | 'work' | 'business_event';
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
