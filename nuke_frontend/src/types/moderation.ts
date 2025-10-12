// Vehicle Moderation System Types

export type AccessLevel = 'owner' | 'moderator' | 'contributor' | 'blocked';

export type SubmissionType = 'photo' | 'data_correction' | 'specification' | 'modification' | 'service_record' | 'timeline_event' | 'comment';

export type SubmissionStatus = 'pending' | 'approved' | 'rejected' | 'needs_review' | 'archived';

export interface VehicleAccessLevel {
  id: string;
  vehicle_id: string;
  user_id: string;
  access_level: AccessLevel;
  granted_by?: string;
  granted_at: string;
  expires_at?: string;
  permissions: Record<string, any>;
  notes?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface VehicleContentSubmission {
  id: string;
  vehicle_id: string;
  submitted_by?: string;
  submission_type: SubmissionType;
  content_data: Record<string, any>;
  submission_context?: string;
  location_data?: Record<string, any>;
  submission_date: string;
  
  // Moderation workflow
  status: SubmissionStatus;
  reviewed_by?: string;
  reviewed_at?: string;
  review_notes?: string;
  
  // Public display controls
  is_public: boolean;
  display_priority: number;
  contributor_credit?: string;
  
  // Metadata
  submission_ip?: string;
  user_agent?: string;
  created_at: string;
  updated_at: string;
}

export interface VehicleProfileSettings {
  id: string;
  vehicle_id: string;
  is_public: boolean;
  public_url_slug?: string;
  
  // Content visibility controls
  show_specifications: boolean;
  show_modifications: boolean;
  show_service_history: boolean;
  show_timeline: boolean;
  show_contributor_credits: boolean;
  
  // Submission controls
  allow_public_submissions: boolean;
  allow_anonymous_submissions: boolean;
  require_approval_for: string[];
  auto_approve_from_moderators: boolean;
  
  // SEO and social
  meta_title?: string;
  meta_description?: string;
  social_image_url?: string;
  
  created_at: string;
  updated_at: string;
}

export interface VehicleContributor {
  id: string;
  vehicle_id: string;
  contributor_id?: string;
  contributor_name?: string;
  
  // Contribution stats
  total_submissions: number;
  approved_submissions: number;
  rejected_submissions: number;
  reputation_score: number;
  
  // Recognition
  contributor_badge?: string;
  is_featured: boolean;
  bio?: string;
  
  first_contribution: string;
  last_contribution: string;
  created_at: string;
  updated_at: string;
}

// Form types for creating/editing
export interface CreateSubmissionData {
  vehicle_id: string;
  submission_type: SubmissionType;
  content_data: Record<string, any>;
  submission_context?: string;
  location_data?: Record<string, any>;
  contributor_credit?: string;
}

export interface UpdateProfileSettingsData {
  is_public?: boolean;
  public_url_slug?: string;
  show_specifications?: boolean;
  show_modifications?: boolean;
  show_service_history?: boolean;
  show_timeline?: boolean;
  show_contributor_credits?: boolean;
  allow_public_submissions?: boolean;
  allow_anonymous_submissions?: boolean;
  require_approval_for?: string[];
  auto_approve_from_moderators?: boolean;
  meta_title?: string;
  meta_description?: string;
  social_image_url?: string;
}

export interface GrantAccessData {
  user_id: string;
  access_level: AccessLevel;
  expires_at?: string;
  permissions?: Record<string, any>;
  notes?: string;
}

// Dashboard and UI types
export interface ModerationDashboardData {
  pending_submissions: VehicleContentSubmission[];
  recent_activity: VehicleContentSubmission[];
  contributor_stats: VehicleContributor[];
  access_levels: VehicleAccessLevel[];
  profile_settings: VehicleProfileSettings;
}

export interface PublicVehicleProfile {
  vehicle: any; // Vehicle data
  profile_settings: VehicleProfileSettings;
  approved_content: VehicleContentSubmission[];
  contributors: VehicleContributor[];
  timeline_events: any[];
  specifications: Record<string, any>;
  modifications: any[];
}

export interface SubmissionFormData {
  submission_type: SubmissionType;
  content_data: Record<string, any>;
  submission_context: string;
  location_data?: {
    venue_name?: string;
    city?: string;
    state?: string;
    coordinates?: {
      lat: number;
      lng: number;
    };
  };
  contributor_credit: string;
  photos?: File[];
}
