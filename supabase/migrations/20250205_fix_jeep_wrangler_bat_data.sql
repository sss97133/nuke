-- Fix BaT data for 1988 Jeep Wrangler Sahara (f7a10a48-4cd8-4ff9-9166-702367d1c859)
-- Based on actual BaT listing: https://bringatrailer.com/listing/1988-jeep-wrangler-32/
-- Title: "No Reserve: 1988 Jeep Wrangler Sahara for sale on BaT Auctions - sold for $11,000 on April 15, 2024 (Lot #143,328)"

UPDATE vehicles 
SET 
  sale_price = 11000,
  bat_sold_price = 11000,
  bat_sale_date = '2024-04-15',
  bat_listing_title = 'No Reserve: 1988 Jeep Wrangler Sahara'
WHERE id = 'f7a10a48-4cd8-4ff9-9166-702367d1c859';

-- Add field source attribution for the sale price
INSERT INTO vehicle_field_sources (
  vehicle_id, 
  field_name, 
  field_value, 
  source_type, 
  source_url, 
  extraction_method, 
  confidence_score,
  metadata
) VALUES (
  'f7a10a48-4cd8-4ff9-9166-702367d1c859',
  'sale_price',
  '11000',
  'ai_scraped',
  'https://bringatrailer.com/listing/1988-jeep-wrangler-32/',
  'url_scraping',
  100,
  '{"source": "BaT_listing", "extracted_at": "2025-02-05", "lot_number": "143328", "verified": true}'::jsonb
)
ON CONFLICT DO NOTHING;

-- Add field source for bat_sold_price
INSERT INTO vehicle_field_sources (
  vehicle_id, 
  field_name, 
  field_value, 
  source_type, 
  source_url, 
  extraction_method, 
  confidence_score,
  metadata
) VALUES (
  'f7a10a48-4cd8-4ff9-9166-702367d1c859',
  'bat_sold_price',
  '11000',
  'ai_scraped',
  'https://bringatrailer.com/listing/1988-jeep-wrangler-32/',
  'url_scraping',
  100,
  '{"source": "BaT_listing", "extracted_at": "2025-02-05", "lot_number": "143328", "verified": true}'::jsonb
)
ON CONFLICT DO NOTHING;

-- Add field source for bat_sale_date
INSERT INTO vehicle_field_sources (
  vehicle_id, 
  field_name, 
  field_value, 
  source_type, 
  source_url, 
  extraction_method, 
  confidence_score,
  metadata
) VALUES (
  'f7a10a48-4cd8-4ff9-9166-702367d1c859',
  'bat_sale_date',
  '2024-04-15',
  'ai_scraped',
  'https://bringatrailer.com/listing/1988-jeep-wrangler-32/',
  'url_scraping',
  100,
  '{"source": "BaT_listing", "extracted_at": "2025-02-05", "lot_number": "143328", "verified": true}'::jsonb
)
ON CONFLICT DO NOTHING;

