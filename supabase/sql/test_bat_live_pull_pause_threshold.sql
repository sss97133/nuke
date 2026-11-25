-- Disposable PG17: migration 20261126113500 (bat-live-pull pause rule row 15000 -> 30000 ms). Proves: the bat row
-- moves from the reviewed 15000 to 30000 with its basis, other live_pull keys kept; applying twice changes nothing more;
-- a bat row holding any other value and another source are untouched; the new value is read by the function's own
-- parse (step 2b: v_cfg ->> 'pause_run_p50_ms' ~ '^\d{1,6}$'), and the run samples that paused the pull at 06:06 PT
-- 2026-11-25 (median 16,830 ms) pause it under the old value and not under the new one. Synthetic rows only.
\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database() NOT LIKE 'dm_refinement_%' THEN RAISE EXCEPTION 'disposable database only'; END IF; END $$;

CREATE FUNCTION public.assert(cond boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', msg; END IF; END $$;

CREATE TABLE public.live_auction_sources (id uuid PRIMARY KEY, slug text UNIQUE, scraping_config jsonb DEFAULT '{}');
INSERT INTO public.live_auction_sources (id, slug, scraping_config) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'bat', '{"live_pull": {"pause_run_p50_ms": 15000, "closing_slots": 1,
     "lots_per_run": 6, "run_samples": [[1,13941],[2,3768],[3,26747],[4,39505],[5,7525],[6,22082],[7,522],[8,29272],
     [9,26976],[10,16830]]}, "other": true}'),
  ('00000000-0000-0000-0000-0000000000a2', 'other', '{"live_pull": {"pause_run_p50_ms": 15000}}');

-- The function's own 2b reading of the rule row and the samples.
CREATE FUNCTION pg_temp.pauses(cfg jsonb) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE v_pause_ms integer; v_lat numeric[];
BEGIN
  v_pause_ms := coalesce(CASE WHEN cfg ->> 'pause_run_p50_ms' ~ '^\d{1,6}$' THEN (cfg ->> 'pause_run_p50_ms')::integer END, 15000);
  SELECT array_agg((s ->> 1)::numeric ORDER BY (s ->> 1)::numeric) INTO v_lat
  FROM jsonb_array_elements(coalesce(cfg -> 'run_samples', '[]'::jsonb)) s
  WHERE jsonb_typeof(s) = 'array' AND (s ->> 1) ~ '^\d{1,9}$';
  RETURN coalesce(array_length(v_lat, 1), 0) >= 3 AND v_lat[(array_length(v_lat, 1) + 1) / 2] > v_pause_ms;
END $$;

SELECT public.assert(pg_temp.pauses(scraping_config -> 'live_pull'), 'the 06:06 samples pause the pull at 15000')
FROM public.live_auction_sources WHERE slug = 'bat';

\i supabase/migrations/20261126113500_bat_live_pull_pause_threshold.sql
CREATE TEMP TABLE after_first AS SELECT slug, scraping_config FROM public.live_auction_sources;
\i supabase/migrations/20261126113500_bat_live_pull_pause_threshold.sql

SELECT public.assert(scraping_config #> '{live_pull,pause_run_p50_ms}' = '30000'::jsonb, 'bat rule row is 30000')
FROM public.live_auction_sources WHERE slug = 'bat';
SELECT public.assert(scraping_config #>> '{live_pull,pause_basis,migration}' = '20261126113500'
  AND scraping_config #> '{live_pull,pause_basis,previous_ms}' = '15000'::jsonb
  AND scraping_config #> '{live_pull,pause_basis,statement_timeout_s}' = '50'::jsonb, 'basis kept on the row')
FROM public.live_auction_sources WHERE slug = 'bat';
SELECT public.assert(scraping_config #> '{live_pull,closing_slots}' = '1'::jsonb
  AND scraping_config #> '{live_pull,lots_per_run}' = '6'::jsonb
  AND jsonb_array_length(scraping_config #> '{live_pull,run_samples}') = 10
  AND scraping_config -> 'other' = 'true'::jsonb, 'other keys kept')
FROM public.live_auction_sources WHERE slug = 'bat';
SELECT public.assert(NOT pg_temp.pauses(scraping_config -> 'live_pull'), 'the same samples do not pause it at 30000')
FROM public.live_auction_sources WHERE slug = 'bat';
SELECT public.assert(scraping_config = '{"live_pull": {"pause_run_p50_ms": 15000}}'::jsonb, 'other source untouched')
FROM public.live_auction_sources WHERE slug = 'other';
SELECT public.assert(NOT EXISTS (SELECT 1 FROM public.live_auction_sources s JOIN after_first a USING (slug)
  WHERE s.scraping_config IS DISTINCT FROM a.scraping_config), 'second apply changes nothing');

-- A value someone else set is not overwritten.
UPDATE public.live_auction_sources SET scraping_config = jsonb_set(scraping_config, '{live_pull,pause_run_p50_ms}', '20000')
WHERE slug = 'bat';
\i supabase/migrations/20261126113500_bat_live_pull_pause_threshold.sql
SELECT public.assert(scraping_config #> '{live_pull,pause_run_p50_ms}' = '20000'::jsonb, 'a non-reviewed value is left alone')
FROM public.live_auction_sources WHERE slug = 'bat';

SELECT 'test_bat_live_pull_pause_threshold: PASS' AS result;
