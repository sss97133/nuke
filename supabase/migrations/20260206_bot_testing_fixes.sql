-- =============================================================================
-- Bot Testing Fixes Migration
-- Date: 2026-02-06
-- Description: Consolidates SQL fixes applied directly via psql during bot
--   testing into a proper migration file for version control.
--
-- Fixes included:
--   1. Fix trigger search_path for profile completion functions
--   2. Ensure profile_completion table exists (simpler schema)
--   3. Simplified market_segments_index view (no expensive subqueries)
--   4. get_user_vehicles_dashboard RPC with public_vehicles section
-- =============================================================================


-- =============================================================================
-- FIX 1: Profile completion trigger search_path
-- =============================================================================
-- Problem: handle_new_user() sets search_path to empty string, which breaks
-- update_profile_completion_trigger() and calculate_profile_completion() because
-- they can't find the profile_completion table or other public schema objects.
-- Fix: SET search_path TO 'public' on both functions and qualify table names.

CREATE OR REPLACE FUNCTION calculate_profile_completion(user_uuid UUID)
RETURNS INTEGER AS $$
DECLARE
  completion_count INTEGER := 0;
  total_fields INTEGER := 7;
  completion_record public.profile_completion%ROWTYPE;
BEGIN
  SELECT * INTO completion_record
  FROM public.profile_completion
  WHERE user_id = user_uuid;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  -- Count completed fields
  IF completion_record.basic_info_complete THEN completion_count := completion_count + 1; END IF;
  IF completion_record.avatar_uploaded THEN completion_count := completion_count + 1; END IF;
  IF completion_record.bio_added THEN completion_count := completion_count + 1; END IF;
  IF completion_record.social_links_added THEN completion_count := completion_count + 1; END IF;
  IF completion_record.first_vehicle_added THEN completion_count := completion_count + 1; END IF;
  IF completion_record.skills_added THEN completion_count := completion_count + 1; END IF;
  IF completion_record.location_added THEN completion_count := completion_count + 1; END IF;

  RETURN (completion_count * 100) / total_fields;
END;
$$ LANGUAGE plpgsql
   SET search_path TO 'public';


CREATE OR REPLACE FUNCTION update_profile_completion_trigger()
RETURNS TRIGGER AS $$
BEGIN
  -- Ensure profile_completion record exists
  INSERT INTO public.profile_completion (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  -- Update completion fields
  UPDATE public.profile_completion SET
    basic_info_complete = (NEW.full_name IS NOT NULL AND NEW.full_name != ''),
    avatar_uploaded = (NEW.avatar_url IS NOT NULL AND NEW.avatar_url != ''),
    bio_added = (NEW.bio IS NOT NULL AND NEW.bio != ''),
    location_added = (NEW.location IS NOT NULL AND NEW.location != ''),
    social_links_added = (NEW.website_url IS NOT NULL OR NEW.github_url IS NOT NULL OR NEW.linkedin_url IS NOT NULL),
    last_updated = NOW()
  WHERE user_id = NEW.id;

  -- Update completion percentage
  UPDATE public.profile_completion SET
    total_completion_percentage = calculate_profile_completion(NEW.id)
  WHERE user_id = NEW.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql
   SET search_path TO 'public';


-- =============================================================================
-- FIX 2: Ensure profile_completion table exists
-- =============================================================================
-- The profile_completion table was referenced by triggers but could be missing
-- in some environments. The canonical version is from 20250131 migration with
-- boolean completion fields. This IF NOT EXISTS ensures it's present without
-- conflicting with the existing table.

CREATE TABLE IF NOT EXISTS public.profile_completion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  basic_info_complete BOOLEAN DEFAULT false,
  avatar_uploaded BOOLEAN DEFAULT false,
  bio_added BOOLEAN DEFAULT false,
  social_links_added BOOLEAN DEFAULT false,
  first_vehicle_added BOOLEAN DEFAULT false,
  skills_added BOOLEAN DEFAULT false,
  location_added BOOLEAN DEFAULT false,
  total_completion_percentage INTEGER DEFAULT 0
    CHECK (total_completion_percentage >= 0 AND total_completion_percentage <= 100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure RLS is enabled (idempotent)
ALTER TABLE public.profile_completion ENABLE ROW LEVEL SECURITY;

-- Index (idempotent)
CREATE INDEX IF NOT EXISTS idx_profile_completion_user_id
  ON public.profile_completion(user_id);


-- =============================================================================
-- FIX 3: Simplified market_segments_index view
-- =============================================================================
-- Problem: The original view used CROSS JOIN LATERAL with market_segment_stats()
-- which was expensive and could timeout. The fix returns segment metadata with
-- just a simple LEFT JOIN on market_funds -- no expensive subqueries.

DROP VIEW IF EXISTS market_segments_index;

CREATE OR REPLACE VIEW market_segments_index AS
SELECT
  s.id as segment_id,
  s.slug,
  s.name,
  s.description,
  s.manager_type,
  s.status,
  s.year_min,
  s.year_max,
  s.makes,
  s.model_keywords,
  0 as vehicle_count,
  COALESCE(f.total_aum_usd, 0)::numeric as market_cap_usd,
  NULL::numeric as change_7d_pct,
  NULL::numeric as change_30d_pct,
  0 as subcategory_count,
  '[]'::jsonb as subcategories
FROM market_segments s
LEFT JOIN market_funds f ON f.segment_id = s.id AND f.status = 'active'
WHERE s.status = 'active';

GRANT SELECT ON market_segments_index TO anon, authenticated;


-- =============================================================================
-- FIX 4: get_user_vehicles_dashboard RPC with public_vehicles section
-- =============================================================================
-- Problem: The original dashboard RPC only showed vehicles the user owned or
-- had verified ownership of. For new users (or users without vehicles), the
-- dashboard was completely empty. Fix adds a public_vehicles section that
-- shows recently added public vehicles, excluding ones already in my_vehicles.

DROP FUNCTION IF EXISTS get_user_vehicles_dashboard(UUID);

CREATE OR REPLACE FUNCTION get_user_vehicles_dashboard(p_user_id UUID)
RETURNS JSONB AS $$
DECLARE
  result JSONB;
  my_vehicles_json JSONB;
  public_vehicles_json JSONB;
  business_fleets_json JSONB;
BEGIN
  -- My vehicles: owned or verified
  SELECT COALESCE(jsonb_agg(row_data ORDER BY acquisition_date DESC), '[]'::jsonb)
  INTO my_vehicles_json
  FROM (
    SELECT jsonb_build_object(
      'vehicle_id', v.id,
      'year', v.year,
      'make', v.make,
      'model', v.model,
      'vin', v.vin,
      'acquisition_date', COALESCE(ov.created_at, vup.created_at, v.created_at),
      'ownership_role', COALESCE(
        CASE WHEN ov.id IS NOT NULL THEN 'verified_owner' ELSE NULL END,
        vup.role,
        'owner'
      ),
      'current_value', v.current_value,
      'purchase_price', v.purchase_price,
      'confidence_score', (
        (CASE WHEN v.vin IS NOT NULL AND LENGTH(TRIM(v.vin)) >= 11 THEN 15 ELSE 0 END) +
        (CASE WHEN v.year IS NOT NULL THEN 5 ELSE 0 END) +
        (CASE WHEN v.make IS NOT NULL THEN 5 ELSE 0 END) +
        (CASE WHEN v.model IS NOT NULL THEN 5 ELSE 0 END) +
        (CASE WHEN v.mileage IS NOT NULL THEN 5 ELSE 0 END) +
        (CASE WHEN v.color IS NOT NULL THEN 5 ELSE 0 END)
      ),
      'interaction_score', 0,
      'last_activity_date', NULL,
      'event_count', 0,
      'image_count', (SELECT COUNT(*)::int FROM vehicle_images vi WHERE vi.vehicle_id = v.id),
      'primary_image_url', (
        SELECT vi.image_url FROM vehicle_images vi
        WHERE vi.vehicle_id = v.id
        ORDER BY vi.is_primary DESC NULLS LAST, vi.created_at ASC
        LIMIT 1
      )
    ) as row_data,
    COALESCE(ov.created_at, vup.created_at, v.created_at) as acquisition_date
    FROM vehicles v
    LEFT JOIN ownership_verifications ov ON ov.vehicle_id = v.id
      AND ov.user_id = p_user_id AND ov.status = 'approved'
    LEFT JOIN vehicle_user_permissions vup ON vup.vehicle_id = v.id
      AND vup.user_id = p_user_id AND vup.is_active = true
      AND vup.role IN ('owner', 'co_owner')
    WHERE ov.id IS NOT NULL OR vup.id IS NOT NULL
    LIMIT 100
  ) sub;

  -- Public vehicles (discovery feed - what the homepage shows)
  SELECT COALESCE(jsonb_agg(row_data ORDER BY created_at DESC), '[]'::jsonb)
  INTO public_vehicles_json
  FROM (
    SELECT jsonb_build_object(
      'vehicle_id', v.id,
      'year', v.year,
      'make', v.make,
      'model', v.model,
      'vin', v.vin,
      'acquisition_date', v.created_at,
      'ownership_role', 'public',
      'current_value', v.current_value,
      'purchase_price', v.purchase_price,
      'confidence_score', (
        (CASE WHEN v.vin IS NOT NULL AND LENGTH(TRIM(v.vin)) >= 11 THEN 15 ELSE 0 END) +
        (CASE WHEN v.year IS NOT NULL THEN 5 ELSE 0 END) +
        (CASE WHEN v.make IS NOT NULL THEN 5 ELSE 0 END) +
        (CASE WHEN v.model IS NOT NULL THEN 5 ELSE 0 END) +
        (CASE WHEN v.mileage IS NOT NULL THEN 5 ELSE 0 END) +
        (CASE WHEN v.color IS NOT NULL THEN 5 ELSE 0 END)
      ),
      'interaction_score', 0,
      'last_activity_date', NULL,
      'event_count', 0,
      'image_count', (SELECT COUNT(*)::int FROM vehicle_images vi WHERE vi.vehicle_id = v.id),
      'primary_image_url', (
        SELECT vi.image_url FROM vehicle_images vi
        WHERE vi.vehicle_id = v.id
        ORDER BY vi.is_primary DESC NULLS LAST, vi.created_at ASC
        LIMIT 1
      )
    ) as row_data,
    v.created_at
    FROM vehicles v
    WHERE COALESCE(v.is_public, true) = true
      -- Exclude vehicles already in my_vehicles
      AND NOT EXISTS (
        SELECT 1 FROM ownership_verifications ov2
        WHERE ov2.vehicle_id = v.id AND ov2.user_id = p_user_id AND ov2.status = 'approved'
      )
      AND NOT EXISTS (
        SELECT 1 FROM vehicle_user_permissions vup2
        WHERE vup2.vehicle_id = v.id AND vup2.user_id = p_user_id AND vup2.is_active = true
          AND vup2.role IN ('owner', 'co_owner')
      )
    ORDER BY v.created_at DESC
    LIMIT 200
  ) sub;

  -- Business fleets
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'business_id', b.id,
      'business_name', b.business_name,
      'vehicle_count', (
        SELECT COUNT(*) FROM business_vehicle_fleet bvf
        WHERE bvf.business_id = b.id AND bvf.status = 'active'
      ),
      'vehicles', (
        SELECT COALESCE(jsonb_agg(
          jsonb_build_object(
            'vehicle_id', v.id,
            'year', v.year,
            'make', v.make,
            'model', v.model,
            'fleet_role', bvf.fleet_role,
            'confidence_score', (
              (CASE WHEN v.vin IS NOT NULL AND LENGTH(TRIM(v.vin)) >= 11 THEN 15 ELSE 0 END) +
              (CASE WHEN v.year IS NOT NULL THEN 5 ELSE 0 END) +
              (CASE WHEN v.make IS NOT NULL THEN 5 ELSE 0 END) +
              (CASE WHEN v.model IS NOT NULL THEN 5 ELSE 0 END) +
              (CASE WHEN v.mileage IS NOT NULL THEN 5 ELSE 0 END) +
              (CASE WHEN v.color IS NOT NULL THEN 5 ELSE 0 END)
            ),
            'interaction_score', 0,
            'primary_image_url', (
              SELECT vi.image_url FROM vehicle_images vi
              WHERE vi.vehicle_id = v.id
              ORDER BY vi.is_primary DESC NULLS LAST, vi.created_at ASC
              LIMIT 1
            )
          )
        ), '[]'::jsonb)
        FROM business_vehicle_fleet bvf
        JOIN vehicles v ON v.id = bvf.vehicle_id
        WHERE bvf.business_id = b.id AND bvf.status = 'active'
        LIMIT 50
      )
    )
  ), '[]'::jsonb)
  INTO business_fleets_json
  FROM businesses b
  WHERE EXISTS (
    SELECT 1 FROM business_user_roles bur
    WHERE bur.business_id = b.id AND bur.user_id = p_user_id AND bur.status = 'active'
  ) OR EXISTS (
    SELECT 1 FROM business_ownership bo
    WHERE bo.business_id = b.id AND bo.owner_id = p_user_id AND bo.status = 'active'
  )
  LIMIT 10;

  result := jsonb_build_object(
    'my_vehicles', my_vehicles_json,
    'public_vehicles', public_vehicles_json,
    'client_vehicles', '[]'::jsonb,
    'business_fleets', business_fleets_json,
    'summary', jsonb_build_object(
      'total_my_vehicles', jsonb_array_length(my_vehicles_json),
      'total_public_vehicles', jsonb_array_length(public_vehicles_json),
      'total_client_vehicles', 0,
      'total_business_vehicles', (
        SELECT COALESCE(SUM((elem->>'vehicle_count')::int), 0)
        FROM jsonb_array_elements(business_fleets_json) elem
      ),
      'recent_activity_30d', 0
    )
  );

  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_user_vehicles_dashboard(UUID) TO authenticated;
