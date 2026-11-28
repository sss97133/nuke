-- Reuse the existing pure SQL sheet owner for current source presentation.
-- No source writes, evaluator execution, worker changes or engineering release.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';

CREATE OR REPLACE FUNCTION public.harness_manual_compute(p_input jsonb,p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
DECLARE
  records jsonb;
  key_ text;
  answer jsonb;
BEGIN
  -- Bound the projection actually used here. Unrelated evaluation checks/rules
  -- must not consume a presentation budget or break the existing producer.
  IF octet_length(coalesce((p_input->'model')::text,''))
    + octet_length(coalesce((p_result->'segment_ends')::text,'')) > 8388608 THEN
    RAISE EXCEPTION 'Manual layout source projection exceeds eight MiB' USING ERRCODE='22023';
  END IF;
  FOREACH key_ IN ARRAY ARRAY['circuits','segments','terminations','endpoints'] LOOP
    records := coalesce(p_input->'model'->key_,'[]'::jsonb);
    IF jsonb_typeof(records) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Manual layout % must be an array',key_ USING ERRCODE='22023';
    END IF;
    IF jsonb_array_length(records)>8192 THEN
      RAISE EXCEPTION 'Manual layout % exceeds 8192 records',key_ USING ERRCODE='22023';
    END IF;
    IF EXISTS (SELECT FROM jsonb_array_elements(records) x
      GROUP BY x->>'id' HAVING x->>'id' IS NULL OR count(*)>1) THEN
      RAISE EXCEPTION 'Manual layout % contains missing or duplicate record keys',key_ USING ERRCODE='22023';
    END IF;
  END LOOP;
  records := coalesce(p_result->'segment_ends','[]'::jsonb);
  IF jsonb_typeof(records) IS DISTINCT FROM 'array' OR jsonb_array_length(records)>16384 THEN
    RAISE EXCEPTION 'Manual layout end addresses exceed the bounded array contract' USING ERRCODE='22023';
  END IF;

WITH RECURSIVE circuits AS MATERIALIZED (
 SELECT x FROM jsonb_array_elements(coalesce(p_input->'model'->'circuits','[]'::jsonb)) a(x)),
terminations AS MATERIALIZED (
 SELECT x FROM jsonb_array_elements(coalesce(p_input->'model'->'terminations','[]'::jsonb)) a(x)
 WHERE NOT coalesce((x->>'is_superseded')::boolean,false) AND x->>'superseded_by' IS NULL),
endpoints AS MATERIALIZED (
 SELECT x FROM jsonb_array_elements(coalesce(p_input->'model'->'endpoints','[]'::jsonb)) a(x)
 WHERE NOT coalesce((x->>'is_superseded')::boolean,false) AND x->>'superseded_by' IS NULL),
pieces AS MATERIALIZED (
 SELECT s.x AS piece,c.x AS circuit,s.x->>'id' AS segment_id,s.x->>'circuit_id' AS circuit_id,
  coalesce(s.x->>'circuit_id','piece/'||(s.x->>'id')) AS circuit_key,
  c.x->>'code' AS code,c.x->>'section' AS section,c.x->>'system_category' AS system_category,
  row_number() OVER(PARTITION BY coalesce(s.x->>'circuit_id','piece/'||(s.x->>'id')) ORDER BY s.x->>'id') AS circuit_position
 FROM jsonb_array_elements(coalesce(p_input->'model'->'segments','[]'::jsonb)) s(x)
 LEFT JOIN circuits c ON c.x->>'id'=s.x->>'circuit_id'),
principal_candidates AS MATERIALIZED (
 SELECT DISTINCT p.circuit_key,e.x->>'id' AS endpoint_id,e.x->>'code' AS endpoint_code,e.x->>'name' AS endpoint_name
 FROM pieces p JOIN terminations t ON t.x->>'id' IN (p.piece->>'from_termination_id',p.piece->>'to_termination_id')
  AND t.x->>'circuit_id'=p.circuit_id
 JOIN endpoints e ON e.x->>'id'=t.x->>'endpoint_id'
 WHERE p.circuit->>'design_status'='decided'
  AND NOT coalesce((p.circuit->>'is_superseded')::boolean,false) AND p.circuit->>'superseded_by' IS NULL
  AND e.x->>'type' IN ('sensor','actuator','switch','display') AND e.x->>'node_kind'='terminals'),
principal_counts AS (
 SELECT circuit_key,count(*) AS candidate_count,min(endpoint_id) AS endpoint_id,
  min(endpoint_code) AS endpoint_code,min(endpoint_name) AS endpoint_name
 FROM principal_candidates GROUP BY circuit_key),
grouped AS (
 SELECT p.*,CASE WHEN q.candidate_count=1 THEN 'endpoint/'||q.endpoint_id ELSE 'ungrouped/'||jsonb_build_array(p.system_category)::text END AS group_key,
  CASE WHEN q.candidate_count=1 THEN coalesce(nullif(q.endpoint_code,''),q.endpoint_id)
   ELSE '~ungrouped/'||jsonb_build_array(p.system_category)::text END AS group_order,
  CASE WHEN q.candidate_count=1 THEN
    coalesce(nullif(q.endpoint_name,''),nullif(q.endpoint_code,''),'Unnamed device')
    ||CASE WHEN nullif(q.endpoint_code,'') IS NOT NULL THEN ' ['||q.endpoint_code||']' ELSE '' END
   ELSE CASE WHEN p.system_category IS NULL THEN 'Subsystem not recorded'
    WHEN btrim(p.system_category)='' THEN 'Blank recorded subsystem' ELSE p.system_category END||' / Ungrouped circuits'
  END AS group_title
 FROM pieces p LEFT JOIN principal_counts q ON q.circuit_key=p.circuit_key),
chunks AS (
 SELECT circuit_key,code,section,group_key,group_order,group_title,(circuit_position-1)/8 AS chunk,count(*)::integer AS weight
 FROM grouped GROUP BY circuit_key,code,section,group_key,group_order,group_title,(circuit_position-1)/8),
ordered AS (
 SELECT *,row_number() OVER(PARTITION BY section,group_key ORDER BY code COLLATE "C",circuit_key,chunk) AS position
 FROM chunks),
packed AS (
 SELECT o.*,1 AS page,weight AS used FROM ordered o WHERE position=1
 UNION ALL
 SELECT o.*,CASE WHEN p.used+o.weight>8 THEN p.page+1 ELSE p.page END,
  CASE WHEN p.used+o.weight>8 THEN o.weight ELSE p.used+o.weight END
 FROM packed p JOIN ordered o ON o.section IS NOT DISTINCT FROM p.section AND o.group_key=p.group_key AND o.position=p.position+1),
assigned AS (
 SELECT a.*,p.page FROM grouped a JOIN packed p ON p.circuit_key=a.circuit_key AND p.chunk=(a.circuit_position-1)/8),
raw_headers AS (
 SELECT section,group_key,group_order,group_title,page,
  md5(jsonb_build_array('manual_sheet_device_v2',p_input->'model'->>'vehicle_id',section,group_key,
   jsonb_agg(segment_id ORDER BY code COLLATE "C",circuit_key,circuit_position))::text)::uuid AS id,
  count(*)::integer AS piece_count
 FROM assigned GROUP BY section,group_key,group_order,group_title,page),
headers AS (
 SELECT *,row_number() OVER(PARTITION BY section ORDER BY group_order COLLATE "C",group_key,page)::integer AS ordinal,
  count(*) OVER(PARTITION BY section,group_key) AS group_pages
 FROM raw_headers),
members AS (
 SELECT h.id AS sheet_id,a.segment_id::uuid,
  row_number() OVER(PARTITION BY h.id ORDER BY a.code COLLATE "C",a.circuit_key,a.circuit_position)::integer AS ordinal
 FROM assigned a JOIN headers h ON h.section IS NOT DISTINCT FROM a.section AND h.group_key=a.group_key AND h.page=a.page)
SELECT jsonb_build_object(
 'sheets',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'section',section,'ordinal',ordinal,
    'title',coalesce(initcap(replace(section,'_',' ')),'Unassigned section')||' / '||ordinal
     ||CASE WHEN group_pages>1 THEN ' (Part '||page||' of '||group_pages||')' ELSE '' END||' — '||group_title,
    'sort_key',coalesce(section,'~unassigned')||'/'||lpad(ordinal::text,10,'0'),'piece_count',piece_count)
    ORDER BY section NULLS LAST,ordinal) FROM headers),'[]'::jsonb),
 'members',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY sheet_id,ordinal) FROM members m),'[]'::jsonb),
 'ends',coalesce((SELECT jsonb_agg(jsonb_build_object('sheet_id',m.sheet_id,'segment_id',m.segment_id,'side',a.x->>'side')
    ORDER BY m.sheet_id,m.ordinal,a.x->>'side') FROM members m
    JOIN jsonb_array_elements(coalesce(p_result->'segment_ends','[]'::jsonb)) a(x) ON a.x->>'segment_id'=m.segment_id::text),'[]'::jsonb)) INTO answer;
  RETURN answer;
END;
$fn$;
COMMENT ON FUNCTION public.harness_manual_compute(jsonb,jsonb) IS
'Pure bounded caller-JSON presentation: eight MiB of used model/end-address projection, 8192 unique keyed records per source collection and 16384 end addresses, at most eight physical pieces per sheet. Unrelated evaluation fields do not consume the layout budget. Reuses recorded functional grouping; reads/writes no tables, accesses no private source and creates no electrical joins or engineering release.';
REVOKE ALL ON FUNCTION public.harness_manual_compute(jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.harness_manual_compute(jsonb,jsonb) TO anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.harness_source_workspace(p_vehicle_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
SET timezone = 'UTC'
AS $function$
DECLARE
  source_graph jsonb;
  selected_model jsonb;
  selection jsonb;
  content jsonb;
BEGIN
  -- The stricter existing model visibility rule also excludes anonymous-owner
  -- claims and deleted vehicles. Preserve source RLS and all existing grants.
  IF NOT public.harness_model_visible(p_vehicle_id) THEN RETURN NULL; END IF;
  source_graph := public.harness_schematic_model(p_vehicle_id);
  selected_model := public.harness_model_inputs(p_vehicle_id)->'model';
  IF source_graph IS NULL OR selected_model IS NULL
    OR source_graph->>'contract_version' IS DISTINCT FROM '1'
    OR selected_model->>'contract_version' IS DISTINCT FROM '2'
    OR source_graph->>'vehicle_id' IS DISTINCT FROM p_vehicle_id::text
    OR selected_model->>'vehicle_id' IS DISTINCT FROM p_vehicle_id::text
    OR selected_model->>'selection' IS DISTINCT FROM 'decided_design'
    OR jsonb_typeof(selected_model->'segments') IS DISTINCT FROM 'array'
    OR jsonb_typeof(selected_model->'circuits') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Incompatible harness source or selection contract' USING ERRCODE = '22023';
  END IF;
  selection := jsonb_build_object(
    'owner', 'harness_model_inputs', 'contract_version', 2, 'kind', 'decided_design',
    'segment_ids', coalesce((SELECT jsonb_agg(x->>'id' ORDER BY x->>'id')
      FROM jsonb_array_elements(selected_model->'segments') x), '[]'::jsonb),
    'circuit_ids', coalesce((SELECT jsonb_agg(x->>'id' ORDER BY x->>'id')
      FROM jsonb_array_elements(selected_model->'circuits') x), '[]'::jsonb));
  IF EXISTS (SELECT id FROM jsonb_array_elements_text(selection->'segment_ids') k(id)
    EXCEPT SELECT s->>'id' FROM jsonb_array_elements(source_graph->'segments') s)
    OR EXISTS (SELECT id FROM jsonb_array_elements_text(selection->'circuit_ids') k(id)
    EXCEPT SELECT c->>'id' FROM jsonb_array_elements(source_graph->'circuits') c) THEN
    RAISE EXCEPTION 'Harness selection contains an unavailable source record' USING ERRCODE = '22023';
  END IF;
  content := jsonb_build_object('contract_version', 1, 'vehicle_id', p_vehicle_id,
    'snapshot_kind', 'current_read_not_published_revision',
    'source', source_graph - 'read_at', 'selection', selection,
    'manual_layout', jsonb_build_object(
      'contract_version',1,'owner','harness_manual_compute',
      'kind','current_source_presentation_not_evaluated') ||
      public.harness_manual_compute(jsonb_build_object('model',selected_model),'{}'::jsonb));
  RETURN content || jsonb_build_object('read_at', statement_timestamp(),
    'snapshot_hash', md5(content::text));
END;
$function$;


COMMENT ON FUNCTION public.harness_source_workspace(uuid) IS
'Invoker-RLS current source graph, exact harness_model_inputs v2 design IDs, and bounded current-source manual presentation from harness_manual_compute. All returned content is hashed, excluding the read clock. Layout is not evaluated electrical connectivity or a published construction revision. No source writes, inline fold, material-revision assessment, purchasing eligibility or physical completion.';
REVOKE ALL ON FUNCTION public.harness_source_workspace(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.harness_source_workspace(uuid) TO anon,authenticated,service_role;
COMMIT;
