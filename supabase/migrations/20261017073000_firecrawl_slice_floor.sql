-- Firecrawl allocation: one rank floor for every source, and a target slice for Cars & Bids (2026-10-15, owner-lead).
-- Found at 21:35Z: cars_and_bids scored 296 and received 0 while ksl scored 12 and received 38. Cause: the 0.5 rank floor
-- (min_rank_leftover) applied only to a source whose gap came from a scoped census window (Cars & Bids), not to the base stage, so
-- KSL (rank 0.313) was funded ahead of C&B (0.336 observed, below the floor). It was not a pause flag or a null gap. The rule is
-- fixed, not the rows: ONE floor now applies to every source, so a rank key below min_rank_leftover gets no credits.
--
-- Cars & Bids has no direct path (Cloudflare 403), so Firecrawl is its only way in, and what is worth buying is the tier slice:
-- model years 1964-1991 (slice_year_from/to). The source's prior value is the mean best_v1.1 of its slice lots; its live supply is
-- the supply rate of its scoped census window (11,279 ids over 365 days, because no end-time clock exists and its own intake
-- stopped at 17Z, which makes events a bad measure of supply) times the slice share of its landed lots; and it pays an index page a
-- day (overhead_credits_per_day = 1) to see what is new, spread over the slice gap it buys (effective cost). The observed
-- return counts only fetches made since the slice began (slice_since), so the old whole-source fetching does not judge the new practice.
-- KSL is paused: its rank key is below the floor (best_v1.1 mean about 0.25 to 0.3 on completeness 0.01 and outcome 0.01).
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '10s';

ALTER TABLE public.firecrawl_source_params
  ADD COLUMN IF NOT EXISTS slice_year_from int, ADD COLUMN IF NOT EXISTS slice_year_to int,
  ADD COLUMN IF NOT EXISTS overhead_credits_per_day numeric, ADD COLUMN IF NOT EXISTS slice_since timestamptz;
COMMENT ON COLUMN public.firecrawl_source_params.slice_year_from IS 'Target slice of model years the source is bought for (with slice_year_to): its prior value, live gap and share are measured on the slice only.';
COMMENT ON COLUMN public.firecrawl_source_params.overhead_credits_per_day IS 'Credits a day the source costs beyond its lots (for example an index page) to see what is new; spread over the slice gap as effective cost.';
COMMENT ON COLUMN public.firecrawl_source_params.slice_since IS 'The observed return counts only Firecrawl fetches and lots landed since this time: a change of practice starts a new record.';

UPDATE public.firecrawl_source_params SET slice_year_from = 1964, slice_year_to = 1991, overhead_credits_per_day = 1,
  slice_since = '2026-10-15 21:30:00+00',
  cost_basis = 'one scrape per lot page plus one index page a day (Cloudflare blocks direct reads); bought for model years 1964-1991 only (owner-lead 2026-10-15)'
 WHERE source = 'cars_and_bids';

UPDATE public.firecrawl_source_params SET paused = '{"since": "2026-10-15T21:45:00Z", "reason": "rank key below min_rank_leftover (0.5): best_v1.1 mean about 0.25 to 0.3 because completeness is 0.01 and outcome observable 0.01; released when the ranking puts KSL at 0.5 or more"}'::jsonb
 WHERE source = 'ksl';

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
  -- 1. Vehicle groups (family x year band), from priced sales: liquidity, dispersion, tier, the owner's own vehicles.
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

  SELECT max(gscore) INTO v_gmax FROM fc_grp;
  INSERT INTO public.firecrawl_group_score (family_key, band, brand, family, gscore, inputs, computed_at)
  SELECT family_key, band, brand, family, gscore,
         jsonb_build_object('tier_weight', tier_weight, 'sales_per_year', n_liq, 'sales_in_dispersion_window', n_disp, 'dispersion', disp,
                            'liquidity_rank', liq_rank, 'information_rank', info_rank, 'own_weight', own_weight,
                            'own_verified', own_verified, 'own_recorded', own_recorded), v_now
    FROM fc_grp;

  CREATE TEMP TABLE fc_ev (source text, vehicle_id uuid, created_at timestamptz, other_platform boolean,
                           year int, sale_price numeric, complete_share numeric, sample_scale numeric, ended_at timestamptz, best numeric, best11 numeric) ON COMMIT DROP;

  -- 2. Events per source: the whole source when small, a TABLESAMPLE slice when large. Cross-listing = the vehicle
  --    also has an event on another platform.
  FOR r IN SELECT * FROM public.firecrawl_source_params LOOP
    SELECT coalesce(sum(cnt), 0) INTO v_n_est FROM mv_events_by_platform WHERE source_platform = ANY (r.event_platforms);
    IF coalesce((p_landed ->> r.source)::numeric, 0) > v_n_est THEN v_n_est := (p_landed ->> r.source)::numeric; END IF;
    EXECUTE format($q$
      INSERT INTO fc_ev
      SELECT %L, e.vehicle_id, e.created_at,
             EXISTS (SELECT 1 FROM vehicle_events o WHERE o.vehicle_id = e.vehicle_id AND o.source_platform <> e.source_platform),
             v.year, v.sale_price,
             ((v.description IS NOT NULL)::int + (v.vin IS NOT NULL)::int + ((v.primary_image_url IS NOT NULL OR coalesce(v.image_count, 0) > 0))::int) / 3.0,
             %s, e.ended_at,
             (firecrawl_best_v1(v.year, v.description IS NOT NULL, v.vin IS NOT NULL, (v.primary_image_url IS NOT NULL OR coalesce(v.image_count, 0) > 0),
                coalesce(v.listing_location, v.location, v.city, v.state) IS NOT NULL, v.sale_price, v.canonical_outcome,
                EXISTS (SELECT 1 FROM vehicle_events o WHERE o.vehicle_id = e.vehicle_id AND o.source_platform <> e.source_platform),
                CASE WHEN fam.family_id IS NULL THEN NULL ELSE coalesce(g.gscore / nullif(%s::numeric, 0), 0) END) ->> 'score')::numeric,
             CASE WHEN (abs(hashtext(e.id::text)) %% 100 < %s OR v.year BETWEEN %s AND %s) THEN
               (firecrawl_best_v1_1(v.year, v.description IS NOT NULL, v.vin IS NOT NULL, (v.primary_image_url IS NOT NULL OR coalesce(v.image_count, 0) > 0),
                  coalesce(v.listing_location, v.location, v.city, v.state) IS NOT NULL, v.sale_price, v.canonical_outcome,
                  EXISTS (SELECT 1 FROM vehicle_events o WHERE o.vehicle_id = e.vehicle_id AND o.source_platform <> e.source_platform),
                  CASE WHEN fam.family_id IS NULL THEN NULL ELSE coalesce(g.gscore / nullif(%s::numeric, 0), 0) END,
                  firecrawl_quality_derive(v.description, v.year, v.vin,
                    EXISTS (SELECT 1 FROM vehicle_events o WHERE o.vehicle_id = e.vehicle_id AND o.source_platform = e.source_platform AND o.id <> e.id))) ->> 'score')::numeric END
        FROM vehicle_events e %s
        LEFT JOIN vehicles v ON v.id = e.vehicle_id AND v.deleted_at IS NULL
        LEFT JOIN LATERAL (SELECT n.family_id::text family_id FROM mv_model_family_names n
                            WHERE n.make_l = lower(v.make) AND n.model_l = lower(coalesce(v.model, '')) AND n.family_id IS NOT NULL
                              AND (v.year IS NULL OR n.year_start IS NULL OR v.year >= n.year_start - 1)
                              AND (v.year IS NULL OR n.year_end IS NULL OR v.year <= n.year_end + 1) LIMIT 1) fam ON true
        LEFT JOIN fc_grp g ON g.family_key = fam.family_id
             AND g.band = CASE WHEN v.year BETWEEN 1964 AND 1973 THEN 1 WHEN v.year BETWEEN 1974 AND 1991 THEN 2 ELSE 3 END
       WHERE e.source_platform = ANY (%L::text[])$q$,
      r.source,
      CASE WHEN v_n_est <= v_small THEN 1 ELSE 100.0 / v_pct END,
      coalesce(v_gmax, 0),
      CASE WHEN v_n_est <= v_small THEN 100 ELSE v_qpct END,
      coalesce(r.slice_year_from, 0),
      coalesce(r.slice_year_to, 0),
      coalesce(v_gmax, 0),
      CASE WHEN v_n_est <= v_small THEN '' ELSE format('TABLESAMPLE SYSTEM (%s)', v_pct) END,
      r.event_platforms);
  END LOOP;

  -- 2. Source inputs, each dated; NULL = unknown.
  CREATE TEMP TABLE fc_src ON COMMIT DROP AS
  WITH ev AS (
    SELECT fc_ev.source, count(*) n, sum(sample_scale) scaled,
           count(*) FILTER (WHERE year BETWEEN 1964 AND 1973) t1,
           count(*) FILTER (WHERE year BETWEEN 1974 AND 1991) t2,
           count(*) FILTER (WHERE year IS NOT NULL) with_year,
           count(*) FILTER (WHERE sale_price > 0) priced,
           count(*) FILTER (WHERE vehicle_id IS NOT NULL AND year IS NOT NULL) joined,
           avg(complete_share) compl,
           avg(best) FILTER (WHERE vehicle_id IS NOT NULL AND year IS NOT NULL) mean_best,
           avg(best11) FILTER (WHERE vehicle_id IS NOT NULL AND year IS NOT NULL) mean_best11,
           count(best11) FILTER (WHERE vehicle_id IS NOT NULL AND year IS NOT NULL) joined11,
           count(*) FILTER (WHERE other_platform) cross_listed,
           count(*) FILTER (WHERE created_at >= v_now - interval '14 days') recent14,
           count(ended_at) ended_n,
           count(*) FILTER (WHERE ended_at >= v_now - interval '14 days' AND ended_at <= v_now) ended14,
           max(sample_scale) scale,
           count(*) FILTER (WHERE year BETWEEN sp.slice_year_from AND sp.slice_year_to) slice_n,
           avg(best11) FILTER (WHERE year BETWEEN sp.slice_year_from AND sp.slice_year_to) slice_mean11,
           count(best11) FILTER (WHERE year BETWEEN sp.slice_year_from AND sp.slice_year_to) slice_n11
      FROM fc_ev JOIN public.firecrawl_source_params sp ON sp.source = fc_ev.source
     GROUP BY fc_ev.source, sp.slice_year_from, sp.slice_year_to
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
  PERFORM public.firecrawl_score_lots(v_now - v_window);
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
           'sample', jsonb_build_object('events', s.sample_n, 'with_vehicle_year', s.joined_n, 'scale', s.sample_scale, 'read_at', v_now),
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

REVOKE ALL ON FUNCTION public.refresh_firecrawl_target_allocation(jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_firecrawl_target_allocation(jsonb, timestamptz) TO service_role;
COMMIT;
