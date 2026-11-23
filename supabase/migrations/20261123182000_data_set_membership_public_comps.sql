-- Second review round on 20261123180000_data_set_membership.
--   1. Comparables are public profiles only (Cursor Security Reviewer): data_set_comps_one counts and prices only member
--      vehicles (and, for comment themes, auctions of vehicles) with is_public and not deleted, as the other public comps
--      readers do; vehicle_data_sets reports public_vehicles_in_set. A hidden profile's existence or sale price can no
--      longer be read through a set it shares with a public car.
--   2. data_set_membership_revert_v1 (Bugbot): when run A's revert kept a row superseded because run B had re-added it,
--      reverting B now makes A's row active again (logged restored_after_readd_reverted), so the membership does not vanish.
-- Contract: supabase/sql/test_data_set_membership.sql
-- Revert of this file: supabase/sql/revert_20261123182000_data_set_membership_public_comps.sql

begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.data_set_comps_one(p_set_id uuid, p_exclude_vehicle uuid, p_basis price_basis_t)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
  WITH s AS (SELECT * FROM public.data_sets WHERE id = p_set_id),
  ex AS (SELECT upper(btrim(x.vin)) AS vin FROM public.vehicles x WHERE x.id = p_exclude_vehicle AND nullif(btrim(x.vin), '') IS NOT NULL),
  mv AS (
    SELECT DISTINCT m.vehicle_id FROM public.data_set_members m
      JOIN s ON s.id = m.set_id
      JOIN public.vehicles pv ON pv.id = m.vehicle_id AND pv.is_public IS TRUE AND pv.deleted_at IS NULL
     WHERE m.state = 'active' AND m.member_type = 'vehicle' AND s.set_kind <> 'comment_theme'
       AND m.vehicle_id IS DISTINCT FROM p_exclude_vehicle),
  ev_ids AS (
    SELECT ae.id FROM mv JOIN public.auction_events_canonical ae ON ae.vehicle_id = mv.vehicle_id
    UNION
    SELECT c.auction_event_id FROM public.data_set_members m JOIN s ON s.id = m.set_id
      JOIN public.auction_comments c ON c.id = m.member_id
     WHERE s.set_kind = 'comment_theme' AND m.state = 'active' AND m.member_type = 'auction_comment'
       AND c.auction_event_id IS NOT NULL AND m.vehicle_id IS DISTINCT FROM p_exclude_vehicle),
  ev AS (
    SELECT DISTINCT ON (coalesce(ae.canonical_listing_url, rtrim(ae.source_url, '/'), ae.id::text))
           ae.id, ae.vehicle_id, ae.outcome, ae.auction_end_date, ae.currency_code, ae.high_bid,
           (CASE p_basis WHEN 'hammer' THEN ae.hammer_price WHEN 'gross_incl_premium' THEN ae.gross_price
                         WHEN 'net_to_owner' THEN ae.net_to_owner END) AS amt,
           ae.outcome = 'sold' AND NOT public.auction_event_typed_not_sold(ae.vehicle_id, ae.source_url)
             AND NOT (coalesce(ae.raw_data, '{}'::jsonb) ? 'duplicate_of') AS is_sold
      FROM ev_ids JOIN public.auction_events_canonical ae ON ae.id = ev_ids.id
      JOIN public.vehicles x ON x.id = ae.vehicle_id AND x.is_public IS TRUE AND x.deleted_at IS NULL
     WHERE ae.vehicle_id IS DISTINCT FROM p_exclude_vehicle
       AND NOT EXISTS (SELECT 1 FROM ex WHERE ex.vin = upper(btrim(x.vin)))
     ORDER BY coalesce(ae.canonical_listing_url, rtrim(ae.source_url, '/'), ae.id::text),
              (ae.outcome = 'sold') DESC, ae.auction_end_date DESC NULLS LAST, ae.id),
  priced AS (
    SELECT ev.*, CASE WHEN ev.currency_code IS NULL THEN ev.amt ELSE round(ev.amt * fx.rate, 0) END AS usd,
           ev.currency_code IS NULL AS unconverted,
           extract(year FROM ev.auction_end_date)::int AS yr
      FROM ev LEFT JOIN LATERAL (SELECT f.rate FROM public.fx_usd_rate(ev.currency_code, (ev.auction_end_date AT TIME ZONE 'UTC')::date) f LIMIT 1) fx
        ON ev.currency_code IS NOT NULL
     WHERE ev.is_sold AND ev.amt > 0),
  sold AS (SELECT * FROM priced WHERE usd IS NOT NULL)
  SELECT jsonb_build_object(
    'set_id', s.id, 'set_kind', s.set_kind, 'set_key', s.set_key, 'label', s.label,
    'member_vehicles', (SELECT count(*) FROM mv),
    'listings', (SELECT count(*) FROM ev),
    'price_basis', p_basis::text,
    'sold', (SELECT jsonb_build_object('n', count(*), 'median', percentile_cont(0.5) WITHIN GROUP (ORDER BY usd),
                                       'p25', percentile_cont(0.25) WITHIN GROUP (ORDER BY usd),
                                       'p75', percentile_cont(0.75) WITHIN GROUP (ORDER BY usd),
                                       'min', min(usd), 'max', max(usd),
                                       'n_currency_unknown', count(*) FILTER (WHERE unconverted)) FROM sold),
    'sold_by_period', (SELECT coalesce(jsonb_agg(jsonb_build_object('period', p.period, 'n', p.n, 'median', p.med) ORDER BY p.period), '[]'::jsonb)
                         FROM (SELECT CASE WHEN yr IS NULL THEN 'unknown' WHEN yr < 2015 THEN 'before_2015'
                                           WHEN yr < 2020 THEN '2015_2019' ELSE yr::text END AS period,
                                      count(*) AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY usd) AS med
                                 FROM sold GROUP BY 1) p),
    'by_outcome', (SELECT coalesce(jsonb_agg(jsonb_build_object('outcome', o.outcome, 'n', o.n, 'median_high_bid_not_a_sale', o.hb) ORDER BY o.n DESC), '[]'::jsonb)
                     FROM (SELECT e2.outcome, count(*) AS n,
                                  CASE WHEN e2.outcome <> 'sold'
                                       THEN percentile_cont(0.5) WITHIN GROUP (ORDER BY e2.high_bid) FILTER (WHERE e2.high_bid > 0 AND e2.currency_code IS NOT DISTINCT FROM 'USD') END AS hb
                             FROM (SELECT coalesce(ev.outcome, 'unknown') AS outcome, ev.high_bid, ev.currency_code FROM ev) e2
                            GROUP BY e2.outcome) o))
  FROM s
$function$;

CREATE OR REPLACE FUNCTION public.vehicle_data_sets(p_vehicle_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' SET statement_timeout TO '8s'
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
           (SELECT count(DISTINCT m2.vehicle_id) FROM public.data_set_members m2
              JOIN public.vehicles pv ON pv.id = m2.vehicle_id AND pv.is_public IS TRUE AND pv.deleted_at IS NULL
             WHERE m2.set_id = s.id AND m2.state = 'active' AND m2.member_type IN ('vehicle','auction_comment')) AS n_vehicles
      FROM mine JOIN public.data_sets s ON s.id = mine.set_id)
  SELECT jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'logic_version', 'data_set_membership/20261123180000.1',
    'sets', coalesce(jsonb_agg(jsonb_build_object(
        'set_id', sets.id, 'set_kind', sets.set_kind, 'set_key', sets.set_key, 'label', sets.label,
        'confidence', sets.conf, 'public_vehicles_in_set', sets.n_vehicles,
        'evidence', jsonb_build_object('vehicle_bases', coalesce(sets.bases, '[]'::jsonb), 'images', sets.n_images,
                                       'comments', sets.n_comments))
        ORDER BY sets.set_kind, sets.set_key), '[]'::jsonb),
    'unknown_kinds', (SELECT coalesce(jsonb_agg(k ORDER BY k), '[]'::jsonb) FROM unnest(ARRAY['vin_cohort','vin_series','vin_engine',
        'plant_year','cowl_style','engine_block_casting','engine_code','trans_case_casting','trans_tail_casting','paint_code',
        'replica_cohort','comment_theme']) k WHERE NOT EXISTS (SELECT 1 FROM sets WHERE sets.set_kind = k)))
    INTO v_out FROM sets;
  RETURN v_out;
END
$function$;

CREATE OR REPLACE FUNCTION public.data_set_membership_revert_v1(p_run uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' SET statement_timeout TO '600s'
AS $function$
DECLARE n_restore int; n_del int; n_sets int; n_left int; n_readded int; n_kept int;
BEGIN
  IF p_run IS NULL THEN RAISE EXCEPTION 'data_set_membership_revert_v1: run required'; END IF;
  IF EXISTS (SELECT 1 FROM public.data_set_member_plan p JOIN public.data_set_members m ON m.id = p.member_row_id
              WHERE p.run_id = p_run::text AND p.state = 'applied' AND p.action = 'add' AND m.superseded_run_id IS NOT NULL
                AND m.superseded_run_id <> p_run::text
                AND EXISTS (SELECT 1 FROM public.data_set_runs x WHERE x.run_id = m.superseded_run_id AND x.status <> 'reverted')) THEN
    RAISE EXCEPTION 'data_set_membership_revert_v1: a later run superseded members of run %; revert it first', p_run;
  END IF;
  WITH s AS (
    UPDATE public.data_set_members m SET state = 'active', superseded_at = NULL, superseded_run_id = NULL
      FROM public.data_set_member_plan p
     WHERE p.run_id = p_run::text AND p.action = 'supersede' AND p.state = 'applied' AND m.id = p.target_member_id
       AND m.superseded_run_id = p_run::text
       -- a later run re-added the same (set, member, basis): that active row stands, this one stays superseded
       AND NOT EXISTS (SELECT 1 FROM public.data_set_members a WHERE a.state = 'active' AND a.id <> m.id
                        AND a.set_id = m.set_id AND a.member_type = m.member_type AND a.member_id = m.member_id
                        AND a.basis_type = m.basis_type AND a.basis_id = m.basis_id)
    RETURNING p.id)
  SELECT count(*) INTO n_restore FROM s;
  SELECT count(*) INTO n_readded FROM public.data_set_member_plan p JOIN public.data_set_members m ON m.id = p.target_member_id
   WHERE p.run_id = p_run::text AND p.action = 'supersede' AND p.state = 'applied' AND m.state = 'superseded'
     AND m.superseded_run_id = p_run::text;
  UPDATE public.data_set_member_plan p SET state = 'skipped', skip_reason = 'revert_kept_readded_active'
    FROM public.data_set_members m
   WHERE p.run_id = p_run::text AND p.action = 'supersede' AND p.state = 'applied' AND m.id = p.target_member_id
     AND m.state = 'superseded' AND m.superseded_run_id = p_run::text;
  WITH d AS (
    DELETE FROM public.data_set_members m USING public.data_set_member_plan p
     WHERE p.run_id = p_run::text AND p.action = 'add' AND p.state = 'applied' AND m.id = p.member_row_id AND m.run_id = p_run::text
    RETURNING p.id)
  SELECT count(*) INTO n_del FROM d;
  -- an earlier reverted run left a row superseded because this run had re-added it: with the re-add gone, it is active again
  WITH k AS (
    UPDATE public.data_set_members o SET state = 'active', superseded_at = NULL, superseded_run_id = NULL
      FROM public.data_set_member_plan kp
      JOIN public.data_set_runs kr ON kr.run_id = kp.run_id AND kr.status = 'reverted'
     WHERE kp.action = 'supersede' AND kp.state = 'skipped' AND kp.skip_reason = 'revert_kept_readded_active'
       AND o.id = kp.target_member_id AND o.state = 'superseded' AND o.superseded_run_id = kp.run_id
       AND NOT EXISTS (SELECT 1 FROM public.data_set_members a WHERE a.state = 'active' AND a.id <> o.id
                        AND a.set_id = o.set_id AND a.member_type = o.member_type AND a.member_id = o.member_id
                        AND a.basis_type = o.basis_type AND a.basis_id = o.basis_id)
    RETURNING kp.id)
  UPDATE public.data_set_member_plan SET state = 'reverted', reverted_at = now(), skip_reason = 'restored_after_readd_reverted'
   WHERE id IN (SELECT id FROM k);
  GET DIAGNOSTICS n_kept = ROW_COUNT;
  WITH d AS (
    DELETE FROM public.data_sets s WHERE s.created_run_id = p_run::text
       AND NOT EXISTS (SELECT 1 FROM public.data_set_members m WHERE m.set_id = s.id) RETURNING s.id)
  SELECT count(*) INTO n_sets FROM d;
  UPDATE public.data_set_member_plan SET state = 'reverted', reverted_at = now() WHERE run_id = p_run::text AND state = 'applied';
  SELECT count(*) INTO n_left FROM public.data_set_members m WHERE m.run_id = p_run::text;
  UPDATE public.data_set_runs SET status = 'reverted', reverted_at = now(),
         summary = summary || jsonb_build_object('reverted', jsonb_build_object('restored', n_restore, 'members_deleted', n_del, 'sets_deleted', n_sets))
   WHERE run_id = p_run::text;
  RETURN jsonb_build_object('run_id', p_run, 'supersedes_restored', n_restore, 'supersedes_kept_readded', n_readded, 'earlier_supersedes_restored', n_kept, 'members_deleted', n_del, 'sets_deleted', n_sets,
    'members_left', n_left);
END
$function$;

REVOKE ALL ON FUNCTION public.data_set_comps_one(uuid, uuid, price_basis_t) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.data_set_membership_revert_v1(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vehicle_data_sets(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.data_set_membership_revert_v1(uuid) TO service_role;

commit;
