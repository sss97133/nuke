export interface ListingArchive {
  id: string;
  vehicle_id?: string;
  listing_url: string;
  listing_source: string;
  listing_title?: string;
  listing_id?: string;
  html_content?: string;
  description_text?: string;
  listing_metadata: Record<string, any>;
  image_urls: string[];
  archived_image_urls: string[];
  primary_image_url?: string;
  listing_status: 'active' | 'sold' | 'ended' | 'removed' | 'archived';
  final_sale_price?: number;
  sale_date?: string;
  auction_start_date?: string;
  auction_end_date?: string;
  current_bid?: number;
  reserve_met?: boolean;
  bid_count?: number;
  scraped_at: string;
  last_updated: string;
  archive_version: number;
  content_hash: string;
  created_at: string;
  updated_at: string;
}
