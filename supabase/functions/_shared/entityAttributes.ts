// Entity-specific attribute type definitions for edge functions
// Mirrors nuke_frontend/src/types/business.ts entity attribute interfaces
//
// SEPARATION RULE:
//   entity_attributes = business-domain data (what the entity is/does)
//   metadata = operational/provenance (who scraped, when, from where)

export interface CollectionAttributes {
  collection_size?: number;
  collection_focus?: string[];
  era_focus?: string[];
  display_status?: 'private' | 'public' | 'by_appointment' | 'museum';
  storage_type?: 'climate_controlled' | 'standard' | 'outdoor' | 'mixed';
  concours_participation?: string[];
  notable_vehicles?: string[];
  acquisition_strategy?: string;
}

export interface DealerAttributes {
  dealer_license_number?: string;
  dealer_license_state?: string;
  brands_carried?: string[];
  annual_units_sold?: number;
  price_range_low?: number;
  price_range_high?: number;
  financing_offered?: boolean;
  consignment_accepted?: boolean;
}

export interface AuctionHouseAttributes {
  auction_format?: ('live' | 'online' | 'timed' | 'sealed')[];
  buyer_premium_pct?: number;
  seller_premium_pct?: number;
  annual_sales_volume?: number;
  specialist_categories?: string[];
  accepts_consignment?: boolean;
}

export interface ServiceProviderAttributes {
  marque_specialization?: string[];
  era_specialization?: string[];
  certifications?: string[];
  concurrent_projects?: number;
  typical_project_duration_months?: number;
}

export interface ClubAttributes {
  member_count?: number;
  membership_fee_annual?: number;
  founding_year?: number;
  marque_focus?: string[];
  events_per_year?: number;
  chapters?: string[];
}

export interface ConcoursAttributes {
  event_frequency?: 'annual' | 'biennial' | 'irregular';
  typical_entrant_count?: number;
  judged?: boolean;
  award_categories?: string[];
  location_permanent?: boolean;
  founding_year?: number;
}

export interface RegistryAttributes {
  marque_focus?: string[];
  model_focus?: string[];
  registered_vehicles?: number;
  founding_year?: number;
  publishes_data?: boolean;
}

export interface ManufacturerAttributes {
  brands?: string[];
  production_years?: string;
  headquarters_country?: string;
  current_status?: 'active' | 'defunct' | 'merged' | 'subsidiary';
  parent_company?: string;
}

export interface MediaAttributes {
  media_type?: ('print' | 'digital' | 'video' | 'podcast' | 'social')[];
  audience_focus?: string[];
  founding_year?: number;
  publication_frequency?: string;
}

export interface MarketplaceAttributes {
  listing_types?: ('buy_now' | 'auction' | 'classified' | 'offer')[];
  fee_structure?: string;
  average_listings?: number;
  vehicle_categories?: string[];
}

export interface InvestmentAttributes {
  fund_size?: number;
  minimum_investment?: number;
  vehicle_focus?: string[];
  return_target_pct?: number;
  fund_status?: 'raising' | 'deployed' | 'distributing' | 'closed';
}

export interface ForumAttributes {
  member_count?: number;
  post_count?: number;
  marque_focus?: string[];
  platform?: string;
}

export type EntityAttributes =
  | CollectionAttributes
  | DealerAttributes
  | AuctionHouseAttributes
  | ServiceProviderAttributes
  | ClubAttributes
  | ConcoursAttributes
  | RegistryAttributes
  | ManufacturerAttributes
  | MediaAttributes
  | MarketplaceAttributes
  | InvestmentAttributes
  | ForumAttributes
  | Record<string, unknown>;
