// Vehicle Discovery Types

export type VehicleStatus = 
  | 'needs_data'
  | 'active_work'
  | 'for_sale'
  | 'verified_profile'
  | 'open_contributions'
  | 'professional_serviced';

export type VerificationLevel = 
  | 'none'
  | 'ai_only'
  | 'human_verified'
  | 'professional_verified';

export interface VehicleStatusMetadata {
  vehicle_id: string;
  status: VehicleStatus;
  
  // Data completeness
  data_completeness_score: number;
  missing_fields: string[];
  
  // Verification metrics
  verification_level: VerificationLevel;
  professional_verifications_count: number;
  contributor_count: number;
  
  // Activity metrics
  last_activity_at: string | null;
  activity_heat_score: number;
  timeline_event_count: number;
  photos_count: number;
  
  // Engagement metrics
  views_this_week: number;
  views_this_month: number;
  views_total: number;
  active_discussions_count: number;
  pending_questions_count: number;
  
  // Location (optional)
  location_public: boolean;
  location_city: string | null;
  location_state: string | null;
  location_country: string | null;
  
  // Contribution opportunities
  needs_photos: boolean;
  needs_specifications: boolean;
  needs_history: boolean;
  needs_verification: boolean;
  owner_seeking_info: boolean;
  
  // Sale/availability
  is_for_sale: boolean;
  sale_price: number | null;
  sale_listing_url: string | null;
  
  // Service tracking
  last_service_date: string | null;
  last_service_provider_id: string | null;
  service_due: boolean;
  
  updated_at: string;
}

export interface ContributionRequest {
  id: string;
  vehicle_id: string;
  owner_id: string;
  request_type: 'photos' | 'specifications' | 'history' | 'verification' | 'service_records' | 'modification_details' | 'general_info';
  description: string | null;
  priority: 'low' | 'medium' | 'high';
  is_active: boolean;
  created_at: string;
  fulfilled_at: string | null;
  fulfilled_by: string | null;
}

// Helper functions for status display
export const getStatusLabel = (status: VehicleStatus): string => {
  const labels: Record<VehicleStatus, string> = {
    needs_data: 'Needs Data',
    active_work: 'Active Work',
    for_sale: 'For Sale',
    verified_profile: 'Verified',
    open_contributions: 'Open for Contributions',
    professional_serviced: 'Recently Serviced'
  };
  return labels[status];
};

export const getStatusColor = (status: VehicleStatus): string => {
  const colors: Record<VehicleStatus, string> = {
    needs_data: '#ef4444', // red
    active_work: '#3b82f6', // blue
    for_sale: '#10b981', // green
    verified_profile: '#8b5cf6', // purple
    open_contributions: '#f59e0b', // amber
    professional_serviced: '#06b6d4' // cyan
  };
  return colors[status];
};

export const getVerificationBadge = (level: VerificationLevel): { label: string; color: string; icon?: string } => {
  const badges: Record<VerificationLevel, { label: string; color: string; icon?: string }> = {
    none: { label: 'Unverified', color: '#6b7280' },
    ai_only: { label: 'AI Verified', color: '#3b82f6' },
    human_verified: { label: 'Human Verified', color: '#10b981', icon: '✓' },
    professional_verified: { label: 'Pro Verified', color: '#8b5cf6', icon: '✓✓' }
  };
  return badges[level];
};

export const getActivityHeatLabel = (score: number): { label: string; color: string } => {
  if (score >= 80) return { label: 'Very Active', color: '#ef4444' };
  if (score >= 60) return { label: 'Active', color: '#f59e0b' };
  if (score >= 40) return { label: 'Moderate', color: '#3b82f6' };
  if (score >= 20) return { label: 'Low Activity', color: '#6b7280' };
  return { label: 'Inactive', color: '#e5e7eb' };
};

export const getCompletenessLabel = (score: number): { label: string; color: string } => {
  if (score >= 90) return { label: 'Complete', color: '#10b981' };
  if (score >= 70) return { label: 'Good', color: '#3b82f6' };
  if (score >= 50) return { label: 'Partial', color: '#f59e0b' };
  if (score >= 30) return { label: 'Basic', color: '#6b7280' };
  return { label: 'Minimal', color: '#ef4444' };
};
