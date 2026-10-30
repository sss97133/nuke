-- Source-backed responsibility and retained build scope on the EXISTING work model.
-- One immutable index row binds an admitted interpretation to an original document
-- selector and an original responsibility report. It creates no second job ledger,
-- authenticated assignment, payment, ownership transfer or completion event.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE TABLE public.work_order_retained_source_bindings (
  id uuid PRIMARY KEY REFERENCES public.vehicle_observations(id) ON DELETE RESTRICT,
  work_order_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE RESTRICT,
  scope_basis_observation_id uuid NOT NULL REFERENCES public.vehicle_observations(id) ON DELETE RESTRICT,
  responsibility_basis_observation_id uuid NOT NULL REFERENCES public.vehicle_observations(id) ON DELETE RESTRICT,
  provider_actor_id uuid NOT NULL REFERENCES public.actors(id) ON DELETE RESTRICT,
  reported_client_label text NOT NULL CHECK (length(btrim(reported_client_label)) BETWEEN 1 AND 80),
  document_label text NOT NULL CHECK (length(btrim(document_label)) BETWEEN 1 AND 1000),
  document_client text NOT NULL CHECK (length(btrim(document_client)) BETWEEN 1 AND 500),
  scope_source_id uuid NOT NULL REFERENCES public.observation_sources(id) ON DELETE RESTRICT,
  responsibility_excerpt text NOT NULL CHECK (length(btrim(responsibility_excerpt)) BETWEEN 1 AND 2000),
  scope_basis_hash text NOT NULL,
  responsibility_basis_hash text NOT NULL,
  interpretation_hash text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX work_retained_sources_order ON public.work_order_retained_source_bindings(work_order_id, id);
CREATE INDEX work_retained_sources_provider ON public.work_order_retained_source_bindings(provider_actor_id, work_order_id);
CREATE INDEX work_retained_sources_scope ON public.work_order_retained_source_bindings(scope_basis_observation_id);
CREATE INDEX work_retained_sources_responsibility ON public.work_order_retained_source_bindings(responsibility_basis_observation_id);
CREATE INDEX work_retained_sources_source ON public.work_order_retained_source_bindings(scope_source_id);
ALTER TABLE public.work_order_retained_source_bindings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.work_order_retained_source_bindings FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.work_order_retained_source_bindings TO service_role;
CREATE POLICY retained_source_service_read ON public.work_order_retained_source_bindings
  FOR SELECT TO service_role USING (true);
CREATE TRIGGER retained_source_immutable BEFORE UPDATE OR DELETE ON public.work_order_retained_source_bindings
  FOR EACH ROW EXECUTE FUNCTION public.work_order_resource_immutable();
CREATE TRIGGER retained_source_no_truncate BEFORE TRUNCATE ON public.work_order_retained_source_bindings
  FOR EACH STATEMENT EXECUTE FUNCTION public.work_order_resource_immutable();
COMMENT ON TABLE public.work_order_retained_source_bindings IS 'Private immutable typed index of admitted retained_source_binding work_record interpretations. Binds original build-log scope and an original delivery-responsibility report to the existing job and actor. Reported responsibility, not a Sign or an access grant. Writer: project_work_order_resource_observation.';

CREATE FUNCTION public.work_order_retained_source_hash(p_content text, p_data jsonb, p_clock timestamptz, p_source uuid)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT encode(sha256(convert_to(jsonb_build_array(p_content,p_data,p_clock AT TIME ZONE 'UTC',p_source)::text,'UTF8')),'hex')
$$;
REVOKE ALL ON FUNCTION public.work_order_retained_source_hash(text,jsonb,timestamptz,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.work_order_retained_source_hash(text,jsonb,timestamptz,uuid) TO service_role;

CREATE FUNCTION public.current_work_order_retained_sources(p_work_order_id uuid DEFAULT NULL,
  p_actor_ids uuid[] DEFAULT NULL,p_scope_source_id uuid DEFAULT NULL)
RETURNS SETOF public.work_order_retained_source_bindings
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT b.* FROM public.work_order_retained_source_bindings b
  JOIN public.work_orders w ON w.id=b.work_order_id
  JOIN public.vehicle_observations i ON i.id=b.id AND i.vehicle_id=w.vehicle_id AND i.is_superseded IS FALSE
  JOIN public.vehicle_observations s ON s.id=b.scope_basis_observation_id AND s.vehicle_id=w.vehicle_id AND s.is_superseded IS FALSE
  WHERE (p_work_order_id IS NULL OR b.work_order_id=p_work_order_id)
    AND (p_actor_ids IS NULL OR b.provider_actor_id=ANY(p_actor_ids))
    AND (p_scope_source_id IS NULL OR b.scope_source_id=p_scope_source_id)
    AND i.kind::text='work_record' AND s.kind::text='work_record'
    AND s.source_id=b.scope_source_id AND s.structured_data->>'log'=b.document_label
    AND s.structured_data->>'client'=b.document_client
    AND s.structured_data->>'subject'='client_billing_line'
    AND b.scope_basis_hash=public.work_order_retained_source_hash(NULL,
      jsonb_build_object('log',s.structured_data->'log','client',s.structured_data->'client'),s.observed_at,s.source_id)
    AND b.interpretation_hash=public.work_order_retained_source_hash(i.content_text,i.structured_data,i.observed_at,i.source_id)
$$;
REVOKE ALL ON FUNCTION public.current_work_order_retained_sources(uuid,uuid[],uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_work_order_retained_sources(uuid,uuid[],uuid) TO service_role;

-- Scope/document membership and a remaining obligation have different witnesses.
-- Withdrawing a responsibility report must not erase valid retained build scope.
CREATE FUNCTION public.current_work_order_retained_responsibilities(p_work_order_id uuid DEFAULT NULL,p_actor_ids uuid[] DEFAULT NULL)
RETURNS SETOF public.work_order_retained_source_bindings
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT b.* FROM public.work_order_retained_source_bindings b
  JOIN public.work_orders w ON w.id=b.work_order_id
  JOIN public.vehicle_observations i ON i.id=b.id AND i.vehicle_id=w.vehicle_id
    AND i.kind::text='work_record' AND i.is_superseded IS FALSE
  JOIN public.vehicle_observations r ON r.id=b.responsibility_basis_observation_id AND r.vehicle_id=w.vehicle_id
    AND r.kind::text='work_record' AND r.is_superseded IS FALSE
  WHERE (p_work_order_id IS NULL OR b.work_order_id=p_work_order_id)
    AND (p_actor_ids IS NULL OR b.provider_actor_id=ANY(p_actor_ids))
    AND b.interpretation_hash=public.work_order_retained_source_hash(i.content_text,i.structured_data,i.observed_at,i.source_id)
    AND r.structured_data->>'trust'='owner_stated' AND r.structured_data->>'obligation'='delivery_to_client'
    AND strpos(r.content_text,b.responsibility_excerpt)>0
    AND b.responsibility_basis_hash=public.work_order_retained_source_hash(r.content_text,r.structured_data,r.observed_at,r.source_id)
$$;
REVOKE ALL ON FUNCTION public.current_work_order_retained_responsibilities(uuid,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.current_work_order_retained_responsibilities(uuid,uuid[]) TO service_role;

CREATE FUNCTION public.project_work_order_retained_source(p_observation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  o public.vehicle_observations%ROWTYPE;
  s public.vehicle_observations%ROWTYPE;
  r public.vehicle_observations%ROWTYPE;
  w public.work_orders%ROWTYPE;
  e jsonb;
  actor_name text;
  scope_hash text;
  responsibility_hash text;
  v_interpretation_hash text;
  inserted integer;
BEGIN
  SELECT * INTO o FROM public.vehicle_observations WHERE id=p_observation_id FOR SHARE;
  IF NOT FOUND OR o.kind::text<>'work_record' OR o.is_superseded IS DISTINCT FROM false
    OR NOT EXISTS(SELECT 1 FROM public.observation_sources os WHERE os.id=o.source_id AND os.slug='internal-inference') THEN
    RAISE EXCEPTION 'Current internal-inference work_record interpretation required';
  END IF;
  e:=o.structured_data->'work_order_resource';
  IF e->>'version' IS DISTINCT FROM '1' OR e->>'event_type' IS DISTINCT FROM 'retained_source_binding' THEN
    RAISE EXCEPTION 'retained_source_binding version 1 required';
  END IF;
  SELECT * INTO w FROM public.work_orders WHERE id=(e->>'work_order_id')::uuid FOR SHARE;
  IF NOT FOUND OR w.vehicle_id IS NULL OR w.vehicle_id IS DISTINCT FROM o.vehicle_id THEN
    RAISE EXCEPTION 'Binding and work order must identify the same vehicle';
  END IF;
  SELECT * INTO s FROM public.vehicle_observations WHERE id=(e->>'scope_basis_observation_id')::uuid FOR SHARE;
  IF NOT FOUND OR s.kind::text<>'work_record' OR s.is_superseded IS DISTINCT FROM false
    OR s.vehicle_id IS DISTINCT FROM w.vehicle_id OR s.source_id IS NULL
    OR s.structured_data ? 'work_order_resource' OR s.structured_data->>'subject' IS DISTINCT FROM 'client_billing_line'
    OR coalesce(length(btrim(s.structured_data->>'log')),0)=0
    OR coalesce(length(btrim(s.structured_data->>'client')),0)=0
    OR jsonb_typeof(s.structured_data->'item') IS DISTINCT FROM 'string'
    OR jsonb_typeof(s.structured_data->'row') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'Original same-vehicle retained build-log scope required';
  END IF;
  SELECT * INTO r FROM public.vehicle_observations WHERE id=(e->>'responsibility_basis_observation_id')::uuid FOR SHARE;
  IF NOT FOUND OR r.kind::text<>'work_record' OR r.is_superseded IS DISTINCT FROM false
    OR r.vehicle_id IS DISTINCT FROM w.vehicle_id OR r.source_id IS NULL
    OR r.structured_data ? 'work_order_resource' OR r.structured_data->>'trust' IS DISTINCT FROM 'owner_stated'
    OR r.structured_data->>'obligation' IS DISTINCT FROM 'delivery_to_client'
    OR r.observed_at IS NULL OR r.observed_at IS DISTINCT FROM o.observed_at THEN
    RAISE EXCEPTION 'Original owner-stated delivery report and its event clock required';
  END IF;
  SELECT name INTO actor_name FROM public.actors WHERE id=(e->>'provider_actor_id')::uuid;
  IF actor_name IS NULL OR length(btrim(actor_name))<2
    OR coalesce(length(btrim(e->>'responsibility_excerpt')),0) NOT BETWEEN 1 AND 2000
    OR coalesce(strpos(r.content_text,e->>'responsibility_excerpt'),0)=0
    OR coalesce(strpos(e->>'responsibility_excerpt',actor_name),0)=0 THEN
    RAISE EXCEPTION 'Existing provider actor must be named in the exact responsibility excerpt';
  END IF;
  IF coalesce(length(btrim(e->>'reported_client_label')),0) NOT BETWEEN 1 AND 80
    OR e->>'reported_client_label' ~ '[@:/]'
    OR coalesce(strpos(e->>'responsibility_excerpt',e->>'reported_client_label'),0)=0
    OR coalesce(strpos(r.structured_data->>'client',e->>'reported_client_label'),0)=0
    OR coalesce(strpos(s.structured_data->>'client',e->>'reported_client_label'),0)=0 THEN
    RAISE EXCEPTION 'Same reported client label must occur in both source contexts';
  END IF;
  scope_hash:=public.work_order_retained_source_hash(NULL,
    jsonb_build_object('log',s.structured_data->'log','client',s.structured_data->'client'),s.observed_at,s.source_id);
  responsibility_hash:=public.work_order_retained_source_hash(r.content_text,r.structured_data,r.observed_at,r.source_id);
  v_interpretation_hash:=public.work_order_retained_source_hash(o.content_text,o.structured_data,o.observed_at,o.source_id);
  PERFORM pg_advisory_xact_lock(hashtextextended(s.vehicle_id::text||s.source_id::text||(s.structured_data->>'log')||(s.structured_data->>'client'),0));
  IF EXISTS(SELECT 1 FROM public.current_work_order_retained_sources(NULL,NULL,s.source_id) b
    WHERE b.work_order_id<>w.id AND b.scope_source_id=s.source_id
      AND b.document_label=s.structured_data->>'log' AND b.document_client=s.structured_data->>'client') THEN
    RAISE EXCEPTION 'Retained document scope is already bound to another work order';
  END IF;
  IF EXISTS(SELECT 1 FROM public.work_order_retained_source_bindings b WHERE b.id=o.id AND b.interpretation_hash<>v_interpretation_hash) THEN
    RAISE EXCEPTION 'Binding source changed; supersede and admit a replacement';
  END IF;
  INSERT INTO public.work_order_retained_source_bindings(id,work_order_id,scope_basis_observation_id,
    responsibility_basis_observation_id,provider_actor_id,reported_client_label,document_label,document_client,
    scope_source_id,responsibility_excerpt,scope_basis_hash,responsibility_basis_hash,interpretation_hash)
  VALUES(o.id,w.id,s.id,r.id,(e->>'provider_actor_id')::uuid,e->>'reported_client_label',s.structured_data->>'log',
    s.structured_data->>'client',s.source_id,e->>'responsibility_excerpt',scope_hash,responsibility_hash,v_interpretation_hash)
  ON CONFLICT(id) DO NOTHING;
  GET DIAGNOSTICS inserted=ROW_COUNT;
  RETURN jsonb_build_object('id',o.id,'event_type','retained_source_binding','duplicate',inserted=0,
    'assignment_created',false,'payment_recorded',false,'work_completed',false);
END $$;
REVOKE ALL ON FUNCTION public.project_work_order_retained_source(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.project_work_order_retained_source(uuid) TO service_role;

CREATE FUNCTION public.work_order_retained_sources_for_viewer(p_work_order_id uuid,p_user uuid,p_slots text[],
  p_after uuid DEFAULT NULL,p_limit integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone='UTC' AS $$
DECLARE
  lim integer:=least(greatest(coalesce(p_limit,25),1),100);
  allowed boolean;
  total integer;
  lines jsonb;
  next_id uuid;
  reports jsonb;
BEGIN
  IF p_user IS NULL OR coalesce(cardinality(p_slots),0)=0 THEN RETURN jsonb_build_object('visibility','withheld'); END IF;
  SELECT public.job_reader_is_party(p_slots) OR EXISTS(
    SELECT 1 FROM public.current_work_order_retained_responsibilities(p_work_order_id) b
    WHERE b.provider_actor_id IN (SELECT value::uuid FROM jsonb_array_elements_text(
      public.viewer_identity_bridge(p_user)->'evidenced_actor_ids'))) INTO allowed;
  IF NOT allowed THEN RETURN jsonb_build_object('visibility','withheld'); END IF;
  WITH bindings AS MATERIALIZED(SELECT * FROM public.current_work_order_retained_sources(p_work_order_id)),
  scope AS MATERIALIZED(
    SELECT DISTINCT o.id,o.observed_at,o.ingested_at,o.source_id,o.structured_data
    FROM bindings b JOIN public.work_orders w ON w.id=b.work_order_id
    JOIN public.vehicle_observations o ON o.vehicle_id=w.vehicle_id AND o.source_id=b.scope_source_id
      AND o.kind::text='work_record' AND o.is_superseded IS FALSE
      AND o.structured_data->>'subject'='client_billing_line'
      AND o.structured_data->>'log'=b.document_label AND o.structured_data->>'client'=b.document_client
    WHERE jsonb_typeof(o.structured_data->'item')='string' AND jsonb_typeof(o.structured_data->'row')='number'
  ), page AS(SELECT * FROM scope WHERE p_after IS NULL OR id>p_after ORDER BY id LIMIT lim+1),
  shown AS(SELECT * FROM page ORDER BY id LIMIT lim)
  SELECT (SELECT count(*) FROM scope),coalesce((SELECT jsonb_agg(jsonb_build_object(
    'source_observation_id',id,'source_id',source_id,'source_pointer','/structured_data/item',
    'item',structured_data->>'item','category',structured_data->>'category',
    'document_label',structured_data->>'log','document_row',structured_data->'row',
    'billing_column',structured_data->>'billing_column','execution_state','not_established_by_billing_entry',
    'observed_at',observed_at,'ingested_at',ingested_at) ORDER BY id) FROM shown),'[]'::jsonb),
    CASE WHEN (SELECT count(*) FROM page)>lim THEN (SELECT id FROM shown ORDER BY id DESC LIMIT 1) END
    INTO total,lines,next_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('binding_id',b.id,'provider_actor_id',b.provider_actor_id,
    'provider_label',a.name,'client_label',b.reported_client_label,'source_observation_id',r.id,
    'reported_at',r.observed_at,'payment_state',r.structured_data->>'payment_status',
    'delivery_state','reported_owed','scope','delivery_of_completed_vehicle','assurance','retained_owner_report_not_sign') ORDER BY b.id),'[]'::jsonb)
    INTO reports FROM public.current_work_order_retained_responsibilities(p_work_order_id) b
    JOIN public.actors a ON a.id=b.provider_actor_id
    JOIN public.vehicle_observations r ON r.id=b.responsibility_basis_observation_id;
  RETURN jsonb_build_object('visibility','included','responsibility_reports',reports,'scope_entries',lines,
    'next_after_source_id',next_id,'coverage',jsonb_build_object('returned',jsonb_array_length(lines),
      'total_source_entries',total,'population','current source rows in explicitly bound retained documents'),
    'as_of',statement_timestamp(),'physical_completion','not_inferred','delivery_accepted','not_inferred','money_authorized',false);
END $$;
REVOKE ALL ON FUNCTION public.work_order_retained_sources_for_viewer(uuid,uuid,text[],uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.work_order_retained_sources_for_viewer(uuid,uuid,text[],uuid,integer) TO service_role;

CREATE FUNCTION public.work_order_retained_sources_read(p_work_order_id uuid,p_after_source_id uuid DEFAULT NULL,p_limit integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE slots text[];
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign-in required' USING ERRCODE='42501'; END IF;
  SELECT s.slots INTO slots FROM public.work_order_viewer_slots(auth.uid(),p_work_order_id) s;
  IF NOT FOUND OR coalesce(cardinality(slots),0)=0 THEN RAISE EXCEPTION 'Work order unavailable' USING ERRCODE='42501'; END IF;
  RETURN public.work_order_retained_sources_for_viewer(p_work_order_id,auth.uid(),slots,p_after_source_id,p_limit);
END $$;
REVOKE ALL ON FUNCTION public.work_order_retained_sources_read(uuid,uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.work_order_retained_sources_read(uuid,uuid,integer) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.my_work_orders(p_slot text DEFAULT NULL,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET TimeZone='UTC' AS $$
DECLARE uid uuid:=auth.uid();lim integer;total integer;rows_out jsonb;next_after uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sign-in required' USING ERRCODE='42501'; END IF;
  IF p_slot IS NOT NULL AND p_slot NOT IN ('customer','org_owner','vehicle_access','admin','performer','responsible') THEN
    RAISE EXCEPTION 'Unknown slot %',p_slot USING ERRCODE='22023';
  END IF;
  lim:=least(greatest(coalesce(p_limit,25),1),100);
  WITH me AS MATERIALIZED(SELECT value::uuid actor_id FROM jsonb_array_elements_text(public.viewer_identity_bridge(uid)->'evidenced_actor_ids')),
  reports AS MATERIALIZED(SELECT DISTINCT b.work_order_id FROM public.current_work_order_retained_responsibilities(NULL,ARRAY(SELECT actor_id FROM me)) b
    WHERE p_slot='responsible'),
  visible AS MATERIALIZED(
    SELECT s.work_order_id,s.slots FROM public.work_order_viewer_slots(uid) s
    WHERE cardinality(s.slots)>0 AND (p_slot IS NULL OR p_slot=ANY(s.slots)
      OR (p_slot='responsible' AND ('performer'=ANY(s.slots) OR EXISTS(SELECT 1 FROM reports r WHERE r.work_order_id=s.work_order_id))))
  ),page AS(SELECT * FROM visible WHERE p_after IS NULL OR work_order_id>p_after ORDER BY work_order_id LIMIT lim+1),
  shown AS(SELECT * FROM page ORDER BY work_order_id LIMIT lim)
  SELECT coalesce((SELECT jsonb_agg(public.work_order_list_row(s.work_order_id,s.slots) ORDER BY s.work_order_id) FROM shown s),'[]'::jsonb),
    CASE WHEN (SELECT count(*) FROM page)>lim THEN (SELECT work_order_id FROM shown ORDER BY work_order_id DESC LIMIT 1) END,
    (SELECT count(*) FROM visible) INTO rows_out,next_after,total;
  RETURN jsonb_build_object('viewer',public.job_reader_viewer('self','{}',public.viewer_identity_bridge(uid),false),
    'as_of',statement_timestamp(),'rows',rows_out,'next_after',next_after,
    'coverage',jsonb_build_object('returned',jsonb_array_length(rows_out),'total_for_viewer',total,'slot_filter',p_slot,
      'population',CASE WHEN p_slot='responsible' THEN 'already-readable work orders with evidenced performer membership or current retained responsibility reports' ELSE 'work orders readable under existing viewer slots' END,
      'state_basis','retained reports and existing records are separate from authenticated fulfillment'));
END $$;

DO $edit$
DECLARE pj text:=pg_get_functiondef('public.project_work_order_resource_observation(uuid)'::regprocedure);
  lr text:=pg_get_functiondef('public.work_order_list_row(uuid,text[])'::regprocedure);
  jp text:=pg_get_functiondef('public.work_order_job_path_read(uuid)'::regprocedure);
  p text:=$a$  event_type := e->>'event_type';$a$;
  l text:=$a$    'as_of', y.p->'as_of')$a$;
  j text:=$a$RETURN public.work_order_job_path_for_viewer$a$;
BEGIN
  IF (length(pj)-length(replace(pj,p,'')))/length(p)<>1
    OR (length(lr)-length(replace(lr,l,'')))/length(l)<>1
    OR (length(jp)-length(replace(jp,j,'')))/length(j)<>1 THEN
    RAISE EXCEPTION 'Retained work integration anchors not found exactly once';
  END IF;
  EXECUTE replace(pj,p,p||$r$
  IF event_type='retained_source_binding' THEN
    RETURN public.project_work_order_retained_source(o.id);
  END IF;$r$);
  EXECUTE replace(lr,l,$r$    'retained_work', public.work_order_retained_sources_for_viewer(p_work_order_id,auth.uid(),p_slots,NULL,3),
    'as_of', y.p->'as_of')$r$);
  EXECUTE replace(jp,j,$r$RETURN jsonb_build_object('retained_work',public.work_order_retained_sources_for_viewer(p_work_order_id,uid,my_slots,NULL,25)) || public.work_order_job_path_for_viewer$r$);
END $edit$;

DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='work_order_retained_source_bindings' LOOP
    EXECUTE format('COMMENT ON COLUMN public.work_order_retained_source_bindings.%I IS %L',c.column_name,
      CASE c.column_name WHEN 'id' THEN 'Admitted interpretation observation UUID; idempotency key. Supersession is on its source.'
        WHEN 'work_order_id' THEN 'Existing work order whose retained scope and responsibility are reported.'
        WHEN 'provider_actor_id' THEN 'Existing actor named in the responsibility excerpt. Does not create an authenticated assignment or account claim.'
        WHEN 'reported_client_label' THEN 'Exact reported client label present in both source contexts; not a resolved customer identity.'
        WHEN 'document_label' THEN 'Original retained log label; selector within the same source, vehicle and reported client.'
        WHEN 'document_client' THEN 'Original retained document client field, private and never returned to public readers.'
        WHEN 'scope_source_id' THEN 'Existing source registry key of the retained document observations.'
        WHEN 'responsibility_excerpt' THEN 'Exact original owner-report excerpt; private, not a Sign.'
        WHEN 'recorded_at' THEN 'Projection insertion clock; not ownership-transfer, work, payment or delivery time.'
        ELSE 'Original source locator or immutable source fingerprint, checked again by current readers; changed/withdrawn/reattributed evidence withholds this binding.' END);
  END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
INSERT INTO public.pipeline_registry(table_name,column_name,owned_by,description,do_not_write_directly,write_via)
VALUES('work_order_retained_source_bindings',NULL,'project_work_order_resource_observation',
  'Immutable source relationship index within the canonical job owner. Original build scope and owner-reported delivery responsibility remain separately withdrawable; no Sign, money, completion or assignment is created.',
  true,'ingest-observation work_record then project_work_order_resource_observation(uuid)');
COMMIT;
