// src/types/publishing.ts
// Publishing domain types — completely separate from vehicle types

export interface Publication {
  id: string;
  name: string;
  slug: string;
  organization_id?: string;
  publication_type?: 'magazine' | 'digital' | 'lookbook' | 'catalog' | 'editorial' | 'campaign';
  frequency?: string;
  language: string;
  territory: string[];
  logo_url?: string;
  website_url?: string;
  total_issues: number;
  total_images: number;
  attributes: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface PublicationIssue {
  id: string;
  publication_id: string;
  issue_number?: string;
  issue_title?: string;
  cover_date?: string;
  publish_date?: string;
  cover_image_id?: string;
  page_count?: number;
  image_count: number;
  editor_in_chief?: string;
  creative_director?: string;
  attributes: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface EditorialStory {
  id: string;
  issue_id: string;
  title: string;
  story_type?: string;
  page_start?: number;
  page_end?: number;
  page_count?: number;
  photographer_name?: string;
  stylist_name?: string;
  model_name?: string;
  writer_name?: string;
  brand_partner?: string;
  brand_org_id?: string;
  is_advertorial: boolean;
  layout_file?: string;
  final_pdf?: string;
  attributes: Record<string, unknown>;
  created_at: string;
}

export interface AdPlacement {
  id: string;
  issue_id: string;
  brand_name: string;
  brand_org_id?: string;
  page_number?: number;
  placement_type?: string;
  rate_card_price?: number;
  actual_price?: number;
  currency: string;
  payment_type?: string;
  ad_file?: string;
  image_identity_id?: string;
  contract_id?: string;
  attributes: Record<string, unknown>;
  created_at: string;
}

export interface FlatplanPage {
  id: string;
  issue_id: string;
  page_number: number;
  page_type: string;
  story_id?: string;
  ad_placement_id?: string;
  brand_name?: string;
  story_title?: string;
  is_left_page?: boolean;
  spread_partner_page?: number;
  created_at: string;
}

export interface ProductionCredit {
  id: string;
  image_identity_id?: string;
  publication_id?: string;
  issue_id?: string;
  person_name: string;
  user_id?: string;
  organization_id?: string;
  role: string;
  source: string;
  confidence: number;
  start_date?: string;
  end_date?: string;
  created_at: string;
}

export interface RoleSpectrumEntry {
  role: string;
  weight: number;
  email_count: number;
  source: string;
}

export interface CitedRole {
  title: string;
  source: string;
  publication?: string;
  issue?: string;
  confidence: number;
  date?: string;
}

export interface PlatformRole {
  title: string;
  context: string;
  source: string;
  nuke_profile_id?: string;
  since?: string;
}

export interface RoleSpectrum {
  cited: CitedRole[];
  observed: RoleSpectrumEntry[];
  platform: PlatformRole[];
}

export interface ReliabilityFactors {
  responsiveness: { score: number; email_avg_reply_hours?: number; imessage_avg_reply_hours?: number };
  consistency: { score: number; active_months?: number; total_span_months?: number };
  follow_through: { score: number; completion_rate?: number };
  ghost_risk: { score: number; days_since_last_contact?: number };
  cross_channel: { score: number; channels?: number };
  reciprocity: { score: number; ratio?: number };
  overall_reliability: number;
}

export type GhostStatus = 'active' | 'cooling' | 'dormant' | 'ghosted' | 'low_volume';

export interface PublishingPerson {
  email: string;
  name: string;
  professional_title?: string;
  role_spectrum?: RoleSpectrum;
  reliability_score?: number;
  reliability_factors?: ReliabilityFactors;
  ghost_status?: GhostStatus;
  responsiveness_hours?: number;
  ghost_risk?: number;
  imessage_contact?: string;
  imessage_volume?: number;
  cross_channel_score?: number;
  total_sent: number;
  total_received: number;
  first_seen: string;
  last_seen: string;
  active_months: number;
  publications_worked?: string;
  credit_count?: number;
  primary_publication?: string;
}

export interface ProductionStage {
  id: string;
  issue_id: string;
  stage_type: string;
  stage_order: number;
  status: string;
  started_at?: string;
  completed_at?: string;
  assigned_to?: string;
  file_count: number;
  notes?: string;
  attributes: Record<string, unknown>;
  created_at: string;
}

export interface BrandPartnership {
  id: string;
  brand_name: string;
  brand_org_id?: string;
  publication_id?: string;
  partnership_type?: string;
  start_date?: string;
  end_date?: string;
  is_recurring: boolean;
  total_value?: number;
  currency: string;
  payment_type?: string;
  issue_ids: string[];
  deliverables?: Record<string, unknown>;
  status: string;
  attributes: Record<string, unknown>;
  created_at: string;
}
