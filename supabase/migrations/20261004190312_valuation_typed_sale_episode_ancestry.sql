-- Extend the existing source-price reader with the canonical nullable sale-event edge.
-- No testimony write, historical admission, new endpoint, grant or worker.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.valuation_by_ymm(
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
      v.primary_image_url,v.origin_metadata#>>'{bat_snapshot_parsed,snapshot_id}' AS snapshot_locator
    FROM public.vehicles v WHERE v.id=ANY(coalesce(v_members,'{}'::uuid[]))
      AND v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
  ), facts AS MATERIALIZED (
    SELECT c.*,f.sold_amount,f.sold_on,f.sold_basis,f.sold_amount_from,f.outcome,f.source_url,
      lower(regexp_replace(regexp_replace(regexp_replace(f.source_url,'^https?://(www\.)?','','i'),'[?#].*$',''),'/+$','')) AS source_key,
      CASE WHEN pg_input_is_valid(c.snapshot_locator,'uuid') THEN (c.snapshot_locator)::uuid END AS snapshot_id
    FROM cars c LEFT JOIN public.vehicle_price_facts(coalesce(v_members,'{}'::uuid[])) f ON f.vehicle_id=c.id
  ), capture_refs AS MATERIALIZED (
    -- Cheap selector IDs only. The typed source FK remains a durable locator
    -- after mutable current metadata advances. Full custody/admission checks
    -- below determine evidence; no badge supplies a source price or clock.
    SELECT refs.id,refs.snapshot_id,array_agg(refs.admission_id ORDER BY refs.admission_id)
      FILTER(WHERE refs.admission_id IS NOT NULL) AS admission_ids
    FROM (
      SELECT f.id,f.snapshot_id,NULL::uuid AS admission_id FROM facts f WHERE f.snapshot_id IS NOT NULL
      UNION ALL
      SELECT f.id,o.source_snapshot_id,o.id FROM facts f
      JOIN public.vehicle_observations o ON o.vehicle_id=f.id AND o.kind='sale_result'
      JOIN public.observation_sources os ON os.id=o.source_id AND os.slug='bat'
      WHERE o.source_snapshot_id IS NOT NULL AND o.is_superseded IS FALSE
        AND o.extraction_method='protected_archived_sale_observation_v1' AND o.extractor_id IS NULL
        AND o.structured_data#>>'{source_sale_receipt,method}'='protected_archived_sale_observation_v1'
        AND o.structured_data#>>'{source_sale_receipt,verification_basis}'='producer_attested_archived_hash_parser'
        AND o.structured_data#>>'{source_sale_receipt,parser}' IN ('batParser:1.0.0_sale_grammar_with_ambiguity_refusal','batParser:1.0.0:strict_sale_tuple_v1')
        AND o.source_identifier='archived-sale:'||o.source_snapshot_id::text||':'||(o.structured_data#>>'{source_sale_receipt,parser}')
        AND o.raw_source_ref='listing_page_snapshots:'||o.source_snapshot_id::text
        AND lower(regexp_replace(regexp_replace(regexp_replace(o.source_url,'^https?://(www\.)?','','i'),'[?#].*$',''),'/+$',''))=f.source_key
        -- Future derived arrivals do not consume an earlier knowledge cap.
        AND o.ingested_at IS NOT NULL AND isfinite(o.ingested_at) AND o.ingested_at<=v_known
    ) refs JOIN facts f ON f.id=refs.id
    LEFT JOIN public.listing_page_snapshots cutoff ON cutoff.id=refs.snapshot_id
    -- Matched future source headers are not earlier knowledge. This reads
    -- identity/clocks only, before the sentinel and any raw HTML projection.
    WHERE (cutoff.success IS TRUE AND cutoff.http_status=200 AND cutoff.platform='bat'
      AND cutoff.metadata->>'vehicle_matched'='true'
      AND CASE WHEN pg_input_is_valid(cutoff.metadata->>'vehicle_id','uuid') THEN (cutoff.metadata->>'vehicle_id')::uuid END=refs.id
      AND lower(regexp_replace(regexp_replace(regexp_replace(cutoff.listing_url,'^https?://(www\.)?','','i'),'[?#].*$',''),'/+$',''))=f.source_key
      AND (isfinite(cutoff.fetched_at) AND cutoff.fetched_at>v_known
        OR isfinite(cutoff.created_at) AND cutoff.created_at>v_known
        OR CASE WHEN cutoff.metadata->>'parsed_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}.*(Z|[+-][0-9]{2}(:?[0-9]{2})?)$'
          AND pg_input_is_valid(cutoff.metadata->>'parsed_at','timestamptz')
          THEN isfinite((cutoff.metadata->>'parsed_at')::timestamptz) AND (cutoff.metadata->>'parsed_at')::timestamptz>v_known ELSE false END)) IS NOT TRUE
    GROUP BY refs.id,refs.snapshot_id ORDER BY refs.id,refs.snapshot_id LIMIT 10001
  ), snapshots AS MATERIALIZED (
    -- Both selected captures retain raw/custody/conflict checks. Available bad
    -- inline HTML on a capture cannot use its archived receipt as a fallback.
    SELECT f.id,f.year,f.make,f.model,f.body_style,f.engine_type,f.transmission,f.condition_rating,f.primary_image_url,
      f.sold_amount,f.sold_on,f.sold_basis,f.sold_amount_from,f.outcome,f.source_url,f.source_key,refs.snapshot_id,
      s.id AS found_snapshot_id,s.fetched_at,s.created_at AS source_ingested_at,s.html_sha256 AS source_sha256,
      CASE WHEN s.metadata->>'parsed_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}.*(Z|[+-][0-9]{2}(:?[0-9]{2})?)$'
        AND pg_input_is_valid(s.metadata->>'parsed_at','timestamptz') THEN (s.metadata->>'parsed_at')::timestamptz END AS parsed_at,
      s.success IS TRUE AND s.http_status=200 AND s.platform='bat'
        AND s.metadata->>'vehicle_matched'='true'
        AND CASE WHEN pg_input_is_valid(s.metadata->>'vehicle_id','uuid') THEN (s.metadata->>'vehicle_id')::uuid END=f.id
        AND lower(regexp_replace(regexp_replace(regexp_replace(s.listing_url,'^https?://(www\.)?','','i'),'[?#].*$',''),'/+$',''))=f.source_key AS snapshot_matches,
      CASE WHEN refs.snapshot_id IS NOT NULL AND octet_length(s.html)<=2097152 THEN s.html END AS source_html,
      s.html IS NOT NULL AS inline_body_present,CASE WHEN s.html IS NULL THEN a.receipt END AS admitted_receipt,
      a.id AS derived_observation_id,a.ingested_at AS derived_ingested_at,
      a.source_vehicle_event_id,a.native_context_matches,a.receipt->>'parser' AS admission_parser
    FROM facts f LEFT JOIN capture_refs refs ON refs.id=f.id
    -- With no knowable selector, retain only current header classification.
    LEFT JOIN public.listing_page_snapshots s ON s.id=coalesce(refs.snapshot_id,f.snapshot_id)
    LEFT JOIN LATERAL (
      -- Only the service-only canonical intake derives this immutable method.
      -- JSON source pointers are checked against exact protected identity and
      -- clocks; old metadata qualifications are never accepted as evidence.
      SELECT o.id,o.ingested_at,o.structured_data->'source_sale_receipt' AS receipt,
        o.source_vehicle_event_id,
        CASE WHEN o.source_vehicle_event_id IS NULL THEN true ELSE
          native.id IS NOT NULL AND native.vehicle_id=f.id AND native.source_platform='bat'
          AND jsonb_typeof(o.extraction_metadata->'source_episode_context')='object'
          AND o.extraction_metadata->'source_episode_context' ?& ARRAY['id','vehicle_id','source_platform','source_url',
            'source_listing_id','event_type','event_status','final_price','sold_at','ended_at','created_at','updated_at','extracted_at']
          AND native.id::text=ec->>'id' AND native.vehicle_id::text=ec->>'vehicle_id'
          AND native.source_platform IS NOT DISTINCT FROM ec->>'source_platform'
          AND native.source_url IS NOT DISTINCT FROM ec->>'source_url'
          AND native.source_listing_id IS NOT DISTINCT FROM ec->>'source_listing_id'
          AND native.event_type IS NOT DISTINCT FROM ec->>'event_type'
          AND native.event_status IS NOT DISTINCT FROM ec->>'event_status'
          AND (ec->'final_price'='null'::jsonb OR pg_input_is_valid(ec->>'final_price','numeric'))
          AND native.final_price IS NOT DISTINCT FROM CASE WHEN pg_input_is_valid(ec->>'final_price','numeric') THEN (ec->>'final_price')::numeric END
          AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY['sold_at','ended_at','created_at','updated_at','extracted_at']) k
            WHERE ec->k IS DISTINCT FROM 'null'::jsonb AND
              (ec->>k IS NULL OR ec->>k !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}.*(Z|[+-][0-9]{2}(:?[0-9]{2})?)$'
                OR NOT pg_input_is_valid(ec->>k,'timestamptz')))
          AND native.sold_at IS NOT DISTINCT FROM CASE WHEN pg_input_is_valid(ec->>'sold_at','timestamptz') THEN (ec->>'sold_at')::timestamptz END
          AND native.ended_at IS NOT DISTINCT FROM CASE WHEN pg_input_is_valid(ec->>'ended_at','timestamptz') THEN (ec->>'ended_at')::timestamptz END
          AND native.created_at IS NOT DISTINCT FROM CASE WHEN pg_input_is_valid(ec->>'created_at','timestamptz') THEN (ec->>'created_at')::timestamptz END
          AND native.updated_at IS NOT DISTINCT FROM CASE WHEN pg_input_is_valid(ec->>'updated_at','timestamptz') THEN (ec->>'updated_at')::timestamptz END
          AND native.extracted_at IS NOT DISTINCT FROM CASE WHEN pg_input_is_valid(ec->>'extracted_at','timestamptz') THEN (ec->>'extracted_at')::timestamptz END
        END AS native_context_matches
      FROM (
        -- Canonical ID lookups avoid rescanning a vehicle's observation family
        -- for every retained capture. Metadata-only locators use the existing
        -- vehicle/source/kind path, including later arrival classification.
        SELECT matched.* FROM unnest(refs.admission_ids) admission_id
          JOIN public.vehicle_observations matched ON matched.id=admission_id
        UNION ALL
        SELECT located.* FROM public.vehicle_observations located
          WHERE refs.admission_ids IS NULL AND located.vehicle_id=f.id AND located.kind='sale_result'
      ) o JOIN public.observation_sources os ON os.id=o.source_id AND os.slug='bat'
      CROSS JOIN LATERAL (SELECT o.structured_data->'source_sale_receipt' AS r,
        o.extraction_metadata->'source_episode_context' AS ec) q
      LEFT JOIN public.vehicle_events native ON native.id=o.source_vehicle_event_id
      WHERE refs.snapshot_id IS NOT NULL AND (s.html IS NULL OR o.source_vehicle_event_id IS NOT NULL)
        AND (s.html IS NOT NULL OR (nullif(s.html_storage_path,'') IS NOT NULL
          AND s.html_storage_path !~ '(^/|(^|/)\.\.?(/|$)|[:\\\x00-\x1f])'))
        AND o.vehicle_id=f.id AND o.source_snapshot_id=s.id AND o.kind='sale_result' AND o.is_superseded IS FALSE
        AND o.extraction_method='protected_archived_sale_observation_v1'
        -- Extractor identity is an unmeasured nullable UUID, never a method slug.
        AND o.extractor_id IS NULL
        AND o.raw_source_ref='listing_page_snapshots:'||s.id::text
        AND o.source_identifier='archived-sale:'||s.id::text||':'||(r->>'parser')
        AND r->>'method'='protected_archived_sale_observation_v1'
        AND r->>'verification_basis'='producer_attested_archived_hash_parser'
        AND r->>'snapshot_id'=s.id::text AND r->>'vehicle_id'=f.id::text
        AND r->>'source_url'='https://'||f.source_key||'/'
        AND lower(regexp_replace(regexp_replace(regexp_replace(o.source_url,'^https?://(www\.)?','','i'),'[?#].*$',''),'/+$',''))=f.source_key
        AND r->>'source_sha256'=lower(s.html_sha256) AND s.html_sha256 ~* '^[0-9a-f]{64}$'
        AND r->>'parser' IN ('batParser:1.0.0_sale_grammar_with_ambiguity_refusal','batParser:1.0.0:strict_sale_tuple_v1')
        AND r->>'body_source'=CASE WHEN s.html IS NULL THEN 'protected_storage' ELSE 'inline' END
        AND CASE WHEN r->>'byte_length' ~ '^[0-9]+$' AND pg_input_is_valid(r->>'byte_length','integer')
          THEN (r->>'byte_length')::integer BETWEEN 1 AND 2097152 ELSE false END
        AND r->>'amount' ~ '^[0-9]+$' AND CASE WHEN pg_input_is_valid(r->>'amount','numeric') THEN (r->>'amount')::numeric>0 ELSE false END
        AND r->>'currency' IN ('USD','EUR','GBP') AND r->>'outcome'='sold' AND r->>'event_grain'='date'
        AND r->>'event_day' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND pg_input_is_valid(r->>'event_day','date')
        AND CASE WHEN pg_input_is_valid(r->>'event_day','date') THEN o.observed_at=(r->>'event_day')::date::timestamptz ELSE false END
        AND r->>'price_basis'='published_bid_excluding_fees'
        AND r->>'price_basis_rule'='bat_published_result_fee_separate_v1'
        AND r->>'price_basis_source'='https://bringatrailer.com/policies/'
        AND r->>'captured_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}.*(Z|[+-][0-9]{2}(:?[0-9]{2})?)$'
        AND r->>'source_ingested_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}.*(Z|[+-][0-9]{2}(:?[0-9]{2})?)$'
        AND r->>'original_parsed_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}.*(Z|[+-][0-9]{2}(:?[0-9]{2})?)$'
        AND r->>'source_known_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}.*(Z|[+-][0-9]{2}(:?[0-9]{2})?)$'
        AND CASE WHEN pg_input_is_valid(r->>'captured_at','timestamptz') THEN (r->>'captured_at')::timestamptz=s.fetched_at ELSE false END
        AND CASE WHEN pg_input_is_valid(r->>'source_ingested_at','timestamptz') THEN (r->>'source_ingested_at')::timestamptz=s.created_at ELSE false END
        AND CASE WHEN pg_input_is_valid(r->>'original_parsed_at','timestamptz') AND pg_input_is_valid(s.metadata->>'parsed_at','timestamptz')
          THEN (r->>'original_parsed_at')::timestamptz=(s.metadata->>'parsed_at')::timestamptz ELSE false END
        AND CASE WHEN pg_input_is_valid(r->>'source_known_at','timestamptz') AND pg_input_is_valid(s.metadata->>'parsed_at','timestamptz')
          THEN (r->>'source_known_at')::timestamptz=greatest(s.fetched_at,s.created_at,(s.metadata->>'parsed_at')::timestamptz) ELSE false END
        AND o.ingested_at IS NOT NULL AND isfinite(o.ingested_at) AND o.ingested_at<=v_known
      ORDER BY o.ingested_at,o.id LIMIT 1
    ) a ON true
    -- A sentinel refuses before materializing/toasting any source HTML.
    WHERE (SELECT count(*) FROM capture_refs)<=10000
  ), raw_sale AS MATERIALIZED (
    -- Same supported sale grammar as parseBaTHTML and parse_bat_snapshots_bulk.
    -- Inline captures re-read raw testimony. Only absent offloaded bodies may
    -- use an exact canonically admitted receipt; never mutable parsed values.
    -- Duplicate identical markup is one claim; incompatible sold/bid/units or
    -- dates are ambiguous. Unsupported entities/date formats remain unknown.
    SELECT s.id,s.year,s.make,s.model,s.body_style,s.engine_type,s.transmission,s.condition_rating,s.primary_image_url,s.sold_amount,s.sold_on,s.sold_basis,s.sold_amount_from,s.outcome,s.source_url,s.source_key,s.snapshot_id,s.found_snapshot_id,s.fetched_at,s.source_ingested_at,s.source_sha256,s.parsed_at,s.snapshot_matches,s.derived_observation_id,s.derived_ingested_at,s.source_vehicle_event_id,s.native_context_matches,s.admission_parser,
      CASE WHEN s.source_html IS NULL AND s.derived_observation_id IS NOT NULL THEN 'producer_attested_archived_hash_parser' ELSE 'per_read_inline_hash_parser' END AS source_verification,
      s.source_html IS NOT NULL OR s.derived_observation_id IS NOT NULL AS source_html_available,
      CASE WHEN s.inline_body_present THEN pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(s.source_html,'UTF8')),'hex')=s.source_sha256
        ELSE s.derived_observation_id IS NOT NULL END AS source_hash_matches,
      s.source_html ~* 'class=["''][^"'']*status-unsold' AS raw_unsold,
      CASE WHEN s.source_html IS NULL AND s.derived_observation_id IS NOT NULL THEN 1 ELSE r.claim_count END AS claim_count,
      coalesce(s.admitted_receipt->>'currency',r.raw_currency) AS raw_currency,
      coalesce(s.admitted_receipt->>'amount',r.raw_price) AS raw_price,
      r.raw_date,coalesce(s.admitted_receipt->>'outcome',r.raw_status) AS raw_status,
      s.admitted_receipt->>'event_day' AS admitted_day,
      regexp_match(r.raw_date,'^([0-9]{1,2})/([0-9]{1,2})/([0-9]{2}|[0-9]{4})$') AS date_parts
    FROM snapshots s LEFT JOIN LATERAL (
      SELECT count(DISTINCT concat_ws('|',lower(m[1]),upper(m[2]),m[3],m[4])) AS claim_count,
        min(upper(m[2])) AS raw_currency,min(m[3]) AS raw_price,min(m[4]) AS raw_date,
        min(CASE WHEN lower(m[1]) ~ '^sold' THEN 'sold' ELSE 'bid_to' END) AS raw_status
      FROM regexp_matches(CASE WHEN s.snapshot_matches IS TRUE THEN s.source_html END,
        '(Sold\s+for|Bid\s+to)\s+<strong>(\w+)\s*\$?([\d,]+)</strong>\s*<span[^>]*>on\s+(\d+/\d+/\d+)','ig') m
    ) r ON true
  ), source_fields AS MATERIALIZED (
    SELECT r.*,greatest(r.parsed_at,r.fetched_at,r.source_ingested_at,r.derived_ingested_at) AS known_at,r.raw_currency AS currency,
      CASE WHEN raw_price ~ '^([0-9]{1,3}(,[0-9]{3})+|[0-9]+)$'
        AND pg_input_is_valid(replace(raw_price,',',''),'numeric') THEN replace(raw_price,',','')::numeric END AS source_amount,
      CASE WHEN r.admitted_day IS NOT NULL THEN r.admitted_day::date
        WHEN pg_input_is_valid(concat(
        CASE WHEN length(date_parts[3])=2 THEN '20'||date_parts[3] ELSE date_parts[3] END,
        '-',date_parts[1],'-',date_parts[2]),'date') THEN concat(
        CASE WHEN length(date_parts[3])=2 THEN '20'||date_parts[3] ELSE date_parts[3] END,
        '-',date_parts[1],'-',date_parts[2])::date END AS source_day
    FROM raw_sale r
  ), evidence AS MATERIALIZED (
    SELECT r.*,(r.source_day=r.sold_on) IS TRUE AS date_matches FROM source_fields r
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
      -- A protected future header is excluded without reading its HTML.
      WHEN known_at>v_known AND parsed_at IS NOT NULL AND fetched_at IS NOT NULL AND source_ingested_at IS NOT NULL
        AND isfinite(parsed_at) AND isfinite(fetched_at) AND isfinite(source_ingested_at)
        AND fetched_at<=parsed_at AND fetched_at>=sold_on::timestamptz THEN 'learned_later'
      WHEN source_html_available IS NOT TRUE THEN 'source_body_unavailable_or_over_limit'
      WHEN source_hash_matches IS NOT TRUE THEN 'source_body_hash_unknown_or_conflicting'
      WHEN source_vehicle_event_id IS NOT NULL AND native_context_matches IS NOT TRUE THEN 'source_episode_context_changed'
      WHEN claim_count<>1 OR raw_unsold IS TRUE THEN 'source_sale_missing_or_ambiguous'
      WHEN currency IS NULL OR currency NOT IN ('USD','EUR','GBP') THEN 'currency_unknown'
      WHEN currency<>p_currency THEN 'different_currency'
      WHEN raw_status IS DISTINCT FROM 'sold' OR source_amount IS DISTINCT FROM sold_amount OR date_matches IS NOT TRUE THEN 'source_sale_conflict'
      WHEN parsed_at IS NULL OR fetched_at IS NULL OR source_ingested_at IS NULL
        OR NOT isfinite(parsed_at) OR NOT isfinite(fetched_at) OR NOT isfinite(source_ingested_at)
        OR fetched_at>parsed_at OR fetched_at<(sold_on::timestamptz) THEN 'clock_unknown_or_conflicting'
      ELSE NULL END AS exclusion
    FROM evidence e
  ), source_groups AS MATERIALIZED (
    -- Disagreement within the declared event/knowledge boundary is unresolved.
    -- A later alias must not change an earlier evidence-as-of denominator.
    SELECT source_key,count(DISTINCT raw_status)>1 OR count(DISTINCT source_amount)>1
      OR count(DISTINCT source_day)>1 OR count(DISTINCT currency)>1 AS conflicting
    FROM classified WHERE source_key IS NOT NULL AND snapshot_matches IS TRUE AND source_hash_matches IS TRUE
      AND claim_count=1 AND raw_status IN ('sold','bid_to') AND source_amount>0 AND source_day IS NOT NULL
      AND source_url ~* '^https?://(www\.)?bringatrailer\.com/listing/[^/?#]+/?([?#].*)?$'
      AND source_day::timestamptz>=v_from AND (source_day+1)::timestamptz<=v_before
      AND currency IN ('USD','EUR','GBP') AND known_at<=v_known
      AND parsed_at IS NOT NULL AND fetched_at IS NOT NULL AND source_ingested_at IS NOT NULL
      AND isfinite(parsed_at) AND isfinite(fetched_at) AND isfinite(source_ingested_at) AND fetched_at<=parsed_at
      AND fetched_at>=source_day::timestamptz AND exclusion IS DISTINCT FROM 'subject'
    GROUP BY source_key
  ), coherent AS MATERIALIZED (
    SELECT c.* FROM classified c JOIN source_groups g USING(source_key)
    WHERE c.exclusion IS NULL AND NOT g.conflicting
  ), dedup AS MATERIALIZED (
    SELECT DISTINCT ON(source_key) * FROM coherent ORDER BY source_key,known_at,id,found_snapshot_id
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
  ) SELECT CASE WHEN (SELECT count(*) FROM capture_refs)>10000 THEN
    jsonb_build_object('error','Cohort exceeds the 10000-source-capture reader boundary; narrow the year/model. No sampled percentile is returned.',
      'stats',NULL,'comparables','[]'::jsonb,'coverage',jsonb_build_object('complete',false,
        'member_rows',coalesce(cardinality(v_members),0),'capture_ref_limit',10000,'capture_refs_at_least',10001))
    ELSE jsonb_build_object(
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
        'label',concat_ws(' ',p_year,p_make,p_model),'basis',CASE WHEN v_subject_count=1 THEN 'registered_same_year_model_context'
          WHEN p_year IS NULL THEN 'exact_recorded_make_model_context_all_years' ELSE 'exact_recorded_year_model_context' END,
        'membership_as_of','current_recorded_membership_not_historical','complete',true),
      'event_from',v_from,'event_before',v_before,'evidence_as_of',v_known,'knowledge_mode',p_knowledge_mode,
      'knowledge_boundary','protected_source_and_derived_receipt_clocks_current_native_context_not_historical_cohort_reconstruction',
      'currency',p_currency,'candidate_price',p_price,'price_basis','published_bid_excluding_fees',
      'price_basis_rule','bat_published_result_fee_separate_v1','price_basis_source','https://bringatrailer.com/policies/',
      'source_parser','batParser:1.0.0_sale_grammar_with_ambiguity_refusal','source_body_byte_limit',2097152,
      'price_adjustment','nominal_original_currency_no_fees_fx_or_inflation','condition_adjusted_assessment','unmeasured',
      'minimum_sales',10,'percentile',CASE WHEN t.n>=10 AND p_price IS NOT NULL THEN 100*(t.below+t.equal/2.0)/t.n END,
      'below',t.below,'equal',t.equal,'above',CASE WHEN p_price IS NOT NULL THEN t.n-t.below-t.equal END,
      'coverage',jsonb_build_object('member_rows',coalesce(cardinality(v_members),0),'dated_source_rows',(SELECT count(DISTINCT id) FROM classified WHERE sold_basis IS NOT NULL AND sold_amount>0 AND sold_on IS NOT NULL AND source_url ~* '^https?://(www\.)?bringatrailer\.com/listing/'),
        'capture_presentations',(SELECT count(*) FROM classified WHERE found_snapshot_id IS NOT NULL),'qualified_capture_presentations',(SELECT count(*) FROM coherent),
        'qualified_sales',t.n,'duplicate_presentations',(SELECT count(*) FROM coherent)-t.n,'conflicting_source_lots',(SELECT count(*) FROM source_groups WHERE conflicting),
        'condition_scalar_recorded',(SELECT count(*) FROM dedup WHERE condition_rating IS NOT NULL),
        'body_recorded',(SELECT count(*) FROM dedup WHERE nullif(btrim(body_style),'') IS NOT NULL),
        'engine_recorded',(SELECT count(*) FROM dedup WHERE nullif(btrim(engine_type),'') IS NOT NULL),
        'transmission_recorded',(SELECT count(*) FROM dedup WHERE nullif(btrim(transmission),'') IS NOT NULL),
        'inline_raw_verified',(SELECT count(*) FROM dedup WHERE source_verification='per_read_inline_hash_parser'),
        'archived_admitted',(SELECT count(*) FROM dedup WHERE source_verification='producer_attested_archived_hash_parser'),
        'typed_sale_episode_links',(SELECT count(*) FROM dedup WHERE source_vehicle_event_id IS NOT NULL),
        'condition_visual_assessed',NULL,'comment_evidence_assessed',NULL,'bid_log_assessed',NULL),
      'exclusions',coalesce((SELECT jsonb_object_agg(exclusion,n) FROM (SELECT exclusion,count(*) AS n FROM classified WHERE exclusion IS NOT NULL GROUP BY exclusion) x),'{}'::jsonb),
      'eligible',coalesce((SELECT jsonb_agg(jsonb_build_object('vehicleId',id,'sourceUrl','https://'||source_key||'/','sourceKey',source_key,'amount',sold_amount,'outcome','sold',
        'eventAt',sold_on,'knownAt',known_at,'currency',currency,'priceBasis','published_bid_excluding_fees','unitSource','https://'||source_key||'/',
        'conditionEvidence','unknown','snapshotId',found_snapshot_id,'sourceSha256',source_sha256,'snapshotFetchedAt',fetched_at,'snapshotCreatedAt',source_ingested_at,'parsedAt',parsed_at,'sourceVerification',source_verification,'derivedObservationId',derived_observation_id,'sourceVehicleEventId',source_vehicle_event_id,'sourceEpisodeAncestry',CASE WHEN source_vehicle_event_id IS NOT NULL THEN 'canonical_current_context_verified' ELSE 'unestablished' END,'derivedIngestedAt',derived_ingested_at,'sourceParser',CASE WHEN source_verification='producer_attested_archived_hash_parser' THEN admission_parser ELSE 'batParser:1.0.0_sale_grammar_with_ambiguity_refusal' END,'admissionParser',admission_parser,'soldAmountFrom',sold_amount_from)
        ORDER BY sold_on,source_key) FROM dedup),'[]'::jsonb)
    )) END INTO v_result FROM totals t;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.valuation_by_ymm(integer,text,text,timestamptz,timestamptz,timestamptz,text,numeric,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.valuation_by_ymm(integer,text,text,timestamptz,timestamptz,timestamptz,text,numeric,uuid,text) TO anon,authenticated,service_role;
COMMENT ON FUNCTION public.valuation_by_ymm(integer,text,text,timestamptz,timestamptz,timestamptz,text,numeric,uuid,text) IS
'Public-parent gated current-sale reader with optional canonical typed episode ancestry, bounded to 10000 members with cap refusal. Existing price facts supply one current recorded sale per vehicle, not a transaction history. Eligibility requires sold/date/source plus a referenced successful same-source, matched-vehicle protected snapshot. Inline HTML is independently hash-verified and reparsed; absent offloaded bodies may use ONLY exact immutable sale_result receipts derived by the service-only ingest-observation protected method. Mutable or legacy metadata receipts are never proof; bad or over-limit available inline HTML never falls back. Mutable origin metadata is a current locator only; durable source selectors also follow exact canonical non-superseded protected sale_result source_snapshot_id references after metadata advances. Both witnesses remain in source-lot conflict checks, including price/currency/outcome disagreements; future derived arrivals and matched future protected source clocks do not consume an earlier knowledge cap. Typed native episode references require the current same-parent/source native header tuple to agree with the immutable producer-pinned context; changed native headers withhold that presentation. Inline evidence is always independently reparsed; typed inline ancestry may be exposed without treating an admission badge as the source price. Future derived ancestry is withheld before its DB ingestion clock; earlier inline evidence can still qualify without the new link. Canonical receipts retain their exact strict_sale_tuple_v1 parser/replay identity; legacy reader receipts remain accepted without relabelling. Inline sourceParser identifies the SQL raw grammar, admissionParser identifies the optional canonical producer. Ancestry IDs and verification labels contain no source prose, private paths or people. This does not admit earlier resales, change parent/publication policy, install a replay worker or establish immutable native historical availability. Current future-only locators retain header classification without raw HTML reads; canonical admission IDs use the existing primary key instead of rescanning each vehicle family. Source-reference pairs are bounded to 10000 with explicit 10001 sentinel refusal before raw HTML materialization; no sampled distribution. Vehicle member/dated-source counts remain distinct from capture presentations. Source event interval is inside event window; protected parse/capture and actual snapshot-row ingestion clocks precede knowledge cutoff; knownAt is their maximum including the admitted observation DB ingested_at, with snapshotCreatedAt and derivedIngestedAt exposed separately. Qualification attempt time is not a database availability clock; sourceVerification distinguishes per-read raw verification from protected producer attestation. Raw HTML ends at the single hash/parser stage; downstream materialized folds carry typed evidence only. Full source-lot dedup/conflict checks; original units, no inflation/FX/buyer fee adjustment. Midrank=(below+equal/2)/N, minimum10 policy is not calibration. Condition/equipment unmatched; no over/under fair-value claim, historic condition or revisioned fleet assessment. Definer reads admin-only raw snapshot attribution but returns sanitized evidence for explicitly public/nondeleted real vehicle parents only; no policy grant or testimony write.';
NOTIFY pgrst,'reload schema';
COMMIT;
