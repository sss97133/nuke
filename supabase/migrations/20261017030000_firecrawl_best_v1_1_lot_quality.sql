-- best_v1.1 (2026-10-15): v1 plus a lot-level QUALITY component, scored beside v1 so the two can be compared.
-- Owner, 17:0xZ: "ebay is low quality." lane-ebay's audit (0 credits) measured what that means on 1,121 landed lots: no observable
-- outcome, 29% of the "private" listings use dealer wording, 17% parts or project wording, typed VINs that are not 17 characters,
-- relists. Those are properties of a LOT, and the same ones apply to every source, so they are stored as lot-level signals
-- (lot_quality_signal) from each extractor's own read of the lot, with a method, and best_v1.1 reads them.
--
--   signal          values                       meaning of a failed check
--   dealer_wording  true | false                 the description reads like a dealer's (dealer, financing, we offer, stock #, consign ...)
--   parts_project   true | false                 parts, project or non-running wording (project, parts car, non-running, barn find ...)
--   vin_noise       ok | not_17 | masked | conflict   a model-year-1981-or-later VIN that is not 17 characters, a masked VIN, or a typed-VIN conflict
--   relist          true | false                 the same vehicle already has another event on the same platform
--   seller_type     private | dealer | unknown   declared or inferred seller class, with its basis in evidence (proposal: docs/proposals/)
--   quality = checks passed / checks known (1 when every known check passes; unknown when none is known, which counts 0).
--   best_v1_1 = (best_v1 weights x components + best_w_quality x quality) / (sum of weights + best_w_quality).
-- Method 'lexicon_v1' derives dealer_wording, parts_project, vin_noise and relist from the stored description, year, VIN and events
-- for every scored lot (0 credits). A lane that reads the lot better writes the signal with its own method through
-- record_lot_quality_signals(); a lane-written signal overrides the derived one. The lexicons are rows in firecrawl_params.
-- Also here: Collecting Cars is a TRIAL capped at 50 credits (owner-lead decision), via firecrawl_source_params.credit_cap.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS public.lot_quality_signal (
  event_id uuid NOT NULL,
  signal text NOT NULL CHECK (signal IN ('dealer_wording', 'parts_project', 'vin_noise', 'relist', 'seller_type')),
  value text NOT NULL,
  method text NOT NULL,              -- 'lexicon_v1' (derived) or the writing lane/extractor
  evidence jsonb,
  written_by text,
  observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, signal, method)
);
CREATE INDEX IF NOT EXISTS lot_quality_signal_event ON public.lot_quality_signal (event_id);
ALTER TABLE public.lot_quality_signal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lot_quality_signal FROM anon, authenticated;
COMMENT ON TABLE public.lot_quality_signal IS 'Lot-level quality signals per vehicle_events row (dealer wording, parts/project wording, VIN noise, relist, seller type), each with its method and evidence. Derived by lexicon_v1 for Firecrawl-landed lots, overridden by a lane that reads the lot better. Written through record_lot_quality_signals().';

ALTER TABLE public.firecrawl_source_params ADD COLUMN IF NOT EXISTS credit_cap numeric, ADD COLUMN IF NOT EXISTS cap_note text;
COMMENT ON COLUMN public.firecrawl_source_params.credit_cap IS 'Most credits per billing period the source may receive whatever its rank (a trial cap).';
UPDATE public.firecrawl_source_params SET credit_cap = 50,
  cap_note = 'Trial (owner-lead 2026-10-15): 1964-1991 lots only, from public listing pages only and never the search index, at most 15 a day through daily-capture-master. After 30 scored lots its observed return replaces the prior.'
 WHERE source = 'collecting-cars';

INSERT INTO public.firecrawl_params (key, value, text_value, note) VALUES
 ('best_w_quality',          1,    NULL, 'best_v1_1 weight of the lot-level quality component.'),
 ('quality_subsample_pct',   8,    NULL, 'Percent of a source''s sampled lots whose description is read for the quality component of the prior (the read detoasts text).'),
 ('lexicon_dealer',          NULL, $r$\m(dealer|dealership|financing|we offer|consign\w*|visit our|extended warranty|trade[- ]?ins?)\M|stock ?#$r$,
    'Regex (ARE, case-insensitive) for dealer wording in a description. From the terms lane-ebay''s audit used. Tunable.'),
 ('lexicon_parts_project',   NULL, $r$\m(project|parts car|for parts|non[- ]?running|barn find|needs (work|restoration|rebuild)|does ?n.?t run|not running|no (engine|motor)|rolling chassis|salvage)\M$r$,
    'Regex (ARE, case-insensitive) for parts, project or non-running wording. From the terms lane-ebay''s audit used. Tunable.')
ON CONFLICT (key) DO NOTHING;
UPDATE public.firecrawl_params SET text_value = 'best_v1_1', set_at = now(),
  note = 'The lot-value metric in force for the ranking. best_v1 is still scored beside it. A new version is published with its diff.'
 WHERE key = 'metric_version';

CREATE OR REPLACE FUNCTION public.firecrawl_quality_derive(p_desc text, p_year int, p_vin text, p_relist boolean)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp' AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'dealer_wording', CASE WHEN p_desc IS NULL OR p_desc = '' THEN NULL
                           ELSE (p_desc ~* (SELECT text_value FROM public.firecrawl_params WHERE key = 'lexicon_dealer'))::text END,
    'parts_project',  CASE WHEN p_desc IS NULL OR p_desc = '' THEN NULL
                           ELSE (p_desc ~* (SELECT text_value FROM public.firecrawl_params WHERE key = 'lexicon_parts_project'))::text END,
    'vin_noise',      CASE WHEN p_vin IS NULL THEN NULL WHEN p_vin ~ '\*|X{4,}' THEN 'masked'
                           WHEN p_year >= 1981 AND length(p_vin) <> 17 THEN 'not_17' ELSE 'ok' END,
    'relist',         p_relist::text))
$$;

-- quality in 0..1 from a signals object; NULL when no check is known. seller_type = dealer fails a check, private passes one.
CREATE OR REPLACE FUNCTION public.firecrawl_quality_score(p_signals jsonb)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN count(*) = 0 THEN NULL ELSE sum(pass)::numeric / count(*) END
  FROM (
    SELECT (p_signals ->> 'dealer_wording' = 'false')::int pass WHERE p_signals ? 'dealer_wording'
    UNION ALL SELECT (p_signals ->> 'parts_project' = 'false')::int WHERE p_signals ? 'parts_project'
    UNION ALL SELECT (p_signals ->> 'vin_noise' = 'ok')::int WHERE p_signals ? 'vin_noise'
    UNION ALL SELECT (p_signals ->> 'relist' = 'false')::int WHERE p_signals ? 'relist'
    UNION ALL SELECT (p_signals ->> 'seller_type' = 'private')::int WHERE p_signals ->> 'seller_type' IN ('private', 'dealer')
  ) q
$$;

CREATE OR REPLACE FUNCTION public.firecrawl_best_v1_1(
  p_year int, p_has_desc boolean, p_has_vin boolean, p_has_img boolean, p_has_loc boolean,
  p_sale_price numeric, p_outcome text, p_cross boolean, p_group_norm numeric, p_signals jsonb)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp' AS $$
  WITH b AS (SELECT public.firecrawl_best_v1(p_year, p_has_desc, p_has_vin, p_has_img, p_has_loc, p_sale_price, p_outcome, p_cross, p_group_norm) j),
       w AS (SELECT firecrawl_param('best_w_tier', 2) + firecrawl_param('best_w_complete', 1) + firecrawl_param('best_w_outcome', 1)
                    + firecrawl_param('best_w_unique', 1) + firecrawl_param('best_w_group', 1) wsum, firecrawl_param('best_w_quality', 1) wq),
       q AS (SELECT public.firecrawl_quality_score(p_signals) cq)
  SELECT (b.j - 'score' - 'version') || jsonb_build_object(
    'score', (w.wsum * (b.j ->> 'score')::numeric + w.wq * coalesce(q.cq, 0)) / (w.wsum + w.wq),
    'quality', q.cq, 'signals', p_signals, 'v1_score', (b.j ->> 'score')::numeric, 'version', 'best_v1_1',
    'unknown', (b.j -> 'unknown') || CASE WHEN q.cq IS NULL THEN '["quality"]'::jsonb ELSE '[]'::jsonb END)
  FROM b, w, q
$$;

-- The sanctioned writer for lot-level quality signals: [{event_id, signal, value, method, evidence}] (at most 500 per call).
CREATE OR REPLACE FUNCTION public.record_lot_quality_signals(p_rows jsonb, p_written_by text DEFAULT 'agent')
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE r jsonb; n integer := 0;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN RAISE EXCEPTION 'record_lot_quality_signals: p_rows must be a JSON array'; END IF;
  IF jsonb_array_length(p_rows) > 500 THEN RAISE EXCEPTION 'record_lot_quality_signals: at most 500 rows per call'; END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    IF coalesce(r ->> 'method', '') IN ('', 'lexicon_v1') THEN
      RAISE EXCEPTION 'record_lot_quality_signals: method is required and lexicon_v1 is reserved for the derived read (got %)', r ->> 'method';
    END IF;
    IF NOT pg_input_is_valid(r ->> 'event_id', 'uuid') THEN RAISE EXCEPTION 'record_lot_quality_signals: bad event_id %', r ->> 'event_id'; END IF;
    IF (r ->> 'signal') IN ('dealer_wording', 'parts_project', 'relist') AND (r ->> 'value') NOT IN ('true', 'false') THEN
      RAISE EXCEPTION 'record_lot_quality_signals: % takes true or false (got %)', r ->> 'signal', r ->> 'value'; END IF;
    IF (r ->> 'signal') = 'vin_noise' AND (r ->> 'value') NOT IN ('ok', 'not_17', 'masked', 'conflict') THEN
      RAISE EXCEPTION 'record_lot_quality_signals: vin_noise takes ok, not_17, masked or conflict (got %)', r ->> 'value'; END IF;
    IF (r ->> 'signal') = 'seller_type' AND (r ->> 'value') NOT IN ('private', 'dealer', 'unknown') THEN
      RAISE EXCEPTION 'record_lot_quality_signals: seller_type takes private, dealer or unknown (got %)', r ->> 'value'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.vehicle_events WHERE id = (r ->> 'event_id')::uuid) THEN
      RAISE EXCEPTION 'record_lot_quality_signals: event % does not exist', r ->> 'event_id'; END IF;
    INSERT INTO public.lot_quality_signal (event_id, signal, value, method, evidence, written_by, observed_at)
    VALUES ((r ->> 'event_id')::uuid, r ->> 'signal', r ->> 'value', r ->> 'method', r -> 'evidence', p_written_by, now())
    ON CONFLICT (event_id, signal, method) DO UPDATE SET value = EXCLUDED.value, evidence = EXCLUDED.evidence,
      written_by = EXCLUDED.written_by, observed_at = EXCLUDED.observed_at;
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.firecrawl_score_lots(p_since timestamptz DEFAULT now() - interval '30 days')
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_n integer;
  v_gmax numeric;
  v_gat timestamptz;
BEGIN
  SELECT max(computed_at) INTO v_gat FROM public.firecrawl_group_score;
  SELECT max(gscore) INTO v_gmax FROM public.firecrawl_group_score WHERE computed_at = v_gat;
  CREATE TEMP TABLE fc_lots ON COMMIT DROP AS
  SELECT DISTINCT ON (e.id) e.id event_id, e.vehicle_id, sp.source, s.fetched_at landed_at,
         v.year, v.description IS NOT NULL has_desc, v.vin IS NOT NULL has_vin,
         (v.primary_image_url IS NOT NULL OR coalesce(v.image_count, 0) > 0) has_img,
         coalesce(v.listing_location, v.location, v.city, v.state) IS NOT NULL has_loc,
         v.sale_price, v.canonical_outcome,
         EXISTS (SELECT 1 FROM public.vehicle_events o WHERE o.vehicle_id = e.vehicle_id AND o.source_platform <> e.source_platform) cross_listed,
         CASE WHEN fam.family_id IS NULL THEN NULL ELSE coalesce(g.gscore / nullif(v_gmax, 0), 0) END group_norm,
         public.firecrawl_quality_derive(v.description, v.year, v.vin,
           EXISTS (SELECT 1 FROM public.vehicle_events o WHERE o.vehicle_id = e.vehicle_id AND o.source_platform = e.source_platform AND o.id <> e.id)) derived
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
   ORDER BY e.id, s.fetched_at DESC;

  -- The derived (lexicon_v1) lot-level quality signals are stored, so any later reader sees the same fields.
  INSERT INTO public.lot_quality_signal (event_id, signal, value, method, evidence, written_by, observed_at)
  SELECT l.event_id, k.key, k.value, 'lexicon_v1', jsonb_build_object('from', 'description, year, VIN and same-platform events at landing'),
         'firecrawl_score_lots', now()
    FROM fc_lots l CROSS JOIN LATERAL jsonb_each_text(l.derived) k
  ON CONFLICT (event_id, signal, method) DO UPDATE SET value = EXCLUDED.value, observed_at = EXCLUDED.observed_at;

  -- Both versions side by side: best_v1 and best_v1_1 (v1 plus the lot-level quality component). A lane-written signal
  -- (any method other than lexicon_v1) overrides the derived one for the same signal.
  INSERT INTO public.firecrawl_lot_score (event_id, metric_version, vehicle_id, source, landed_at, score, components, scored_at)
  SELECT x.event_id, x.ver, x.vehicle_id, x.source, x.landed_at, (x.b ->> 'score')::numeric, x.b, now()
    FROM (
      SELECT l.event_id, l.vehicle_id, l.source, l.landed_at, 'best_v1' ver,
             public.firecrawl_best_v1(l.year, l.has_desc, l.has_vin, l.has_img, l.has_loc, l.sale_price, l.canonical_outcome, l.cross_listed, l.group_norm) b
        FROM fc_lots l
      UNION ALL
      SELECT l.event_id, l.vehicle_id, l.source, l.landed_at, 'best_v1_1',
             public.firecrawl_best_v1_1(l.year, l.has_desc, l.has_vin, l.has_img, l.has_loc, l.sale_price, l.canonical_outcome, l.cross_listed, l.group_norm,
               l.derived || coalesce((SELECT jsonb_object_agg(q.signal, q.value)
                                        FROM (SELECT DISTINCT ON (signal) signal, value FROM public.lot_quality_signal z
                                               WHERE z.event_id = l.event_id AND z.method <> 'lexicon_v1' ORDER BY signal, z.observed_at DESC) q), '{}'::jsonb))
        FROM fc_lots l
    ) x
  ON CONFLICT (event_id, metric_version) DO UPDATE
    SET score = EXCLUDED.score, components = EXCLUDED.components, landed_at = EXCLUDED.landed_at, scored_at = EXCLUDED.scored_at;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

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
             CASE WHEN abs(hashtext(e.id::text)) %% 100 < %s THEN
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
      v_qpct,
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
           avg(best11) FILTER (WHERE vehicle_id IS NOT NULL AND year IS NOT NULL) mean_best11,
           count(best11) FILTER (WHERE vehicle_id IS NOT NULL AND year IS NOT NULL) joined11,
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
         CASE WHEN v_ver = 'best_v1_1' THEN CASE WHEN ev.joined11 >= v_min THEN ev.mean_best11 END
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
  -- The owner's rating reaches the observed return too: the observed best_v1 per credit is scaled by value / mean_best
  -- (1 when the owner gave no rating), so a measured return cannot override a judgment the lots do not capture.
  ALTER TABLE fc_src ADD COLUMN obs_versions jsonb;
  UPDATE fc_src s SET obs_versions = (SELECT jsonb_object_agg(q.metric_version, jsonb_build_object('lots', q.n, 'best_sum', q.sm, 'best_mean', q.av,
                                        'best_per_credit', q.sm / nullif(s.obs_credits, 0)))
                                       FROM (SELECT metric_version, count(*) n, sum(score) sm, avg(score) av FROM public.firecrawl_lot_score l
                                              WHERE l.source = s.source AND l.landed_at >= v_now - v_window GROUP BY 1) q);
  UPDATE fc_src s SET rank_key = coalesce(
    s.obs_per_credit * CASE WHEN s.owner_judgment IS NOT NULL AND s.mean_best > 0 THEN s.value / s.mean_best ELSE 1 END,
    s.prior_per_credit);

  -- 4. Allocation: Firecrawl-dependent sources by best_v1 per credit (observed once enough Firecrawl-landed lots are
  --    scored, else the prior: mean best_v1 over the cost), each capped by its gap in credits and by its share. A paused
  --    source is simulated so the ranking shows whether it clears the cut, but it receives no credits.
  v_remaining := v_alloc_budget;
  FOR r IN SELECT * FROM fc_src WHERE firecrawl_dependent AND score > 0 AND rank_key > 0 ORDER BY rank_key DESC, score DESC LOOP
    v_cap := least(r.gap * r.cost, firecrawl_param('max_source_share', 0.5) * v_alloc_budget, coalesce(r.credit_cap, 1e12));
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
           'would_allocate', s.would_allocate, 'rank_key_best_per_credit', s.rank_key, 'owner_factor', CASE WHEN s.owner_judgment IS NOT NULL AND s.mean_best > 0 THEN s.value / s.mean_best END, 'prior_best_per_credit', s.prior_per_credit,
           'credit_cap', s.credit_cap, 'cap_note', s.cap_note,
           'mean_best_v1', s.mean_best_v1, 'mean_best_v1_1', s.mean_best_v1_1, 'sample_n_v1_1', s.sample_n_v1_1, 'observed_by_version', s.obs_versions,
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

REVOKE ALL ON FUNCTION public.firecrawl_quality_derive(text, int, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.firecrawl_quality_score(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.firecrawl_best_v1_1(int, boolean, boolean, boolean, boolean, numeric, text, boolean, numeric, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_lot_quality_signals(jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.firecrawl_score_lots(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_firecrawl_target_allocation(jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.firecrawl_quality_derive(text, int, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.firecrawl_quality_score(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.firecrawl_best_v1_1(int, boolean, boolean, boolean, boolean, numeric, text, boolean, numeric, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_lot_quality_signals(jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.firecrawl_score_lots(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_firecrawl_target_allocation(jsonb, timestamptz) TO service_role;
COMMIT;
