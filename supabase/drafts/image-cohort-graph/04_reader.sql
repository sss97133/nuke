-- DRAFT, NOT APPLIED. Per-image cohort graph: one reader for the iOS Library (replaces PhotoCohorts.read).
-- The union of: column edges on vehicle_images, the vehicle fold, image_cohort_edges, and the existing link tables.
-- Access: the public entry point is SECURITY INVOKER, so its first read of vehicle_images runs under the caller's RLS;
-- a photo the caller cannot read returns nothing. Only then does it call the SECURITY DEFINER worker, which lives in the
-- `private` schema (not exposed by PostgREST), so a client cannot call the worker directly. (An invoker probe called
-- FROM a definer function would run as the definer and bypass RLS, so the order matters.)
-- Organization names only for public orgs; private edges only to the uploader.
begin;
set local lock_timeout = '3s';
CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION public.image_cohorts_read(p_image_id uuid)
RETURNS TABLE (cohort_kind text, cohort_key text, cohort_id uuid, label text, role text, basis text, per_image boolean)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vehicle_images WHERE id = p_image_id) THEN RETURN; END IF;   -- caller's RLS
  RETURN QUERY SELECT * FROM private.image_cohorts_worker(p_image_id, auth.uid());
END $$;

CREATE OR REPLACE FUNCTION private.image_cohorts_worker(p_image_id uuid, v_uid uuid)
RETURNS TABLE (cohort_kind text, cohort_key text, cohort_id uuid, label text, role text, basis text, per_image boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_img record;
BEGIN
  SELECT id, vehicle_id, user_id, latitude, longitude, work_session_id, image_identity_id,
         coalesce(is_sensitive,false) OR vision_gate_status = 'rejected_personal' AS private
    INTO v_img FROM vehicle_images WHERE id = p_image_id;

  RETURN QUERY
  SELECT 'vehicle', v_img.vehicle_id::text, v_img.vehicle_id, NULL::text, NULL::text, 'vehicle_images.vehicle_id', true
    WHERE v_img.vehicle_id IS NOT NULL
  UNION ALL
  SELECT 'uploader', v_img.user_id::text, v_img.user_id, NULL, NULL, 'vehicle_images.user_id', true
    WHERE v_img.user_id IS NOT NULL
  UNION ALL
  SELECT 'work_session', v_img.work_session_id::text, v_img.work_session_id, NULL, NULL, 'vehicle_images.work_session_id', true
    WHERE v_img.work_session_id IS NOT NULL
  UNION ALL
  -- the fold: the vehicle's cohorts (make, model, year_model, generation, series, organization)
  SELECT e.cohort_kind, e.cohort_key, e.cohort_id,
         CASE WHEN e.cohort_kind = 'organization' THEN o.business_name END, e.role, 'vehicle_cohort_edges', false
    FROM vehicle_cohort_edges e
    LEFT JOIN organizations o ON e.cohort_kind = 'organization' AND o.id = e.cohort_id
   WHERE e.vehicle_id = v_img.vehicle_id AND e.superseded_at IS NULL
     AND (e.cohort_kind <> 'organization' OR coalesce(o.is_public, false))
  UNION ALL
  -- private organizations are counted, never named
  SELECT 'organization_private', count(*)::text, NULL, NULL, NULL, 'vehicle_cohort_edges', false
    FROM vehicle_cohort_edges e LEFT JOIN organizations o ON o.id = e.cohort_id
   WHERE e.vehicle_id = v_img.vehicle_id AND e.superseded_at IS NULL AND e.cohort_kind = 'organization'
     AND NOT coalesce(o.is_public, false)
  HAVING count(*) > 0
  UNION ALL
  -- per-image computed edges (place cell, zcta, capture session, work order, data set, garage)
  SELECT e.cohort_kind, e.cohort_key, e.cohort_id, NULL, NULL, e.basis, true
    FROM image_cohort_edges e
   WHERE e.image_id = p_image_id AND e.superseded_at IS NULL
     AND (e.visibility = 'inherit' OR e.originator_user_id = v_uid)
  UNION ALL
  -- keys: registered readings this photo witnesses (property / descriptor keys)
  SELECT 'key', coalesce(op.property_key, vo.kind::text), vo.id, op.label, NULL, 'observation_witnesses', true
    FROM observation_witnesses w
    JOIN vehicle_observations vo ON vo.id = w.observation_id
    LEFT JOIN observation_properties op ON op.id = vo.property_id
   WHERE w.image_id = p_image_id
  UNION ALL
  -- the listing the photo came from
  SELECT 'listing', l.auction_event_id::text, l.auction_event_id, NULL, NULL, 'vehicle_image_listing_links', true
    FROM vehicle_image_listing_links l WHERE l.image_id = p_image_id AND l.retired_at IS NULL;
END $$;

REVOKE ALL ON FUNCTION public.image_cohorts_read(uuid), private.image_cohorts_worker(uuid, uuid) FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION public.image_cohorts_read(uuid), private.image_cohorts_worker(uuid, uuid) TO authenticated;
-- Check before applying: `private` must not be in the API's exposed schemas (Supabase: Settings > API > Exposed schemas).

commit;
-- Column names checked against information_schema on 2026-11-23 (vehicle_observations.property_id ->
-- observation_properties.property_key; vehicle_image_listing_links.auction_event_id, retired_at).
