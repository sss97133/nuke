-- Firecrawl targeting, third pass (2026-10-15): "best" becomes a metric developed from data, not a one-off table.
-- Owner, 17:1xZ: "best is a metric we have yet to fully develop"; Firecrawl credits only where they buy the most, no waste.
--
--   best_v1  a score per LANDED LOT in 0..1: tier fit, completeness, outcome observability, uniqueness, group value.
--            Definition and weights below and in docs/ledger/theory/extraction.md ("Spending Firecrawl", best_v1).
--   The source's value is the mean best_v1 of its landed lots (a sample), blended with the owner's own judgment where he
--   gave one. The source's OBSERVED return is best_v1 summed over the lots Firecrawl actually landed, per credit spent
--   (credits = Firecrawl fetches in listing_page_snapshots, so failed and wasted fetches cost and add nothing).
--   Allocation follows best_v1 per credit by source and vehicle group. Weekly: recompute, and as realized outcomes arrive
--   publish best_v2 beside best_v1 with the diff (v2 itself is not built here; the table keys on metric_version).
--
--   best_v1 = ( 2*tier + complete + outcome + unique + group ) / 6, an unknown component counts 0 (no evidence of value
--   is not value), and the components are stored with the score.
--     tier     model year 1964-1973 = 1, 1974-1991 = tier2_weight/tier1_weight, other = tier3_weight/tier1_weight
--     complete (description + VIN + a photo + a location) / 4
--     outcome  a realized price = 1; the outcome known without a price (reserve not met, no sale, ended) = 0.5; an ask = 0
--     unique   1 when no other platform holds an event for the same vehicle, else 0
--     group    the lot's model family x year band score / the best group score (illiquid or unmatched families = 0)
--   Not in v1 because the data model has no field for it: non-dealer seller (listed as unknown_inputs on every source).
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '10s';

ALTER TABLE public.firecrawl_source_params
  ADD COLUMN IF NOT EXISTS snapshot_platforms text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS owner_judgment jsonb,
  ADD COLUMN IF NOT EXISTS paused jsonb;
COMMENT ON COLUMN public.firecrawl_source_params.snapshot_platforms IS 'listing_page_snapshots.platform values whose fetch_method = firecrawl count as this source''s credits.';
COMMENT ON COLUMN public.firecrawl_source_params.owner_judgment IS 'The owner''s own rating of the source: {rating low|medium|high, quote, said_at}. Blended into the source value with weight owner_judgment_weight.';
COMMENT ON COLUMN public.firecrawl_source_params.paused IS 'Spend paused: {since, reason}. The source is still ranked and shows would_allocate in its inputs, but gets 0 credits and firecrawl_allowance returns 0.';

UPDATE public.firecrawl_source_params SET snapshot_platforms = CASE source
  WHEN 'ebay_motors' THEN '{ebay_motors}' WHEN 'cars_and_bids' THEN '{carsandbids}' WHEN 'bonhams' THEN '{bonhams}'
  WHEN 'collecting-cars' THEN '{collectingcars}' WHEN 'ksl' THEN '{ksl}' WHEN 'hemmings' THEN '{hemmings}' ELSE snapshot_platforms END;
UPDATE public.firecrawl_source_params SET
  owner_judgment = '{"rating": "low", "quote": "ebay is low quality", "said_at": "2026-10-15T17:00:00Z", "said_by": "owner"}'::jsonb,
  paused = '{"since": "2026-10-15T17:30:00Z", "reason": "jobs 563, 564, 580 paused; resumes only if the ranking puts eBay above the cut"}'::jsonb
 WHERE source = 'ebay_motors';

INSERT INTO public.firecrawl_params (key, value, text_value, note) VALUES
 ('metric_version',        NULL, 'best_v1', 'The lot-value metric in force. A new version is published beside the old one, with its diff.'),
 ('best_w_tier',           2,    NULL, 'best_v1 weight of tier fit.'),
 ('best_w_complete',       1,    NULL, 'best_v1 weight of completeness.'),
 ('best_w_outcome',        1,    NULL, 'best_v1 weight of outcome observability.'),
 ('best_w_unique',         1,    NULL, 'best_v1 weight of uniqueness.'),
 ('best_w_group',          1,    NULL, 'best_v1 weight of vehicle-group value.'),
 ('owner_rating_low',      0.2,  NULL, 'Value the owner''s rating "low" stands for when blended into a source value.'),
 ('owner_rating_medium',   0.5,  NULL, 'Value of the owner''s rating "medium".'),
 ('owner_rating_high',     0.8,  NULL, 'Value of the owner''s rating "high".'),
 ('owner_judgment_weight', 1,    NULL, 'Weight of the owner''s rating against 2 for the measured mean best_v1 of the source''s lots.'),
 ('observed_window_days',  30,   NULL, 'Window of Firecrawl fetches and scored lots that count as the observed return.'),
 ('min_observed_lots',     30,   NULL, 'Scored Firecrawl-landed lots needed before a source is ranked on its observed best_v1 per credit instead of its prior.')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.firecrawl_group_score (
  family_key text NOT NULL,
  band int NOT NULL,                   -- 1 = 1964-1973, 2 = 1974-1991, 3 = other
  brand text, family text,
  gscore numeric NOT NULL,
  inputs jsonb NOT NULL,
  computed_at timestamptz NOT NULL,
  PRIMARY KEY (family_key, band, computed_at)
);
CREATE TABLE IF NOT EXISTS public.firecrawl_lot_score (
  event_id uuid NOT NULL,
  metric_version text NOT NULL,
  vehicle_id uuid,
  source text NOT NULL,
  landed_at timestamptz NOT NULL,      -- when Firecrawl fetched the page
  score numeric NOT NULL,
  components jsonb NOT NULL,
  scored_at timestamptz NOT NULL,
  PRIMARY KEY (event_id, metric_version)
);
CREATE INDEX IF NOT EXISTS firecrawl_lot_score_source_landed ON public.firecrawl_lot_score (source, landed_at DESC);
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['firecrawl_group_score', 'firecrawl_lot_score'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;
COMMENT ON TABLE public.firecrawl_group_score IS 'Vehicle-group scores (model family x year band) behind best_v1 and the allocation, versioned by computed_at. Written by refresh_firecrawl_target_allocation.';
COMMENT ON TABLE public.firecrawl_lot_score IS 'best_v1 (or a later metric_version) per lot that a Firecrawl fetch landed, with its components. Summed per source over the credits spent it gives the observed return.';

-- best_v1 of one lot. Unknown components (NULL) count 0 in the score and are listed.
CREATE OR REPLACE FUNCTION public.firecrawl_best_v1(
  p_year int, p_has_desc boolean, p_has_vin boolean, p_has_img boolean, p_has_loc boolean,
  p_sale_price numeric, p_outcome text, p_cross boolean, p_group_norm numeric)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp' AS $$
  WITH w AS (
    SELECT firecrawl_param('best_w_tier', 2) wt, firecrawl_param('best_w_complete', 1) wc, firecrawl_param('best_w_outcome', 1) wo,
           firecrawl_param('best_w_unique', 1) wu, firecrawl_param('best_w_group', 1) wg,
           firecrawl_param('tier1_weight', 1) t1, firecrawl_param('tier2_weight', 0.6) t2, firecrawl_param('tier3_weight', 0.2) t3
  ), c AS (
    SELECT w.*,
      CASE WHEN p_year BETWEEN 1964 AND 1973 THEN 1 WHEN p_year BETWEEN 1974 AND 1991 THEN w.t2 / w.t1
           WHEN p_year IS NOT NULL THEN w.t3 / w.t1 END ctier,
      (coalesce(p_has_desc, false)::int + coalesce(p_has_vin, false)::int + coalesce(p_has_img, false)::int + coalesce(p_has_loc, false)::int) / 4.0 ccomp,
      CASE WHEN p_sale_price > 0 THEN 1.0 WHEN p_outcome IN ('sold', 'reserve_not_met', 'no_sale', 'ended') THEN 0.5 ELSE 0.0 END cout,
      CASE WHEN p_cross IS NULL THEN NULL WHEN p_cross THEN 0.0 ELSE 1.0 END cuni,
      p_group_norm cgrp
    FROM w
  )
  SELECT jsonb_build_object(
    'score', (wt * coalesce(ctier, 0) + wc * ccomp + wo * cout + wu * coalesce(cuni, 0) + wg * coalesce(cgrp, 0)) / (wt + wc + wo + wu + wg),
    'tier', ctier, 'complete', ccomp, 'outcome', cout, 'unique', cuni, 'group', cgrp,
    'unknown', to_jsonb(array_remove(ARRAY[CASE WHEN ctier IS NULL THEN 'tier' END, CASE WHEN cuni IS NULL THEN 'unique' END,
                                          CASE WHEN cgrp IS NULL THEN 'group' END, 'non_dealer'], NULL)),
    'version', 'best_v1')
  FROM c
$$;

-- Score the lots that Firecrawl fetches landed since p_since: snapshot -> event (URL variants: with or without a trailing
-- slash, www, query) -> vehicle -> family and group. Idempotent per (event, version).
CREATE OR REPLACE FUNCTION public.firecrawl_score_lots(p_since timestamptz DEFAULT now() - interval '30 days')
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_n integer;
  v_gmax numeric;
  v_gat timestamptz;
  v_ver text := coalesce((SELECT text_value FROM public.firecrawl_params WHERE key = 'metric_version'), 'best_v1');
BEGIN
  SELECT max(computed_at) INTO v_gat FROM public.firecrawl_group_score;
  SELECT max(gscore) INTO v_gmax FROM public.firecrawl_group_score WHERE computed_at = v_gat;
  INSERT INTO public.firecrawl_lot_score (event_id, metric_version, vehicle_id, source, landed_at, score, components, scored_at)
  SELECT x.event_id, v_ver, x.vehicle_id, x.source, x.landed_at, (x.b ->> 'score')::numeric, x.b, now()
  FROM (
    SELECT DISTINCT ON (e.id) e.id event_id, e.vehicle_id, sp.source, s.fetched_at landed_at,
           firecrawl_best_v1(v.year, v.description IS NOT NULL, v.vin IS NOT NULL, (v.primary_image_url IS NOT NULL OR coalesce(v.image_count, 0) > 0),
                             coalesce(v.listing_location, v.location, v.city, v.state) IS NOT NULL, v.sale_price, v.canonical_outcome,
                             EXISTS (SELECT 1 FROM public.vehicle_events o WHERE o.vehicle_id = e.vehicle_id AND o.source_platform <> e.source_platform),
                             CASE WHEN fam.family_id IS NULL THEN NULL ELSE coalesce(g.gscore / nullif(v_gmax, 0), 0) END) b
      FROM (SELECT DISTINCT ON (platform, listing_url) platform, listing_url, fetched_at
              FROM public.listing_page_snapshots
             WHERE fetch_method = 'firecrawl' AND success AND fetched_at >= p_since
             ORDER BY platform, listing_url, fetched_at DESC) s
      JOIN public.firecrawl_source_params sp ON s.platform = ANY (sp.snapshot_platforms)
      CROSS JOIN LATERAL (SELECT unnest(ARRAY[
          s.listing_url, regexp_replace(s.listing_url, '/+$', ''), regexp_replace(s.listing_url, '/+$', '') || '/',
          regexp_replace(regexp_replace(s.listing_url, '^https://www\.', 'https://'), '/+$', ''),
          regexp_replace(regexp_replace(s.listing_url, '^https://([^w])', 'https://www.\1'), '/+$', ''),
          regexp_replace(s.listing_url, '[?#].*$', '')]) u) var
      JOIN public.vehicle_events e ON e.source_url = var.u
      JOIN public.vehicles v ON v.id = e.vehicle_id AND v.deleted_at IS NULL
      LEFT JOIN LATERAL (SELECT n.family_id::text family_id FROM mv_model_family_names n
                          WHERE n.make_l = lower(v.make) AND n.model_l = lower(coalesce(v.model, '')) AND n.family_id IS NOT NULL
                            AND (v.year IS NULL OR n.year_start IS NULL OR v.year >= n.year_start - 1)
                            AND (v.year IS NULL OR n.year_end IS NULL OR v.year <= n.year_end + 1) LIMIT 1) fam ON true
      LEFT JOIN public.firecrawl_group_score g ON g.family_key = fam.family_id AND g.computed_at = v_gat
           AND g.band = CASE WHEN v.year BETWEEN 1964 AND 1973 THEN 1 WHEN v.year BETWEEN 1974 AND 1991 THEN 2 ELSE 3 END
     ORDER BY e.id, s.fetched_at DESC
  ) x
  ON CONFLICT (event_id, metric_version) DO UPDATE
    SET score = EXCLUDED.score, components = EXCLUDED.components, landed_at = EXCLUDED.landed_at, scored_at = EXCLUDED.scored_at;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- The backtest: per source, what a window of Firecrawl spend bought. credits = Firecrawl fetches (successful or not),
-- lots = distinct scored lots, best_v1 summed and averaged, best_v1 per credit.
CREATE OR REPLACE FUNCTION public.firecrawl_backtest(p_since timestamptz, p_until timestamptz DEFAULT now(), p_version text DEFAULT NULL)
RETURNS TABLE (source text, credits bigint, failed_fetches bigint, lots_landed bigint, best_sum numeric, best_mean numeric,
               best_per_credit numeric, lots_per_credit numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
  WITH cr AS (
    SELECT sp.source, count(*) credits, count(*) FILTER (WHERE NOT s.success) failed
      FROM public.listing_page_snapshots s JOIN public.firecrawl_source_params sp ON s.platform = ANY (sp.snapshot_platforms)
     WHERE s.fetch_method = 'firecrawl' AND s.fetched_at >= p_since AND s.fetched_at < p_until GROUP BY sp.source
  ), ls AS (
    SELECT l.source, count(*) lots, sum(l.score) best_sum, avg(l.score) best_mean
      FROM public.firecrawl_lot_score l
     WHERE l.landed_at >= p_since AND l.landed_at < p_until
       AND l.metric_version = coalesce(p_version, (SELECT text_value FROM public.firecrawl_params WHERE key = 'metric_version'))
     GROUP BY l.source
  )
  SELECT cr.source, cr.credits, cr.failed, coalesce(ls.lots, 0), coalesce(ls.best_sum, 0), ls.best_mean,
         coalesce(ls.best_sum, 0) / nullif(cr.credits, 0), coalesce(ls.lots, 0)::numeric / nullif(cr.credits, 0)
    FROM cr LEFT JOIN ls USING (source) ORDER BY coalesce(ls.best_sum, 0) / nullif(cr.credits, 0) DESC NULLS LAST
$$;

-- A paused source returns no allowance.
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
  IF EXISTS (SELECT 1 FROM public.firecrawl_source_params WHERE source = p_source AND paused IS NOT NULL) THEN RETURN 0; END IF;
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
  SELECT coalesce(sum(credits) FILTER (WHERE spent_at < current_date), 0), coalesce(sum(credits) FILTER (WHERE spent_at >= current_date), 0)
    INTO v_spent_before, v_spent_today FROM public.firecrawl_spend_log WHERE source = p_source AND spent_at >= v_start;
  v_days_left := greatest(1, v_end - current_date);
  RETURN greatest(0, least(v_alloc - v_spent_before - v_spent_today, ceil((v_alloc - v_spent_before) / v_days_left) - v_spent_today));
END $$;

-- The weekly job, now ranking on best_v1 per credit.
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
  v_gmax numeric;
  v_window interval := firecrawl_param('observed_window_days', 30)::int * interval '1 day';
  v_held numeric := 0;
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
                           year int, sale_price numeric, complete_share numeric, sample_scale numeric, ended_at timestamptz, best numeric) ON COMMIT DROP;

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
                CASE WHEN fam.family_id IS NULL THEN NULL ELSE coalesce(g.gscore / nullif(%s::numeric, 0), 0) END) ->> 'score')::numeric
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
      CASE WHEN v_n_est <= v_small THEN '' ELSE format('TABLESAMPLE SYSTEM (%s)', v_pct) END,
      r.event_platforms);
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
           avg(best) FILTER (WHERE vehicle_id IS NOT NULL AND year IS NOT NULL) mean_best,
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
         CASE WHEN ev.joined >= v_min THEN ev.mean_best END mean_best,
         s.owner_judgment, s.paused,
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
  -- value = the mean best_v1 of the source's landed lots (a sample), blended with the owner's own rating where he gave one
  -- (the lots count 2, the rating owner_judgment_weight).
  UPDATE fc_src s SET
    value = CASE WHEN s.owner_judgment IS NULL THEN s.mean_best
                 WHEN s.mean_best IS NULL THEN NULL
                 ELSE (2 * s.mean_best + firecrawl_param('owner_judgment_weight', 1) *
                       firecrawl_param('owner_rating_' || (s.owner_judgment ->> 'rating'), 0.5)) / (2 + firecrawl_param('owner_judgment_weight', 1)) END,
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

  -- 3. Observed return: best_v1 summed over the lots Firecrawl landed in the window, per credit spent (credits = Firecrawl
  --    fetches, successful or not, or the spend log if larger). Lots are scored first, from the group scores just stored.
  PERFORM public.firecrawl_score_lots(v_now - v_window);
  ALTER TABLE fc_src ADD COLUMN obs_credits numeric, ADD COLUMN obs_lots bigint, ADD COLUMN obs_sum numeric,
                     ADD COLUMN obs_per_credit numeric, ADD COLUMN prior_per_credit numeric, ADD COLUMN rank_key numeric,
                     ADD COLUMN would_allocate numeric DEFAULT 0;
  UPDATE fc_src s SET
    obs_credits = greatest(
      (SELECT count(*) FROM public.listing_page_snapshots n JOIN public.firecrawl_source_params sp ON n.platform = ANY (sp.snapshot_platforms)
        WHERE sp.source = s.source AND n.fetch_method = 'firecrawl' AND n.fetched_at >= v_now - v_window),
      coalesce((SELECT sum(credits) FROM public.firecrawl_spend_log l WHERE l.source = s.source AND l.spent_at >= v_now - v_window), 0)),
    obs_lots = (SELECT count(*) FROM public.firecrawl_lot_score l WHERE l.source = s.source AND l.metric_version = v_ver AND l.landed_at >= v_now - v_window),
    obs_sum = (SELECT sum(score) FROM public.firecrawl_lot_score l WHERE l.source = s.source AND l.metric_version = v_ver AND l.landed_at >= v_now - v_window);
  UPDATE fc_src s SET
    obs_per_credit = CASE WHEN s.obs_lots >= firecrawl_param('min_observed_lots', 30) AND s.obs_credits > 0 THEN s.obs_sum / s.obs_credits END,
    prior_per_credit = CASE WHEN s.cost > 0 THEN s.value / s.cost END;
  UPDATE fc_src s SET rank_key = coalesce(s.obs_per_credit, s.prior_per_credit);

  -- 4. Allocation: Firecrawl-dependent sources by best_v1 per credit (observed once enough Firecrawl-landed lots are
  --    scored, else the prior: mean best_v1 over the cost), each capped by its gap in credits and by its share. A paused
  --    source is simulated so the ranking shows whether it clears the cut, but it receives no credits.
  v_remaining := v_alloc_budget;
  FOR r IN SELECT * FROM fc_src WHERE firecrawl_dependent AND score > 0 AND rank_key > 0 ORDER BY rank_key DESC, score DESC LOOP
    v_cap := least(r.gap * r.cost, firecrawl_param('max_source_share', 0.5) * v_alloc_budget);
    v_give := floor(least(v_cap, v_remaining));
    IF v_give > 0 THEN
      IF r.paused IS NULL THEN
        UPDATE fc_src SET alloc = v_give WHERE source = r.source;
      ELSE
        UPDATE fc_src SET would_allocate = v_give WHERE source = r.source;
        v_held := v_held + v_give;
      END IF;
      v_remaining := v_remaining - v_give;
    END IF;
  END LOOP;

  -- 5. Write: one '*' row per source (the scored inputs), group rows for allocated sources.
  INSERT INTO public.firecrawl_target_allocation (source, vehicle_group, monthly_credits, score, inputs, computed_at)
  SELECT s.source, '*', s.alloc, s.score,
         jsonb_build_object(
           'firecrawl_dependent', s.firecrawl_dependent, 'free_of_credits', NOT s.firecrawl_dependent,
           'metric_version', v_ver, 'value', s.value, 'mean_best_lot_score', s.mean_best, 'owner_judgment', s.owner_judgment, 'paused', s.paused,
           'would_allocate', s.would_allocate, 'rank_key_best_per_credit', s.rank_key, 'prior_best_per_credit', s.prior_per_credit,
           'observed', jsonb_build_object('window_days', firecrawl_param('observed_window_days', 30), 'credits', s.obs_credits, 'lots_scored', s.obs_lots,
                                          'best_sum', s.obs_sum, 'best_per_credit', s.obs_per_credit),
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
                            'allocated', v_sum_alloc, 'held_by_paused', v_held, 'metric_version', v_ver, 'sources', (SELECT count(*) FROM fc_src),
                            'scored', (SELECT count(*) FROM fc_src WHERE score IS NOT NULL), 'groups', (SELECT count(*) FROM fc_grp));
END $$;

REVOKE ALL ON FUNCTION public.firecrawl_best_v1(int, boolean, boolean, boolean, boolean, numeric, text, boolean, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.firecrawl_score_lots(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.firecrawl_backtest(timestamptz, timestamptz, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.firecrawl_allowance(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.firecrawl_best_v1(int, boolean, boolean, boolean, boolean, numeric, text, boolean, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.firecrawl_score_lots(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.firecrawl_backtest(timestamptz, timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.firecrawl_allowance(text) TO service_role;
REVOKE ALL ON FUNCTION public.refresh_firecrawl_target_allocation(jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_firecrawl_target_allocation(jsonb, timestamptz) TO service_role;
COMMIT;
