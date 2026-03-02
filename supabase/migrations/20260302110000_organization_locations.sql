-- ============================================================================
-- organization_locations: Multi-location support for organizations
-- ============================================================================
-- Organizations can have many physical locations (showrooms, warehouses, estates).
-- Replaces the flat address/city/state/lat/lng on the organizations table for
-- orgs with >1 location. The single-location org columns remain for backward
-- compatibility; this table is the canonical source for multi-location queries.
-- ============================================================================

-- 1. Create table
CREATE TABLE IF NOT EXISTS organization_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Identity
  label TEXT,
  location_type TEXT CHECK (location_type IN (
    'headquarters', 'showroom', 'warehouse', 'storage', 'workshop',
    'office', 'residence', 'estate', 'museum', 'event_venue',
    'dealership', 'auction_facility', 'garage', 'other'
  )),
  is_primary BOOLEAN DEFAULT false,

  -- Address
  street_address TEXT,
  city TEXT,
  state TEXT,
  zip_code TEXT,
  country TEXT DEFAULT 'US',

  -- Coordinates
  latitude NUMERIC(10, 8),
  longitude NUMERIC(11, 8),

  -- Geocoding provenance
  geocode_source TEXT CHECK (geocode_source IN (
    'manual', 'nominatim', 'lookup_table', 'imported'
  )),
  geocode_confidence NUMERIC(4, 2),
  geocoded_at TIMESTAMPTZ,

  -- Contact (location-specific)
  phone TEXT,
  email TEXT,

  -- Metadata
  notes TEXT,
  metadata JSONB DEFAULT '{}',

  -- Provenance
  source TEXT DEFAULT 'manual' CHECK (source IN (
    'manual', 'backfill_primary', 'backfill_metadata', 'enrichment'
  )),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Indexes
CREATE INDEX IF NOT EXISTS idx_org_locations_org
  ON organization_locations(organization_id);

CREATE INDEX IF NOT EXISTS idx_org_locations_gps
  ON organization_locations(latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_org_locations_city_state
  ON organization_locations(city, state)
  WHERE city IS NOT NULL;

-- Enforce max one primary location per org
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_locations_one_primary
  ON organization_locations(organization_id)
  WHERE is_primary = true;

-- 3. Column comments
COMMENT ON TABLE organization_locations IS
  'Multi-location support for organizations. Each org can have many locations (showrooms, warehouses, estates). Canonical source for org location queries and map rendering.';
COMMENT ON COLUMN organization_locations.label IS
  'Human-readable name for this location: "Palm Beach Estate", "Main Workshop"';
COMMENT ON COLUMN organization_locations.is_primary IS
  'Primary/default location shown on org cards and map pins. Max one per org (enforced by partial unique index).';
COMMENT ON COLUMN organization_locations.geocode_source IS
  'How coordinates were obtained: manual, nominatim (OSM), lookup_table (fb_marketplace_locations), imported (backfill)';
COMMENT ON COLUMN organization_locations.source IS
  'How this row was created: manual (user), backfill_primary (from org table), backfill_metadata (from org metadata JSONB), enrichment (AI/pipeline)';

-- 4. RLS
ALTER TABLE organization_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone views org locations" ON organization_locations
  FOR SELECT USING (true);

CREATE POLICY "Owners manage org locations" ON organization_locations
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM organization_contributors oc
      WHERE oc.organization_id = organization_locations.organization_id
        AND oc.user_id = auth.uid()
        AND oc.status = 'active'
        AND oc.role IN ('owner', 'co_founder', 'board_member', 'manager')
    )
  );

CREATE POLICY "Service role manages org locations" ON organization_locations
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 5. Add location_id FK to organization_vehicles
ALTER TABLE organization_vehicles
  ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES organization_locations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_org_vehicles_location
  ON organization_vehicles(location_id)
  WHERE location_id IS NOT NULL;

COMMENT ON COLUMN organization_vehicles.location_id IS
  'Optional FK to specific org location where this vehicle relationship applies. NULL = org-level (no specific location).';

-- 6. Updated_at trigger
CREATE OR REPLACE FUNCTION trg_org_locations_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_org_locations_updated_at
  BEFORE UPDATE ON organization_locations
  FOR EACH ROW
  EXECUTE FUNCTION trg_org_locations_updated_at();

-- 7. Backfill primary locations from organizations table
-- ~4,585 orgs with city/address/lat data → one primary location each
DO $$
DECLARE
  batch_size INT := 500;
  affected INT;
  total INT := 0;
BEGIN
  LOOP
    INSERT INTO organization_locations (
      organization_id, street_address, city, state, zip_code, country,
      latitude, longitude, is_primary, source,
      geocode_source, geocode_confidence, geocoded_at, created_at
    )
    SELECT
      o.id,
      o.address,
      o.city,
      o.state,
      o.zip_code,
      COALESCE(o.country, 'US'),
      o.latitude,
      o.longitude,
      true,
      'backfill_primary',
      CASE WHEN o.latitude IS NOT NULL THEN 'imported' END,
      CASE WHEN o.latitude IS NOT NULL THEN 0.80 END,
      CASE WHEN o.latitude IS NOT NULL THEN now() END,
      COALESCE(o.created_at, now())
    FROM organizations o
    WHERE (o.city IS NOT NULL OR o.address IS NOT NULL OR o.latitude IS NOT NULL)
      AND NOT EXISTS (
        SELECT 1 FROM organization_locations ol
        WHERE ol.organization_id = o.id AND ol.is_primary = true
      )
    LIMIT batch_size;

    GET DIAGNOSTICS affected = ROW_COUNT;
    total := total + affected;
    EXIT WHEN affected = 0;
    PERFORM pg_sleep(0.1);
  END LOOP;

  RAISE NOTICE 'Backfilled % primary locations from organizations', total;
END $$;

-- 8. Unpack Epstein Collection metadata.locations[] into proper rows
-- Org a7648282-04c3-4b1c-9025-fb6ee55dccf6 has 5 locations in JSONB
DO $$
DECLARE
  epstein_org_id UUID := 'a7648282-04c3-4b1c-9025-fb6ee55dccf6';
  loc JSONB;
  loc_type TEXT;
  loc_city TEXT;
  loc_state TEXT;
  loc_country TEXT;
BEGIN
  -- First, mark the existing backfilled primary as Palm Beach (it already is)
  -- Then insert the other 4 locations from metadata

  FOR loc IN
    SELECT value FROM organizations o,
    jsonb_array_elements(o.metadata->'locations') AS value
    WHERE o.id = epstein_org_id
  LOOP
    -- Map data.js location types to our enum
    loc_type := CASE
      WHEN loc->>'type' ILIKE '%island%' THEN 'estate'
      WHEN loc->>'type' ILIKE '%townhouse%' THEN 'residence'
      WHEN loc->>'type' ILIKE '%mansion%' THEN 'estate'
      WHEN loc->>'type' ILIKE '%ranch%' THEN 'estate'
      WHEN loc->>'type' ILIKE '%apartment%' THEN 'residence'
      ELSE 'other'
    END;

    -- Parse city/state from address
    loc_city := CASE loc->>'id'
      WHEN 'lsj' THEN 'Little Saint James'
      WHEN 'nyc' THEN 'New York'
      WHEN 'florida' THEN 'Palm Beach'
      WHEN 'nm' THEN 'Stanley'
      WHEN 'paris' THEN 'Paris'
    END;

    loc_state := CASE loc->>'id'
      WHEN 'lsj' THEN 'USVI'
      WHEN 'nyc' THEN 'NY'
      WHEN 'florida' THEN 'FL'
      WHEN 'nm' THEN 'NM'
      WHEN 'paris' THEN NULL
    END;

    loc_country := CASE loc->>'id'
      WHEN 'paris' THEN 'FR'
      ELSE 'US'
    END;

    -- Skip if this location already exists (by label match)
    IF NOT EXISTS (
      SELECT 1 FROM organization_locations
      WHERE organization_id = epstein_org_id
        AND label = loc->>'name'
    ) THEN
      -- If this matches the already-backfilled primary (Palm Beach), update it instead
      IF loc->>'id' = 'florida' THEN
        UPDATE organization_locations
        SET label = loc->>'name',
            location_type = loc_type,
            street_address = loc->>'address',
            notes = loc->>'description',
            metadata = jsonb_build_object(
              'shortName', loc->>'shortName',
              'holdingCompany', loc->>'holdingCompany',
              'propertyValue', loc->>'value',
              'propertyType', loc->>'type',
              'sourceId', loc->>'id'
            ),
            source = 'backfill_metadata'
        WHERE organization_id = epstein_org_id AND is_primary = true;
      ELSE
        INSERT INTO organization_locations (
          organization_id, label, location_type, is_primary,
          street_address, city, state, country,
          notes, metadata, source
        ) VALUES (
          epstein_org_id,
          loc->>'name',
          loc_type,
          false,
          loc->>'address',
          loc_city,
          loc_state,
          loc_country,
          loc->>'description',
          jsonb_build_object(
            'shortName', loc->>'shortName',
            'holdingCompany', loc->>'holdingCompany',
            'propertyValue', loc->>'value',
            'propertyType', loc->>'type',
            'sourceId', loc->>'id'
          ),
          'backfill_metadata'
        );
      END IF;
    END IF;
  END LOOP;

  RAISE NOTICE 'Unpacked Epstein Collection metadata locations';
END $$;

-- 9. Link Epstein vehicles to their locations by city/state matching
-- Note: disable heavy org stats trigger to avoid statement timeout
ALTER TABLE organization_vehicles DISABLE TRIGGER auto_update_primary_focus_on_org_vehicles;

DO $$
DECLARE
  epstein_org_id UUID := 'a7648282-04c3-4b1c-9025-fb6ee55dccf6';
  rec RECORD;
  matched_location_id UUID;
  linked INT := 0;
BEGIN
  FOR rec IN
    SELECT ovt.id AS ov_id, v.city AS v_city, v.state AS v_state
    FROM organization_vehicles ovt
    JOIN vehicles v ON v.id = ovt.vehicle_id
    WHERE ovt.organization_id = epstein_org_id
      AND ovt.location_id IS NULL
      AND v.city IS NOT NULL
  LOOP
    matched_location_id := NULL;

    SELECT ol.id INTO matched_location_id
    FROM organization_locations ol
    WHERE ol.organization_id = epstein_org_id
      AND LOWER(ol.city) = LOWER(rec.v_city)
    LIMIT 1;

    IF matched_location_id IS NULL THEN
      SELECT ol.id INTO matched_location_id
      FROM organization_locations ol
      WHERE ol.organization_id = epstein_org_id
        AND (
          (rec.v_state IN ('FL', 'Florida') AND ol.state = 'FL')
          OR (rec.v_state IN ('NY', 'New York') AND ol.state = 'NY')
          OR (rec.v_state IN ('NM', 'New Mexico') AND ol.state = 'NM')
          OR (rec.v_state IN ('USVI', 'U.S. Virgin Islands') AND ol.state = 'USVI')
          OR (rec.v_state = 'Île-de-France' AND ol.country = 'FR')
        )
      LIMIT 1;
    END IF;

    IF matched_location_id IS NOT NULL THEN
      UPDATE organization_vehicles
      SET location_id = matched_location_id
      WHERE id = rec.ov_id;
      linked := linked + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'Linked % Epstein vehicles to locations', linked;
END $$;

ALTER TABLE organization_vehicles ENABLE TRIGGER auto_update_primary_focus_on_org_vehicles;

-- 10. search_organizations_near() RPC — PostGIS proximity search
CREATE OR REPLACE FUNCTION search_organizations_near(
  p_latitude NUMERIC,
  p_longitude NUMERIC,
  p_radius_km NUMERIC DEFAULT 50
)
RETURNS TABLE(
  organization_id UUID,
  location_id UUID,
  business_name TEXT,
  label TEXT,
  city TEXT,
  state TEXT,
  latitude NUMERIC,
  longitude NUMERIC,
  distance_km NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ol.organization_id,
    ol.id AS location_id,
    o.business_name,
    ol.label,
    ol.city,
    ol.state,
    ol.latitude,
    ol.longitude,
    (ST_Distance(
      ST_MakePoint(ol.longitude::float8, ol.latitude::float8)::geography,
      ST_MakePoint(p_longitude::float8, p_latitude::float8)::geography
    ) / 1000.0)::NUMERIC AS distance_km
  FROM organization_locations ol
  JOIN organizations o ON o.id = ol.organization_id
  WHERE ol.latitude IS NOT NULL
    AND ol.longitude IS NOT NULL
    AND ST_DWithin(
      ST_MakePoint(ol.longitude::float8, ol.latitude::float8)::geography,
      ST_MakePoint(p_longitude::float8, p_latitude::float8)::geography,
      (p_radius_km * 1000)::float8
    )
  ORDER BY distance_km ASC;
END;
$$;

COMMENT ON FUNCTION search_organizations_near IS
  'Find organizations near a point. Returns all org locations within p_radius_km (default 50km), sorted by distance.';
