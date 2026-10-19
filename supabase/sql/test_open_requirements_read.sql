-- Disposable PG17 only. Proves 20261019161500_open_requirements_read.sql: open requirements are those of the current
-- resource graph on unconcluded, public-vehicle work orders; anon sees open job fields (title fallback, vehicle label,
-- city/state band, specs, window, quote state) without match, PII or money; a signed-in viewer gets an explainable
-- per-input match with plan_b_supplier_needed for missing resources and no score.
-- Fixture and prior state: the provider job-record contract chain.
\set ON_ERROR_STOP on
\ir test_provider_job_record_read.sql

ALTER TABLE public.vehicles ADD COLUMN city text, ADD COLUMN state text;
ALTER TABLE public.user_tools ADD COLUMN description text;
UPDATE public.vehicles SET city='Boise', state='ID' WHERE id='40000000-0000-0000-0000-000000000003';
UPDATE public.vehicles SET city='Hidden', state='ZZ' WHERE id='40000000-0000-0000-0000-000000000005';
UPDATE public.work_orders SET organization_id='0a000000-0000-0000-0000-000000000001' WHERE id='30000000-0000-0000-0000-00000000000d';
UPDATE public.user_tools SET description='torque wrench' WHERE id='70000000-0000-0000-0000-000000000006';
INSERT INTO public.work_order_line_items(id,work_order_id,status) VALUES
 ('50000000-0000-0000-0000-0000000000d1','30000000-0000-0000-0000-00000000000d','pending'),
 ('50000000-0000-0000-0000-0000000000e1','30000000-0000-0000-0000-00000000000e','pending');
INSERT INTO public.vehicle_observations(id,vehicle_id,kind,source_id,observed_at,structured_data) VALUES
 ('81000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000003','work_record','90000000-0000-0000-0000-000000000001','2026-01-10',
  '{"work_order_resource":{"version":1,"event_type":"requirement","work_order_id":"30000000-0000-0000-0000-00000000000d","line_item_id":"50000000-0000-0000-0000-0000000000d1","requirement_kind":"tool","description":"TIG welder and torque wrench for header flanges","quantity":1,"unit":"set"}}'),
 ('81000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000003','work_record','90000000-0000-0000-0000-000000000001','2026-01-10',
  '{"work_order_resource":{"version":1,"event_type":"requirement","work_order_id":"30000000-0000-0000-0000-00000000000d","line_item_id":"50000000-0000-0000-0000-0000000000d1","requirement_kind":"skill","description":"Exhaust fabrication and stainless welding","quantity":null,"unit":null}}'),
 ('81000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000003','work_record','90000000-0000-0000-0000-000000000001','2026-01-10',
  '{"work_order_resource":{"version":1,"event_type":"requirement","work_order_id":"30000000-0000-0000-0000-00000000000d","line_item_id":"50000000-0000-0000-0000-0000000000d1","requirement_kind":"facility","description":"Two-post lift bay","quantity":1,"unit":"bay"}}'),
 ('81000000-0000-0000-0000-000000000004','40000000-0000-0000-0000-000000000005','work_record','90000000-0000-0000-0000-000000000001','2026-01-10',
  '{"work_order_resource":{"version":1,"event_type":"requirement","work_order_id":"30000000-0000-0000-0000-00000000000e","line_item_id":"50000000-0000-0000-0000-0000000000e1","requirement_kind":"tool","description":"Private bronco tool","quantity":1,"unit":"each"}}');
SET ROLE service_role;
SELECT project_work_order_resource_observation(id) FROM unnest(ARRAY['81000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000002',
  '81000000-0000-0000-0000-000000000003','81000000-0000-0000-0000-000000000004']::uuid[]) id;
RESET ROLE;

\ir ../migrations/20261019161500_open_requirements_read.sql

CREATE FUNCTION public.t_req_pii(j jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT j::text ~ '(Other Customer|Fixture Customer|example\.com|5550|Private bronco|Hidden|"ZZ"|basis_excerpt|road test|"amount"|"score")' $$;
GRANT EXECUTE ON FUNCTION public.t_req_pii(jsonb) TO anon, authenticated;

SELECT t_assert(has_function_privilege('anon','public.open_requirements_read(uuid,integer,text)','EXECUTE')
  AND has_function_privilege('authenticated','public.open_requirements_read(uuid,integer,text)','EXECUTE')
  AND (SELECT prosecdef AND 'search_path=pg_catalog, public' = ANY (proconfig) FROM pg_proc WHERE proname='open_requirements_read'),
  'open_requirements_read: definer, pinned search_path, anon and authenticated');

-- 1. A visitor sees open requirements without a match.
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
CREATE TEMP TABLE ra AS SELECT open_requirements_read() j;
SELECT t_assert((SELECT j @> '{"viewer":{"context":"visitor"},"coverage":{"returned":3,"total_open":3,"population":{"requirements_total":5,"open_work_orders_with_requirements":1,"open_requirements":3}},
  "rows":[{"requirement_id":"81000000-0000-0000-0000-000000000001","requirement_kind":"tool","description":"TIG welder and torque wrench for header flanges","quantity":1,"unit":"set",
    "work_order_id":"30000000-0000-0000-0000-00000000000d","work_order_status":"quoted","display_title":"Full restoration","vehicle_label":{"text":"1999 Jeep Cherokee"},
    "area_band":{"city":"Boise","state":"ID","basis":"public vehicle city/state"},"candidates_listed":0,"candidate_acceptance":"not_recorded",
    "quote_state":{"has_current_quote":false,"acceptance":"not_accepted"},"match":null}]}' FROM ra), 'visitor: open requirements on the open public-vehicle job, title fallback, city/state band, no match');
SELECT t_assert((SELECT NOT t_req_pii(j) AND j::text !~ '30000000-0000-0000-0000-00000000000(a|c|e)' FROM ra), 'visitor: no PII; concluded and private-vehicle jobs absent');
SELECT t_assert((SELECT j @> '{"rows":[{"requirement_kind":"skill"}],"coverage":{"total_open":1,"kind_filter":"skill"}}' FROM (SELECT open_requirements_read(NULL, 25, 'skill') j) x), 'kind filter');
SELECT t_assert((SELECT jsonb_array_length(j->'rows') = 1 AND j->>'next_after' = '81000000-0000-0000-0000-000000000001' FROM (SELECT open_requirements_read(NULL, 1) j) x), 'paginates');
SELECT t_assert(t_refused($q$SELECT open_requirements_read(NULL, 25, 'transport')$q$), 'unknown kind refused');
RESET ROLE;

-- 2. An evidenced provider gets an explainable match.
SET ROLE authenticated;
SELECT t_as('00000000-0000-0000-0000-000000000006');
CREATE TEMP TABLE r6 AS SELECT open_requirements_read() j;
SELECT t_assert((SELECT j->'rows'->0->'match' @> '[{"input":"skill","result":"pass"},{"input":"tools","result":"pass"},{"input":"facility","result":"pass"},
  {"input":"area","result":"pass","reason":"same state and city"},{"input":"availability","result":"unknown"},{"input":"evidence_rung","result":"pass"}]'
  AND j->'rows'->0->'match'->1->>'reason' ~ 'torque wrench' FROM r6), 'provider, tool requirement: claimed tool named, area, rung');
SELECT t_assert((SELECT j->'rows'->1->'match'->0 @> '{"input":"skill","result":"pass"}' AND j->'rows'->1->'match'->0->>'reason' ~ 'fabrication' FROM r6),
  'provider, skill requirement: evidence-derived capability named in the requirement');
SELECT t_assert((SELECT j->'rows'->2->'match'->2 @> '{"input":"facility","result":"pass"}' FROM r6), 'provider, facility requirement: member of the job''s shop');
SELECT t_assert((SELECT bool_and(jsonb_array_length(r->'match') = 6) AND j::text !~ '"score"' FROM r6, jsonb_array_elements(j->'rows') r GROUP BY j), 'six inputs per row, no score');
SELECT t_as('00000000-0000-0000-0000-000000000003');
CREATE TEMP TABLE r3 AS SELECT open_requirements_read() j;
SELECT t_assert((SELECT j->'rows'->0->'match' @> '[{"input":"skill","result":"pass"},{"input":"tools","result":"fail","next":"plan_b_supplier_needed","reason":"no claimed tool records"},
  {"input":"area","result":"unknown"},{"input":"evidence_rung","result":"fail","next":"claim_provider_link"}]' FROM r3), 'newcomer, tool requirement: missing tool is plan B, not disqualification');
SELECT t_assert((SELECT j->'rows'->1->'match'->0 @> '{"input":"skill","result":"unknown","reason":"no evidenced identity bridge; capability records belong to work actors"}'
  AND j->'rows'->2->'match'->2 @> '{"input":"facility","result":"fail","next":"plan_b_supplier_needed"}' FROM r3), 'newcomer: skill unknown without a bridge; facility plan B');
SELECT t_assert((SELECT jsonb_array_length(j->'rows') = 3 AND NOT t_req_pii(j) FROM r3), 'newcomer still sees every open requirement; no PII');
RESET ROLE;
