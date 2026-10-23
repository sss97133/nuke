-- Priorities, derived from the caller's own photos. Read-only: nothing here writes a row.
--
-- Nothing is hard-coded: no GPS constants, org ids or vehicle lists. The "lot" is the densest
-- recurring cluster of the caller's own photo GPS (by distinct days, over 180 days of taken_at).
-- Presence per vehicle identity (merged records followed to the survivor; unassigned photos joined
-- through existing match signals) comes from first/last seen at that place by taken_at.
--
-- Org links are optional context: pass p_org (you must own or be an active member) to add held-
-- inventory signals (carrying cost, listing, service order). Every derived money figure is built from
-- an assumption in shop_priority_settings / shop_priority_default_assumptions(), each marked
-- source='assumed' until a person enters a real value; fields that don't exist are listed in
-- details.missing, never filled in. Suggested service orders carry suggested=true and are not created.

CREATE TABLE IF NOT EXISTS public.shop_priority_settings (
  user_id uuid PRIMARY KEY,
  assumptions jsonb NOT NULL DEFAULT '{}'::jsonb,
  roles jsonb NOT NULL DEFAULT '["owner","tech","painter","upholstery"]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.shop_priority_settings IS
  'Per-user editable assumptions for shop_priorities_read. Each value carries source=assumed|entered.';
ALTER TABLE public.shop_priority_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shop_priority_settings_own_read ON public.shop_priority_settings;
CREATE POLICY shop_priority_settings_own_read ON public.shop_priority_settings
  FOR SELECT TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON public.shop_priority_settings FROM anon;
GRANT SELECT ON public.shop_priority_settings TO authenticated;

CREATE OR REPLACE FUNCTION public.shop_priority_default_assumptions()
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT '{
    "cost_of_money_apr":     {"value": 0.10, "source": "assumed", "note": "Annual cost of borrowed money until the real loan rate is entered"},
    "labor_rate_per_hour":   {"value": 125,  "source": "assumed", "note": "Shop labor rate until the real rate is entered"},
    "place_cell_degrees":    {"value": 0.003, "source": "assumed", "note": "GPS grid cell (~300 m) used to cluster photos into places"},
    "departed_after_days":   {"value": 7,    "source": "assumed", "note": "Not photographed at the lot for this many days counts as departed"},
    "auto_match_min_confidence": {"value": 0.7, "source": "assumed", "note": "Unassigned photos join a vehicle at or above this match confidence"}
  }'::jsonb
$$;

-- Presence of each vehicle identity at the caller's lot. Shared by shop_priorities_read.
CREATE OR REPLACE FUNCTION public.lot_presence_read(p_as_of timestamptz DEFAULT now())
RETURNS TABLE (
  vehicle_id uuid, year integer, make text, model text, vin text, status text, confidence text,
  lot_photos integer, lot_photos_unassigned integer, lot_days integer,
  first_seen_at_lot timestamptz, last_seen_at_lot timestamptz, last_seen_elsewhere timestamptz,
  merged_record_ids uuid[], lot_center jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $fn$
#variable_conflict use_column
DECLARE
  v_user uuid := auth.uid();
  a jsonb;
  cell float8;
  gone int;
  min_conf float8;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'sign in to read lot presence' USING ERRCODE = '42501';
  END IF;
  SELECT public.shop_priority_default_assumptions() || coalesce(
    (SELECT s.assumptions FROM public.shop_priority_settings s WHERE s.user_id = v_user), '{}'::jsonb) INTO a;
  cell := (a->'place_cell_degrees'->>'value')::float8;
  gone := (a->'departed_after_days'->>'value')::int;
  min_conf := (a->'auto_match_min_confidence'->>'value')::float8;

  RETURN QUERY
  WITH mine AS MATERIALIZED (
    SELECT vi.id, vi.vehicle_id, vi.auto_suggested_vehicle_id, vi.auto_suggestion_confidence, vi.suggested_vehicle_id,
           vi.taken_at, vi.latitude::float8 AS lat, vi.longitude::float8 AS lng
    FROM public.vehicle_images vi
    WHERE vi.user_id = v_user AND vi.taken_at > p_as_of - interval '180 days' AND vi.taken_at <= p_as_of
      AND vi.latitude IS NOT NULL AND vi.longitude IS NOT NULL
      AND vi.is_superseded IS NOT TRUE AND vi.is_duplicate IS NOT TRUE
  ),
  cells AS (
    SELECT round(lat / cell) AS cy, round(lng / cell) AS cx, count(DISTINCT taken_at::date) AS days
    FROM mine GROUP BY 1, 2
  ),
  lot AS (SELECT cy, cx FROM cells ORDER BY days DESC, cy, cx LIMIT 1),
  tagged AS (
    SELECT m.*,
      (abs(round(m.lat / cell) - lot.cy) <= 1 AND abs(round(m.lng / cell) - lot.cx) <= 1) AS at_lot,
      coalesce(m.vehicle_id,
               CASE WHEN coalesce(m.auto_suggestion_confidence, 0) >= min_conf THEN m.auto_suggested_vehicle_id END,
               m.suggested_vehicle_id) AS raw_vid
    FROM mine m CROSS JOIN lot
  ),
  ident AS (
    SELECT t.*, coalesce(v.merged_into_vehicle_id, t.raw_vid) AS vid
    FROM tagged t JOIN public.vehicles v ON v.id = t.raw_vid
  ),
  agg AS (
    SELECT i.vid,
      count(*) FILTER (WHERE i.at_lot)::int AS n_lot,
      count(*) FILTER (WHERE i.at_lot AND i.vehicle_id IS NULL)::int AS n_unassigned,
      count(DISTINCT i.taken_at::date) FILTER (WHERE i.at_lot)::int AS n_days,
      min(i.taken_at) FILTER (WHERE i.at_lot) AS first_lot,
      max(i.taken_at) FILTER (WHERE i.at_lot) AS last_lot,
      max(i.taken_at) FILTER (WHERE NOT i.at_lot) AS last_else,
      array_agg(DISTINCT i.raw_vid) FILTER (WHERE i.raw_vid <> i.vid) AS merged
    FROM ident i GROUP BY i.vid
  )
  -- on_lot: photographed at the lot within the window. departed: seen elsewhere afterwards, or the lot
  -- was photographed on a later day without it. unknown: nobody photographed the lot since.
  , lot_visits AS (SELECT array_agg(DISTINCT t.taken_at::date) AS days FROM tagged t WHERE t.at_lot)
  SELECT g.vid, v.year, v.make, v.model, v.vin,
    CASE WHEN g.last_lot IS NULL THEN 'unknown'
         WHEN g.last_else > g.last_lot THEN 'departed'
         WHEN g.last_lot >= p_as_of - make_interval(days => gone) THEN 'on_lot'
         WHEN EXISTS (SELECT 1 FROM lot_visits lv, unnest(lv.days) d WHERE d > g.last_lot::date) THEN 'departed'
         ELSE 'unknown' END,
    CASE WHEN g.n_days >= 3 THEN 'high' WHEN g.n_lot >= 10 THEN 'medium' ELSE 'low' END,
    g.n_lot, g.n_unassigned, g.n_days, g.first_lot, g.last_lot, g.last_else,
    coalesce(g.merged, '{}'::uuid[]),
    (SELECT jsonb_build_object('lat', round((lot.cy * cell)::numeric, 4), 'lng', round((lot.cx * cell)::numeric, 4),
                               'source', 'densest cluster of your photo GPS') FROM lot)
  FROM agg g JOIN public.vehicles v ON v.id = g.vid
  WHERE g.last_lot IS NOT NULL AND v.deleted_at IS NULL;
END
$fn$;

CREATE OR REPLACE FUNCTION public.shop_priorities_read(p_as_of timestamptz DEFAULT now(), p_org uuid DEFAULT NULL)
RETURNS TABLE (
  vehicle_id uuid, year integer, make text, model text, score integer, reasons text[],
  details jsonb, last_seen timestamptz, rank integer, assumptions jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $fn$
#variable_conflict use_column
DECLARE
  v_user uuid := auth.uid();
  a jsonb;
  apr numeric;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'sign in to read priorities' USING ERRCODE = '42501';
  END IF;
  IF p_org IS NOT NULL AND NOT public.work_order_org_member(v_user, p_org) THEN
    RAISE EXCEPTION 'only owners and members of this organization can read its priorities' USING ERRCODE = '42501';
  END IF;
  SELECT public.shop_priority_default_assumptions() || coalesce(
    (SELECT s.assumptions FROM public.shop_priority_settings s WHERE s.user_id = v_user), '{}'::jsonb) INTO a;
  apr := (a->'cost_of_money_apr'->>'value')::numeric;

  RETURN QUERY
  WITH pres AS MATERIALIZED (SELECT * FROM public.lot_presence_read(p_as_of)),
  -- Unidentified lot photos on the days a vehicle was there (photos no signal ties to any vehicle).
  lot_days AS MATERIALIZED (
    SELECT DISTINCT p.vehicle_id, vi.taken_at::date AS day
    FROM pres p JOIN public.vehicle_images vi ON vi.user_id = v_user AND vi.vehicle_id = p.vehicle_id
    WHERE vi.taken_at > p_as_of - interval '14 days' AND vi.taken_at <= p_as_of
  ),
  linked AS MATERIALIZED (
    SELECT DISTINCT ov.vehicle_id FROM public.organization_vehicles ov
    WHERE p_org IS NOT NULL AND ov.organization_id = p_org AND ov.status IN ('active', 'pending')
      AND coalesce(ov.listing_status, '') <> 'sold'
  ),
  wo AS MATERIALIZED (
    SELECT w.* FROM public.work_orders w
    WHERE w.vehicle_id IS NOT NULL AND (
      w.vehicle_id IN (SELECT vehicle_id FROM pres)
      OR (p_org IS NOT NULL AND (w.organization_id = p_org OR w.org_id = p_org))
      OR (w.organization_id IS NULL AND w.org_id IS NULL AND w.vehicle_id IN (SELECT vehicle_id FROM linked)))
  ),
  idle AS (
    SELECT wo.vehicle_id, max(p_as_of - wo.updated_at) AS idle_for FROM wo
    WHERE wo.status = 'in_progress' AND wo.updated_at <= p_as_of - interval '3 days' GROUP BY wo.vehicle_id
  ),
  pending AS (SELECT wo.vehicle_id, count(*) AS n FROM wo WHERE wo.status IN ('pending', 'quoted') GROUP BY wo.vehicle_id),
  unfulfilled AS (
    SELECT wo.vehicle_id, count(*) AS n
    FROM wo JOIN public.work_order_resource_requirements r ON r.work_order_id = wo.id
    WHERE wo.status NOT IN ('completed', 'cancelled', 'canceled', 'closed', 'paid')
      AND NOT EXISTS (SELECT 1 FROM public.work_order_resource_fulfillments f WHERE f.requirement_id = r.id)
    GROUP BY wo.vehicle_id
  ),
  balance AS (
    SELECT wo.vehicle_id, sum(u.balance_due) AS due
    FROM wo JOIN public.work_order_receipt_unified u ON u.work_order_id = wo.id
    WHERE u.balance_due > 0 GROUP BY wo.vehicle_id
  ),
  unassigned AS (
    SELECT ld.vehicle_id, count(DISTINCT vi.id) AS n
    FROM lot_days ld
    JOIN public.vehicle_images vi ON vi.user_id = v_user AND vi.vehicle_id IS NULL
      AND vi.auto_suggested_vehicle_id IS NULL AND vi.suggested_vehicle_id IS NULL
      AND vi.taken_at >= ld.day AND vi.taken_at < ld.day + 1
      AND vi.latitude IS NOT NULL
    CROSS JOIN LATERAL (SELECT (lot_center->>'lat')::float8 AS lat, (lot_center->>'lng')::float8 AS lng FROM pres LIMIT 1) c
    WHERE abs(vi.latitude::float8 - c.lat) <= 2 * (a->'place_cell_degrees'->>'value')::float8
      AND abs(vi.longitude::float8 - c.lng) <= 2 * (a->'place_cell_degrees'->>'value')::float8
    GROUP BY ld.vehicle_id
  ),
  held AS (
    SELECT DISTINCT ON (ov.vehicle_id) ov.vehicle_id,
      coalesce(ov.cost_basis, v.purchase_price) AS basis,
      CASE WHEN ov.cost_basis IS NOT NULL THEN 'organization_vehicles.cost_basis'
           WHEN v.purchase_price IS NOT NULL THEN 'vehicles.purchase_price' END AS basis_source,
      coalesce(v.purchase_date, ov.start_date) AS acquired_on,
      ov.created_at AS on_record_since,
      v.nuke_estimate AS est, v.nuke_estimate_confidence AS est_conf,
      nullif(ov.asking_price, 0) AS ask, v.is_for_sale, coalesce(v.image_count, 0) AS photos
    FROM public.organization_vehicles ov JOIN public.vehicles v ON v.id = ov.vehicle_id
    WHERE p_org IS NOT NULL AND ov.organization_id = p_org AND ov.relationship_type = 'owner' AND ov.status = 'active'
      AND coalesce(ov.listing_status, '') <> 'sold' AND coalesce(v.sale_status, '') <> 'sold'
      AND v.sale_date IS NULL AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL
    ORDER BY ov.vehicle_id, coalesce(ov.cost_basis, v.purchase_price) NULLS LAST, ov.created_at
  ),
  held_calc AS MATERIALIZED (
    SELECT h.*,
      (p_as_of::date - h.acquired_on) AS days_held,
      (p_as_of::date - h.on_record_since::date) AS days_on_record,
      h.basis * apr / 365.0 AS daily_cost,
      h.basis * apr / 365.0 * (p_as_of::date - h.acquired_on) AS carrying,
      NOT EXISTS (SELECT 1 FROM wo WHERE wo.vehicle_id = h.vehicle_id
                  AND wo.status NOT IN ('completed', 'cancelled', 'canceled', 'closed', 'paid')) AS no_open_order,
      NOT EXISTS (SELECT 1 FROM pres p WHERE p.vehicle_id = h.vehicle_id
                  AND p.last_seen_at_lot > p_as_of - interval '14 days') AS idle
    FROM held h
  ),
  ids AS (
    SELECT p.vehicle_id FROM pres p WHERE p.last_seen_at_lot > p_as_of - interval '14 days'
    UNION SELECT i.vehicle_id FROM idle i UNION SELECT p.vehicle_id FROM pending p
    UNION SELECT u.vehicle_id FROM unfulfilled u UNION SELECT b.vehicle_id FROM balance b
    UNION SELECT h.vehicle_id FROM held_calc h
  ),
  scored AS (
    SELECT ids.vehicle_id,
      CASE WHEN ps.last_seen_at_lot > p_as_of - interval '3 days' THEN 3
           WHEN ps.last_seen_at_lot > p_as_of - interval '14 days' THEN 1 ELSE 0 END
        + CASE WHEN i.vehicle_id IS NOT NULL THEN 3 ELSE 0 END
        + CASE WHEN p.vehicle_id IS NOT NULL THEN 2 ELSE 0 END
        + least(coalesce(uf.n, 0) * 2, 4)
        + CASE WHEN b.vehicle_id IS NOT NULL THEN 2 ELSE 0 END
        + (coalesce(ua.n, 0) / 25)::int
        + CASE WHEN h.idle AND coalesce(h.days_held, h.days_on_record) >= 90 THEN 2
               WHEN h.idle AND coalesce(h.days_held, h.days_on_record) >= 30 THEN 1 ELSE 0 END
        + CASE WHEN h.idle AND h.carrying IS NOT NULL AND h.est IS NOT NULL AND h.est - h.basis - h.carrying < 0 THEN 2 ELSE 0 END
        + CASE WHEN h.vehicle_id IS NOT NULL AND h.ask IS NULL AND h.is_for_sale IS NOT TRUE AND h.photos >= 10 THEN 1 ELSE 0 END
        + CASE WHEN h.idle AND h.no_open_order THEN 1 ELSE 0 END AS score,
      array_remove(ARRAY[
        CASE WHEN ps.last_seen_at_lot > p_as_of - interval '3 days' THEN 'photographed_recent:' || ps.lot_photos
             WHEN ps.last_seen_at_lot > p_as_of - interval '14 days' THEN 'photographed_this_fortnight:' || ps.lot_photos END,
        CASE WHEN i.vehicle_id IS NOT NULL THEN 'in_progress_idle_days:' || extract(day FROM i.idle_for)::int END,
        CASE WHEN p.vehicle_id IS NOT NULL THEN 'pending_or_quoted:' || p.n END,
        CASE WHEN uf.n > 0 THEN 'unfulfilled_requirements:' || uf.n END,
        CASE WHEN b.vehicle_id IS NOT NULL THEN 'open_balance:' || round(b.due, 2) END,
        CASE WHEN ua.n >= 25 THEN 'unassigned_photos:' || ua.n END,
        CASE WHEN h.days_held IS NOT NULL THEN 'held_days:' || h.days_held
             WHEN h.vehicle_id IS NOT NULL THEN 'on_record_days:' || h.days_on_record END,
        CASE WHEN h.carrying IS NOT NULL THEN 'carrying_cost_assumed_rate:' || round(h.carrying) END,
        CASE WHEN h.vehicle_id IS NOT NULL AND h.ask IS NULL AND h.is_for_sale IS NOT TRUE AND h.photos >= 10 THEN 'not_listed_photos_ready:' || h.photos END,
        CASE WHEN h.idle AND h.no_open_order THEN 'needs_service_order' END
      ], NULL) AS reasons,
      jsonb_strip_nulls(jsonb_build_object(
        'presence', CASE WHEN ps.vehicle_id IS NOT NULL THEN jsonb_build_object(
          'status', ps.status, 'confidence', ps.confidence, 'lot_photos', ps.lot_photos,
          'first_seen_at_lot', ps.first_seen_at_lot, 'last_seen_at_lot', ps.last_seen_at_lot,
          'evidence', jsonb_build_object('lot_days', ps.lot_days, 'lot_photos_unassigned', ps.lot_photos_unassigned,
            'merged_record_ids', to_jsonb(ps.merged_record_ids), 'lot_center', ps.lot_center, 'vin', ps.vin)) END,
        'held', CASE WHEN h.vehicle_id IS NOT NULL THEN jsonb_strip_nulls(jsonb_build_object(
          -- Ownership on a shared lot stays low-confidence until evidence converges (an org link alone).
          'ownership_confidence', 'low',
          'ownership_evidence', jsonb_build_array('organization_vehicles.relationship_type=owner'),
          'cost_basis', h.basis, 'cost_basis_source', h.basis_source,
          'acquired_on', h.acquired_on, 'on_record_since', h.on_record_since::date,
          'days_held', h.days_held, 'days_on_record', h.days_on_record,
          'daily_cost_of_money', round(h.daily_cost, 2), 'carrying_cost', round(h.carrying, 2),
          'carrying_cost_basis', CASE WHEN h.carrying IS NOT NULL THEN 'assumed cost_of_money_apr' END,
          'estimated_value', h.est, 'estimated_value_source', CASE WHEN h.est IS NOT NULL THEN 'vehicles.nuke_estimate' END,
          'estimated_value_confidence', h.est_conf,
          'projected_margin', round(h.est - h.basis - h.carrying, 2),
          'projected_roi', round((h.est - h.basis - h.carrying) / nullif(h.basis, 0), 4),
          'roi_decay_per_day', round(h.daily_cost / nullif(h.basis, 0), 6),
          'photos', h.photos, 'asking_price', h.ask, 'listed', (h.ask IS NOT NULL OR h.is_for_sale IS TRUE))) END,
        'missing', CASE WHEN h.vehicle_id IS NOT NULL THEN to_jsonb(array_remove(ARRAY[
          CASE WHEN h.basis IS NULL THEN 'purchase_price' END,
          CASE WHEN h.acquired_on IS NULL THEN 'acquisition_date' END,
          'financing_terms',
          CASE WHEN h.est IS NULL THEN 'estimated_value' END,
          CASE WHEN h.ask IS NULL THEN 'asking_price' END], NULL)) END,
        'suggested_service_orders', CASE WHEN h.idle AND h.no_open_order THEN to_jsonb(array_remove(ARRAY[
          jsonb_build_object('suggested', true, 'role', 'tech', 'title', 'Inspection and running check before listing'),
          CASE WHEN h.photos < 10 THEN jsonb_build_object('suggested', true, 'role', 'owner', 'title', 'Shoot a listing photo set') END,
          CASE WHEN h.ask IS NULL THEN jsonb_build_object('suggested', true, 'role', 'owner', 'title', 'Set an asking price and list') END
        ], NULL)) END
      )) AS details,
      ps.last_seen_at_lot AS last_seen
    FROM ids
    LEFT JOIN pres ps ON ps.vehicle_id = ids.vehicle_id
    LEFT JOIN idle i ON i.vehicle_id = ids.vehicle_id
    LEFT JOIN pending p ON p.vehicle_id = ids.vehicle_id
    LEFT JOIN unfulfilled uf ON uf.vehicle_id = ids.vehicle_id
    LEFT JOIN balance b ON b.vehicle_id = ids.vehicle_id
    LEFT JOIN unassigned ua ON ua.vehicle_id = ids.vehicle_id
    LEFT JOIN held_calc h ON h.vehicle_id = ids.vehicle_id
  )
  SELECT s.vehicle_id, v.year, v.make, v.model, s.score::int, s.reasons, s.details, s.last_seen,
         (row_number() OVER (ORDER BY s.score DESC, s.last_seen DESC NULLS LAST, s.vehicle_id))::int, a
  FROM scored s JOIN public.vehicles v ON v.id = s.vehicle_id
  WHERE s.score > 0 AND v.deleted_at IS NULL
  ORDER BY 9;
END
$fn$;

REVOKE ALL ON FUNCTION public.lot_presence_read(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lot_presence_read(timestamptz) TO authenticated;
REVOKE ALL ON FUNCTION public.shop_priorities_read(timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shop_priorities_read(timestamptz, uuid) TO authenticated;
COMMENT ON FUNCTION public.shop_priorities_read(timestamptz, uuid) IS
  'Read-only ranked priorities for the caller, place derived from their photo GPS. Optional p_org (owner/member) adds held-inventory signals. Assumptions are labelled.';
