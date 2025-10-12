// Vehicle Interaction System Types
// Types for enhanced vehicle interactions including viewing requests, streaming, and viewer reputation

export interface VehicleInteractionRequest {
  id: string;
  vehicle_id: string;
  requester_id: string;
  
  // Request details
  interaction_type: 
    | 'viewing_request'
    | 'streaming_request'
    | 'video_call_request'
    | 'bidding_request'
    | 'inspection_request'
    | 'test_drive_request'
    | 'purchase_inquiry'
    | 'collaboration_request';
  
  title: string;
  message?: string;
  
  // Scheduling
  preferred_date?: string;
  preferred_time_start?: string;
  preferred_time_end?: string;
  flexible_scheduling: boolean;
  
  // Request specifics
  duration_minutes: number;
  location_preference?: 'owner_location' | 'neutral_location' | 'virtual';
  budget_range?: {
    min: number;
    max: number;
    currency: string;
  };
  
  // Status tracking
  status: 'pending' | 'approved' | 'declined' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  
  // Owner response
  owner_response?: string;
  scheduled_date?: string;
  scheduled_location?: string;
  
  // Activity tracking
  viewed_by_owner: boolean;
  responded_at?: string;
  completed_at?: string;
  
  // Metadata
  metadata: Record<string, any>;
  
  created_at: string;
  updated_at: string;
  
  // Related data (populated via joins)
  requester?: {
    id: string;
    username?: string;
    full_name?: string;
    avatar_url?: string;
    reputation?: ViewerReputation;
  };
  vehicle?: {
    id: string;
    make: string;
    model: string;
    year: number;
    user_id: string;
  };
}

export interface VehicleInteractionSession {
  id: string;
  request_id?: string;
  vehicle_id: string;
  host_id: string;
  participant_id: string;
  
  session_type: 'live_streaming' | 'video_call' | 'in_person_viewing' | 'test_drive' | 'inspection';
  
  // Session details
  title: string;
  description?: string;
  
  // Timing
  start_time: string;
  end_time?: string;
  duration_minutes?: number;
  
  // Technical details
  platform?: 'youtube' | 'twitch' | 'zoom' | 'custom' | 'in_person';
  stream_url?: string;
  recording_url?: string;
  
  // Quality metrics
  viewer_count: number;
  max_concurrent_viewers: number;
  engagement_score?: number; // 0.00 to 1.00
  
  // Ratings
  host_rating?: number; // 1-5
  participant_rating?: number; // 1-5
  host_feedback?: string;
  participant_feedback?: string;
  
  // Status
  status: 'scheduled' | 'live' | 'completed' | 'cancelled' | 'failed';
  
  // Metadata
  metadata: Record<string, any>;
  
  created_at: string;
  updated_at: string;
  
  // Related data
  host?: {
    id: string;
    username?: string;
    full_name?: string;
    avatar_url?: string;
  };
  participant?: {
    id: string;
    username?: string;
    full_name?: string;
    avatar_url?: string;
    reputation?: ViewerReputation;
  };
  vehicle?: {
    id: string;
    make: string;
    model: string;
    year: number;
  };
}

export interface ViewerActivity {
  id: string;
  user_id: string;
  vehicle_id: string;
  
  // Activity details
  activity_type: 
    | 'profile_view'
    | 'image_view'
    | 'timeline_view'
    | 'streaming_session'
    | 'video_call'
    | 'in_person_viewing'
    | 'comment_added'
    | 'rating_given'
    | 'share_action'
    | 'bookmark_added'
    | 'inquiry_sent';
  
  // Engagement metrics
  duration_seconds: number;
  interaction_count: number;
  engagement_quality?: 'low' | 'medium' | 'high';
  
  // Content interaction
  images_viewed: number;
  timeline_events_viewed: number;
  comments_left: number;
  
  // Session info
  session_id?: string;
  
  // Context
  referral_source?: 'discovery' | 'search' | 'direct_link' | 'social';
  user_agent?: string;
  ip_address?: string;
  
  // Metadata
  metadata: Record<string, any>;
  
  created_at: string;
}

export interface ViewerReputation {
  id: string;
  user_id: string;
  
  // Core reputation metrics
  total_interactions: number;
  total_viewing_time_minutes: number;
  total_sessions_attended: number;
  total_vehicles_viewed: number;
  
  // Quality metrics
  average_session_rating: number; // 0.00 to 5.00
  reliability_score: number; // 0.00 to 1.00
  engagement_score: number; // 0.00 to 1.00
  
  // Expertise indicators
  favorite_makes: string[];
  favorite_categories: string[];
  expertise_areas: string[];
  
  // Critic status
  critic_level: 'novice' | 'enthusiast' | 'expert' | 'critic' | 'master_critic';
  
  // Social metrics
  followers_count: number;
  following_count: number;
  reviews_written: number;
  helpful_votes_received: number;
  
  // Achievements
  badges: string[];
  achievements: any[];
  
  // Timestamps
  first_activity_at?: string;
  last_activity_at?: string;
  critic_level_achieved_at: string;
  
  created_at: string;
  updated_at: string;
}

export interface VehicleReview {
  id: string;
  vehicle_id: string;
  reviewer_id: string;
  session_id?: string;
  
  // Review content
  title: string;
  content: string;
  overall_rating: number; // 1-5
  
  // Detailed ratings
  condition_rating?: number; // 1-5
  authenticity_rating?: number; // 1-5
  presentation_rating?: number; // 1-5
  owner_interaction_rating?: number; // 1-5
  
  // Review metadata
  review_type: 'general' | 'streaming_session' | 'in_person_viewing' | 'test_drive' | 'expert_analysis';
  verified_interaction: boolean;
  
  // Community interaction
  helpful_votes: number;
  total_votes: number;
  
  // Status
  status: 'draft' | 'published' | 'flagged' | 'removed';
  
  // Media
  images: string[];
  
  created_at: string;
  updated_at: string;
  
  // Related data
  reviewer?: {
    id: string;
    username?: string;
    full_name?: string;
    avatar_url?: string;
    reputation?: ViewerReputation;
  };
  vehicle?: {
    id: string;
    make: string;
    model: string;
    year: number;
  };
  session?: VehicleInteractionSession;
}

export interface InteractionNotification {
  id: string;
  recipient_id: string;
  sender_id?: string;
  vehicle_id?: string;
  request_id?: string;
  session_id?: string;
  
  notification_type: 
    | 'new_request'
    | 'request_approved'
    | 'request_declined'
    | 'session_scheduled'
    | 'session_starting'
    | 'session_reminder'
    | 'session_completed'
    | 'review_received'
    | 'rating_received';
  
  title: string;
  message: string;
  
  // Status
  read_at?: string;
  dismissed_at?: string;
  
  // Action data
  action_url?: string;
  action_data: Record<string, any>;
  
  created_at: string;
  
  // Related data
  sender?: {
    id: string;
    username?: string;
    full_name?: string;
    avatar_url?: string;
  };
  vehicle?: {
    id: string;
    make: string;
    model: string;
    year: number;
  };
}

// Request creation/update types
export interface CreateInteractionRequestData {
  vehicle_id: string;
  interaction_type: VehicleInteractionRequest['interaction_type'];
  title: string;
  message?: string;
  preferred_date?: string;
  preferred_time_start?: string;
  preferred_time_end?: string;
  flexible_scheduling?: boolean;
  duration_minutes?: number;
  location_preference?: VehicleInteractionRequest['location_preference'];
  budget_range?: VehicleInteractionRequest['budget_range'];
}

export interface UpdateInteractionRequestData {
  status?: VehicleInteractionRequest['status'];
  owner_response?: string;
  scheduled_date?: string;
  scheduled_location?: string;
  viewed_by_owner?: boolean;
}

export interface CreateSessionData {
  request_id?: string;
  vehicle_id: string;
  participant_id: string;
  session_type: VehicleInteractionSession['session_type'];
  title: string;
  description?: string;
  start_time: string;
  end_time?: string;
  platform?: VehicleInteractionSession['platform'];
  stream_url?: string;
}

export interface CreateReviewData {
  vehicle_id: string;
  session_id?: string;
  title: string;
  content: string;
  overall_rating: number;
  condition_rating?: number;
  authenticity_rating?: number;
  presentation_rating?: number;
  owner_interaction_rating?: number;
  review_type?: VehicleReview['review_type'];
  verified_interaction?: boolean;
  images?: string[];
}

// UI Helper types
export interface InteractionRequestWithUser extends VehicleInteractionRequest {
  requester: {
    id: string;
    username?: string;
    full_name?: string;
    avatar_url?: string;
    reputation?: ViewerReputation;
  };
}

export interface SessionWithParticipants extends VehicleInteractionSession {
  host: {
    id: string;
    username?: string;
    full_name?: string;
    avatar_url?: string;
  };
  participant: {
    id: string;
    username?: string;
    full_name?: string;
    avatar_url?: string;
    reputation?: ViewerReputation;
  };
}

export interface ReviewWithReviewer extends VehicleReview {
  reviewer: {
    id: string;
    username?: string;
    full_name?: string;
    avatar_url?: string;
    reputation?: ViewerReputation;
  };
}

// Interaction statistics and analytics
export interface VehicleInteractionStats {
  total_requests: number;
  pending_requests: number;
  completed_sessions: number;
  total_viewers: number;
  average_rating: number;
  total_reviews: number;
  interaction_types: Record<string, number>;
  recent_activity: ViewerActivity[];
}

export interface ViewerStats {
  vehicles_viewed: number;
  total_viewing_time_minutes: number;
  sessions_attended: number;
  reviews_written: number;
  average_rating_given: number;
  favorite_makes: string[];
  recent_activity: ViewerActivity[];
}
