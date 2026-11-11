-- Header form is a projection of an addressed auction appearance, not page-local state.
-- Extend the existing public publisher projection; keep the profile reader invoker/RLS scoped.
BEGIN;
SET LOCAL statement_timeout='8s';
SET LOCAL lock_timeout='2s';
DO $migration$
DECLARE d text; base_d text; a record;
BEGIN
 IF to_regprocedure('public.organization_source_inventory_read(uuid,text)') IS NULL THEN
  d := pg_get_functiondef('public.organization_source_inventory_read(uuid)'::regprocedure);
  base_d := d;
  IF position('auction_roster_candidates_v1' in d)=0 THEN
    IF position('), matching AS MATERIALIZED (' in d)=0
      OR position($anchor$FROM publisher p JOIN public.vehicle_observations o ON o.source_id=p.source_id
    AND o.kind='listing' AND NOT o.is_superseded$anchor$ in d)=0 THEN
      RAISE EXCEPTION 'source inventory candidate anchors drifted';
    END IF;
    d := replace(d,'), matching AS MATERIALIZED (',$candidates$), listing_candidates AS MATERIALIZED (
  -- auction_roster_candidates_v1: filter cheap native identifiers before decoding
  -- large retained payloads. Unknown legacy identifier forms keep their old path.
  SELECT o.* FROM publisher p JOIN public.vehicle_observations o ON o.source_id=p.source_id
  WHERE o.kind='listing' AND NOT o.is_superseded
    AND (o.source_identifier !~ '^auctionid:[0-9]+:[a-f0-9]{64}$'
      OR o.source_identifier IS NULL
      OR split_part(o.source_identifier,':',2) IN (
        SELECT CASE WHEN native_id ~ '^showroom:[0-9]+$' THEN substring(native_id from 10) ELSE native_id END FROM roster))
), matching AS MATERIALIZED ($candidates$);
    d := replace(d,$anchor$FROM publisher p JOIN public.vehicle_observations o ON o.source_id=p.source_id
    AND o.kind='listing' AND NOT o.is_superseded$anchor$,'FROM listing_candidates o');
  END IF;
  IF position('auction_header_publisher_v1' in d)=0 THEN
    IF position('SELECT os.id source_id, f.id feed_id' in d)=0
      OR position($anchor$'source','mccormicks','checked_at'$anchor$ in d)=0 THEN
      RAISE EXCEPTION 'public source inventory reader drifted';
    END IF;
    d := replace(d,'SELECT os.id source_id, f.id feed_id',
      'SELECT o.id organization_id, o.business_name publisher_name, o.logo_url publisher_logo_url, os.id source_id, f.id feed_id');
    d := replace(d,$anchor$'source','mccormicks','checked_at'$anchor$,
      $replacement$-- auction_header_publisher_v1: only the already-public active feed publisher.
  'publisher',(SELECT jsonb_build_object('organization_id',organization_id,'source_id',source_id,
    'name',publisher_name,'logo_url',publisher_logo_url,'role','auctioneer') FROM publisher LIMIT 1),
  'source','mccormicks','checked_at'$replacement$);
  END IF;
  -- Scope the same canonical reader by native identity. Header reads must not
  -- decode every current lot's retained payload. The one-argument API is retained.
  d := replace(d,'organization_source_inventory_read(p_organization_id uuid)',
    'organization_source_inventory_read(p_organization_id uuid, p_native_id text)');
  d := replace(d,'), roster AS MATERIALIZED (','), source_roster AS MATERIALIZED (');
  d := replace(d,'), listing_candidates AS MATERIALIZED (',$scope$), roster AS MATERIALIZED (
  -- auction_header_inventory_scope_v1: no new population or binding policy.
  SELECT * FROM source_roster WHERE p_native_id IS NULL OR native_id=p_native_id
), listing_candidates AS MATERIALIZED ($scope$);
  EXECUTE d;
  EXECUTE format('ALTER FUNCTION public.organization_source_inventory_read(uuid,text) OWNER TO %I',
    (SELECT pg_get_userbyid(proowner) FROM pg_proc
      WHERE oid='public.organization_source_inventory_read(uuid)'::regprocedure));
  -- Remove defaults first: the new signature must not inherit extra role grants.
  FOR a IN SELECT x.grantee FROM pg_proc p,
    LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x
    WHERE p.oid='public.organization_source_inventory_read(uuid,text)'::regprocedure
      AND x.grantee<>p.proowner
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.organization_source_inventory_read(uuid,text) FROM %s',
      CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END);
  END LOOP;
  -- Copy the existing reader's explicit execution boundary, including grant option.
  FOR a IN SELECT x.grantee,x.is_grantable FROM pg_proc p,
    LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x
    WHERE p.oid='public.organization_source_inventory_read(uuid)'::regprocedure
      AND x.privilege_type='EXECUTE' AND x.grantee<>p.proowner
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.organization_source_inventory_read(uuid,text) TO %s%s',
      CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END,
      CASE WHEN a.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
  END LOOP;
  EXECUTE split_part(base_d,'AS $function$',1)||$wrapper$AS $function$
    SELECT public.organization_source_inventory_read(p_organization_id,NULL::text);
  $function$$wrapper$;
 ELSIF position('auction_header_inventory_scope_v1' in
   pg_get_functiondef('public.organization_source_inventory_read(uuid,text)'::regprocedure))=0 THEN
   RAISE EXCEPTION 'Scoped inventory reader already has a different owner; inspect before extending';
 END IF;

  d := pg_get_functiondef('public.vehicle_profile_read(uuid)'::regprocedure);
  IF position('auction_header_form_v1' in d)=0 THEN
    IF position('WITH v AS (' in d)=0
      OR position($anchor$'listing', public.vehicle_listing_state(v.id)$anchor$ in d)=0 THEN
      RAISE EXCEPTION 'vehicle profile reader header anchors drifted';
    END IF;
    -- Prefix the existing WITH list. No replacement of existing identity/price/facet rules.
    d := replace(d,'WITH v AS (',$ctes$WITH
-- auction_header_form_v1: native appearance -> qualified functional items -> header form.
header_events AS MATERIALIZED (
  SELECT e.* FROM public.vehicle_events e
  JOIN public.vehicles p ON p.id=e.vehicle_id
  WHERE e.vehicle_id=p_vehicle_id AND p.is_public AND p.deleted_at IS NULL
    AND coalesce(p.listing_kind,'vehicle')<>'non_vehicle_item'
    AND e.source_platform='mccormicks' AND e.event_type='auction'
    AND e.duplicate_of_event_id IS NULL AND e.source_organization_id IS NOT NULL
    AND e.metadata->>'projection_method'='mccormick_live_v1'
    AND nullif(e.metadata->>'withdrawn_at','') IS NULL
    AND e.source_listing_id=(e.metadata->>'sale_key')||':'||(e.metadata->>'native_id')
    AND e.metadata->>'sale_key' ~ '^mccormicks-[0-9]+$'
    AND e.metadata->>'native_id' ~ '^[0-9]+$'
    AND e.source_url='https://www.classic-carauction.com/auction-cars?auctionid='||(e.metadata->>'native_id')
    AND e.metadata->>'source_catalog_sha256' ~ '^[a-f0-9]{64}$'
    AND pg_input_is_valid(e.metadata->>'source_catalog_snapshot_id','uuid')
), header_publishers AS MATERIALIZED (
  SELECT source_organization_id,native_id,
    public.organization_source_inventory_read(source_organization_id,native_id) doc
  FROM (SELECT DISTINCT source_organization_id,metadata->>'native_id' native_id FROM header_events) p
), header_qualified AS MATERIALIZED (
  SELECT e.*, p.doc,
    (e.ended_at AT TIME ZONE 'UTC')::date run_on,
    EXISTS (SELECT 1 FROM jsonb_array_elements(p.doc->'inventory') r
      WHERE r->>'vehicle_id'=e.vehicle_id::text AND r->>'native_id'=e.metadata->>'native_id'
        AND r->>'sale_key'=e.metadata->>'sale_key' AND r->>'source_url'=e.source_url
        AND r->>'inventory_kind'='auction' AND r->>'source_status'='scheduled'
        AND r->>'run_on'=to_char(e.ended_at AT TIME ZONE 'UTC','YYYY-MM-DD')) current_roster_match
  FROM header_events e JOIN header_publishers p ON p.source_organization_id=e.source_organization_id
    AND p.native_id=e.metadata->>'native_id'
  JOIN public.vehicle_observations o ON o.id=CASE
    WHEN pg_input_is_valid(e.metadata->>'source_observation_id','uuid')
    THEN (e.metadata->>'source_observation_id')::uuid END
  WHERE p.doc#>>'{publisher,organization_id}'=e.source_organization_id::text
    AND nullif(p.doc#>>'{publisher,name}','') IS NOT NULL
    AND o.vehicle_id=e.vehicle_id AND o.kind='listing' AND NOT o.is_superseded
    AND o.source_id::text=p.doc#>>'{publisher,source_id}'
    AND o.structured_data->>'source_id'=e.metadata->>'native_id'
    AND o.structured_data->>'source_claims_only'='true'
    AND (o.source_url=e.source_url OR (o.source_url='https://www.classic-carauction.com/auction-cars'
      AND o.structured_data->>'evidence_scope'='catalog_row'
      AND o.structured_data->>'parser'='mccormick_catalog_v1'))
    AND e.ended_at IS NOT NULL AND e.metadata->>'ended_at_precision'='day'
    AND e.metadata->>'ended_at_method'='scheduled_run_day'
), header_ranked AS (
  SELECT q.*, dense_rank() OVER (ORDER BY
    CASE WHEN current_roster_match AND run_on=current_date THEN 0
         WHEN current_roster_match AND run_on>current_date THEN 1
         WHEN run_on<current_date THEN 2 ELSE 3 END,
    CASE WHEN run_on>=current_date THEN run_on END ASC,
    CASE WHEN run_on<current_date THEN run_on END DESC) choice_rank
  FROM header_qualified q
), header_choices AS MATERIALIZED (
  SELECT * FROM header_ranked WHERE choice_rank=1
), header_form AS (
  SELECT CASE WHEN count(*)>1 THEN jsonb_build_object(
    'version','auction_header_v1','form','appearance_selection','price_scope','withheld',
    'items',jsonb_build_array(jsonb_build_object('key','appearance','status','ambiguous',
      'origin','vehicle_events.id','candidates',jsonb_agg(jsonb_build_object(
        'event_id',id,'source_listing_id',source_listing_id,'source_url',source_url,
        'source_organization_id',source_organization_id,'run_on',run_on,
        'action',jsonb_build_object('kind','sale_inventory',
          'route','/org/'||source_organization_id||'#source-inventory')) ORDER BY source_listing_id,id))))
    ELSE NULL END doc FROM header_choices HAVING count(*)>1
  UNION ALL
  SELECT jsonb_build_object('version','auction_header_v1',
    'form',CASE WHEN event_status IN ('sold','unsold','no_sale','not sold','bid-goes-on','cancelled','ended') THEN 'auction_result_context'
      WHEN event_status IS DISTINCT FROM 'upcoming' THEN 'auction_context'
      WHEN run_on<current_date THEN 'auction_awaiting_result'
      WHEN NOT current_roster_match THEN 'auction_context'
      WHEN run_on=current_date THEN 'auction_day' ELSE 'auction_acquisition' END,
    'appearance_id',h.id,'price_scope','appearance_only',
    'evidence',jsonb_build_object('source_url',source_url,'source_listing_id',source_listing_id,
      'observation_id',metadata->>'source_observation_id',
      'catalog_snapshot_id',metadata->>'source_catalog_snapshot_id',
      'catalog_sha256',metadata->>'source_catalog_sha256',
      'source_checked_at',metadata->>'source_observed_at','roster_checked_at',doc->'checked_at'),
    'items',jsonb_build_array(
      jsonb_build_object('key','auctioneer','origin','vehicle_events.source_organization_id',
        'status','source_attributed','value',doc->'publisher',
        'action',jsonb_build_object('kind','organization','route','/org/'||source_organization_id)),
      jsonb_build_object('key','auction_state','origin','vehicle_events.event_status',
        'status','source_reported','value',jsonb_build_object('reported',event_status,
          'result_kind',CASE WHEN event_status='sold' THEN 'reported_sale'
            WHEN event_status IN ('unsold','no_sale','not sold') THEN 'reported_unsuccessful'
            WHEN event_status='bid-goes-on' THEN 'continued_offer'
            WHEN event_status='cancelled' THEN 'cancelled' ELSE 'unestablished' END,
          'offer',CASE WHEN event_status='upcoming' AND run_on>=current_date AND current_roster_match
            THEN 'advertised_for_auction' ELSE 'not_established' END,
          'freshness',CASE WHEN coalesce((doc->>'stale')::boolean,true)
            OR coalesce((doc->>'refresh_failed')::boolean,true) THEN 'recheck_required' ELSE 'current_roster' END),
        'action',jsonb_build_object('kind','sale_inventory','route','/org/'||source_organization_id||'#source-inventory')),
      jsonb_build_object('key','schedule','origin','vehicle_events.ended_at',
        'status','source_scheduled','value',jsonb_build_object('run_on',run_on,'precision','day',
          'lot',metadata->>'lot_number','sale_key',metadata->>'sale_key',
          'calendar_basis','UTC','exact_lot_time',NULL,
          'days_until',CASE WHEN run_on>current_date THEN run_on-current_date END),
        'action',jsonb_build_object('kind','sale_inventory','route','/org/'||source_organization_id||'#source-inventory')),
      jsonb_build_object('key','primary_action','origin','valuation_by_ymm',
        'status',CASE WHEN p.year IS NOT NULL AND nullif(p.make,'') IS NOT NULL AND nullif(p.model,'') IS NOT NULL
          THEN 'available' ELSE 'identity_required' END,
        'action',CASE WHEN p.year IS NOT NULL AND nullif(p.make,'') IS NOT NULL AND nullif(p.model,'') IS NOT NULL
          THEN jsonb_build_object('kind','market_comparison','route','/valuation',
            'parameters',jsonb_build_object('year',p.year,'make',p.make,'model',p.model,'vehicle_id',p.id)) END),
      jsonb_build_object('key','hammer_estimate','origin','compute-vehicle-valuation',
        'status','not_established','value',NULL,'reason','qualified_preauction_model_not_connected',
        'action',CASE WHEN p.year IS NOT NULL AND nullif(p.make,'') IS NOT NULL AND nullif(p.model,'') IS NOT NULL
          THEN jsonb_build_object('kind','market_comparison','route','/valuation',
            'parameters',jsonb_build_object('year',p.year,'make',p.make,'model',p.model,'vehicle_id',p.id)) END)
    ))
  FROM header_choices h JOIN public.vehicles p ON p.id=h.vehicle_id
  WHERE (SELECT count(*) FROM header_choices)=1
), v AS ($ctes$);
    d := replace(d,$anchor$'listing', public.vehicle_listing_state(v.id)$anchor$,
      $replacement$'header_form', (SELECT doc FROM header_form),
      'listing', public.vehicle_listing_state(v.id)$replacement$);
    EXECUTE d;
  END IF;
END $migration$;
COMMIT;
