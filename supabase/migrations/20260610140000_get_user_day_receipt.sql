-- ============================================================================
-- get_user_day_receipt(p_user_id, p_date) — the END LAYER of the profile
-- timeline. Filed 2026-06-10 (profile round 3, Skylar's "click anxiety" fix).
--
-- Clicking a day on the user timeline must descend to the day's receipt:
-- the photos shot, the work done, the dollars moved, the facets touched.
-- USER-scoped sibling of get_daily_work_receipt (which is vehicle-scoped).
--
-- Privacy gating happens IN here via auth.uid(): the owner sees everything
-- (inbox photos, dollars, receipts); visitors see only photos attached to
-- public vehicles, no money. SECURITY DEFINER so the function (not RLS
-- per-row churn) controls the shape.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_user_day_receipt(p_user_id uuid, p_date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_owner boolean := (auth.uid() = p_user_id);
  v_photos jsonb;
  v_work jsonb;
  v_receipts jsonb := '[]'::jsonb;
  v_facets jsonb;
BEGIN
  -- Photos taken that day. Owner: all of theirs incl. inbox (vehicle_id NULL).
  -- Visitor: only frames attached to public vehicles.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', s.id, 'url', s.image_url, 'thumb', COALESCE(s.thumbnail_url, s.image_url),
           'vehicle_id', s.vehicle_id, 'taken_at', s.taken_at) ORDER BY s.taken_at), '[]'::jsonb)
  INTO v_photos
  FROM (
    SELECT vi.id, vi.image_url, vi.thumbnail_url, vi.vehicle_id, vi.taken_at
    FROM vehicle_images vi
    LEFT JOIN vehicles v ON v.id = vi.vehicle_id
    WHERE vi.user_id = p_user_id
      AND vi.taken_at >= p_date::timestamptz
      AND vi.taken_at < (p_date + 1)::timestamptz
      AND COALESCE(vi.is_duplicate, false) = false
      AND (v_is_owner OR (vi.vehicle_id IS NOT NULL AND v.is_public = true))
    ORDER BY vi.taken_at
    LIMIT 60
  ) s;

  -- Work sessions that day (costs only for the owner).
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', ws.id,
           'title', COALESCE(ws.title, ws.work_type, 'work session'),
           'vehicle_id', ws.vehicle_id,
           'duration_minutes', ws.duration_minutes,
           'total_job_cost', CASE WHEN v_is_owner THEN ws.total_job_cost ELSE NULL END
         ) ORDER BY ws.start_time NULLS LAST), '[]'::jsonb)
  INTO v_work
  FROM work_sessions ws
  WHERE ws.user_id = p_user_id AND ws.session_date = p_date;

  -- Receipts that day — owner only.
  IF v_is_owner THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', r.id, 'vendor', r.vendor_name, 'total', r.total_amount,
             'vehicle_id', r.vehicle_id) ORDER BY r.total_amount DESC NULLS LAST), '[]'::jsonb)
    INTO v_receipts
    FROM receipts r
    WHERE r.user_id = p_user_id
      AND p_date IN (r.transaction_date, r.purchase_date, r.receipt_date);
  END IF;

  v_facets := jsonb_build_object(
    'photos', jsonb_array_length(v_photos),
    'work', jsonb_array_length(v_work),
    'receipts', jsonb_array_length(v_receipts)
  );

  RETURN jsonb_build_object(
    'date', p_date,
    'is_owner_view', v_is_owner,
    'photos', v_photos,
    'work_sessions', v_work,
    'receipts', v_receipts,
    'facets', v_facets
  );
END;
$$;

COMMENT ON FUNCTION public.get_user_day_receipt(uuid, date) IS
  'User-scoped day receipt for the profile timeline drill-down: photos, work, dollars (owner-only), facet counts. The end layer of end-to-end visibility.';

GRANT EXECUTE ON FUNCTION public.get_user_day_receipt(uuid, date) TO authenticated, anon;
