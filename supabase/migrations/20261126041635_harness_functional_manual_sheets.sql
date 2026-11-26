-- Refine the existing presentation owner; do not infer electrical connectivity.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';

CREATE OR REPLACE FUNCTION public.harness_manual_compute(p_input jsonb,p_result jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=public AS $fn$
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
  c.x->>'code' AS code,c.x->>'section' AS section,
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
 SELECT p.*,CASE WHEN q.candidate_count=1 THEN 'endpoint/'||q.endpoint_id ELSE 'ungrouped' END AS group_key,
  CASE WHEN q.candidate_count=1 THEN coalesce(nullif(q.endpoint_code,''),q.endpoint_id)
   ELSE '~ungrouped' END AS group_order,
  CASE WHEN q.candidate_count=1 THEN
    coalesce(nullif(q.endpoint_name,''),nullif(q.endpoint_code,''),'Unnamed device')
    ||CASE WHEN nullif(q.endpoint_code,'') IS NOT NULL THEN ' ['||q.endpoint_code||']' ELSE '' END
   ELSE 'Ungrouped circuits'
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
    JOIN jsonb_array_elements(coalesce(p_result->'segment_ends','[]'::jsonb)) a(x) ON a.x->>'segment_id'=m.segment_id::text),'[]'::jsonb));
$fn$;

COMMENT ON FUNCTION public.harness_manual_compute(jsonb,jsonb) IS 'Pure bounded presentation fold using exactly one recorded typed terminal endpoint per decided circuit; ambiguous circuits remain explicitly ungrouped. Preserves recorded sections, whole circuits where they fit, every selected piece and every evaluated end address. Never derives connectivity or engineering release.';

CREATE OR REPLACE FUNCTION public.harness_manual_index(p_vehicle_id uuid,p_after text DEFAULT NULL,p_limit integer DEFAULT 25,p_query text DEFAULT NULL,p_unmodeled_after uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public SET timezone='UTC' AS $fn$
WITH input AS MATERIALIZED(SELECT CASE WHEN length(coalesce(p_query,''))<=160 AND length(coalesce(p_after,''))<=512
 THEN public.harness_model_inputs(p_vehicle_id) END AS p),
receipt AS MATERIALIZED(SELECT public.harness_model_receipt_for_hash(p_vehicle_id,md5(p::text)) AS r FROM input),
circuits AS MATERIALIZED(SELECT x FROM input CROSS JOIN LATERAL jsonb_array_elements(p->'model'->'circuits') a(x)),
segments AS MATERIALIZED(SELECT x FROM input CROSS JOIN LATERAL jsonb_array_elements(p->'model'->'segments') a(x)),
exact_code AS MATERIALIZED(SELECT x->>'id' AS id FROM circuits WHERE lower(x->>'code')=lower(btrim(p_query))),
matched_sheets AS(SELECT DISTINCT m.sheet_id FROM public.harness_model_sheet_members m CROSS JOIN receipt
 JOIN segments s ON (s.x->>'id')::uuid=m.segment_id JOIN circuits c ON c.x->>'id'=s.x->>'circuit_id'
 WHERE m.evaluation_id=(r->>'id')::uuid AND CASE WHEN EXISTS(SELECT FROM exact_code) THEN c.x->>'id' IN(SELECT id FROM exact_code)
 ELSE strpos(lower(c.x->>'code'),lower(p_query))>0 OR strpos(lower(c.x->>'name'),lower(p_query))>0 END),
page AS MATERIALIZED(SELECT h.* FROM public.harness_model_sheets h CROSS JOIN receipt
 WHERE h.evaluation_id=(r->>'id')::uuid AND (p_after IS NULL OR h.sort_key>p_after)
 AND (nullif(btrim(p_query),'') IS NULL OR (NOT EXISTS(SELECT FROM exact_code) AND (strpos(lower(h.section),lower(p_query))>0 OR strpos(lower(h.title),lower(p_query))>0)) OR h.id IN(SELECT sheet_id FROM matched_sheets))
 ORDER BY h.sort_key LIMIT greatest(1,least(coalesce(p_limit,25),25))),
unmodeled AS MATERIALIZED(SELECT c.x FROM circuits c CROSS JOIN receipt WHERE r IS NOT NULL
 AND NOT EXISTS(SELECT FROM segments s WHERE s.x->>'circuit_id'=c.x->>'id')
 AND (nullif(btrim(p_query),'') IS NULL OR CASE WHEN EXISTS(SELECT FROM exact_code) THEN c.x->>'id' IN(SELECT id FROM exact_code)
 ELSE strpos(lower(c.x->>'code'),lower(p_query))>0 OR strpos(lower(c.x->>'name'),lower(p_query))>0 OR strpos(lower(c.x->>'section'),lower(p_query))>0 END)),
unmodeled_page AS MATERIALIZED(SELECT x FROM unmodeled WHERE p_unmodeled_after IS NULL OR (x->>'id')::uuid>p_unmodeled_after
 ORDER BY (x->>'id')::uuid LIMIT greatest(1,least(coalesce(p_limit,25),25))),
body AS(SELECT jsonb_build_object('contract_version',1,'vehicle_id',p_vehicle_id,
 'vehicle_label',(SELECT nullif(concat_ws(' ',v.year,v.make,v.model),'')
   FROM public.vehicles v WHERE v.id=p_vehicle_id AND p IS NOT NULL),
 'status',CASE WHEN p IS NULL THEN 'unavailable' WHEN r IS NULL THEN public.harness_model_pending_status(p_vehicle_id,md5(p::text)) ELSE 'current' END,
 'current',r IS NOT NULL,'evaluation',r,'selection','decided_design','coverage','structural_v1',
 'source_epoch',(SELECT source_epoch FROM public.harness_model_state s WHERE s.vehicle_id=p_vehicle_id AND s.latest_evaluation_id=(r->>'id')::uuid),
 'circuits_without_pieces',coalesce((SELECT jsonb_agg(x ORDER BY x->>'id') FROM unmodeled_page),'[]'::jsonb),
 'unmodeled_next_after',CASE WHEN EXISTS(SELECT FROM unmodeled u WHERE (u.x->>'id')::uuid>(SELECT max(x->>'id')::uuid FROM unmodeled_page))
  THEN (SELECT max(x->>'id') FROM unmodeled_page) END,
 'sheets',coalesce((SELECT jsonb_agg((to_jsonb(h)-'evaluation_id')||jsonb_build_object('circuits',
   coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.x->>'id','code',c.x->>'code','name',c.x->>'name') ORDER BY c.x->>'code',c.x->>'id')
    FROM circuits c WHERE c.x->>'id' IN(SELECT s.x->>'circuit_id' FROM segments s
     JOIN public.harness_model_sheet_members m ON m.segment_id=(s.x->>'id')::uuid
     WHERE m.evaluation_id=h.evaluation_id AND m.sheet_id=h.id)),'[]'::jsonb)) ORDER BY sort_key) FROM page h),'[]'::jsonb),
 'next_after',CASE WHEN EXISTS(SELECT FROM public.harness_model_sheets h WHERE h.evaluation_id=(r->>'id')::uuid
  AND h.sort_key>(SELECT max(sort_key) FROM page)
  AND (nullif(btrim(p_query),'') IS NULL OR (NOT EXISTS(SELECT FROM exact_code) AND (strpos(lower(h.section),lower(p_query))>0 OR strpos(lower(h.title),lower(p_query))>0)) OR h.id IN(SELECT sheet_id FROM matched_sheets)))
  THEN (SELECT max(sort_key) FROM page) END,
 'rule_definitions',CASE WHEN r IS NOT NULL THEN p->'rules' ELSE '[]'::jsonb END) AS payload FROM input CROSS JOIN receipt)
SELECT payload||jsonb_build_object('snapshot_hash',md5(payload::text),'read_at',statement_timestamp()) FROM body;
$fn$;

COMMENT ON COLUMN public.harness_model_sheets.title IS 'Unique human section/sheet address, optional adjacent part number, and recorded component label or explicit ungrouped classification. Presentation only.';

-- CREATE OR REPLACE preserves existing invoker privileges and function ACLs.
-- Existing logic receipt includes both function definitions. The existing seeder
-- detects the change and queues recomputation; no production producer runs inline.
COMMIT;
