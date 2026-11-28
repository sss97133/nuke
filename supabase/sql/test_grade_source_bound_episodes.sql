-- Disposable PG17 dm_refinement_* database only. Reuse the production-shaped grader fixture and its legacy contracts.
\set ON_ERROR_STOP on
\ir test_grade_hammer_predictions_by_lot.sql
\ir ../migrations/20261128131001_grade_source_bound_episodes.sql
-- The repair is repeatable without changing the function or its access grants.
CREATE TEMP TABLE grader_after_guard AS SELECT pg_get_functiondef('public.grade_hammer_predictions_by_lot(integer,bigint)'::regprocedure) AS body;
\ir ../migrations/20261128131001_grade_source_bound_episodes.sql
SELECT pg_temp.ok('source guard is idempotent and remains service-only',
  (SELECT body = pg_get_functiondef('public.grade_hammer_predictions_by_lot(integer,bigint)'::regprocedure) FROM grader_after_guard)
  AND has_function_privilege('service_role','public.grade_hammer_predictions_by_lot(integer,bigint)','EXECUTE')
  AND NOT has_function_privilege('anon','public.grade_hammer_predictions_by_lot(integer,bigint)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.grade_hammer_predictions_by_lot(integer,bigint)','EXECUTE'));

INSERT INTO public.vehicles(id, listing_url) VALUES
 ('99999999-0000-4000-8000-000000000101','https://bringatrailer.com/listing/episode-contract-a'),
 ('99999999-0000-4000-8000-000000000102','https://bringatrailer.com/listing/episode-contract-target'),
 ('99999999-0000-4000-8000-000000000103','https://bringatrailer.com/listing/episode-contract-legacy'),
 ('99999999-0000-4000-8000-000000000104','https://bringatrailer.com/listing/episode-contract-a');
INSERT INTO public.auction_events(id,vehicle_id,source,source_url,auction_end_date,outcome,winning_bid) VALUES
 ('99999999-0000-4000-8000-000000000201','99999999-0000-4000-8000-000000000101','bat','https://bringatrailer.com/listing/episode-contract-a','2026-10-09 12:00+00','sold',40000),
 ('99999999-0000-4000-8000-000000000202','99999999-0000-4000-8000-000000000102','bat','https://bringatrailer.com/listing/episode-contract-target','2026-10-20 12:00+00','live',NULL),
 ('99999999-0000-4000-8000-000000000203','99999999-0000-4000-8000-000000000102','bat','https://bringatrailer.com/listing/episode-contract-other','2026-10-09 12:00+00','sold',50000),
 ('99999999-0000-4000-8000-000000000204','99999999-0000-4000-8000-000000000103','bat','https://bringatrailer.com/listing/episode-contract-legacy','2026-10-09 12:00+00','sold',40000);
-- A newer duplicate of the same listing must not replace the recorded canonical event.
INSERT INTO public.auction_events(id,vehicle_id,source,source_url,auction_end_date,outcome,winning_bid,updated_at) VALUES
 ('99999999-0000-4000-8000-000000000205','99999999-0000-4000-8000-000000000104','bat','https://bringatrailer.com/listing/episode-contract-a','2026-10-09 12:00+00','sold',40000,now()+interval '1 hour');
INSERT INTO public.hammer_predictions(id,vehicle_id,current_bid,hours_remaining,model_version,predicted_hammer,predicted_low,predicted_high,predicted_at,notes) VALUES
 ('99999999-0000-4000-8000-000000000301','99999999-0000-4000-8000-000000000101',30000,2,32,42000,35000,50000,'2026-10-09 10:00+00','{"source_event_id":"99999999-0000-4000-8000-000000000201","source_listing_url":"https://bringatrailer.com/listing/episode-contract-a","source_identity_basis":"retained_native_current_episode"}'),
 ('99999999-0000-4000-8000-000000000302','99999999-0000-4000-8000-000000000102',30000,2,32,42000,35000,50000,'2026-10-09 10:00+00','{"source_event_id":"99999999-0000-4000-8000-000000000202","source_listing_url":"https://bringatrailer.com/listing/episode-contract-target","source_identity_basis":"retained_native_current_episode"}'),
 ('99999999-0000-4000-8000-000000000303','99999999-0000-4000-8000-000000000101',30000,2,32,42000,35000,50000,'2026-10-09 10:00+00','{"source_event_id":"invalid","source_listing_url":"https://bringatrailer.com/listing/episode-contract-a","source_identity_basis":"retained_native_current_episode"}'),
 ('99999999-0000-4000-8000-000000000304','99999999-0000-4000-8000-000000000101',30000,2,32,42000,35000,50000,'2026-10-09 10:00+00','{"source_event_id":"invalid"'),
 ('99999999-0000-4000-8000-000000000305','99999999-0000-4000-8000-000000000103',30000,2,32,42000,35000,50000,'2026-10-09 10:00+00','{"grade":"A"}'),
 ('99999999-0000-4000-8000-000000000306','99999999-0000-4000-8000-000000000101',30000,2,32,42000,35000,50000,'2026-10-09 10:00+00','{"source_event_id":"99999999-0000-4000-8000-000000000201","source_listing_url":"https://bringatrailer.com/listing/episode-contract-other","source_identity_basis":"retained_native_current_episode"}'),
 ('99999999-0000-4000-8000-000000000307','99999999-0000-4000-8000-000000000101',30000,2,32,42000,35000,50000,'2026-10-09 10:00+00','{"source_event_id":"99999999-0000-4000-8000-000000000201","source_listing_url":"https://bringatrailer.com/listing/episode-contract-a"}'),
 ('99999999-0000-4000-8000-000000000308','99999999-0000-4000-8000-000000000101',30000,2,32,42000,35000,50000,'2026-10-09 10:00+00','{"grade":"A"}');
SELECT public.grade_hammer_predictions_by_lot(100000,0)->>'written' AS written;
SELECT pg_temp.ok('matching receipt selects its event before a newer duplicate',
 (SELECT auction_event_id='99999999-0000-4000-8000-000000000201' AND lot_outcome='sold' FROM public.hammer_predictions WHERE id='99999999-0000-4000-8000-000000000301'));
SELECT pg_temp.ok('another event cannot grade a source-bound prediction',
 (SELECT auction_event_id IS NULL AND actual_hammer IS NULL AND scored_at IS NULL FROM public.hammer_predictions WHERE id='99999999-0000-4000-8000-000000000302'));
SELECT pg_temp.ok('invalid, malformed, wrong-URL and partial source receipts are held',
 (SELECT count(*)=4 AND bool_and(auction_event_id IS NULL AND actual_hammer IS NULL AND scored_at IS NULL)
  FROM public.hammer_predictions WHERE id IN ('99999999-0000-4000-8000-000000000303','99999999-0000-4000-8000-000000000304',
                                             '99999999-0000-4000-8000-000000000306','99999999-0000-4000-8000-000000000307')));
SELECT pg_temp.ok('legacy prediction without a source receipt still grades',
 (SELECT auction_event_id='99999999-0000-4000-8000-000000000204' AND lot_outcome='sold' FROM public.hammer_predictions WHERE id='99999999-0000-4000-8000-000000000305'));
SELECT pg_temp.ok('legacy duplicate selection remains unchanged',
 (SELECT auction_event_id='99999999-0000-4000-8000-000000000205' AND lot_outcome='sold' FROM public.hammer_predictions WHERE id='99999999-0000-4000-8000-000000000308'));
UPDATE public.auction_events SET auction_end_date='2026-10-09 12:00+00', outcome='sold', winning_bid=45000
 WHERE id='99999999-0000-4000-8000-000000000202';
SELECT public.grade_hammer_predictions_by_lot(100000,0)->>'written' AS written;
SELECT pg_temp.ok('held prediction grades to its recorded event when that event closes',
 (SELECT auction_event_id='99999999-0000-4000-8000-000000000202' AND actual_hammer=45000 AND lot_outcome='sold'
  FROM public.hammer_predictions WHERE id='99999999-0000-4000-8000-000000000302'));
