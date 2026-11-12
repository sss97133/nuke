-- Library intake assay: the owner's whole Photos library is the population, and the alarm stays red until it lands.
--
-- Owner, 2026-11-11: "16k of 90k ... the system is supposed to take all signal". The design (every frame lands,
-- vision sorts it, unused frames are reverse signal) has been written many times and never enforced. This makes
-- the population a failing job instead of a document: v_job_health shows library-intake-watch failed, with the
-- reason, every day the invariant does not hold.
--
-- Population: the iphoto census (scripts/assays/iphoto-census.py, launchd ag.nuke.iphoto-census), one
-- source_census row per run for source slug 'iphoto': universe_total = visible library photos, and
-- raw_response.match.captured = library photos matched to a vehicle_images row of the owner.
-- Read 2026-11-11: census 25cfbf13 recorded 83,131 photos, 17,243 captured (20.7%). The census itself failed
-- silently from 2026-10-14 to 2026-11-11 (its worktree was removed); the last row before that was 2026-10-13.
--
-- Raises (p_raise) when:
--   1. no iphoto census has been recorded for 30 h (the measurement stopped: what happened for five weeks);
--   2. the library grew by more than 50 photos over the last 7 days and fewer than 80% of them were captured
--      (new frames are not landing);
--   3. captured / library is below 95% (the backlog: the whole library has not landed).
-- Reasons are listed together; each carries its numbers and census ids.

SET statement_timeout = '60s';
SET lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.assay_library_intake(p_raise boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  c_fresh      constant interval := interval '30 hours';
  c_window     constant interval := interval '7 days';
  c_min_growth constant integer  := 50;
  c_new_share  constant numeric  := 0.80;
  c_target     constant numeric  := 0.95;
  v_last record; v_prev record;
  v_cov numeric; v_grew integer; v_new_captured integer; v_new_share numeric;
  v_reasons text[] := '{}'; v_out jsonb;
BEGIN
  IF coalesce(auth.role(), 'postgres') NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'assay_library_intake: service admission required' USING ERRCODE = '42501';
  END IF;

  SELECT c.id, c.census_at, c.universe_total AS photos, (c.raw_response->'match'->>'captured')::integer AS captured
    INTO v_last
    FROM source_census c JOIN observation_sources s ON s.id = c.source_id
   WHERE s.slug = 'iphoto'
   ORDER BY c.census_at DESC LIMIT 1;

  IF v_last.id IS NULL THEN
    v_reasons := v_reasons || 'no iphoto census has ever been recorded';
  ELSE
    IF v_last.census_at < now() - c_fresh THEN
      v_reasons := v_reasons || format('library census stale: last %s (census %s); the nightly ag.nuke.iphoto-census run is not recording',
                                       to_char(v_last.census_at AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD HH24:MI "PT"'), v_last.id);
    END IF;

    v_cov := round(v_last.captured::numeric / greatest(v_last.photos, 1), 4);

    SELECT c.id, c.census_at, c.universe_total AS photos, (c.raw_response->'match'->>'captured')::integer AS captured
      INTO v_prev
      FROM source_census c JOIN observation_sources s ON s.id = c.source_id
     WHERE s.slug = 'iphoto' AND c.census_at <= v_last.census_at - c_window
     ORDER BY c.census_at DESC LIMIT 1;

    IF v_prev.id IS NOT NULL THEN
      v_grew := v_last.photos - v_prev.photos;
      v_new_captured := v_last.captured - v_prev.captured;
      v_new_share := round(v_new_captured::numeric / greatest(v_grew, 1), 4);
      IF v_grew > c_min_growth AND v_new_share < c_new_share THEN
        v_reasons := v_reasons || format('new photos not landing: library +%s, captured +%s (%s%%) between census %s and %s',
                                         v_grew, v_new_captured, round(v_new_share * 100, 1), v_prev.id, v_last.id);
      END IF;
    END IF;

    IF v_cov < c_target THEN
      v_reasons := v_reasons || format('library not landed: %s of %s photos captured (%s%%), census %s',
                                       v_last.captured, v_last.photos, round(v_cov * 100, 1), v_last.id);
    END IF;
  END IF;

  v_out := jsonb_build_object(
    'assayed_at', now(),
    'census_id', v_last.id, 'census_at', v_last.census_at,
    'library_photos', v_last.photos, 'captured', v_last.captured, 'coverage', v_cov,
    'window_census_id', v_prev.id, 'window_grew', v_grew, 'window_captured', v_new_captured, 'window_share', v_new_share,
    'reasons', to_jsonb(v_reasons));

  IF p_raise AND cardinality(v_reasons) > 0 THEN
    RAISE EXCEPTION 'library intake: %', array_to_string(v_reasons, '; ');
  END IF;
  RETURN v_out;
END
$fn$;

COMMENT ON FUNCTION public.assay_library_intake(boolean) IS
  'Whether the owner''s whole Photos library is landing, read from the iphoto source_census (scripts/assays/iphoto-census.py). Raises (p_raise) when the census is older than 30 h, when the library grew by more than 50 photos over 7 days and under 80% of them were captured, or when captured/library is below 95%. Cron library-intake-watch (daily 09:30 UTC, after the 04:15 local census). Service role only. Migration 20261114120000.';

REVOKE ALL ON FUNCTION public.assay_library_intake(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assay_library_intake(boolean) TO service_role;

DO $$
DECLARE j text;
BEGIN
  FOR j IN SELECT jobname FROM cron.job WHERE jobname = 'library-intake-watch' LOOP
    PERFORM cron.unschedule(j);
  END LOOP;
  PERFORM cron.schedule('library-intake-watch', '30 9 * * *',
    $cmd$SET statement_timeout = '20s'; SELECT public.assay_library_intake();$cmd$);
END $$;

DO $chk$
BEGIN
  IF to_regprocedure('public.assay_library_intake(boolean)') IS NULL THEN RAISE EXCEPTION 'assay_library_intake missing'; END IF;
  IF has_function_privilege('anon', 'public.assay_library_intake(boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.assay_library_intake(boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'assay_library_intake must be service_role only';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'library-intake-watch') THEN RAISE EXCEPTION 'library-intake-watch not scheduled'; END IF;
END $chk$;
