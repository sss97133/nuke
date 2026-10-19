-- Firecrawl allocation: a bounded pipeline behind the IO gate (2026-10-15, owner-lead).
-- The one-shot recompute (cron job 596, 900 s) read from disk for about 11 minutes and, on this instance, a saturated disk makes
-- pg_cron's new connections stall: 9 jobs failed to start at 21:46Z. The recompute is now a pipeline of steps, each bounded and
-- each behind the IO gate (no more than 3 client queries on DataFileRead, no lock waits, no PostgREST query slower than 2 s):
--   firecrawl_refresh_groups()    the vehicle-group scores, weekly (reads the 236k-row mv_family_sales and the owner's vehicles)
--   firecrawl_sample_source(s)    one source: at most sample_rows_per_source (1,500) events, joined to vehicles; best_v1 and
--                                 best_v1.1 per sampled lot; an exact count of the source's events; stored in firecrawl_source_sample
--   firecrawl_score_lots(since)   the lots Firecrawl landed since the last scored lot, minus 3 days (daily)
--   refresh_firecrawl_target_allocation()   reads only stored samples, group scores, census rows, lot scores and credit counts;
--                                 no scan of vehicle_events or vehicles; it takes seconds
--   firecrawl_pipeline_step()     does the next due step (groups, a stale sample, scoring, allocation) or nothing; cron every 5 minutes
--                                 with a 60 s ceiling. Runtimes are in firecrawl_pipeline_log.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS public.firecrawl_source_sample (
  source text NOT NULL,
  sampled_at timestamptz NOT NULL,
  sample jsonb NOT NULL,
  PRIMARY KEY (source, sampled_at)
);
CREATE TABLE IF NOT EXISTS public.firecrawl_pipeline_log (
  id bigserial PRIMARY KEY,
  ran_at timestamptz NOT NULL DEFAULT now(),
  step text NOT NULL,
  detail jsonb,
  runtime_ms numeric,
  gate jsonb
);
CREATE INDEX IF NOT EXISTS firecrawl_pipeline_log_ran ON public.firecrawl_pipeline_log (ran_at DESC);
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['firecrawl_source_sample', 'firecrawl_pipeline_log'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;
REVOKE ALL ON SEQUENCE public.firecrawl_pipeline_log_id_seq FROM anon, authenticated;
COMMENT ON TABLE public.firecrawl_source_sample IS 'Per-source sample statistics (tier shares, completeness, mean best_v1 and best_v1.1, supply clocks, an exact event count) written by firecrawl_sample_source and read by the allocation refresh.';
COMMENT ON TABLE public.firecrawl_pipeline_log IS 'One row per firecrawl_pipeline_step() run that did work: the step, its detail, its runtime in ms and the IO gate it saw.';

INSERT INTO public.firecrawl_params (key, value, text_value, note) VALUES
 ('sample_rows_per_source', 1500, NULL, 'Most vehicle_events rows one firecrawl_sample_source call reads (bounded sample; a smaller source is read in full).')
ON CONFLICT (key) DO NOTHING;


-- The IO gate the writers use (no more than 3 client queries on DataFileRead, no lock waits, no PostgREST query slower than 2 s),
-- read from pg_stat_activity. Every heavy step of the pipeline checks it first and does nothing while it is closed.
CREATE OR REPLACE FUNCTION public.firecrawl_io_gate()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
  SELECT jsonb_build_object('open', (io <= 3 AND lw = 0 AND slow = 0), 'io_waiters', io, 'lock_waiters', lw, 'slow_rest_queries', slow)
  FROM (SELECT count(*) FILTER (WHERE backend_type = 'client backend' AND state = 'active' AND wait_event_type = 'IO'
                                  AND wait_event = 'DataFileRead' AND pid <> pg_backend_pid()) io,
               count(*) FILTER (WHERE wait_event_type = 'Lock') lw,
               count(*) FILTER (WHERE usename = 'authenticator' AND state = 'active' AND now() - query_start > interval '2 seconds') slow
          FROM pg_stat_activity) s
$$;

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
     WHERE coalesce(x.m, '-infinity') < now() - v_week ORDER BY coalesce(x.m, '-infinity'), s.source LIMIT 1;
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

CREATE OR REPLACE FUNCTION public.firecrawl_refresh_groups()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_now timestamptz := now();
  v_owner uuid := (SELECT nullif(text_value, '')::uuid FROM public.firecrawl_params WHERE key = 'owner_user_id');
  v_w1 numeric := firecrawl_param('tier1_weight', 1);
  v_w2 numeric := firecrawl_param('tier2_weight', 0.6);
  v_w3 numeric := firecrawl_param('tier3_weight', 0.2);
  v_n integer;
BEGIN
  -- Vehicle groups (family x year band), from priced sales: liquidity, dispersion, tier, the owner's own vehicles.
  CREATE TEMP TABLE fc_grp ON COMMIT DROP AS
  WITH b AS (
    SELECT brand, family_key, CASE WHEN year BETWEEN 1964 AND 1973 THEN 1 WHEN year BETWEEN 1974 AND 1991 THEN 2 ELSE 3 END band, usd, sale_date
      FROM mv_family_sales
     WHERE family_key <> 'other' AND year IS NOT NULL AND sale_date <= current_date
       AND sale_date >= current_date - (firecrawl_param('dispersion_months', 36)::int * interval '1 month')
  ), grp AS (
    SELECT brand, family_key, band, count(*) n_disp,
           count(*) FILTER (WHERE sale_date >= current_date - (firecrawl_param('liquidity_months', 12)::int * interval '1 month')) n_liq,
           (percentile_cont(0.75) WITHIN GROUP (ORDER BY usd) - percentile_cont(0.25) WITHIN GROUP (ORDER BY usd))
             / nullif(percentile_cont(0.5) WITHIN GROUP (ORDER BY usd), 0) disp
      FROM b GROUP BY 1, 2, 3 HAVING count(*) >= firecrawl_param('min_group_sales', 8)
  ), own AS (
    SELECT n.family_id::text family_key,
           CASE WHEN v.year BETWEEN 1964 AND 1973 THEN 1 WHEN v.year BETWEEN 1974 AND 1991 THEN 2 ELSE 3 END band,
           sum(CASE WHEN ver.vehicle_id IS NOT NULL THEN firecrawl_param('own_verified_weight', 1) ELSE firecrawl_param('own_recorded_weight', 0.1) END) own_weight,
           count(*) FILTER (WHERE ver.vehicle_id IS NOT NULL) verified, count(*) recorded
      FROM vehicles v
      JOIN mv_model_family_names n ON n.make_l = lower(v.make) AND n.model_l = lower(coalesce(v.model, '')) AND n.family_id IS NOT NULL
           AND (v.year IS NULL OR n.year_start IS NULL OR v.year >= n.year_start - 1)
           AND (v.year IS NULL OR n.year_end IS NULL OR v.year <= n.year_end + 1)
      LEFT JOIN (SELECT vehicle_id FROM vehicle_ownerships WHERE owner_profile_id = v_owner AND is_current AND role = 'verified_owner'
                 UNION SELECT vehicle_id FROM vehicle_user_permissions
                  WHERE user_id = v_owner AND role IN ('owner', 'co_owner') AND is_active AND revoked_at IS NULL) ver ON ver.vehicle_id = v.id
     WHERE v_owner IS NOT NULL AND v.deleted_at IS NULL AND (v.owner_id = v_owner OR v.user_id = v_owner OR ver.vehicle_id IS NOT NULL)
     GROUP BY 1, 2
  )
  SELECT g.brand, g.family_key, g.band, g.n_disp, g.n_liq, g.disp, coalesce(o.own_weight, 0) own_weight,
         coalesce(o.verified, 0) own_verified, coalesce(o.recorded, 0) own_recorded,
         percent_rank() OVER (ORDER BY g.n_liq) liq_rank,
         percent_rank() OVER (ORDER BY g.disp) info_rank,
         CASE g.band WHEN 1 THEN v_w1 WHEN 2 THEN v_w2 ELSE v_w3 END tier_weight
    FROM grp g LEFT JOIN own o ON o.family_key = g.family_key AND o.band = g.band;
  ALTER TABLE fc_grp ADD COLUMN family text, ADD COLUMN gscore numeric;
  UPDATE fc_grp x SET family = (SELECT m.family FROM mv_family_market m WHERE m.family_key = x.family_key AND m.brand = x.brand LIMIT 1);
  UPDATE fc_grp x SET gscore = x.tier_weight * sqrt(greatest(x.liq_rank, 0.01) * greatest(x.info_rank, 0.01)) * (1 + least(x.own_weight, 1) * firecrawl_param('own_verified_weight', 1));

  INSERT INTO public.firecrawl_group_score (family_key, band, brand, family, gscore, inputs, computed_at)
  SELECT family_key, band, brand, family, gscore,
         jsonb_build_object('tier_weight', tier_weight, 'sales_per_year', n_liq, 'sales_in_dispersion_window', n_disp, 'dispersion', disp,
                            'liquidity_rank', liq_rank, 'information_rank', info_rank, 'own_weight', own_weight,
                            'own_verified', own_verified, 'own_recorded', own_recorded), v_now
    FROM fc_grp;


  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

CREATE OR REPLACE FUNCTION public.firecrawl_sample_source(p_source text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  r record;
  v_cap int := firecrawl_param('sample_rows_per_source', 1500)::int;
  v_n_est bigint;
  v_pct numeric;
  v_gat timestamptz;
  v_gmax numeric;
  v_now timestamptz := clock_timestamp();
  v_landed bigint;
  v_out jsonb;
BEGIN
  SELECT * INTO r FROM public.firecrawl_source_params WHERE source = p_source;
  IF NOT FOUND THEN RAISE EXCEPTION 'firecrawl_sample_source: unknown source %', p_source; END IF;
  SELECT max(computed_at) INTO v_gat FROM public.firecrawl_group_score;
  SELECT max(gscore) INTO v_gmax FROM public.firecrawl_group_score WHERE computed_at = v_gat;
  SELECT coalesce(sum(cnt), 0) INTO v_n_est FROM mv_events_by_platform WHERE source_platform = ANY (r.event_platforms);
  SELECT coalesce(max(landed_lots), 0) INTO v_landed FROM mv_source_target_landed
   WHERE regexp_replace(lower(source_slug), '[-_ ]', '', 'g') = regexp_replace(lower(r.source), '[-_ ]', '', 'g');
  v_n_est := greatest(v_n_est, v_landed, 1);
  -- At most v_cap events: the whole source when it is that small, else a TABLESAMPLE slice sized to land near v_cap rows.
  v_pct := CASE WHEN v_n_est <= v_cap THEN 100 ELSE least(100, round(100.0 * v_cap * 1.4 / v_n_est, 3)) END;
  CREATE TEMP TABLE fc_ev1 (vehicle_id uuid, created_at timestamptz, other_platform boolean, year int, sale_price numeric,
                            complete_share numeric, ended_at timestamptz, best numeric, best11 numeric) ON COMMIT DROP;
  EXECUTE format($q$
    INSERT INTO fc_ev1
    SELECT e.vehicle_id, e.created_at,
           EXISTS (SELECT 1 FROM vehicle_events o WHERE o.vehicle_id = e.vehicle_id AND o.source_platform <> e.source_platform),
           v.year, v.sale_price,
           ((v.description IS NOT NULL)::int + (v.vin IS NOT NULL)::int + ((v.primary_image_url IS NOT NULL OR coalesce(v.image_count, 0) > 0))::int) / 3.0,
           e.ended_at,
           (firecrawl_best_v1(v.year, v.description IS NOT NULL, v.vin IS NOT NULL, (v.primary_image_url IS NOT NULL OR coalesce(v.image_count, 0) > 0),
              coalesce(v.listing_location, v.location, v.city, v.state) IS NOT NULL, v.sale_price, v.canonical_outcome,
              EXISTS (SELECT 1 FROM vehicle_events o WHERE o.vehicle_id = e.vehicle_id AND o.source_platform <> e.source_platform),
              CASE WHEN fam.family_id IS NULL THEN NULL ELSE coalesce(g.gscore / nullif(%s::numeric, 0), 0) END) ->> 'score')::numeric,
           (firecrawl_best_v1_1(v.year, v.description IS NOT NULL, v.vin IS NOT NULL, (v.primary_image_url IS NOT NULL OR coalesce(v.image_count, 0) > 0),
              coalesce(v.listing_location, v.location, v.city, v.state) IS NOT NULL, v.sale_price, v.canonical_outcome,
              EXISTS (SELECT 1 FROM vehicle_events o WHERE o.vehicle_id = e.vehicle_id AND o.source_platform <> e.source_platform),
              CASE WHEN fam.family_id IS NULL THEN NULL ELSE coalesce(g.gscore / nullif(%s::numeric, 0), 0) END,
              firecrawl_quality_derive(v.description, v.year, v.vin,
                EXISTS (SELECT 1 FROM vehicle_events o WHERE o.vehicle_id = e.vehicle_id AND o.source_platform = e.source_platform AND o.id <> e.id))) ->> 'score')::numeric
      FROM vehicle_events e %s
      LEFT JOIN vehicles v ON v.id = e.vehicle_id AND v.deleted_at IS NULL
      LEFT JOIN LATERAL (SELECT n.family_id::text family_id FROM mv_model_family_names n
                          WHERE n.make_l = lower(v.make) AND n.model_l = lower(coalesce(v.model, '')) AND n.family_id IS NOT NULL
                            AND (v.year IS NULL OR n.year_start IS NULL OR v.year >= n.year_start - 1)
                            AND (v.year IS NULL OR n.year_end IS NULL OR v.year <= n.year_end + 1) LIMIT 1) fam ON true
      LEFT JOIN public.firecrawl_group_score g ON g.family_key = fam.family_id AND g.computed_at = %L
           AND g.band = CASE WHEN v.year BETWEEN 1964 AND 1973 THEN 1 WHEN v.year BETWEEN 1974 AND 1991 THEN 2 ELSE 3 END
     WHERE e.source_platform = ANY (%L::text[])
     LIMIT %s$q$,
    coalesce(v_gmax, 0), coalesce(v_gmax, 0),
    CASE WHEN v_pct >= 100 THEN '' ELSE format('TABLESAMPLE SYSTEM (%s)', v_pct) END,
    v_gat, r.event_platforms, v_cap);
  -- Exact count of the source's events (an index-only count on source_platform) for the gap against its population.
  SELECT count(*) INTO v_landed FROM vehicle_events WHERE source_platform = ANY (r.event_platforms);
  SELECT jsonb_build_object(
      'n', count(*), 'scaled', count(*) * CASE WHEN v_pct >= 100 THEN 1 ELSE 100.0 / v_pct END,
      't1', count(*) FILTER (WHERE year BETWEEN 1964 AND 1973), 't2', count(*) FILTER (WHERE year BETWEEN 1974 AND 1991),
      'with_year', count(*) FILTER (WHERE year IS NOT NULL), 'priced', count(*) FILTER (WHERE sale_price > 0),
      'joined', count(*) FILTER (WHERE vehicle_id IS NOT NULL AND year IS NOT NULL), 'compl', avg(complete_share),
      'mean_best', avg(best) FILTER (WHERE vehicle_id IS NOT NULL AND year IS NOT NULL),
      'mean_best11', avg(best11) FILTER (WHERE vehicle_id IS NOT NULL AND year IS NOT NULL),
      'joined11', count(best11) FILTER (WHERE vehicle_id IS NOT NULL AND year IS NOT NULL),
      'cross_listed', count(*) FILTER (WHERE other_platform), 'recent14', count(*) FILTER (WHERE created_at >= v_now - interval '14 days'),
      'ended_n', count(ended_at), 'ended14', count(*) FILTER (WHERE ended_at >= v_now - interval '14 days' AND ended_at <= v_now),
      'scale', CASE WHEN v_pct >= 100 THEN 1 ELSE 100.0 / v_pct END,
      'slice_n', count(*) FILTER (WHERE year BETWEEN r.slice_year_from AND r.slice_year_to),
      'slice_mean11', avg(best11) FILTER (WHERE year BETWEEN r.slice_year_from AND r.slice_year_to),
      'slice_n11', count(best11) FILTER (WHERE year BETWEEN r.slice_year_from AND r.slice_year_to),
      'landed_events', v_landed, 'sample_pct', v_pct, 'row_cap', v_cap)
    INTO v_out FROM fc_ev1;
  INSERT INTO public.firecrawl_source_sample (source, sampled_at, sample) VALUES (p_source, now(), v_out);
  DELETE FROM public.firecrawl_source_sample WHERE source = p_source AND sampled_at < now() - interval '8 weeks';
  RETURN v_out;
END $$;

CREATE OR REPLACE FUNCTION public.refresh_firecrawl_target_allocation(p_landed jsonb DEFAULT NULL, p_landed_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  r record;
  k int;
  v_now timestamptz := now();
  v_budget numeric := firecrawl_param('monthly_credits', 1000);
  v_alloc_budget numeric := v_budget * (1 - firecrawl_param('reserve_fraction', 0.15));
  v_remaining numeric;
  v_cap numeric;
  v_give numeric;
  v_top int := firecrawl_param('top_groups_per_source', 20)::int;
  v_owner uuid := (SELECT nullif(text_value, '')::uuid FROM public.firecrawl_params WHERE key = 'owner_user_id');
  v_w1 numeric := firecrawl_param('tier1_weight', 1);
  v_w2 numeric := firecrawl_param('tier2_weight', 0.6);
  v_w3 numeric := firecrawl_param('tier3_weight', 0.2);
  v_small int := firecrawl_param('sample_events_small', 4000)::int;
  v_pct numeric := firecrawl_param('sample_pct_large', 4);
  v_min int := firecrawl_param('min_sample', 30)::int;
  v_horizon int := firecrawl_param('live_horizon_days', 30)::int;
  v_floor numeric := firecrawl_param('free_cost_floor', 0.01);
  v_n_est bigint;
  v_rows int;
  v_group_sum numeric;
  v_sum_alloc numeric := 0;
  v_gmax numeric;
  v_window interval := firecrawl_param('observed_window_days', 30)::int * interval '1 day';
  v_held numeric := 0;
  v_minrank numeric := firecrawl_param('min_rank_leftover', 0.5);
  v_qpct numeric := firecrawl_param('quality_subsample_pct', 8);
  v_ver text := coalesce((SELECT text_value FROM public.firecrawl_params WHERE key = 'metric_version'), 'best_v1');
BEGIN
  -- 1. Vehicle groups: the stored scores of the last firecrawl_refresh_groups() run (weekly, gated), not a rescan of the sales.
  CREATE TEMP TABLE fc_grp ON COMMIT DROP AS
  SELECT family_key, band, brand, family, gscore,
         (inputs ->> 'tier_weight')::numeric tier_weight, (inputs ->> 'sales_per_year')::numeric n_liq,
         (inputs ->> 'sales_in_dispersion_window')::numeric n_disp, (inputs ->> 'dispersion')::numeric disp,
         (inputs ->> 'liquidity_rank')::numeric liq_rank, (inputs ->> 'information_rank')::numeric info_rank,
         (inputs ->> 'own_weight')::numeric own_weight, (inputs ->> 'own_verified')::numeric own_verified,
         (inputs ->> 'own_recorded')::numeric own_recorded
    FROM public.firecrawl_group_score WHERE computed_at = (SELECT max(computed_at) FROM public.firecrawl_group_score);
  SELECT max(gscore) INTO v_gmax FROM fc_grp;

  -- 2. Source inputs, each dated; NULL = unknown.
  CREATE TEMP TABLE fc_src ON COMMIT DROP AS
  WITH ev AS (
    SELECT DISTINCT ON (source) source, sampled_at,
           (sample ->> 'n')::bigint n, (sample ->> 'scaled')::numeric scaled, (sample ->> 't1')::bigint t1, (sample ->> 't2')::bigint t2,
           (sample ->> 'with_year')::bigint with_year, (sample ->> 'priced')::bigint priced, (sample ->> 'joined')::bigint joined,
           (sample ->> 'compl')::numeric compl, (sample ->> 'mean_best')::numeric mean_best, (sample ->> 'mean_best11')::numeric mean_best11,
           (sample ->> 'joined11')::bigint joined11, (sample ->> 'cross_listed')::bigint cross_listed, (sample ->> 'recent14')::bigint recent14,
           (sample ->> 'ended_n')::bigint ended_n, (sample ->> 'ended14')::bigint ended14, (sample ->> 'scale')::numeric scale,
           (sample ->> 'slice_n')::bigint slice_n, (sample ->> 'slice_mean11')::numeric slice_mean11, (sample ->> 'slice_n11')::bigint slice_n11,
           (sample ->> 'landed_events')::bigint landed_events
      FROM public.firecrawl_source_sample ORDER BY source, sampled_at DESC
  ), pop AS (
    SELECT DISTINCT ON (o.slug) o.slug, c.universe_total, c.census_method, c.census_confidence, c.census_at
      FROM public.source_census c JOIN public.observation_sources o ON o.id = c.source_id
     WHERE c.universe_total IS NULL OR c.universe_historical IS NOT NULL
     ORDER BY o.slug, c.census_at DESC
  ), sc AS (
    SELECT DISTINCT ON (o.slug) o.slug, (c.raw_response ->> 'gap_tier_missing')::numeric gap_scoped, c.census_at scoped_at,
           c.universe_total scoped_total,
           CASE WHEN c.raw_response ? 'window' THEN (c.raw_response -> 'window' ->> 1)::date - (c.raw_response -> 'window' ->> 0)::date END scoped_days
      FROM public.source_census c JOIN public.observation_sources o ON o.id = c.source_id
     WHERE c.universe_historical IS NULL AND c.raw_response ? 'gap_tier_missing'
     ORDER BY o.slug, c.census_at DESC
  ), lan AS (
    SELECT s.source,
           coalesce((p_landed ->> s.source)::numeric, (SELECT ev.landed_events FROM ev WHERE ev.source = s.source),
                    (SELECT m.landed_lots FROM mv_source_target_landed m
                      WHERE regexp_replace(lower(m.source_slug), '[-_ ]', '', 'g') = regexp_replace(lower(s.source), '[-_ ]', '', 'g') LIMIT 1)) landed,
           CASE WHEN p_landed ? s.source THEN p_landed_at
                WHEN (SELECT ev.landed_events FROM ev WHERE ev.source = s.source) IS NOT NULL THEN (SELECT ev.sampled_at FROM ev WHERE ev.source = s.source)
                ELSE (SELECT m.measured_at FROM mv_source_target_landed m
                       WHERE regexp_replace(lower(m.source_slug), '[-_ ]', '', 'g') = regexp_replace(lower(s.source), '[-_ ]', '', 'g') LIMIT 1) END landed_at
      FROM public.firecrawl_source_params s
  ), obs AS (
    SELECT source, sum(credits) credits, sum(lots) lots FROM public.firecrawl_spend_log
     WHERE spent_at >= v_now - interval '60 days' GROUP BY source
  )
  SELECT s.source, s.firecrawl_dependent, s.supply_kind,
         CASE WHEN obs.lots >= firecrawl_param('observed_cost_min_lots', 50) THEN obs.credits / obs.lots ELSE s.credits_per_lot END credits_per_lot,
         CASE WHEN obs.lots >= firecrawl_param('observed_cost_min_lots', 50) THEN 'observed in firecrawl_spend_log, 60 days' ELSE s.cost_basis END cost_basis,
         ev.n sample_n, ev.joined joined_n, ev.scale sample_scale, ev.sampled_at sample_at,
         CASE WHEN s.slice_year_from IS NOT NULL THEN CASE WHEN ev.slice_n11 >= v_min THEN ev.slice_mean11 END
              WHEN v_ver = 'best_v1_1' THEN CASE WHEN ev.joined11 >= v_min THEN ev.mean_best11 END
              ELSE CASE WHEN ev.joined >= v_min THEN ev.mean_best END END mean_best,
         CASE WHEN ev.joined >= v_min THEN ev.mean_best END mean_best_v1,
         CASE WHEN ev.joined11 >= v_min THEN ev.mean_best11 END mean_best_v1_1, ev.joined11 sample_n_v1_1,
         s.owner_judgment, s.paused, s.credit_cap, s.cap_note,
         CASE WHEN ev.joined >= v_min THEN (ev.t1 * v_w1 + ev.t2 * v_w2 + (ev.with_year - ev.t1 - ev.t2) * v_w3) / nullif(ev.with_year, 0) / v_w1 END c_tier,
         CASE WHEN ev.joined >= v_min THEN ev.t1::numeric / nullif(ev.with_year, 0) END share_t1,
         CASE WHEN ev.joined >= v_min THEN ev.t2::numeric / nullif(ev.with_year, 0) END share_t2,
         CASE WHEN ev.joined >= v_min THEN ev.priced::numeric / ev.n END c_outcome,
         CASE WHEN ev.joined >= v_min THEN ev.compl END c_complete,
         CASE WHEN ev.n >= v_min THEN 1 - ev.cross_listed::numeric / ev.n END c_unique,
         NULL::numeric c_private,
         -- New supply per day. vehicle_events.created_at is the landing clock, so a backfill looks like new supply (Mecum's
         -- walk, Bonhams' deep pass). A source whose events carry an end time (at least 20% of the sample) is counted by the
         -- lots that ENDED in the last 14 days; only a purely live classified source falls back to created_at.
         CASE WHEN ev.n < v_min THEN NULL
              WHEN ev.ended_n::numeric / ev.n >= 0.2 THEN ev.ended14 * ev.scale / 14.0
              WHEN s.supply_kind = 'live' THEN ev.recent14 * ev.scale / 14.0
              -- No end-time clock and not a purely live feed: the supply rate of a scoped census window (ids a day).
              WHEN sc.scoped_total IS NOT NULL AND sc.scoped_days > 0 THEN sc.scoped_total::numeric / sc.scoped_days END new_per_day,
         CASE WHEN ev.n < v_min THEN NULL
              WHEN ev.ended_n::numeric / ev.n >= 0.2 THEN 'ended_at, lots ended in the last 14 days'
              WHEN s.supply_kind = 'live' THEN 'created_at proxy (classified source, no end time)'
              WHEN sc.scoped_total IS NOT NULL AND sc.scoped_days > 0 THEN 'scoped census window rate (ids listed per day)' END supply_clock,
         lan.landed, lan.landed_at,
         pop.universe_total population, pop.census_method pop_method, pop.census_confidence pop_conf, pop.census_at pop_at,
         sc.gap_scoped, sc.scoped_at, sc.scoped_total, sc.scoped_days,
         s.slice_year_from, s.slice_year_to, s.overhead_credits_per_day, s.slice_since,
         ev.slice_n, ev.slice_n11,
         CASE WHEN ev.joined >= v_min AND ev.with_year > 0 THEN ev.slice_n::numeric / ev.with_year END slice_share
    FROM public.firecrawl_source_params s
    LEFT JOIN ev ON ev.source = s.source
    LEFT JOIN lan ON lan.source = s.source
    LEFT JOIN pop ON pop.slug = s.source
    LEFT JOIN sc ON sc.slug = s.source
    LEFT JOIN obs ON obs.source = s.source;

  -- value = weighted mean of the known components (tier counts double); gap in lots; cost in credits per lot.
  ALTER TABLE fc_src ADD COLUMN value numeric, ADD COLUMN gap_hist numeric, ADD COLUMN gap_live numeric,
                     ADD COLUMN gap numeric, ADD COLUMN cost numeric, ADD COLUMN score numeric, ADD COLUMN unknown text[],
                     ADD COLUMN alloc numeric DEFAULT 0, ADD COLUMN gap_basis text;
  -- value = the mean best_v1 of the source's landed lots (a sample), blended with the owner's own rating where he gave one
  -- (the lots count 2, the rating owner_judgment_weight).
  UPDATE fc_src s SET
    value = CASE WHEN s.owner_judgment IS NULL THEN s.mean_best
                 WHEN s.mean_best IS NULL THEN NULL
                 ELSE (2 * s.mean_best + firecrawl_param('owner_judgment_weight', 1) *
                       firecrawl_param('owner_rating_' || (s.owner_judgment ->> 'rating'), 0.5)) / (2 + firecrawl_param('owner_judgment_weight', 1)) END,
    gap_hist = CASE WHEN s.supply_kind IN ('historical', 'both') AND s.population IS NOT NULL AND s.landed IS NOT NULL
                    THEN greatest(s.population - s.landed, 0)
                    WHEN s.supply_kind IN ('historical', 'both') AND s.population IS NULL AND s.gap_scoped IS NOT NULL
                    THEN s.gap_scoped END,
    gap_basis = CASE WHEN s.supply_kind IN ('historical', 'both') AND s.population IS NULL AND s.gap_scoped IS NOT NULL THEN 'scoped_window' END,
    gap_live = CASE WHEN s.supply_kind IN ('live', 'both') AND s.new_per_day IS NOT NULL
                    THEN s.new_per_day * v_horizon * CASE WHEN s.slice_year_from IS NOT NULL THEN coalesce(s.slice_share, 0) ELSE 1 END END,
    cost = CASE WHEN s.firecrawl_dependent THEN s.credits_per_lot ELSE 0 END;
  UPDATE fc_src s SET
    gap = CASE WHEN s.supply_kind = 'historical' THEN s.gap_hist
               WHEN s.supply_kind = 'live' THEN s.gap_live
               ELSE CASE WHEN s.gap_hist IS NULL AND s.gap_live IS NULL THEN NULL ELSE coalesce(s.gap_hist, 0) + coalesce(s.gap_live, 0) END END,
    unknown = ARRAY_REMOVE(ARRAY[
      CASE WHEN s.c_tier IS NULL THEN 'tier_share' END, CASE WHEN s.c_outcome IS NULL THEN 'outcome_observable' END,
      CASE WHEN s.c_complete IS NULL THEN 'completeness' END, CASE WHEN s.c_unique IS NULL THEN 'uniqueness' END,
      'private_share_not_in_data_model',
      CASE WHEN s.supply_kind IN ('historical', 'both') AND s.population IS NULL THEN 'population' END,
      CASE WHEN s.supply_kind IN ('live', 'both') AND s.new_per_day IS NULL THEN 'new_supply_per_day' END], NULL);
  -- A sliced source also pays a daily overhead (an index page a day to see what is new): effective credits per lot = credits per
  -- lot + overhead over the horizon / the slice gap it buys.
  UPDATE fc_src s SET cost = s.cost + coalesce(s.overhead_credits_per_day, 0) * v_horizon / nullif(s.gap, 0)
   WHERE s.firecrawl_dependent AND s.gap > 0 AND coalesce(s.overhead_credits_per_day, 0) > 0;
  UPDATE fc_src s SET score = s.value * s.gap / greatest(s.cost, v_floor) WHERE s.value IS NOT NULL AND s.gap IS NOT NULL;

  -- 3. Observed return: best_v1 summed over the lots Firecrawl landed in the window, per credit spent (credits = Firecrawl
  --    fetches, successful or not, or the spend log if larger). Lots are scored first, from the group scores just stored.
  ALTER TABLE fc_src ADD COLUMN obs_credits numeric, ADD COLUMN obs_lots bigint, ADD COLUMN obs_sum numeric,
                     ADD COLUMN obs_per_credit numeric, ADD COLUMN prior_per_credit numeric, ADD COLUMN rank_key numeric,
                     ADD COLUMN would_allocate numeric DEFAULT 0, ADD COLUMN obs_refetch numeric, ADD COLUMN sim_alloc numeric DEFAULT 0;
  UPDATE fc_src s SET
    obs_credits = greatest(
      (SELECT count(*) FROM public.listing_page_snapshots n JOIN public.firecrawl_source_params sp ON n.platform = ANY (sp.snapshot_platforms)
        WHERE sp.source = s.source AND n.fetch_method = 'firecrawl' AND n.fetched_at >= greatest(v_now - v_window, coalesce(s.slice_since, '-infinity'))
          AND NOT EXISTS (SELECT 1 FROM public.listing_page_snapshots o WHERE o.listing_url = n.listing_url AND o.success AND o.fetched_at < n.fetched_at)),
      coalesce((SELECT sum(credits) FROM public.firecrawl_spend_log l WHERE l.source = s.source AND l.spent_at >= v_now - v_window), 0)),
    obs_refetch = (SELECT count(*) FROM public.listing_page_snapshots n JOIN public.firecrawl_source_params sp ON n.platform = ANY (sp.snapshot_platforms)
        WHERE sp.source = s.source AND n.fetch_method = 'firecrawl' AND n.fetched_at >= v_now - v_window
          AND EXISTS (SELECT 1 FROM public.listing_page_snapshots o WHERE o.listing_url = n.listing_url AND o.success AND o.fetched_at < n.fetched_at)),
    obs_lots = (SELECT count(*) FROM public.firecrawl_lot_score l WHERE l.source = s.source AND l.metric_version = v_ver AND l.fetch_class = 'landing' AND l.landed_at >= greatest(v_now - v_window, coalesce(s.slice_since, '-infinity'))),
    obs_sum = (SELECT sum(score) FROM public.firecrawl_lot_score l WHERE l.source = s.source AND l.metric_version = v_ver AND l.fetch_class = 'landing' AND l.landed_at >= greatest(v_now - v_window, coalesce(s.slice_since, '-infinity')));
  UPDATE fc_src s SET
    obs_per_credit = CASE WHEN s.obs_lots >= firecrawl_param('min_observed_lots', 30) AND s.obs_credits > 0 THEN s.obs_sum / s.obs_credits END,
    prior_per_credit = CASE WHEN s.cost > 0 THEN s.value / s.cost END;
  -- The owner's rating reaches the observed return too: the observed best_v1 per credit is scaled by value / mean_best
  -- (1 when the owner gave no rating), so a measured return cannot override a judgment the lots do not capture.
  ALTER TABLE fc_src ADD COLUMN obs_versions jsonb;
  UPDATE fc_src s SET obs_versions = (SELECT jsonb_object_agg(q.metric_version, jsonb_build_object('lots', q.n, 'best_sum', q.sm, 'best_mean', q.av,
                                        'best_per_credit', q.sm / nullif(s.obs_credits, 0)))
                                       FROM (SELECT metric_version, count(*) n, sum(score) sm, avg(score) av FROM public.firecrawl_lot_score l
                                              WHERE l.source = s.source AND l.fetch_class = 'landing' AND l.landed_at >= v_now - v_window GROUP BY 1) q);
  UPDATE fc_src s SET rank_key = coalesce(
    s.obs_per_credit * CASE WHEN s.owner_judgment IS NOT NULL AND s.mean_best > 0 THEN s.value / s.mean_best ELSE 1 END,
    s.prior_per_credit);

  -- 4. Allocation: Firecrawl-dependent sources by best_v1.1 per credit (the observed LANDING return once 30 landing-class lots
  --    are scored since the source's slice began, else the prior: mean best_v1.1 of its slice lots over its effective cost),
  --    each capped by its gap, its share and any trial cap. ONE floor applies to every source: a rank key below
  --    min_rank_leftover (0.5) gets no credits, so a low-return source can never be funded ahead of a better one. A paused
  --    source takes nothing; a second run that includes it records what it would receive (would_allocate).
  FOR k IN 1..2 LOOP
    v_remaining := v_alloc_budget;
    UPDATE fc_src SET sim_alloc = 0;
    FOR r IN SELECT * FROM fc_src WHERE firecrawl_dependent AND score > 0 AND rank_key >= v_minrank AND (k = 2 OR paused IS NULL)
             ORDER BY rank_key DESC, score DESC LOOP
      v_cap := least(r.gap * r.cost, firecrawl_param('max_source_share', 0.5) * v_alloc_budget, coalesce(r.credit_cap, 1e12));
      v_give := floor(least(v_cap, v_remaining));
      IF v_give > 0 THEN
        v_remaining := v_remaining - v_give;
        UPDATE fc_src SET sim_alloc = v_give WHERE source = r.source;
      END IF;
    END LOOP;
    IF k = 1 THEN
      UPDATE fc_src SET alloc = sim_alloc WHERE paused IS NULL;
    ELSE
      UPDATE fc_src SET would_allocate = sim_alloc WHERE paused IS NOT NULL;
    END IF;
  END LOOP;

  -- 5. Write: one '*' row per source (the scored inputs), group rows for allocated sources.
  INSERT INTO public.firecrawl_target_allocation (source, vehicle_group, monthly_credits, score, inputs, computed_at)
  SELECT s.source, '*', s.alloc, s.score,
         jsonb_build_object(
           'firecrawl_dependent', s.firecrawl_dependent, 'free_of_credits', NOT s.firecrawl_dependent,
           'metric_version', v_ver, 'value', s.value, 'mean_best_lot_score', s.mean_best, 'owner_judgment', s.owner_judgment, 'paused', s.paused,
           'would_allocate', s.would_allocate, 'rank_key_best_per_credit', s.rank_key, 'owner_factor', CASE WHEN s.owner_judgment IS NOT NULL AND s.mean_best > 0 THEN s.value / s.mean_best END, 'prior_best_per_credit', s.prior_per_credit,
           'credit_cap', s.credit_cap, 'cap_note', s.cap_note,
           'mean_best_v1', s.mean_best_v1, 'mean_best_v1_1', s.mean_best_v1_1, 'sample_n_v1_1', s.sample_n_v1_1, 'observed_by_version', s.obs_versions,
           'observed', jsonb_build_object('window_days', firecrawl_param('observed_window_days', 30), 'credits', s.obs_credits, 'lots_scored', s.obs_lots,
                                          'best_sum', s.obs_sum, 'best_per_credit', s.obs_per_credit),
           'gap_basis', s.gap_basis, 'slice', CASE WHEN s.slice_year_from IS NOT NULL THEN jsonb_build_object('years', jsonb_build_array(s.slice_year_from, s.slice_year_to), 'share_of_lots', s.slice_share, 'overhead_credits_per_day', s.overhead_credits_per_day, 'since', s.slice_since, 'sample_lots', s.slice_n) END, 'effective_cost_credits_per_lot', s.cost, 'gap_scoped', s.gap_scoped, 'refetch_credits_excluded', s.obs_refetch, 'min_rank_leftover', v_minrank,
           'gap_lots', s.gap, 'gap_historical', s.gap_hist, 'gap_live', s.gap_live,
           'cost_credits_per_lot', s.cost, 'cost_basis', s.cost_basis, 'supply_kind', s.supply_kind,
           'components', jsonb_build_object('tier', s.c_tier, 'tier1_share', s.share_t1, 'tier2_share', s.share_t2,
                                            'outcome_observable', s.c_outcome, 'completeness', s.c_complete,
                                            'uniqueness', s.c_unique, 'private_share', s.c_private),
           'sample', jsonb_build_object('events', s.sample_n, 'with_vehicle_year', s.joined_n, 'scale', s.sample_scale, 'read_at', s.sample_at),
           'landed_lots', s.landed, 'landed_at', s.landed_at,
           'population', s.population, 'population_method', s.pop_method, 'population_confidence', s.pop_conf, 'population_at', s.pop_at,
           'new_per_day', s.new_per_day, 'new_supply_clock', s.supply_clock, 'unknown_inputs', to_jsonb(s.unknown),
           'monthly_credits_param', v_budget, 'reserve_fraction', firecrawl_param('reserve_fraction', 0.15)),
         v_now
    FROM fc_src s;

  FOR r IN SELECT * FROM fc_src WHERE alloc > 0 LOOP
    SELECT sum(gscore) INTO v_group_sum FROM (SELECT gscore FROM fc_grp ORDER BY gscore DESC LIMIT v_top) t;
    IF coalesce(v_group_sum, 0) <= 0 THEN CONTINUE; END IF;
    INSERT INTO public.firecrawl_target_allocation (source, vehicle_group, monthly_credits, score, inputs, computed_at)
    SELECT r.source, g.family_key || ':' || g.band, floor(r.alloc * g.gscore / v_group_sum), r.score * g.gscore,
           jsonb_build_object('brand', g.brand, 'family', g.family, 'year_band', CASE g.band WHEN 1 THEN '1964-1973' WHEN 2 THEN '1974-1991' ELSE 'other' END,
                              'group_score', g.gscore, 'tier_weight', g.tier_weight, 'sales_per_year', g.n_liq, 'sales_in_dispersion_window', g.n_disp,
                              'liquidity_rank', g.liq_rank, 'dispersion', g.disp, 'information_rank', g.info_rank,
                              'own_weight', g.own_weight, 'own_verified', g.own_verified, 'own_recorded', g.own_recorded,
                              'source_score', r.score, 'source_alloc', r.alloc),
           v_now
      FROM (SELECT * FROM fc_grp ORDER BY gscore DESC LIMIT v_top) g;
  END LOOP;

  DELETE FROM public.firecrawl_target_allocation WHERE computed_at < v_now - interval '8 weeks';
  SELECT coalesce(sum(alloc), 0) INTO v_sum_alloc FROM fc_src;
  RETURN jsonb_build_object('computed_at', v_now, 'monthly_credits', v_budget, 'allocatable', v_alloc_budget,
                            'allocated', v_sum_alloc, 'held_by_paused', 0, 'metric_version', v_ver, 'sources', (SELECT count(*) FROM fc_src),
                            'scored', (SELECT count(*) FROM fc_src WHERE score IS NOT NULL), 'groups', (SELECT count(*) FROM fc_grp));
END $$;

REVOKE ALL ON FUNCTION public.firecrawl_io_gate() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.firecrawl_pipeline_step() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.firecrawl_sample_source(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.firecrawl_refresh_groups() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_firecrawl_target_allocation(jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.firecrawl_io_gate() TO service_role;
GRANT EXECUTE ON FUNCTION public.firecrawl_pipeline_step() TO service_role;
GRANT EXECUTE ON FUNCTION public.firecrawl_sample_source(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.firecrawl_refresh_groups() TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_firecrawl_target_allocation(jsonb, timestamptz) TO service_role;

-- The weekly job (582) becomes the 5-minute pipeline tick with a 60 s ceiling.
SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname = 'firecrawl-target-allocation-weekly'),
  schedule := '*/5 * * * *',
  command := $c$SET statement_timeout = '60s'; SELECT public.firecrawl_pipeline_step();$c$);
COMMIT;
