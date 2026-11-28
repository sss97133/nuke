-- One recorded-family navigation rule for existing model lists and captured outcomes.
-- Registry, testimony, materializations and refresh jobs are not rewritten.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $guard$
BEGIN
 IF md5((SELECT prosrc FROM pg_proc WHERE oid='public.treemap_family_models(text,text)'::regprocedure))
   NOT IN('45687420fa6f70267e61499c711286a8','f3e3628ec0c90b7d54fe70db3484defb') THEN
  RAISE EXCEPTION 'Unexpected family model reader; review its current grouping before replacing it';
 END IF;
 IF to_regprocedure('public.treemap_family_models(text,text,text)') IS NOT NULL AND
   md5((SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure('public.treemap_family_models(text,text,text)'))) <> '979455c406e4e501a615043bc7bc09b7' THEN
  RAISE EXCEPTION 'Unexpected family rule overload; review its current owner before replacing it';
 END IF;
END;
$guard$;
CREATE OR REPLACE FUNCTION public.treemap_family_models(p_brand text,p_family_key text,p_purpose text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path TO 'public','pg_temp'
AS $rule$
DECLARE
 actual_brand text; brand_count integer; label text; label_count integer; root_found boolean;
 is_pickup boolean; has_silverado boolean; has_sierra boolean;
 keys text[]; words text[]; umbrella_names text[]; labels jsonb; metadata_as_of timestamptz; named_hash text;
BEGIN
 IF p_purpose IS DISTINCT FROM 'recorded_family_rule' THEN
  RAISE EXCEPTION 'Unknown family rule purpose' USING ERRCODE='22023';
 END IF;
 -- Exact spellings retain the old model reader's behavior. New canonical callers
 -- may use a unique case-insensitive brand spelling; ambiguity is explicit.
 SELECT min(m.brand),count(DISTINCT m.brand)::integer INTO actual_brand,brand_count
 FROM public.mv_family_market m WHERE m.brand=p_brand;
 IF brand_count=0 THEN
  SELECT min(m.brand),count(DISTINCT m.brand)::integer INTO actual_brand,brand_count
  FROM public.mv_family_market m WHERE lower(m.brand)=lower(p_brand);
 END IF;
 IF brand_count<>1 THEN
  RETURN jsonb_build_object('contract_version',1,'state','unavailable',
   'reason',CASE WHEN brand_count=0 THEN 'unknown_recorded_brand' ELSE 'ambiguous_recorded_brand' END,
   'purpose',p_purpose,'family_keys','[]'::jsonb,'model_contains','[]'::jsonb);
 END IF;
 SELECT count(*)>0,max(m.family),count(DISTINCT m.family)::integer,
  coalesce(bool_or(m.family='Pickup'),false),coalesce(bool_or(m.family='Silverado'),false),
  coalesce(bool_or(m.family='Sierra'),false),max(m.as_of)
 INTO root_found,label,label_count,is_pickup,has_silverado,has_sierra,metadata_as_of
 FROM public.mv_family_market m WHERE m.brand=actual_brand AND m.family_key=p_family_key;
 IF NOT root_found THEN
  RETURN jsonb_build_object('contract_version',1,'state','unavailable','reason','unknown_recorded_family',
   'purpose',p_purpose,'brand',actual_brand,'family_key',p_family_key,'family_keys','[]'::jsonb,'model_contains','[]'::jsonb);
 END IF;
 umbrella_names:=CASE WHEN NOT is_pickup THEN '{}'::text[]
  WHEN actual_brand='Chevrolet' THEN ARRAY[
   'Pickup','3100','3600','3800','Apache','Cameo','C10','K10','C20','K20','C30','K30',
   'C1500','K1500','454 SS','C2500','K2500','C3500','K3500','3500','S10','S-10 Pickup',
   'Colorado','Avalanche','SSR','LUV','Silverado']
  WHEN actual_brand='GMC' THEN ARRAY[
   'Pickup','C1500','K1500','Sierra','Syclone','Sonoma','S15 Pickup','C2500','K2500',
   'C3500','K3500','Canyon','Hummer EV Pickup']
  WHEN actual_brand='Ford' THEN ARRAY['Pickup','F-1','F-100','F-150','F-250','F-350','F-450','Ranger']
  ELSE '{}'::text[] END;
 words:=CASE WHEN actual_brand='Chevrolet' AND has_silverado THEN ARRAY['silverado']
  WHEN actual_brand='GMC' AND has_sierra THEN ARRAY['sierra'] ELSE '{}'::text[] END;
 WITH target AS (
  SELECT p_family_key family_key
  UNION
  SELECT DISTINCT m.family_key FROM public.mv_family_market m
  WHERE m.brand=actual_brand AND m.family=ANY(umbrella_names)
 )
 SELECT array_agg(family_key ORDER BY family_key) INTO keys FROM(
  SELECT family_key FROM target ORDER BY family_key LIMIT 1001) bounded_keys;
 IF cardinality(keys)>1000 THEN
  RETURN jsonb_build_object('contract_version',1,'state','unavailable','reason','family_rule_key_cap_exceeded',
   'purpose',p_purpose,'brand',actual_brand,'family_key',p_family_key,'family_keys','[]'::jsonb,
   'umbrella_family_names',to_jsonb(umbrella_names),'model_contains',to_jsonb(words));
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('family_key',x.family_key,'labels',x.labels)
  ORDER BY x.family_key),'[]'::jsonb) INTO labels FROM(
   SELECT m.family_key,jsonb_agg(DISTINCT m.family ORDER BY m.family) FILTER(WHERE m.family IS NOT NULL) labels
   FROM public.mv_family_market m WHERE m.brand=actual_brand AND m.family_key=ANY(keys) GROUP BY m.family_key) x;
 SELECT md5(string_agg(x.family_key,',' ORDER BY x.family_key)) INTO named_hash FROM(
  SELECT DISTINCT m.family_key FROM public.mv_family_market m WHERE m.brand=actual_brand AND m.family_key<>'other') x;
 RETURN jsonb_build_object('contract_version',1,'state','available','reason','recorded_market_navigation_rule',
  'purpose',p_purpose,'method','recorded_market_family_rule_v1','brand',actual_brand,'family_key',p_family_key,
  'family',label,'label_count',label_count,'bucket_kind',CASE WHEN p_family_key='other' THEN 'unresolved_or_rare' ELSE 'named' END,
  'family_keys',to_jsonb(keys),'key_labels',labels,'model_contains',to_jsonb(words),
  'umbrella_family_names',to_jsonb(umbrella_names),
  'named_family_keys_fingerprint',named_hash,'metadata_as_of',metadata_as_of,
  'dictionary_source','mv_model_family_names','dictionary_row_clock','unavailable',
  'historical_dictionary_versions_available',false,'factory_configuration_verified',false,
  'fingerprint',md5(jsonb_build_array('recorded_market_family_rule',1,actual_brand,p_family_key,
    label,label_count,keys,words,umbrella_names,labels,named_hash,
    to_char(metadata_as_of AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::text));
END;
$rule$;
REVOKE ALL ON FUNCTION public.treemap_family_models(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.treemap_family_models(text,text,text) TO anon,authenticated,service_role;
COMMENT ON FUNCTION public.treemap_family_models(text,text,text) IS
'Bounded invoker rule overload of the existing family/model owner. Explicit recorded_family_rule purpose returns the same named family, pickup umbrella and declared series-word recipe as the navigation model list, using existing market family keys. Up to1000targetkeys with explicit unavailable reasons; no model list or sales-only membership inference, no registry/testimony rewrite, no historical/factory/condition/price qualification. Dictionary clocks remain unavailable; metadata clock and semantic recipe fingerprint are explicit.';

CREATE OR REPLACE FUNCTION public.treemap_family_models(p_brand text, p_family_key text)
 RETURNS TABLE(model text, sold bigint, sold_any bigint, offered bigint, usd bigint, dated bigint, sold_12m bigint, sold_prior_12m bigint, usd_12m bigint, usd_prior_12m bigint, as_of timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH rule AS MATERIALIZED (
    SELECT public.treemap_family_models(p_brand,p_family_key,'recorded_family_rule') AS recipe
  ), target_keys AS (
    -- The old 200-model reader keeps its full target query even if the new
    -- comparison-purpose rule refuses a >1000-key expansion.
    SELECT p_family_key AS family_key
    UNION
    SELECT DISTINCT m.family_key FROM public.mv_family_market m CROSS JOIN rule r
    WHERE m.brand=p_brand AND m.family=ANY(ARRAY(
      SELECT jsonb_array_elements_text(r.recipe->'umbrella_family_names')))
  ),
  matched_models AS (
    SELECT nullif(m.model, '') AS model, m.model_key, m.sold, m.sold_any, m.offered, m.usd, m.bat_dated,
           m.bat_sold_12m, m.bat_sold_prior_12m, m.bat_usd_12m, m.bat_usd_prior_12m, m.as_of
    FROM public.mv_family_market m
    JOIN target_keys tk ON tk.family_key = m.family_key
    WHERE m.brand = p_brand AND m.sold > 0
    UNION
    SELECT nullif(m.model, '') AS model, m.model_key, m.sold, m.sold_any, m.offered, m.usd, m.bat_dated,
           m.bat_sold_12m, m.bat_sold_prior_12m, m.bat_usd_12m, m.bat_usd_prior_12m, m.as_of
    FROM public.mv_family_market m
    WHERE m.brand = p_brand AND m.sold > 0
      AND EXISTS(SELECT 1 FROM rule r
        CROSS JOIN LATERAL jsonb_array_elements_text(r.recipe->'model_contains') token
        WHERE m.model ILIKE '%'||token||'%')
  )
  SELECT model, sold, sold_any, offered, usd, bat_dated,
         bat_sold_12m, bat_sold_prior_12m, bat_usd_12m, bat_usd_prior_12m, as_of
  FROM matched_models
  ORDER BY usd DESC, model_key
  LIMIT 200;
$function$;




DO $market_guard$
BEGIN
 IF md5((SELECT prosrc FROM pg_proc WHERE oid='public.get_market_trends(jsonb)'::regprocedure))
   NOT IN('aaa3b807e6d2c23a4f274f77ff3ef61f','20ddde5d2ab456e7cd88e8ba8ef419a2') THEN
  RAISE EXCEPTION 'Unexpected market reader; review current scope behavior before replacing it';
 END IF;
END;
$market_guard$;
CREATE OR REPLACE FUNCTION public.get_market_trends(p_request jsonb)
 RETURNS jsonb LANGUAGE plpgsql STABLE
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '5s'
 SET "TimeZone" TO 'UTC'
AS $function$
-- descriptive_outcome_scopes_v1: purpose-specific registry labels; no valuation policy promotion.
DECLARE
  cutoff timestamptz:=statement_timestamp();
  event_from timestamptz; event_to timestamptz;
  scope_kind text; scope_id uuid; scope_row record; source_row record; subject_model_id uuid;
  scope_receipt jsonb; result jsonb; evidence_cap integer:=20;
  family_rule jsonb; family_registry_rows jsonb; family_key text; family_year integer; family_year_start integer; family_year_end integer; family_model text;
  evidence_day date; evidence_series text;
  requested_metric text; evidence_offset integer:=0; evidence_kind text:='known_bidding_outcome';
  expected_snapshot text;
  subject_make text; subject_grain text; subject_year integer; subject_year_start integer; subject_year_end integer;
BEGIN
  IF p_request IS NULL OR jsonb_typeof(p_request)<>'object' OR length(p_request::text)>4096 THEN
    RAISE EXCEPTION 'Requires a bounded JSON object' USING ERRCODE='22023';
  END IF;
  requested_metric:=p_request->>'metric';
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_request) k WHERE k NOT IN(
    'metric','scope','source_registry_slug','benchmark','event_from','event_to','knowledge_as_of',
    'evidence_limit','evidence_bucket','evidence_series') AND NOT (
      requested_metric='captured_sell_through' AND k IN(
        'reserve_policy','evidence_offset','evidence_outcome','evidence_snapshot_hash'))) THEN
    RAISE EXCEPTION 'Unknown market-trends request field' USING ERRCODE='22023';
  END IF;
  IF (requested_metric IS NULL OR requested_metric NOT IN('recorded_sale_events','captured_sell_through'))
    OR p_request->>'source_registry_slug' IS DISTINCT FROM 'bringatrailer'
    OR p_request->>'benchmark' IS DISTINCT FROM 'same_platform_excluding_scope' THEN
    RETURN jsonb_build_object('contract_version',1,'metric_id','recorded_sale_events',
      'state','unavailable','reason','unsupported_measure_source_or_benchmark');
  END IF;
  IF requested_metric='captured_sell_through' AND p_request->>'reserve_policy' IS DISTINCT FROM 'all_recorded_policies' THEN
    RETURN jsonb_build_object('contract_version',1,'metric_id',requested_metric,
      'state','unavailable','reason','unsupported_or_missing_reserve_policy');
  END IF;
  IF p_request->>'knowledge_as_of' IS NOT NULL THEN
    RETURN jsonb_build_object('contract_version',1,'metric_id',requested_metric,
      'state','unavailable','reason','historical_knowledge_versions_unavailable',
      'knowledge_mode','current_recorded_state','knowledge_cutoff',cutoff);
  END IF;
  BEGIN
    event_from:=(p_request->>'event_from')::timestamptz;
    event_to:=(p_request->>'event_to')::timestamptz;
    evidence_cap:=LEAST(20,GREATEST(1,COALESCE((p_request->>'evidence_limit')::integer,20)));
    evidence_day:=(p_request->>'evidence_bucket')::date;
    IF requested_metric='captured_sell_through' THEN
      evidence_offset:=COALESCE((p_request->>'evidence_offset')::integer,0);
    END IF;
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
  IF requested_metric='captured_sell_through' THEN
    evidence_kind:=COALESCE(p_request->>'evidence_outcome','known_bidding_outcome');
    expected_snapshot:=p_request->>'evidence_snapshot_hash';
    IF evidence_offset<0 OR evidence_offset>2000 OR evidence_kind NOT IN
      ('known_bidding_outcome','sold','no_sale','withdrawn','unresolved')
      OR (expected_snapshot IS NOT NULL AND expected_snapshot !~ '^[0-9a-f]{32}$') THEN
      RAISE EXCEPTION 'Invalid bounded evidence selection' USING ERRCODE='22023';
    END IF;
    IF evidence_offset>0 AND (evidence_day IS NULL OR evidence_series IS NULL OR expected_snapshot IS NULL) THEN
      RAISE EXCEPTION 'Evidence continuation requires bucket, series and snapshot hash' USING ERRCODE='22023';
    END IF;
  END IF;
  IF evidence_day IS NOT NULL AND (evidence_day<event_from::date OR evidence_day>(event_to-interval '1 microsecond')::date) THEN
    RAISE EXCEPTION 'Evidence bucket lies outside the event window' USING ERRCODE='22023';
  END IF;
  IF jsonb_typeof(p_request->'scope') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Requires a registry scope' USING ERRCODE='22023';
  END IF;
  scope_kind:=p_request#>>'{scope,kind}';
  IF scope_kind NOT IN('canonical_make','supported_subject','descriptive_subject','recorded_family') OR scope_kind IS NULL THEN
    RETURN jsonb_build_object('contract_version',1,'metric_id','recorded_sale_events',
      'state','unavailable','reason','unsupported_registry_scope');
  END IF;
  IF scope_kind IN('descriptive_subject','recorded_family') AND requested_metric<>'captured_sell_through' THEN
    RETURN jsonb_build_object('contract_version',1,'metric_id',requested_metric,
      'state','unavailable','reason','scope_purpose_not_supported');
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_request->'scope') k
    WHERE k NOT IN('kind','canonical_make_id','subject_id') AND NOT
      (scope_kind='recorded_family' AND k IN('family_key','year','year_start','year_end','model_name'))) THEN
    RAISE EXCEPTION 'Unknown registry scope field' USING ERRCODE='22023';
  END IF;
  IF (scope_kind IN('canonical_make','recorded_family') AND p_request->'scope' ? 'subject_id')
    OR (scope_kind IN('supported_subject','descriptive_subject') AND p_request->'scope' ? 'canonical_make_id') THEN
    RAISE EXCEPTION 'Registry scope IDs must match the selected kind' USING ERRCODE='22023';
  END IF;
  BEGIN
    scope_id:=CASE WHEN scope_kind IN('canonical_make','recorded_family') THEN (p_request#>>'{scope,canonical_make_id}')::uuid
      ELSE (p_request#>>'{scope,subject_id}')::uuid END;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid registry scope UUID' USING ERRCODE='22023';
  END;
  IF scope_kind='recorded_family' THEN
    IF jsonb_typeof(p_request#>'{scope,family_key}') IS DISTINCT FROM 'string'
      OR length(p_request#>>'{scope,family_key}') NOT BETWEEN 1 AND 160
      OR (p_request->'scope' ? 'year' AND (
        jsonb_typeof(p_request#>'{scope,year}') IS DISTINCT FROM 'number'
        OR (p_request#>>'{scope,year}') !~ '^[0-9]{4}$'))
      OR ((p_request->'scope' ? 'year_start')<>(p_request->'scope' ? 'year_end'))
      OR (p_request->'scope' ? 'year' AND p_request->'scope' ?| ARRAY['year_start','year_end'])
      OR (p_request->'scope' ? 'year_start' AND (
        jsonb_typeof(p_request#>'{scope,year_start}') IS DISTINCT FROM 'number'
        OR (p_request#>>'{scope,year_start}') !~ '^[0-9]{4}$'
        OR jsonb_typeof(p_request#>'{scope,year_end}') IS DISTINCT FROM 'number'
        OR (p_request#>>'{scope,year_end}') !~ '^[0-9]{4}$'))
      OR (p_request->'scope' ? 'model_name' AND (
        jsonb_typeof(p_request#>'{scope,model_name}') IS DISTINCT FROM 'string'
        OR length(btrim(p_request#>>'{scope,model_name}')) NOT BETWEEN 1 AND 160)) THEN
      RAISE EXCEPTION 'Requires a recorded family key and optional integer year/literal model name' USING ERRCODE='22023';
    END IF;
    family_key:=p_request#>>'{scope,family_key}';
    family_year:=(p_request#>>'{scope,year}')::integer;
    family_year_start:=(p_request#>>'{scope,year_start}')::integer;
    family_year_end:=(p_request#>>'{scope,year_end}')::integer;
    family_model:=lower(btrim(p_request#>>'{scope,model_name}'));
    IF (family_year IS NOT NULL AND family_year NOT BETWEEN 1885 AND 2100)
      OR (family_year_start IS NOT NULL AND (family_year_start NOT BETWEEN 1885 AND 2100
        OR family_year_end NOT BETWEEN 1885 AND 2100 OR family_year_start>family_year_end)) THEN
      RAISE EXCEPTION 'Invalid recorded family year' USING ERRCODE='22023';
    END IF;
    SELECT id,canonical_name INTO scope_row FROM public.canonical_makes WHERE id=scope_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('state','unavailable','reason','unknown_canonical_make'); END IF;
    family_rule:=public.treemap_family_models(scope_row.canonical_name,family_key,'recorded_family_rule');
    IF family_rule->>'state' IS DISTINCT FROM 'available' THEN
      RETURN jsonb_build_object('state','unavailable','reason',family_rule->>'reason');
    END IF;
    IF family_key='other' THEN
      RETURN jsonb_build_object('state','unavailable','reason','mixed_other_bucket_not_a_family_scope');
    END IF;
    IF family_rule->>'label_count' IS DISTINCT FROM '1' THEN
      RETURN jsonb_build_object('state','unavailable','reason','ambiguous_recorded_family_label');
    END IF;
    -- Use the dictionary owner's normalized make spellings, but refuse alias
    -- collisions instead of choosing its alphabetical first make. This is a
    -- current-registry contrary-evidence guard, not a replacement family fold.
    WITH make_names AS MATERIALIZED (
      SELECT DISTINCT cm.id,regexp_replace(lower(n),'[^a-z0-9]','','g') k
      FROM public.canonical_makes cm CROSS JOIN LATERAL unnest(
        ARRAY[cm.canonical_name,cm.display_name,cm.short_name]||coalesce(cm.aliases,'{}'::text[])) n
      WHERE nullif(btrim(n),'') IS NOT NULL
    ), unique_make_names AS (
      SELECT k FROM make_names WHERE k<>'' GROUP BY k
      HAVING count(DISTINCT id)=1 AND min(id::text)::uuid=scope_id
    )
    SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.id),'[]'::jsonb) INTO family_registry_rows FROM(
      SELECT cm.id,cm.make,cm.canonical_model,cm.aliases,cm.year_start,cm.year_end
      FROM public.canonical_models cm JOIN unique_make_names n
        ON n.k=regexp_replace(lower(cm.make),'[^a-z0-9]','','g')
      WHERE nullif(btrim(cm.canonical_model),'') IS NOT NULL ORDER BY cm.id LIMIT 1001) m;
    IF jsonb_array_length(family_registry_rows)>1000 THEN
      RETURN jsonb_build_object('state','unavailable','reason','family_registry_model_cap_exceeded');
    END IF;
    IF NOT EXISTS(SELECT 1 FROM jsonb_to_recordset(family_registry_rows)
      AS m(id uuid,canonical_model text) GROUP BY lower(m.canonical_model)
      HAVING min(m.id::text)=family_key AND min(m.canonical_model)=family_rule->>'family') THEN
      RETURN jsonb_build_object('state','unavailable','reason','stale_or_unregistered_recorded_family');
    END IF;
    scope_receipt:=jsonb_build_object('kind',scope_kind,'canonical_make_id',scope_id,
      'family_key',family_key,'family',family_rule->>'family','year',family_year,
      'year_start',family_year_start,'year_end',family_year_end,'model_name',family_model,
      'label',scope_row.canonical_name||' '||(family_rule->>'family'),
      'admission_purpose','captured_sell_through_recorded_family',
      'membership_method','recorded_market_family_membership_v1','family_rule',family_rule,
      'registry_inputs_fingerprint',md5(family_registry_rows::text),
      'comparison_basis','current recorded family navigation, qualified by current registry phrases; not factory, condition, build or valuation equivalence',
      'year_policy','exact requested year or inclusive requested range; otherwise recorded family range with one year slack; unknown year allowed without an exact year filter',
      'model_policy','optional literal case-insensitive trimmed parent model label; no wildcard expansion');
  ELSIF scope_kind='canonical_make' THEN
    SELECT id,canonical_name INTO scope_row FROM public.canonical_makes WHERE id=scope_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('state','unavailable','reason','unknown_canonical_make');
    END IF;
    scope_receipt:=jsonb_build_object('kind',scope_kind,'canonical_make_id',scope_id,
      'label',scope_row.canonical_name,'membership_method','canonical_make_fk_or_unique_exact_registry_name_alias',
      'comparison_basis','make population, not condition-equivalent valuation cohort');
  ELSIF scope_kind='descriptive_subject' THEN
    SELECT * INTO scope_row FROM public.cohort_scope_rule(ARRAY[scope_id],'captured_sell_through_descriptive');
    IF NOT FOUND THEN
      RETURN jsonb_build_object('state','unavailable','reason','unsupported_or_unknown_descriptive_subject');
    END IF;
    IF scope_row.state<>'admitted' THEN
      RETURN jsonb_build_object('state','unavailable','reason','unsupported_or_unknown_descriptive_subject',
        'scope_admission',jsonb_build_object('subject_id',scope_id,'state',scope_row.state,'reason',scope_row.reason,
          'admission_purpose',scope_row.admission_purpose));
    END IF;
    subject_make:=scope_row.canonical_make; subject_grain:=scope_row.grain;
    subject_year:=scope_row.year; subject_year_start:=scope_row.year_start; subject_year_end:=scope_row.year_end;
    subject_model_id:=scope_row.canonical_model_id;
    scope_receipt:=jsonb_build_object('kind',scope_kind,'subject_id',scope_id,
      'label',scope_row.canonical_make||' '||scope_row.canonical_model,'grain',scope_row.grain,
      'year',scope_row.year,'year_start',scope_row.year_start,'year_end',scope_row.year_end,
      'canonical_model_id',scope_row.canonical_model_id,'registered_model_label',scope_row.registered_model_label,
      'comparison_scope_status',scope_row.comparison_scope_status,
      'admission_purpose',scope_row.admission_purpose,'membership_method',scope_row.membership_method,
      'comparison_basis','descriptive recorded year and uniquely resolved model labels; no condition, factory generation or valuation equivalence');
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
    FROM public.auction_events_canonical e JOIN public.vehicles v ON v.id=e.vehicle_id
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
  ), family_registry AS MATERIALIZED (
    SELECT m.* FROM jsonb_to_recordset(coalesce(family_registry_rows,'[]'::jsonb))
      AS m(id uuid,canonical_model text,aliases text[],year_start integer,year_end integer)
  ), registered_families AS MATERIALIZED (
    SELECT lower(canonical_model) family_l,min(canonical_model) family,min(id::text)::uuid family_id,
      CASE WHEN bool_or(year_start IS NULL) THEN NULL ELSE min(year_start) END year_start,
      CASE WHEN bool_or(year_end IS NULL) THEN NULL ELSE max(year_end) END year_end
    FROM family_registry GROUP BY lower(canonical_model)
  ), registered_phrases AS MATERIALIZED (
    SELECT DISTINCT f.family_id,p.phrase,cardinality(string_to_array(p.phrase,' ')) words
    FROM family_registry r JOIN registered_families f ON f.family_l=lower(r.canonical_model)
    CROSS JOIN LATERAL unnest(array_append(coalesce(r.aliases,'{}'::text[]),r.canonical_model)) a
    CROSS JOIN LATERAL(SELECT btrim(regexp_replace(lower(a),'[^a-z0-9]+',' ','g')) phrase) p
    WHERE p.phrase<>'' AND cardinality(string_to_array(p.phrase,' '))<=4
  ), family_names AS MATERIALIZED (
    SELECT DISTINCT lower(b.make) make_l,lower(coalesce(b.model,'')) model_l,
      btrim(regexp_replace(lower(b.model),'[^a-z0-9]+',' ','g')) normalized_model
    FROM bounded b JOIN make_resolved mk ON mk.make_l IS NOT DISTINCT FROM lower(b.make)
      AND mk.canonical_make_id IS NOT DISTINCT FROM b.canonical_make_id
    WHERE scope_kind='recorded_family' AND mk.resolved_make_id=scope_id
  ), family_phrase_hits AS MATERIALIZED (
    SELECT n.make_l,n.model_l,p.family_id,p.phrase,p.words,
      max(p.words) OVER(PARTITION BY n.make_l,n.model_l) longest
    FROM family_names n JOIN registered_phrases p
      ON length(n.model_l)<=512 AND strpos(' '||n.normalized_model||' ',' '||p.phrase||' ')>0
  ), family_hit_keys AS MATERIALIZED (
    SELECT make_l,model_l,count(DISTINCT family_id) family_count,min(family_id::text)::uuid family_id,
      (array_agg(DISTINCT family_id ORDER BY family_id))[1:20] matching_family_ids,
      md5(string_agg(family_id::text||':'||phrase,',' ORDER BY family_id,phrase)) keys_fingerprint
    FROM family_phrase_hits WHERE words=longest GROUP BY make_l,model_l
  ), family_name_info AS MATERIALIZED (
    SELECT n.make_l,n.model_l,d.family_id,d.family,d.matched,d.year_start,d.year_end,
      coalesce(h.family_count,0) family_count,h.matching_family_ids,h.keys_fingerprint,
      coalesce(d.family_id IS NOT NULL AND f.family IS NOT DISTINCT FROM d.family
        AND f.year_start IS NOT DISTINCT FROM d.year_start AND f.year_end IS NOT DISTINCT FROM d.year_end
        AND EXISTS(SELECT 1 FROM family_phrase_hits ph WHERE ph.make_l IS NOT DISTINCT FROM n.make_l
          AND ph.model_l=n.model_l AND ph.family_id=d.family_id AND ph.words=ph.longest AND ph.phrase=d.matched),false) dictionary_current,
      coalesce(h.family_count>1 AND NOT EXISTS(SELECT 1 FROM family_phrase_hits ph
        WHERE ph.make_l IS NOT DISTINCT FROM n.make_l AND ph.model_l=n.model_l AND ph.words=ph.longest
        AND NOT(family_rule->'family_keys' ? ph.family_id::text)),false) all_longest_families_in_scope,
      CASE WHEN n.model_l='' THEN 'missing_recorded_model_label'
        WHEN length(n.model_l)>512 THEN 'recorded_model_label_too_long'
        WHEN d.make_l IS NULL THEN 'dictionary_name_missing'
        WHEN d.family_id IS NULL THEN 'unmapped_recorded_model'
        WHEN coalesce(h.family_count,0)=0 THEN 'family_phrase_no_longer_registered'
        WHEN h.family_count>1 THEN 'ambiguous_longest_registered_family_phrases'
        WHEN h.family_id IS DISTINCT FROM d.family_id OR f.family IS DISTINCT FROM d.family
          OR f.year_start IS DISTINCT FROM d.year_start OR f.year_end IS DISTINCT FROM d.year_end
          OR NOT EXISTS(SELECT 1 FROM family_phrase_hits ph WHERE ph.make_l IS NOT DISTINCT FROM n.make_l
            AND ph.model_l=n.model_l AND ph.family_id=d.family_id AND ph.words=ph.longest AND ph.phrase=d.matched)
          THEN 'stale_dictionary_family_or_phrase'
        ELSE 'qualified_recorded_family_phrase' END family_reason
    FROM family_names n LEFT JOIN public.mv_model_family_names d ON d.make_l=n.make_l AND d.model_l=n.model_l
    LEFT JOIN family_hit_keys h ON h.make_l IS NOT DISTINCT FROM n.make_l AND h.model_l=n.model_l
    LEFT JOIN registered_families f ON f.family_id=d.family_id
  ), classified AS MATERIALIZED (
    SELECT b.*,mk.resolved_make_id,mdl.model_count,mdl.model_ids,mdl.model_keys_fingerprint,
      fn.family_id AS recorded_family_id,fn.family_reason,
      jsonb_build_object('method','recorded_market_family_membership_v1',
        'resolved_make_id',mk.resolved_make_id,'requested_family_key',family_key,
        'recorded_family_id',fn.family_id,'recorded_family',fn.family,'matched_phrase',fn.matched,
        'family_year_start',fn.year_start,'family_year_end',fn.year_end,
        'current_longest_family_count',fn.family_count,'matching_family_ids',coalesce(to_jsonb(fn.matching_family_ids),'[]'::jsonb),
        'matching_family_keys_limit',20,'matching_family_keys_truncated',fn.family_count>20,
        'matching_family_keys_fingerprint',fn.keys_fingerprint,
        'dictionary_reason',fn.family_reason,'dictionary_current',fn.dictionary_current,
        'all_longest_families_in_scope',fn.all_longest_families_in_scope,'series_name_contains',sw.word,
        'dictionary_source','mv_model_family_names','dictionary_row_clock','unavailable',
        'family_rule_fingerprint',family_rule->>'fingerprint',
        'identity_basis','current_parent_record','factory_configuration_verified',false) family_witness,
      CASE WHEN mk.resolved_make_id IS NULL THEN NULL
        WHEN scope_kind='canonical_make' THEN CASE WHEN mk.resolved_make_id=scope_id THEN 'selected' ELSE 'benchmark' END
        WHEN scope_kind='descriptive_subject' THEN CASE
          WHEN lower(make_entity.canonical_name)<>lower(subject_make) THEN 'benchmark'
          WHEN b.year IS NOT NULL AND b.year NOT BETWEEN 1885 AND 2100 THEN NULL
          WHEN subject_grain='year' AND b.year IS NULL THEN NULL
          WHEN (subject_grain='year' AND b.year<>subject_year)
            OR (subject_grain='model' AND b.year IS NOT NULL AND
              ((subject_year_start IS NOT NULL AND b.year<subject_year_start)
                OR (subject_year_end IS NOT NULL AND b.year>subject_year_end))) THEN 'benchmark'
          WHEN mdl.model_count<>1 THEN NULL
          WHEN mdl.resolved_model_id=subject_model_id THEN 'selected' ELSE 'benchmark' END
        WHEN scope_kind='recorded_family' THEN CASE
          WHEN mk.resolved_make_id<>scope_id THEN 'benchmark'
          WHEN b.year IS NOT NULL AND b.year NOT BETWEEN 1885 AND 2100 THEN NULL
          WHEN (family_year IS NOT NULL OR family_year_start IS NOT NULL) AND b.year IS NULL THEN NULL
          WHEN family_year IS NOT NULL AND b.year<>family_year THEN 'benchmark'
          WHEN family_year_start IS NOT NULL AND b.year NOT BETWEEN family_year_start AND family_year_end THEN 'benchmark'
          WHEN family_model IS NOT NULL AND nullif(btrim(b.model),'') IS NULL THEN NULL
          WHEN family_model IS NOT NULL AND lower(btrim(b.model))<>family_model THEN 'benchmark'
          WHEN length(b.model)>512 THEN NULL
          -- Series names are the existing declared source-label rule, not a
          -- factory family assertion. Its witness remains separate and literal.
          WHEN sw.word IS NOT NULL THEN 'selected'
          -- A set can be known when its precise member is not: every longest
          -- candidate family may belong to the same declared pickup union.
          -- Keep the ambiguity in the witness; never choose a factory family.
          WHEN fn.dictionary_current AND fn.all_longest_families_in_scope
            AND (b.year IS NULL OR ((fn.year_start IS NULL OR b.year>=fn.year_start-1)
              AND(fn.year_end IS NULL OR b.year<=fn.year_end+1))) THEN 'selected'
          WHEN fn.family_reason IS DISTINCT FROM 'qualified_recorded_family_phrase' THEN NULL
          WHEN b.year IS NOT NULL AND ((fn.year_start IS NOT NULL AND b.year<fn.year_start-1)
            OR(fn.year_end IS NOT NULL AND b.year>fn.year_end+1)) THEN NULL
          WHEN family_rule->'family_keys' ? fn.family_id::text THEN 'selected'
          ELSE 'benchmark' END
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
    LEFT JOIN family_name_info fn ON fn.make_l IS NOT DISTINCT FROM lower(b.make)
      AND fn.model_l=lower(coalesce(b.model,''))
    LEFT JOIN LATERAL(SELECT min(w) word FROM jsonb_array_elements_text(family_rule->'model_contains') w
      WHERE scope_kind='recorded_family' AND mk.resolved_make_id=scope_id AND strpos(lower(b.model),w)>0) sw ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS model_count,min(cm.id::text)::uuid AS resolved_model_id,
        (array_agg(cm.id ORDER BY cm.id) FILTER(WHERE scope_kind='descriptive_subject'))[1:20] AS model_ids,
        md5(string_agg(cm.id::text,',' ORDER BY cm.id) FILTER(WHERE scope_kind='descriptive_subject')) AS model_keys_fingerprint
      FROM public.canonical_models cm
      WHERE scope_kind IN('supported_subject','descriptive_subject')
        AND lower(make_entity.canonical_name)=lower(subject_make)
        AND ((scope_kind='supported_subject' AND ((subject_grain='year' AND b.year=subject_year)
          OR (subject_grain<>'year' AND b.year BETWEEN subject_year_start AND subject_year_end)))
          OR (scope_kind='descriptive_subject' AND ((subject_grain='year' AND b.year=subject_year)
            OR (subject_grain='model' AND (b.year IS NULL OR
              ((subject_year_start IS NULL OR b.year>=subject_year_start)
                AND (subject_year_end IS NULL OR b.year<=subject_year_end)))))))
        AND NOT EXISTS(SELECT 1 FROM members m WHERE m.vehicle_id=b.vehicle_id)
        AND lower(cm.make)=CASE WHEN scope_kind='descriptive_subject'
          THEN lower(make_entity.canonical_name) ELSE lower(b.make) END
        AND ((scope_kind='descriptive_subject' AND subject_grain='model' AND b.year IS NULL)
          OR ((cm.year_start IS NULL OR b.year>=cm.year_start) AND (cm.year_end IS NULL OR b.year<=cm.year_end)))
        AND (lower(cm.canonical_model)=lower(b.model)
          OR lower(b.model)=ANY(SELECT lower(a) FROM unnest(cm.aliases) a))
    ) mdl ON scope_kind IN('supported_subject','descriptive_subject')
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
  ), measured AS MATERIALIZED (
    SELECT e.*,CASE WHEN e.recorded_sold THEN 'sold'
      -- The lander can default no_sale when extraction found no result. Only its
      -- affirmative reserve-not-met result is admitted as a known failure here.
      WHEN NOT e.conflict AND e.outcome='reserve_not_met' THEN 'no_sale'
      WHEN NOT e.conflict AND e.outcome='cancelled' THEN 'withdrawn'
      ELSE 'unresolved' END AS outcome_class
    FROM episodes e
  ), scope_exclusion_rows AS MATERIALIZED (
    SELECT e.*,CASE WHEN e.conflict THEN 'conflicting_listing_aliases'
      WHEN e.resolved_make_id IS NULL THEN 'unresolved_make'
      WHEN e.year IS NOT NULL AND e.year NOT BETWEEN 1885 AND 2100 THEN 'invalid_recorded_year'
      WHEN scope_kind='recorded_family' THEN CASE
        WHEN (family_year IS NOT NULL OR family_year_start IS NOT NULL) AND e.year IS NULL THEN 'missing_recorded_year'
        WHEN e.family_reason IS DISTINCT FROM 'qualified_recorded_family_phrase'
          THEN coalesce(e.family_reason,'unresolved_membership')
        ELSE 'recorded_year_outside_family_range' END
      WHEN subject_grain='year' AND e.year IS NULL THEN 'missing_recorded_year'
      WHEN e.model_count=0 THEN 'no_exact_registered_model_label'
      WHEN e.model_count>1 THEN 'ambiguous_exact_registered_model_keys'
      ELSE 'unresolved_membership' END AS membership_reason,
      row_number() OVER(ORDER BY e.event_at,e.id) AS scope_position
    FROM measured e WHERE scope_kind IN('descriptive_subject','recorded_family') AND e.series IS NULL
  ), fingerprint AS MATERIALIZED (
    -- A continuation detects changed public source/membership; it is not historical version storage.
    SELECT md5((jsonb_build_array('captured_auction_outcomes',1,scope_receipt,event_from,event_to,
      evidence_kind,evidence_day,evidence_series,(SELECT count(*) FROM candidates),
      COALESCE((SELECT jsonb_agg(jsonb_build_array(e.source_key,e.id,e.vehicle_id,e.event_at,
        e.source_event_ids,e.outcome,e.winning_bid,e.series,e.conflict,e.updated_at,e.year,e.make,e.model,
        e.source_observed_at,e.source_read_basis) ORDER BY e.source_key) FROM measured e),'[]'::jsonb))
      ||CASE WHEN scope_kind='descriptive_subject' THEN jsonb_build_array(
        COALESCE((SELECT jsonb_agg(jsonb_build_array(e.source_key,e.id,e.membership_reason,
          e.canonical_make_id,e.resolved_make_id,e.model_count,e.model_keys_fingerprint) ORDER BY e.source_key) FROM scope_exclusion_rows e),'[]'::jsonb))
        WHEN scope_kind='recorded_family' THEN jsonb_build_array(
          coalesce((SELECT jsonb_agg(jsonb_build_array(e.source_key,e.id,e.family_witness) ORDER BY e.source_key)
            FROM measured e),'[]'::jsonb)) ELSE '[]'::jsonb END)::text) AS hash
  ), buckets AS MATERIALIZED (
    SELECT gs AS bucket_start,GREATEST(gs,event_from) AS window_from,
      LEAST(gs+interval '1 day',event_to) AS window_to
    FROM generate_series(date_trunc('day',event_from),date_trunc('day',event_to-interval '1 microsecond'),interval '1 day') gs
  ), points AS MATERIALIZED (
    SELECT b.*,s.series,count(e.id) AS eligible,
      count(e.id) FILTER(WHERE e.recorded_sold) AS sold,
      count(e.id) FILTER(WHERE e.outcome_class='no_sale') AS bidding_no_sale,
      count(e.id) FILTER(WHERE e.outcome_class='withdrawn') AS withdrawn,
      count(e.id) FILTER(WHERE e.outcome_class='unresolved') AS unresolved,
      count(e.id) FILTER(WHERE NOT e.conflict AND e.outcome IN('reserve_not_met','no_sale','cancelled')) AS explicit_no_sale,
      count(e.id) FILTER(WHERE NOT e.conflict AND e.outcome='bid_to') AS bid_to,
      count(e.id) FILTER(WHERE NOT e.conflict AND e.outcome='sold' AND NOT e.recorded_sold) AS unsupported_sold_amount,
      count(e.id) FILTER(WHERE NOT e.conflict AND (e.outcome IS NULL OR e.outcome IN('live','pending','relisted'))) AS ended_pending,
      count(e.id) FILTER(WHERE e.source_observed_at IS NOT NULL) AS known_clocks,
      min(e.event_at) AS first_event,max(e.event_at) AS last_event,max(e.source_observed_at) AS latest_observed
    FROM buckets b CROSS JOIN(VALUES('selected'::text),('benchmark'::text)) s(series)
    LEFT JOIN measured e ON e.series=s.series AND e.event_at>=b.window_from AND e.event_at<b.window_to
    GROUP BY b.bucket_start,b.window_from,b.window_to,s.series
  ), evidence AS MATERIALIZED (
    SELECT e.*,row_number() OVER(PARTITION BY event_at::date,series ORDER BY event_at,id) AS position
    FROM measured e WHERE e.series IS NOT NULL AND NOT e.conflict AND (
      (requested_metric='recorded_sale_events' AND e.recorded_sold) OR
      (requested_metric='captured_sell_through' AND (
        (evidence_kind='known_bidding_outcome' AND e.outcome_class IN('sold','no_sale'))
        OR e.outcome_class=evidence_kind)))
      AND(evidence_day IS NULL OR event_at::date=evidence_day)
      AND(evidence_series IS NULL OR e.series=evidence_series)
  )
  , window_totals AS MATERIALIZED (
    SELECT series,sum(eligible) AS eligible,sum(sold) AS sold,sum(bidding_no_sale) AS no_sale,
      sum(withdrawn) AS withdrawn,sum(unresolved) AS unresolved FROM points GROUP BY series
  )
  SELECT CASE WHEN requested_metric='captured_sell_through' THEN
    jsonb_build_object(
      'contract_version',1,'metric_id',requested_metric,'state','partial',
      'reason',CASE WHEN (SELECT count(*) FROM candidates)>2000 THEN 'candidate_cap_exceeded'
        ELSE 'retained_capture_only_platform_completeness_unknown' END,
      'unit','fraction_of_known_retained_bidding_outcomes','scope',scope_receipt,
      'benchmark',jsonb_build_object('kind','same_platform_excluding_scope','excludes_scope',true,
        'label','Rest of captured BaT'),
      'source_registry',jsonb_build_object('id',source_row.id,'slug',source_row.slug,'display_name',source_row.display_name),
      'knowledge_mode','current_recorded_state','knowledge_cutoff',cutoff,'generated_at',cutoff,
      'event_from',event_from,'event_to',event_to,'event_time_basis','recorded_episode_end_not_settlement',
      'method_id','captured_auction_outcomes','method_version',1,
      'reserve_policy','all_recorded_policies','reserve_policy_stratified',false,
      'grain','one slash-normalized platform listing episode','weighting','one episode one count',
      'candidate_limit',2000,'captured_candidates',(SELECT count(*) FROM candidates),
      'truncated',(SELECT count(*) FROM candidates)>2000,
      'coverage',jsonb_build_object('eligible_recorded_episodes',(SELECT count(*) FROM episodes),
        'unresolved_scope',(SELECT count(*) FROM episodes WHERE series IS NULL),
        'conflicting_alias_episodes',(SELECT count(*) FROM episodes WHERE conflict),
        'complete_external_capture',false,'historical_knowledge_versions_available',false,
        'captured_ratios_supported',(SELECT count(*) FROM candidates)<=2000,
        'platform_sell_through_supported',false,'settlement_verified',false),
      'summary',COALESCE((SELECT jsonb_agg(jsonb_build_object('series',t.series,
        'state',CASE WHEN (SELECT count(*) FROM candidates)>2000 OR t.sold+t.no_sale=0 THEN 'unknown' ELSE 'partial' END,
        'reason',CASE WHEN (SELECT count(*) FROM candidates)>2000 THEN 'candidate_cap_exceeded'
          WHEN t.sold+t.no_sale=0 THEN 'no_known_retained_bidding_outcomes' ELSE 'retained_capture_only' END,
        'numerator',CASE WHEN (SELECT count(*) FROM candidates)<=2000 THEN t.sold END,
        'denominator',CASE WHEN (SELECT count(*) FROM candidates)<=2000 THEN t.sold+t.no_sale END,
        'ratio',CASE WHEN (SELECT count(*) FROM candidates)<=2000 THEN t.sold/nullif(t.sold+t.no_sale,0) END,
        'withdrawn',t.withdrawn,'unresolved',t.unresolved) ORDER BY t.series) FROM window_totals t),'[]'::jsonb),
      'series',COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'bucket_start',p.bucket_start,'event_from',p.window_from,'event_to',p.window_to,'series',p.series,
        'metric_id',requested_metric,'state','partial',
        'value_reason',CASE WHEN (SELECT count(*) FROM candidates)>2000 THEN 'candidate_cap_exceeded'
          WHEN p.sold+p.bidding_no_sale=0 THEN 'no_known_retained_bidding_outcomes' ELSE 'retained_capture_only' END,
        'value',CASE WHEN (SELECT count(*) FROM candidates)<=2000 THEN p.sold::numeric/nullif(p.sold+p.bidding_no_sale,0) END,
        'ratio',CASE WHEN (SELECT count(*) FROM candidates)<=2000 THEN p.sold::numeric/nullif(p.sold+p.bidding_no_sale,0) END,
        'numerator',CASE WHEN (SELECT count(*) FROM candidates)<=2000 THEN p.sold END,
        'denominator',CASE WHEN (SELECT count(*) FROM candidates)<=2000 THEN p.sold+p.bidding_no_sale END,
        'unit','fraction_of_known_retained_bidding_outcomes','absolute_change',NULL,'relative_change',NULL,
        'difference_vs_benchmark',CASE WHEN (SELECT count(*) FROM candidates)<=2000 AND p.series='selected' THEN
          p.sold::numeric/nullif(p.sold+p.bidding_no_sale,0)-b.sold::numeric/nullif(b.sold+b.bidding_no_sale,0) END,
        'knowledge_cutoff',cutoff,'source_observed_at',p.latest_observed,'folded_at',cutoff,
        'fold_basis','query_time_current_recorded_state','method_id','captured_auction_outcomes','method_version',1,
        'coverage',jsonb_build_object('captured_eligible',p.eligible,'captured_sold',p.sold,
          'captured_known_outcomes',p.sold+p.bidding_no_sale,'explicit_no_sale',p.bidding_no_sale,
          'withdrawn',p.withdrawn,'unresolved',p.unresolved,
          'outcome_coverage',CASE WHEN (SELECT count(*) FROM candidates)<=2000 THEN
            (p.sold+p.bidding_no_sale)::numeric/nullif(p.sold+p.bidding_no_sale+p.unresolved,0) END,
          'source_clock_known',p.known_clocks,'source_clock_unknown',p.eligible-p.known_clocks,
          'earliest_event',p.first_event,'latest_event',p.last_event,
          'bucket_elapsed_seconds',extract(epoch FROM p.window_to-p.window_from),'full_bucket_seconds',86400,
          'incomplete_bucket',p.window_from>p.bucket_start OR p.window_to<p.bucket_start+interval '1 day',
          'complete_external_capture',false,'truncated',(SELECT count(*) FROM candidates)>2000))
        ORDER BY p.bucket_start,p.series) FROM points p LEFT JOIN points b
          ON b.bucket_start=p.bucket_start AND b.series='benchmark'),'[]'::jsonb),
      'evidence',jsonb_build_object('snapshot_hash',(SELECT hash FROM fingerprint),
        'per_bucket_series_limit',evidence_cap,'offset',evidence_offset,'outcome_filter',evidence_kind,
        'pagination_supported',true,'immutable_snapshot',false,
        'has_more',EXISTS(SELECT 1 FROM evidence WHERE position>evidence_offset+evidence_cap),
        'next_offset',CASE WHEN EXISTS(SELECT 1 FROM evidence WHERE position>evidence_offset+evidence_cap)
          THEN evidence_offset+evidence_cap END,
        'contributors',COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'auction_event_id',e.id,'source_event_ids',e.source_event_ids,'vehicle_id',e.vehicle_id,
          'vehicle_identity',jsonb_build_object('year',e.year,'make',e.make,'model',e.model),
          'vehicle_identity_basis','current_parent_record',
          'source_url',e.source_key||'/','event_at',e.event_at,'event_time_basis','recorded_episode_end',
          'latest_source_row_write',e.updated_at,'knowledge_cutoff',cutoff,
          'source_observed_at',e.source_observed_at,'source_read_basis',e.source_read_basis,
          'series',e.series,'bucket_start',date_trunc('day',e.event_at),'outcome_class',e.outcome_class,
          'source_outcome',e.outcome,
          'outcome_reason',CASE WHEN e.outcome_class<>'unresolved' THEN 'explicit_source_outcome'
            WHEN e.outcome='sold' THEN 'sold_without_positive_finite_amount'
            WHEN e.outcome='no_sale' THEN 'no_sale_without_affirmative_result_witness'
            WHEN e.outcome='bid_to' THEN 'bid_to_not_a_supported_sale'
            WHEN e.outcome IN('live','pending','relisted') THEN 'ended_without_final_outcome'
            ELSE 'unrecognized_or_missing_outcome' END,
          'numerator_contribution',CASE WHEN e.outcome_class='sold' THEN 1 ELSE 0 END,
          'denominator_contribution',CASE WHEN e.outcome_class IN('sold','no_sale') THEN 1 ELSE 0 END,
          'method_id','captured_auction_outcomes','method_version',1)
          ||CASE WHEN scope_kind='recorded_family' THEN jsonb_build_object('membership',e.family_witness) ELSE '{}'::jsonb END
          ORDER BY e.event_at,e.id) FROM evidence e
          WHERE position>evidence_offset AND position<=evidence_offset+evidence_cap),'[]'::jsonb)))
    ||CASE WHEN scope_kind='descriptive_subject' THEN jsonb_build_object('scope_exclusions',jsonb_build_object(
      'contract_version',1,'state',CASE WHEN (SELECT count(*) FROM candidates)>2000 THEN 'unavailable' ELSE 'partial' END,
      'reason',CASE WHEN (SELECT count(*) FROM candidates)>2000 THEN 'candidate_cap_exceeded' ELSE 'unresolved_membership_not_assigned_to_either_series' END,
      'membership_method',scope_receipt->>'membership_method','snapshot_hash',(SELECT hash FROM fingerprint),
      'record_limit',20,'complete_external_capture',false,'current_parent_identity_only',true,
      'total',CASE WHEN (SELECT count(*) FROM candidates)<=2000 THEN (SELECT count(*) FROM scope_exclusion_rows) END,
      'records_truncated',CASE WHEN (SELECT count(*) FROM candidates)<=2000 THEN (SELECT count(*)>20 FROM scope_exclusion_rows) END,
      'omitted_records',CASE WHEN (SELECT count(*) FROM candidates)<=2000 THEN (SELECT greatest(0,count(*)-20) FROM scope_exclusion_rows) END,
      'reason_counts',CASE WHEN (SELECT count(*) FROM candidates)<=2000 THEN COALESCE((SELECT jsonb_agg(
        jsonb_build_object('reason',x.membership_reason,'episodes',x.n) ORDER BY x.membership_reason)
        FROM(SELECT membership_reason,count(*) n FROM scope_exclusion_rows GROUP BY membership_reason) x),'[]'::jsonb) END,
      'records',CASE WHEN (SELECT count(*) FROM candidates)>2000 THEN '[]'::jsonb ELSE COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'auction_event_id',e.id,'source_event_ids',e.source_event_ids,'vehicle_id',e.vehicle_id,
        'vehicle_identity',jsonb_build_object('year',e.year,'make',e.make,'model',e.model),
        'vehicle_identity_basis','current_representative_parent_record',
        'source_url',e.source_key||'/','event_at',e.event_at,'event_time_basis','recorded_episode_end',
        'source_observed_at',e.source_observed_at,'source_read_basis',e.source_read_basis,
        'source_outcome',e.outcome,'recorded_outcome_class',e.outcome_class,
        'membership_reason',e.membership_reason,'conflicting_listing_aliases',e.conflict,
        'recorded_canonical_make_id',e.canonical_make_id,'resolved_make_id',e.resolved_make_id,
        'requested_canonical_model_id',subject_model_id,
        'exact_registered_model_count',e.model_count,'matching_model_keys_limit',20,
        'matching_model_keys_fingerprint',e.model_keys_fingerprint,
        'matching_model_keys_truncated',e.model_count>20,'matching_model_ids',coalesce(to_jsonb(e.model_ids),'[]'::jsonb))
        ORDER BY e.event_at,e.id) FROM scope_exclusion_rows e WHERE e.scope_position<=20),'[]'::jsonb) END))
      WHEN scope_kind='recorded_family' THEN jsonb_build_object('scope_exclusions',jsonb_build_object(
      'contract_version',2,'state',CASE WHEN (SELECT count(*) FROM candidates)>2000 THEN 'unavailable' ELSE 'partial' END,
      'reason',CASE WHEN (SELECT count(*) FROM candidates)>2000 THEN 'candidate_cap_exceeded'
        ELSE 'unresolved_membership_not_assigned_to_either_series' END,
      'membership_method',scope_receipt->>'membership_method','snapshot_hash',(SELECT hash FROM fingerprint),
      'record_limit',20,'complete_external_capture',false,'current_parent_identity_only',true,
      'total',CASE WHEN (SELECT count(*) FROM candidates)<=2000 THEN (SELECT count(*) FROM scope_exclusion_rows) END,
      'records_truncated',CASE WHEN (SELECT count(*) FROM candidates)<=2000 THEN (SELECT count(*)>20 FROM scope_exclusion_rows) END,
      'omitted_records',CASE WHEN (SELECT count(*) FROM candidates)<=2000 THEN (SELECT greatest(0,count(*)-20) FROM scope_exclusion_rows) END,
      'reason_counts',CASE WHEN (SELECT count(*) FROM candidates)<=2000 THEN coalesce((SELECT jsonb_agg(
        jsonb_build_object('reason',x.membership_reason,'episodes',x.n) ORDER BY x.membership_reason)
        FROM(SELECT membership_reason,count(*) n FROM scope_exclusion_rows GROUP BY membership_reason) x),'[]'::jsonb) END,
      'records',CASE WHEN (SELECT count(*) FROM candidates)>2000 THEN '[]'::jsonb ELSE coalesce((SELECT jsonb_agg(jsonb_build_object(
        'auction_event_id',e.id,'source_event_ids',e.source_event_ids,'vehicle_id',e.vehicle_id,
        'vehicle_identity',jsonb_build_object('year',e.year,'make',e.make,'model',e.model),
        'vehicle_identity_basis','current_representative_parent_record',
        'source_url',e.source_key||'/','event_at',e.event_at,'event_time_basis','recorded_episode_end',
        'source_observed_at',e.source_observed_at,'source_read_basis',e.source_read_basis,
        'source_outcome',e.outcome,'recorded_outcome_class',e.outcome_class,
        'membership_reason',e.membership_reason,'conflicting_listing_aliases',e.conflict,
        'recorded_canonical_make_id',e.canonical_make_id,'resolved_make_id',e.resolved_make_id,
        'requested_family_key',family_key,'membership',e.family_witness)
        ORDER BY e.event_at,e.id) FROM scope_exclusion_rows e WHERE e.scope_position<=20),'[]'::jsonb) END))
      ELSE '{}'::jsonb END
  ELSE jsonb_build_object(
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
  ) END INTO result;
  IF requested_metric='captured_sell_through' AND expected_snapshot IS NOT NULL
    AND expected_snapshot IS DISTINCT FROM result#>>'{evidence,snapshot_hash}' THEN
    RETURN jsonb_build_object('contract_version',1,'metric_id',requested_metric,
      'state','unavailable','reason','evidence_snapshot_changed','knowledge_mode','current_recorded_state',
      'knowledge_cutoff',cutoff);
  END IF;
  RETURN result;
END;
$function$;
COMMENT ON FUNCTION public.get_market_trends(jsonb) IS
'Bounded current-recorded market outcomes with explicit recorded_family captured scope. Reuses the existing family navigation recipe, current cached phrase assignment and a bounded unique-longest current-registry contrary-evidence guard. Exact optional year and literal model leaf; same episode, public-parent, outcome,5second and continuation rules. Family witnesses and version2unresolved records carry keys/phrases/reasons; recipe/current-registry changes invalidate continuation. All prior scopes retain their original purpose and payloads. No testimony/registry rewrite, factory/build equivalence, historical state, complete capture, settlement, reserve adjustment, price or profit qualification.';

COMMIT;
