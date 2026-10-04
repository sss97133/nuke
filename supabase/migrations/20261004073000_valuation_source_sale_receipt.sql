-- Repair the existing cohort reader; no testimony writes, replay, new table or policy.
-- The original named arguments and response keys remain. Optional cutoffs/probe units
-- replace unsafe positive-price aggregates with a dated, source-qualified receipt.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- No catalog dependents were found for the old three-argument reader. A single
-- extended signature avoids ambiguous PostgREST overloads for existing callers.
DROP FUNCTION public.valuation_by_ymm(integer,text,text);
CREATE FUNCTION public.valuation_by_ymm(
  p_year integer DEFAULT NULL,
  p_make text DEFAULT NULL,
  p_model text DEFAULT NULL,
  p_event_before timestamptz DEFAULT NULL,
  p_event_from timestamptz DEFAULT NULL,
  p_evidence_as_of timestamptz DEFAULT NULL,
  p_currency text DEFAULT 'USD',
  p_price numeric DEFAULT NULL,
  p_subject_vehicle_id uuid DEFAULT NULL,
  p_knowledge_mode text DEFAULT 'retrospective'
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
SET timezone = 'UTC'
SET statement_timeout = '10s'
AS $function$
DECLARE
  v_before timestamptz := coalesce(p_event_before, statement_timestamp());
  v_from timestamptz;
  v_known timestamptz := coalesce(p_evidence_as_of, statement_timestamp());
  v_members uuid[];
  v_subject uuid;
  v_subject_count integer;
  v_result jsonb;
  v_subject_source_key text;
BEGIN
  v_from := coalesce(p_event_from, v_before - interval '36 months');
  IF nullif(btrim(p_make),'') IS NULL OR (p_year IS NULL AND nullif(btrim(p_model),'') IS NULL)
    OR NOT isfinite(v_from) OR NOT isfinite(v_before) OR NOT isfinite(v_known)
    OR v_from >= v_before OR v_before > statement_timestamp() OR v_known > statement_timestamp()
    OR p_currency NOT IN ('USD','EUR','GBP') OR p_currency IS NULL
    OR p_knowledge_mode NOT IN ('retrospective','known_at') OR p_knowledge_mode IS NULL
    OR (p_knowledge_mode='known_at' AND v_known>v_before)
    OR (p_price IS NOT NULL AND (p_price<=0 OR p_price::text IN ('NaN','Infinity','-Infinity')))
  THEN
    RETURN jsonb_build_object('error','Provide a make and year/model, valid past event/knowledge cutoffs, currency, and positive candidate price.','stats',NULL,'comparables','[]'::jsonb);
  END IF;

  SELECT lower(regexp_replace(regexp_replace(regexp_replace(f.source_url,'^https?://(www\.)?','','i'),'[?#].*$',''),'/+$',''))
    INTO v_subject_source_key
  FROM public.vehicles v JOIN public.vehicle_price_facts(ARRAY[p_subject_vehicle_id]) f ON f.vehicle_id=v.id
  WHERE v.id=p_subject_vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL
    AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item';

  -- Exact registered year membership when unambiguous; otherwise exact recorded
  -- make/model. Unsupported generation ranges never widen the comparison.
  SELECT count(*), (array_agg(subject_id ORDER BY subject_id))[1]
    INTO v_subject_count,v_subject
  FROM public.make_model_profiles
  WHERE grain='year' AND year=p_year AND lower(canonical_make)=lower(btrim(p_make))
    AND lower(canonical_model)=lower(btrim(p_model));
  IF v_subject_count=1 THEN
    SELECT array_agg(q.id ORDER BY q.id) INTO v_members FROM (
      SELECT v.id FROM public.cohort_members(v_subject) m JOIN public.vehicles v ON v.id=m.vehicle_id
      WHERE v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
      ORDER BY v.id LIMIT 10001
    ) q;
  ELSE
    SELECT array_agg(q.id ORDER BY q.id) INTO v_members FROM (
      SELECT v.id FROM public.vehicles v
      WHERE lower(v.make)=lower(btrim(p_make)) AND (p_year IS NULL OR v.year=p_year)
        AND (nullif(btrim(p_model),'') IS NULL OR lower(v.model)=lower(btrim(p_model)))
        AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
      ORDER BY v.id LIMIT 10001
    ) q;
  END IF;
  IF cardinality(v_members)>10000 THEN
    RETURN jsonb_build_object('error','Cohort exceeds the 10000-member reader boundary; narrow the year/model. No sampled percentile is returned.','stats',NULL,'comparables','[]'::jsonb,
      'coverage',jsonb_build_object('complete',false,'member_limit',10000,'members_at_least',10001));
  END IF;

  WITH cars AS MATERIALIZED (
    -- Definer is deliberate: snapshot raw data is admin-only. Every parent is
    -- explicitly public; only sanitized source evidence is returned below.
    SELECT v.id,v.year,v.make,v.model,v.body_style,v.engine_type,v.transmission,v.condition_rating,
      v.primary_image_url,v.origin_metadata->'bat_snapshot_parsed' AS parsed
    FROM public.vehicles v WHERE v.id=ANY(coalesce(v_members,'{}'::uuid[]))
      AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
  ), facts AS MATERIALIZED (
    SELECT c.*,f.sold_amount,f.sold_on,f.sold_basis,f.sold_amount_from,f.outcome,f.source_url,
      lower(regexp_replace(regexp_replace(regexp_replace(f.source_url,'^https?://(www\.)?','','i'),'[?#].*$',''),'/+$','')) AS source_key,
      CASE WHEN pg_input_is_valid(c.parsed->>'snapshot_id','uuid') THEN (c.parsed->>'snapshot_id')::uuid END AS snapshot_id
    FROM cars c LEFT JOIN public.vehicle_price_facts(coalesce(v_members,'{}'::uuid[])) f ON f.vehicle_id=c.id
  ), snapshots AS MATERIALIZED (
    -- Mutable vehicle metadata is a locator only. Identity, parse clock and
    -- source body come from the service-written, RLS-protected snapshot row.
    SELECT f.*,s.id AS found_snapshot_id,s.fetched_at,s.html_sha256 AS source_sha256,
      CASE WHEN s.metadata->>'parsed_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}.*(Z|[+-][0-9]{2}(:?[0-9]{2})?)$'
        AND pg_input_is_valid(s.metadata->>'parsed_at','timestamptz') THEN (s.metadata->>'parsed_at')::timestamptz END AS parsed_at,
      s.success IS TRUE AND s.http_status=200 AND s.platform='bat'
        AND s.metadata->>'vehicle_matched'='true'
        AND CASE WHEN pg_input_is_valid(s.metadata->>'vehicle_id','uuid') THEN (s.metadata->>'vehicle_id')::uuid END=f.id
        AND lower(regexp_replace(regexp_replace(regexp_replace(s.listing_url,'^https?://(www\.)?','','i'),'[?#].*$',''),'/+$',''))=f.source_key AS snapshot_matches,
      CASE WHEN octet_length(s.html)<=2097152 THEN s.html END AS source_html
    FROM facts f LEFT JOIN public.listing_page_snapshots s ON s.id=f.snapshot_id
  ), raw_sale AS MATERIALIZED (
    -- Same supported sale grammar as parseBaTHTML and parse_bat_snapshots_bulk.
    -- Re-read protected raw testimony; never promote mutable parsed values.
    -- Duplicate identical markup is one claim; incompatible sold/bid/units or
    -- dates are ambiguous. Unsupported entities/date formats remain unknown.
    SELECT s.*,r.claim_count,r.raw_currency,r.raw_price,r.raw_date,r.raw_status,
      regexp_match(r.raw_date,'^([0-9]{1,2})/([0-9]{1,2})/([0-9]{2}|[0-9]{4})$') AS date_parts
    FROM snapshots s LEFT JOIN LATERAL (
      SELECT count(DISTINCT concat_ws('|',lower(m[1]),upper(m[2]),m[3],m[4])) AS claim_count,
        min(upper(m[2])) AS raw_currency,min(m[3]) AS raw_price,min(m[4]) AS raw_date,
        min(CASE WHEN lower(m[1]) ~ '^sold' THEN 'sold' ELSE 'bid_to' END) AS raw_status
      FROM regexp_matches(CASE WHEN s.snapshot_matches IS TRUE THEN s.source_html END,
        '(Sold\s+for|Bid\s+to)\s+<strong>(\w+)\s*\$?([\d,]+)</strong>\s*<span[^>]*>on\s+(\d+/\d+/\d+)','ig') m
    ) r ON true
  ), evidence AS MATERIALIZED (
    SELECT r.*,greatest(r.parsed_at,r.fetched_at) AS known_at,r.raw_currency AS currency,
      pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(r.source_html,'UTF8')),'hex')=r.source_sha256 AS source_hash_matches,
      CASE WHEN raw_price ~ '^([0-9]{1,3}(,[0-9]{3})+|[0-9]+)$'
        AND pg_input_is_valid(replace(raw_price,',',''),'numeric') THEN replace(raw_price,',','')::numeric END AS source_amount,
      (r.date_parts[1]::integer=extract(month FROM r.sold_on)
        AND r.date_parts[2]::integer=extract(day FROM r.sold_on)
        AND (r.date_parts[3]=to_char(r.sold_on,'YYYY') OR r.date_parts[3]=to_char(r.sold_on,'YY'))) IS TRUE AS date_matches
    FROM raw_sale r
  ), classified AS MATERIALIZED (
    SELECT e.*,CASE
      WHEN id=p_subject_vehicle_id OR source_key=v_subject_source_key THEN 'subject'
      WHEN sold_basis IS NULL THEN 'outcome_not_sold'
      WHEN sold_amount IS NULL OR sold_amount<=0 OR sold_amount::text IN ('NaN','Infinity','-Infinity') THEN 'price_unknown'
      WHEN sold_on IS NULL OR NOT isfinite(sold_on) THEN 'event_unknown'
      -- Date-grain events must lie wholly inside the window. Same-day sales
      -- cannot be ordered before an intraday subject close and are excluded.
      WHEN sold_on::timestamptz<v_from OR (sold_on+1)::timestamptz>v_before THEN 'outside_event_window'
      WHEN source_url !~* '^https?://(www\.)?bringatrailer\.com/listing/[^/?#]+/?([?#].*)?$' OR source_url IS NULL THEN 'source_unknown'
      WHEN found_snapshot_id IS NULL OR snapshot_matches IS NOT TRUE THEN 'snapshot_unmatched'
      WHEN source_html IS NULL THEN 'source_body_unavailable_or_over_limit'
      WHEN source_hash_matches IS NOT TRUE THEN 'source_body_hash_unknown_or_conflicting'
      WHEN claim_count<>1 OR source_html ~* 'class=["''][^"'']*status-unsold' THEN 'source_sale_missing_or_ambiguous'
      WHEN currency IS NULL OR currency NOT IN ('USD','EUR','GBP') THEN 'currency_unknown'
      WHEN currency<>p_currency THEN 'different_currency'
      WHEN raw_status IS DISTINCT FROM 'sold' OR source_amount IS DISTINCT FROM sold_amount OR date_matches IS NOT TRUE THEN 'source_sale_conflict'
      WHEN parsed_at IS NULL OR fetched_at IS NULL OR fetched_at>parsed_at OR fetched_at<(sold_on::timestamptz) THEN 'clock_unknown_or_conflicting'
      WHEN known_at>v_known THEN 'learned_later'
      ELSE NULL END AS exclusion
    FROM evidence e
  ), source_groups AS MATERIALIZED (
    -- Disagreement within the declared event/knowledge boundary is unresolved.
    -- A later alias must not change an earlier evidence-as-of denominator.
    SELECT source_key,
      count(DISTINCT outcome) FILTER(WHERE outcome IN ('sold','reserve_not_met'))>1
      OR count(DISTINCT sold_amount) FILTER(WHERE sold_basis IS NOT NULL)>1
      OR count(DISTINCT sold_on) FILTER(WHERE sold_basis IS NOT NULL)>1
      OR count(DISTINCT currency) FILTER(WHERE sold_basis IS NOT NULL)>1 AS conflicting
    FROM classified WHERE source_key IS NOT NULL AND known_at<=v_known
      AND parsed_at IS NOT NULL AND fetched_at IS NOT NULL AND fetched_at<=parsed_at
      AND exclusion IS DISTINCT FROM 'outside_event_window'
      AND exclusion IS DISTINCT FROM 'subject'
    GROUP BY source_key
  ), coherent AS MATERIALIZED (
    SELECT c.* FROM classified c JOIN source_groups g USING(source_key)
    WHERE c.exclusion IS NULL AND NOT g.conflicting
  ), dedup AS MATERIALIZED (
    SELECT DISTINCT ON(source_key) * FROM coherent ORDER BY source_key,known_at,id
  ), totals AS (
    SELECT count(*) AS n, count(*) FILTER(WHERE sold_amount<p_price) AS below,
      count(*) FILTER(WHERE sold_amount=p_price) AS equal,
      percentile_cont(0.5) WITHIN GROUP(ORDER BY sold_amount) AS median,
      percentile_cont(0.1) WITHIN GROUP(ORDER BY sold_amount) AS p10,
      percentile_cont(0.9) WITHIN GROUP(ORDER BY sold_amount) AS p90,
      percentile_cont(0.25) WITHIN GROUP(ORDER BY sold_amount) AS p25,
      percentile_cont(0.75) WITHIN GROUP(ORDER BY sold_amount) AS p75,
      min(sold_amount) AS min,max(sold_amount) AS max,avg(sold_amount) AS avg,
      min(sold_on) AS first_sale,max(sold_on) AS last_sale
    FROM dedup
  ) SELECT jsonb_build_object(
    'query',jsonb_build_object('year',p_year,'make',p_make,'model',p_model),
    'stats',jsonb_build_object('sold_count',t.n,'median',CASE WHEN t.n>=10 THEN t.median END,
      'p10',CASE WHEN t.n>=10 THEN t.p10 END,'p90',CASE WHEN t.n>=10 THEN t.p90 END,
      'min',CASE WHEN t.n>=10 THEN t.min END,'max',CASE WHEN t.n>=10 THEN t.max END,'avg',CASE WHEN t.n>=10 THEN t.avg END,
      'first_sale',t.first_sale,'last_sale',t.last_sale,'avg_bid_count',NULL,'avg_comment_count',NULL),
    'comparables',coalesce((SELECT jsonb_agg(to_jsonb(d)) FROM (
      SELECT id AS vehicle_id,year,make,model,sold_amount AS sale_price,sold_on AS sale_date,
        'https://'||source_key||'/' AS bat_listing_url,NULL::text AS bat_listing_title,NULL::integer AS bid_count,NULL::integer AS comment_count
      FROM dedup ORDER BY sold_on DESC,source_key LIMIT 10) d),'[]'::jsonb),
    'receipt',jsonb_build_object('method','source_sale_price_midrank_v1','computed_at',statement_timestamp(),
      'quantile_method','continuous_linear_interpolation',
      'cohort',jsonb_build_object('key',coalesce(v_subject::text,concat_ws(':',p_make,p_model,p_year)),
        'label',concat_ws(' ',p_year,p_make,p_model),'basis',CASE WHEN v_subject_count=1 THEN 'registered_same_year_model_context' ELSE 'exact_recorded_year_model_context' END,
        'membership_as_of','current_recorded_membership_not_historical','complete',true),
      'event_from',v_from,'event_before',v_before,'evidence_as_of',v_known,'knowledge_mode',p_knowledge_mode,
      'knowledge_boundary','protected_source_receipt_clocks_only_not_historical_cohort_reconstruction',
      'currency',p_currency,'candidate_price',p_price,'price_basis','published_bid_excluding_fees',
      'price_basis_rule','bat_published_result_fee_separate_v1','price_basis_source','https://bringatrailer.com/policies/',
      'source_parser','batParser:1.0.0_sale_grammar_with_ambiguity_refusal','source_body_byte_limit',2097152,
      'price_adjustment','nominal_original_currency_no_fees_fx_or_inflation','condition_adjusted_assessment','unmeasured',
      'minimum_sales',10,'percentile',CASE WHEN t.n>=10 AND p_price IS NOT NULL THEN 100*(t.below+t.equal/2.0)/t.n END,
      'below',t.below,'equal',t.equal,'above',CASE WHEN p_price IS NOT NULL THEN t.n-t.below-t.equal END,
      'coverage',jsonb_build_object('member_rows',coalesce(cardinality(v_members),0),'dated_source_rows',(SELECT count(*) FROM classified WHERE sold_basis IS NOT NULL AND sold_amount>0 AND sold_on IS NOT NULL AND source_url ~* '^https?://(www\.)?bringatrailer\.com/listing/'),
        'qualified_sales',t.n,'duplicate_presentations',(SELECT count(*) FROM coherent)-t.n,'conflicting_source_lots',(SELECT count(*) FROM source_groups WHERE conflicting),
        'condition_scalar_recorded',(SELECT count(*) FROM dedup WHERE condition_rating IS NOT NULL),
        'body_recorded',(SELECT count(*) FROM dedup WHERE nullif(btrim(body_style),'') IS NOT NULL),
        'engine_recorded',(SELECT count(*) FROM dedup WHERE nullif(btrim(engine_type),'') IS NOT NULL),
        'transmission_recorded',(SELECT count(*) FROM dedup WHERE nullif(btrim(transmission),'') IS NOT NULL),
        'condition_visual_assessed',NULL,'comment_evidence_assessed',NULL,'bid_log_assessed',NULL),
      'exclusions',coalesce((SELECT jsonb_object_agg(exclusion,n) FROM (SELECT exclusion,count(*) AS n FROM classified WHERE exclusion IS NOT NULL GROUP BY exclusion) x),'{}'::jsonb),
      'eligible',coalesce((SELECT jsonb_agg(jsonb_build_object('vehicleId',id,'sourceUrl','https://'||source_key||'/','sourceKey',source_key,'amount',sold_amount,'outcome','sold',
        'eventAt',sold_on,'knownAt',known_at,'currency',currency,'priceBasis','published_bid_excluding_fees','unitSource','https://'||source_key||'/',
        'conditionEvidence','unknown','snapshotId',found_snapshot_id,'sourceSha256',source_sha256,'snapshotFetchedAt',fetched_at,'parsedAt',parsed_at,'sourceParser','batParser:1.0.0_sale_grammar_with_ambiguity_refusal','soldAmountFrom',sold_amount_from)
        ORDER BY sold_on,source_key) FROM dedup),'[]'::jsonb)
    )) INTO v_result FROM totals t;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.valuation_by_ymm(integer,text,text,timestamptz,timestamptz,timestamptz,text,numeric,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.valuation_by_ymm(integer,text,text,timestamptz,timestamptz,timestamptz,text,numeric,uuid,text) TO anon,authenticated,service_role;
COMMENT ON FUNCTION public.valuation_by_ymm(integer,text,text,timestamptz,timestamptz,timestamptz,text,numeric,uuid,text) IS
'Public-parent gated cohort sale-price reader, bounded to 10000 members with cap refusal. Existing price facts supply one current recorded sale per vehicle, not a transaction history. Eligibility requires sold/date/source plus independently reparsed raw HTML amount/date/status/currency from a referenced successful same-source, matched-vehicle protected snapshot. Mutable origin metadata is a locator only. Source event interval is inside event window; parsed/snapshot clocks precede knowledge cutoff. Full source-lot dedup/conflict checks; original units, no inflation/FX/buyer fee adjustment. Midrank=(below+equal/2)/N, minimum10 policy is not calibration. Condition/equipment unmatched; no over/under fair-value claim, historic condition or revisioned fleet assessment. Definer reads admin-only raw snapshot attribution but returns sanitized evidence for explicitly public/nondeleted real vehicle parents only; no policy grant or testimony write.';
NOTIFY pgrst,'reload schema';
COMMIT;
