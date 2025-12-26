-- Extraction Field Checklist System
-- Provides a comprehensive database-driven checklist for LLM site mapping
-- The LLM uses this checklist to systematically find all required fields

-- Table to store the master field checklist
CREATE TABLE IF NOT EXISTS extraction_field_checklist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Field identification
  field_name TEXT NOT NULL UNIQUE,
  field_category TEXT NOT NULL, -- 'vehicle_core', 'vehicle_specs', 'vehicle_pricing', 'vehicle_history', 'organization', 'external_identity', 'raw_data'
  db_table TEXT NOT NULL, -- 'vehicles', 'businesses', 'external_identities', 'raw_data'
  db_column TEXT NOT NULL, -- actual column name in the table
  
  -- Field metadata
  data_type TEXT NOT NULL, -- 'text', 'integer', 'numeric', 'date', 'timestamp', 'boolean', 'array', 'jsonb'
  is_required BOOLEAN DEFAULT false,
  is_optional BOOLEAN DEFAULT true,
  priority INTEGER DEFAULT 50, -- 0-100, higher = more important
  
  -- Extraction guidance
  extraction_hints TEXT[], -- ['look_in_title', 'check_specs_section', 'parse_from_description']
  common_patterns TEXT[], -- regex patterns or text patterns to look for
  example_values TEXT[], -- example values for this field
  validation_rules TEXT, -- validation requirements
  
  -- LLM instructions
  llm_question TEXT NOT NULL, -- Question for LLM to ask when searching for this field
  llm_instructions TEXT, -- Specific instructions for finding this field
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_extraction_checklist_category ON extraction_field_checklist(field_category);
CREATE INDEX IF NOT EXISTS idx_extraction_checklist_table ON extraction_field_checklist(db_table);
CREATE INDEX IF NOT EXISTS idx_extraction_checklist_priority ON extraction_field_checklist(priority DESC);

-- Populate with comprehensive field checklist
INSERT INTO extraction_field_checklist (field_name, field_category, db_table, db_column, data_type, is_required, priority, llm_question, llm_instructions, extraction_hints, common_patterns, example_values) VALUES

-- ============================================================================
-- VEHICLE CORE FIELDS (Required)
-- ============================================================================
('year', 'vehicle_core', 'vehicles', 'year', 'integer', true, 100, 
 'What is the vehicle year?', 
 'Look for 4-digit year (1885-2025+). Check title, heading, specs section, or URL pattern.',
 ARRAY['check_title', 'check_specs_section', 'check_url_pattern', 'check_structured_data'],
 ARRAY['\b(18|19|20)\d{2}\b', '\b\d{4}\b'],
 ARRAY['2023', '1995', '1968']),

('make', 'vehicle_core', 'vehicles', 'make', 'text', true, 100,
 'What is the vehicle make (manufacturer)?',
 'Look for manufacturer name. Normalize: "Chevy" → "Chevrolet", "VW" → "Volkswagen". Check title, specs, or structured data.',
 ARRAY['check_title', 'check_specs_section', 'check_structured_data'],
 ARRAY['Chevrolet', 'Ford', 'BMW', 'Mercedes-Benz', 'Porsche'],
 ARRAY['Chevrolet', 'Ford', 'BMW']),

('model', 'vehicle_core', 'vehicles', 'model', 'text', true, 100,
 'What is the vehicle model?',
 'Look for model name after make. May include trim info. Check title, specs section, or structured data.',
 ARRAY['check_title', 'check_specs_section', 'check_structured_data'],
 ARRAY['Corvette', 'Mustang', '911', 'M3'],
 ARRAY['Corvette', 'Mustang', '911']),

-- ============================================================================
-- VEHICLE SPECIFICATIONS
-- ============================================================================
('vin', 'vehicle_specs', 'vehicles', 'vin', 'text', false, 95,
 'What is the VIN (Vehicle Identification Number)?',
 'Look for 17-character alphanumeric code. Check specs section, description, or structured data. Format: [A-HJ-NPR-Z0-9]{17}',
 ARRAY['check_specs_section', 'check_description', 'check_structured_data', 'check_hidden_fields'],
 ARRAY['\b[A-HJ-NPR-Z0-9]{17}\b', 'VIN[:\s]*([A-HJ-NPR-Z0-9]{17})'],
 ARRAY['1G1YY26G995123456', 'WBA3A5C58EK123456']),

('mileage', 'vehicle_specs', 'vehicles', 'mileage', 'integer', false, 90,
 'What is the vehicle mileage/odometer reading?',
 'Look for mileage in miles or kilometers. Check specs section, description, or title. Handle "k" notation (e.g., "50k miles").',
 ARRAY['check_specs_section', 'check_description', 'check_title'],
 ARRAY['(\d+(?:,\d+)?)\s*(?:mi|miles|mile)', '(\d+(?:,\d+)?)\s*k\s*miles?', 'Odometer[:\s]*(\d+)'],
 ARRAY['50000', '125000', '25000']),

('color', 'vehicle_specs', 'vehicles', 'color', 'text', false, 85,
 'What is the exterior color?',
 'Look for color name in specs, description, or title. Common: Black, White, Red, Blue, Silver, etc.',
 ARRAY['check_specs_section', 'check_description', 'check_title'],
 ARRAY['Color[:\s]*([A-Z][a-z]+)', 'Exterior[:\s]*([A-Z][a-z]+)', 'finished in ([A-Z][a-z]+)'],
 ARRAY['Black', 'White', 'Red', 'Blue']),

('interior_color', 'vehicle_specs', 'vehicles', 'interior_color', 'text', false, 80,
 'What is the interior color?',
 'Look for interior color in specs or description. May be listed as "Interior: Black" or "Black interior".',
 ARRAY['check_specs_section', 'check_description'],
 ARRAY['Interior[:\s]*([A-Z][a-z]+)', '([A-Z][a-z]+)\s+interior'],
 ARRAY['Black', 'Tan', 'Red', 'Beige']),

('transmission', 'vehicle_specs', 'vehicles', 'transmission', 'text', false, 85,
 'What is the transmission type?',
 'Look for transmission: Automatic, Manual, CVT, DCT, etc. May include specific model (e.g., "TH400 Automatic").',
 ARRAY['check_specs_section', 'check_description'],
 ARRAY['Transmission[:\s]*([A-Za-z\s]+)', '(Automatic|Manual|CVT|DCT)', '(\d+[-\s]*Speed\s+(?:Automatic|Manual))'],
 ARRAY['Automatic', 'Manual', '6-Speed Manual', '8-Speed Automatic']),

('engine_size', 'vehicle_specs', 'vehicles', 'engine_size', 'text', false, 85,
 'What is the engine size/description?',
 'Look for engine info: displacement (L or ci), cylinders, type. Examples: "5.7L V8", "454ci V8", "3.0L I6".',
 ARRAY['check_specs_section', 'check_description'],
 ARRAY['Engine[:\s]*([^.\n]+)', '(\d+\.?\d*)\s*[Ll]iter', '(\d+)\s*ci', '(\d+)\s*cyl'],
 ARRAY['5.7L V8', '454ci V8', '3.0L I6']),

('drivetrain', 'vehicle_specs', 'vehicles', 'drivetrain', 'text', false, 80,
 'What is the drivetrain type?',
 'Look for: RWD, FWD, AWD, 4WD. May be listed as "Rear Wheel Drive" or "All-Wheel Drive".',
 ARRAY['check_specs_section', 'check_description'],
 ARRAY['Drivetrain[:\s]*([A-Z]+)', '(RWD|FWD|AWD|4WD)', '(Rear|Front|All)[-\s]*Wheel\s+Drive'],
 ARRAY['RWD', 'AWD', 'FWD']),

('body_style', 'vehicle_specs', 'vehicles', 'body_style', 'text', false, 80,
 'What is the body style?',
 'Look for: Coupe, Sedan, Convertible, SUV, Truck, Wagon, Hatchback, etc.',
 ARRAY['check_specs_section', 'check_description', 'check_title'],
 ARRAY['Body[:\s]*([A-Za-z]+)', '(Coupe|Sedan|Convertible|SUV|Truck|Wagon)'],
 ARRAY['Coupe', 'Convertible', 'SUV', 'Truck']),

('trim', 'vehicle_specs', 'vehicles', 'trim', 'text', false, 75,
 'What is the trim level?',
 'Look for trim name: Silverado, Cheyenne, GT, Turbo, etc. May be in title or specs.',
 ARRAY['check_title', 'check_specs_section'],
 ARRAY['Trim[:\s]*([A-Za-z\s]+)'],
 ARRAY['Silverado', 'GT', 'Turbo', 'Limited']),

('series', 'vehicle_specs', 'vehicles', 'series', 'text', false, 70,
 'What is the model series?',
 'Look for series designation: C10, K10, M3, AMG, etc. Often in title or specs.',
 ARRAY['check_title', 'check_specs_section'],
 ARRAY['Series[:\s]*([A-Z0-9]+)', '\b([CK]\d+|M\d+|AMG)\b'],
 ARRAY['C10', 'K10', 'M3']),

-- ============================================================================
-- VEHICLE PRICING
-- ============================================================================
('asking_price', 'vehicle_pricing', 'vehicles', 'asking_price', 'numeric', false, 90,
 'What is the asking price?',
 'Look for price in USD. May be formatted as $50,000 or $50k. Check price section, title, or description.',
 ARRAY['check_price_section', 'check_title', 'check_description'],
 ARRAY['\$([\d,]+)', 'Price[:\s]*\$?([\d,]+)', 'Asking[:\s]*\$?([\d,]+)'],
 ARRAY['50000', '125000', '25000']),

('sale_price', 'vehicle_pricing', 'vehicles', 'sale_price', 'numeric', false, 85,
 'What is the sale price (if sold)?',
 'Look for final sale price. May be in auction results, sold section, or history.',
 ARRAY['check_auction_results', 'check_sold_section', 'check_history'],
 ARRAY['Sold[:\s]*for\s*\$?([\d,]+)', 'Sale[:\s]*Price[:\s]*\$?([\d,]+)', 'Final[:\s]*Price[:\s]*\$?([\d,]+)'],
 ARRAY['52000', '130000']),

('reserve_price', 'vehicle_pricing', 'vehicles', 'reserve_price', 'numeric', false, 70,
 'What is the reserve price (if auction)?',
 'Look for reserve price in auction listings. May be hidden or shown as "Reserve Met" or "Reserve Not Met".',
 ARRAY['check_auction_section', 'check_bid_history'],
 ARRAY['Reserve[:\s]*\$?([\d,]+)', 'Reserve[:\s]*Met'],
 ARRAY['45000', '100000']),

-- ============================================================================
-- VEHICLE DESCRIPTION & HISTORY
-- ============================================================================
('description', 'vehicle_description', 'vehicles', 'description', 'text', false, 85,
 'What is the full vehicle description?',
 'Look for complete narrative description. May be in description section, overview, or main content area.',
 ARRAY['check_description_section', 'check_overview', 'check_main_content'],
 ARRAY[],
 ARRAY['Full vehicle description text...']),

('notes', 'vehicle_description', 'vehicles', 'notes', 'text', false, 75,
 'Are there any additional notes or highlights?',
 'Look for highlights, features, modifications, or special notes. May be in features section or description.',
 ARRAY['check_features_section', 'check_highlights', 'check_description'],
 ARRAY[],
 ARRAY['One owner', 'Garage kept', 'Recent restoration']),

-- ============================================================================
-- VEHICLE LOCATION
-- ============================================================================
('location', 'vehicle_location', 'vehicles', 'location', 'text', false, 80,
 'What is the vehicle location?',
 'Look for city, state, or full address. Check location section, seller info, or description.',
 ARRAY['check_location_section', 'check_seller_section', 'check_description'],
 ARRAY['Location[:\s]*([^.\n]+)', 'Located[:\s]*in\s*([^.\n]+)', '([A-Z][a-z]+,\s*[A-Z]{2})'],
 ARRAY['Los Angeles, CA', 'Miami, FL', 'New York, NY']),

-- ============================================================================
-- ORGANIZATION/SELLER FIELDS
-- ============================================================================
('seller_name', 'organization', 'businesses', 'business_name', 'text', false, 85,
 'What is the seller/dealer name?',
 'Look for dealer or seller name. Check seller section, contact info, or header.',
 ARRAY['check_seller_section', 'check_contact_section', 'check_header'],
 ARRAY['Dealer[:\s]*([^.\n]+)', 'Seller[:\s]*([^.\n]+)', 'Contact[:\s]*([^.\n]+)'],
 ARRAY['ABC Motors', 'John Smith', 'Classic Car Dealer']),

('seller_website', 'organization', 'businesses', 'website', 'text', false, 80,
 'What is the seller/dealer website?',
 'Look for website URL in seller section, contact info, or footer.',
 ARRAY['check_seller_section', 'check_contact_section', 'check_footer'],
 ARRAY['https?://[^\s]+', 'Website[:\s]*([^\s]+)', 'Visit[:\s]*([^\s]+)'],
 ARRAY['https://example.com', 'www.example.com']),

('seller_phone', 'organization', 'businesses', 'phone', 'text', false, 75,
 'What is the seller/dealer phone number?',
 'Look for phone number in contact section or seller info.',
 ARRAY['check_contact_section', 'check_seller_section'],
 ARRAY['\(?\d{3}\)?\s*[\d-]+', 'Phone[:\s]*([^\s]+)', 'Call[:\s]*([^\s]+)'],
 ARRAY['(555) 123-4567', '555-123-4567']),

('seller_email', 'organization', 'businesses', 'email', 'text', false, 70,
 'What is the seller/dealer email?',
 'Look for email address in contact section.',
 ARRAY['check_contact_section'],
 ARRAY['[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}', 'Email[:\s]*([^\s]+)'],
 ARRAY['contact@example.com']),

('seller_location', 'organization', 'businesses', 'city', 'text', false, 75,
 'What is the seller/dealer location (city, state)?',
 'Look for dealer location in contact section or seller info.',
 ARRAY['check_contact_section', 'check_seller_section'],
 ARRAY['([A-Z][a-z]+,\s*[A-Z]{2})', 'City[:\s]*([^,\n]+)'],
 ARRAY['Los Angeles, CA', 'Miami, FL']),

-- ============================================================================
-- AUCTION FIELDS (if applicable)
-- ============================================================================
('lot_number', 'vehicle_auction', 'vehicles', 'lot_number', 'text', false, 80,
 'What is the lot number (if auction)?',
 'Look for lot number in auction listing. May be in header, auction details, or URL.',
 ARRAY['check_auction_section', 'check_header', 'check_url'],
 ARRAY['Lot[:\s]*#?\s*(\d+)', 'Lot[:\s]*(\d+)'],
 ARRAY['123', '456']),

('auction_status', 'vehicle_auction', 'vehicles', 'auction_status', 'text', false, 75,
 'What is the auction status?',
 'Look for: Active, Ended, Sold, Reserve Met, etc. Check auction section or status indicator.',
 ARRAY['check_auction_section', 'check_status_indicator'],
 ARRAY['Status[:\s]*([A-Za-z\s]+)', '(Active|Ended|Sold|Live)'],
 ARRAY['Active', 'Sold', 'Ended']),

('auction_end_date', 'vehicle_auction', 'vehicles', 'auction_end_date', 'timestamp', false, 80,
 'What is the auction end date/time?',
 'Look for end date in auction section. May be formatted as date or countdown timer.',
 ARRAY['check_auction_section', 'check_countdown'],
 ARRAY['Ends[:\s]*([^.\n]+)', 'End[:\s]*Date[:\s]*([^.\n]+)', 'Auction[:\s]*ends[:\s]*([^.\n]+)'],
 ARRAY['2024-01-15 18:00:00', 'January 15, 2024']),

('bid_count', 'vehicle_auction', 'vehicles', 'bid_count', 'integer', false, 70,
 'How many bids are there?',
 'Look for bid count in auction section. May be shown as "X bids" or "Bids: X".',
 ARRAY['check_auction_section', 'check_bid_section'],
 ARRAY['(\d+)\s*bids?', 'Bids?[:\s]*(\d+)'],
 ARRAY['25', '150', '0']),

-- ============================================================================
-- IMAGE FIELDS
-- ============================================================================
('primary_image', 'vehicle_images', 'vehicle_images', 'image_url', 'text', false, 90,
 'What is the primary/thumbnail image URL?',
 'Look for main image. Check image gallery, hero image, or thumbnail. May be in img src, data-src, or lazy-loaded.',
 ARRAY['check_image_gallery', 'check_hero_image', 'check_thumbnail'],
 ARRAY['img[^>]*src=["\']([^"\']+)["\']', 'data-src=["\']([^"\']+)["\']', 'data-lazy-src=["\']([^"\']+)["\']'],
 ARRAY['https://example.com/image1.jpg']),

('gallery_images', 'vehicle_images', 'vehicle_images', 'image_url', 'array', false, 85,
 'What are all the gallery image URLs?',
 'Look for all images in gallery. Check image gallery section, carousel, or image list. Include lazy-loaded images.',
 ARRAY['check_image_gallery', 'check_carousel', 'check_image_list'],
 ARRAY['img[^>]*src=["\']([^"\']+)["\']', 'data-gallery-items', 'gallery[^>]*data-images'],
 ARRAY['https://example.com/image1.jpg', 'https://example.com/image2.jpg']),

-- ============================================================================
-- DISCOVERY & METADATA
-- ============================================================================
('discovery_url', 'vehicle_metadata', 'vehicles', 'discovery_url', 'text', true, 100,
 'What is the source listing URL?',
 'This is the URL being scraped. Always available from the request.',
 ARRAY['from_request_url'],
 ARRAY[],
 ARRAY['https://example.com/listing/123']),

('discovery_source', 'vehicle_metadata', 'vehicles', 'discovery_source', 'text', true, 95,
 'What is the discovery source name?',
 'Derived from domain or platform name. Examples: "bring_a_trailer", "craigslist", "dupont_registry".',
 ARRAY['from_domain', 'from_platform'],
 ARRAY[],
 ARRAY['bring_a_trailer', 'craigslist', 'dupont_registry']),

ON CONFLICT (field_name) DO UPDATE SET
  updated_at = NOW(),
  llm_question = EXCLUDED.llm_question,
  llm_instructions = EXCLUDED.llm_instructions;

-- Create view for easy LLM consumption
CREATE OR REPLACE VIEW extraction_checklist_by_category AS
SELECT 
  field_category,
  db_table,
  COUNT(*) as total_fields,
  COUNT(*) FILTER (WHERE is_required) as required_fields,
  COUNT(*) FILTER (WHERE is_optional) as optional_fields,
  jsonb_agg(
    jsonb_build_object(
      'field_name', field_name,
      'db_column', db_column,
      'data_type', data_type,
      'is_required', is_required,
      'priority', priority,
      'llm_question', llm_question,
      'llm_instructions', llm_instructions,
      'extraction_hints', extraction_hints,
      'common_patterns', common_patterns,
      'example_values', example_values
    ) ORDER BY priority DESC
  ) as fields
FROM extraction_field_checklist
GROUP BY field_category, db_table
ORDER BY field_category, db_table;

COMMENT ON TABLE extraction_field_checklist IS 'Master checklist of all fields that need to be extracted from automotive listings. Used by LLM to systematically find all required data.';
COMMENT ON VIEW extraction_checklist_by_category IS 'Grouped checklist by category for easy LLM consumption';

