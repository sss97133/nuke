-- Firecrawl allocation, second pass (2026-10-15), after the first run on production data:
--   * New supply per day counted vehicle_events.created_at, the landing clock, so a backfill (the Mecum walk, the Bonhams
--     deep pass) looked like live supply and inflated the gap of every source that is both historical and live. A source
--     whose events carry an end time for at least 20% of the sample is now counted by the lots that ENDED in the last 14
--     days; only a purely live classified source (no end time) falls back to created_at, and the clock used is recorded in
--     the inputs (new_supply_clock).
--   * Allocation orders Firecrawl-dependent sources by value per credit; the score (value x gap / cost) still ranks the
--     size of the opportunity. With the score as the order, the source with the largest backlog took the budget however
--     little each lot was worth.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '10s';

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
                           year int, sale_price numeric, complete_share numeric, sample_scale numeric, ended_at timestamptz) ON COMMIT DROP;

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
             1, e.ended_at
        FROM vehicle_events e LEFT JOIN vehicles v ON v.id = e.vehicle_id AND v.deleted_at IS NULL
       WHERE e.source_platform = ANY (r.event_platforms);
    ELSE
      EXECUTE format($q$
        INSERT INTO fc_ev
        SELECT %L, e.vehicle_id, e.created_at,
               EXISTS (SELECT 1 FROM vehicle_events o WHERE o.vehicle_id = e.vehicle_id AND o.source_platform <> e.source_platform),
               v.year, v.sale_price,
               ((v.description IS NOT NULL)::int + (v.vin IS NOT NULL)::int + ((v.primary_image_url IS NOT NULL OR coalesce(v.image_count, 0) > 0))::int) / 3.0,
               %s, e.ended_at
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
           count(ended_at) ended_n,
           count(*) FILTER (WHERE ended_at >= v_now - interval '14 days' AND ended_at <= v_now) ended14,
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
         -- New supply per day. vehicle_events.created_at is the landing clock, so a backfill looks like new supply (Mecum's
         -- walk, Bonhams' deep pass). A source whose events carry an end time (at least 20% of the sample) is counted by the
         -- lots that ENDED in the last 14 days; only a purely live classified source falls back to created_at.
         CASE WHEN ev.n < v_min THEN NULL
              WHEN ev.ended_n::numeric / ev.n >= 0.2 THEN ev.ended14 * ev.scale / 14.0
              WHEN s.supply_kind = 'live' THEN ev.recent14 * ev.scale / 14.0 END new_per_day,
         CASE WHEN ev.n < v_min THEN NULL
              WHEN ev.ended_n::numeric / ev.n >= 0.2 THEN 'ended_at, lots ended in the last 14 days'
              WHEN s.supply_kind = 'live' THEN 'created_at proxy (classified source, no end time)' END supply_clock,
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

  -- 4. Allocation: Firecrawl-dependent sources by value per credit (the score ranks the size of the opportunity; a
  --    credit goes first where it buys the most value), each capped by its gap in credits and by its share.
  v_remaining := v_alloc_budget;
  FOR r IN SELECT * FROM fc_src WHERE firecrawl_dependent AND score > 0 ORDER BY value / cost DESC, score DESC LOOP
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
                            'allocated', v_sum_alloc, 'sources', (SELECT count(*) FROM fc_src),
                            'scored', (SELECT count(*) FROM fc_src WHERE score IS NOT NULL), 'groups', (SELECT count(*) FROM fc_grp));
END $$;


REVOKE ALL ON FUNCTION public.refresh_firecrawl_target_allocation(jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_firecrawl_target_allocation(jsonb, timestamptz) TO service_role;
COMMIT;
