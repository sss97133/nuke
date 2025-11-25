-- ==========================================================================
-- SOLD VEHICLE PROOF/ORIGIN VIEW
-- ==========================================================================
-- Purpose: Show the origin and proof for why vehicles are marked as sold
--          Displays BaT URLs, external listings, timeline events, etc.
-- ==========================================================================

-- View to show sold vehicle proof/origin
CREATE OR REPLACE VIEW sold_vehicle_proof AS
SELECT 
  ov.id as org_vehicle_id,
  ov.vehicle_id,
  ov.organization_id,
  ov.listing_status,
  ov.sale_date,
  ov.sale_price,
  ov.relationship_type,
  ov.created_at as marked_sold_at,
  ov.notes as org_vehicle_notes,
  
  -- Vehicle info
  v.year,
  v.make,
  v.model,
  v.vin,
  
  -- Proof sources (priority order)
  COALESCE(
    el.listing_url,  -- External listing URL (most authoritative)
    v.bat_auction_url,  -- BaT URL from vehicle
    te.metadata->>'bat_url',  -- BaT URL from timeline
    v.discovery_url  -- Discovery URL
  ) as proof_url,
  
  COALESCE(
    el.platform,  -- Platform from external_listings
    CASE 
      WHEN v.bat_auction_url IS NOT NULL OR te.metadata->>'bat_url' IS NOT NULL THEN 'bat'
      WHEN v.discovery_url LIKE '%bringatrailer%' THEN 'bat'
      WHEN v.discovery_url LIKE '%carsandbids%' THEN 'cars_and_bids'
      WHEN v.discovery_url LIKE '%ebay%' THEN 'ebay_motors'
      ELSE 'unknown'
    END
  ) as proof_platform,
  
  -- External listing proof
  el.id as external_listing_id,
  el.listing_status as external_listing_status,
  el.final_price as external_final_price,
  el.sold_at as external_sold_at,
  el.end_date as external_end_date,
  
  -- Timeline event proof
  te.id as timeline_event_id,
  te.event_date as timeline_sale_date,
  te.title as timeline_title,
  te.description as timeline_description,
  te.cost_amount as timeline_sale_price,
  te.metadata->>'source' as timeline_source,
  te.metadata->>'bat_url' as timeline_bat_url,
  te.metadata->>'lot_number' as lot_number,
  
  -- Data validation proof
  (SELECT json_agg(json_build_object(
    'field', dv.field_name,
    'value', dv.field_value,
    'source', dv.validation_source,
    'confidence', dv.confidence_score,
    'url', dv.source_url
  ))
  FROM data_validations dv
  WHERE dv.entity_type = 'vehicle'
    AND dv.entity_id = ov.vehicle_id
    AND dv.field_name IN ('sale_price', 'sale_date')
    AND dv.validation_source LIKE '%bat%'
  ) as validation_proof,
  
  -- Proof summary
  CASE 
    WHEN el.id IS NOT NULL THEN 'external_listing'
    WHEN te.id IS NOT NULL AND te.metadata->>'source' = 'bat_import' THEN 'timeline_bat_import'
    WHEN v.bat_auction_url IS NOT NULL THEN 'vehicle_bat_url'
    WHEN te.id IS NOT NULL THEN 'timeline_event'
    WHEN ov.notes LIKE '%BaT%' OR ov.notes LIKE '%bringatrailer%' THEN 'notes_reference'
    ELSE 'manual_mark'
  END as proof_type,
  
  -- Proof quality score (higher = more reliable)
  CASE 
    WHEN el.id IS NOT NULL AND el.listing_status = 'sold' AND el.final_price IS NOT NULL THEN 100
    WHEN te.id IS NOT NULL AND te.metadata->>'source' = 'bat_import' AND te.cost_amount IS NOT NULL THEN 90
    WHEN v.bat_auction_url IS NOT NULL AND ov.sale_price IS NOT NULL THEN 80
    WHEN te.id IS NOT NULL AND te.event_type = 'sale' THEN 70
    WHEN ov.notes LIKE '%BaT%' OR ov.notes LIKE '%bringatrailer%' THEN 60
    ELSE 50
  END as proof_confidence

FROM organization_vehicles ov
JOIN vehicles v ON v.id = ov.vehicle_id
LEFT JOIN external_listings el ON 
  el.vehicle_id = ov.vehicle_id 
  AND el.organization_id = ov.organization_id
  AND el.listing_status = 'sold'
LEFT JOIN timeline_events te ON 
  te.vehicle_id = ov.vehicle_id 
  AND te.event_type = 'sale'
WHERE ov.listing_status = 'sold';

-- Grant access
GRANT SELECT ON sold_vehicle_proof TO authenticated;

COMMENT ON VIEW sold_vehicle_proof IS 
  'Shows proof and origin for why vehicles are marked as sold. Includes BaT URLs, external listings, timeline events, and validation data.';

