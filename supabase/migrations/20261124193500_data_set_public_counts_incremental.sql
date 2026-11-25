-- data_set_public_counts_incremental_v2: count only the sets that changed, then a bounded rotation; never the whole table.
--
-- WHY. data_set_public_counts_refresh_v1 recounted every active membership on every 5-minute run. The table grew from
-- about 1M to 5M rows during the spec-landing backfill (finished 2026-11-25 00:36 UTC) and every run since 09:50 UTC
-- 2026-11-24 has hit the job's 120 s timeout (184 failures in a row, v_job_health / cron.job_run_details, measured
-- 2026-11-25 ~01:10 UTC); the counts are frozen and 24,224 of 52,548 sets have no count row. One set counts in well under
-- a second through data_set_members_set_idx (the largest, 135,174 active members: 395 ms, EXPLAIN ANALYZE).
--
-- WHAT. Grain unchanged: one data_set_public_counts row per set (set_id FK data_sets). data_set_public_count_one(set)
-- recounts one set (distinct public, undeleted vehicles among its active vehicle and auction_comment members).
-- data_set_public_counts_refresh_v2(budget_ms) runs, within its budget:
--   1. every set with a membership row landed since the last run (data_set_members.id above the stored watermark,
--      a primary-key range); the watermark advances only when all of them were counted;
--   2. sets with no count row yet;
--   3. a rotation of up to p_rotate (1,500) sets through data_sets by id from a stored cursor, so a vehicle turning private or deleted, or a
--      superseded membership, is reflected within one full rotation.
-- State lives in platform_config 'data_set_public_counts' (watermark, cursor, last run summary). The cron job
-- data-set-public-counts now calls v2 every 5 minutes with a 90 s budget under its 120 s timeout (a full rotation of
-- 52,548 sets takes about 35 runs, three hours). v1 stays defined.
-- Rows written per run: one upsert per set counted (dirty sets + up to the budget of missing and rotated sets).
--
-- REVERT. SELECT cron.schedule('data-set-public-counts', '*/5 * * * *', $$SET statement_timeout = '120s'; SET
-- lock_timeout = '5s'; SELECT public.data_set_public_counts_refresh_v1();$$); DROP FUNCTION
-- data_set_public_counts_refresh_v2(integer, integer); DROP FUNCTION data_set_public_count_one(uuid); DELETE FROM platform_config
-- WHERE config_key = 'data_set_public_counts'.
-- Contract: supabase/sql/test_data_set_public_counts_incremental.sql.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.data_set_public_count_one(p_set_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE n integer;
BEGIN
  SELECT count(DISTINCT m.vehicle_id)::int INTO n
    FROM public.data_set_members m
    JOIN public.vehicles pv ON pv.id = m.vehicle_id AND pv.is_public IS TRUE AND pv.deleted_at IS NULL
   WHERE m.set_id = p_set_id AND m.state = 'active' AND m.member_type IN ('vehicle', 'auction_comment');
  INSERT INTO public.data_set_public_counts (set_id, public_vehicles, counted_at)
  VALUES (p_set_id, n, now())
  ON CONFLICT (set_id) DO UPDATE SET public_vehicles = excluded.public_vehicles, counted_at = excluded.counted_at;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.data_set_public_count_one(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.data_set_public_count_one(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.data_set_public_counts_refresh_v2(p_budget_ms integer DEFAULT 90000, p_rotate integer DEFAULT 1500)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  cfg jsonb;
  wm bigint;
  top bigint;
  cur uuid;
  s uuid;
  t0 timestamptz := clock_timestamp();
  budget interval := make_interval(secs => greatest(1, least(coalesce(p_budget_ms, 90000), 110000)) / 1000.0);
  n_dirty int := 0; n_missing int := 0; n_rot int := 0;
  dirty_done boolean := true;
  wrapped boolean := false;
  zero uuid := '00000000-0000-0000-0000-000000000000';
BEGIN
  SELECT config_value INTO cfg FROM public.platform_config WHERE config_key = 'data_set_public_counts' FOR UPDATE;
  wm := coalesce((cfg->>'member_id_watermark')::bigint, 0);
  cur := coalesce((cfg->>'cursor')::uuid, zero);
  -- At most 200,000 membership ids per run, so a backfill is worked through in bounded steps; a first run with no
  -- state starts at the current top (existing sets are reached by the never-counted and rotation steps).
  SELECT coalesce(max(id), 0) INTO top FROM public.data_set_members;
  IF cfg IS NULL THEN wm := top; END IF;
  top := least(top, wm + 200000);

  -- 1. sets touched by memberships landed since the last run
  FOR s IN SELECT DISTINCT m.set_id FROM public.data_set_members m WHERE m.id > wm AND m.id <= top LOOP
    IF clock_timestamp() - t0 > budget THEN dirty_done := false; EXIT; END IF;
    PERFORM public.data_set_public_count_one(s); n_dirty := n_dirty + 1;
  END LOOP;

  -- 2. sets never counted
  IF dirty_done THEN
    FOR s IN SELECT d.id FROM public.data_sets d
              WHERE NOT EXISTS (SELECT 1 FROM public.data_set_public_counts c WHERE c.set_id = d.id)
              ORDER BY d.id LOOP
      EXIT WHEN clock_timestamp() - t0 > budget;
      PERFORM public.data_set_public_count_one(s); n_missing := n_missing + 1;
    END LOOP;
  END IF;

  -- 3. rotation from the cursor
  LOOP
    EXIT WHEN clock_timestamp() - t0 > budget OR n_rot >= greatest(0, coalesce(p_rotate, 1500));
    SELECT d.id INTO s FROM public.data_sets d WHERE d.id > cur ORDER BY d.id LIMIT 1;
    IF s IS NULL THEN
      EXIT WHEN wrapped OR cur = zero;
      cur := zero; wrapped := true; CONTINUE;
    END IF;
    PERFORM public.data_set_public_count_one(s); n_rot := n_rot + 1; cur := s; s := NULL;
  END LOOP;

  cfg := jsonb_build_object(
    'member_id_watermark', CASE WHEN dirty_done THEN top ELSE wm END,
    'cursor', cur,
    'last_run', jsonb_build_object('at', now(), 'dirty_sets', n_dirty, 'dirty_done', dirty_done, 'missing_sets', n_missing,
                                   'rotated_sets', n_rot, 'ms', round(extract(epoch FROM clock_timestamp() - t0) * 1000)));
  INSERT INTO public.platform_config (config_key, config_value, description, updated_at)
  VALUES ('data_set_public_counts', cfg,
          'State of data_set_public_counts_refresh_v2: membership id watermark, rotation cursor, last run. 20261124193500.', now())
  ON CONFLICT (config_key) DO UPDATE SET config_value = excluded.config_value, updated_at = now();
  RETURN cfg->'last_run';
END;
$$;
REVOKE ALL ON FUNCTION public.data_set_public_counts_refresh_v2(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.data_set_public_counts_refresh_v2(integer, integer) TO service_role;
COMMENT ON FUNCTION public.data_set_public_counts_refresh_v2(integer, integer) IS
  'Incremental public counts per data set: sets with memberships landed since the stored watermark, then sets with no count row, then a rotation by set id, all within the budget. Run by cron data-set-public-counts. 20261124193500.';

DO $cron$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.schedule('data-set-public-counts', '*/5 * * * *',
      $cmd$SET statement_timeout = '120s'; SET lock_timeout = '5s'; SELECT public.data_set_public_counts_refresh_v2(90000);$cmd$);
  END IF;
END $cron$;
