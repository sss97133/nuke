-- Bounded manual sheets over the canonical persisted evaluation; no new source owner.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';

ALTER TABLE public.harness_model_evaluations
 ADD COLUMN sheet_count integer NOT NULL DEFAULT 0 CHECK(sheet_count>=0),
 ADD COLUMN sheet_member_count integer NOT NULL DEFAULT 0 CHECK(sheet_member_count>=0),
 ADD COLUMN sheet_end_count integer NOT NULL DEFAULT 0 CHECK(sheet_end_count>=0);
COMMENT ON COLUMN public.harness_model_evaluations.sheet_count IS 'Expected immutable manual-sheet headers in this evaluation; zero on receipts predating sheet logic.';
COMMENT ON COLUMN public.harness_model_evaluations.sheet_member_count IS 'Expected physical-piece memberships; one per selected physical piece.';
COMMENT ON COLUMN public.harness_model_evaluations.sheet_end_count IS 'Expected sheet continuation addresses; one per resolved physical piece end.';
GRANT SELECT(sheet_count,sheet_member_count,sheet_end_count) ON public.harness_model_evaluations TO anon,authenticated;

CREATE TABLE public.harness_model_sheets (
 evaluation_id uuid NOT NULL REFERENCES public.harness_model_evaluations(id),
 id uuid NOT NULL,
 section text,
 ordinal integer NOT NULL CHECK(ordinal>0),
 title text NOT NULL CHECK(btrim(title)<>''),
 sort_key text NOT NULL,
 piece_count integer NOT NULL CHECK(piece_count BETWEEN 1 AND 8),
 PRIMARY KEY(evaluation_id,id),
 UNIQUE(evaluation_id,sort_key)
);
COMMENT ON TABLE public.harness_model_sheets IS 'Grain: one deterministic manual sheet in one immutable structural evaluation. Recorded circuit section and bounded piece membership partition presentation only, never electrical connectivity or engineering release.';
CREATE TABLE public.harness_model_sheet_members (
 evaluation_id uuid NOT NULL,
 sheet_id uuid NOT NULL,
 segment_id uuid NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 8),
 PRIMARY KEY(evaluation_id,sheet_id,segment_id),
 UNIQUE(evaluation_id,segment_id),
 UNIQUE(evaluation_id,sheet_id,ordinal),
 FOREIGN KEY(evaluation_id,sheet_id) REFERENCES public.harness_model_sheets(evaluation_id,id),
 FOREIGN KEY(evaluation_id,segment_id) REFERENCES public.harness_model_wire_requirements(evaluation_id,segment_id)
);
COMMENT ON TABLE public.harness_model_sheet_members IS 'Grain: one selected actual physical wire piece assigned once to a sheet of the same evaluation. Membership is presentation; it cannot create a cable or conflate connector mating with wire.';
CREATE TABLE public.harness_model_sheet_ends (
 evaluation_id uuid NOT NULL,
 sheet_id uuid NOT NULL,
 segment_id uuid NOT NULL,
 side text NOT NULL CHECK(side IN ('from','to')),
 PRIMARY KEY(evaluation_id,segment_id,side),
 FOREIGN KEY(evaluation_id,sheet_id,segment_id) REFERENCES public.harness_model_sheet_members(evaluation_id,sheet_id,segment_id),
 FOREIGN KEY(evaluation_id,segment_id,side) REFERENCES public.harness_model_segment_ends(evaluation_id,segment_id,side)
);
COMMENT ON TABLE public.harness_model_sheet_ends IS 'Grain: one sheet address of an actual evaluated piece end. Existing segment_end node/termination identity supplies continuity; this table stores no inferred electrical edge. Connector mates remain separate source relations.';
CREATE INDEX harness_model_ends_node_lookup ON public.harness_model_segment_ends(evaluation_id,node_id,segment_id,side);

ALTER TABLE public.harness_model_sheets ENABLE ROW LEVEL SECURITY;
CREATE POLICY harness_model_sheets_read ON public.harness_model_sheets FOR SELECT USING (
 EXISTS(SELECT FROM public.harness_model_evaluations e WHERE e.id=harness_model_sheets.evaluation_id));
ALTER TABLE public.harness_model_sheet_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY harness_model_sheet_members_read ON public.harness_model_sheet_members FOR SELECT USING (
 EXISTS(SELECT FROM public.harness_model_sheets s WHERE s.evaluation_id=harness_model_sheet_members.evaluation_id AND s.id=harness_model_sheet_members.sheet_id)
 AND EXISTS(SELECT FROM public.harness_model_wire_requirements q WHERE q.evaluation_id=harness_model_sheet_members.evaluation_id AND q.segment_id=harness_model_sheet_members.segment_id));
ALTER TABLE public.harness_model_sheet_ends ENABLE ROW LEVEL SECURITY;
CREATE POLICY harness_model_sheet_ends_read ON public.harness_model_sheet_ends FOR SELECT USING (
 EXISTS(SELECT FROM public.harness_model_sheet_members m WHERE m.evaluation_id=harness_model_sheet_ends.evaluation_id AND m.sheet_id=harness_model_sheet_ends.sheet_id AND m.segment_id=harness_model_sheet_ends.segment_id)
 AND EXISTS(SELECT FROM public.harness_model_segment_ends a WHERE a.evaluation_id=harness_model_sheet_ends.evaluation_id AND a.segment_id=harness_model_sheet_ends.segment_id AND a.side=harness_model_sheet_ends.side));
REVOKE ALL ON public.harness_model_sheets,public.harness_model_sheet_members,public.harness_model_sheet_ends FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.harness_model_sheets,public.harness_model_sheet_members,public.harness_model_sheet_ends TO anon,authenticated,service_role;
CREATE TRIGGER harness_model_sheets_immutable BEFORE UPDATE OR DELETE ON public.harness_model_sheets FOR EACH ROW EXECUTE FUNCTION public.vein_append_only();
CREATE TRIGGER harness_model_sheet_members_immutable BEFORE UPDATE OR DELETE ON public.harness_model_sheet_members FOR EACH ROW EXECUTE FUNCTION public.vein_append_only();
CREATE TRIGGER harness_model_sheet_ends_immutable BEFORE UPDATE OR DELETE ON public.harness_model_sheet_ends FOR EACH ROW EXECUTE FUNCTION public.vein_append_only();

CREATE FUNCTION public.harness_manual_compute(p_input jsonb,p_result jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=public AS $fn$
WITH RECURSIVE circuits AS (
 SELECT x FROM jsonb_array_elements(p_input->'model'->'circuits') a(x)),
pieces AS (
 SELECT s.x->>'id' AS segment_id,c.x->>'id' AS circuit_id,c.x->>'code' AS code,c.x->>'section' AS section,
  row_number() OVER(PARTITION BY c.x->>'id' ORDER BY s.x->>'id') AS circuit_position
 FROM jsonb_array_elements(p_input->'model'->'segments') s(x) JOIN circuits c ON c.x->>'id'=s.x->>'circuit_id'),
chunks AS (
 SELECT circuit_id,code,section,(circuit_position-1)/8 AS chunk,count(*)::integer AS weight
 FROM pieces GROUP BY circuit_id,code,section,(circuit_position-1)/8),
ordered AS (
 SELECT *,row_number() OVER(PARTITION BY section ORDER BY code COLLATE "C",circuit_id,chunk) AS position
 FROM chunks),
packed AS (
 SELECT o.*,1 AS page,weight AS used FROM ordered o WHERE position=1
 UNION ALL
 SELECT o.*,CASE WHEN p.used+o.weight>8 THEN p.page+1 ELSE p.page END,
  CASE WHEN p.used+o.weight>8 THEN o.weight ELSE p.used+o.weight END
 FROM packed p JOIN ordered o ON o.section IS NOT DISTINCT FROM p.section AND o.position=p.position+1),
assigned AS (
 SELECT a.*,p.page FROM pieces a JOIN packed p ON p.circuit_id=a.circuit_id AND p.chunk=(a.circuit_position-1)/8),
headers AS (
 SELECT section,page,md5(jsonb_build_array('manual_sheet_v1',p_input->'model'->>'vehicle_id',section,
   jsonb_agg(segment_id ORDER BY code COLLATE "C",circuit_id,circuit_position))::text)::uuid AS id,
  count(*)::integer AS piece_count
 FROM assigned GROUP BY section,page),
members AS (
 SELECT h.id AS sheet_id,a.segment_id::uuid,
  row_number() OVER(PARTITION BY h.id ORDER BY a.code COLLATE "C",a.circuit_id,a.circuit_position)::integer AS ordinal
 FROM assigned a JOIN headers h ON h.section IS NOT DISTINCT FROM a.section AND h.page=a.page)
SELECT jsonb_build_object(
 'sheets',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'section',section,'ordinal',page,
    'title',coalesce(initcap(replace(section,'_',' ')),'Unassigned section')||' / '||page,
    'sort_key',coalesce(section,'~unassigned')||'/'||lpad(page::text,10,'0'),'piece_count',piece_count)
    ORDER BY section NULLS LAST,page) FROM headers),'[]'::jsonb),
 'members',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY sheet_id,ordinal) FROM members m),'[]'::jsonb),
 'ends',coalesce((SELECT jsonb_agg(jsonb_build_object('sheet_id',m.sheet_id,'segment_id',m.segment_id,'side',a.x->>'side')
    ORDER BY m.sheet_id,m.ordinal,a.x->>'side') FROM members m
    JOIN jsonb_array_elements(p_result->'segment_ends') a(x) ON a.x->>'segment_id'=m.segment_id::text),'[]'::jsonb));
$fn$;
COMMENT ON FUNCTION public.harness_manual_compute(jsonb,jsonb) IS 'Pure deterministic presentation fold: at most eight source pieces per sheet, next-fit circuit chunks within recorded sections, and exact existing end addresses. It never derives continuity from sorting, raw labels or sheet adjacency.';
REVOKE ALL ON FUNCTION public.harness_manual_compute(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.harness_manual_compute(jsonb,jsonb) TO service_role;

-- Preserve the reviewed producer and its atomic exception/backoff path. Fail closed if its source drifted.
DO $patch$
DECLARE body text:=pg_get_functiondef('public.harness_model_fold(uuid)'::regprocedure); old text; replacement text;
BEGIN
 old:='result:=public.harness_model_compute(inp);';
 replacement:=old||E'\n   result:=result||jsonb_build_object(''manual'',public.harness_manual_compute(inp,result));';
 IF (length(body)-length(replace(body,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'manual fold compute anchor drifted'; END IF;
 body:=replace(body,old,replacement);
 old:='node_count,segment_end_count,check_count,wire_requirement_count)';
 replacement:='node_count,segment_end_count,check_count,wire_requirement_count,sheet_count,sheet_member_count,sheet_end_count)';
 IF (length(body)-length(replace(body,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'manual count columns anchor drifted'; END IF;
 body:=replace(body,old,replacement);
 old:='jsonb_array_length(result->''checks''),jsonb_array_length(result->''wire_requirements'')) RETURNING id INTO evaluation;';
 replacement:='jsonb_array_length(result->''checks''),jsonb_array_length(result->''wire_requirements''),jsonb_array_length(result->''manual''->''sheets''),jsonb_array_length(result->''manual''->''members''),jsonb_array_length(result->''manual''->''ends'')) RETURNING id INTO evaluation;';
 IF (length(body)-length(replace(body,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'manual count values anchor drifted'; END IF;
 body:=replace(body,old,replacement);
 old:=E'  END IF;\n  -- An intervening source commit';
 replacement:=E'   INSERT INTO public.harness_model_sheets(evaluation_id,id,section,ordinal,title,sort_key,piece_count)\n'
  ||E'    SELECT evaluation,x.id,x.section,x.ordinal,x.title,x.sort_key,x.piece_count FROM jsonb_to_recordset(result->''manual''->''sheets'') x(id uuid,section text,ordinal integer,title text,sort_key text,piece_count integer);\n'
  ||E'   INSERT INTO public.harness_model_sheet_members(evaluation_id,sheet_id,segment_id,ordinal)\n'
  ||E'    SELECT evaluation,x.sheet_id,x.segment_id,x.ordinal FROM jsonb_to_recordset(result->''manual''->''members'') x(sheet_id uuid,segment_id uuid,ordinal integer);\n'
  ||E'   INSERT INTO public.harness_model_sheet_ends(evaluation_id,sheet_id,segment_id,side)\n'
  ||E'    SELECT evaluation,x.sheet_id,x.segment_id,x.side FROM jsonb_to_recordset(result->''manual''->''ends'') x(sheet_id uuid,segment_id uuid,side text);\n'
  ||old;
 IF (length(body)-length(replace(body,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'manual child insert anchor drifted'; END IF;
 EXECUTE replace(body,old,replacement);
END $patch$;

-- This low-level predicate compares an explicitly supplied input hash. Only the public readers
-- below capture that hash themselves and label a result current. It exposes metadata, never receipts.
CREATE FUNCTION public.harness_model_receipt_for_hash(p_vehicle_id uuid,p_input_hash text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public SET timezone='UTC' AS $fn$
SELECT to_jsonb(r)-'input_snapshot'-'logic_snapshot' FROM public.harness_model_state s
JOIN LATERAL (SELECT e.id,e.vehicle_id,e.input_hash,e.logic_key,e.coverage,e.evaluated_at,
 e.node_count,e.segment_end_count,e.check_count,e.wire_requirement_count,e.sheet_count,e.sheet_member_count,e.sheet_end_count
 FROM public.harness_model_evaluations e WHERE e.id=s.latest_evaluation_id) r ON true
WHERE s.vehicle_id=p_vehicle_id AND public.harness_model_visible(p_vehicle_id)
 AND s.source_epoch=s.folded_epoch AND s.last_error_code IS NULL
 AND r.input_hash=p_input_hash AND r.logic_key=public.harness_model_logic_key()
 AND r.node_count=(SELECT count(*) FROM public.harness_model_nodes n WHERE n.evaluation_id=r.id)
 AND r.segment_end_count=(SELECT count(*) FROM public.harness_model_segment_ends a WHERE a.evaluation_id=r.id)
 AND r.check_count=(SELECT count(*) FROM public.harness_model_checks c WHERE c.evaluation_id=r.id)
 AND r.wire_requirement_count=(SELECT count(*) FROM public.harness_model_wire_requirements q WHERE q.evaluation_id=r.id)
 AND r.sheet_count=(SELECT count(*) FROM public.harness_model_sheets h WHERE h.evaluation_id=r.id)
 AND r.sheet_member_count=(SELECT count(*) FROM public.harness_model_sheet_members m WHERE m.evaluation_id=r.id)
 AND r.sheet_end_count=(SELECT count(*) FROM public.harness_model_sheet_ends a WHERE a.evaluation_id=r.id);
$fn$;
COMMENT ON FUNCTION public.harness_model_receipt_for_hash(uuid,text) IS 'Low-level invoker predicate: eligible complete evaluation metadata matching the caller-supplied hash. It does not assert that this hash represents the current source. Public manual readers compute the actual current source hash inside their own stable statement before calling it.';

CREATE FUNCTION public.harness_model_pending_status(p_vehicle_id uuid,p_input_hash text) RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $fn$
SELECT CASE WHEN NOT public.harness_model_visible(p_vehicle_id) THEN 'unavailable'
 WHEN s.last_error_code IS NOT NULL THEN 'error'
 WHEN s.source_epoch=s.folded_epoch AND e.input_hash=p_input_hash AND e.logic_key=public.harness_model_logic_key()
 THEN 'incomplete_visibility' ELSE 'pending' END
FROM (SELECT 1) one LEFT JOIN public.harness_model_state s ON s.vehicle_id=p_vehicle_id
LEFT JOIN public.harness_model_evaluations e ON e.id=s.latest_evaluation_id;
$fn$;
COMMENT ON FUNCTION public.harness_model_pending_status(uuid,text) IS 'Explains absence of a complete receipt for a supplied source hash; reports unavailable, pending, error or incomplete visible children without exposing private snapshots or error details.';

CREATE FUNCTION public.harness_manual_cursor(p_vehicle_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $fn$
SELECT CASE WHEN NOT public.harness_model_visible(p_vehicle_id) THEN jsonb_build_object('vehicle_id',p_vehicle_id,'visible',false,'eligible_cursor',false)
 ELSE jsonb_build_object('vehicle_id',p_vehicle_id,'visible',true,'evaluation_id',s.latest_evaluation_id,
 'source_epoch',s.source_epoch,'folded_epoch',s.folded_epoch,'has_error',s.last_error_code IS NOT NULL,
 'eligible_cursor',coalesce(s.source_epoch=s.folded_epoch AND s.last_error_code IS NULL
  AND e.logic_key=public.harness_model_logic_key(),false)) END
FROM (SELECT 1) one LEFT JOIN public.harness_model_state s ON s.vehicle_id=p_vehicle_id
LEFT JOIN public.harness_model_evaluations e ON e.id=s.latest_evaluation_id;
$fn$;
COMMENT ON FUNCTION public.harness_manual_cursor(uuid) IS 'Small public polling cursor, including a current code-key comparison so code-only changes invalidate a displayed sheet. It does not rehash source or assert full output completeness; only manual index/sheet reads publish a source-verified current model.';

CREATE FUNCTION public.harness_manual_index(p_vehicle_id uuid,p_after text DEFAULT NULL,p_limit integer DEFAULT 25,p_query text DEFAULT NULL,p_unmodeled_after uuid DEFAULT NULL) RETURNS jsonb
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
 AND (nullif(btrim(p_query),'') IS NULL OR (NOT EXISTS(SELECT FROM exact_code) AND strpos(lower(h.section),lower(p_query))>0) OR h.id IN(SELECT sheet_id FROM matched_sheets))
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
  AND (nullif(btrim(p_query),'') IS NULL OR (NOT EXISTS(SELECT FROM exact_code) AND strpos(lower(h.section),lower(p_query))>0) OR h.id IN(SELECT sheet_id FROM matched_sheets)))
  THEN (SELECT max(sort_key) FROM page) END,
 'rule_definitions',CASE WHEN r IS NOT NULL THEN p->'rules' ELSE '[]'::jsonb END) AS payload FROM input CROSS JOIN receipt)
SELECT payload||jsonb_build_object('snapshot_hash',md5(payload::text),'read_at',statement_timestamp()) FROM body;
$fn$;
COMMENT ON FUNCTION public.harness_manual_index(uuid,text,integer,text,uuid) IS 'Public invoker-RLS manual index; at most25 sheet headers with at most8 source circuit labels per keyset page, searchable by recorded section, wire code or function. Separately pages at most25 selected circuits missing physical pieces; absence is not zero demand. Captures and verifies actual current source/code/completeness. IDs are bound to an evaluation; structural currentness is not engineering or purchasing release.';

CREATE FUNCTION public.harness_manual_sheet(p_vehicle_id uuid,p_evaluation_id uuid,p_sheet_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public SET timezone='UTC' AS $fn$
WITH input AS MATERIALIZED(SELECT public.harness_model_inputs(p_vehicle_id) AS p),
receipt AS MATERIALIZED(SELECT public.harness_model_receipt_for_hash(p_vehicle_id,md5(p::text)) AS r FROM input),
sheet AS MATERIALIZED(SELECT h.* FROM public.harness_model_sheets h CROSS JOIN receipt
 WHERE h.evaluation_id=(r->>'id')::uuid AND h.evaluation_id=p_evaluation_id AND h.id=p_sheet_id),
members AS MATERIALIZED(SELECT m.* FROM public.harness_model_sheet_members m JOIN sheet h USING(evaluation_id) WHERE m.sheet_id=h.id),
ends AS MATERIALIZED(SELECT a.* FROM public.harness_model_segment_ends a JOIN members m USING(evaluation_id,segment_id)),
segments AS MATERIALIZED(SELECT x FROM input CROSS JOIN LATERAL jsonb_array_elements(p->'model'->'segments') a(x)
 WHERE (x->>'id')::uuid IN(SELECT segment_id FROM members)),
circuits AS MATERIALIZED(SELECT x FROM input CROSS JOIN LATERAL jsonb_array_elements(p->'model'->'circuits') a(x)
 WHERE x->>'id' IN(SELECT x->>'circuit_id' FROM segments)),
terms AS MATERIALIZED(SELECT x FROM input CROSS JOIN LATERAL jsonb_array_elements(p->'model'->'terminations') a(x)
 WHERE x->>'id' IN(SELECT x->>'from_termination_id' FROM segments UNION SELECT x->>'to_termination_id' FROM segments)),
nodes AS MATERIALIZED(SELECT n.* FROM public.harness_model_nodes n CROSS JOIN receipt
 WHERE n.evaluation_id=(r->>'id')::uuid AND n.id IN(SELECT node_id FROM ends)),
checks AS MATERIALIZED(SELECT c.* FROM public.harness_model_checks c CROSS JOIN receipt WHERE c.evaluation_id=(r->>'id')::uuid
 AND (c.segment_id IN(SELECT segment_id FROM members) OR c.termination_id::text IN(SELECT x->>'id' FROM terms)
 OR c.circuit_id::text IN(SELECT x->>'id' FROM circuits) OR (c.segment_id IS NULL AND c.termination_id IS NULL AND c.circuit_id IS NULL
  AND to_jsonb(c)->>'component_requirement_id' IS NULL))),
body AS(SELECT jsonb_build_object('contract_version',1,'vehicle_id',p_vehicle_id,
 'vehicle_label',(SELECT nullif(concat_ws(' ',v.year,v.make,v.model),'')
   FROM public.vehicles v WHERE v.id=p_vehicle_id AND p IS NOT NULL),
 'status',CASE WHEN p IS NULL THEN 'unavailable' WHEN r IS NULL THEN public.harness_model_pending_status(p_vehicle_id,md5(p::text))
  WHEN (r->>'id')::uuid<>p_evaluation_id THEN 'pending'
  WHEN NOT EXISTS(SELECT FROM sheet) THEN 'unavailable' ELSE 'current' END,
 'current',EXISTS(SELECT FROM sheet),'evaluation',r,'sheet',(SELECT to_jsonb(h)-'evaluation_id' FROM sheet h),
 'model',CASE WHEN EXISTS(SELECT FROM sheet) THEN jsonb_build_object(
  'contract_version',2,'vehicle_id',p_vehicle_id,'evaluation_id',r->>'id','evaluated_at',r->>'evaluated_at',
  'selection','decided_design','coverage','structural_v1','snapshot_kind','current_read_not_published_revision',
  'sheet_id',p_sheet_id,'sheet_scope','bounded_manual_sheet',
  'circuits',coalesce((SELECT jsonb_agg(x ORDER BY x->>'id') FROM circuits),'[]'::jsonb),
  'segments',coalesce((SELECT jsonb_agg(x ORDER BY x->>'id') FROM segments),'[]'::jsonb),
  'terminations',coalesce((SELECT jsonb_agg(x ORDER BY x->>'id') FROM terms),'[]'::jsonb),
  'endpoints',coalesce((SELECT jsonb_agg(x ORDER BY x->>'id') FROM jsonb_array_elements(p->'model'->'endpoints') a(x)
    WHERE x->>'id' IN(SELECT x->>'endpoint_id' FROM terms)),'[]'::jsonb),
  'nets',coalesce((SELECT jsonb_agg(x ORDER BY x->>'id') FROM jsonb_array_elements(p->'model'->'nets') a(x)
    WHERE x->>'id' IN(SELECT x->>'net_id' FROM segments)),'[]'::jsonb),
  'connector_matings',coalesce((SELECT jsonb_agg(x ORDER BY x::text) FROM
    (SELECT x FROM jsonb_array_elements(p->'model'->'connector_matings') a(x)
     WHERE x->>'from_endpoint_id' IN(SELECT x->>'endpoint_id' FROM terms)
       OR x->>'to_endpoint_id' IN(SELECT x->>'endpoint_id' FROM terms) ORDER BY x::text LIMIT 50) limited),'[]'::jsonb),
  'connector_matings_complete',(SELECT count(*)<=50 FROM jsonb_array_elements(p->'model'->'connector_matings') a(x)
    WHERE x->>'from_endpoint_id' IN(SELECT x->>'endpoint_id' FROM terms) OR x->>'to_endpoint_id' IN(SELECT x->>'endpoint_id' FROM terms)),
  'electrical_nodes',coalesce((SELECT jsonb_agg(to_jsonb(n)-'evaluation_id' ORDER BY n.id) FROM nodes n),'[]'::jsonb),
  'segment_ends',coalesce((SELECT jsonb_agg(to_jsonb(a)-'evaluation_id' ORDER BY a.segment_id,a.side) FROM ends a),'[]'::jsonb),
  'model_checks',coalesce((SELECT jsonb_agg(to_jsonb(c)-'evaluation_id' ORDER BY c.id) FROM checks c),'[]'::jsonb),
  'wire_requirements',coalesce((SELECT jsonb_agg(to_jsonb(q)-'evaluation_id' ORDER BY q.segment_id)
    FROM public.harness_model_wire_requirements q WHERE q.evaluation_id=p_evaluation_id AND q.segment_id IN(SELECT segment_id FROM members)),'[]'::jsonb),
  'rule_definitions',p->'rules',
  'attention_check_ids',coalesce((SELECT jsonb_agg(c.id ORDER BY CASE c.result WHEN 'fail' THEN 0 ELSE 1 END,d.attention_order,c.id)
    FROM checks c JOIN public.harness_model_rules d ON d.rule_key=c.rule_key AND d.version=c.rule_version WHERE c.result<>'pass'),'[]'::jsonb)
 ) END) AS payload FROM input CROSS JOIN receipt),
hashed AS(SELECT payload||jsonb_build_object('model',CASE WHEN payload->'model'<>'null'::jsonb
 THEN payload->'model'||jsonb_build_object('snapshot_hash',md5((payload->'model')::text)) ELSE NULL END) AS payload FROM body)
SELECT payload||jsonb_build_object('snapshot_hash',md5(payload::text),'read_at',statement_timestamp()) FROM hashed;
$fn$;
COMMENT ON FUNCTION public.harness_manual_sheet(uuid,uuid,uuid) IS 'Bounded public sheet: at most8 actual pieces with their keyed ends, selected source facts and persisted checks. Explicit expected evaluation prevents silently following a changed plan. Connector mates stay separate; off-sheet electrical addresses use the continuation reader.';

CREATE FUNCTION public.harness_manual_continuations(p_vehicle_id uuid,p_evaluation_id uuid,p_segment_id uuid,p_side text,p_after text DEFAULT NULL,p_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public SET timezone='UTC' AS $fn$
WITH input AS MATERIALIZED(SELECT public.harness_model_inputs(p_vehicle_id) AS p),
receipt AS MATERIALIZED(SELECT public.harness_model_receipt_for_hash(p_vehicle_id,md5(p::text)) AS r FROM input),
origin AS MATERIALIZED(SELECT a.* FROM public.harness_model_segment_ends a CROSS JOIN receipt
 WHERE a.evaluation_id=(r->>'id')::uuid AND a.evaluation_id=p_evaluation_id AND a.segment_id=p_segment_id AND a.side=p_side),
targets AS(SELECT a.segment_id,a.side,a.termination_id,a.node_id,h.sheet_id,sh.title AS sheet_title,
 c.circuit_code AS wire_code,e.code AS endpoint_code,t.cavity,
 a.segment_id::text||'/'||a.side AS sort_key FROM origin o
 JOIN public.harness_model_segment_ends a ON a.evaluation_id=o.evaluation_id AND a.node_id=o.node_id
 JOIN public.harness_model_sheet_ends h ON h.evaluation_id=a.evaluation_id AND h.segment_id=a.segment_id AND h.side=a.side
 JOIN public.harness_model_sheets sh ON sh.evaluation_id=h.evaluation_id AND sh.id=h.sheet_id
 JOIN public.wire_termination_specs t ON t.id=a.termination_id JOIN public.harness_endpoints e ON e.id=t.endpoint_id
 JOIN public.harness_segments s ON s.id=a.segment_id JOIN public.vehicle_custom_circuits c ON c.id=s.vehicle_custom_circuit_id
 WHERE (a.segment_id,a.side)<>(o.segment_id,o.side)),
page AS MATERIALIZED(SELECT * FROM targets WHERE p_after IS NULL OR sort_key>p_after ORDER BY sort_key
 LIMIT greatest(1,least(coalesce(p_limit,50),50)))
SELECT jsonb_build_object('vehicle_id',p_vehicle_id,'evaluation_id',r->>'id',
 'status',CASE WHEN r IS NULL OR (r->>'id')::uuid<>p_evaluation_id THEN 'pending'
  WHEN NOT EXISTS(SELECT FROM origin) THEN 'unavailable' ELSE 'current' END,
 'relation','same_evaluated_electrical_node','origin',(SELECT to_jsonb(o)-'evaluation_id' FROM origin o),
 'destinations',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY sort_key) FROM page a),'[]'::jsonb),
 'next_after',CASE WHEN EXISTS(SELECT FROM targets t WHERE t.sort_key>(SELECT max(sort_key) FROM page)) THEN (SELECT max(sort_key) FROM page) END)
FROM receipt;
$fn$;
COMMENT ON FUNCTION public.harness_manual_continuations(uuid,uuid,uuid,text,text,integer) IS 'At most50 exact same-node end addresses per keyset page. An isolated unresolved end has no inferred continuation. This relation is electrical-node identity only; it does not create a conductor, contact assembly or a connector mating.';

CREATE FUNCTION public.harness_manual_mate_context(p_vehicle_id uuid,p_evaluation_id uuid,p_segment_id uuid,p_side text,p_after text DEFAULT NULL,p_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public SET timezone='UTC' AS $fn$
WITH input AS MATERIALIZED(SELECT public.harness_model_inputs(p_vehicle_id) AS p),
receipt AS MATERIALIZED(SELECT public.harness_model_receipt_for_hash(p_vehicle_id,md5(p::text)) AS r FROM input),
origin AS MATERIALIZED(SELECT a.*,n.endpoint_id,n.net_id FROM public.harness_model_segment_ends a
 JOIN public.harness_model_nodes n ON n.evaluation_id=a.evaluation_id AND n.id=a.node_id CROSS JOIN receipt
 WHERE a.evaluation_id=(r->>'id')::uuid AND a.evaluation_id=p_evaluation_id AND a.segment_id=p_segment_id AND a.side=p_side),
mates AS(SELECT x FROM input CROSS JOIN LATERAL jsonb_array_elements(p->'model'->'connector_matings') a(x)),
targets AS(
 SELECT DISTINCT ON(a.segment_id,a.side) a.segment_id,a.side,a.termination_id,a.node_id,n.endpoint_id,h.sheet_id,sh.title AS sheet_title,
 c.circuit_code AS wire_code,e.code AS endpoint_code,t.cavity,m.x AS recorded_mating,
  a.segment_id::text||'/'||a.side AS sort_key FROM origin o
 JOIN mates m ON o.endpoint_id::text IN(m.x->>'from_endpoint_id',m.x->>'to_endpoint_id')
 JOIN public.harness_model_nodes n ON n.evaluation_id=o.evaluation_id AND n.net_id=o.net_id AND n.endpoint_id<>o.endpoint_id
  AND n.endpoint_id::text IN(m.x->>'from_endpoint_id',m.x->>'to_endpoint_id')
 JOIN public.harness_model_segment_ends a ON a.evaluation_id=n.evaluation_id AND a.node_id=n.id
 JOIN public.harness_model_sheet_ends h ON h.evaluation_id=a.evaluation_id AND h.segment_id=a.segment_id AND h.side=a.side
 JOIN public.harness_model_sheets sh ON sh.evaluation_id=h.evaluation_id AND sh.id=h.sheet_id
 JOIN public.wire_termination_specs t ON t.id=a.termination_id JOIN public.harness_endpoints e ON e.id=t.endpoint_id
 JOIN public.harness_segments s ON s.id=a.segment_id JOIN public.vehicle_custom_circuits c ON c.id=s.vehicle_custom_circuit_id
 ORDER BY a.segment_id,a.side,m.x::text),
page AS MATERIALIZED(SELECT * FROM targets WHERE p_after IS NULL OR sort_key>p_after ORDER BY sort_key
 LIMIT greatest(1,least(coalesce(p_limit,50),50)))
SELECT jsonb_build_object('vehicle_id',p_vehicle_id,'evaluation_id',r->>'id',
 'status',CASE WHEN r IS NULL OR (r->>'id')::uuid<>p_evaluation_id THEN 'pending'
  WHEN NOT EXISTS(SELECT FROM origin) THEN 'unavailable' ELSE 'current' END,
 'relation','recorded_connector_mate_same_declared_net','contact_mapping_qualified',false,
 'origin',(SELECT to_jsonb(o)-'evaluation_id' FROM origin o),
 'destinations',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY sort_key) FROM page a),'[]'::jsonb),
 'next_after',CASE WHEN EXISTS(SELECT FROM targets t WHERE t.sort_key>(SELECT max(sort_key) FROM page)) THEN (SELECT max(sort_key) FROM page) END)
FROM receipt;
$fn$;
COMMENT ON FUNCTION public.harness_manual_mate_context(uuid,uuid,uuid,text,text,integer) IS 'At most50 actual sheet end addresses on an explicitly recorded connector mate and the same recorded net. It is mate context, never a new conductor, node union or qualified cavity-to-cavity mapping. Both raw contact identities must be shown and contact mapping remains unqualified.';

CREATE FUNCTION public.harness_model_collection_page(p_vehicle_id uuid,p_evaluation_id uuid,p_collection text,p_after text DEFAULT NULL,p_limit integer DEFAULT 100) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public SET timezone='UTC' AS $fn$
WITH receipt AS MATERIALIZED(
 SELECT public.harness_model_receipt_for_hash(p_vehicle_id,e.input_hash) AS r
 FROM public.harness_model_evaluations e WHERE e.id=p_evaluation_id AND e.vehicle_id=p_vehicle_id),
eligible AS MATERIALIZED(SELECT r FROM receipt WHERE (r->>'id')::uuid=p_evaluation_id),
rows AS(
 SELECT c.id::text AS key,to_jsonb(c)-'evaluation_id' AS data FROM public.harness_model_checks c
 WHERE p_collection='checks' AND c.evaluation_id=p_evaluation_id AND EXISTS(SELECT FROM eligible)
 UNION ALL
 SELECT n.id::text,to_jsonb(n)-'evaluation_id' FROM public.harness_model_nodes n
 WHERE p_collection='nodes' AND n.evaluation_id=p_evaluation_id AND EXISTS(SELECT FROM eligible)
 UNION ALL
 SELECT a.segment_id::text||'/'||a.side,to_jsonb(a)-'evaluation_id' FROM public.harness_model_segment_ends a
 WHERE p_collection='ends' AND a.evaluation_id=p_evaluation_id AND EXISTS(SELECT FROM eligible)
 UNION ALL
 SELECT q.segment_id::text,to_jsonb(q)-'evaluation_id' FROM public.harness_model_wire_requirements q
 WHERE p_collection='wire_requirements' AND q.evaluation_id=p_evaluation_id AND EXISTS(SELECT FROM eligible)),
page AS MATERIALIZED(SELECT * FROM rows WHERE p_after IS NULL OR key>p_after ORDER BY key
 LIMIT greatest(1,least(coalesce(p_limit,100),100)))
SELECT jsonb_build_object('vehicle_id',p_vehicle_id,'evaluation_id',p_evaluation_id,
 'status',CASE WHEN p_collection IS NULL OR p_collection NOT IN('checks','nodes','ends','wire_requirements') THEN 'unavailable'
  WHEN NOT EXISTS(SELECT FROM eligible) THEN 'pending' ELSE 'available' END,
 'qualification','immutable_evaluation_page_recheck_manifest',
 'collection',p_collection,'rows',coalesce((SELECT jsonb_agg(data ORDER BY key) FROM page),'[]'::jsonb),
 'next_after',CASE WHEN EXISTS(SELECT FROM rows x WHERE x.key>(SELECT max(key) FROM page)) THEN (SELECT max(key) FROM page) END);
$fn$;
COMMENT ON FUNCTION public.harness_model_collection_page(uuid,uuid,text,text,integer) IS 'At most100 immutable derived rows per keyset page, scoped to the exact visible current cursor/code and complete evaluation. This avoids rehashing all source inputs per collection page. It deliberately labels rows available, not a newly source-verified current model; consumers must recheck the source-verified manual index before publishing an assembled export. Old evaluations are never silently retargeted.';

-- Include all new producer/reader definitions in the existing code receipt. No separate scheduler.
DO $patch$
DECLARE body text:=pg_get_functiondef('public.harness_model_logic_snapshot()'::regprocedure); old text:='''postgres_version'',current_setting(''server_version_num'')'; replacement text;
BEGIN
 replacement:=E'''harness_manual_compute(jsonb,jsonb)'',pg_get_functiondef(''public.harness_manual_compute(jsonb,jsonb)''::regprocedure),\n'
  ||E'  ''harness_model_receipt_for_hash(uuid,text)'',pg_get_functiondef(''public.harness_model_receipt_for_hash(uuid,text)''::regprocedure),\n'
  ||E'  ''harness_model_pending_status(uuid,text)'',pg_get_functiondef(''public.harness_model_pending_status(uuid,text)''::regprocedure),\n'
  ||E'  ''harness_manual_cursor(uuid)'',pg_get_functiondef(''public.harness_manual_cursor(uuid)''::regprocedure),\n'
  ||E'  ''harness_model_collection_page(uuid,uuid,text,text,integer)'',pg_get_functiondef(''public.harness_model_collection_page(uuid,uuid,text,text,integer)''::regprocedure),\n'
  ||E'  ''harness_manual_index(uuid,text,integer,text,uuid)'',pg_get_functiondef(''public.harness_manual_index(uuid,text,integer,text,uuid)''::regprocedure),\n'
  ||E'  ''harness_manual_sheet(uuid,uuid,uuid)'',pg_get_functiondef(''public.harness_manual_sheet(uuid,uuid,uuid)''::regprocedure),\n'
  ||E'  ''harness_manual_continuations(uuid,uuid,uuid,text,text,integer)'',pg_get_functiondef(''public.harness_manual_continuations(uuid,uuid,uuid,text,text,integer)''::regprocedure),\n  '||old;
 replacement:=replace(replacement,old,E'''harness_manual_mate_context(uuid,uuid,uuid,text,text,integer)'',pg_get_functiondef(''public.harness_manual_mate_context(uuid,uuid,uuid,text,text,integer)''::regprocedure),\n  '||old);
 IF (length(body)-length(replace(body,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'manual logic receipt anchor drifted'; END IF;
 EXECUTE replace(body,old,replacement);
END $patch$;

REVOKE ALL ON FUNCTION public.harness_model_receipt_for_hash(uuid,text),public.harness_manual_index(uuid,text,integer,text,uuid),
 public.harness_manual_sheet(uuid,uuid,uuid),public.harness_manual_continuations(uuid,uuid,uuid,text,text,integer),
 public.harness_model_pending_status(uuid,text),public.harness_model_collection_page(uuid,uuid,text,text,integer),
 public.harness_manual_mate_context(uuid,uuid,uuid,text,text,integer),public.harness_manual_cursor(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.harness_model_receipt_for_hash(uuid,text),public.harness_manual_index(uuid,text,integer,text,uuid),
 public.harness_manual_sheet(uuid,uuid,uuid),public.harness_manual_continuations(uuid,uuid,uuid,text,text,integer),
 public.harness_model_pending_status(uuid,text),public.harness_model_collection_page(uuid,uuid,text,text,integer),
 public.harness_manual_mate_context(uuid,uuid,uuid,text,text,integer),public.harness_manual_cursor(uuid)
 TO anon,authenticated,service_role;
-- The existing production UI still uses its source reader. New public consumers use bounded sheets.
REVOKE EXECUTE ON FUNCTION public.harness_evaluated_model(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.harness_evaluated_model(uuid) TO service_role;
COMMENT ON FUNCTION public.harness_evaluated_model(uuid) IS 'Service diagnostic of the complete evaluated graph. Public consumers use bounded manual index/sheet/continuation reads; this bulk derived-collections endpoint is not an anonymous API.';

-- Preserve the former definition for old checks; absence of a progress record never proves work reconciled.
UPDATE public.harness_model_rules SET is_current=false,superseded_at=clock_timestamp()
 WHERE rule_key='new_wire_demand' AND is_current;
INSERT INTO public.harness_model_rules(rule_key,version,subject_kind,description,display_name,attention_action,attention_order,implementation)
VALUES('new_wire_demand','2','segment',
 'Checks for recorded physical progress or measurement. Any recorded progress holds new-wire demand. Absence of such a record is not proof of no existing material; allocation and ordering remain separate.',
 'Physical-progress records checked','Reconcile recorded cuts, measurements and stock allocation before adding wire to an order.',60,'public.harness_model_compute(jsonb)'::regprocedure);

COMMENT ON COLUMN public.harness_model_sheets.evaluation_id IS 'Owning immutable input/code-bound evaluation.';
COMMENT ON COLUMN public.harness_model_sheets.id IS 'Content-derived sheet key; always bind with evaluation_id.';
COMMENT ON COLUMN public.harness_model_sheets.section IS 'Recorded source circuit section, nullable when unassigned.';
COMMENT ON COLUMN public.harness_model_sheets.ordinal IS 'One-based sheet position within its recorded section.';
COMMENT ON COLUMN public.harness_model_sheets.title IS 'Presentation title derived from recorded section and ordinal.';
COMMENT ON COLUMN public.harness_model_sheets.sort_key IS 'Deterministic index/keyset order, not an electrical relationship.';
COMMENT ON COLUMN public.harness_model_sheets.piece_count IS 'Expected piece memberships; hard bound of eight for legibility.';
COMMENT ON COLUMN public.harness_model_sheet_members.evaluation_id IS 'Same evaluation as the owning sheet and wire requirement.';
COMMENT ON COLUMN public.harness_model_sheet_members.sheet_id IS 'Owning bounded sheet key in this evaluation.';
COMMENT ON COLUMN public.harness_model_sheet_members.segment_id IS 'Actual selected physical piece; assigned exactly once per evaluation.';
COMMENT ON COLUMN public.harness_model_sheet_members.ordinal IS 'One-based presentation lane within its sheet; never electrical order.';
COMMENT ON COLUMN public.harness_model_sheet_ends.evaluation_id IS 'Same evaluation as the existing segment end and sheet membership.';
COMMENT ON COLUMN public.harness_model_sheet_ends.sheet_id IS 'Sheet address of the actual physical piece end.';
COMMENT ON COLUMN public.harness_model_sheet_ends.segment_id IS 'Actual piece addressed on this sheet.';
COMMENT ON COLUMN public.harness_model_sheet_ends.side IS 'Recorded from/to attachment, referencing the same-evaluation segment end.';

-- Existing scheduled seeder detects the logic change. No production fold is invoked here.
COMMIT;
