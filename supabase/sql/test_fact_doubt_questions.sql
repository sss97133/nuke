-- Contract for 20261120070000_fact_doubt_questions (empty disposable database; dependencies stubbed here, the earlier
-- question-store migrations and this one applied with \ir). Asserts: the second question kind passes the gate (raise,
-- claim, answer) and the first kind still does; a doubt about an unregistered or deprecated key is refused; the closed
-- answer shape (value needs a witness and a listed value, witnesses must be cited, different_measures only for a reader
-- pair); the trigger key is stable until the keyed evidence changes and then the doubt is no longer eligible; a second
-- reading is kept beside the first and agreement is counted by independent readers; vehicle_open_questions returns
-- asked / answered / open, counts, retired apart, no amount, vendor or account id, a frame only when a visitor may see it,
-- and null for a vehicle the caller may not see; anon can execute the reader and nothing else; a doubt claimed six times
-- is no longer offered or accepted (20261122201000).
DO $$ BEGIN
  IF to_regclass('public.vehicles') IS NOT NULL THEN RAISE EXCEPTION 'Requires an empty disposable database'; END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.role', true), '') $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, user_id uuid, owner_id uuid, uploaded_by uuid, is_public boolean, deleted_at timestamptz);
CREATE FUNCTION public.vehicle_user_has_access(p_vehicle uuid, p_user uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.text_redact_contact(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT p $$;
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY, vehicle_id uuid, taken_at timestamptz, is_duplicate boolean, is_superseded boolean,
  is_sensitive boolean, vision_gate_status text, vehicle_zone text, apple_ml_labels text[], ai_scan_metadata jsonb, work_session_id uuid, is_document boolean,
  redaction_level text DEFAULT 'none');
CREATE FUNCTION public.vehicle_image_gallery_eligible(i public.vehicle_images) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT i.vision_gate_status = 'approved' $$;
CREATE TABLE public.work_sessions(id uuid PRIMARY KEY, vehicle_id uuid, session_date date);
CREATE TABLE public.timeline_events(id uuid PRIMARY KEY, vehicle_id uuid, event_date date);
CREATE TABLE public.receipts(id uuid PRIMARY KEY, user_id uuid, vendor_name text, document_kind text, receipt_date date,
  is_superseded boolean, duplicate_of uuid, source_document_table text, source_document_id uuid);
CREATE TABLE public.receipt_items(id uuid PRIMARY KEY, receipt_id uuid, line_number int, description text, part_number text,
  total_price numeric, line_date date, hours numeric, performer text);
CREATE TABLE public.receipt_vehicle_links(id uuid PRIMARY KEY, receipt_id uuid, vehicle_id uuid, user_id uuid, status text, basis text,
  confidence numeric, page_date date, page_date_source text, retired_at timestamptz);
CREATE TABLE public.garage_derivation_evidence(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL,
  vehicle_id uuid, user_id uuid, subject_key text, conclusion text, evidence jsonb, superseded_at timestamptz,
  CONSTRAINT garage_derivation_evidence_kind_check CHECK (kind IN ('scene_label')));
CREATE TABLE public.observation_properties(id uuid PRIMARY KEY, property_key text, label text, ratified_at timestamptz, deprecated_at timestamptz);
CREATE TABLE public.vehicle_observations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, property_id uuid,
  structured_data jsonb, is_superseded boolean);
\ir ../migrations/20261111210500_receipt_work_reconciliation.sql
\ir ../migrations/20261114120002_evidence_judgment_candidate_set_equality.sql
\ir ../migrations/20261120070000_fact_doubt_questions.sql
-- the claim cap (20261122201000) on top: every assertion below runs against the capped ineligibility
\ir ../migrations/20261122201000_fact_doubt_claim_cap.sql

-- fixtures
INSERT INTO vehicles VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1', NULL, true, NULL),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1', NULL, false, NULL);
INSERT INTO observation_properties VALUES
  ('00000000-0000-0000-0000-0000000000e1', 'engine_head_date_code', 'Cylinder head date code', now(), NULL),
  ('00000000-0000-0000-0000-0000000000e2', 'old_key', 'Old key', now(), now());
INSERT INTO vehicle_images(id, vehicle_id, taken_at, is_duplicate, is_superseded, is_sensitive, vision_gate_status) VALUES
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', now(), false, false, false, 'approved'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000a1', now(), false, false, false, 'approved'),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000a1', now(), false, false, true, 'approved');
INSERT INTO receipts VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 'Some Vendor', 'parts_service', '2025-01-10', false, NULL, NULL, NULL);
INSERT INTO receipt_items VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 1, 'Research heads', NULL, 10, NULL, NULL, NULL);
INSERT INTO receipt_vehicle_links VALUES ('00000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000b1', 'linked', 'cited_document', 0.9, '2025-01-10', 'printed', NULL);

-- receipt-kind rows as the producer left them (fixtures; the receipt kind's own lifecycle is covered by test_receipt_work_reconciliation.sql)
INSERT INTO evidence_judgment_requests(department, question_kind, subject_table, subject_id, vehicle_id, params, answer_schema, producer_agent,
  producer_script, producer_version, run_id, dedupe_key, status, answer, answer_agent, answer_model, answer_version, answered_at, retire_kind) VALUES
  ('receipt_work_reconciliation', 'receipt_part_visible', 'receipt_items', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1',
   '{"description":"70-76 SHAKER HOOD; list 37.27","total_price":652.99,"vendor_name":"Classic Industries","custodian_user_id":"00000000-0000-0000-0000-0000000000b1","context":{"line_kind":"part"}}',
   '{}', 'p', 's', 'v', '00000000-0000-0000-0000-000000000001', 'r1', 'answered',
   '{"visible":"yes","installed":"yes","confidence":0.9,"image_id":"00000000-0000-0000-0000-0000000000f3","quote":"Hood installed; paid $45.00"}',
   'reader-a', 'model-a', 'rv1', now(), NULL),
  ('receipt_work_reconciliation', 'receipt_part_visible', 'receipt_items', '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a1',
   '{"description":"TAIL LAMP","context":{"line_kind":"part"}}', '{}', 'p', 's', 'v', '00000000-0000-0000-0000-000000000001', 'r2', 'answered',
   '{"visible":"yes","installed":"cannot_tell","confidence":0.4,"image_id":null}', 'reader-a', 'model-a', 'rv1', now(), NULL),
  ('receipt_work_reconciliation', 'receipt_part_visible', 'receipt_items', '00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000a1',
   '{"description":"BEZEL","context":{"line_kind":"part"}}', '{}', 'p', 's', 'v', '00000000-0000-0000-0000-000000000001', 'r3', 'pending', NULL, NULL, NULL, NULL, NULL, NULL),
  ('receipt_work_reconciliation', 'receipt_part_visible', 'receipt_items', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1',
   '{"description":"old content"}', '{}', 'p', 's', 'v', '00000000-0000-0000-0000-000000000001', 'r4', 'cancelled', NULL, NULL, NULL, NULL, NULL, 'content_changed'),
  ('receipt_work_reconciliation', 'receipt_part_visible', 'receipt_items', '00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000a1',
   '{"description":"withdrawn"}', '{}', 'p', 's', 'v', '00000000-0000-0000-0000-000000000001', 'r5', 'withdrawn',
   '{"visible":"no","installed":"no","confidence":0.5}', 'reader-a', 'model-a', 'rv1', now(), 'frame_withdrawn'),
  ('receipt_work_reconciliation', 'receipt_part_visible', 'receipt_items', '00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-0000000000a2',
   '{"description":"on a hidden vehicle","context":{"line_kind":"part"}}', '{}', 'p', 's', 'v', '00000000-0000-0000-0000-000000000001', 'r6', 'pending', NULL, NULL, NULL, NULL, NULL, NULL);

-- 1. the gate: first kind unchanged in behavior, unknown kind refused, second kind admitted
DO $$
DECLARE rid uuid; probs text[];
BEGIN
  SELECT id INTO rid FROM evidence_judgment_requests WHERE dedupe_key = 'r3';
  probs := evidence_judgment_ineligibility(rid);
  ASSERT 'receipt_removed' = ANY (probs) AND NOT 'unknown_question_kind' = ANY (probs), 'receipt kind still reaches its own check: ' || probs::text;
  ASSERT evidence_judgment_ineligibility(gen_random_uuid()) = ARRAY['no_request'];
  ASSERT cardinality(evidence_judgment_answer_problems('receipt_part_visible', '{"candidate_image_ids":[]}',
    '{"visible":"no","installed":"no","confidence":0.5}')) = 0, 'receipt answer shape unchanged';
  ASSERT cardinality(evidence_judgment_answer_problems('receipt_part_visible', '{}', '{"visible":"maybe"}')) > 0;
  ASSERT evidence_judgment_answer_problems('mystery', '{}', '{}') = ARRAY['unknown question_kind mystery'];
  ASSERT public.fact_doubt_trigger_key('{"a":1,"b":[2]}') = public.fact_doubt_trigger_key('{"b":[2],"a":1}'), 'key order does not matter';
END $$;

-- 2. raise, claim, answer, agree
DO $$
DECLARE
  V constant uuid := '00000000-0000-0000-0000-0000000000a1'; U constant uuid := '00000000-0000-0000-0000-0000000000b1';
  P constant uuid := '00000000-0000-0000-0000-0000000000e1';
  g1 constant uuid := '00000000-0000-0000-0000-0000000000f1'; g2 constant uuid := '00000000-0000-0000-0000-0000000000f2';
  it1 constant uuid := '00000000-0000-0000-0000-0000000000d1';
  st jsonb; st2 jsonb; prm jsonb; row_ jsonb; r record; n int; q1 uuid; q2 uuid; q3 uuid; pb text[]; res jsonb;
BEGIN
  PERFORM set_config('test.role', 'service_role', false);
  st := jsonb_build_object('db', fact_doubt_evidence_state(V, 'engine_head_date_code', ARRAY[g1, g2], ARRAY[it1]));
  ASSERT st #> '{db,observations}' = '[]'::jsonb;
  prm := jsonb_build_object('doubt_form', 'property', 'property_key', 'engine_head_date_code', 'origin', 'simulated_reader', 'origin_ref', 'run-1',
    'cited_image_ids', to_jsonb(ARRAY[g1, g2]), 'cited_receipt_item_ids', to_jsonb(ARRAY[it1]), 'allowed', NULL::text, 'evidence_state', st);
  ASSERT cardinality(fact_doubt_params_problems(prm)) = 0, fact_doubt_params_problems(prm)::text;
  ASSERT 'origin must be simulated_reader|comment_question|contradiction_check' = ANY (fact_doubt_params_problems(prm || '{"origin":"me"}'));
  ASSERT 'params must not carry an earlier answer' = ANY (fact_doubt_params_problems(prm || '{"prior_answer":{}}'));
  ASSERT 'a doubt cites at least one frame or receipt line' = ANY (fact_doubt_params_problems(prm || '{"cited_image_ids":[],"cited_receipt_item_ids":[]}'));
  ASSERT 'reader_pair needs evidence_state.readers with at least two readers' = ANY (fact_doubt_params_problems(prm || '{"doubt_form":"reader_pair"}'));

  row_ := jsonb_build_object('department', 'fact_doubt', 'question_kind', 'fact_doubt', 'subject_table', 'observation_properties', 'subject_id', P,
    'vehicle_id', V, 'user_id', U, 'params', prm, 'answer_schema', '{}'::jsonb, 'producer_agent', 'doubt-producer', 'producer_script', 'test',
    'producer_version', 'test', 'dedupe_key', 'fd1', 'question_hash', 'h1', 'trigger_evidence_dedupe_key', fact_doubt_trigger_key(st));
  SELECT id INTO q1 FROM raise_evidence_judgment(row_, '00000000-0000-0000-0000-000000000002');
  ASSERT evidence_judgment_ineligibility(q1) = '{}', 'a fresh doubt is eligible: ' || evidence_judgment_ineligibility(q1)::text;
  -- raising the same doubt again changes nothing
  ASSERT (SELECT action FROM raise_evidence_judgment(row_, '00000000-0000-0000-0000-000000000002')) = 'unchanged';

  -- a reader-pair doubt, and a doubt about a key the registry does not have or has deprecated
  st2 := jsonb_build_object('db', st -> 'db', 'readers', jsonb_build_array(jsonb_build_object('reader', 'sheet_total'), jsonb_build_object('reader', 'line_total')));
  SELECT id INTO q2 FROM raise_evidence_judgment(row_ || jsonb_build_object('dedupe_key', 'fd2', 'question_hash', 'h2',
    'params', prm || jsonb_build_object('doubt_form', 'reader_pair', 'origin', 'contradiction_check', 'evidence_state', st2),
    'trigger_evidence_dedupe_key', fact_doubt_trigger_key(st2)), '00000000-0000-0000-0000-000000000002');
  ASSERT evidence_judgment_ineligibility(q2) = '{}', evidence_judgment_ineligibility(q2)::text;
  SELECT id INTO q3 FROM raise_evidence_judgment(row_ || jsonb_build_object('dedupe_key', 'fd3', 'question_hash', 'h3',
    'params', prm || '{"property_key":"old_key"}'), '00000000-0000-0000-0000-000000000002');
  ASSERT 'key_not_registered' = ANY (evidence_judgment_ineligibility(q3)), evidence_judgment_ineligibility(q3)::text;
  UPDATE evidence_judgment_requests SET status = 'cancelled' WHERE id = q3;

  -- a third doubt: ends cannot_tell
  PERFORM raise_evidence_judgment(row_ || jsonb_build_object('dedupe_key', 'fd4', 'question_hash', 'h4',
    'params', prm || '{"origin":"comment_question","origin_ref":"c-9"}'), '00000000-0000-0000-0000-000000000002');

  -- the closed answer
  pb := fact_doubt_answer_problems(prm, '{"outcome":"value","value":"AB12","confidence":0.8,"image_ids":["00000000-0000-0000-0000-0000000000f1"],"quote":"stamp reads AB12"}');
  ASSERT cardinality(pb) = 0, pb::text;
  ASSERT 'a value needs a witness: an image id or a receipt item id' = ANY (fact_doubt_answer_problems(prm, '{"outcome":"value","value":"AB12","confidence":0.8}'));
  ASSERT 'image_ids must be a subset of cited_image_ids' = ANY (fact_doubt_answer_problems(prm, '{"outcome":"cannot_tell","confidence":0.8,"image_ids":["00000000-0000-0000-0000-0000000000f3"]}'));
  ASSERT 'value only with outcome value' = ANY (fact_doubt_answer_problems(prm, '{"outcome":"not_visible","value":"x","confidence":0.8}'));
  ASSERT 'different_measures is only for a reader_pair doubt' = ANY (fact_doubt_answer_problems(prm, '{"outcome":"different_measures","confidence":0.8,"quote":"q"}'));
  ASSERT 'value must be one of params.allowed' = ANY (fact_doubt_answer_problems(prm || '{"allowed":["X1"]}', '{"outcome":"value","value":"AB12","confidence":0.8,"receipt_item_ids":["00000000-0000-0000-0000-0000000000d1"]}'));
  ASSERT cardinality(fact_doubt_answer_problems(prm || '{"allowed":["AB12"]}', '{"outcome":"value","value":"AB12","confidence":0.8,"receipt_item_ids":["00000000-0000-0000-0000-0000000000d1"]}')) = 0;
  ASSERT 'outcome must be value|not_visible|cannot_tell|different_measures' = ANY (fact_doubt_answer_problems(prm, '{"outcome":"yes","confidence":0.5}'));

  -- claim the three open doubts, answer each; a malformed answer is refused, not coerced
  SELECT count(*) INTO n FROM claim_evidence_judgments('fact_doubt', 'fact_doubt', 10, 'w1');
  ASSERT n = 3, 'three eligible doubts claimed, got ' || n;
  BEGIN
    PERFORM answer_evidence_judgment(q1, 'w1', '{"outcome":"value","value":"AB12","confidence":0.8}', 'reader-a', 'model-a', 'fv1');
    RAISE EXCEPTION 'a value with no witness was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  PERFORM answer_evidence_judgment(q1, 'w1', '{"outcome":"value","value":"AB12","confidence":0.8,"image_ids":["00000000-0000-0000-0000-0000000000f1"],"quote":"stamp reads AB12"}', 'reader-a', 'model-a', 'fv1');
  PERFORM answer_evidence_judgment(q2, 'w1', '{"outcome":"different_measures","confidence":0.7,"quote":"one is the sheet total, the other the line sum"}', 'reader-a', 'model-a', 'fx');
  PERFORM answer_evidence_judgment((SELECT id FROM evidence_judgment_requests WHERE dedupe_key = 'fd4'), 'w1', '{"outcome":"cannot_tell","confidence":0.3}', 'reader-a', 'model-a', 'fx');

  -- a second, independent reading of doubt 1: the first is kept in answer_history, never overwritten
  SELECT count(*) INTO n FROM reopen_evidence_judgment_answers('fv1', 'second look', false);
  ASSERT n = 1;
  SELECT count(*) INTO n FROM claim_evidence_judgments('fact_doubt', 'fact_doubt', 10, 'w2');
  ASSERT n = 1;
  PERFORM answer_evidence_judgment(q1, 'w2', '{"outcome":"value","value":"AB12","confidence":0.9,"receipt_item_ids":["00000000-0000-0000-0000-0000000000d1"]}', 'reader-b', 'model-b', 'fv2');
  ASSERT jsonb_array_length((SELECT answer_history FROM evidence_judgment_requests WHERE id = q1)) = 1;

  -- the doubt about evidence that then changes is no longer eligible; a fresh doubt is raised instead
  PERFORM raise_evidence_judgment(row_ || jsonb_build_object('dedupe_key', 'fd5', 'question_hash', 'h5'), '00000000-0000-0000-0000-000000000002');
  ASSERT evidence_judgment_ineligibility((SELECT id FROM evidence_judgment_requests WHERE dedupe_key = 'fd5')) = '{}';
  INSERT INTO vehicle_observations(vehicle_id, property_id, structured_data) VALUES (V, P, '{"value":"AB12"}');
  ASSERT 'evidence_changed' = ANY (evidence_judgment_ineligibility((SELECT id FROM evidence_judgment_requests WHERE dedupe_key = 'fd5')));
  SELECT count(*) INTO n FROM claim_evidence_judgments('fact_doubt', 'fact_doubt', 10, 'w3');
  ASSERT n = 0, 'a doubt over changed evidence is not claimed';
  -- an ineligible doubt is not asked to be answered; a new raise over the new state is a new trigger key
  ASSERT fact_doubt_trigger_key(jsonb_build_object('db', fact_doubt_evidence_state(V, 'engine_head_date_code', ARRAY[g1, g2], ARRAY[it1])))
         <> fact_doubt_trigger_key(st);
  -- a frame that becomes sensitive makes the doubt ineligible too
  UPDATE vehicle_images SET is_sensitive = true WHERE id = g2;
  ASSERT 'frame_ineligible:00000000-0000-0000-0000-0000000000f2' = ANY (evidence_judgment_ineligibility(q1));
  UPDATE vehicle_images SET is_sensitive = false WHERE id = g2;
  RAISE NOTICE 'fact_doubt gate: ok';
END $$;

-- 3. the reader
DO $$
DECLARE
  V constant uuid := '00000000-0000-0000-0000-0000000000a1'; H constant uuid := '00000000-0000-0000-0000-0000000000a2';
  U constant uuid := '00000000-0000-0000-0000-0000000000b1';
  res jsonb; txt text; e jsonb;
BEGIN
  PERFORM set_config('test.role', '', false); PERFORM set_config('test.uid', '', false);
  ASSERT has_function_privilege('anon', 'public.vehicle_open_questions(uuid)', 'execute');
  ASSERT NOT has_function_privilege('anon', 'public.fact_doubt_ineligibility(uuid)', 'execute');
  ASSERT NOT has_function_privilege('anon', 'public.evidence_judgment_ineligibility(uuid)', 'execute');
  SET ROLE anon;
  res := public.vehicle_open_questions(V);
  RESET ROLE;
  ASSERT res IS NOT NULL, 'anon reads a public vehicle';
  -- receipt: r1 answered, r2 open (installed cannot be told), r3 asked. doubts: fd1 answered (two independent readers), fd2 answered
  -- (different measures), fd4 open (cannot tell), fd5 asked.
  ASSERT (res #>> '{counts,questions}')::int = 7, res #>> '{counts,questions}';
  ASSERT (res #>> '{counts,asked}')::int = 2 AND (res #>> '{counts,answered}')::int = 3 AND (res #>> '{counts,open}')::int = 2, res -> 'counts';
  ASSERT (res #>> '{counts,bought_parts,asked_about}')::int = 3 AND (res #>> '{counts,bought_parts,waiting}')::int = 1
     AND (res #>> '{counts,bought_parts,seen_installed}')::int = 1 AND (res #>> '{counts,bought_parts,still_open}')::int = 1, res #> '{counts,bought_parts}';
  ASSERT (res #>> '{counts,retired,rows}')::int = 3 AND (res #>> '{counts,retired,replaced_by_changed_question}')::int = 1, res #> '{counts,retired}';
  ASSERT res #>> '{questions,0,state}' = 'open', 'open questions first';
  -- agreement: the doubt read twice by two different readers
  SELECT x INTO e FROM jsonb_array_elements(res -> 'questions') x WHERE x ->> 'property_key' = 'engine_head_date_code' AND x ->> 'raised_by' = 'simulated_reader' AND x ->> 'state' = 'answered';
  ASSERT e IS NOT NULL AND e #>> '{readings,verdict}' = 'agreed by independent readers' AND (e #>> '{readings,independent_readers_agreeing}')::int = 2, e::text;
  ASSERT e #>> '{answer,words}' = 'The evidence shows: AB12.', e::text;
  ASSERT e #>> '{witnesses,image_ids}' = '[]' AND jsonb_array_length(e #> '{witnesses,receipt_item_ids}') = 1, 'the current answer cites the receipt line only: ' || e::text;
  SELECT x INTO e FROM jsonb_array_elements(res -> 'questions') x WHERE x ->> 'raised_by' = 'contradiction_check';
  ASSERT e #>> '{answer,words}' = 'The two figures measure different things.' AND e #>> '{readers_named,0}' = 'sheet_total', e::text;
  SELECT x INTO e FROM jsonb_array_elements(res -> 'questions') x WHERE x ->> 'subject' LIKE '70-76 SHAKER HOOD%';
  ASSERT e #>> '{witnesses,image_ids}' = '[]', 'a sensitive frame is never returned';
  ASSERT e ->> 'subject' = '70-76 SHAKER HOOD', 'list price dropped: ' || (e ->> 'subject');
  ASSERT e #>> '{answer,words}' = 'The part is visible and installed on the car in the cited photo.';
  -- nothing private
  txt := res::text;
  ASSERT txt NOT LIKE '%Classic Industries%' AND txt NOT LIKE '%652.99%' AND txt NOT LIKE '%37.27%' AND txt NOT LIKE '%45.00%'
     AND txt NOT LIKE '%vendor%' AND txt NOT LIKE '%total_price%' AND txt NOT LIKE '%' || U::text || '%' AND txt NOT LIKE '%params%', 'private content leaked';
  -- visibility
  ASSERT public.vehicle_open_questions(H) IS NULL, 'a hidden vehicle returns null to anon';
  PERFORM set_config('test.uid', U::text, false);
  ASSERT public.vehicle_open_questions(H) IS NOT NULL, 'its owner reads it';
  PERFORM set_config('test.uid', '', false);
  ASSERT public.vehicle_open_questions(gen_random_uuid()) IS NULL;
  RAISE NOTICE 'vehicle_open_questions: ok';
END $$;

-- 4. the claim cap: a doubt taken up six times without an answer is no longer offered or accepted
DO $$
DECLARE
  V constant uuid := '00000000-0000-0000-0000-0000000000a1'; g1 constant uuid := '00000000-0000-0000-0000-0000000000f1';
  P constant uuid := '00000000-0000-0000-0000-0000000000e1'; U constant uuid := '00000000-0000-0000-0000-0000000000b1';
  st jsonb; prm jsonb; q uuid; n int; five jsonb;
BEGIN
  PERFORM set_config('test.role', 'service_role', false);
  st := jsonb_build_object('db', fact_doubt_evidence_state(V, 'engine_head_date_code', ARRAY[g1], ARRAY[]::uuid[]));
  prm := jsonb_build_object('doubt_form', 'property', 'property_key', 'engine_head_date_code', 'origin', 'simulated_reader', 'origin_ref', 'run-cap',
    'cited_image_ids', to_jsonb(ARRAY[g1]), 'cited_receipt_item_ids', '[]'::jsonb, 'allowed', NULL::text, 'evidence_state', st);
  SELECT id INTO q FROM raise_evidence_judgment(jsonb_build_object('department', 'fact_doubt', 'question_kind', 'fact_doubt',
    'subject_table', 'observation_properties', 'subject_id', P, 'vehicle_id', V, 'user_id', U, 'params', prm, 'answer_schema', '{}'::jsonb,
    'producer_agent', 'doubt-producer', 'producer_script', 'test', 'producer_version', 'test', 'dedupe_key', 'fd-cap', 'question_hash', 'hcap',
    'trigger_evidence_dedupe_key', fact_doubt_trigger_key(st)), '00000000-0000-0000-0000-000000000002');
  ASSERT evidence_judgment_ineligibility(q) = '{}', 'fresh: ' || evidence_judgment_ineligibility(q)::text;
  -- five earlier claims that died (fixture: the lifecycle as five dead claims leave it)
  SELECT jsonb_agg(jsonb_build_object('kind', 'claim', 'to', 'claimed', 'actor', 'dead-' || i)) INTO five FROM generate_series(1, 5) i;
  UPDATE evidence_judgment_requests SET lifecycle = lifecycle || five WHERE id = q;
  ASSERT evidence_judgment_ineligibility(q) = '{}', 'five claims: still offered';
  SELECT count(*) INTO n FROM claim_evidence_judgments('fact_doubt', 'fact_doubt', 10, 'w-cap');
  ASSERT n = 1, 'the sixth claim is made, got ' || n;
  ASSERT 'claimed_6_times' = ANY (evidence_judgment_ineligibility(q)), 'six claims: refused ' || evidence_judgment_ineligibility(q)::text;
  BEGIN
    PERFORM answer_evidence_judgment(q, 'w-cap', '{"outcome":"cannot_tell","confidence":0.3}', 'reader-a', 'model-a', 'fx');
    RAISE EXCEPTION 'an answer to a doubt claimed six times was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%no longer eligible: claimed_6_times%' THEN RAISE; END IF;
  END;
  UPDATE evidence_judgment_requests SET claimed_at = now() - interval '2 hours' WHERE id = q;
  SELECT count(*) INTO n FROM claim_evidence_judgments('fact_doubt', 'fact_doubt', 10, 'w-cap2', 30);
  ASSERT n = 0, 'a doubt claimed six times is not offered again, got ' || n;
  RAISE NOTICE 'claim cap: ok';
END $$;
