-- The first production sample (barnfinds, 1,500 events) took 29.8 s against the 60 s ceiling: the random vehicle reads are the cost
-- on a loaded disk. sample_rows_per_source drops from 1,500 to 600 (a slice of 9% of 600 still gives 50 lots, above min_sample 30), and
-- the stale source is picked at random, so a source whose sample ever times out cannot hold the pipeline at the same step.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '10s';
UPDATE public.firecrawl_params SET value = 600, set_at = now(),
  note = 'Most vehicle_events rows one firecrawl_sample_source call reads (bounded sample; a smaller source is read in full). 600 since 2026-10-15: 1,500 took 29.8 s on production, half of the 60 s ceiling.'
 WHERE key = 'sample_rows_per_source';
CREATE OR REPLACE FUNCTION public.firecrawl_pipeline_step()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_gate jsonb;
  v_t timestamptz := clock_timestamp();
  v_week interval := interval '6 days';
  v_src text;
  v_step text;
  v_res jsonb;
  v_last_alloc timestamptz;
  v_inputs timestamptz;
BEGIN
  v_gate := public.firecrawl_io_gate();
  IF NOT (v_gate ->> 'open')::boolean THEN
    RETURN jsonb_build_object('step', 'gate_closed', 'gate', v_gate);
  END IF;
  IF coalesce((SELECT max(computed_at) FROM public.firecrawl_group_score), '-infinity') < now() - v_week THEN
    v_step := 'groups'; v_res := jsonb_build_object('rows', public.firecrawl_refresh_groups());
  ELSE
    SELECT s.source INTO v_src FROM public.firecrawl_source_params s
      LEFT JOIN (SELECT source, max(sampled_at) m FROM public.firecrawl_source_sample GROUP BY 1) x ON x.source = s.source
     WHERE coalesce(x.m, '-infinity') < now() - v_week ORDER BY random() LIMIT 1;
    IF v_src IS NOT NULL THEN
      v_step := 'sample'; v_res := jsonb_build_object('source', v_src, 'n', (public.firecrawl_sample_source(v_src) ->> 'n')::int);
    ELSIF coalesce((SELECT max(scored_at) FROM public.firecrawl_lot_score), '-infinity') < now() - interval '1 day' THEN
      v_step := 'score_lots';
      v_res := jsonb_build_object('rows', public.firecrawl_score_lots(greatest(
                 coalesce((SELECT max(landed_at) FROM public.firecrawl_lot_score), now() - interval '30 days') - interval '3 days', now() - interval '30 days')));
    ELSE
      SELECT max(computed_at) INTO v_last_alloc FROM public.firecrawl_target_allocation;
      SELECT greatest((SELECT max(sampled_at) FROM public.firecrawl_source_sample), (SELECT max(computed_at) FROM public.firecrawl_group_score),
                      (SELECT max(scored_at) FROM public.firecrawl_lot_score)) INTO v_inputs;
      IF v_last_alloc IS NULL OR v_inputs > v_last_alloc THEN
        v_step := 'allocation'; v_res := public.refresh_firecrawl_target_allocation();
      ELSE
        v_step := 'idle'; v_res := '{}'::jsonb;
      END IF;
    END IF;
  END IF;
  IF v_step <> 'idle' THEN
    INSERT INTO public.firecrawl_pipeline_log (step, detail, runtime_ms, gate)
    VALUES (v_step, v_res, round(extract(epoch FROM clock_timestamp() - v_t) * 1000), v_gate);
  END IF;
  RETURN jsonb_build_object('step', v_step, 'detail', v_res, 'runtime_ms', round(extract(epoch FROM clock_timestamp() - v_t) * 1000));
END $$;

REVOKE ALL ON FUNCTION public.firecrawl_pipeline_step() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.firecrawl_pipeline_step() TO service_role;
COMMIT;
