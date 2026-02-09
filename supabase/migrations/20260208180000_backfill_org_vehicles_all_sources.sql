-- Backfill organization_vehicles from every source that links vehicles to orgs.
-- Run these functions (or the master script) so org profiles show correct vehicle counts.
-- See: docs/architecture/ORG_AND_VEHICLE_CLAIMS_MODEL.md, scripts/backfill-all-org-vehicle-links.ts

-- 1) Build threads (forums): vehicle_id + forum_sources.slug → businesses (where business_name = slug) → organization_vehicles
CREATE OR REPLACE FUNCTION backfill_org_vehicles_from_build_threads(p_batch_size int DEFAULT 1000)
RETURNS TABLE(inserted int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int;
BEGIN
  WITH candidates AS (
    SELECT DISTINCT ON (b.id, bt.vehicle_id)
      b.id AS organization_id,
      bt.vehicle_id
    FROM build_threads bt
    JOIN forum_sources fs ON fs.id = bt.forum_source_id
    JOIN businesses b ON LOWER(TRIM(b.business_name)) = LOWER(fs.slug)
    WHERE bt.vehicle_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM organization_vehicles ov
        WHERE ov.organization_id = b.id AND ov.vehicle_id = bt.vehicle_id AND ov.relationship_type = 'work_location'
      )
    ORDER BY b.id, bt.vehicle_id
    LIMIT p_batch_size
  )
  INSERT INTO organization_vehicles (organization_id, vehicle_id, relationship_type, status, auto_tagged, notes)
  SELECT organization_id, vehicle_id, 'work_location', 'active', true, 'Forum build thread'
  FROM candidates
  ON CONFLICT (organization_id, vehicle_id, relationship_type) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  inserted := v_inserted;
  RETURN NEXT;
END;
$$;

-- 2) Vehicles.origin_organization_id → organization_vehicles (sold_by = vehicle originated from this org)
CREATE OR REPLACE FUNCTION backfill_org_vehicles_from_origin_org(p_batch_size int DEFAULT 5000)
RETURNS TABLE(inserted int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int;
BEGIN
  WITH candidates AS (
    SELECT v.origin_organization_id AS organization_id, v.id AS vehicle_id
    FROM vehicles v
    WHERE v.origin_organization_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM organization_vehicles ov
        WHERE ov.organization_id = v.origin_organization_id AND ov.vehicle_id = v.id AND ov.relationship_type = 'sold_by'
      )
    LIMIT p_batch_size
  )
  INSERT INTO organization_vehicles (organization_id, vehicle_id, relationship_type, status, auto_tagged, notes)
  SELECT organization_id, vehicle_id, 'sold_by', 'active', true, 'Origin org'
  FROM candidates
  ON CONFLICT (organization_id, vehicle_id, relationship_type) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  inserted := v_inserted;
  RETURN NEXT;
END;
$$;

-- 3) external_listings: organization_id (seller) + vehicle_id → sold_by; platform org from observation_sources if platform matches
CREATE OR REPLACE FUNCTION backfill_org_vehicles_from_external_listings(p_batch_size int DEFAULT 2000)
RETURNS TABLE(inserted_seller int, inserted_platform int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seller int;
  v_platform int;
BEGIN
  -- Seller links
  WITH candidates AS (
    SELECT el.organization_id, el.vehicle_id
    FROM external_listings el
    WHERE el.vehicle_id IS NOT NULL AND el.organization_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM organization_vehicles ov
        WHERE ov.organization_id = el.organization_id AND ov.vehicle_id = el.vehicle_id AND ov.relationship_type = 'sold_by'
      )
    LIMIT p_batch_size
  )
  INSERT INTO organization_vehicles (organization_id, vehicle_id, relationship_type, status, auto_tagged, notes)
  SELECT organization_id, vehicle_id, 'sold_by', 'active', true, 'External listing'
  FROM candidates
  ON CONFLICT (organization_id, vehicle_id, relationship_type) DO NOTHING;

  GET DIAGNOSTICS v_seller = ROW_COUNT;

  -- Platform links: map el.platform to observation_sources (slug or display_name) and insert auction_platform
  WITH platform_batch AS (
    SELECT DISTINCT el.vehicle_id, os.business_id AS organization_id
    FROM external_listings el
    JOIN observation_sources os ON (
      LOWER(TRIM(os.slug)) = LOWER(TRIM(el.platform))
      OR LOWER(TRIM(os.display_name)) LIKE '%' || LOWER(TRIM(el.platform)) || '%'
    )
    WHERE el.vehicle_id IS NOT NULL AND os.business_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM organization_vehicles ov
        WHERE ov.organization_id = os.business_id AND ov.vehicle_id = el.vehicle_id AND ov.relationship_type = 'auction_platform'
      )
    LIMIT p_batch_size
  )
  INSERT INTO organization_vehicles (organization_id, vehicle_id, relationship_type, status, auto_tagged, notes)
  SELECT organization_id, vehicle_id, 'auction_platform', 'active', true, 'External listing platform'
  FROM platform_batch
  ON CONFLICT (organization_id, vehicle_id, relationship_type) DO NOTHING;

  GET DIAGNOSTICS v_platform = ROW_COUNT;

  inserted_seller := v_seller;
  inserted_platform := v_platform;
  RETURN NEXT;
END;
$$;

-- 4) timeline_events: vehicle_id + organization_id (participant org) → work_location
CREATE OR REPLACE FUNCTION backfill_org_vehicles_from_timeline_events(p_batch_size int DEFAULT 2000)
RETURNS TABLE(inserted int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int;
BEGIN
  WITH candidates AS (
    SELECT DISTINCT te.organization_id, te.vehicle_id
    FROM timeline_events te
    WHERE te.vehicle_id IS NOT NULL AND te.organization_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM organization_vehicles ov
        WHERE ov.organization_id = te.organization_id AND ov.vehicle_id = te.vehicle_id AND ov.relationship_type = 'work_location'
      )
    LIMIT p_batch_size
  )
  INSERT INTO organization_vehicles (organization_id, vehicle_id, relationship_type, status, auto_tagged, notes)
  SELECT organization_id, vehicle_id, 'work_location', 'active', true, 'Timeline event'
  FROM candidates
  ON CONFLICT (organization_id, vehicle_id, relationship_type) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  inserted := v_inserted;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION backfill_org_vehicles_from_build_threads(int) IS 'Link vehicles from forum build_threads to forum orgs (business_name = forum_sources.slug). Run in loop until inserted=0.';
COMMENT ON FUNCTION backfill_org_vehicles_from_origin_org(int) IS 'Link vehicles to their origin_organization_id as sold_by. Run in loop until inserted=0.';
COMMENT ON FUNCTION backfill_org_vehicles_from_external_listings(int) IS 'Link external_listings seller + platform to organization_vehicles. Run in loop until both 0.';
COMMENT ON FUNCTION backfill_org_vehicles_from_timeline_events(int) IS 'Link timeline_events (vehicle_id, organization_id) as work_location. Run in loop until inserted=0.';
