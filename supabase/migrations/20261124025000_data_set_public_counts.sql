-- Data-set public counts (20261124025000). Folding the Firebird cohort made some sets hold thousands of members, and
-- vehicle_data_sets counted the public vehicles of every set on each read (3.6 s as anon on a 1970s Firebird). The counts now
-- come from data_set_public_counts, refreshed every 5 minutes by cron (data-set-public-counts) and once here. A set made since
-- the last refresh is still counted live. The reader adds public_vehicles_counted_at; nothing else in its output changes.
-- Revert: supabase/sql/revert_20261124025000_data_set_public_counts.sql

begin;
set local lock_timeout = '5s';
set local statement_timeout = '58s';

CREATE TABLE IF NOT EXISTS public.data_set_public_counts (
  set_id uuid PRIMARY KEY REFERENCES public.data_sets (id) ON DELETE CASCADE,
  public_vehicles integer NOT NULL,
  counted_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.data_set_public_counts ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.data_set_public_counts IS
  'Public vehicles per data set (active vehicle and comment members on public, undeleted vehicles), refreshed by '
  'data_set_public_counts_refresh_v1 every 5 minutes (20261124025000). Read by vehicle_data_sets.';

CREATE OR REPLACE FUNCTION public.data_set_public_counts_refresh_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE n_up int; n_zero int; t0 timestamptz := clock_timestamp();
BEGIN
  WITH c AS (
    SELECT m.set_id, count(DISTINCT m.vehicle_id)::int AS n
      FROM public.data_set_members m
      JOIN public.vehicles pv ON pv.id = m.vehicle_id AND pv.is_public IS TRUE AND pv.deleted_at IS NULL
     WHERE m.state = 'active' AND m.member_type IN ('vehicle','auction_comment')
     GROUP BY m.set_id)
  INSERT INTO public.data_set_public_counts (set_id, public_vehicles, counted_at)
  SELECT c.set_id, c.n, now() FROM c
  ON CONFLICT (set_id) DO UPDATE SET public_vehicles = excluded.public_vehicles, counted_at = excluded.counted_at;
  GET DIAGNOSTICS n_up = ROW_COUNT;
  UPDATE public.data_set_public_counts pc SET public_vehicles = 0, counted_at = now()
   WHERE pc.counted_at < now() AND pc.public_vehicles <> 0;
  GET DIAGNOSTICS n_zero = ROW_COUNT;
  RETURN jsonb_build_object('sets_counted', n_up, 'sets_emptied', n_zero,
                            'ms', round(extract(epoch FROM clock_timestamp() - t0) * 1000));
END
$function$;

REVOKE ALL ON FUNCTION public.data_set_public_counts_refresh_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.data_set_public_counts_refresh_v1() TO service_role;

CREATE OR REPLACE FUNCTION public.vehicle_data_sets(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '8s'
AS $function$
DECLARE v_out jsonb;
BEGIN
  IF p_vehicle_id IS NULL OR NOT public.data_set_can_read_vehicle(p_vehicle_id) THEN
    RETURN jsonb_build_object('vehicle_id', p_vehicle_id, 'error', 'not_found_or_not_public');
  END IF;
  WITH mine AS (
    SELECT m.set_id, max(m.confidence) AS conf,
           count(*) FILTER (WHERE m.member_type = 'vehicle') AS n_vehicle_bases,
           count(*) FILTER (WHERE m.member_type = 'image') AS n_images,
           count(*) FILTER (WHERE m.member_type = 'auction_comment') AS n_comments,
           jsonb_agg(DISTINCT jsonb_build_object('basis_type', m.basis_type, 'basis_id', m.basis_id, 'rule', m.rule_version,
                                                 'confidence', m.confidence))
             FILTER (WHERE m.member_type = 'vehicle') AS bases
      FROM public.data_set_members m
     WHERE m.vehicle_id = p_vehicle_id AND m.state = 'active'
     GROUP BY m.set_id),
  sets AS (
    SELECT s.id, s.set_kind, s.set_key, s.label, s.rule_version, mine.*,
           -- the count comes from data_set_public_counts (refreshed every 5 minutes); a set made since the last refresh is
           -- counted live
           coalesce(pc.public_vehicles,
             (SELECT count(DISTINCT m2.vehicle_id) FROM public.data_set_members m2
                JOIN public.vehicles pv ON pv.id = m2.vehicle_id AND pv.is_public IS TRUE AND pv.deleted_at IS NULL
               WHERE m2.set_id = s.id AND m2.state = 'active' AND m2.member_type IN ('vehicle','auction_comment'))) AS n_vehicles,
           pc.counted_at
      FROM mine JOIN public.data_sets s ON s.id = mine.set_id
      LEFT JOIN public.data_set_public_counts pc ON pc.set_id = s.id)
  SELECT jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'logic_version', 'data_set_membership/20261123180000.1',
    'sets', coalesce(jsonb_agg(jsonb_build_object(
        'set_id', sets.id, 'set_kind', sets.set_kind, 'set_key', sets.set_key, 'label', sets.label,
        'confidence', sets.conf, 'public_vehicles_in_set', sets.n_vehicles, 'public_vehicles_counted_at', sets.counted_at,
        'evidence', jsonb_build_object('vehicle_bases', coalesce(sets.bases, '[]'::jsonb), 'images', sets.n_images,
                                       'comments', sets.n_comments))
        ORDER BY sets.set_kind, sets.set_key), '[]'::jsonb),
    'unknown_kinds', (SELECT coalesce(jsonb_agg(k ORDER BY k), '[]'::jsonb) FROM unnest(ARRAY['vin_cohort','vin_series','vin_engine',
        'plant_year','cowl_style','engine_block_casting','engine_code','trans_case_casting','trans_tail_casting','paint_code',
        'replica_cohort','comment_theme','cowl_option','body_style','trim_level','engine_cid','trans_type','trans_speeds',
        'trans_model','axle_ratio','interior_trim_code','rpo_code','build_month','dealer_zone','documentation']) k WHERE NOT EXISTS (SELECT 1 FROM sets WHERE sets.set_kind = k)))
    INTO v_out FROM sets;
  RETURN v_out;
END
$function$;

SELECT public.data_set_public_counts_refresh_v1();
SELECT cron.schedule('data-set-public-counts', '*/5 * * * *',
  $$SET statement_timeout = '120s'; SET lock_timeout = '5s'; SELECT public.data_set_public_counts_refresh_v1();$$);

commit;
