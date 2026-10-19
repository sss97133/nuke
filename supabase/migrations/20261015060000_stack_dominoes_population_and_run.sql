-- 1. v_source_dominoes: the coverage figure is landed over the source's population (source_target_coverage.landed_of_population,
--    with population, method, confidence and date), appended after the existing columns. landed_pct stays and is against the
--    target list, not the population (measured 2026-10-15: mecum 18.33% of targets, 23.10% of population).
-- 2. The job's time limit is 120 s per statement (db-safety: never raise statement_timeout; 120 s is the ceiling the lead
--    set; the cohort read is already one statement per source, so no read needs more than its own 120 s).
-- 3. A one-off job 'snapshot-stack-dominoes-firstrun' runs the same command once at the next minute and unschedules itself
--    as its first statement, so a failure part-way cannot repeat it. Its outcome is read from cron.job_run_details.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE VIEW public.v_source_dominoes AS
SELECT c.source_slug, c.total_targets, c.landed, c.gap AS targets_not_in_queue, c.landed_pct, c.landed_measured_at,
       d.stack_id, d.name AS stack_name, d.layer, d.kind, d.object, d.verdict, d.verdict_can_change_with_lots,
       d.feed_basis,
       (SELECT (s ->> 'rows')::bigint FROM jsonb_array_elements(d.feeding_sources) s
         WHERE s ->> 'source_key' = regexp_replace(lower(c.source_slug), '[-_ ]', '', 'g')) AS source_rows_in_input,
       d.coverage_measured_at,
       c.population, c.landed_of_population, c.population_method, c.population_confidence, c.population_at
FROM public.source_target_coverage c
JOIN public.v_stack_dominoes d ON regexp_replace(lower(c.source_slug), '[-_ ]', '', 'g') = ANY (d.moves_with)
ORDER BY c.source_slug, d.stack_id;
COMMENT ON VIEW public.v_source_dominoes IS
'The domino map from a source: for each source in source_target_coverage every stack input that source feeds (v_stack_dominoes.moves_with), with the source''s rows in that input where measured and whether the verdict can change with more lots. landed_pct is landed over the target list; landed_of_population is landed over the source''s population (population, population_method, population_confidence, population_at) and is the coverage figure to quote. service_role reads.';

SELECT cron.schedule('snapshot-stack-dominoes', '25 4 * * *',
  $c$SET statement_timeout = '120s'; SELECT public.snapshot_stack_coverage('cron:snapshot-stack-dominoes'); SELECT public.snapshot_stack_dominoes_begin('cron:snapshot-stack-dominoes'); SELECT public.snapshot_stack_dominoes_read('bat'); SELECT public.snapshot_stack_dominoes_read('mecum'); SELECT public.snapshot_stack_dominoes_read('barrettjackson'); SELECT public.snapshot_stack_dominoes_read('cars_and_bids'); SELECT public.snapshot_stack_dominoes_read('gooding'); SELECT public.snapshot_stack_dominoes_read('bonhams'); SELECT public.snapshot_stack_dominoes_read('rm-sothebys'); SELECT public.snapshot_stack_dominoes_read('pcarmarket'); SELECT public.snapshot_stack_dominoes_read('conceptcarz'); SELECT public.snapshot_stack_dominoes_finish();$c$);

SELECT cron.schedule('snapshot-stack-dominoes-firstrun', '* * * * *',
  $c$SELECT cron.unschedule('snapshot-stack-dominoes-firstrun'); SET statement_timeout = '120s'; SELECT public.snapshot_stack_coverage('cron:firstrun'); SELECT public.snapshot_stack_dominoes_begin('cron:firstrun'); SELECT public.snapshot_stack_dominoes_read('bat'); SELECT public.snapshot_stack_dominoes_read('mecum'); SELECT public.snapshot_stack_dominoes_read('barrettjackson'); SELECT public.snapshot_stack_dominoes_read('cars_and_bids'); SELECT public.snapshot_stack_dominoes_read('gooding'); SELECT public.snapshot_stack_dominoes_read('bonhams'); SELECT public.snapshot_stack_dominoes_read('rm-sothebys'); SELECT public.snapshot_stack_dominoes_read('pcarmarket'); SELECT public.snapshot_stack_dominoes_read('conceptcarz'); SELECT public.snapshot_stack_dominoes_finish();$c$);

COMMIT;
