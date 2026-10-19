-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations (chained on the job-loop replay).
-- Provider availability and service-area Signs, their projections, open_requirements_read's availability and area inputs,
-- and provider_profile_read's summary and band.
\ir test_job_loop_replay.sql

CREATE FUNCTION public.as_user(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT set_config('test.auth_uid',COALESCE(p::text,''),false) $$;
GRANT EXECUTE ON FUNCTION public.as_user(uuid) TO anon, authenticated, service_role;
-- Live columns open_requirements_read reads that the replay fixture omits.
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS city text, ADD COLUMN IF NOT EXISTS state text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS is_public boolean, ADD COLUMN IF NOT EXISTS city text, ADD COLUMN IF NOT EXISTS state text;
UPDATE vehicles SET is_public = true, city = 'Reno', state = 'NV' WHERE id = '40000000-0000-0000-0000-000000000001';
INSERT INTO city_geocode_lookup(city,state,latitude,longitude,sample_size) VALUES ('Reno','NV',39.5296,-119.8138,673),
 ('Sparks','NV',39.5349,-119.7527,90),('Las Vegas','NV',36.1699,-115.1398,4382);
-- The job window: next week's Tuesday 16:00 UTC to Wednesday 16:00 UTC.
UPDATE work_orders SET scheduled_start = date_trunc('week', now() + interval '7 days') + interval '1 day 16 hours',
  scheduled_end = date_trunc('week', now() + interval '7 days') + interval '2 days 16 hours' WHERE id = '30000000-0000-0000-0000-000000000001';
ALTER TABLE work_order_line_items DROP CONSTRAINT work_order_line_items_task_type_check;
INSERT INTO work_order_line_items(id,work_order_id,line_number,task_type,task_description,status) VALUES
 ('51000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1,'fabricate','Headers','pending');
INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,observed_at,extraction_method,structured_data) VALUES
 ('55000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','work_record','90000000-0000-0000-0000-000000000001','2026-03-02','requirement_interpretation_v1',
  jsonb_build_object('work_order_resource',jsonb_build_object('version',1,'event_type','requirement','work_order_id','30000000-0000-0000-0000-000000000001',
   'line_item_id','51000000-0000-0000-0000-000000000001','requirement_kind','skill','description','TIG welding','quantity',NULL,'unit',NULL)));
SET ROLE service_role;
SELECT project_work_order_resource_observation('55000000-0000-0000-0000-000000000001');
RESET ROLE;
CREATE FUNCTION public.mi(p_input text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT m FROM jsonb_array_elements(open_requirements_read(NULL,100,NULL)->'rows') r, jsonb_array_elements(r->'match') m
  WHERE r->>'requirement_id' = '55000000-0000-0000-0000-000000000001' AND m->>'input' = p_input $$;
GRANT EXECUTE ON FUNCTION public.mi(text) TO anon, authenticated;
SELECT (date_trunc('week', now() + interval '7 days') + interval '1 day')::date AS tue \gset
SELECT (date_trunc('week', now() + interval '7 days') + interval '2 days')::date AS wed \gset

SET ROLE anon;
SELECT as_user(NULL);
SELECT t_assert(t_refused_with($q$SELECT set_provider_availability('{"timezone":"UTC"}')$q$,'permission denied')
 AND t_refused_with($q$SELECT set_provider_service_area('Reno','NV',25,true)$q$,'permission denied'),'anon cannot Sign');
RESET ROLE;
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000f');
SELECT t_assert(t_refused_with($q$SELECT set_provider_service_area('123 Main St','NV',25,true)$q$,'city name only')
 AND t_refused_with($q$SELECT set_provider_service_area('Reno','Nevada',25,true)$q$,'two-letter')
 AND t_refused_with($q$SELECT set_provider_service_area('Reno','NV',0,true)$q$,'1 to 500')
 AND t_refused_with($q$SELECT set_provider_availability('{"timezone":"Mars/Olympus"}')$q$,'IANA')
 AND t_refused_with($q$SELECT set_provider_availability('{"timezone":"UTC","weekly":[{"dow":1,"start":"17:00","end":"08:00"}]}')$q$,'start before end')
 AND t_refused_with($q$SELECT set_provider_availability('{"timezone":"UTC","weekly":[{"dow":7,"start":"08:00","end":"17:00"}]}')$q$,'dow 0-6')
 AND t_refused_with($q$SELECT set_provider_availability('{"timezone":"UTC","exceptions":[{"date":"2026-11-26"}]}')$q$,'available boolean'),
 'street addresses, bad states, radii, timezones, windows and exceptions are refused');
SELECT set_provider_availability(jsonb_build_object('timezone','America/Los_Angeles',
  'weekly','[{"dow":5,"start":"08:00","end":"17:00"},{"dow":1,"start":"08:00","end":"17:00"},{"dow":2,"start":"08:00","end":"17:00"},{"dow":3,"start":"08:00","end":"17:00"},{"dow":4,"start":"08:00","end":"17:00"}]'::jsonb,
  'exceptions',jsonb_build_array(jsonb_build_object('date',:'tue','available',false)))) AS av1 \gset
SELECT set_provider_availability(jsonb_build_object('timezone','America/Los_Angeles',
  'weekly','[{"dow":1,"start":"08:00","end":"17:00"},{"dow":2,"start":"08:00","end":"17:00"},{"dow":3,"start":"08:00","end":"17:00"},{"dow":4,"start":"08:00","end":"17:00"},{"dow":5,"start":"08:00","end":"17:00"}]'::jsonb,
  'exceptions',jsonb_build_array(jsonb_build_object('date',:'tue','available',false)))) AS av1dup \gset
SELECT set_provider_service_area('Sparks','nv',10,true) AS sa1 \gset
SELECT set_provider_service_area('Sparks','NV',25,true) AS sa2 \gset
SELECT mi('availability') AS f_av \gset
SELECT mi('area') AS f_area \gset
SELECT as_user('10000000-0000-0000-0000-00000000000b');
SELECT set_provider_availability('{"timezone":"America/Los_Angeles","weekly":[{"dow":0,"start":"09:00","end":"12:00"}]}');
SELECT set_provider_service_area('Las Vegas','NV',50,false);
SELECT mi('availability') AS b_av \gset
SELECT mi('area') AS b_area \gset
SELECT as_user('10000000-0000-0000-0000-00000000000d');
SELECT set_provider_service_area('Smallville','NV',30,false);
SELECT mi('availability') AS d_av \gset
SELECT mi('area') AS d_area \gset
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT mi('area') AS e_area \gset
SELECT t_refused('SELECT * FROM provider_availability') AND t_refused('SELECT * FROM provider_service_area') AS raw_closed \gset
RESET ROLE;

SELECT t_assert(NOT ((:'av1'::jsonb)->>'duplicate')::boolean AND ((:'av1dup'::jsonb)->>'duplicate')::boolean
 AND (:'av1'::jsonb)#>'{availability,weekly,0}' = '{"dow":1,"start":"08:00","end":"17:00"}'
 AND (SELECT count(*) FROM user_observations WHERE user_id = '10000000-0000-0000-0000-00000000000f' AND kind = 'availability') = 1,
 'availability Sign: normalized, one observation, identical replay is a duplicate');
SELECT t_assert((:'sa2'::jsonb)->>'supersedes_observation_id' = (:'sa1'::jsonb)->>'observation_id'
 AND (SELECT is_superseded FROM user_observations WHERE id = ((:'sa1'::jsonb)->>'observation_id')::uuid)
 AND (SELECT radius_miles = 25 AND state = 'NV' AND geocode_basis = 'city_geocode_lookup' AND observation_id = ((:'sa2'::jsonb)->>'observation_id')::uuid
      FROM provider_service_area WHERE user_id = '10000000-0000-0000-0000-00000000000f')
 AND (SELECT source = 'nuke_sign' AND kind::text = 'service_area' AND structured_data#>>'{provider_sign,claim_basis}' = 'self_claim'
      FROM user_observations WHERE id = ((:'sa2'::jsonb)->>'observation_id')::uuid),
 'service-area Sign: a changed band supersedes the previous observation; the projection follows; geocoded privately');
SELECT t_assert((:'f_av'::jsonb) @> jsonb_build_object('result','pass','basis','self_claim','first_available_day',:'wed','job_window',jsonb_build_object('basis','scheduled')),
 'availability passes on Wednesday: Tuesday is excepted, the weekly windows cover the rest of the job window');
SELECT t_assert((:'f_area'::jsonb) @> '{"result":"pass","basis":"service_area_city_distance","service_area":{"city":"Sparks","state":"NV","radius_miles":25,"mobile":true}}'
 AND NOT (:'f_area'::jsonb)::text ~* '(latitude|longitude|39\.5)','area passes within the radius; band shown, no coordinates');
SELECT t_assert((:'b_av'::jsonb) @> '{"result":"fail","reason":"no declared availability inside the job window"}'
 AND (:'b_area'::jsonb) @> '{"result":"fail","basis":"service_area_city_distance"}','Sunday-only provider and a Las Vegas band: both fail');
SELECT t_assert((:'d_av'::jsonb) @> '{"result":"unknown","reason":"no standing availability is recorded yet","next":"set_provider_availability"}'
 AND (:'d_area'::jsonb) @> '{"result":"pass","basis":"service_area_same_state_fallback"}','ungeocoded city: same-state fallback; no availability Sign: unknown');
SELECT t_assert((:'e_area'::jsonb) @> '{"result":"unknown","reason":"your public profile states no area","next":"set_provider_service_area"}'
 AND :'raw_closed'::boolean,'no Signs: previous profile answer with a next step; raw projections closed to signed-in users');
UPDATE profiles SET is_public = true, username = 'fixture_tech' WHERE id = '10000000-0000-0000-0000-00000000000f';
INSERT INTO profiles(id, username, is_public) SELECT '10000000-0000-0000-0000-00000000000f', 'fixture_tech', true
 WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE id = '10000000-0000-0000-0000-00000000000f');
SET ROLE anon;
SELECT as_user(NULL);
SELECT provider_profile_read('10000000-0000-0000-0000-00000000000f') AS pp \gset
RESET ROLE;
SELECT t_assert((:'pp'::jsonb)->'availability' @> '{"state":"declared","claim_basis":"self_claim","timezone":"America/Los_Angeles","weekly":[{"dow":1,"day":"Mon","start":"08:00"}]}'
 AND (:'pp'::jsonb)#>'{availability,exceptions_upcoming}' @> jsonb_build_array(jsonb_build_object('date',:'tue','available',false))
 AND (:'pp'::jsonb)->'service_area' @> '{"state":"declared","city":"Sparks","state_code":"NV","radius_miles":25,"mobile":true,"geocoded":true}'
 AND NOT ((:'pp'::jsonb)->'service_area')::text ~* '(latitude|longitude)',
 'provider profile (open): availability summary and service-area band, no coordinates');
SELECT t_assert(position('open_requirement_area_input' IN pg_get_functiondef('open_requirements_read(uuid,integer,text)'::regprocedure)) > 0
 AND position('open_requirement_availability_input' IN pg_get_functiondef('open_requirements_read(uuid,integer,text)'::regprocedure)) > 0
 AND NOT has_function_privilege('authenticated','open_requirement_area_input(uuid,jsonb)','EXECUTE')
 AND NOT has_function_privilege('anon','city_band_geocode(text,text)','EXECUTE'),'inputs wired; helpers internal');
