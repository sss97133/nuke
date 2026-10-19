-- get_market_trends(jsonb): read each candidate's source-read clock in the scan, not by a second read of every row.
--
-- MEASURED 2026-10-15 07:44Z on the live definition (20261015233000), logged out: the board's Sold view (Recorded
-- sales, Porsche, last 7 full UTC days, 1,257 eligible) took 4.43 s cold and 0.36 s warm; other weeks of ~1,100 rows
-- 1.9-2.2 s cold. The function carries statement_timeout=5s. The cold cost is page reads: the candidate scan touches
-- 11,452 buffers (6,104 for the 1,326 auction rows by end date, 5,324 for their vehicles by key), and the episodes step
-- then read every candidate again by primary key only to get five raw_data fields: 5,416 more buffers, a third of the
-- read (EXPLAIN ANALYZE BUFFERS, 07:47Z).
--
-- CHANGE: the candidate scan selects the five fields (extractor, source_read clock_version, basis and at, listing_url)
-- from the row it already holds, and the episodes step uses them; the second read is gone. Same rule, same snapshot,
-- same output; everything else in the definition is unchanged (CREATE OR REPLACE keeps settings, owner and grants).
-- Guarded on the live definition's hash. Contract: supabase/sql/test_market_trends_one_read.sql.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE v text;
BEGIN
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') INTO v FROM pg_proc WHERE oid = 'public.get_market_trends(jsonb)'::regprocedure;
  IF v IS DISTINCT FROM '831Om/vj9Xyg/t/1avlRQ1tdEff4CevMacWKgorssD4=' AND v IS DISTINCT FROM 'RnuP1oGBfAlG0e5QTh2qxh9+dCPrSwZhxWRNccfduiA=' THEN
    RAISE EXCEPTION 'get_market_trends(jsonb) is not the 20261015233000 definition this was written from (sha256 %)', v;
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.get_market_trends(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '5s'
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE
  cutoff timestamptz:=statement_timestamp();
  event_from timestamptz; event_to timestamptz;
  scope_kind text; scope_id uuid; scope_row record; source_row record;
  scope_receipt jsonb; result jsonb; evidence_cap integer:=20;
  evidence_day date; evidence_series text;
  subject_make text; subject_grain text; subject_year integer; subject_year_start integer; subject_year_end integer;
BEGIN
  IF p_request IS NULL OR jsonb_typeof(p_request)<>'object' OR length(p_request::text)>4096 THEN
    RAISE EXCEPTION 'Requires a bounded JSON object' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_request) k WHERE k NOT IN(
    'metric','scope','source_registry_slug','benchmark','event_from','event_to','knowledge_as_of',
    'evidence_limit','evidence_bucket','evidence_series')) THEN
    RAISE EXCEPTION 'Unknown market-trends request field' USING ERRCODE='22023';
  END IF;
  IF p_request->>'metric' IS DISTINCT FROM 'recorded_sale_events'
    OR p_request->>'source_registry_slug' IS DISTINCT FROM 'bringatrailer'
    OR p_request->>'benchmark' IS DISTINCT FROM 'same_platform_excluding_scope' THEN
    RETURN jsonb_build_object('contract_version',1,'metric_id','recorded_sale_events',
      'state','unavailable','reason','unsupported_measure_source_or_benchmark');
  END IF;
  IF p_request->>'knowledge_as_of' IS NOT NULL THEN
    RETURN jsonb_build_object('contract_version',1,'metric_id','recorded_sale_events',
      'state','unavailable','reason','historical_knowledge_versions_unavailable',
      'knowledge_mode','current_recorded_state','knowledge_cutoff',cutoff);
  END IF;
  BEGIN
    event_from:=(p_request->>'event_from')::timestamptz;
    event_to:=(p_request->>'event_to')::timestamptz;
    evidence_cap:=LEAST(20,GREATEST(1,COALESCE((p_request->>'evidence_limit')::integer,20)));
    evidence_day:=(p_request->>'evidence_bucket')::date;
  EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow
    OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'Invalid bounded time or evidence parameter' USING ERRCODE='22023';
  END;
  IF event_from IS NULL OR event_to IS NULL OR NOT isfinite(event_from) OR NOT isfinite(event_to)
    OR event_to<=event_from OR event_to>cutoff OR event_to-event_from>interval '7 days'
    OR (p_request->>'event_from') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
    OR (p_request->>'event_to') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
    RAISE EXCEPTION 'Requires an explicit-zone past/current half-open window of at most seven days' USING ERRCODE='22023';
  END IF;
  evidence_series:=p_request->>'evidence_series';
  IF evidence_series IS NOT NULL AND evidence_series NOT IN('selected','benchmark') THEN
    RAISE EXCEPTION 'Invalid evidence series' USING ERRCODE='22023';
  END IF;
  IF evidence_day IS NOT NULL AND (evidence_day<event_from::date OR evidence_day>(event_to-interval '1 microsecond')::date) THEN
    RAISE EXCEPTION 'Evidence bucket lies outside the event window' USING ERRCODE='22023';
  END IF;
  IF jsonb_typeof(p_request->'scope') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Requires a registry scope' USING ERRCODE='22023';
  END IF;
  scope_kind:=p_request#>>'{scope,kind}';
  IF scope_kind NOT IN('canonical_make','supported_subject') OR scope_kind IS NULL THEN
    RETURN jsonb_build_object('contract_version',1,'metric_id','recorded_sale_events',
      'state','unavailable','reason','unsupported_registry_scope');
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_request->'scope') k
    WHERE k NOT IN('kind','canonical_make_id','subject_id')) THEN
    RAISE EXCEPTION 'Unknown registry scope field' USING ERRCODE='22023';
  END IF;
  IF (scope_kind='canonical_make' AND p_request->'scope' ? 'subject_id')
    OR (scope_kind='supported_subject' AND p_request->'scope' ? 'canonical_make_id') THEN
    RAISE EXCEPTION 'Registry scope IDs must match the selected kind' USING ERRCODE='22023';
  END IF;
  BEGIN
    scope_id:=CASE WHEN scope_kind='canonical_make' THEN (p_request#>>'{scope,canonical_make_id}')::uuid
      ELSE (p_request#>>'{scope,subject_id}')::uuid END;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid registry scope UUID' USING ERRCODE='22023';
  END;
  IF scope_kind='canonical_make' THEN
    SELECT id,canonical_name INTO scope_row FROM public.canonical_makes WHERE id=scope_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('state','unavailable','reason','unknown_canonical_make');
    END IF;
    scope_receipt:=jsonb_build_object('kind',scope_kind,'canonical_make_id',scope_id,
      'label',scope_row.canonical_name,'membership_method','canonical_make_fk_or_unique_exact_registry_name_alias',
      'comparison_basis','make population, not condition-equivalent valuation cohort');
  ELSE
    SELECT p.* INTO scope_row FROM public.make_model_profiles p
    JOIN public.canonical_models cm ON cm.id=p.canonical_model_id
    WHERE p.subject_id=scope_id AND p.comparison_scope_status='supported'
      AND nullif(btrim(p.comparison_scope_basis),'') IS NOT NULL
      AND nullif(btrim(p.canonical_make),'') IS NOT NULL AND nullif(btrim(p.canonical_model),'') IS NOT NULL
      AND ((p.grain='year' AND p.year IS NOT NULL)
        OR (p.grain IN('generation','model') AND p.year_start IS NOT NULL
          AND p.year_end IS NOT NULL AND p.year_end>=p.year_start));
    IF NOT FOUND THEN
      RETURN jsonb_build_object('state','unavailable','reason','unsupported_or_unknown_subject');
    END IF;
    subject_make:=scope_row.canonical_make; subject_grain:=scope_row.grain;
    subject_year:=scope_row.year; subject_year_start:=scope_row.year_start; subject_year_end:=scope_row.year_end;
    scope_receipt:=jsonb_build_object('kind',scope_kind,'subject_id',scope_id,
      'label',scope_row.canonical_make||' '||scope_row.canonical_model,'grain',scope_row.grain,
      'year',scope_row.year,'year_start',scope_row.year_start,'year_end',scope_row.year_end,
      'comparison_scope_status',scope_row.comparison_scope_status,'comparison_scope_basis',scope_row.comparison_scope_basis,
      'membership_method','cohort_members_supported_registry_subject',
      'comparison_basis','explicit attributed grouping; condition and factory generation are unverified');
  END IF;
  SELECT id,slug,display_name,NULL::text AS extractor_function INTO source_row FROM public.v_market_trend_source_labels WHERE slug='bringatrailer';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state','unavailable','reason','source_registry_row_missing');
  END IF;

  WITH candidates AS MATERIALIZED (
    -- Eligibility precedes the cap: private parents cannot consume or leak public counts/caps.
    SELECT e.id,e.vehicle_id,rtrim(e.source_url,'/') AS source_key,e.auction_end_date AS event_at,
      e.outcome,e.winning_bid,e.created_at,e.updated_at,e.scraped_at,
      v.make,v.model,v.year,v.canonical_make_id,
      -- The source-read clock fields, read here from the row the scan already holds (2026-10-15: a second read of
      -- every candidate by primary key cost 5,416 of the read's ~16,800 buffers for this week's 1,326 BaT rows).
      e.raw_data->>'extractor' AS rd_extractor,e.raw_data#>>'{source_read,clock_version}' AS rd_clock_version,
      e.raw_data#>>'{source_read,basis}' AS rd_basis,e.raw_data#>>'{source_read,at}' AS rd_at,
      e.raw_data->>'listing_url' AS rd_listing_url
    FROM public.auction_events e JOIN public.vehicles v ON v.id=e.vehicle_id
    WHERE e.source='bat' AND e.auction_end_date>=event_from AND e.auction_end_date<event_to
      AND e.created_at<=cutoff AND e.updated_at<=cutoff
      AND e.source_url ~ '^https://bringatrailer[.]com/listing/[^/?#]+/?$'
      AND v.is_public AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
    ORDER BY e.auction_end_date,e.id LIMIT 2001
  ), bounded AS MATERIALIZED (
    SELECT * FROM candidates ORDER BY event_at,id LIMIT 2000
  ), relevant_subject AS MATERIALIZED (
    SELECT p.subject_id FROM public.make_model_profiles p
    WHERE scope_kind='supported_subject' AND p.subject_id=scope_id
      AND EXISTS(SELECT 1 FROM bounded b WHERE lower(b.make)=lower(p.canonical_make)
        AND ((p.grain='year' AND b.year=p.year) OR (p.grain<>'year' AND b.year BETWEEN p.year_start AND p.year_end)))
  ), members AS MATERIALIZED (
    SELECT m.vehicle_id FROM relevant_subject p CROSS JOIN LATERAL public.cohort_members(p.subject_id,
      ARRAY(SELECT DISTINCT b.vehicle_id FROM bounded b)) m
  ), make_keys AS MATERIALIZED (
    -- Each make spelling (and its recorded make id) resolves once, not once per candidate row: the lookup reads every
    -- canonical make and its aliases (2026-10-15: 0.8 s of a cold 4.3 s read for one week of BaT, 1,257 rows).
    SELECT DISTINCT lower(b.make) AS make_l,b.canonical_make_id FROM bounded b
  ), make_resolved AS MATERIALIZED (
    SELECT k.make_l,k.canonical_make_id,mk.resolved_make_id FROM make_keys k
    LEFT JOIN LATERAL (
      SELECT CASE WHEN k.canonical_make_id IS NOT NULL AND count(*)=1
          AND min(cm.id::text)::uuid<>k.canonical_make_id THEN NULL
        ELSE COALESCE(k.canonical_make_id,
          CASE WHEN count(*)=1 THEN min(cm.id::text)::uuid END) END AS resolved_make_id
      FROM public.canonical_makes cm
      WHERE lower(cm.canonical_name)=k.make_l
        OR k.make_l=ANY(SELECT lower(a) FROM unnest(cm.aliases) a)
    ) mk ON true
  ), classified AS MATERIALIZED (
    SELECT b.*,mk.resolved_make_id,mdl.model_count,
      CASE WHEN mk.resolved_make_id IS NULL THEN NULL
        WHEN scope_kind='canonical_make' THEN CASE WHEN mk.resolved_make_id=scope_id THEN 'selected' ELSE 'benchmark' END
        WHEN EXISTS(SELECT 1 FROM members m WHERE m.vehicle_id=b.vehicle_id) THEN 'selected'
        WHEN lower(make_entity.canonical_name)<>lower(subject_make) THEN 'benchmark'
        WHEN b.year IS NULL THEN NULL
        WHEN (subject_grain='year' AND b.year<>subject_year)
          OR (subject_grain<>'year' AND b.year NOT BETWEEN subject_year_start AND subject_year_end) THEN 'benchmark'
        WHEN mdl.model_count=1 THEN 'benchmark'
        ELSE NULL END AS assigned_series
    FROM bounded b
    LEFT JOIN make_resolved mk ON mk.make_l IS NOT DISTINCT FROM lower(b.make)
      AND mk.canonical_make_id IS NOT DISTINCT FROM b.canonical_make_id
    LEFT JOIN public.canonical_makes make_entity ON make_entity.id=mk.resolved_make_id
    LEFT JOIN LATERAL (
      SELECT count(*) AS model_count FROM public.canonical_models cm
      WHERE scope_kind='supported_subject'
        AND lower(make_entity.canonical_name)=lower(subject_make)
        AND ((subject_grain='year' AND b.year=subject_year)
          OR (subject_grain<>'year' AND b.year BETWEEN subject_year_start AND subject_year_end))
        AND NOT EXISTS(SELECT 1 FROM members m WHERE m.vehicle_id=b.vehicle_id)
        AND lower(cm.make)=lower(b.make) AND (cm.year_start IS NULL OR b.year>=cm.year_start)
        AND (cm.year_end IS NULL OR b.year<=cm.year_end)
        AND (lower(cm.canonical_model)=lower(b.model)
          OR lower(b.model)=ANY(SELECT lower(a) FROM unnest(cm.aliases) a))
    ) mdl ON scope_kind='supported_subject'
  ), alias_groups AS MATERIALIZED (
    SELECT source_key,count(*) AS alias_rows,
      count(DISTINCT ROW(vehicle_id,event_at,outcome,winning_bid))>1 AS conflict,
      array_agg(id ORDER BY id) AS source_event_ids FROM classified GROUP BY source_key
  ), episodes AS MATERIALIZED (
    SELECT DISTINCT ON(c.source_key) c.*,g.conflict,g.source_event_ids,
      CASE WHEN NOT g.conflict THEN c.assigned_series END AS series,
      CASE WHEN NOT g.conflict AND c.outcome='sold' AND c.winning_bid>0
        AND c.winning_bid<'Infinity'::numeric THEN true ELSE false END AS recorded_sold,
      CASE WHEN c.rd_extractor='extract-bat-core'
        AND c.rd_clock_version='1'
        AND c.rd_basis IN('direct_fetch','cached_snapshot')
        AND c.scraped_at<=cutoff
        AND c.rd_listing_url IN(c.source_key,c.source_key||'/')
        AND to_char(c.scraped_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')=c.rd_at
        THEN c.scraped_at END AS source_observed_at,
      CASE WHEN c.rd_extractor='extract-bat-core'
        AND c.rd_clock_version='1'
        AND c.rd_basis IN('direct_fetch','cached_snapshot')
        AND c.scraped_at<=cutoff
        AND c.rd_listing_url IN(c.source_key,c.source_key||'/')
        AND to_char(c.scraped_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')=c.rd_at
        THEN c.rd_basis ELSE 'unknown' END AS source_read_basis
    FROM classified c JOIN alias_groups g USING(source_key)
    ORDER BY c.source_key,c.scraped_at DESC NULLS LAST,c.id
  ), buckets AS MATERIALIZED (
    SELECT gs AS bucket_start,GREATEST(gs,event_from) AS window_from,
      LEAST(gs+interval '1 day',event_to) AS window_to
    FROM generate_series(date_trunc('day',event_from),date_trunc('day',event_to-interval '1 microsecond'),interval '1 day') gs
  ), points AS MATERIALIZED (
    SELECT b.*,s.series,count(e.id) AS eligible,
      count(e.id) FILTER(WHERE e.recorded_sold) AS sold,
      count(e.id) FILTER(WHERE NOT e.conflict AND e.outcome IN('reserve_not_met','no_sale','cancelled')) AS explicit_no_sale,
      count(e.id) FILTER(WHERE NOT e.conflict AND e.outcome='bid_to') AS bid_to,
      count(e.id) FILTER(WHERE NOT e.conflict AND e.outcome='sold' AND NOT e.recorded_sold) AS unsupported_sold_amount,
      count(e.id) FILTER(WHERE NOT e.conflict AND (e.outcome IS NULL OR e.outcome IN('live','pending','relisted'))) AS ended_pending,
      count(e.id) FILTER(WHERE e.source_observed_at IS NOT NULL) AS known_clocks,
      min(e.event_at) AS first_event,max(e.event_at) AS last_event,max(e.source_observed_at) AS latest_observed
    FROM buckets b CROSS JOIN(VALUES('selected'::text),('benchmark'::text)) s(series)
    LEFT JOIN episodes e ON e.series=s.series AND e.event_at>=b.window_from AND e.event_at<b.window_to
    GROUP BY b.bucket_start,b.window_from,b.window_to,s.series
  ), evidence AS MATERIALIZED (
    SELECT e.*,row_number() OVER(PARTITION BY event_at::date,series ORDER BY event_at,id) AS position
    FROM episodes e WHERE e.series IS NOT NULL AND NOT e.conflict AND e.recorded_sold
      AND(evidence_day IS NULL OR event_at::date=evidence_day)
      AND(evidence_series IS NULL OR e.series=evidence_series)
  )
  SELECT jsonb_build_object(
    'contract_version',1,'metric_id','recorded_sale_events','state','partial',
    'reason',CASE WHEN (SELECT count(*) FROM candidates)>2000 THEN 'candidate_cap_exceeded' ELSE 'external_capture_and_result_completeness_unverified' END,
    'unit','recorded_sale_episodes','scope',scope_receipt,
    'benchmark',jsonb_build_object('kind','same_platform_excluding_scope','excludes_scope',true),
    'source_registry',jsonb_build_object('id',source_row.id,'slug',source_row.slug,'display_name',source_row.display_name,
      'registry_declared_extractor',source_row.extractor_function,'auction_event_source','bat',
      'observed_writer','extract-bat-core','writer_registry_match',source_row.extractor_function='extract-bat-core',
      'registry_metadata_visibility','public_identity_label_only','registry_declared_extractor_visibility','protected_unavailable',
      'mapping_basis','existing extract-bat-core source bat and exact BaT listing URL; registry label is not writer custody'),
    'knowledge_mode','current_recorded_state','knowledge_cutoff',cutoff,'generated_at',cutoff,
    'event_from',event_from,'event_to',event_to,
    'event_time_basis','recorded auction_events.auction_end_date; not ownership transfer time; legacy resolution can be date-only',
    'method_id','auction_events_source_sold_outcome','method_version',1,
    'grain','one slash-normalized platform listing episode','weighting','one episode one count',
    'candidate_limit',2000,'captured_candidates',(SELECT count(*) FROM candidates),
    'truncated',(SELECT count(*) FROM candidates)>2000,
    'coverage',jsonb_build_object('eligible_recorded_episodes',(SELECT count(*) FROM episodes),
      'unresolved_scope',(SELECT count(*) FROM episodes WHERE series IS NULL),
      'conflicting_alias_episodes',(SELECT count(*) FROM episodes WHERE conflict),
      'complete_external_capture',false,'historical_knowledge_versions_available',false,
      'currency_qualified',false,'ratios_supported',false),
    'series',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'bucket_start',p.bucket_start,'event_from',p.window_from,'event_to',p.window_to,'series',p.series,
      'metric_id','recorded_sale_events','state','partial',
      'value',CASE WHEN (SELECT count(*) FROM candidates)<=2000 THEN p.sold END,
      'numerator',CASE WHEN (SELECT count(*) FROM candidates)<=2000 THEN p.sold END,
      'denominator',CASE WHEN (SELECT count(*) FROM candidates)<=2000 THEN p.eligible END,
      'unit','recorded_sale_episodes','ratio',NULL,'absolute_change',NULL,'relative_change',NULL,
      'knowledge_cutoff',cutoff,'source_observed_at',p.latest_observed,'folded_at',cutoff,
      'fold_basis','query_time_current_recorded_state; no new scheduled fold',
      'method_id','auction_events_source_sold_outcome','method_version',1,
      'grain','platform listing episode','weighting','one episode one count',
      'coverage',jsonb_build_object('captured_eligible',p.eligible,'captured_sold',p.sold,
        'explicit_no_sale',p.explicit_no_sale,'bid_to',p.bid_to,'ended_pending',p.ended_pending,
        'sold_without_supported_amount',p.unsupported_sold_amount,
        'unresolved_scope',(SELECT count(*) FROM episodes u WHERE u.series IS NULL
          AND u.event_at>=p.window_from AND u.event_at<p.window_to),
        'conflicting_aliases',(SELECT count(*) FROM episodes u WHERE u.conflict
          AND u.event_at>=p.window_from AND u.event_at<p.window_to),
        'source_clock_known',p.known_clocks,'source_clock_unknown',p.eligible-p.known_clocks,
        'earliest_event',p.first_event,'latest_event',p.last_event,
        'bucket_elapsed_seconds',extract(epoch FROM p.window_to-p.window_from),'full_bucket_seconds',86400,
        'incomplete_bucket',p.window_from>p.bucket_start OR p.window_to<p.bucket_start+interval '1 day',
        'complete_external_capture',false,'truncated',(SELECT count(*) FROM candidates)>2000)
    ) ORDER BY p.bucket_start,p.series) FROM points p),'[]'::jsonb),
    'evidence',jsonb_build_object('per_bucket_series_limit',evidence_cap,'pagination_supported',false,
      'limitation','bounded current-state contributors; resubmit explicit evidence_bucket and evidence_series for the drill; no immutable snapshot cursor',
      'has_more',EXISTS(SELECT 1 FROM evidence WHERE position>evidence_cap),
      'contributors',COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'auction_event_id',e.id,'source_event_ids',e.source_event_ids,'vehicle_id',e.vehicle_id,
        'source_url',e.source_key||'/','event_at',e.event_at,'event_time_basis','recorded_episode_end',
        'latest_source_row_write',e.updated_at,'knowledge_cutoff',cutoff,
        'source_observed_at',e.source_observed_at,'source_read_basis',e.source_read_basis,
        'series',e.series,'bucket_start',date_trunc('day',e.event_at),'contribution',1,
        'method_id','auction_events_source_sold_outcome','method_version',1
      ) ORDER BY e.event_at,e.id) FROM evidence e WHERE position<=evidence_cap),'[]'::jsonb))
  ) INTO result;
  RETURN result;
END;
$function$;

COMMIT;
