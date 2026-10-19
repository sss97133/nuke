-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations.
-- provider_profile_read capabilities: evidence-derived rows with strength and basis counts, legacy rows labelled; a user
-- sees an actor's capabilities only through an evidenced link. Chained on the capability fold contract (actor A 60..01
-- has derived rows and a legacy welding_mig row; P's link was rejected at its end).
\ir test_capability_fold.sql

-- L (..08) earns an evidenced link to actor A; P2 (..09) keeps a pending self-claim.
INSERT INTO work_sessions(id,user_id,vehicle_id,session_date,duration_minutes,image_count) VALUES
 ('54000000-0000-0000-0000-000000000008','10000000-0000-0000-0000-000000000008','40000000-0000-0000-0000-000000000001','2026-03-15',120,4);
INSERT INTO account_link_claims(user_id,platform,handle,actor_id,status,verification_method) VALUES
 ('10000000-0000-0000-0000-000000000008','nuke_actor','60000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','pending','self_claim');
UPDATE account_link_claims SET status='approved', verification_method='work_evidence', reviewed_by_user_id='10000000-0000-0000-0000-00000000000a',
  reviewed_at='2026-03-19', rung_evidence = rung_evidence || jsonb_build_array(jsonb_build_object('rung','work_evidence',
    'evidence',jsonb_build_array(jsonb_build_object('kind','work_session','id','54000000-0000-0000-0000-000000000008')),
    'reviewer_user_id','10000000-0000-0000-0000-00000000000a','reviewed_at','2026-03-19T00:00:00+00:00'))
 WHERE user_id='10000000-0000-0000-0000-000000000008' AND actor_id='60000000-0000-0000-0000-000000000001';
UPDATE profiles SET is_public = true WHERE id IN ('10000000-0000-0000-0000-000000000008','10000000-0000-0000-0000-000000000009');
INSERT INTO profiles(id,username,is_public) VALUES ('10000000-0000-0000-0000-000000000008','lead_hand',true),('10000000-0000-0000-0000-000000000009','quiet_one',true)
 ON CONFLICT (id) DO UPDATE SET is_public = true;

SET ROLE anon;
SELECT as_user(NULL);
SELECT provider_profile_read(NULL,'60000000-0000-0000-0000-000000000001')->'capabilities' AS ca \gset
SELECT provider_profile_read('10000000-0000-0000-0000-000000000008',NULL)->'capabilities' AS cl \gset
SELECT provider_profile_read('10000000-0000-0000-0000-000000000009',NULL)->'capabilities' AS cp2 \gset
SELECT provider_profile_read(NULL,'60000000-0000-0000-0000-000000000001')->'coverage'->'capabilities' AS cov \gset
RESET ROLE;
SELECT t_assert((:'ca'::jsonb)->'items'->0 @> '{"derivation":"evidence_fold"}'
 AND (:'ca'::jsonb)->'items' @> '[{"capability_type":"fabrication_exhaust","derivation":"evidence_fold","strength":"corroborating","evidence_count":2,"basis_counts":{"direct":0,"corroborating":2,"against":0},"basis_ids_recorded":2},
   {"capability_type":"welding_tig","derivation":"evidence_fold","basis_counts":{"against":1}},
   {"capability_type":"welding_mig","derivation":"legacy_hand_entered","strength":"not_assessed","basis_ids_recorded":0,"basis_counts":null}]'
 AND (SELECT max(o) FROM jsonb_array_elements((:'ca'::jsonb)->'items') WITH ORDINALITY x(e, o) WHERE e->>'derivation'='evidence_fold')
   < (SELECT min(o) FROM jsonb_array_elements((:'ca'::jsonb)->'items') WITH ORDINALITY x(e, o) WHERE e->>'derivation'='legacy_hand_entered'),
 'actor profile: derived rows first with strength and basis counts; the legacy row labelled, basis not recorded');
SELECT t_assert((:'cl'::jsonb)->'items' @> '[{"capability_type":"fabrication_exhaust","derivation":"evidence_fold"}]'
 AND jsonb_array_length((:'cp2'::jsonb)->'items') = 0,'a user sees the actor''s skills only through an evidenced link; a pending self-claim shows none');
SELECT t_assert((:'cov'::jsonb) @> '{"derived":{"never_counted":["self-claims","profile expertise","vouches","co-signs","offers"]}}' AND ((:'cov'::jsonb)#>>'{derived,rows}')::int >= 3
 AND NOT (:'ca'::jsonb)::text ~ '(53000000-|52000000-|30000000-0000-0000-0000-000000000001)','coverage names what never counts; basis ids are not exposed');
SELECT t_assert((SELECT count(*) FROM regexp_matches(pg_get_functiondef('provider_profile_read(uuid,uuid)'::regprocedure),'provider_capability_items','g'))=1
 AND NOT has_function_privilege('anon','provider_capability_items(uuid[])','EXECUTE'),'reader carries one call; helper internal');
