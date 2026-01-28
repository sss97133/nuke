/**
 * Types for LivingVehicleAscii — data-con driven by vehicle + analysis + pulse.
 * See docs/design/LIVING_ASCII_VEHICLE_PROFILE.md.
 */

/** Minimal vehicle slice the glyph needs (matches Vehicle from vehicle-profile/types) */
export type VehicleAsciiSlice = {
  year?: number;
  make?: string;
  model?: string;
  series?: string | null;
  /** auction_outcome from vehicles */
  auction_outcome?: 'sold' | 'reserve_not_met' | 'no_sale' | 'pending' | 'ended' | null;
  auction_end_date?: string | null;
  auction_source?: string | null;
  bid_count?: number | null;
  current_bid?: number | null;
  high_bid?: number | null;
  sale_price?: number | null;
  is_for_sale?: boolean;
  asking_price?: number | null;
  profile_origin?: string | null;
  [key: string]: any;
};

/** Optional vehicle_intelligence fields when frontend wires them */
export type VehicleIntelligenceSlice = {
  is_running?: boolean | null;
  is_driving?: boolean | null;
  is_restored?: boolean | null;
  matching_numbers?: boolean | null;
  modification_level?: string | null;
  production_number?: number | null;
  total_production?: number | null;
  special_edition_name?: string | null;
  is_limited_edition?: boolean | null;
  has_service_records?: boolean | null;
  owner_count?: number | null;
  [key: string]: any;
};

/** Auction/listing pulse (e.g. from VehicleHeaderProps.auctionPulse) */
export type AuctionPulseSlice = {
  current_bid?: number | null;
  bid_count?: number | null;
  listing_status?: string | null;
  end_date?: string | null;
  platform?: string | null;
  [key: string]: any;
};

export type DisplayState = 'live_auction' | 'auction_ended' | 'for_sale' | 'sold' | 'unlisted';

export type ShapeKey = 'sedan' | 'suv' | 'truck' | 'coupe' | 'default';
