-- S01 bounded retrospective prototype. Reuse valuation_by_ymm's qualified
-- source episodes, clocks, units, deduplication and population refusals.
-- Live 2026-10-07: no sale-residual/baseline table or registry owner; vein_runs
-- grades hypotheses, nuke_estimates is current vehicle state, v_residual is
-- the schema backlog. None owns this measure. See the accompanying pre-mint
-- memo. This reader earns the contract before persistent fold storage.
-- No testimony, estimates, registry coverage, jobs or permissions are changed.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.sale_residuals_by_ymm(
  p_year integer,
  p_make text,
  p_model text,
  p_month date,
  p_currency text DEFAULT 'USD'
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
SET timezone = 'UTC'
SET statement_timeout = '20s'
AS $function$
DECLARE
  v_at timestamptz := statement_timestamp();
  v_end timestamptz;
  v_from timestamptz;
  v_read jsonb;
  v_receipt jsonb;
  v_result jsonb;
BEGIN
  IF p_month IS NULL OR NOT isfinite(p_month)
     OR p_month <> date_trunc('month',p_month)::date
     OR p_month < date '1990-01-01'
     OR nullif(btrim(p_make),'') IS NULL
     OR nullif(btrim(p_model),'') IS NULL
     OR p_currency IS NULL OR p_currency NOT IN ('USD','EUR','GBP') THEN
    RETURN jsonb_build_object('error','Provide make, model, a first-of-month date since 1990, and USD/EUR/GBP.');
  END IF;
  v_end := p_month::timestamptz + interval '1 month';
  v_from := p_month::timestamptz - interval '36 months';
  IF v_end > v_at THEN
    RETURN jsonb_build_object('error','Only closed UTC months are eligible.');
  END IF;

  -- One bounded source-owner read covers the disjoint baseline and target
  -- windows. No candidate-price ranking and no current-vehicle-wide exclusion.
  v_read := public.valuation_by_ymm(p_year,p_make,p_model,v_end,v_from,
    v_at,p_currency,NULL,NULL,'retrospective');
  v_receipt := v_read->'receipt';
  IF v_read ? 'error' OR v_receipt IS NULL
     OR v_receipt#>>'{coverage,complete}' IS DISTINCT FROM 'true'
     OR v_receipt#>>'{cohort,complete}' IS DISTINCT FROM 'true'
     OR jsonb_typeof(v_receipt->'eligible') IS DISTINCT FROM 'array'
     OR v_receipt->>'currency' IS DISTINCT FROM p_currency
     OR v_receipt->>'price_basis' IS DISTINCT FROM 'published_bid_excluding_fees'
     OR v_receipt->>'knowledge_mode' IS DISTINCT FROM 'retrospective' THEN
    RETURN jsonb_build_object('error','Qualified source population unavailable or incompatible.',
      'source_error',v_read->'error','source_coverage',v_receipt->'coverage');
  END IF;
  -- Refuse a changed owner contract rather than silently weighting captures or
  -- mixing units. Native admission and source qualification remain its job.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_receipt->'eligible') e
    WHERE e->>'outcome' IS DISTINCT FROM 'sold'
      OR e->>'currency' IS DISTINCT FROM p_currency
      OR e->>'priceBasis' IS DISTINCT FROM 'published_bid_excluding_fees'
      OR nullif(e->>'sourceKey','') IS NULL
      OR nullif(e->>'vehicleId','') IS NULL
      OR nullif(e->>'snapshotId','') IS NULL
      OR nullif(e->>'knownAt','') IS NULL
      OR nullif(e->>'eventAt','') IS NULL
      OR (e->>'amount')::numeric IS NULL OR (e->>'amount')::numeric <= 0
      OR (e->>'amount')::numeric::text IN ('NaN','Infinity','-Infinity')
      OR NOT isfinite((e->>'eventAt')::date)
      OR (e->>'eventAt')::date < v_from::date
      OR (e->>'eventAt')::date >= v_end::date
      OR NOT isfinite((e->>'knownAt')::timestamptz)
      OR (e->>'knownAt')::timestamptz > v_at
  ) OR (SELECT count(*)<>count(DISTINCT e->>'sourceKey')
        FROM jsonb_array_elements(v_receipt->'eligible') e) THEN
    RETURN jsonb_build_object('error','Qualified source episode contract changed; no residual returned.');
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(v_receipt->'eligible') e
      WHERE (e->>'eventAt')::date >= p_month) > 500 THEN
    RETURN jsonb_build_object('error','Target month exceeds 500 qualified episodes; narrow the year/model.',
      'coverage',jsonb_build_object('complete',false,'target_limit',500));
  END IF;

  WITH episodes AS MATERIALIZED (
    SELECT e, (e->>'vehicleId')::uuid AS vehicle_id, e->>'sourceKey' AS source_key,
      (e->>'eventAt')::date AS event_day, (e->>'amount')::numeric AS amount
    FROM jsonb_array_elements(v_receipt->'eligible') e
  ), baseline AS (
    SELECT count(*) AS n,
      CASE WHEN count(*)>=10 THEN percentile_cont(0.5) WITHIN GROUP (ORDER BY amount)::numeric END AS median,
      min(event_day) AS first_day,max(event_day) AS last_day
    FROM episodes WHERE event_day < p_month
  ), sales AS MATERIALIZED (
    SELECT s.*,b.n AS baseline_n,b.median AS baseline_median,
      CASE WHEN b.median>0 THEN ln(s.amount/b.median) END AS log_residual,
      CASE WHEN g.scanned>100 THEN 'location_scan_limit'
           WHEN g.n=0 THEN 'same_listing_county_missing'
           WHEN g.counties>1 THEN 'same_listing_county_conflict'
           ELSE 'same_listing_county' END AS geography_status,
      CASE WHEN g.scanned<=100 AND g.counties=1 THEN g.county END AS county_fips,
      CASE WHEN g.scanned<=100 AND g.counties=1 THEN g.ids ELSE '[]'::jsonb END AS location_observation_ids
    FROM episodes s CROSS JOIN baseline b
    CROSS JOIN LATERAL (
      -- Indexed vehicle lookup with an explicit per-vehicle cap, including
      -- unmatched rows. Never choose the latest county from another episode.
      SELECT count(*) AS scanned,count(*) FILTER(WHERE matched) AS n,
        count(DISTINCT county_fips) FILTER(WHERE matched) AS counties,
        min(county_fips) FILTER(WHERE matched) AS county,
        coalesce(jsonb_agg(id ORDER BY id) FILTER(WHERE matched),'[]'::jsonb) AS ids
      FROM (
        SELECT l.id,l.county_fips,
          (l.source_type='listing' AND l.confidence>=0.5
            AND l.country_code='US' AND l.created_at<=v_at AND l.observed_at<=v_at
            AND l.source_url ~* '^https?://(www\.)?bringatrailer\.com/listing/[a-z0-9-]+/?([?#].*)?$'
            AND lower(regexp_replace(regexp_replace(regexp_replace(l.source_url,
              '^https?://(www\.)?','','i'),'[?#].*$',''),'/+$',''))=s.source_key
            AND EXISTS(SELECT 1 FROM public.us_county_boundaries c WHERE c.fips=l.county_fips)
          ) IS TRUE AS matched
        FROM (SELECT * FROM public.vehicle_location_observations
              WHERE vehicle_id=s.vehicle_id ORDER BY observed_at DESC,id LIMIT 101) l
      ) candidates
    ) g
    WHERE s.event_day>=p_month
  ), counties AS (
    SELECT county_fips,count(*) AS n,
      percentile_cont(0.5) WITHIN GROUP(ORDER BY log_residual) AS median_log_residual,
      percentile_cont(0.75) WITHIN GROUP(ORDER BY log_residual)
        - percentile_cont(0.25) WITHIN GROUP(ORDER BY log_residual) AS iqr_log_residual,
      count(*) FILTER(WHERE log_residual>0)::numeric/count(*) AS share_above_baseline
    FROM sales WHERE county_fips IS NOT NULL AND log_residual IS NOT NULL
    GROUP BY county_fips
  ) SELECT jsonb_build_object(
    'method','sale_residual_month_start_v1','computed_at',v_at,
    'status',CASE WHEN b.n<10 THEN 'insufficient_baseline' ELSE 'computed' END,
    'query',v_read->'query','month',p_month,'event_before',v_end,'evidence_as_of',v_at,
    'knowledge_mode','retrospective',
    'historical_claim','event_window_only_current_membership_and_later_evidence_not_a_known_at_backtest',
    'currency',p_currency,'price_basis','published_bid_excluding_fees',
    'cohort',v_receipt->'cohort',
    'baseline',jsonb_build_object('event_from',v_from,'event_before',p_month::timestamptz,
      'n',b.n,'minimum_sales',10,'median',b.median,'first_sale',b.first_day,'last_sale',b.last_day,
      'method','prior_36_month_source_episode_median_at_month_start'),
    'geography_basis','same_source_listing_current_county_key_not_verified_sale_time_location',
    'coverage',jsonb_build_object('qualified_target_sales',(SELECT count(*) FROM sales),
      'residuals',(SELECT count(log_residual) FROM sales),
      'county_keyed_sales',(SELECT count(county_fips) FROM sales),
      'county_residuals',(SELECT count(*) FROM sales WHERE county_fips IS NOT NULL AND log_residual IS NOT NULL),
      'source_population_complete',true,'market_coverage','unknown',
      'geography_exclusions',coalesce((SELECT jsonb_object_agg(geography_status,n) FROM
        (SELECT geography_status,count(*) n FROM sales WHERE geography_status<>'same_listing_county' GROUP BY 1) x),'{}'::jsonb)),
    'sales',coalesce((SELECT jsonb_agg(jsonb_build_object('source_key',source_key,
      'vehicle_id',vehicle_id,'event_day',event_day,'amount',amount,'log_residual',log_residual,
      'snapshot_id',e->'snapshotId','known_at',e->'knownAt',
      'county_fips',county_fips,'geography_status',geography_status,
      'location_observation_ids',location_observation_ids) ORDER BY event_day,source_key) FROM sales),'[]'::jsonb),
    'counties',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY county_fips) FROM counties c),'[]'::jsonb),
    'sell_through',NULL,'sell_through_reason','qualified_sold_and_unsold_episode_denominator_not_established',
    'days_to_sale',NULL,'days_to_sale_reason','exposure_start_and_close_clocks_not_established',
    'source_receipt',v_receipt
  ) INTO v_result FROM baseline b;
  RETURN v_result;
END
$function$;
REVOKE ALL ON FUNCTION public.sale_residuals_by_ymm(integer,text,text,date,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sale_residuals_by_ymm(integer,text,text,date,text) TO service_role;
COMMENT ON FUNCTION public.sale_residuals_by_ymm(integer,text,text,date,text) IS
'S01 bounded retrospective source-sale residual prototype. Grain: one qualified source episode within one closed UTC month and current cohort; baseline is the median of qualified same-unit sales in the prior 36 months, minimum10. One valuation_by_ymm read owns source qualification, deduplication, clocks and current public membership; ln(sold/baseline), no FX, fees, condition or inflation adjustment. Same-vehicle resales remain distinct. At most500 target episodes, at most101 inspected location rows per vehicle; overflow and conflicting same-listing counties withhold geography. County is a current key on same-source listing testimony, NOT verified location at sale or known-at geography. Source receipt retained. Missing sell-through and exposure clocks stay NULL. Service-role-only SECURITY INVOKER; no writes, schedules, persistent fold or historical backtest claim. Consumer: bounded S01 operator assay; persistence/replay follow only after this contract is proved.';
NOTIFY pgrst,'reload schema';
COMMIT;
