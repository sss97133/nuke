-- Firecrawl targeting: a ranking of sources and vehicle groups computed from the data, a monthly credit allocation, and
-- a per-source daily allowance every Firecrawl spender calls before spending (2026-10-15, owner directive: Firecrawl
-- stays at USD 100 a month at most, spent only on the best targets). Spec: docs/ledger/theory/extraction.md, section
-- "Spending Firecrawl". Nothing here is hand-set except the parameters in firecrawl_params and firecrawl_source_params,
-- and every parameter row says what it is and when it was set.
--
--   firecrawl_params            budget size and scoring weights (monthly_credits 1000 now; 100000 on the USD 99 plan)
--   firecrawl_source_params     per source: does it consume Firecrawl credits, credits per full lot, supply kind,
--                               the vehicles.source / vehicle_events.source_platform names it goes by
--   firecrawl_spend_log         what spenders actually spent (credits, lots landed), via firecrawl_record_spend()
--   firecrawl_target_allocation (source, vehicle_group, monthly_credits, score, inputs jsonb, computed_at)
--   refresh_firecrawl_target_allocation(p_landed jsonb, p_landed_at timestamptz)   weekly job, cron below
--   firecrawl_allowance(source)  credits left today for that source
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS public.firecrawl_params (
  key text PRIMARY KEY,
  value numeric,
  text_value text,
  note text NOT NULL,
  set_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.firecrawl_source_params (
  source text PRIMARY KEY,                 -- the source_census / observation_sources slug
  firecrawl_dependent boolean NOT NULL,    -- true = fetching a lot consumes Firecrawl credits
  credits_per_lot numeric,                 -- full lot, all pages; NULL when not dependent
  cost_basis text NOT NULL,
  supply_kind text NOT NULL CHECK (supply_kind IN ('historical', 'live', 'both')),
  vehicles_source text[] NOT NULL DEFAULT '{}',   -- values of vehicles.source
  event_platforms text[] NOT NULL,                -- values of vehicle_events.source_platform
  observed_on date NOT NULL
);

CREATE TABLE IF NOT EXISTS public.firecrawl_spend_log (
  id bigserial PRIMARY KEY,
  source text NOT NULL,
  credits numeric NOT NULL CHECK (credits >= 0),
  lots integer NOT NULL DEFAULT 0 CHECK (lots >= 0),   -- full lots landed by this spend
  lane text,
  note text,
  spent_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS firecrawl_spend_log_source_time ON public.firecrawl_spend_log (source, spent_at DESC);

CREATE TABLE IF NOT EXISTS public.firecrawl_target_allocation (
  source text NOT NULL,
  vehicle_group text NOT NULL,             -- '*' = the source total; otherwise 'family_key:band'
  monthly_credits numeric NOT NULL,
  score numeric,
  inputs jsonb NOT NULL,
  computed_at timestamptz NOT NULL,
  PRIMARY KEY (source, vehicle_group, computed_at)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['firecrawl_params', 'firecrawl_source_params', 'firecrawl_spend_log', 'firecrawl_target_allocation'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;
REVOKE ALL ON SEQUENCE public.firecrawl_spend_log_id_seq FROM anon, authenticated;

COMMENT ON TABLE public.firecrawl_params IS 'Firecrawl budget and scoring parameters (monthly_credits, reserve_fraction, tier weights ...). Each row says what it is and when it was set. Change monthly_credits when the plan changes (1000 now, 100000 on the USD 99 Standard plan).';
COMMENT ON TABLE public.firecrawl_source_params IS 'Per source: whether a lot costs Firecrawl credits, credits per full lot and why, supply kind, and the names the source goes by in vehicles.source and vehicle_events.source_platform. Read by refresh_firecrawl_target_allocation.';
COMMENT ON TABLE public.firecrawl_spend_log IS 'Credits spent per Firecrawl source and the full lots they landed, written by firecrawl_record_spend(). Read by firecrawl_allowance() and by the weekly job (observed credits per lot).';
COMMENT ON TABLE public.firecrawl_target_allocation IS 'Weekly ranking of Firecrawl targets: one row per source (vehicle_group = ''*'', the source total and its scored inputs) and one per vehicle group within an allocated source. monthly_credits is the allocation for one billing period; computed_at versions the rows. Spenders read it through firecrawl_allowance().';

INSERT INTO public.firecrawl_params (key, value, text_value, note) VALUES
 ('monthly_credits',       1000,  NULL, 'Credits per billing period: 1000 on the current plan; 100000 if the USD 99 Standard plan is taken. Set 2026-10-15.'),
 ('reserve_fraction',      0.15,  NULL, 'Share of the monthly credits held back for retries and failures (the lead releases it). Set 2026-10-15.'),
 ('period_start_day',      4,     NULL, 'Day of the month the Firecrawl billing period starts (next reset 2026-11-04). Set 2026-10-15.'),
 ('max_source_share',      0.5,   NULL, 'No source gets more than this share of the allocatable credits. Set 2026-10-15.'),
 ('tier1_weight',          1.0,   NULL, 'Owner tiers (2026-10-15): vehicles of model years 1964-1973 weigh most.'),
 ('tier2_weight',          0.6,   NULL, 'Model years 1974-1991.'),
 ('tier3_weight',          0.2,   NULL, 'All other model years.'),
 ('own_verified_weight',   1.0,   NULL, 'A vehicle the owner holds as verified_owner/current in vehicle_ownerships, or owner/co_owner in vehicle_user_permissions, counts this much toward its group.'),
 ('own_recorded_weight',   0.1,   NULL, 'A vehicle recorded under the owner account (vehicles.owner_id or user_id) without a verified ownership counts this much: ownership there is unclear (skylar-context.md).'),
 ('liquidity_months',      12,    NULL, 'Window for sales per year of a vehicle group.'),
 ('dispersion_months',     36,    NULL, 'Window for price dispersion of a vehicle group.'),
 ('min_group_sales',       8,     NULL, 'A vehicle group needs this many priced sales in the dispersion window to be scored.'),
 ('top_groups_per_source', 20,    NULL, 'Vehicle groups an allocated source splits its credits across.'),
 ('sample_events_small',   4000,  NULL, 'A source with at most this many events in the last count is read in full; larger sources are sampled.'),
 ('sample_pct_large',      4,     NULL, 'TABLESAMPLE SYSTEM percent of vehicle_events for a large source.'),
 ('min_sample',            30,    NULL, 'Fewer sampled events than this and the sample-derived inputs of a source are unknown (NULL), not guessed.'),
 ('live_horizon_days',     30,    NULL, 'A live source''s gap is its new supply per day times this many days.'),
 ('free_cost_floor',       0.01,  NULL, 'A source with no Firecrawl cost is scored as if a lot cost this many credits, so it ranks finite and first; it gets no credits.'),
 ('observed_cost_min_lots',50,    NULL, 'Spend-log lots needed before observed credits per lot replaces the parameter.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.firecrawl_params (key, value, text_value, note) VALUES
 ('owner_user_id', NULL, NULL, 'The owner''s auth user id, for the own-vehicles input. Set by hand after deploy; unset = the input is unknown, not zero.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.firecrawl_source_params
  (source, firecrawl_dependent, credits_per_lot, cost_basis, supply_kind, vehicles_source, event_platforms, observed_on) VALUES
 ('bat',            false, NULL, 'fetched directly or re-read from the local archive and retained captures', 'both',       '{bat,bringatrailer}', '{bat}', '2026-10-15'),
 ('mecum',          false, NULL, 'Algolia and sitemap reads, no Firecrawl', 'both',       '{mecum}', '{mecum}', '2026-10-15'),
 ('barrett-jackson',false, NULL, 'sitemap and direct reads', 'historical', '{barrett-jackson}', '{barrettjackson}', '2026-10-15'),
 ('gooding',        false, NULL, 'sitemap and direct reads', 'both',       '{gooding}', '{gooding}', '2026-10-15'),
 ('pcarmarket',     false, NULL, 'server-rendered pages landed free (import-pcarmarket-listing)', 'both', '{pcarmarket}', '{pcarmarket}', '2026-10-15'),
 ('broad-arrow',    false, NULL, 'sitemap and direct reads', 'historical', '{broad_arrow}', '{broad_arrow}', '2026-10-15'),
 ('rm-sothebys',    false, NULL, 'direct reads; whether pages need Firecrawl is unverified', 'historical', '{rm-sothebys}', '{rm-sothebys,rmsothebys}', '2026-10-15'),
 ('barnfinds',      false, NULL, 'WordPress sitemap and direct reads', 'both', '{barnfinds}', '{barnfinds}', '2026-10-15'),
 ('craigslist',     false, NULL, 'direct reads', 'live', '{craigslist}', '{craigslist}', '2026-10-15'),
 ('facebook_marketplace', false, NULL, 'the owner''s own browser capture, no Firecrawl', 'live', '{facebook_marketplace}', '{facebook_marketplace}', '2026-10-15'),
 ('bonhams',        true,  1, 'one scrape per lot page; full depth is about 34,101 credits for 34,101 lots (FIRECRAWL-BUDGET.md 2026-10-15)', 'both', '{bonhams}', '{bonhams}', '2026-10-15'),
 ('collecting-cars',true,  1, 'one scrape per lot page (FIRECRAWL-BUDGET.md 2026-10-15)', 'both', '{collecting_cars}', '{collecting_cars}', '2026-10-15'),
 ('cars_and_bids',  true,  1, 'one scrape per lot page (Cloudflare blocks direct reads)', 'both', '{cars_and_bids}', '{cars_and_bids}', '2026-10-15'),
 ('ksl',            true,  1, 'one scrape per listing (FIRECRAWL-BUDGET.md 2026-10-15)', 'live', '{ksl}', '{ksl}', '2026-10-15'),
 ('ebay_motors',    true,  1, 'one scrape per listing; tier backfills of 588 and 533 lots inside 2,500 credits include discovery pages', 'live', '{ebay}', '{ebay_motors}', '2026-10-15'),
 ('hemmings',       true,  1, 'one scrape per listing; lots sit behind Cloudflare, parked 2026-10-15', 'live', '{hemmings}', '{hemmings}', '2026-10-15')
ON CONFLICT (source) DO NOTHING;

-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.firecrawl_param(p_key text, p_default numeric DEFAULT NULL)
RETURNS numeric LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp' AS $$
  SELECT coalesce((SELECT value FROM public.firecrawl_params WHERE key = p_key), p_default)
$$;

CREATE OR REPLACE FUNCTION public.firecrawl_record_spend(p_source text, p_credits numeric, p_lots integer DEFAULT 0,
                                                         p_lane text DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
  INSERT INTO public.firecrawl_spend_log (source, credits, lots, lane, note)
  VALUES (p_source, p_credits, coalesce(p_lots, 0), p_lane, p_note) RETURNING id
$$;

-- Credits left today for one source: the source's allocation for the current billing period, less what the period has
-- spent, spread over the days left (so unspent days roll forward), less today's spend. 0 when the source has no
-- allocation. A spender calls this before every batch and stops at the number it returns.
CREATE OR REPLACE FUNCTION public.firecrawl_allowance(p_source text)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_day int := firecrawl_param('period_start_day', 4)::int;
  v_start date;
  v_end date;
  v_alloc numeric;
  v_spent_before numeric;
  v_spent_today numeric;
  v_days_left int;
BEGIN
  v_start := CASE WHEN extract(day FROM current_date) >= v_day
                  THEN make_date(extract(year FROM current_date)::int, extract(month FROM current_date)::int, v_day)
                  ELSE (make_date(extract(year FROM current_date)::int, extract(month FROM current_date)::int, v_day) - interval '1 month')::date END;
  v_end := (v_start + interval '1 month')::date;
  SELECT a.monthly_credits INTO v_alloc
    FROM public.firecrawl_target_allocation a
   WHERE a.source = p_source AND a.vehicle_group = '*'
     AND a.computed_at = (SELECT max(computed_at) FROM public.firecrawl_target_allocation)
   LIMIT 1;
  IF v_alloc IS NULL OR v_alloc <= 0 THEN RETURN 0; END IF;
  SELECT coalesce(sum(credits) FILTER (WHERE spent_at < current_date), 0),
         coalesce(sum(credits) FILTER (WHERE spent_at >= current_date), 0)
    INTO v_spent_before, v_spent_today
    FROM public.firecrawl_spend_log WHERE source = p_source AND spent_at >= v_start;
  v_days_left := greatest(1, v_end - current_date);
  RETURN greatest(0, least(v_alloc - v_spent_before - v_spent_today,
                           ceil((v_alloc - v_spent_before) / v_days_left) - v_spent_today));
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- The weekly job. Reads bounded samples (a source with few events is read in full, a large one by TABLESAMPLE) and the
-- small matviews; writes only the four firecrawl_* tables. p_landed (source -> landed lots) and p_landed_at override the
-- landed counts from mv_source_target_landed when that matview is stale or paused.
CREATE OR REPLACE FUNCTION public.refresh_firecrawl_target_allocation(p_landed jsonb DEFAULT NULL, p_landed_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  r record;
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
BEGIN
  CREATE TEMP TABLE fc_ev (source text, vehicle_id uuid, created_at timestamptz, other_platform boolean,
                           year int, sale_price numeric, complete_share numeric, sample_scale numeric) ON COMMIT DROP;

  -- 1. Events per source: the whole source when small, a TABLESAMPLE slice when large. Cross-listing = the vehicle
  --    also has an event on another platform.
  FOR r IN SELECT * FROM public.firecrawl_source_params LOOP
    SELECT coalesce(sum(cnt), 0) INTO v_n_est FROM mv_events_by_platform WHERE source_platform = ANY (r.event_platforms);
    IF coalesce((p_landed ->> r.source)::numeric, 0) > v_n_est THEN v_n_est := (p_landed ->> r.source)::numeric; END IF;
    IF v_n_est <= v_small THEN
      INSERT INTO fc_ev
      SELECT r.source, e.vehicle_id, e.created_at,
             EXISTS (SELECT 1 FROM vehicle_events o WHERE o.vehicle_id = e.vehicle_id AND o.source_platform <> e.source_platform),
             v.year, v.sale_price,
             ((v.description IS NOT NULL)::int + (v.vin IS NOT NULL)::int + ((v.primary_image_url IS NOT NULL OR coalesce(v.image_count, 0) > 0))::int) / 3.0,
             1
        FROM vehicle_events e LEFT JOIN vehicles v ON v.id = e.vehicle_id AND v.deleted_at IS NULL
       WHERE e.source_platform = ANY (r.event_platforms);
    ELSE
      EXECUTE format($q$
        INSERT INTO fc_ev
        SELECT %L, e.vehicle_id, e.created_at,
               EXISTS (SELECT 1 FROM vehicle_events o WHERE o.vehicle_id = e.vehicle_id AND o.source_platform <> e.source_platform),
               v.year, v.sale_price,
               ((v.description IS NOT NULL)::int + (v.vin IS NOT NULL)::int + ((v.primary_image_url IS NOT NULL OR coalesce(v.image_count, 0) > 0))::int) / 3.0,
               %s
          FROM vehicle_events e TABLESAMPLE SYSTEM (%s) LEFT JOIN vehicles v ON v.id = e.vehicle_id AND v.deleted_at IS NULL
         WHERE e.source_platform = ANY (%L::text[])$q$, r.source, 100.0 / v_pct, v_pct, r.event_platforms);
    END IF;
  END LOOP;

  -- 2. Source inputs, each dated; NULL = unknown.
  CREATE TEMP TABLE fc_src ON COMMIT DROP AS
  WITH ev AS (
    SELECT source, count(*) n, sum(sample_scale) scaled,
           count(*) FILTER (WHERE year BETWEEN 1964 AND 1973) t1,
           count(*) FILTER (WHERE year BETWEEN 1974 AND 1991) t2,
           count(*) FILTER (WHERE year IS NOT NULL) with_year,
           count(*) FILTER (WHERE sale_price > 0) priced,
           count(*) FILTER (WHERE vehicle_id IS NOT NULL AND year IS NOT NULL) joined,
           avg(complete_share) compl,
           count(*) FILTER (WHERE other_platform) cross_listed,
           count(*) FILTER (WHERE created_at >= v_now - interval '14 days') recent14,
           max(sample_scale) scale
      FROM fc_ev GROUP BY source
  ), pop AS (
    SELECT DISTINCT ON (o.slug) o.slug, c.universe_total, c.census_method, c.census_confidence, c.census_at
      FROM public.source_census c JOIN public.observation_sources o ON o.id = c.source_id
     WHERE c.universe_total IS NULL OR c.universe_historical IS NOT NULL
     ORDER BY o.slug, c.census_at DESC
  ), lan AS (
    SELECT s.source,
           coalesce((p_landed ->> s.source)::numeric,
                    (SELECT m.landed_lots FROM mv_source_target_landed m
                      WHERE regexp_replace(lower(m.source_slug), '[-_ ]', '', 'g') = regexp_replace(lower(s.source), '[-_ ]', '', 'g') LIMIT 1)) landed,
           CASE WHEN p_landed ? s.source THEN p_landed_at
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
         ev.n sample_n, ev.joined joined_n, ev.scale sample_scale,
         CASE WHEN ev.joined >= v_min THEN (ev.t1 * v_w1 + ev.t2 * v_w2 + (ev.with_year - ev.t1 - ev.t2) * v_w3) / nullif(ev.with_year, 0) / v_w1 END c_tier,
         CASE WHEN ev.joined >= v_min THEN ev.t1::numeric / nullif(ev.with_year, 0) END share_t1,
         CASE WHEN ev.joined >= v_min THEN ev.t2::numeric / nullif(ev.with_year, 0) END share_t2,
         CASE WHEN ev.joined >= v_min THEN ev.priced::numeric / ev.n END c_outcome,
         CASE WHEN ev.joined >= v_min THEN ev.compl END c_complete,
         CASE WHEN ev.n >= v_min THEN 1 - ev.cross_listed::numeric / ev.n END c_unique,
         NULL::numeric c_private,
         CASE WHEN ev.n >= v_min THEN ev.recent14 * ev.scale / 14.0 END new_per_day,
         lan.landed, lan.landed_at,
         pop.universe_total population, pop.census_method pop_method, pop.census_confidence pop_conf, pop.census_at pop_at
    FROM public.firecrawl_source_params s
    LEFT JOIN ev ON ev.source = s.source
    LEFT JOIN lan ON lan.source = s.source
    LEFT JOIN pop ON pop.slug = s.source
    LEFT JOIN obs ON obs.source = s.source;

  -- value = weighted mean of the known components (tier counts double); gap in lots; cost in credits per lot.
  ALTER TABLE fc_src ADD COLUMN value numeric, ADD COLUMN gap_hist numeric, ADD COLUMN gap_live numeric,
                     ADD COLUMN gap numeric, ADD COLUMN cost numeric, ADD COLUMN score numeric, ADD COLUMN unknown text[],
                     ADD COLUMN alloc numeric DEFAULT 0;
  UPDATE fc_src s SET
    value = (SELECT sum(w * c) / nullif(sum(w), 0) FROM (VALUES (2, s.c_tier), (1, s.c_outcome), (1, s.c_complete), (1, s.c_unique), (1, s.c_private)) AS t(w, c) WHERE c IS NOT NULL),
    gap_hist = CASE WHEN s.supply_kind IN ('historical', 'both') AND s.population IS NOT NULL AND s.landed IS NOT NULL
                    THEN greatest(s.population - s.landed, 0) END,
    gap_live = CASE WHEN s.supply_kind IN ('live', 'both') AND s.new_per_day IS NOT NULL THEN s.new_per_day * v_horizon END,
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
  UPDATE fc_src s SET score = s.value * s.gap / greatest(s.cost, v_floor) WHERE s.value IS NOT NULL AND s.gap IS NOT NULL;

  -- 3. Vehicle groups (family x year band), from priced sales: liquidity, dispersion, tier, the owner's own vehicles.
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

  -- 4. Allocation: Firecrawl-dependent sources by score, each capped by its gap in credits and by its share.
  v_remaining := v_alloc_budget;
  FOR r IN SELECT * FROM fc_src WHERE firecrawl_dependent AND score > 0 ORDER BY score DESC LOOP
    v_cap := least(r.gap * r.cost, firecrawl_param('max_source_share', 0.5) * v_alloc_budget);
    v_give := floor(least(v_cap, v_remaining));
    IF v_give > 0 THEN
      UPDATE fc_src SET alloc = v_give WHERE source = r.source;
      v_remaining := v_remaining - v_give;
    END IF;
  END LOOP;

  -- 5. Write: one '*' row per source (the scored inputs), group rows for allocated sources.
  INSERT INTO public.firecrawl_target_allocation (source, vehicle_group, monthly_credits, score, inputs, computed_at)
  SELECT s.source, '*', s.alloc, s.score,
         jsonb_build_object(
           'firecrawl_dependent', s.firecrawl_dependent, 'free_of_credits', NOT s.firecrawl_dependent,
           'value', s.value, 'gap_lots', s.gap, 'gap_historical', s.gap_hist, 'gap_live', s.gap_live,
           'cost_credits_per_lot', s.cost, 'cost_basis', s.cost_basis, 'supply_kind', s.supply_kind,
           'components', jsonb_build_object('tier', s.c_tier, 'tier1_share', s.share_t1, 'tier2_share', s.share_t2,
                                            'outcome_observable', s.c_outcome, 'completeness', s.c_complete,
                                            'uniqueness', s.c_unique, 'private_share', s.c_private),
           'sample', jsonb_build_object('events', s.sample_n, 'with_vehicle_year', s.joined_n, 'scale', s.sample_scale, 'read_at', v_now),
           'landed_lots', s.landed, 'landed_at', s.landed_at,
           'population', s.population, 'population_method', s.pop_method, 'population_confidence', s.pop_conf, 'population_at', s.pop_at,
           'new_per_day', s.new_per_day, 'unknown_inputs', to_jsonb(s.unknown),
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
                            'allocated', v_sum_alloc, 'sources', (SELECT count(*) FROM fc_src),
                            'scored', (SELECT count(*) FROM fc_src WHERE score IS NOT NULL), 'groups', (SELECT count(*) FROM fc_grp));
END $$;

REVOKE ALL ON FUNCTION public.firecrawl_param(text, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.firecrawl_record_spend(text, numeric, integer, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.firecrawl_allowance(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_firecrawl_target_allocation(jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.firecrawl_param(text, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.firecrawl_record_spend(text, numeric, integer, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.firecrawl_allowance(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_firecrawl_target_allocation(jsonb, timestamptz) TO service_role;

COMMENT ON FUNCTION public.firecrawl_allowance(text) IS 'Credits a Firecrawl spender may use today for one source: its allocation for the current billing period (firecrawl_target_allocation, latest computed_at) less the period''s spend (firecrawl_spend_log), spread over the days left, less today''s spend. 0 when the source has no allocation. Call before every batch; record the spend with firecrawl_record_spend().';
COMMENT ON FUNCTION public.refresh_firecrawl_target_allocation(jsonb, timestamptz) IS 'Weekly: scores sources (value x gap / cost, every input dated) and vehicle groups (tier x liquidity x dispersion x own vehicles) from bounded samples and small matviews, allocates firecrawl_params.monthly_credits, writes firecrawl_target_allocation. Optional p_landed overrides landed lots per source when mv_source_target_landed is stale.';

SELECT cron.schedule('firecrawl-target-allocation-weekly', '17 5 * * 1',
  $c$SET statement_timeout = '300s'; SELECT public.refresh_firecrawl_target_allocation();$c$);

COMMIT;
