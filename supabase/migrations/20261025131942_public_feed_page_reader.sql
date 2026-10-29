-- Stage1: an independently public-only service reader. The existing materialized
-- view, public grants, refresh job and Edge callers are unchanged in this phase.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='10s';
DO $preflight$
DECLARE existing oid:=to_regprocedure('public.feed_public_page_read(jsonb,text,text,text,uuid,boolean,integer)');
BEGIN
  IF (SELECT relkind FROM pg_class WHERE oid=to_regclass('public.vehicle_valuation_feed')) IS DISTINCT FROM 'm'
     OR md5(pg_get_viewdef('public.vehicle_valuation_feed'::regclass,true))<>'4cd141b867466068a9ddf1d1770e9baa' THEN -- gitleaks:allow (SQL definition MD5, not a credential)
    RAISE EXCEPTION 'feed cache preimage changed; review reader payload before deploying';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
      AND p.proname='feed_public_page_read' AND p.oid IS DISTINCT FROM existing) THEN
    RAISE EXCEPTION 'unexpected feed reader signature; review canonical ownership';
  END IF;
  IF existing IS NOT NULL AND EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=existing AND (
      pg_get_userbyid(p.proowner)<>current_user OR p.prosecdef OR p.provolatile<>'s'
      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp']
      OR md5(p.prosrc)<>'68203db205fd7a5f81a6bf76d44c294a' -- gitleaks:allow (SQL body MD5, not a credential)
      OR NOT has_function_privilege('service_role',p.oid,'EXECUTE')
      OR has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE')
      OR EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        WHERE a.grantee NOT IN (p.proowner,'service_role'::regrole) OR a.privilege_type<>'EXECUTE' OR a.is_grantable)
    )
  ) THEN RAISE EXCEPTION 'existing feed reader owner/access/body drift; review before replacing'; END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.feed_public_page_read(
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_sort text DEFAULT 'feed_rank',
  p_direction text DEFAULT NULL,
  p_cursor_value text DEFAULT NULL,
  p_cursor_vehicle_id uuid DEFAULT NULL,
  p_cursor_is_null boolean DEFAULT false,
  p_limit integer DEFAULT 50
) RETURNS TABLE (
  "vehicle_id" uuid,
  "year" integer,
  "make" text,
  "model" text,
  "series" text,
  "trim" text,
  "transmission" text,
  "drivetrain" text,
  "body_style" text,
  "canonical_body_style" text,
  "mileage" integer,
  "vin" text,
  "is_for_sale" boolean,
  "sale_status" text,
  "sale_date" date,
  "created_at" timestamp with time zone,
  "updated_at" timestamp with time zone,
  "auction_end_at" timestamp with time zone,
  "event_at" timestamp with time zone,
  "discovery_url" text,
  "discovery_source" text,
  "profile_origin" text,
  "origin_organization_id" uuid,
  "city" text,
  "state" text,
  "listing_location" text,
  "canonical_vehicle_type" text,
  "has_photos" boolean,
  "primary_image_url" text,
  "thumbnail_url" text,
  "medium_url" text,
  "full_image_url" text,
  "description_snippet" text,
  "display_price" numeric,
  "price_source" text,
  "is_sold" boolean,
  "asking_price" numeric,
  "sale_price" integer,
  "current_value" numeric(10,2),
  "nuke_estimate" numeric(12,2),
  "nuke_estimate_low" numeric(12,2),
  "nuke_estimate_high" numeric(12,2),
  "nuke_estimate_confidence" integer,
  "price_tier" text,
  "deal_score" numeric(5,2),
  "deal_score_label" text,
  "heat_score" numeric(5,2),
  "heat_score_label" text,
  "is_record_price" boolean,
  "segment_record_price" numeric(12,2),
  "feed_rank_score" numeric
) LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path=pg_catalog,pg_temp
AS $reader$
DECLARE
  key text;
  value jsonb;
  member jsonb;
  array_cap integer;
  normalized_array text[];
  vehicle_types text[];
  dealer_ids uuid[];
  segment_makes text[];
  segment_model_patterns text[];
  makes text[];
  model_patterns text[];
  body_styles text[];
  excluded_sources text[];
  included_sources text[];
  sort_column text;
  sort_type text;
  direction text;
  operator text;
  fragment record;
  term_index integer;
  sql text;
  allowed constant text[] := ARRAY[
    'vehicle_types','excluded_dealer_ids','quality_min_price',
    'segment_year_min','segment_year_max','segment_makes','segment_model_terms',
    'year_min','year_max','makes','model_terms','body_styles','price_min','price_max',
    'is_4x4','for_sale','sold_only','hide_sold','has_images','event_not_after',
    'created_not_before','excluded_sources','included_sources','query_terms'];
BEGIN
  -- 128KiB accommodates the bounded2048 UUID exclusion list (~80KiB),
  -- plus other bounded filters. No array is truncated to fit this envelope.
  IF p_filters IS NULL OR jsonb_typeof(p_filters)<>'object' OR octet_length(p_filters::text)>131072 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid feed filters';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Feed limit must be between 1 and 200';
  END IF;
  FOR key,value IN SELECT * FROM jsonb_each(p_filters) LOOP
    IF NOT key=ANY(allowed) THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Unknown feed filter';
    END IF;
    IF value='null'::jsonb THEN CONTINUE; END IF;
    IF key=ANY(ARRAY['vehicle_types','excluded_dealer_ids','segment_makes','segment_model_terms','makes','model_terms','body_styles','excluded_sources','included_sources','query_terms']) THEN
      array_cap:=CASE key WHEN 'excluded_dealer_ids' THEN 2048 WHEN 'makes' THEN 40 WHEN 'model_terms' THEN 50 WHEN 'query_terms' THEN 32 ELSE 256 END;
      IF jsonb_typeof(value)<>'array' THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Feed array filter has invalid type';
      END IF;
      IF jsonb_array_length(value)>array_cap THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Feed array filter exceeds its bound';
      END IF;
      FOR member IN SELECT * FROM jsonb_array_elements(value) LOOP
        IF jsonb_typeof(member)<>'string' OR length(member#>>'{}')>512 THEN
          RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Feed array member has invalid type or length';
        END IF;
        IF key='excluded_dealer_ids' THEN PERFORM (member#>>'{}')::uuid; END IF;
      END LOOP;
      -- Bind typed arrays, rather than per-query InitPlans with unknown
      -- cardinality. This lets the custom ordered/limited plan cost exclusions.
      SELECT array_agg(v#>>'{}') INTO normalized_array FROM jsonb_array_elements(value) e(v);
      CASE key
        WHEN 'vehicle_types' THEN vehicle_types:=normalized_array;
        WHEN 'excluded_dealer_ids' THEN dealer_ids:=normalized_array::uuid[];
        WHEN 'segment_makes' THEN segment_makes:=normalized_array;
        WHEN 'segment_model_terms' THEN segment_model_patterns:=ARRAY(SELECT '%'||v||'%' FROM unnest(normalized_array) e(v));
        WHEN 'makes' THEN makes:=normalized_array;
        WHEN 'model_terms' THEN model_patterns:=ARRAY(SELECT '%'||v||'%' FROM unnest(normalized_array) e(v));
        WHEN 'body_styles' THEN body_styles:=normalized_array;
        WHEN 'excluded_sources' THEN excluded_sources:=normalized_array;
        WHEN 'included_sources' THEN included_sources:=normalized_array;
        ELSE NULL;
      END CASE;
    ELSIF key=ANY(ARRAY['quality_min_price','segment_year_min','segment_year_max','year_min','year_max','price_min','price_max']) THEN
      IF jsonb_typeof(value)<>'number' THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Feed numeric filter has invalid type';
      END IF;
      IF key=ANY(ARRAY['segment_year_min','segment_year_max','year_min','year_max']) THEN
        IF (value#>>'{}')::numeric<>trunc((value#>>'{}')::numeric) THEN
          RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Feed year filter must be an integer';
        END IF;
        PERFORM (value#>>'{}')::integer;
      END IF;
    ELSIF key=ANY(ARRAY['event_not_after','created_not_before']) THEN
      IF jsonb_typeof(value)<>'string' OR NOT isfinite((value#>>'{}')::timestamptz) THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Feed clock filter has invalid type or value';
      END IF;
    ELSIF jsonb_typeof(value)<>'boolean' THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Feed boolean filter has invalid type';
    END IF;
  END LOOP;

  SELECT c,t,d INTO sort_column,sort_type,direction FROM (VALUES
    ('newest','event_at','timestamp with time zone','desc'),
    ('oldest','event_at','timestamp with time zone','asc'),
    ('updated','updated_at','timestamp with time zone','desc'),
    ('deal_score','deal_score','numeric','desc'),
    ('heat_score','heat_score','numeric','desc'),
    ('price_high','display_price','numeric','desc'),
    ('price_low','display_price','numeric','asc'),
    ('year','year','integer','desc'),
    ('make','make','text','asc'),
    ('mileage','mileage','numeric','asc'),
    ('feed_rank','feed_rank_score','numeric','desc')
  ) sorts(k,c,t,d) WHERE k=p_sort;
  IF sort_column IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Unsupported feed sort';
  END IF;
  IF p_direction IS NOT NULL THEN
    IF p_direction NOT IN ('asc','desc') THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid feed sort direction';
    END IF;
    direction:=p_direction;
  END IF;
  IF p_cursor_is_null IS NULL
    OR (p_cursor_vehicle_id IS NULL AND (p_cursor_value IS NOT NULL OR p_cursor_is_null))
    OR (p_cursor_vehicle_id IS NOT NULL AND ((p_cursor_is_null AND p_cursor_value IS NOT NULL) OR (NOT p_cursor_is_null AND p_cursor_value IS NULL))) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid feed cursor';
  END IF;
  IF p_cursor_value IS NOT NULL AND length(p_cursor_value)>512 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Feed cursor value exceeds its bound';
  END IF;
  IF p_cursor_value IS NOT NULL THEN
    -- Validate even when other filters would make the selected page empty.
    EXECUTE format('SELECT $1::%s',sort_type) USING p_cursor_value;
  END IF;

  -- The visibility predicate, selected filters, ORDER and LIMIT share one query.
  -- Neither caller filters nor cursor values can replace the public-only boundary.
  sql:=$sql$SELECT f."vehicle_id", f."year", f."make", f."model", f."series", f."trim", f."transmission", f."drivetrain", f."body_style", f."canonical_body_style", f."mileage", f."vin", f."is_for_sale", f."sale_status", f."sale_date", f."created_at", f."updated_at", f."auction_end_at", f."event_at", f."discovery_url", f."discovery_source", f."profile_origin", f."origin_organization_id", f."city", f."state", f."listing_location", f."canonical_vehicle_type", f."has_photos", f."primary_image_url", f."thumbnail_url", f."medium_url", f."full_image_url", f."description_snippet", f."display_price", f."price_source", f."is_sold", f."asking_price", f."sale_price", f."current_value", f."nuke_estimate", f."nuke_estimate_low", f."nuke_estimate_high", f."nuke_estimate_confidence", f."price_tier", f."deal_score", f."deal_score_label", f."heat_score", f."heat_score_label", f."is_record_price", f."segment_record_price", f."feed_rank_score"
    FROM public.vehicle_valuation_feed f
    WHERE EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id=f.vehicle_id
      AND v.is_public IS TRUE AND v.deleted_at IS NULL
      AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item')$sql$;

  FOR fragment IN SELECT * FROM (VALUES
    ('segment_year_min','year','>=','integer'),('segment_year_max','year','<=','integer'),
    ('year_min','year','>=','integer'),('year_max','year','<=','integer'),
    ('price_min','display_price','>=','numeric'),('price_max','display_price','<=','numeric'),
    ('event_not_after','event_at','<=','timestamp with time zone'),('created_not_before','created_at','>=','timestamp with time zone')
  ) clauses(k,c,op,t) LOOP
    IF p_filters->fragment.k IS NOT NULL AND p_filters->fragment.k<>'null'::jsonb THEN
      sql:=sql||format(' AND f.%I %s ($1->>%L)::%s',fragment.c,fragment.op,fragment.k,fragment.t);
    END IF;
  END LOOP;
  IF p_filters->'quality_min_price' IS NOT NULL AND p_filters->'quality_min_price'<>'null'::jsonb THEN
    sql:=sql||' AND (f.display_price>=($1->>''quality_min_price'')::numeric OR f.display_price IS NULL)';
  END IF;
  FOR fragment IN SELECT * FROM (VALUES
    ('vehicle_types','canonical_vehicle_type',5),('excluded_dealer_ids','origin_organization_id',6),
    ('makes','make',9),('body_styles','canonical_body_style',11),
    ('included_sources','discovery_source',13),('excluded_sources','discovery_source',12)
  ) clauses(k,c,binding) LOOP
    IF jsonb_typeof(p_filters->fragment.k)='array' AND jsonb_array_length(p_filters->fragment.k)>0 THEN
      IF fragment.k IN ('excluded_sources','excluded_dealer_ids') THEN
        sql:=sql||format(' AND f.%I <> ALL($%s)',fragment.c,fragment.binding);
      ELSIF fragment.k='vehicle_types' THEN
        sql:=sql||' AND (f.canonical_vehicle_type IS NULL OR f.canonical_vehicle_type = ANY($5))';
      ELSE
        sql:=sql||format(' AND f.%I = ANY($%s)',fragment.c,fragment.binding);
      END IF;
    END IF;
  END LOOP;
  IF cardinality(segment_makes)>0 THEN sql:=sql||' AND f.make ILIKE ANY($7)'; END IF;
  IF cardinality(segment_model_patterns)>0 THEN sql:=sql||' AND f.model ILIKE ANY($8)'; END IF;
  IF cardinality(model_patterns)>0 THEN sql:=sql||' AND f.model ILIKE ANY($10)'; END IF;
  IF p_filters->>'is_4x4'='true' THEN sql:=sql||' AND (f.drivetrain ILIKE ''%4wd%'' OR f.drivetrain ILIKE ''%4x4%'' OR f.drivetrain ILIKE ''%awd%'')'; END IF;
  IF p_filters->>'for_sale'='true' THEN sql:=sql||' AND f.is_for_sale IS TRUE'; END IF;
  IF p_filters->>'sold_only'='true' THEN sql:=sql||' AND f.is_sold IS TRUE'; END IF;
  IF p_filters->>'hide_sold'='true' THEN sql:=sql||' AND (f.is_sold IS NULL OR f.is_sold IS FALSE)'; END IF;
  IF p_filters->>'has_images'='true' THEN sql:=sql||' AND (f.has_photos IS TRUE OR f.primary_image_url IS NOT NULL)'; END IF;
  IF jsonb_typeof(p_filters->'query_terms')='array' THEN
    FOR term_index IN 0..jsonb_array_length(p_filters->'query_terms')-1 LOOP
      sql:=sql||format(' AND (f.make ILIKE ''%%''||($1->''query_terms''->>%1$s)||''%%'' OR f.model ILIKE ''%%''||($1->''query_terms''->>%1$s)||''%%'' OR f.series ILIKE ''%%''||($1->''query_terms''->>%1$s)||''%%'' OR f.vin ILIKE ''%%''||($1->''query_terms''->>%1$s)||''%%'')',term_index);
    END LOOP;
  END IF;
  IF p_cursor_vehicle_id IS NOT NULL THEN
    operator:=CASE direction WHEN 'asc' THEN '>' ELSE '<' END;
    IF p_cursor_is_null THEN
      sql:=sql||format(' AND ((f.%I IS NULL AND f.vehicle_id>$3)',sort_column);
      IF direction='desc' THEN sql:=sql||format(' OR f.%I IS NOT NULL',sort_column); END IF;
      sql:=sql||')';
    ELSE
      -- An empty text value is a real text cursor, separate from a NULL cursor.
      sql:=sql||format(' AND (f.%1$I %2$s $2::%3$s OR (f.%1$I=$2::%3$s AND f.vehicle_id>$3)',sort_column,operator,sort_type);
      IF direction='asc' THEN sql:=sql||format(' OR f.%I IS NULL',sort_column); END IF;
      sql:=sql||')';
    END IF;
  END IF;
  sql:=sql||format(' ORDER BY f.%I %s NULLS %s,f.vehicle_id ASC LIMIT $4',sort_column,direction,CASE direction WHEN 'asc' THEN 'LAST' ELSE 'FIRST' END);
  RETURN QUERY EXECUTE sql USING p_filters,p_cursor_value,p_cursor_vehicle_id,p_limit+1,
    vehicle_types,dealer_ids,segment_makes,segment_model_patterns,makes,model_patterns,
    body_styles,excluded_sources,included_sources;
END;
$reader$;
REVOKE ALL ON FUNCTION public.feed_public_page_read(jsonb,text,text,text,uuid,boolean,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.feed_public_page_read(jsonb,text,text,text,uuid,boolean,integer) TO service_role;
COMMENT ON FUNCTION public.feed_public_page_read(jsonb,text,text,text,uuid,boolean,integer) IS 'Service-only public feed page. Current public/nondeleted visibility and closed normalized filters are applied before deterministic order and limit+1. No private-owner override, raw SQL, filtered-count claim or timeout expansion.';
NOTIFY pgrst,'reload schema';
COMMIT;
