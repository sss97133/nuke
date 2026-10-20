-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations (chained on the job-loop replay).
-- work_order_provider_matches_read: who may read, who is listed, ranking by passed inputs only, every input shown, handles only.
\ir test_job_loop_replay.sql

CREATE FUNCTION public.as_user(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT set_config('test.auth_uid',COALESCE(p::text,''),false) $$;
GRANT EXECUTE ON FUNCTION public.as_user(uuid) TO anon, authenticated, service_role;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS city text, ADD COLUMN IF NOT EXISTS state text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS is_public boolean, ADD COLUMN IF NOT EXISTS city text, ADD COLUMN IF NOT EXISTS state text;
UPDATE vehicles SET is_public = true, city = 'Reno', state = 'NV' WHERE id = '40000000-0000-0000-0000-000000000001';
INSERT INTO city_geocode_lookup(city,state,latitude,longitude,sample_size) VALUES ('Reno','NV',39.5296,-119.8138,673),('Sparks','NV',39.5349,-119.7527,90);
ALTER TABLE work_order_line_items DROP CONSTRAINT work_order_line_items_task_type_check;
INSERT INTO work_order_line_items(id,work_order_id,line_number,task_type,task_description,status) VALUES
 ('51000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1,'fabricate','Headers','pending');
INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,observed_at,extraction_method,structured_data) VALUES
 ('55000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','work_record','90000000-0000-0000-0000-000000000001','2026-03-02','requirement_interpretation_v1',
  jsonb_build_object('work_order_resource',jsonb_build_object('version',1,'event_type','requirement','work_order_id','30000000-0000-0000-0000-000000000001',
   'line_item_id','51000000-0000-0000-0000-000000000001','requirement_kind','skill','description','TIG welding of the headers','quantity',NULL,'unit',NULL))),
 ('55000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','work_record','90000000-0000-0000-0000-000000000001','2026-03-02','requirement_interpretation_v1',
  jsonb_build_object('work_order_resource',jsonb_build_object('version',1,'event_type','requirement','work_order_id','30000000-0000-0000-0000-000000000001',
   'line_item_id','51000000-0000-0000-0000-000000000001','requirement_kind','tool','description','MIG welder','quantity',1,'unit','unit')));
SET ROLE service_role;
SELECT project_work_order_resource_observation('55000000-0000-0000-0000-000000000001');
SELECT project_work_order_resource_observation('55000000-0000-0000-0000-000000000002');
RESET ROLE;
-- 0f: evidenced link to a welding actor, a claimed MIG welder, public handle. 09 and 0d: organization members without links.
INSERT INTO account_link_claims(id,user_id,platform,handle,actor_id,status,verification_method) VALUES
 ('c1000000-0000-0000-0000-0000000000f1','10000000-0000-0000-0000-00000000000f','nuke_actor','60000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','pending','self_claim');
INSERT INTO work_sessions(id,user_id,vehicle_id,session_date) VALUES
 ('61000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000f','40000000-0000-0000-0000-000000000001','2026-03-01');
SET ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SELECT approve_actor_link_claim('c1000000-0000-0000-0000-0000000000f1', 'work_evidence',
  '[{"kind":"work_session","id":"61000000-0000-0000-0000-000000000001"}]', '10000000-0000-0000-0000-00000000000a');
SELECT set_config('request.jwt.claims', '', false);
RESET ROLE;
INSERT INTO actor_capabilities(actor_id,capability_type,evidence_count,complexity_tier) VALUES ('60000000-0000-0000-0000-000000000001','welding_tig',3,'intermediate');
INSERT INTO user_tools(id,user_id,category,description) VALUES ('a3000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000f','Power Tools','Lincoln MIG welder');
INSERT INTO organization_contributors(organization_id,user_id,role,status) VALUES
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000009','technician','active'),
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000d','technician','active');
INSERT INTO profiles(id, username, is_public) VALUES ('10000000-0000-0000-0000-00000000000f','fixture_tech',true)
 ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username, is_public = EXCLUDED.is_public;
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000f');
SELECT set_provider_availability('{"timezone":"America/Los_Angeles","weekly":[{"dow":0,"start":"08:00","end":"17:00"},{"dow":1,"start":"08:00","end":"17:00"},{"dow":2,"start":"08:00","end":"17:00"},{"dow":3,"start":"08:00","end":"17:00"},{"dow":4,"start":"08:00","end":"17:00"},{"dow":5,"start":"08:00","end":"17:00"},{"dow":6,"start":"08:00","end":"17:00"}]}');
SELECT set_provider_service_area('Sparks','NV',25,true);
RESET ROLE;
CREATE FUNCTION public.pm() RETURNS jsonb LANGUAGE sql AS $$ SELECT work_order_provider_matches_read('30000000-0000-0000-0000-000000000001') $$;
GRANT EXECUTE ON FUNCTION public.pm() TO anon, authenticated;

SET ROLE anon;
SELECT as_user(NULL);
SELECT t_assert(t_refused('SELECT pm()'),'anon refused');
RESET ROLE;
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000b');
SELECT t_assert(t_refused_with('SELECT pm()','Work order unavailable'),'signed-in stranger refused');
SELECT as_user('10000000-0000-0000-0000-00000000000f');
SELECT t_assert(t_refused_with('SELECT pm()','Work order unavailable'),'a listed provider cannot read the job owner''s matches');
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT pm() AS c \gset
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT pm() AS o \gset
RESET ROLE;

SELECT t_assert((:'c'::jsonb)#>'{providers,0}' @> '{"rank":1,"provider":{"handle":"fixture_tech"},"listed_because":["evidenced_link"],"link_state":"evidenced"}'
 AND ((:'c'::jsonb)#>>'{providers,0,passed}')::int > ((:'c'::jsonb)#>>'{providers,1,passed}')::int,
 'customer: the evidenced, equipped, available, nearby technician ranks first');
SELECT t_assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements((:'c'::jsonb)->'providers') p
   WHERE (p->>'passed')::int + (p->>'failed')::int + (p->>'unknown')::int <> (p->>'inputs_total')::int
     OR (p->>'inputs_total')::int <> 12
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p->'requirements') r WHERE jsonb_array_length(r->'inputs') <> 6
       OR (SELECT array_agg(i->>'input' ORDER BY ord) FROM jsonb_array_elements(r->'inputs') WITH ORDINALITY x(i, ord))
          <> ARRAY['skill','tools','facility','area','availability','evidence_rung'])),
 'every provider shows all six inputs for both requirements; the counts add up');
SELECT t_assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements((:'c'::jsonb)->'providers') a, jsonb_array_elements((:'c'::jsonb)->'providers') b
   WHERE (a->>'passed')::int > (b->>'passed')::int AND (a->>'rank')::int >= (b->>'rank')::int)
 AND (SELECT array_agg((p->>'passed')::int ORDER BY ord) FROM jsonb_array_elements((:'c'::jsonb)->'providers') WITH ORDINALITY x(p, ord))
   = (SELECT array_agg((p->>'passed')::int ORDER BY (p->>'passed')::int DESC) FROM jsonb_array_elements((:'c'::jsonb)->'providers') p),
 'ranked only by passed count (ties share a rank)');
SELECT t_assert((SELECT jsonb_agg(i ORDER BY i->>'input') FROM jsonb_array_elements((:'c'::jsonb)#>'{providers,0,requirements}') r, jsonb_array_elements(r->'inputs') i
   WHERE r->>'requirement_kind' = 'tool' AND i->>'input' IN ('tools','area','availability','evidence_rung'))
   @> '[{"input":"area","result":"pass"},{"input":"availability","result":"pass"},{"input":"evidence_rung","result":"pass"},{"input":"tools","result":"pass","matched_keys":["welding.mig"]}]'
 AND (SELECT i FROM jsonb_array_elements((:'c'::jsonb)#>'{providers,0,requirements}') r, jsonb_array_elements(r->'inputs') i
   WHERE r->>'requirement_kind' = 'skill' AND i->>'input' = 'skill') @> '{"result":"unknown","reason":"capability records do not name this requirement"}',
 'the top provider''s inputs answer from the key map and the Signs; skill stays the existing text rule (unknown here)');
SELECT t_assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements((:'c'::jsonb)->'providers') p WHERE p->'provider'->>'profile_id' = '10000000-0000-0000-0000-00000000000c')
 AND EXISTS (SELECT 1 FROM jsonb_array_elements((:'c'::jsonb)->'providers') p WHERE p->'listed_because' @> '["organization_owner"]')
 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements((:'o'::jsonb)->'providers') p WHERE p->'listed_because' @> '["organization_owner"]')
 AND (:'o'::jsonb)->'providers' @> '[{"listed_because":["organization_member"],"link_state":"none"}]',
 'neither the customer nor the reader is listed; organization members without links are listed with link_state none');
SELECT t_assert(NOT (:'c'::jsonb)::text ~ '10000000-0000-0000-0000-0000000000(09|0d|0e)'
 AND (:'c'::jsonb)->'providers' @> '[{"provider":{"label":"unnamed party"}}]'
 AND (:'c'::jsonb)#>'{providers,0,contact}' @> '{"writer":"request_contact","context_kind":"work_order"}'
 AND NOT (:'c'::jsonb)::text ~* '(latitude|longitude|email|phone)',
 'handles only: unnamed parties carry no ids; contact by broker for public handles; no coordinates or contact fields');
SELECT t_assert(NOT has_function_privilege('anon','work_order_provider_matches_read(uuid,integer)','EXECUTE')
 AND NOT has_function_privilege('authenticated','provider_requirement_match(uuid,jsonb,jsonb,uuid,jsonb,uuid,jsonb,jsonb,jsonb)','EXECUTE'),
 'reader for signed-in users only; the per-provider helper is internal');
