// Enhanced Profile Types for comprehensive profile system

export interface Profile {
  id: string;
  email: string | null;
  username: string | null;
  full_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  location: string | null;
  website_url: string | null;
  github_url: string | null;
  linkedin_url: string | null;
  user_type: 'user' | 'professional' | 'dealer' | 'admin';
  is_verified: boolean;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProfileCompletion {
  id: string;
  user_id: string;
  basic_info_complete: boolean;
  avatar_uploaded: boolean;
  bio_added: boolean;
  social_links_added: boolean;
  first_vehicle_added: boolean;
  skills_added: boolean;
  location_added: boolean;
  total_completion_percentage: number;
  created_at: string;
  last_updated: string;
}

export interface ProfileAchievement {
  id: string;
  user_id: string;
  achievement_type: 'first_vehicle' | 'profile_complete' | 'first_image' | 'contributor' | 
                   'vehicle_collector' | 'image_enthusiast' | 'community_member' | 'verified_user';
  achievement_title: string;
  achievement_description: string | null;
  icon_url: string | null;
  points_awarded: number;
  earned_at: string;
  created_at: string;
}

export interface ProfileActivity {
  id: string;
  user_id: string;
  activity_type: 'vehicle_added' | 'profile_updated' | 'image_uploaded' | 'achievement_earned' |
                 'contribution_made' | 'verification_completed' | 'timeline_event_added';
  activity_title: string;
  activity_description: string | null;
  related_vehicle_id: string | null;
  related_achievement_id: string | null;
  metadata: Record<string, any>;
  created_at: string;
}

export interface ProfileStats {
  id: string;
  user_id: string;
  total_vehicles: number;
  total_images: number;
  total_contributions: number;
  total_timeline_events: number;
  total_verifications: number;
  profile_views: number;
  followers_count: number;
  following_count: number;
  last_activity: string | null;
  total_points: number;
  reputation_score: number;
  created_at: string;
  updated_at: string;
}

export interface UserContribution {
  id: string;
  user_id: string;
  contribution_date: string;
  contribution_type: 'vehicle_data' | 'image_upload' | 'timeline_event' | 'verification' | 'annotation';
  contribution_count: number;
  related_vehicle_id: string | null;
  metadata: Record<string, any>;
  created_at: string;
}

export interface ProfileEditForm {
  username: string;
  full_name: string;
  bio: string;
  location: string;
  website_url: string;
  github_url: string;
  linkedin_url: string;
  user_type: 'user' | 'professional' | 'dealer' | 'admin';
  is_public: boolean;
}

// Professional Experience and Certification Types
export interface ProfessionalCertification {
  id: string;
  user_id: string;
  certification_type: 'ase' | 'manufacturer' | 'trade_school' | 'apprenticeship' | 'custom';
  certification_name: string;
  issuing_organization: string;
  certification_number?: string;
  issue_date: string;
  expiry_date?: string;
  verification_status: 'pending' | 'verified' | 'expired' | 'revoked';
  verification_method: 'document_upload' | 'api_verification' | 'manual_review';
  document_url?: string;
  skill_categories: string[]; // ['engine', 'transmission', 'electrical', etc.]
  created_at: string;
  updated_at: string;
}

export interface SkillCategory {
  id: string;
  name: string;
  description: string;
  parent_category?: string;
  skill_level_required: number; // 1-10 scale
}

export interface UserSkill {
  id: string;
  user_id: string;
  skill_category: string;
  skill_level: number; // 1-10 calculated from events + certifications
  certification_level: number; // 1-10 from formal certifications
  event_level: number; // 1-10 from timeline events
  total_events: number;
  last_event_date?: string;
  confidence_score: number; // How confident we are in this skill level
  verification_sources: {
    certifications: string[]; // certification IDs
    timeline_events: string[]; // event IDs that contributed
    peer_verifications: string[]; // other users who verified this skill
  };
  created_at: string;
  updated_at: string;
}

export interface SkillProgression {
  id: string;
  user_id: string;
  skill_category: string;
  event_id: string;
  skill_points_gained: number;
  previous_level: number;
  new_level: number;
  event_type: string;
  event_complexity: number; // 1-10 how complex the work was
  verification_quality: number; // 1-10 how well verified the event is
  created_at: string;
}

export interface ProfessionalExperience {
  id: string;
  user_id: string;
  experience_type: 'employment' | 'freelance' | 'hobby' | 'education';
  organization_name: string;
  position_title: string;
  start_date: string;
  end_date?: string;
  is_current: boolean;
  description: string;
  skill_categories: string[];
  verification_status: 'unverified' | 'verified' | 'disputed';
  verification_method?: 'document' | 'reference' | 'linkedin' | 'manual';
  created_at: string;
  updated_at: string;
}

export interface ProfileData {
  profile: Profile;
  completion: ProfileCompletion | null;
  achievements: ProfileAchievement[];
  recentActivity: ProfileActivity[];
  stats: ProfileStats | null;
  recentContributions: UserContribution[];
  certifications: ProfessionalCertification[];
  skills: UserSkill[];
  experience: ProfessionalExperience[];
  skillProgression: SkillProgression[];
}
