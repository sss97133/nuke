-- Disposable synthetic contract; no production data. Runs the migration for the owner-private work projection store against
-- the financial evidence fixture: account scope, append-only revisions, claim-versus-observation payload contract,
-- cross-owner refusal, sticky privacy holds, idempotency and role denial.
\set ON_ERROR_STOP on
\ir test_financial_evidence.sql
\ir ../migrations/20261107210025_private_work_projections.sql
BEGIN;
INSERT INTO auth.users(id) VALUES ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333');
UPDATE auth.users SET banned_until = now() + interval '1 day' WHERE id = '33333333-3333-4333-8333-333333333333';
SELECT set_config('request.jwt.claim.role', 'service_role', true);

CREATE FUNCTION pg_temp.fails(q text, needle text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE q;
  EXCEPTION WHEN OTHERS THEN
    IF position(needle IN SQLERRM) = 0 THEN RAISE EXCEPTION 'wrong error, wanted [%] got [%]', needle, SQLERRM; END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'accepted but should refuse: %', needle;
END $$;

CREATE FUNCTION pg_temp.rev(idem text, items jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('idempotency_key', idem, 'producer', 'synthetic_producer', 'method', 'synthetic_method',
    'version', 'v1', 'run_label', 'run-' || idem, 'projections', items) $$;

CREATE FUNCTION pg_temp.img_item(k text, extra jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('kind', 'image_timeline_event', 'projection_key', md5(k), 'source_privacy_hold', false, 'holds',
    '["clock_offset_unknown"]'::jsonb, 'evidence_refs', jsonb_build_array(jsonb_build_object('kind', 'image', 'sha256', repeat('a', 64))),
    'payload', jsonb_build_object('event_key', md5(k), 'stance', 'visual_observed', 'time', jsonb_build_object('kind', 'instant',
      'camera_local', '2016-03-27T10:00:00'), 'capture', jsonb_build_object('source', 'exif_original', 'offset_state', 'unknown'),
      'identity', jsonb_build_object('state', 'confirmed', 'basis', 'cited'), 'origin_class', 'archive', 'intent', 'labor',
      'assertion_status', 'observation_unverified', 'completed_work_asserted', false)) || extra $$;

CREATE FUNCTION pg_temp.labor_item(k text, doc uuid, run uuid, sha text, revkey text, extra jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('kind', 'labor_reconciliation', 'projection_key', md5(k), 'source_privacy_hold', false, 'holds', '[]'::jsonb,
    'financial_document_id', doc, 'evidence_refs', jsonb_build_array(jsonb_build_object('kind', 'financial_document_revision',
      'document_id', doc, 'extraction_run_id', run, 'original_sha256', sha, 'revision_idempotency_key', revkey),
      jsonb_build_object('kind', 'attachment', 'sha256', sha), jsonb_build_object('kind', 'source_message', 'origin_key', 'gmail:acct:m1:p1',
      'rfc_message_id', '<m1@x.test>')),
    'payload', jsonb_build_object('reconciliation_key', md5(k),
      'claim', jsonb_build_object('claimed_hours', '10', 'source_claim', true, 'verified', false),
      'observed', jsonb_build_object('status', 'review_camera_local_only', 'observed_day_count', 1, 'clusters', '[]'::jsonb, 'hours_lower', NULL),
      'holds', jsonb_build_object('unknown_clock', 3, 'intent_unclassified', 1, 'identity_not_confirmed', 2),
      'rate_provenance', '[{"category":"a","rate_source":"stated_on_document"}]'::jsonb, 'conflicts', '[]'::jsonb,
      'relation', 'not_assessable', 'additive', false, 'billable_hours', NULL, 'hours_verified', false)) || extra $$;

DO $$ DECLARE
  a uuid := '11111111-1111-4111-8111-111111111111'; b uuid := '22222222-2222-4222-8222-222222222222';
  sha_a text := repeat('d', 64); sha_b text := repeat('e', 64);
  da jsonb; db jsonb; r jsonb; r2 jsonb; id1 uuid; head jsonb; n integer; i1 jsonb; l1 jsonb;
BEGIN
  da := ingest_financial_evidence(a, jsonb_build_object('sha256', sha_a, 'storage_path', a || '/a.pdf', 'byte_size', 100),
    '{"idempotency_key":"rev-a","method":"synthetic","version":"1","fields":[{"field_key":"c1","value_raw":"x","evidence":{"q":"s"}}]}');
  db := ingest_financial_evidence(b, jsonb_build_object('sha256', sha_b, 'storage_path', b || '/b.pdf', 'byte_size', 100),
    '{"idempotency_key":"rev-b","method":"synthetic","version":"1","fields":[{"field_key":"c1","value_raw":"x","evidence":{"q":"s"}}]}');

  -- create, replay, conflict, unchanged
  i1 := pg_temp.img_item('e1');
  r := ingest_private_work_projection(a, pg_temp.rev('k1', jsonb_build_array(i1)));
  IF r->'results'->0->>'status' <> 'created' OR (r->>'writes')::int <> 1 OR r->>'public_timeline_written' <> 'false' THEN RAISE EXCEPTION 'create failed %', r; END IF;
  r2 := ingest_private_work_projection(a, pg_temp.rev('k1', jsonb_build_array(i1)));
  IF r2->'results'->0->>'status' <> 'duplicate' OR (r2->>'writes')::int <> 0 THEN RAISE EXCEPTION 'replay not idempotent %', r2; END IF;
  PERFORM pg_temp.fails(format('SELECT ingest_private_work_projection(%L, %L::jsonb)', a,
    pg_temp.rev('k1', jsonb_build_array(pg_temp.img_item('e1', '{"holds":["other"]}')))::text), 'idempotency key payload conflict');
  r2 := ingest_private_work_projection(a, pg_temp.rev('k2-new-run', jsonb_build_array(i1)));
  IF r2->'results'->0->>'status' <> 'unchanged' THEN RAISE EXCEPTION 'same content under a new run wrote %', r2; END IF;
  IF (SELECT count(*) FROM private_work_projections) <> 1 THEN RAISE EXCEPTION 'replay duplicated rows'; END IF;
  id1 := (r->'results'->0->>'id')::uuid;

  -- supersession: must name the current head; stale and missing pointers fail closed; history kept
  PERFORM pg_temp.fails(format('SELECT ingest_private_work_projection(%L, %L::jsonb)', a,
    pg_temp.rev('k3', jsonb_build_array(pg_temp.img_item('e1', '{"holds":["x"]}')))::text), 'correction must name the current revision');
  r := ingest_private_work_projection(a, pg_temp.rev('k4', jsonb_build_array(pg_temp.img_item('e1', jsonb_build_object('holds', '["x"]'::jsonb, 'supersedes_id', id1)))));
  IF r->'results'->0->>'status' <> 'created' OR (r->'results'->0->>'revision_no')::int <> 2 THEN RAISE EXCEPTION 'supersession failed %', r; END IF;
  PERFORM pg_temp.fails(format('SELECT ingest_private_work_projection(%L, %L::jsonb)', a,
    pg_temp.rev('k5', jsonb_build_array(pg_temp.img_item('e1', jsonb_build_object('holds', '["y"]'::jsonb, 'supersedes_id', id1))))::text), 'correction must name the current revision');
  IF jsonb_array_length(read_private_work_projections(a)) <> 1 OR read_private_work_projections(a)->0->>'revision_no' <> '2' THEN RAISE EXCEPTION 'head read wrong'; END IF;
  IF jsonb_array_length(read_private_work_projections(a, NULL, NULL, true)) <> 2 THEN RAISE EXCEPTION 'history not kept'; END IF;

  -- labor: financial document must be in the account scope and the revision exact
  l1 := pg_temp.labor_item('l1', (da->>'document_id')::uuid, (da->>'extraction_run_id')::uuid, sha_a, 'rev-a');
  r := ingest_private_work_projection(a, pg_temp.rev('k6', jsonb_build_array(l1)));
  IF r->'results'->0->>'status' <> 'created' THEN RAISE EXCEPTION 'labor create failed %', r; END IF;
  PERFORM pg_temp.fails(format('SELECT ingest_private_work_projection(%L, %L::jsonb)', a, pg_temp.rev('k7', jsonb_build_array(
    pg_temp.labor_item('l2', (db->>'document_id')::uuid, (db->>'extraction_run_id')::uuid, sha_b, 'rev-b')))::text), 'not in this account scope');
  PERFORM pg_temp.fails(format('SELECT ingest_private_work_projection(%L, %L::jsonb)', a, pg_temp.rev('k8', jsonb_build_array(
    pg_temp.labor_item('l3', (da->>'document_id')::uuid, gen_random_uuid(), sha_a, 'rev-a')))::text), 'not in this account scope');
  PERFORM pg_temp.fails(format('SELECT ingest_private_work_projection(%L, %L::jsonb)', a, pg_temp.rev('k9', jsonb_build_array(
    pg_temp.labor_item('l4', (da->>'document_id')::uuid, (da->>'extraction_run_id')::uuid, repeat('f', 64), 'rev-a')))::text), 'not in this account scope');
  PERFORM pg_temp.fails(format('SELECT ingest_private_work_projection(%L, %L::jsonb)', a, pg_temp.rev('k10', jsonb_build_array(
    (pg_temp.labor_item('l5', (da->>'document_id')::uuid, (da->>'extraction_run_id')::uuid, sha_a, 'rev-a') - 'financial_document_id')))::text), 'violates check constraint');

  -- claimed hours are never added to, or replaced by, observed hours; no verification keys
  PERFORM pg_temp.fails(format('SELECT ingest_private_work_projection(%L, %L::jsonb)', a, pg_temp.rev('k11', jsonb_build_array(
    pg_temp.labor_item('l6', (da->>'document_id')::uuid, (da->>'extraction_run_id')::uuid, sha_a, 'rev-a',
      jsonb_build_object('payload', (l1->'payload') || '{"additive":true}'))))::text), 'claim-versus-observation');
  PERFORM pg_temp.fails(format('SELECT ingest_private_work_projection(%L, %L::jsonb)', a, pg_temp.rev('k12', jsonb_build_array(
    pg_temp.labor_item('l7', (da->>'document_id')::uuid, (da->>'extraction_run_id')::uuid, sha_a, 'rev-a',
      jsonb_build_object('payload', (l1->'payload') || '{"billable_hours":"9.5"}'))))::text), 'claim-versus-observation');
  PERFORM pg_temp.fails(format('SELECT ingest_private_work_projection(%L, %L::jsonb)', a, pg_temp.rev('k13', jsonb_build_array(
    pg_temp.labor_item('l8', (da->>'document_id')::uuid, (da->>'extraction_run_id')::uuid, sha_a, 'rev-a',
      jsonb_build_object('payload', jsonb_set(l1->'payload', '{observed}', '{"total_hours":"20"}')))))::text), 'forbidden key');
  PERFORM pg_temp.fails(format('SELECT ingest_private_work_projection(%L, %L::jsonb)', a, pg_temp.rev('k14', jsonb_build_array(
    pg_temp.labor_item('l9', (da->>'document_id')::uuid, (da->>'extraction_run_id')::uuid, sha_a, 'rev-a',
      jsonb_build_object('payload', jsonb_set(l1->'payload', '{claim,verified}', 'true')))))::text), 'claim-versus-observation');
  PERFORM pg_temp.fails(format('SELECT ingest_private_work_projection(%L, %L::jsonb)', a, pg_temp.rev('k15', jsonb_build_array(
    pg_temp.labor_item('l10', (da->>'document_id')::uuid, (da->>'extraction_run_id')::uuid, sha_a, 'rev-a',
      jsonb_build_object('payload', (l1->'payload') || '{"ownership_verified":true}'))))::text), 'forbidden key');

  -- unknown camera offset never carries UTC; unconfirmed identity stays held; no mail/person/bank content
  PERFORM pg_temp.fails(format('SELECT ingest_private_work_projection(%L, %L::jsonb)', a, pg_temp.rev('k16', jsonb_build_array(
    pg_temp.img_item('e2', jsonb_build_object('payload', jsonb_set(i1->'payload', '{capture,utc}', '"2016-03-27T10:00:00+00:00"')))))::text), 'unknown camera offset');
  PERFORM pg_temp.fails(format('SELECT ingest_private_work_projection(%L, %L::jsonb)', a, pg_temp.rev('k17', jsonb_build_array(
    pg_temp.img_item('e3', jsonb_build_object('payload', jsonb_set(i1->'payload', '{identity,state}', '"unconfirmed"')))))::text), 'must stay held');
  PERFORM pg_temp.fails(format('SELECT ingest_private_work_projection(%L, %L::jsonb)', a, pg_temp.rev('k18', jsonb_build_array(
    pg_temp.img_item('e4', jsonb_build_object('payload', jsonb_set(i1->'payload', '{origin_class}', '"someone@example.invalid"')))))::text), 'e-mail address');
  PERFORM pg_temp.fails(format('SELECT ingest_private_work_projection(%L, %L::jsonb)', a, pg_temp.rev('k19', jsonb_build_array(
    pg_temp.img_item('e5', jsonb_build_object('payload', (i1->'payload') || '{"body":"hello"}'))))::text), 'forbidden key');
  PERFORM pg_temp.fails(format('SELECT ingest_private_work_projection(%L, %L::jsonb)', a, pg_temp.rev('k20', jsonb_build_array(
    pg_temp.img_item('e6', jsonb_build_object('evidence_refs', '[{"kind":"image","sha256":"nothex"}]'::jsonb))))::text), 'exact sha256');
  PERFORM pg_temp.fails(format('SELECT ingest_private_work_projection(%L, %L::jsonb)', a, pg_temp.rev('k21', jsonb_build_array(
    pg_temp.img_item('e7', jsonb_build_object('payload', (i1->'payload') || '{"completed_work_asserted":true}'))))::text), 'observation contract');

  -- a source privacy hold is sticky across revisions
  r := ingest_private_work_projection(a, pg_temp.rev('k22', jsonb_build_array(pg_temp.img_item('h1', jsonb_build_object('source_privacy_hold', true,
    'payload', jsonb_set(jsonb_set(i1->'payload', '{assertion_status}', '"held"'), '{event_key}', to_jsonb(md5('h1'))))))));
  id1 := (r->'results'->0->>'id')::uuid;
  PERFORM pg_temp.fails(format('SELECT ingest_private_work_projection(%L, %L::jsonb)', a, pg_temp.rev('k23', jsonb_build_array(
    pg_temp.img_item('h1', jsonb_build_object('supersedes_id', id1, 'source_privacy_hold', false,
      'payload', jsonb_set(jsonb_set(i1->'payload', '{assertion_status}', '"held"'), '{event_key}', to_jsonb(md5('h1')))))))::text), 'privacy hold cannot be cleared');
  PERFORM pg_temp.fails(format('SELECT ingest_private_work_projection(%L, %L::jsonb)', a, pg_temp.rev('k24', jsonb_build_array(
    pg_temp.img_item('h1', jsonb_build_object('supersedes_id', id1, 'source_privacy_hold', true, 'holds', '["z"]'::jsonb))))::text), 'must stay held');

  -- account scope: another account sees nothing; a banned or unknown account cannot write; actor context is closed
  IF jsonb_array_length(read_private_work_projections(b)) <> 0 THEN RAISE EXCEPTION 'cross-account read leak'; END IF;
  IF (SELECT count(*) FROM private_work_projections WHERE owner_id = b) <> 0 THEN RAISE EXCEPTION 'foreign rows'; END IF;
  PERFORM pg_temp.fails(format('SELECT ingest_private_work_projection(%L, %L::jsonb)', '33333333-3333-4333-8333-333333333333',
    pg_temp.rev('k25', jsonb_build_array(pg_temp.img_item('e8')))::text), 'authenticated account required');
  PERFORM pg_temp.fails(format('SELECT ingest_private_work_projection(%L, %L::jsonb)', gen_random_uuid(),
    pg_temp.rev('k26', jsonb_build_array(pg_temp.img_item('e9')))::text), 'authenticated account required');
  PERFORM pg_temp.fails(format('SELECT ingest_private_work_projection(%L, %L::jsonb, %L::jsonb)', a,
    pg_temp.rev('k27', jsonb_build_array(pg_temp.img_item('e10')))::text, '{"owner_user_id":"x"}'), 'invalid verified actor context');
  PERFORM pg_temp.fails(format('SELECT ingest_private_work_projection(%L, %L::jsonb)', a,
    (pg_temp.rev('k28', jsonb_build_array(pg_temp.img_item('e11'))) || '{"owner_id":"x"}')::text), 'invalid private work projection envelope');

  -- append-only for everyone, including the service role
  PERFORM pg_temp.fails('UPDATE private_work_projections SET holds = ''[]''', 'append-only');
  PERFORM pg_temp.fails('DELETE FROM private_work_projections', 'append-only');
  PERFORM pg_temp.fails('TRUNCATE private_work_projections', 'append-only');
  -- raw inserts are held to the same contract
  PERFORM pg_temp.fails(format($f$INSERT INTO private_work_projections(owner_id,projection_kind,projection_key,revision_no,idempotency_key,request_digest,content_digest,
    producer,method,version,run_label,source_privacy_hold,evidence_refs,payload,actor_user_id) VALUES(%L,'image_timeline_event',md5('raw'),1,'raw',%L,%L,'p','m','v','r',false,
    '[{"kind":"image","sha256":"%s"}]','{"stance":"verified_work","extra":1}',%L)$f$, a, repeat('1',64), repeat('2',64), repeat('a',64), a), 'unknown keys');
  SELECT count(*) INTO n FROM private_work_projections;
  IF n <> 4 THEN RAISE EXCEPTION 'unexpected row count %', n; END IF;
END $$;

-- Roles without a grant: no table read or write, no function execution.
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM count(*) FROM private_work_projections; RAISE EXCEPTION 'anon read'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM ingest_private_work_projection('11111111-1111-4111-8111-111111111111', '{}'); RAISE EXCEPTION 'anon wrote'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM read_private_work_projections('11111111-1111-4111-8111-111111111111'); RAISE EXCEPTION 'anon rpc read'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM count(*) FROM private_work_projections; RAISE EXCEPTION 'owner read directly'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO private_work_projections(owner_id) VALUES ('11111111-1111-4111-8111-111111111111'); RAISE EXCEPTION 'owner wrote directly'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM ingest_private_work_projection('11111111-1111-4111-8111-111111111111', '{}'); RAISE EXCEPTION 'authenticated wrote'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM read_private_work_projections('11111111-1111-4111-8111-111111111111'); RAISE EXCEPTION 'authenticated rpc read'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
-- A signed-in (non-service) session cannot reach the writer even with the privilege, and the store grants no vehicle permission.
DO $$ BEGIN
  IF has_table_privilege('authenticated', 'private_work_projections', 'select') OR has_table_privilege('anon', 'private_work_projections', 'select') THEN
    RAISE EXCEPTION 'table grant leaked'; END IF;
  IF has_table_privilege('service_role', 'private_work_projections', 'update') OR has_table_privilege('service_role', 'private_work_projections', 'delete')
     OR has_table_privilege('service_role', 'private_work_projections', 'truncate') THEN RAISE EXCEPTION 'service role may rewrite history'; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.private_work_projections'::regclass) THEN RAISE EXCEPTION 'RLS off'; END IF;
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.private_work_projections'::regclass) THEN RAISE EXCEPTION 'unexpected policy'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname IN ('ingest_private_work_projection', 'read_private_work_projections', 'private_work_projection_guard')
             AND prosecdef) THEN RAISE EXCEPTION 'security definer exposed'; END IF;
  RAISE NOTICE 'PASS private work projections';
END $$;
ROLLBACK;
