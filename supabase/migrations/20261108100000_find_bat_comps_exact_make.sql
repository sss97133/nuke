-- fix(comps): find_bat_comps matched make with LIKE '%make%' (e.g. 'ac' matched pontiac, cadillac, acura).
-- Now exact and case-insensitive (input trimmed), same predicate get_comps_scored already uses, so it can use idx_vehicles_lower_make_year. Signature and output columns unchanged. No pooling, no new dependencies.
-- Revert: scripts/comps/revert_find_bat_comps_exact_make_20261102.sql
CREATE OR REPLACE FUNCTION public.find_bat_comps(p_make text, p_model text DEFAULT NULL::text, p_year integer DEFAULT NULL::integer, p_year_range integer DEFAULT 2, p_limit integer DEFAULT 200, p_skip_wide_fallback boolean DEFAULT false)
 RETURNS TABLE(listing_id uuid, vehicle_id uuid, sale_price integer, bid_count integer, sale_date date, bat_listing_url text, v_year integer, v_make text, v_model text, v_engine_size text)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_engine     text;
  v_trans      text;
  v_drive      text;
  v_mileage    integer;
  v_trim       text;
  v_body       text;
  result_count integer;
  _mk          text := lower(btrim(p_make));
BEGIN
  -- exact (case-insensitive, trimmed) make match; was LIKE '%make%' ('ac' matched pontiac/cadillac/acura)
  -- Try to resolve vehicle attributes from a matching vehicle for better scoring
  -- Pick the first vehicle matching these params to get its attributes
  SELECT v.engine_type, v.transmission, v.drivetrain, v.mileage, v.trim, v.body_style
  INTO v_engine, v_trans, v_drive, v_mileage, v_trim, v_body
  FROM (select * from public.vehicles where listing_kind is distinct from 'non_vehicle_item' and ((public.lot_class_of(null::uuid) = 'car' and not exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null)) or exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null and lc.lot_class = public.lot_class_of(null::uuid)))) v
  WHERE lower(v.make) = _mk
    AND (p_model IS NULL OR lower(v.model) LIKE '%' || lower(p_model) || '%')
    AND (p_year IS NULL OR v.year = p_year)
    AND v.engine_type IS NOT NULL
  LIMIT 1;

  -- Use scored comps to get BaT listings ranked by similarity
  RETURN QUERY
  SELECT
    bl.id AS listing_id,
    s.vehicle_id,
    s.sale_price::integer,
    bl.bid_count,
    s.sold_date::date AS sale_date,
    bl.bat_listing_url,
    s.yr AS v_year,
    s.mk AS v_make,
    s.mdl AS v_model,
    v2.engine_size AS v_engine_size
  FROM get_comps_scored(
    p_make         := btrim(p_make),
    p_model        := p_model,
    p_year         := p_year,
    p_year_range   := p_year_range,
    p_engine_type  := v_engine,
    p_transmission := v_trans,
    p_drivetrain   := v_drive,
    p_mileage      := v_mileage,
    p_trim         := v_trim,
    p_body_style   := v_body,
    p_limit        := p_limit
  ) s
  JOIN bat_listings bl ON bl.vehicle_id = s.vehicle_id
  JOIN (select * from public.vehicles where listing_kind is distinct from 'non_vehicle_item' and ((public.lot_class_of(null::uuid) = 'car' and not exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null)) or exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null and lc.lot_class = public.lot_class_of(null::uuid)))) v2 ON v2.id = s.vehicle_id
  WHERE bl.sale_price > 0;

  GET DIAGNOSTICS result_count = ROW_COUNT;

  -- If we got no results from scored path and not skipping fallback, try wider
  IF result_count = 0 AND NOT p_skip_wide_fallback THEN
    RETURN QUERY
    SELECT bl.id,
           bl.vehicle_id,
           bl.sale_price,
           bl.bid_count,
           bl.sale_date,
           bl.bat_listing_url,
           v2.year,
           v2.make,
           v2.model,
           v2.engine_size
    FROM bat_listings bl
    INNER JOIN (select * from public.vehicles where listing_kind is distinct from 'non_vehicle_item' and ((public.lot_class_of(null::uuid) = 'car' and not exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null)) or exists (select 1 from public.vehicle_lot_class lc where lc.vehicle_id = public.vehicles.id and lc.retired_at is null and lc.lot_class = public.lot_class_of(null::uuid)))) v2 ON v2.id = bl.vehicle_id
    WHERE bl.sale_price > 0
      AND lower(v2.make) = _mk
      AND (p_model IS NULL OR lower(v2.model) LIKE '%' || lower(p_model) || '%')
      AND (p_year IS NULL OR (v2.year BETWEEN p_year - p_year_range * 2 AND p_year + p_year_range * 2))
    ORDER BY bl.sale_date DESC NULLS LAST
    LIMIT p_limit;
  END IF;
END;
$function$
;
