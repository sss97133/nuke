-- Disposable PG17 only. Proves 20261019190000_actor_link_claim_evidence.sql: candidate evidence for an actor claim is
-- found only by joining the claimant's own records to the actor's attributed work (a name-identical actor with no work
-- yields nothing); claimants cannot read others' claims; admins get the review queue; the found work session is
-- accepted by approve_actor_link_claim with a distinct admin. Fixture and prior state: the open-requirements chain.
\set ON_ERROR_STOP on
\ir test_open_requirements_read.sql

ALTER TABLE public.component_events ADD COLUMN actor_id uuid, ADD COLUMN event_date date, ADD COLUMN org_id uuid, ADD COLUMN evidence_ids uuid[];
ALTER TABLE public.organizations ADD COLUMN is_verified boolean;
ALTER TABLE public.work_order_line_items ADD COLUMN IF NOT EXISTS source_observation_id uuid;
UPDATE public.organizations SET is_verified = true WHERE id = '0a000000-0000-0000-0000-000000000001';
UPDATE public.profiles SET full_name = 'Fixture One' WHERE id = '00000000-0000-0000-0000-000000000001';
INSERT INTO public.actors(id, name, actor_type) VALUES ('a0000000-0000-0000-0000-0000000000f3', 'Claimed Mechanic', 'mechanic'),
  ('a0000000-0000-0000-0000-0000000000f4', 'Fixture One', 'mechanic');
INSERT INTO public.vehicle_observations(id, vehicle_id, kind, source_id, observed_at, submitted_by_user_id, structured_data) VALUES
 ('82000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000003','work_record','90000000-0000-0000-0000-000000000001','2026-02-01',
  '00000000-0000-0000-0000-000000000001','{"note":"header weld photos"}'),
 ('82000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000003','condition','90000000-0000-0000-0000-000000000001','2026-02-01',
  NULL,'{"analysis_kind":"image_deep_byok","image_id":"b1000000-0000-0000-0000-000000000001","workshop_signals":{"tools_visible":["tig welder"]}}'),
 ('82000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000003','work_record','90000000-0000-0000-0000-000000000001','2026-02-01',
  '00000000-0000-0000-0000-000000000003','{"note":"someone else"}');
INSERT INTO public.component_events(id, vehicle_id, work_order_id, metadata, actor_id, event_date, org_id, evidence_ids) VALUES
 ('c0000000-0000-0000-0000-0000000000f3','40000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-00000000000d','{}',
  'a0000000-0000-0000-0000-0000000000f3','2026-02-01','0a000000-0000-0000-0000-000000000001',
  ARRAY['82000000-0000-0000-0000-000000000001','82000000-0000-0000-0000-000000000003']::uuid[]);
INSERT INTO public.work_order_line_items(id, work_order_id, status, actor_id) VALUES
 ('50000000-0000-0000-0000-0000000000f3','30000000-0000-0000-0000-00000000000d','complete','a0000000-0000-0000-0000-0000000000f3');
INSERT INTO public.work_sessions(id, user_id, vehicle_id, session_date, duration_minutes) VALUES
 ('61000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000003','2026-02-01',120),
 ('61000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000003','2026-01-20',60),
 ('61000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000003','2026-02-01',60);
INSERT INTO public.vehicle_images(id, vehicle_id, taken_at, is_external, user_id, vision_gate_status) VALUES
 ('b1000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000003','2026-02-01 10:00',false,'00000000-0000-0000-0000-000000000001','approved');

SET ROLE authenticated;
SELECT t_as('00000000-0000-0000-0000-000000000001');
INSERT INTO account_link_claims(id,user_id,platform,handle,actor_id,verification_method) VALUES
 ('c1000000-0000-0000-0000-0000000000f3','00000000-0000-0000-0000-000000000001','nuke_actor','a0000000-0000-0000-0000-0000000000f3','a0000000-0000-0000-0000-0000000000f3','self_claim'),
 ('c1000000-0000-0000-0000-0000000000f4','00000000-0000-0000-0000-000000000001','nuke_actor','a0000000-0000-0000-0000-0000000000f4','a0000000-0000-0000-0000-0000000000f4','self_claim');
RESET ROLE;

\ir ../migrations/20261019190000_actor_link_claim_evidence.sql

SELECT t_assert(NOT has_function_privilege('anon','public.actor_link_claim_evidence_read(uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.actor_link_claims_review_queue()','EXECUTE')
  AND (SELECT bool_and(prosecdef AND provolatile = 's') FROM pg_proc WHERE proname IN ('actor_link_claim_evidence_read','actor_link_claims_review_queue')),
  'definer, read-only, not executable by anon');
SELECT t_assert((SELECT bool_and(prosrc !~* '(full_name|profiles|\.phone|\.email|\.name\s*=|=\s*[a-z_]+\.name\M|\.username)') FROM pg_proc WHERE proname = 'actor_link_claim_evidence_read'),
  'evidence finder compares no names, phones or e-mails');

-- 1. The claimant sees candidate evidence found by join.
SET ROLE authenticated;
SELECT t_as('00000000-0000-0000-0000-000000000001');
CREATE TEMP TABLE ev AS SELECT actor_link_claim_evidence_read('c1000000-0000-0000-0000-0000000000f3') j;
SELECT t_assert((SELECT j @> '{"viewer":{"role":"claimant"},"claim":{"rung":"self_claim","status":"pending","actor":{"label":"unnamed party","role":"mechanic"}},
  "counts":{"direct":2,"by_kind":{"observation":2,"org_membership":1}},"approval":{"auto_approved":false}}'
  AND (j#>>'{counts,by_kind,work_session}')::int >= 2 AND (j#>>'{counts,total}')::int = (j#>>'{counts,direct}')::int + (j#>>'{counts,corroborating}')::int FROM ev),
  'claimant: two sessions, submitted observation, photo analysis, verified-org co-membership');
SELECT t_assert((SELECT j->'items' @> '[{"kind":"work_session","row_id":"61000000-0000-0000-0000-000000000001","strength":"direct","date":"2026-02-01","vehicle_label":"1999 Jeep Cherokee","approvable_for":["work_evidence"]},
  {"kind":"observation","row_id":"82000000-0000-0000-0000-000000000001","strength":"direct","approvable_for":["authenticated_sign"]},
  {"kind":"work_session","row_id":"61000000-0000-0000-0000-000000000002","strength":"corroborating"},
  {"kind":"observation","row_id":"82000000-0000-0000-0000-000000000002","strength":"corroborating","approvable_for":[]},
  {"kind":"org_membership","row_id":"0a000000-0000-0000-0000-000000000001","strength":"corroborating"}]' FROM ev), 'items carry kind, row, vehicle, date, strength and the rung they support');
SELECT t_assert((SELECT j::text !~ '(61000000-0000-0000-0000-000000000003|82000000-0000-0000-0000-000000000003|Claimed Mechanic)' FROM ev),
  'another person''s session and observation are not evidence; the actor name is not shown');
SELECT t_assert((SELECT j @> '{"items":[],"counts":{"total":0}}' FROM (SELECT actor_link_claim_evidence_read('c1000000-0000-0000-0000-0000000000f4') j) x),
  'an actor with the claimant''s exact name but no attributed work yields nothing');
SELECT t_assert(t_refused($q$SELECT actor_link_claims_review_queue()$q$), 'a non-admin cannot read the review queue');
SELECT t_assert(t_refused($q$SELECT actor_link_claim_evidence_read((SELECT id FROM account_link_claims WHERE actor_id = 'a0000000-0000-0000-0000-0000000000f1'))$q$),
  'a claimant cannot read someone else''s claim');
SELECT t_as('00000000-0000-0000-0000-000000000003');
SELECT t_assert(t_refused($q$SELECT actor_link_claim_evidence_read('c1000000-0000-0000-0000-0000000000f3')$q$), 'a stranger cannot read the claim');

-- 2. An admin reviews; approval stays with the service writer and a distinct admin.
SELECT t_as('00000000-0000-0000-0000-000000000005');
CREATE TEMP TABLE rq AS SELECT actor_link_claims_review_queue() j;
SELECT t_assert((SELECT j @> '{"coverage":{"pending_actor_claims":2},"pending":[{"claim_id":"c1000000-0000-0000-0000-0000000000f3","evidence_counts":{"direct":2}},
  {"claim_id":"c1000000-0000-0000-0000-0000000000f4","evidence_counts":{"total":0}}]}' FROM rq), 'admin queue: pending claims with evidence counts');
SELECT t_assert((SELECT j::text !~ '(Claimed Mechanic|Fixture One)' FROM rq), 'queue shows no actor or legal names');
SELECT t_assert((SELECT actor_link_claim_evidence_read('c1000000-0000-0000-0000-0000000000f3') @> '{"viewer":{"role":"admin"},"counts":{"direct":2}}'), 'admin reads a claim''s evidence');
RESET ROLE;
SET ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SELECT t_assert((SELECT actor_link_claim_evidence_read('c1000000-0000-0000-0000-0000000000f3') @> '{"viewer":{"role":"service"}}'), 'service reads evidence');
SELECT approve_actor_link_claim('c1000000-0000-0000-0000-0000000000f3', 'work_evidence',
  '[{"kind":"work_session","id":"61000000-0000-0000-0000-000000000001"}]', '00000000-0000-0000-0000-000000000005');
SELECT t_assert((SELECT status = 'approved' AND verification_method = 'work_evidence' FROM account_link_claims WHERE id = 'c1000000-0000-0000-0000-0000000000f3'),
  'the found work session is accepted by approve_actor_link_claim with a distinct admin');
SELECT t_assert((SELECT j @> '{"coverage":{"pending_actor_claims":1}}' FROM (SELECT actor_link_claims_review_queue() j) x), 'approved claims leave the queue');
RESET ROLE;
