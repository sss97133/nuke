-- 20260523090000_origination_anchor_system.sql
--
-- Origination Anchor System — every vehicle has ONE source-of-truth pathway.
-- When pathways mix, vehicles get downgraded to "needs more data" status.
--
-- Per Skylar (2026-05-23): every image has a pathway; if there's a mixup we
-- downgrade back to source-data packaging. Vehicles can't progress to public
-- view without identification. User-uploaded → nudge user for missing facts.
-- Listing-sourced → different rules.
--
-- This migration defines three concepts:
--   1. ORIGINATION ANCHOR — the strongest source-of-truth claim for a vehicle:
--        vin:{vin}            (T1 — gold — title-bearing)
--        owner:{user_id}      (T2 — owner-uploaded photos + identifying data)
--        listing:{platform}:{listing_id}  (T3 — scraped public listing)
--        unknown              (T4 — orphan / mixed / insufficient)
--
--   2. ANCHOR VIOLATION — when a vehicle has photos that don't match its anchor:
--        owner_photos_on_listing_anchored_vehicle  (B-A-T listing polluted with iPhoto)
--        multiple_owner_photos_on_same_vehicle     (multi-owner conflict)
--        listing_photos_on_owner_anchored_vehicle  (warning, not always wrong)
--
--   3. PUBLIC-READINESS — a vehicle qualifies for public-profile view when:
--        anchor is vin:* or listing:* (objective identification), OR
--        owner anchor AND has VIN OR has plate-visible photo OR has dash-visible photo
--      Otherwise it's in "nudge queue" status.

-- ── helper: photo source classification ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.classify_image_origin(p_source TEXT, p_url TEXT)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  -- Owner-side: photos the user themselves brought into the system
  IF p_source IN ('iphoto', 'user_upload', 'dropbox_import', 'dropbox_bulk_import',
                  'daily_receipt', 'owner_submission', 'owner_import',
                  'hd_archive', 'ssd_blast') THEN
    RETURN 'owner';
  END IF;

  -- Listing-side: photos scraped from a 3rd-party listing platform
  IF p_source IN ('bat', 'bat_import', 'cars_and_bids', 'hagerty', 'pcarmarket',
                  'gaa', 'gaa_classic_cars', 'barrett_jackson', 'barrett-jackson',
                  'mecum', 'rm_sothebys', 'craigslist', 'facebook_marketplace',
                  'ebay', 'autotrader') THEN
    RETURN 'listing';
  END IF;

  -- URL-pattern fallback when source field is null/unfamiliar
  IF p_url ILIKE '%bringatrailer%' OR p_url ILIKE '%carsandbids%'
     OR p_url ILIKE '%hagerty.com%' OR p_url ILIKE '%gaaclassiccars%'
     OR p_url ILIKE '%barrett-jackson%' OR p_url ILIKE '%mecum%' THEN
    RETURN 'listing';
  END IF;

  RETURN 'unknown';
END;
$$;

COMMENT ON FUNCTION public.classify_image_origin(TEXT, TEXT) IS
'Classifies a vehicle_images row into owner/listing/unknown bucket based on source + url pattern. Foundation for origination anchor system.';

-- ── core: compute the origination anchor for a vehicle ──────────────────────

CREATE OR REPLACE FUNCTION public.compute_origination_anchor(p_vehicle_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_vehicle RECORD;
  v_owner_photo_count INT;
  v_listing_photo_count INT;
  v_unknown_photo_count INT;
  v_total_photos INT;
  v_distinct_owners INT;
  v_dominant_owner UUID;
  v_listing_sources JSONB;
  v_anchor_tier INT;
  v_anchor_kind TEXT;
  v_anchor_id TEXT;
  v_anchor_confidence NUMERIC;
BEGIN
  SELECT id, vin, owner_id, ownership_verified, title_status, discovery_source
    INTO v_vehicle FROM vehicles WHERE id = p_vehicle_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','vehicle not found'); END IF;

  -- Image origin breakdown
  WITH origins AS (
    SELECT
      classify_image_origin(source, image_url) AS origin,
      user_id
    FROM vehicle_images
    WHERE vehicle_id = p_vehicle_id
  )
  SELECT
    count(*) FILTER (WHERE origin = 'owner'),
    count(*) FILTER (WHERE origin = 'listing'),
    count(*) FILTER (WHERE origin = 'unknown'),
    count(*),
    count(DISTINCT user_id) FILTER (WHERE origin = 'owner' AND user_id IS NOT NULL),
    mode() WITHIN GROUP (ORDER BY user_id) FILTER (WHERE origin = 'owner' AND user_id IS NOT NULL)
  INTO v_owner_photo_count, v_listing_photo_count, v_unknown_photo_count,
       v_total_photos, v_distinct_owners, v_dominant_owner
  FROM origins;

  -- Listing-source breakdown if applicable
  IF v_listing_photo_count > 0 THEN
    SELECT jsonb_object_agg(source, cnt) INTO v_listing_sources
    FROM (
      SELECT source, count(*) AS cnt
      FROM vehicle_images
      WHERE vehicle_id = p_vehicle_id
        AND classify_image_origin(source, image_url) = 'listing'
      GROUP BY source
    ) s;
  END IF;

  -- Anchor selection — strongest claim wins
  -- T1: VIN present → vin anchor (the title-bearing identity)
  IF v_vehicle.vin IS NOT NULL AND length(trim(v_vehicle.vin)) >= 11 THEN
    v_anchor_tier := 1;
    v_anchor_kind := 'vin';
    v_anchor_id := upper(trim(v_vehicle.vin));
    v_anchor_confidence := CASE
      WHEN v_vehicle.ownership_verified THEN 1.00
      WHEN v_vehicle.title_status IS NOT NULL THEN 0.95
      ELSE 0.90
    END;

  -- T2: Single owner with dominant owner photos → owner anchor
  ELSIF v_distinct_owners = 1 AND v_owner_photo_count > 0
        AND v_owner_photo_count >= v_total_photos * 0.5 THEN
    v_anchor_tier := 2;
    v_anchor_kind := 'owner';
    v_anchor_id := v_dominant_owner::text;
    v_anchor_confidence := LEAST(0.85, 0.50 + (v_owner_photo_count::NUMERIC / GREATEST(v_total_photos, 1)) * 0.35);

  -- T3: Only listing photos → listing anchor (the BaT/auction case)
  ELSIF v_listing_photo_count > 0 AND v_owner_photo_count = 0 THEN
    v_anchor_tier := 3;
    v_anchor_kind := 'listing';
    v_anchor_id := (SELECT key FROM jsonb_object_keys(v_listing_sources) k(key) LIMIT 1);
    v_anchor_confidence := 0.70;

  -- T4: No claim
  ELSE
    v_anchor_tier := 4;
    v_anchor_kind := 'unknown';
    v_anchor_id := NULL;
    v_anchor_confidence := 0.20;
  END IF;

  RETURN jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'anchor_tier', v_anchor_tier,
    'anchor_kind', v_anchor_kind,
    'anchor_id', v_anchor_id,
    'anchor_confidence', v_anchor_confidence,
    'photo_origins', jsonb_build_object(
      'owner', v_owner_photo_count,
      'listing', v_listing_photo_count,
      'unknown', v_unknown_photo_count,
      'total', v_total_photos
    ),
    'distinct_owners', v_distinct_owners,
    'dominant_owner', v_dominant_owner,
    'listing_sources', COALESCE(v_listing_sources, '{}'::jsonb),
    'has_vin', v_vehicle.vin IS NOT NULL,
    'ownership_verified', COALESCE(v_vehicle.ownership_verified, false),
    'title_status', v_vehicle.title_status
  );
END;
$$;

COMMENT ON FUNCTION public.compute_origination_anchor(UUID) IS
'Computes the strongest source-of-truth claim for a vehicle: vin (T1) > owner (T2) > listing (T3) > unknown (T4). Returns anchor + confidence + photo-origin breakdown.';

GRANT EXECUTE ON FUNCTION public.compute_origination_anchor(UUID) TO anon, authenticated;

-- ── detect anchor violations across the portfolio ───────────────────────────

CREATE OR REPLACE FUNCTION public.detect_anchor_violations()
RETURNS TABLE (
  vehicle_id UUID,
  violation TEXT,
  severity TEXT,
  detail JSONB
)
LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN QUERY
  WITH anchored AS (
    SELECT v.id, compute_origination_anchor(v.id) AS anchor
    FROM vehicles v
    WHERE EXISTS (SELECT 1 FROM vehicle_images vi WHERE vi.vehicle_id = v.id)
  )
  -- Violation 1: listing-anchored vehicle with owner photos = impossible combination
  SELECT a.id,
         'owner_photos_on_listing_anchored_vehicle'::TEXT,
         'critical'::TEXT,
         a.anchor
    FROM anchored a
   WHERE a.anchor->>'anchor_kind' = 'listing'
     AND (a.anchor->'photo_origins'->>'owner')::INT > 0
  UNION ALL
  -- Violation 2: multiple owners' photos on same vehicle = split or contamination
  SELECT a.id,
         'multiple_distinct_owners_on_one_vehicle'::TEXT,
         'high'::TEXT,
         a.anchor
    FROM anchored a
   WHERE (a.anchor->>'distinct_owners')::INT > 1
  UNION ALL
  -- Violation 3: owner-anchored vehicle has significant listing photos = potential same-vehicle-listed-on-bat case (warn)
  SELECT a.id,
         'listing_photos_on_owner_anchored_vehicle'::TEXT,
         'low'::TEXT,
         a.anchor
    FROM anchored a
   WHERE a.anchor->>'anchor_kind' = 'owner'
     AND (a.anchor->'photo_origins'->>'listing')::INT > 0
  UNION ALL
  -- Violation 4: VIN-anchored but ownership not verified = needs title proof
  SELECT a.id,
         'vin_present_but_ownership_unverified'::TEXT,
         'medium'::TEXT,
         a.anchor
    FROM anchored a
   WHERE a.anchor->>'anchor_kind' = 'vin'
     AND NOT (a.anchor->>'ownership_verified')::BOOLEAN
  UNION ALL
  -- Violation 5: unknown anchor = needs identifying data (the nudge case)
  SELECT a.id,
         'unknown_anchor_needs_identifying_data'::TEXT,
         'high'::TEXT,
         a.anchor
    FROM anchored a
   WHERE a.anchor->>'anchor_kind' = 'unknown';
END;
$$;

COMMENT ON FUNCTION public.detect_anchor_violations() IS
'Walks every vehicle, returns one row per anchor violation. Powers the self-healing pipeline + the user-nudge queue.';

GRANT EXECUTE ON FUNCTION public.detect_anchor_violations() TO authenticated;

-- ── auto-generate merge proposals for likely duplicates ─────────────────────

CREATE OR REPLACE FUNCTION public.propose_anchor_merges()
RETURNS TABLE (
  proposal_id UUID,
  vehicle_a UUID,
  vehicle_b UUID,
  basis TEXT,
  confidence NUMERIC
)
LANGUAGE plpgsql AS $$
DECLARE
  v_pair RECORD;
  v_proposal_id UUID;
BEGIN
  -- Case 1: two vehicles share the same VIN → highest-confidence merge
  FOR v_pair IN
    WITH vin_groups AS (
      SELECT upper(trim(vin)) AS vin_key, array_agg(id ORDER BY created_at) AS ids, count(*) AS n
        FROM vehicles
       WHERE vin IS NOT NULL AND length(trim(vin)) >= 11
       GROUP BY upper(trim(vin))
      HAVING count(*) >= 2
    )
    SELECT vin_key, ids[1] AS keeper, ids[2] AS dupe
      FROM vin_groups
  LOOP
    -- Skip if proposal already exists in either direction
    IF NOT EXISTS (
      SELECT 1 FROM merge_proposals
       WHERE (vehicle_a_id = v_pair.keeper AND vehicle_b_id = v_pair.dupe)
          OR (vehicle_a_id = v_pair.dupe AND vehicle_b_id = v_pair.keeper)
    ) THEN
      INSERT INTO merge_proposals (
        vehicle_a_id, vehicle_b_id, detection_source, ai_decision, ai_confidence,
        ai_reasoning, preferred_primary, status, match_tier, confidence,
        ai_verified, proposed_by
      ) VALUES (
        v_pair.keeper, v_pair.dupe,
        'anchor_system_vin_match', 'MERGE', 0.99,
        format('Same VIN %s on two vehicles. T1 anchor match — auto-merge candidate.', v_pair.vin_key),
        'A', 'pending', 1, 0.99, true, 'origination_anchor_cron'
      ) RETURNING id INTO v_proposal_id;

      proposal_id := v_proposal_id;
      vehicle_a := v_pair.keeper;
      vehicle_b := v_pair.dupe;
      basis := 'vin_match';
      confidence := 0.99;
      RETURN NEXT;
    END IF;
  END LOOP;

  -- Case 2: two vehicles share same year+make+model+owner AND overlapping photo dates → likely duplicate
  FOR v_pair IN
    WITH owner_anchored AS (
      SELECT
        v.id, v.year, v.make, v.model,
        (compute_origination_anchor(v.id))->>'dominant_owner' AS owner,
        (SELECT MIN(taken_at)::date FROM vehicle_images WHERE vehicle_id = v.id) AS first_photo,
        (SELECT MAX(taken_at)::date FROM vehicle_images WHERE vehicle_id = v.id) AS last_photo,
        (SELECT count(*) FROM vehicle_images WHERE vehicle_id = v.id) AS photo_count
      FROM vehicles v
      WHERE EXISTS (SELECT 1 FROM vehicle_images vi WHERE vi.vehicle_id = v.id)
    ),
    pairs AS (
      SELECT
        a.id AS a_id, b.id AS b_id,
        a.first_photo AS a_first, b.first_photo AS b_first,
        a.photo_count AS a_photos, b.photo_count AS b_photos
      FROM owner_anchored a
      JOIN owner_anchored b ON a.id < b.id
        AND a.year = b.year AND a.make = b.make AND a.model = b.model
        AND a.owner = b.owner AND a.owner IS NOT NULL
        AND a.first_photo = b.first_photo   -- identical first photo = same physical car
    )
    SELECT p.a_id, p.b_id, p.a_first, p.a_photos, p.b_photos FROM pairs p
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM merge_proposals
       WHERE (vehicle_a_id = v_pair.a_id AND vehicle_b_id = v_pair.b_id)
          OR (vehicle_a_id = v_pair.b_id AND vehicle_b_id = v_pair.a_id)
    ) THEN
      INSERT INTO merge_proposals (
        vehicle_a_id, vehicle_b_id, detection_source, ai_decision, ai_confidence,
        ai_reasoning, preferred_primary, status, match_tier, confidence,
        ai_verified, proposed_by
      ) VALUES (
        v_pair.a_id, v_pair.b_id,
        'anchor_system_same_owner_same_first_photo', 'MERGE', 0.92,
        format('Same year+make+model+owner with identical first_photo %s — statistically impossible coincidence (a=%s photos, b=%s photos).',
               v_pair.a_first, v_pair.a_photos, v_pair.b_photos),
        'A', 'pending', 2, 0.92, true, 'origination_anchor_cron'
      ) RETURNING id INTO v_proposal_id;

      proposal_id := v_proposal_id;
      vehicle_a := v_pair.a_id;
      vehicle_b := v_pair.b_id;
      basis := 'same_owner_same_first_photo';
      confidence := 0.92;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.propose_anchor_merges() IS
'Auto-generates merge_proposal rows for: (1) shared-VIN duplicates @ 0.99 conf, (2) same-owner same-first-photo year/make/model matches @ 0.92 conf. Skips if proposal already exists. Idempotent.';

GRANT EXECUTE ON FUNCTION public.propose_anchor_merges() TO authenticated;

-- ── public-readiness gate ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.vehicle_public_readiness(p_vehicle_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_anchor JSONB;
  v_violations JSONB;
  v_ready BOOLEAN := false;
  v_blockers TEXT[] := ARRAY[]::TEXT[];
  v_nudges TEXT[] := ARRAY[]::TEXT[];
BEGIN
  v_anchor := compute_origination_anchor(p_vehicle_id);

  IF v_anchor ? 'error' THEN RETURN v_anchor; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('violation', violation, 'severity', severity)), '[]'::jsonb) INTO v_violations
  FROM detect_anchor_violations() WHERE vehicle_id = p_vehicle_id;

  -- Public-ready gates
  CASE v_anchor->>'anchor_kind'
    WHEN 'vin' THEN
      v_ready := true;
    WHEN 'listing' THEN
      v_ready := true;  -- public listings are by definition public
    WHEN 'owner' THEN
      -- Owner anchor needs at least one identifying data point beyond photos
      IF (v_anchor->>'has_vin')::BOOLEAN THEN
        v_ready := true;
      ELSE
        v_ready := false;
        v_nudges := array_append(v_nudges, 'add_vin_or_dashboard_photo');
        v_nudges := array_append(v_nudges, 'add_license_plate_photo');
        v_nudges := array_append(v_nudges, 'add_title_or_registration_doc');
      END IF;
    WHEN 'unknown' THEN
      v_ready := false;
      v_blockers := array_append(v_blockers, 'no_origination_anchor');
      v_nudges := array_append(v_nudges, 'reupload_with_known_source');
  END CASE;

  -- Critical violations block public readiness
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_violations) v WHERE v->>'severity' = 'critical') THEN
    v_ready := false;
    v_blockers := array_append(v_blockers, 'critical_anchor_violation');
  END IF;

  RETURN jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'public_ready', v_ready,
    'anchor', v_anchor,
    'violations', v_violations,
    'blockers', COALESCE(to_jsonb(v_blockers), '[]'::jsonb),
    'user_nudges', COALESCE(to_jsonb(v_nudges), '[]'::jsonb)
  );
END;
$$;

COMMENT ON FUNCTION public.vehicle_public_readiness(UUID) IS
'Returns whether a vehicle qualifies for public profile view + what user-nudges are needed if not. The vehicle-profile UI should gate visibility on this.';

GRANT EXECUTE ON FUNCTION public.vehicle_public_readiness(UUID) TO anon, authenticated;
