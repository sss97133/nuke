-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations.
-- provider_productivity_read: per-day signed rungs, labelled capture span, operations, specs, photos, accepted
-- completions; accepted day-rate terms vs signed days; public-only for others; no money beyond open rates.
\ir test_provider_profile_derived_capabilities.sql

-- P (..0f): March work days on WO1's vehicle (one confirmed) and one on the private vehicle 3; photos.
UPDATE work_sessions SET owner_confirmed_at='2026-03-15 20:00+00' WHERE id='54000000-0000-0000-0000-000000000001';
INSERT INTO work_sessions(id,user_id,vehicle_id,session_date,duration_minutes,image_count,owner_confirmed_at) VALUES
 ('54000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-00000000000f','40000000-0000-0000-0000-000000000003','2026-03-17',90,2,'2026-03-17 20:00+00');
INSERT INTO vehicle_images(vehicle_id,user_id,taken_at) VALUES
 ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000f','2026-03-15 10:00+00'),
 ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000f','2026-03-15 11:00+00'),
 ('40000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-00000000000f','2026-03-17 10:00+00');
CREATE FUNCTION public.prod(p_user uuid, p_actor uuid, p_from date, p_to date) RETURNS jsonb LANGUAGE sql AS $$ SELECT provider_productivity_read(p_user,p_actor,p_from,p_to) $$;
GRANT EXECUTE ON FUNCTION public.prod(uuid,uuid,date,date) TO anon, authenticated;

SET ROLE anon;
SELECT as_user(NULL);
SELECT prod(NULL,'60000000-0000-0000-0000-000000000001','2026-03-01','2026-03-31') AS pa \gset
SELECT prod('10000000-0000-0000-0000-00000000000f',NULL,'2026-03-01',current_date) AS pu_anon \gset
SELECT t_assert(t_refused_with($q$SELECT prod(NULL,NULL,NULL,NULL)$q$,'Name one subject') AND t_refused_with($q$SELECT prod(NULL,'60000000-0000-0000-0000-000000000001','2020-01-01','2026-01-01')$q$,'366 days'),
 'one subject and a bounded range required');
RESET ROLE;
SELECT t_assert((:'pa'::jsonb)->'days' @> '[{"day":"2026-03-15","operations_completed":1,"specs_reported_performed":2,"image_evidence":null},{"day":"2026-03-16","operations_completed":1,"specs_reported_performed":1}]'
 AND (:'pa'::jsonb)->'subject' @> '{"actor_id":"60000000-0000-0000-0000-000000000001"}','actor subject: operations and performed specs per day from attributed records; no photos without a user');
SELECT t_assert((:'pu_anon'::jsonb)->'days' @> '[{"day":"2026-03-15","signed":{"self_confirmed":true,"customer_accepted":true},"capture_span_minutes":240,"image_evidence":2}]'
 AND NOT (:'pu_anon'::jsonb)->'days' @> '[{"day":"2026-03-17"}]'
 AND (SELECT count(*) FROM jsonb_array_elements((:'pu_anon'::jsonb)->'days') x WHERE (x->>'completions_accepted')::int > 0) = 1
 AND (:'pu_anon'::jsonb)#>>'{basis,capture_span_minutes}' ~ 'not labor time'
 AND (:'pu_anon'::jsonb)#>'{basis,not_adopted}' @> '["equipment_usage_evidence minutes","technician_work_evidence durations"]'
 AND NOT (:'pu_anon'::jsonb)::text ~ '(40000000-0000-0000-0000-00000000000[13])',
 'anon: public-vehicle days only, rungs separate, capture span labelled, accepted completion counted, inferred minutes not adopted, no vehicle ids');
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000f');
SELECT prod('10000000-0000-0000-0000-00000000000f',NULL,'2026-03-01','2026-03-31') AS pu_self \gset
RESET ROLE;
SELECT t_assert((:'pu_self'::jsonb)->'days' @> '[{"day":"2026-03-17","signed":{"self_confirmed":true,"customer_accepted":false},"capture_span_minutes":90,"image_evidence":1}]'
 AND (:'pu_self'::jsonb)->'viewer' @> '{"self":true}','self sees own private-vehicle day; a day outside an accepted job is self-confirmed only');

-- Day rate: L (..08, evidenced link to actor A) offers 3 days at 200 USD/day on a skill requirement; the customer accepts.
INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,observed_at,extraction_method,structured_data) VALUES
 ('55000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','work_record','90000000-0000-0000-0000-000000000001','2026-03-02','requirement_interpretation_v1',
  jsonb_build_object('work_order_resource',jsonb_build_object('version',1,'event_type','requirement','work_order_id','30000000-0000-0000-0000-000000000001',
   'line_item_id','51000000-0000-0000-0000-000000000001','requirement_kind','skill','description','TIG fabrication','quantity',NULL,'unit',NULL)));
SET ROLE service_role;
SELECT project_work_order_resource_observation('55000000-0000-0000-0000-000000000001');
RESET ROLE;
INSERT INTO work_sessions(id,user_id,vehicle_id,session_date,duration_minutes,image_count,owner_confirmed_at) VALUES
 ('54000000-0000-0000-0000-000000000009','10000000-0000-0000-0000-000000000008','40000000-0000-0000-0000-000000000001',current_date,300,8,now());
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-000000000008');
SELECT offer_on_requirement('55000000-0000-0000-0000-000000000001',
  '{"lines":[{"description":"Day rate, TIG fabrication","pricing_basis":"day_rate","amount":200,"currency":"USD","unit":"day","quantity":3}]}',NULL,NULL,NULL) AS od \gset
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT (SELECT a->'args' FROM jsonb_array_elements(work_order_offers_read('30000000-0000-0000-0000-000000000001')#>'{viewer,actions}') a
  WHERE a->>'action'='accept_offer' AND a#>>'{args,p_offer_id}' = (:'od'::jsonb)->>'offer_id') AS acc \gset
SELECT accept_offer(((:'acc'::jsonb)->>'p_offer_id')::uuid,(:'acc'::jsonb)->>'p_offer_hash');
RESET ROLE;
SET ROLE anon;
SELECT as_user(NULL);
SELECT prod('10000000-0000-0000-0000-000000000008',NULL,current_date - 30,current_date) AS pl \gset
RESET ROLE;
SELECT t_assert((:'pl'::jsonb)->'day_rate_jobs' @> jsonb_build_array(jsonb_build_object('work_order_id','30000000-0000-0000-0000-000000000001','days_agreed',3,
   'day_rate_terms',jsonb_build_array(jsonb_build_object('source','accepted_offer','rate',200,'currency','USD','quantity_days',3)),
   'signed_days',jsonb_build_object('self_confirmed',1,'customer_accepted',0))),
 'day-rate job: accepted day-rate terms (rate open) against days signed in the job window, by rung');
SELECT t_assert(NOT (:'pl'::jsonb)::text ~ '("total"|"payout|"payments?"|"paid|amount_paid|balance)' AND (:'pl'::jsonb)->>'payment_authorized'='false',
 'no totals, payouts or payments');
SELECT t_assert(has_function_privilege('anon','provider_productivity_read(uuid,uuid,date,date)','EXECUTE')
 AND NOT has_function_privilege('service_role','provider_productivity_read(uuid,uuid,date,date)','EXECUTE'),'reader open');
