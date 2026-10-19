-- family_price_index / family_price_change: what a model family's price did, for the same cars, written nightly.
--
-- Owner, 2026-10-15, looking at the F430 sales chart: "once you examine it you actually begin to hate it, because median
-- doesnt matter ... the 247 examples are very different". The family median moves when the mix of what sold moves. The
-- like-for-like study (2026-10-16, ~/nuke-logs/price-index-20261016) measured it on the BaT archive (231k car lots) and on
-- this fold's own rows: the Corvette median read +8.7% for the last 12 months against +0.8% for the same cars; the F430's
-- +37.5% came with an interval of +9 to +53 against +30 to +49 for the same cars; the hedonic fit beat the raw median and
-- repeat sales in every family tested, and old trucks (C10, K5) have too few sales to read.
--
-- What this adds (a derived reading of mv_family_sales; no testimony, no source of truth):
--   family_price_index   one row per family and period: the price of one reference car (the last 12 months' mix of variants,
--                        gearbox, miles, model years and venues) with its 95% range, the sales in the period and the plain
--                        median of the same sales. Calendar months or quarters, so history stays put from night to night.
--   family_price_change  one row per family: the 12-month change for the same cars (last 365 days against the 365 before,
--                        the windows mv_family_market uses) with its 95% range, the verdict, the repeat-sale check, the
--                        reference car described, and the segment chips (generation, body by gearbox, decade).
--   record_family_price_index(jsonb)       the writer, service_role only: replaces one family's rows in one call, refuses a
--                        payload whose fitted_at is in the future (more than 5 minutes ahead of the database clock) or older
--                        than the stored fit, and refuses a verdict its own interval contradicts. A refusal changes nothing.
--   family_price_index_read(text, text)    the anon reader: one jsonb {change, series, counts, floor, stale}, at most 130 rows.
--   family_price_index_candidates()        service_role: every named family with 50+ priced sales and its window counts.
--   family_price_index_inputs(text, text, integer)   service_role: one family's priced sales as one jsonb (the API cuts sets at
--                        1,000 rows), newest first, at most 15,000 by default. The matview alone: no read of vehicles.
--   family_price_index_features(uuid[])    service_role: the vehicle's mileage, transmission and listing title for up to 2,000 ids.
--                        The job keeps what it has read in a local cache and asks only for vehicles it has not seen (and, once a month,
--                        for the last year's sales again), so a night reads a few thousand vehicle rows, not the 150,000 of the
--                        families it fits: vehicles is 11 GB and the first cold read of a big family timed out at 9 s on 2026-10-16.
--   family_price_index_pairs(text, text, integer)    service_role: the dated sold events of vehicles in the family that sold
--                        twice, for the repeat-sale check (mv_family_sales holds one sale per vehicle, so the pairs live in
--                        auction_events).
-- The fit is a nightly Mac job, scripts/market/family-price-index.py (launchd, 11:20Z in daylight time), because it is an
-- ordinary-least-squares fit with a few hundred dummies, not SQL. Its rules: the hedonic spec, the 30 / 30 / 150 floor, month
-- or quarter by +-10 support, the +-5 / excludes-zero verdict rule, 4-sigma trimming.
-- Contract: supabase/sql/test_family_price_index.sql (db-contracts).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.family_price_index (
  brand text NOT NULL,
  family_key text NOT NULL,
  period_kind text NOT NULL,               -- month or quarter; the writer refuses anything else
  period_start date NOT NULL,              -- first day of the calendar month or quarter
  index_usd numeric NOT NULL CHECK (index_usd > 0),
  lo_usd numeric NOT NULL CHECK (lo_usd > 0),
  hi_usd numeric NOT NULL CHECK (hi_usd > 0),
  n integer NOT NULL CHECK (n >= 0),
  raw_median_usd numeric CHECK (raw_median_usd IS NULL OR raw_median_usd > 0),
  fitted_at timestamptz NOT NULL,
  PRIMARY KEY (brand, family_key, period_kind, period_start),
  CHECK (lo_usd <= index_usd AND index_usd <= hi_usd)
);
COMMENT ON TABLE public.family_price_index IS
  'A model family''s price over time for the same cars: one row per family and calendar month or quarter, the reference car''s '
  'price with its 95% range, the sales in the period and their plain median. Written by record_family_price_index(), which '
  'replaces a family''s rows in one call; read through family_price_index_read(). 2026-10-16.';
COMMENT ON COLUMN public.family_price_index.brand IS 'mv_family_sales.brand: the brand tile''s name.';
COMMENT ON COLUMN public.family_price_index.family_key IS 'mv_family_sales.family_key: the canonical model family (never "other").';
COMMENT ON COLUMN public.family_price_index.period_kind IS 'month or quarter, chosen per family by whether its 95% range stays within +-10% (family-price-index.py).';
COMMENT ON COLUMN public.family_price_index.period_start IS 'First day of the calendar month or quarter. A period that has not ended is a partial one and is written only once it has 8 sales.';
COMMENT ON COLUMN public.family_price_index.index_usd IS 'Price of one reference car in the period: the last 12 months'' mix of variants, gearbox, miles, model years and venues, from a log-price fit with period dummies (hedonic_v1).';
COMMENT ON COLUMN public.family_price_index.lo_usd IS 'Lower end of the 95% range of index_usd.';
COMMENT ON COLUMN public.family_price_index.hi_usd IS 'Upper end of the 95% range of index_usd.';
COMMENT ON COLUMN public.family_price_index.n IS 'Sales in the period that the fit used (rows beyond 4 robust sigma of the fit are left out).';
COMMENT ON COLUMN public.family_price_index.raw_median_usd IS 'Plain median of every priced sale of the family in the period, any venue: the line the page drew before, which moves with the mix of what sold.';
COMMENT ON COLUMN public.family_price_index.fitted_at IS 'When the nightly job fitted this family; the writer refuses a future time and a time older than the stored fit.';
ALTER TABLE public.family_price_index ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.family_price_index FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.family_price_index TO service_role;

CREATE TABLE IF NOT EXISTS public.family_price_change (
  brand text NOT NULL,
  family_key text NOT NULL,
  change_12m numeric,                      -- the same cars, last 365 days against the 365 before, as a fraction (0.297 = +29.7%)
  lo numeric,                              -- 95% range
  hi numeric,
  n_prior12 integer NOT NULL CHECK (n_prior12 >= 0),
  n_last12 integer NOT NULL CHECK (n_last12 >= 0),
  verdict text NOT NULL,                   -- up | down | flat | too few to tell; the writer refuses anything else
  method text NOT NULL,
  ref_car jsonb NOT NULL DEFAULT '{}'::jsonb,
  pairs integer CHECK (pairs IS NULL OR pairs >= 0),
  rs_change numeric,                       -- the same cars sold twice (repeat sales), a check and never the headline
  rs_lo numeric,
  rs_hi numeric,
  chips jsonb NOT NULL DEFAULT '[]'::jsonb,
  fitted_at timestamptz NOT NULL,
  PRIMARY KEY (brand, family_key),
  CHECK (change_12m IS NULL OR (lo IS NOT NULL AND hi IS NOT NULL AND lo <= change_12m AND change_12m <= hi)),
  CHECK (rs_change IS NULL OR (rs_lo IS NOT NULL AND rs_hi IS NOT NULL AND rs_lo <= rs_change AND rs_change <= rs_hi))
);
COMMENT ON TABLE public.family_price_change IS
  'A model family''s 12-month price change for the same cars: the estimate with its 95% range, the verdict (up, down, flat or '
  'too few to tell), the sales it rests on, the repeat-sale check, the reference car described and the segment chips. One row '
  'per fitted family, replaced by record_family_price_index(); read through family_price_index_read(). 2026-10-16.';
COMMENT ON COLUMN public.family_price_change.change_12m IS 'Change in the price of the same cars, the last 365 days against the 365 before, as a fraction; present with its range even when the verdict is too few to tell.';
COMMENT ON COLUMN public.family_price_change.lo IS 'Lower end of the 95% range of change_12m.';
COMMENT ON COLUMN public.family_price_change.hi IS 'Upper end of the 95% range of change_12m.';
COMMENT ON COLUMN public.family_price_change.n_prior12 IS 'Sales in the 365 days before the last 365 that the fit used.';
COMMENT ON COLUMN public.family_price_change.n_last12 IS 'Sales in the last 365 days that the fit used.';
COMMENT ON COLUMN public.family_price_change.verdict IS 'up when the 95% range is above zero, down when below, flat when it holds zero and is within +-5 points, otherwise too few to tell.';
COMMENT ON COLUMN public.family_price_change.method IS 'The fit that wrote the row (hedonic_v1).';
COMMENT ON COLUMN public.family_price_change.ref_car IS 'The reference car described: basis, sales, median model year and miles, manual share, venue shares, the top variants, and the fit''s spec.';
COMMENT ON COLUMN public.family_price_change.pairs IS 'Repeat-sale pairs (the same car sold twice at the same venue, 180+ days apart) the check used; null when the family has none to use.';
COMMENT ON COLUMN public.family_price_change.rs_change IS 'The 12-month change read from those pairs (Bailey-Muth-Nourse with Case-Shiller interval weights); null under 10 pairs or 5 touching the last year. A check, never the headline.';
COMMENT ON COLUMN public.family_price_change.rs_lo IS 'Lower end of the repeat-sale change''s bootstrap 95% range.';
COMMENT ON COLUMN public.family_price_change.rs_hi IS 'Upper end of the repeat-sale change''s bootstrap 95% range.';
COMMENT ON COLUMN public.family_price_change.chips IS 'Segment chips: [{kind, key, label, change, lo, hi, n_last12, n_prior12, verdict}] by generation, body by gearbox, model-year decade or variant; a chip under 15 sales in either year carries too few to tell.';
COMMENT ON COLUMN public.family_price_change.fitted_at IS 'When the nightly job fitted this family.';
ALTER TABLE public.family_price_change ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.family_price_change FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.family_price_change TO service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- The writer
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_family_price_index(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_brand text;
  v_key text;
  v_fitted timestamptz;
  v_prev timestamptz;
  v_ch jsonb;
  v_ref jsonb;
  v_chips jsonb;
  v_series jsonb;
  v_kind text;
  v_verdict text;
  v_old integer;
  v_new integer;
  v_lo numeric;
  v_hi numeric;
  v_mid numeric;
  e jsonb;
  v_d date;
  v_seen date[] := ARRAY[]::date[];
BEGIN
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'record_family_price_index: the payload must be a json object';
  END IF;
  IF octet_length(p_payload::text) > 400000 THEN
    RAISE EXCEPTION 'record_family_price_index: the payload is over 400,000 bytes';
  END IF;
  v_brand := nullif(btrim(p_payload->>'brand'), '');
  v_key := nullif(btrim(p_payload->>'family_key'), '');
  IF v_brand IS NULL OR v_key IS NULL OR length(v_brand) > 200 OR length(v_key) > 200 THEN
    RAISE EXCEPTION 'record_family_price_index: brand and family_key are required (at most 200 characters each)';
  END IF;
  IF lower(v_key) = 'other' THEN
    RAISE EXCEPTION 'record_family_price_index: "other" is a brand''s leftover bucket, not a family';
  END IF;
  BEGIN
    v_fitted := (p_payload->>'fitted_at')::timestamptz;
  EXCEPTION WHEN others THEN
    v_fitted := NULL;
  END;
  IF v_fitted IS NULL THEN
    RAISE EXCEPTION 'record_family_price_index: fitted_at is required and must be a timestamp';
  END IF;
  IF v_fitted > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'record_family_price_index: fitted_at % is in the future (database clock %)', v_fitted, now();
  END IF;

  -- the change row
  v_ch := p_payload->'change';
  IF jsonb_typeof(v_ch) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'record_family_price_index: change is required and must be an object';
  END IF;
  v_verdict := v_ch->>'verdict';
  IF v_verdict IS NULL OR v_verdict NOT IN ('up', 'down', 'flat', 'too few to tell') THEN
    RAISE EXCEPTION 'record_family_price_index: verdict must be up, down, flat or too few to tell (got %)', v_verdict;
  END IF;
  IF coalesce(btrim(v_ch->>'method'), '') = '' OR length(v_ch->>'method') > 80 THEN
    RAISE EXCEPTION 'record_family_price_index: method is required (at most 80 characters)';
  END IF;
  IF jsonb_typeof(v_ch->'n_last12') IS DISTINCT FROM 'number' OR jsonb_typeof(v_ch->'n_prior12') IS DISTINCT FROM 'number'
     OR (v_ch->>'n_last12')::numeric < 0 OR (v_ch->>'n_prior12')::numeric < 0
     OR (v_ch->>'n_last12')::numeric <> trunc((v_ch->>'n_last12')::numeric)
     OR (v_ch->>'n_prior12')::numeric <> trunc((v_ch->>'n_prior12')::numeric) THEN
    RAISE EXCEPTION 'record_family_price_index: n_last12 and n_prior12 must be whole numbers, 0 or more';
  END IF;
  IF (jsonb_typeof(v_ch->'change_12m') = 'number') <> (jsonb_typeof(v_ch->'lo') = 'number')
     OR (jsonb_typeof(v_ch->'change_12m') = 'number') <> (jsonb_typeof(v_ch->'hi') = 'number') THEN
    RAISE EXCEPTION 'record_family_price_index: change_12m, lo and hi are all numbers or all null';
  END IF;
  IF jsonb_typeof(v_ch->'change_12m') = 'number' THEN
    v_mid := (v_ch->>'change_12m')::numeric; v_lo := (v_ch->>'lo')::numeric; v_hi := (v_ch->>'hi')::numeric;
    IF NOT (v_lo <= v_mid AND v_mid <= v_hi) THEN
      RAISE EXCEPTION 'record_family_price_index: the range must hold the estimate (lo %, change %, hi %)', v_lo, v_mid, v_hi;
    END IF;
    -- the verdict is read off the interval: a verdict its own interval contradicts is refused
    IF v_verdict = 'up' AND NOT (v_lo > 0) THEN
      RAISE EXCEPTION 'record_family_price_index: verdict up needs a range above zero (lo %)', v_lo;
    ELSIF v_verdict = 'down' AND NOT (v_hi < 0) THEN
      RAISE EXCEPTION 'record_family_price_index: verdict down needs a range below zero (hi %)', v_hi;
    ELSIF v_verdict = 'flat' AND NOT (v_lo <= 0 AND v_hi >= 0 AND (v_hi - v_lo) / 2 <= 0.05) THEN
      RAISE EXCEPTION 'record_family_price_index: verdict flat needs a range that holds zero and is within +-5 points (lo %, hi %)', v_lo, v_hi;
    ELSIF v_verdict = 'too few to tell' AND ((v_lo > 0 OR v_hi < 0) OR (v_hi - v_lo) / 2 <= 0.05) THEN
      RAISE EXCEPTION 'record_family_price_index: verdict too few to tell needs a range that holds zero and is wider than +-5 points (lo %, hi %)', v_lo, v_hi;
    END IF;
  ELSIF v_verdict <> 'too few to tell' THEN
    RAISE EXCEPTION 'record_family_price_index: verdict % needs change_12m, lo and hi', v_verdict;
  END IF;
  IF v_ch->'pairs' IS NOT NULL AND jsonb_typeof(v_ch->'pairs') <> 'null'
     AND (jsonb_typeof(v_ch->'pairs') <> 'number' OR (v_ch->>'pairs')::numeric < 0 OR (v_ch->>'pairs')::numeric <> trunc((v_ch->>'pairs')::numeric)) THEN
    RAISE EXCEPTION 'record_family_price_index: pairs must be a whole number, 0 or more, or null';
  END IF;
  IF (jsonb_typeof(v_ch->'rs_change') = 'number') <> (jsonb_typeof(v_ch->'rs_lo') = 'number')
     OR (jsonb_typeof(v_ch->'rs_change') = 'number') <> (jsonb_typeof(v_ch->'rs_hi') = 'number') THEN
    RAISE EXCEPTION 'record_family_price_index: rs_change, rs_lo and rs_hi are all numbers or all null';
  END IF;
  IF jsonb_typeof(v_ch->'rs_change') = 'number'
     AND NOT ((v_ch->>'rs_lo')::numeric <= (v_ch->>'rs_change')::numeric AND (v_ch->>'rs_change')::numeric <= (v_ch->>'rs_hi')::numeric) THEN
    RAISE EXCEPTION 'record_family_price_index: the repeat-sale range must hold its estimate';
  END IF;
  v_ref := coalesce(v_ch->'ref_car', '{}'::jsonb);
  IF jsonb_typeof(v_ref) <> 'object' THEN
    RAISE EXCEPTION 'record_family_price_index: ref_car must be an object';
  END IF;
  v_chips := coalesce(v_ch->'chips', '[]'::jsonb);
  IF jsonb_typeof(v_chips) <> 'array' OR jsonb_array_length(v_chips) > 30 THEN
    RAISE EXCEPTION 'record_family_price_index: chips must be an array of at most 30';
  END IF;
  FOR e IN SELECT x FROM jsonb_array_elements(v_chips) x LOOP
    IF jsonb_typeof(e) <> 'object'
       OR coalesce(btrim(e->>'kind'), '') = '' OR length(e->>'kind') > 40
       OR coalesce(btrim(e->>'key'), '') = '' OR length(e->>'key') > 120
       OR coalesce(btrim(e->>'label'), '') = '' OR length(e->>'label') > 120
       OR coalesce(e->>'verdict', '') NOT IN ('up', 'down', 'flat', 'too few to tell')
       OR jsonb_typeof(e->'n_last12') IS DISTINCT FROM 'number' OR jsonb_typeof(e->'n_prior12') IS DISTINCT FROM 'number'
       OR (e->>'n_last12')::numeric < 0 OR (e->>'n_prior12')::numeric < 0
       OR (jsonb_typeof(e->'change') = 'number') <> (jsonb_typeof(e->'lo') = 'number')
       OR (jsonb_typeof(e->'change') = 'number') <> (jsonb_typeof(e->'hi') = 'number') THEN
      RAISE EXCEPTION 'record_family_price_index: a chip needs kind, key, label, a verdict, n_last12 and n_prior12, and change, lo and hi all numbers or all null (got %)', left(e::text, 200);
    END IF;
    IF jsonb_typeof(e->'change') = 'number'
       AND NOT ((e->>'lo')::numeric <= (e->>'change')::numeric AND (e->>'change')::numeric <= (e->>'hi')::numeric) THEN
      RAISE EXCEPTION 'record_family_price_index: a chip''s range must hold its estimate (%)', e->>'key';
    END IF;
  END LOOP;

  -- the series
  v_series := coalesce(p_payload->'series', '[]'::jsonb);
  IF jsonb_typeof(v_series) <> 'array' OR jsonb_array_length(v_series) > 130 THEN
    RAISE EXCEPTION 'record_family_price_index: series must be an array of at most 130 periods';
  END IF;
  IF jsonb_array_length(v_series) > 0 THEN
    v_kind := p_payload->>'period_kind';
    IF v_kind IS NULL OR v_kind NOT IN ('month', 'quarter') THEN
      RAISE EXCEPTION 'record_family_price_index: period_kind must be month or quarter (got %)', v_kind;
    END IF;
    FOR e IN SELECT x FROM jsonb_array_elements(v_series) x LOOP
      IF jsonb_typeof(e) <> 'object' THEN
        RAISE EXCEPTION 'record_family_price_index: every period must be an object';
      END IF;
      BEGIN
        v_d := (e->>'period_start')::date;
      EXCEPTION WHEN others THEN
        v_d := NULL;
      END;
      IF v_d IS NULL THEN
        RAISE EXCEPTION 'record_family_price_index: a period has no valid period_start (%)', left(e::text, 200);
      END IF;
      IF date_trunc(v_kind, v_d)::date <> v_d THEN
        RAISE EXCEPTION 'record_family_price_index: period_start % is not the first day of a %', v_d, v_kind;
      END IF;
      IF v_d > current_date THEN
        RAISE EXCEPTION 'record_family_price_index: period_start % is in the future', v_d;
      END IF;
      IF v_d = ANY (v_seen) THEN
        RAISE EXCEPTION 'record_family_price_index: period_start % appears twice', v_d;
      END IF;
      v_seen := v_seen || v_d;
      IF jsonb_typeof(e->'index_usd') IS DISTINCT FROM 'number' OR jsonb_typeof(e->'lo_usd') IS DISTINCT FROM 'number'
         OR jsonb_typeof(e->'hi_usd') IS DISTINCT FROM 'number' OR jsonb_typeof(e->'n') IS DISTINCT FROM 'number'
         OR NOT ((e->>'lo_usd')::numeric > 0 AND (e->>'lo_usd')::numeric <= (e->>'index_usd')::numeric
                 AND (e->>'index_usd')::numeric <= (e->>'hi_usd')::numeric)
         OR (e->>'n')::numeric < 0 OR (e->>'n')::numeric <> trunc((e->>'n')::numeric)
         OR (jsonb_typeof(e->'raw_median_usd') = 'number' AND (e->>'raw_median_usd')::numeric <= 0)
         OR (jsonb_typeof(e->'raw_median_usd') NOT IN ('number', 'null') AND e->'raw_median_usd' IS NOT NULL) THEN
        RAISE EXCEPTION 'record_family_price_index: period % needs 0 < lo_usd <= index_usd <= hi_usd, a whole n, and a positive raw_median_usd or null', v_d;
      END IF;
    END LOOP;
  END IF;

  -- one writer per family at a time; never replace a newer fit with an older one
  PERFORM pg_advisory_xact_lock(hashtextextended(v_brand || '|' || v_key, 20261018));
  SELECT fitted_at INTO v_prev FROM public.family_price_change WHERE brand = v_brand AND family_key = v_key;
  IF v_prev IS NOT NULL AND v_fitted < v_prev THEN
    RAISE EXCEPTION 'record_family_price_index: fitted_at % is older than the stored fit %', v_fitted, v_prev;
  END IF;

  -- replace, never add to
  SELECT count(*) INTO v_old FROM public.family_price_index WHERE brand = v_brand AND family_key = v_key;
  DELETE FROM public.family_price_index WHERE brand = v_brand AND family_key = v_key;
  INSERT INTO public.family_price_index (brand, family_key, period_kind, period_start, index_usd, lo_usd, hi_usd, n, raw_median_usd, fitted_at)
  SELECT v_brand, v_key, v_kind, (x->>'period_start')::date, (x->>'index_usd')::numeric, (x->>'lo_usd')::numeric,
         (x->>'hi_usd')::numeric, (x->>'n')::integer,
         CASE WHEN jsonb_typeof(x->'raw_median_usd') = 'number' THEN (x->>'raw_median_usd')::numeric END, v_fitted
  FROM jsonb_array_elements(v_series) x;
  GET DIAGNOSTICS v_new = ROW_COUNT;
  INSERT INTO public.family_price_change (brand, family_key, change_12m, lo, hi, n_prior12, n_last12, verdict, method, ref_car, pairs,
                                          rs_change, rs_lo, rs_hi, chips, fitted_at)
  VALUES (v_brand, v_key,
          CASE WHEN jsonb_typeof(v_ch->'change_12m') = 'number' THEN (v_ch->>'change_12m')::numeric END,
          CASE WHEN jsonb_typeof(v_ch->'lo') = 'number' THEN (v_ch->>'lo')::numeric END,
          CASE WHEN jsonb_typeof(v_ch->'hi') = 'number' THEN (v_ch->>'hi')::numeric END,
          (v_ch->>'n_prior12')::integer, (v_ch->>'n_last12')::integer, v_verdict, v_ch->>'method', v_ref,
          CASE WHEN jsonb_typeof(v_ch->'pairs') = 'number' THEN (v_ch->>'pairs')::integer END,
          CASE WHEN jsonb_typeof(v_ch->'rs_change') = 'number' THEN (v_ch->>'rs_change')::numeric END,
          CASE WHEN jsonb_typeof(v_ch->'rs_lo') = 'number' THEN (v_ch->>'rs_lo')::numeric END,
          CASE WHEN jsonb_typeof(v_ch->'rs_hi') = 'number' THEN (v_ch->>'rs_hi')::numeric END,
          v_chips, v_fitted)
  ON CONFLICT (brand, family_key) DO UPDATE SET
    change_12m = EXCLUDED.change_12m, lo = EXCLUDED.lo, hi = EXCLUDED.hi, n_prior12 = EXCLUDED.n_prior12, n_last12 = EXCLUDED.n_last12,
    verdict = EXCLUDED.verdict, method = EXCLUDED.method, ref_car = EXCLUDED.ref_car, pairs = EXCLUDED.pairs,
    rs_change = EXCLUDED.rs_change, rs_lo = EXCLUDED.rs_lo, rs_hi = EXCLUDED.rs_hi, chips = EXCLUDED.chips, fitted_at = EXCLUDED.fitted_at;
  RETURN jsonb_build_object('brand', v_brand, 'family_key', v_key, 'fitted_at', v_fitted, 'verdict', v_verdict,
                            'series_replaced', v_old, 'series_written', v_new, 'chips', jsonb_array_length(v_chips));
END
$$;
COMMENT ON FUNCTION public.record_family_price_index(jsonb) IS
  'Writer of family_price_index and family_price_change: replaces one family''s rows in one call. Payload {brand, family_key, '
  'fitted_at, change:{change_12m, lo, hi, n_last12, n_prior12, verdict, method, ref_car, pairs, rs_change, rs_lo, rs_hi, chips}, '
  'period_kind, series:[{period_start, index_usd, lo_usd, hi_usd, n, raw_median_usd}]}. Refuses a fitted_at more than 5 minutes '
  'in the future or older than the stored fit, a verdict its own interval contradicts, and any malformed period or chip; a '
  'refusal changes nothing. service_role only. 2026-10-16.';
REVOKE ALL ON FUNCTION public.record_family_price_index(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_family_price_index(jsonb) TO service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- The anon reader
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.family_price_index_read(p_brand text, p_family_key text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH ch AS (
    SELECT * FROM public.family_price_change WHERE brand = p_brand AND family_key = p_family_key
  ), kind AS (
    SELECT period_kind FROM public.family_price_index WHERE brand = p_brand AND family_key = p_family_key
    GROUP BY period_kind ORDER BY (period_kind = 'month') DESC LIMIT 1
  ), cnt AS (
    SELECT count(*) FILTER (WHERE sale_date > current_date - 365) AS n_last12,
           count(*) FILTER (WHERE sale_date > current_date - 730 AND sale_date <= current_date - 365) AS n_prior12,
           count(*) AS n_total
    FROM public.mv_family_sales
    WHERE brand = p_brand AND family_key = p_family_key AND usd >= 500
      AND sale_date >= date '2016-01-01' AND sale_date <= current_date
  )
  SELECT jsonb_build_object(
    'brand', p_brand,
    'family_key', p_family_key,
    'as_of', now(),
    'fitted_at', (SELECT fitted_at FROM ch),
    'stale', coalesce((SELECT fitted_at < now() - interval '72 hours' FROM ch), false),
    'floor', jsonb_build_object('sales_each_year', 30, 'sales_total', 150, 'flat_within', 0.05, 'chip_sales_each_year', 15),
    'counts', (SELECT jsonb_build_object('n_last12', n_last12, 'n_prior12', n_prior12, 'n_total', n_total) FROM cnt),
    'change', (SELECT jsonb_build_object('change_12m', c.change_12m, 'lo', c.lo, 'hi', c.hi, 'n_last12', c.n_last12,
                                         'n_prior12', c.n_prior12, 'verdict', c.verdict, 'method', c.method, 'ref_car', c.ref_car,
                                         'pairs', c.pairs, 'rs_change', c.rs_change, 'rs_lo', c.rs_lo, 'rs_hi', c.rs_hi,
                                         'chips', c.chips)
               FROM ch c),
    'period_kind', (SELECT period_kind FROM kind),
    'series', coalesce((
      SELECT jsonb_agg(jsonb_build_object('period_start', i.period_start, 'index_usd', i.index_usd, 'lo_usd', i.lo_usd,
                                          'hi_usd', i.hi_usd, 'n', i.n, 'raw_median_usd', i.raw_median_usd)
                       ORDER BY i.period_start)
      FROM public.family_price_index i
      WHERE i.brand = p_brand AND i.family_key = p_family_key AND i.period_kind = (SELECT period_kind FROM kind)), '[]'::jsonb));
$$;
COMMENT ON FUNCTION public.family_price_index_read(text, text) IS
  'One family''s like-for-like price reading as one jsonb: {brand, family_key, as_of, fitted_at, stale, floor, counts, change, '
  'period_kind, series}. change is null when the family was not fitted (below the floor or not run yet); counts are live from '
  'mv_family_sales so a family that was never fitted still says why; stale is true when the fit is over 72 hours old; series is '
  'oldest first, at most 130 rows. Anon. 2026-10-16.';
REVOKE ALL ON FUNCTION public.family_price_index_read(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.family_price_index_read(text, text) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- The job's reads (service_role): bounded, one jsonb each
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.family_price_index_candidates()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH f AS (
    SELECT brand, family_key,
           count(*) AS n_total,
           count(*) FILTER (WHERE sale_date > current_date - 365) AS n_last12,
           count(*) FILTER (WHERE sale_date > current_date - 730 AND sale_date <= current_date - 365) AS n_prior12
    FROM public.mv_family_sales
    WHERE family_key <> 'other' AND usd >= 500 AND sale_date >= date '2016-01-01' AND sale_date <= current_date
    GROUP BY brand, family_key
    HAVING count(*) >= 50
  ), nm AS (
    SELECT brand, family_key, min(family) AS family FROM public.mv_family_market WHERE family_key <> 'other' GROUP BY brand, family_key
  )
  SELECT jsonb_build_object(
    'as_of', now(), 'today', current_date, 'since', date '2016-01-01',
    'columns', jsonb_build_array('brand', 'family_key', 'family', 'n_total', 'n_last12', 'n_prior12'),
    'rows', coalesce((SELECT jsonb_agg(jsonb_build_array(f.brand, f.family_key, nm.family, f.n_total, f.n_last12, f.n_prior12)
                                       ORDER BY f.n_total DESC, f.brand, f.family_key)
                      FROM f LEFT JOIN nm ON nm.brand = f.brand AND nm.family_key = f.family_key), '[]'::jsonb));
$$;
COMMENT ON FUNCTION public.family_price_index_candidates() IS
  'The named families with 50+ priced sales since 2016 and their window counts (every venue, usd >= 500, sale date up to today): '
  '{as_of, today, since, columns, rows [brand, family_key, family, n_total, n_last12, n_prior12]}. The nightly fit applies its '
  '30 / 30 / 150 floor to these. service_role only. 2026-10-16.';
REVOKE ALL ON FUNCTION public.family_price_index_candidates() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.family_price_index_candidates() TO service_role;

CREATE OR REPLACE FUNCTION public.family_price_index_inputs(p_brand text, p_family_key text, p_limit integer DEFAULT 15000)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH w AS (
    SELECT s.vehicle_id, s.model, s.year, s.source, s.usd, s.sale_date
    FROM public.mv_family_sales s
    WHERE s.brand = p_brand AND s.family_key = p_family_key AND s.family_key <> 'other' AND s.usd >= 500
      AND s.sale_date >= date '2016-01-01' AND s.sale_date <= current_date
  ), page AS (
    SELECT * FROM w ORDER BY sale_date DESC, vehicle_id LIMIT least(greatest(p_limit, 1), 20000)
  )
  SELECT jsonb_build_object(
    'today', current_date,
    'n', (SELECT count(*) FROM w),
    'returned', (SELECT count(*) FROM page),
    'truncated', (SELECT count(*) FROM w) > (SELECT count(*) FROM page),
    'columns', jsonb_build_array('vehicle_id', 'model', 'year', 'source', 'usd', 'sale_date'),
    'rows', coalesce((
      SELECT jsonb_agg(jsonb_build_array(p.vehicle_id, p.model, p.year, p.source, p.usd, p.sale_date) ORDER BY p.sale_date DESC, p.vehicle_id)
      FROM page p), '[]'::jsonb));
$$;
COMMENT ON FUNCTION public.family_price_index_inputs(text, text, integer) IS
  'One family''s priced sales since 2016 (mv_family_sales, usd >= 500, sale date up to today) as one jsonb {today, n, returned, '
  'truncated, columns, rows [vehicle_id, model, year, source, usd, sale_date]} newest first, at most p_limit (default 15,000, '
  'never over 20,000). The matview only; the vehicle''s mileage, transmission and title come from family_price_index_features(). '
  'One value, so the API''s 1,000-row cap does not apply. service_role only. 2026-10-16.';
REVOKE ALL ON FUNCTION public.family_price_index_inputs(text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.family_price_index_inputs(text, text, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.family_price_index_features(p_ids uuid[])
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH ids AS (
    SELECT DISTINCT x AS id FROM unnest(p_ids) x LIMIT 2000
  ), f AS MATERIALIZED (
    SELECT v.id, v.mileage, v.transmission, coalesce(v.bat_listing_title, v.listing_title, v.title) AS title
    FROM ids JOIN public.vehicles v ON v.id = ids.id
  )
  SELECT jsonb_build_object(
    'requested', coalesce(cardinality(p_ids), 0),
    'returned', (SELECT count(*) FROM f),
    'truncated', coalesce(cardinality(p_ids), 0) > 2000,
    'columns', jsonb_build_array('vehicle_id', 'mileage', 'transmission', 'title'),
    'rows', coalesce((SELECT jsonb_agg(jsonb_build_array(f.id, f.mileage, f.transmission, f.title) ORDER BY f.id) FROM f), '[]'::jsonb));
$$;
COMMENT ON FUNCTION public.family_price_index_features(uuid[]) IS
  'The vehicle''s mileage, transmission and listing title (the BaT title when there is one, else the listing title, else the title) '
  'for up to 2,000 vehicle ids, as one jsonb {requested, returned, truncated, columns, rows [vehicle_id, mileage, transmission, '
  'title]}. An id with no vehicle is left out. The nightly fit asks only for vehicles it has not read. service_role only. 2026-10-16.';
REVOKE ALL ON FUNCTION public.family_price_index_features(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.family_price_index_features(uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION public.family_price_index_pairs(p_brand text, p_family_key text, p_limit integer DEFAULT 20000)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH ids AS (
    SELECT vehicle_id FROM public.mv_family_sales
    WHERE brand = p_brand AND family_key = p_family_key AND family_key <> 'other'
      AND sale_date >= date '2016-01-01' AND sale_date <= current_date
  ), ev AS (
    SELECT e.vehicle_id, e.auction_end_date::date AS sale_date, e.winning_bid::numeric AS usd, e.source
    FROM public.auction_events e JOIN ids ON ids.vehicle_id = e.vehicle_id
    WHERE e.outcome = 'sold' AND e.winning_bid >= 500 AND e.auction_end_date >= date '2016-01-01'
      AND e.auction_end_date::date <= current_date
  ), rep AS (
    SELECT vehicle_id FROM ev GROUP BY vehicle_id HAVING count(*) >= 2
  ), page AS (
    SELECT ev.* FROM ev JOIN rep USING (vehicle_id) ORDER BY ev.vehicle_id, ev.sale_date, ev.usd LIMIT least(greatest(p_limit, 1), 20000)
  )
  SELECT jsonb_build_object(
    'n_vehicles', (SELECT count(*) FROM rep),
    'returned', (SELECT count(*) FROM page),
    'columns', jsonb_build_array('vehicle_id', 'sale_date', 'usd', 'source'),
    'rows', coalesce((SELECT jsonb_agg(jsonb_build_array(vehicle_id, sale_date, usd, source) ORDER BY vehicle_id, sale_date, usd) FROM page), '[]'::jsonb));
$$;
COMMENT ON FUNCTION public.family_price_index_pairs(text, text, integer) IS
  'The dated sold events (auction_events: outcome sold, a winning bid of 500 or more, an end date from 2016 to today) of the '
  'family''s vehicles that sold twice or more, as one jsonb {n_vehicles, returned, columns, rows [vehicle_id, sale_date, usd, '
  'source]}, at most p_limit (default 20,000): the repeat-sale check. mv_family_sales holds one sale per vehicle, so the pairs '
  'are read here. service_role only. 2026-10-16.';
REVOKE ALL ON FUNCTION public.family_price_index_pairs(text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.family_price_index_pairs(text, text, integer) TO service_role;

COMMIT;
