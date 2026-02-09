-- Merge organization_vehicles from other "Bring a Trailer" businesses into canonical BAT (d2bd6370).
-- Run with: SET statement_timeout = 0; then run this (or run via psql in batches).
-- Step 1: Insert into canonical where not already present
INSERT INTO organization_vehicles (
  organization_id,
  vehicle_id,
  relationship_type,
  status,
  listing_status,
  asking_price,
  cost_basis,
  sale_date,
  sale_price,
  start_date,
  end_date,
  days_on_lot,
  auto_tagged,
  notes
)
SELECT
  'd2bd6370-11d1-4af0-8dd2-3de2c3899166',
  ov.vehicle_id,
  ov.relationship_type,
  ov.status,
  ov.listing_status,
  ov.asking_price,
  ov.cost_basis,
  ov.sale_date,
  ov.sale_price,
  ov.start_date,
  ov.end_date,
  ov.days_on_lot,
  COALESCE(ov.auto_tagged, false),
  ov.notes
FROM organization_vehicles ov
JOIN businesses b ON b.id = ov.organization_id
WHERE LOWER(TRIM(b.business_name)) = 'bring a trailer'
  AND ov.organization_id != 'd2bd6370-11d1-4af0-8dd2-3de2c3899166'
  AND NOT EXISTS (
    SELECT 1 FROM organization_vehicles existing
    WHERE existing.organization_id = 'd2bd6370-11d1-4af0-8dd2-3de2c3899166'
      AND existing.vehicle_id = ov.vehicle_id
      AND existing.relationship_type = ov.relationship_type
  )
ON CONFLICT (organization_id, vehicle_id, relationship_type) DO NOTHING;

-- Step 2: Remove rows from duplicate BAT orgs
DELETE FROM organization_vehicles
WHERE organization_id IN (
  SELECT id FROM businesses
  WHERE LOWER(TRIM(business_name)) = 'bring a trailer'
    AND id != 'd2bd6370-11d1-4af0-8dd2-3de2c3899166'
);

-- Step 3: Refresh canonical BAT total_vehicles
UPDATE businesses
SET total_vehicles = (SELECT COUNT(DISTINCT vehicle_id) FROM organization_vehicles WHERE organization_id = 'd2bd6370-11d1-4af0-8dd2-3de2c3899166' AND status = 'active'),
    updated_at = NOW()
WHERE id = 'd2bd6370-11d1-4af0-8dd2-3de2c3899166';
