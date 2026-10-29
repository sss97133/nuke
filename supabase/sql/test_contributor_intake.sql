-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_contributor_intake -f this-file.sql
-- Contract for 20261105090000_contributor_intake.sql. Synthetic rows only; never production.
-- The tables the writers touch are stubbed with the columns, constraints and triggers production held on 2026-10-29
-- (the device-attribution trigger and its two functions byte for byte from helpers/device_attribution_live_20261014.sql,
-- re-read 2026-10-29 and unchanged). Proves: invite -> open -> answer -> file -> read round-trips; unknown, expired and
-- revoked tokens get the same not_found shape; anon and authenticated cannot execute the service-role writers and only
-- the owner or an editor can call the owner writers; the answer row carries the device attestation with the contributor
-- as its observer; a re-answer supersedes and keeps the original; the upload lands with its device attribution pointing
-- at the contributor; a repeated sha256 returns duplicate=true and no second row. A second apply is a no-op.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;
CREATE FUNCTION pg_temp.raises(p_sql text) RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN
  EXECUTE p_sql; RETURN false;
EXCEPTION WHEN others THEN RETURN true;
END $$;

CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_uid', true), '')::uuid $$;

CREATE TYPE public.observation_kind AS ENUM ('listing', 'sale_result', 'comment', 'specification', 'provenance', 'media');
CREATE TYPE public.source_category AS ENUM ('auction', 'owner', 'documentation', 'internal');
CREATE TABLE public.profiles (id uuid PRIMARY KEY);
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, user_id uuid, year int, make text, model text, vin text, color text,
  body_style text, transmission text, origin_metadata jsonb, is_public boolean DEFAULT true);
CREATE TABLE public.vehicle_contributors (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id), user_id uuid NOT NULL REFERENCES public.profiles(id),
  role text NOT NULL, end_date date, status text DEFAULT 'active', can_edit boolean DEFAULT true);
CREATE TABLE public.observation_sources (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE,
  display_name text NOT NULL, category public.source_category NOT NULL, notes text);
CREATE TABLE public.external_identities (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), platform text NOT NULL,
  handle text NOT NULL, display_name text, metadata jsonb DEFAULT '{}'::jsonb, created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(), UNIQUE (platform, handle));
CREATE TABLE public.contributors (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contributor_type text NOT NULL CHECK (contributor_type IN ('source', 'org', 'user', 'identity', 'agent')),
  external_identity_id uuid REFERENCES public.external_identities(id), user_id uuid REFERENCES auth.users(id),
  verification_level text, status text NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.vehicle_observations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid REFERENCES public.vehicles(id), observed_at timestamptz NOT NULL, ingested_at timestamptz DEFAULT now(),
  source_id uuid REFERENCES public.observation_sources(id), source_identifier text,
  observer_id uuid REFERENCES public.external_identities(id), observer_raw jsonb, kind public.observation_kind NOT NULL,
  content_text text, content_hash text, structured_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_superseded boolean DEFAULT false, superseded_by uuid REFERENCES public.vehicle_observations(id),
  superseded_at timestamptz, submitted_by_user_id uuid REFERENCES auth.users(id), extraction_method text,
  subject_type text NOT NULL DEFAULT 'vehicle', subject_id uuid,
  CONSTRAINT unique_observation UNIQUE (source_id, source_identifier, kind, content_hash));
CREATE FUNCTION public.citation_required_write_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source_id IS NULL AND NEW.submitted_by_user_id IS NULL THEN RAISE EXCEPTION 'citation_required'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_citation_required_vehicle_observations BEFORE INSERT OR UPDATE ON public.vehicle_observations
  FOR EACH ROW EXECUTE FUNCTION public.citation_required_write_check();
CREATE TABLE public.ghost_users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), device_fingerprint text NOT NULL,
  camera_make text, camera_model text, lens_model text, software_version text, first_seen_at timestamptz DEFAULT now(),
  last_seen_at timestamptz DEFAULT now(), total_contributions int DEFAULT 0, display_name text);
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid REFERENCES public.vehicles(id),
  user_id uuid REFERENCES auth.users(id), image_url text NOT NULL, storage_path text, file_hash text, file_name text,
  filename text, file_size bigint, mime_type text, source text, is_external boolean, exif_data jsonb, caption text,
  ingest_kind text CHECK (ingest_kind IN ('live', 'backfill', 'import')),
  image_medium text NOT NULL DEFAULT 'photograph' CHECK (image_medium IN ('photograph', 'render', 'drawing', 'screenshot', 'camera', 'received', 'web', 'other')),
  photographer_attribution text, submitted_by uuid, is_sensitive boolean NOT NULL DEFAULT false, sensitive_type text, ghost_user_id uuid REFERENCES public.ghost_users(id), is_document boolean,
  is_superseded boolean, created_at timestamptz DEFAULT now());
CREATE UNIQUE INDEX idx_unique_vehicle_file_hash ON public.vehicle_images (vehicle_id, file_hash)
  WHERE file_hash IS NOT NULL AND vehicle_id IS NOT NULL AND coalesce(is_superseded, false) = false;
CREATE TABLE public.device_attributions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id uuid REFERENCES public.vehicle_images(id) ON DELETE CASCADE, timeline_event_id uuid,
  device_fingerprint text NOT NULL, ghost_user_id uuid REFERENCES public.ghost_users(id),
  actual_contributor_id uuid REFERENCES auth.users(id), uploaded_by_user_id uuid REFERENCES auth.users(id),
  attribution_source text DEFAULT 'exif_device', confidence_score int DEFAULT 100, extraction_method text DEFAULT 'exif',
  raw_exif jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  CONSTRAINT attribution_target CHECK (image_id IS NOT NULL OR timeline_event_id IS NOT NULL),
  CONSTRAINT device_attributions_image_id_uniq UNIQUE (image_id));
\ir helpers/device_attribution_live_20261014.sql
CREATE TRIGGER trg_auto_attribute_device AFTER INSERT ON public.vehicle_images
  FOR EACH ROW EXECUTE FUNCTION public.auto_attribute_image_to_device();
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;

\ir ../migrations/20261105090000_contributor_intake.sql
\ir ../migrations/20261105090000_contributor_intake.sql
\ir ../migrations/20261105110000_contributor_intake_actor.sql
\ir ../migrations/20261105110000_contributor_intake_actor.sql

-- Fixtures: an owner, an editor, a stranger, one vehicle with one prior specification fact.
INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b'),
  ('00000000-0000-0000-0000-00000000000c');
INSERT INTO public.profiles VALUES ('00000000-0000-0000-0000-00000000000b');
INSERT INTO public.vehicles (id, user_id, year, make, model, vin, color, origin_metadata) VALUES
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 1973, 'Pontiac', 'Firebird',
   'TESTVIN0000000001', 'white', '{"engine": "455"}');
INSERT INTO public.vehicle_contributors (vehicle_id, user_id, role, can_edit)
  VALUES ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'mechanic', true);
INSERT INTO public.observation_sources (slug, display_name, category) VALUES ('owner-input', 'Owner input', 'owner');
INSERT INTO public.vehicle_observations (vehicle_id, observed_at, source_id, source_identifier, kind, content_text, content_hash)
  SELECT '10000000-0000-0000-0000-000000000001', now() - interval '1 day', id, 'fixture', 'specification',
    'Numbers-matching block per the seller', 'h1' FROM public.observation_sources WHERE slug = 'owner-input';

-- Grants: the service-role writers are not executable by anon or authenticated.
SELECT pg_temp.ok('anon cannot execute ' || f, NOT has_function_privilege('anon', f, 'EXECUTE')),
       pg_temp.ok('authenticated cannot execute ' || f, NOT has_function_privilege('authenticated', f, 'EXECUTE')),
       pg_temp.ok('service_role can execute ' || f, has_function_privilege('service_role', f, 'EXECUTE'))
  FROM unnest(ARRAY['public.contributor_intake_open(text,jsonb)', 'public.contributor_intake_answer(text,text,text,jsonb,uuid)',
    'public.contributor_intake_file(text,jsonb)']) f;
SELECT pg_temp.ok('anon cannot execute ' || f, NOT has_function_privilege('anon', f, 'EXECUTE')),
       pg_temp.ok('authenticated can execute ' || f, has_function_privilege('authenticated', f, 'EXECUTE'))
  FROM unnest(ARRAY['public.create_contributor_invite(uuid,text,text,text,integer,uuid)',
    'public.set_contributor_intake_questions(uuid,jsonb,uuid)', 'public.get_contributor_intake(uuid,uuid)',
    'public.revoke_contributor_invite(uuid,uuid)']) f;
SELECT pg_temp.ok('internal helper closed: ' || f, NOT has_function_privilege('anon', f, 'EXECUTE')
    AND NOT has_function_privilege('authenticated', f, 'EXECUTE'))
  FROM unnest(ARRAY['public.contributor_intake_can_manage(uuid,uuid)', 'public.contributor_intake_invite_for_token(text)',
    'public.contributor_intake_actor(uuid)']) f;
SELECT pg_temp.ok('every writer is SECURITY DEFINER with a pinned search_path',
  (SELECT bool_and(p.prosecdef AND p.proconfig::text LIKE '%search_path=public%') FROM pg_proc p
    WHERE p.proname IN ('create_contributor_invite', 'contributor_intake_open', 'contributor_intake_answer',
      'contributor_intake_file', 'set_contributor_intake_questions', 'get_contributor_intake', 'revoke_contributor_invite')));
SELECT pg_temp.ok('anon has no table access', NOT has_table_privilege('anon', 'public.vehicle_contributor_invites', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.contributor_intake_questions', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.vehicle_contributor_invite_visits', 'SELECT'));

-- Owner-only on create, set questions and read.
SET test.auth_uid = '00000000-0000-0000-0000-00000000000c';
SELECT pg_temp.ok('a stranger cannot invite', pg_temp.raises(
  $q$SELECT public.create_contributor_invite('10000000-0000-0000-0000-000000000001', 'Sam', 'builder')$q$));
SELECT pg_temp.ok('a stranger cannot set questions', pg_temp.raises(
  $q$SELECT public.set_contributor_intake_questions('10000000-0000-0000-0000-000000000001', '[]')$q$));
SELECT pg_temp.ok('a stranger cannot read the intake', pg_temp.raises(
  $q$SELECT public.get_contributor_intake('10000000-0000-0000-0000-000000000001')$q$));
SET test.auth_uid = '00000000-0000-0000-0000-00000000000a';
SELECT pg_temp.ok('relationship is checked', pg_temp.raises(
  $q$SELECT public.create_contributor_invite('10000000-0000-0000-0000-000000000001', 'Sam', 'friend')$q$));

CREATE TEMP TABLE inv AS SELECT public.create_contributor_invite('10000000-0000-0000-0000-000000000001', 'Sam',
  'builder', '+1 (000) 000-0000') AS r;
GRANT ALL ON inv TO PUBLIC;
SELECT pg_temp.ok('the invite returns a 64-hex token and its path', (r ->> 'token') ~ '^[0-9a-f]{64}$'
  AND r ->> 'path' = '/contribute/' || (r ->> 'token')) FROM inv;
SELECT pg_temp.ok('only the token hash is stored', i.token_hash = encode(sha256(convert_to(r ->> 'token', 'UTF8')), 'hex')
  AND NOT EXISTS (SELECT 1 FROM public.vehicle_contributor_invites x WHERE x.token_hash = r ->> 'token'))
  FROM inv, public.vehicle_contributor_invites i WHERE i.id = (r ->> 'invite_id')::uuid;
SELECT pg_temp.ok('the person is one external identity with a phone hash, never the number',
  e.platform = 'contributor' AND e.handle = r ->> 'invite_id' AND e.display_name = 'Sam'
  AND e.metadata ->> 'phone_sha256' ~ '^[0-9a-f]{64}$' AND e.metadata::text NOT LIKE '%(000)%' AND e.metadata::text NOT LIKE '%10000000000%'
  AND c.contributor_type = 'identity' AND c.verification_level = 'invited')
  FROM inv, public.contributors c JOIN public.external_identities e ON e.id = c.external_identity_id
  WHERE c.id = (r ->> 'contributor_id')::uuid;
SET test.auth_uid = '00000000-0000-0000-0000-00000000000b';
CREATE TEMP TABLE inv2 AS SELECT public.create_contributor_invite('10000000-0000-0000-0000-000000000001', 'sam',
  'builder', NULL, 1) AS r;
SELECT pg_temp.ok('an editor can invite, and the same name on this vehicle reuses the person',
  (inv2.r ->> 'contributor_id') = (inv.r ->> 'contributor_id') AND (SELECT count(*) FROM public.contributors) = 1)
  FROM inv, inv2;

SET test.auth_uid = '00000000-0000-0000-0000-00000000000a';
SELECT pg_temp.ok('questions upsert by key', (public.set_contributor_intake_questions('10000000-0000-0000-0000-000000000001',
  '[{"key":"engine_build","prompt":"Who built the engine, and when?","hint":"Shop name and year"},
    {"key":"paint","prompt":"What paint and when?"},
    {"key":"receipts","prompt":"Do you have receipts?","round":2}]') ->> 'upserted')::int = 3);
SELECT public.set_contributor_intake_questions('10000000-0000-0000-0000-000000000001',
  '[{"key":"engine_build","prompt":"Who built the 455, and when?"}]');
SELECT pg_temp.ok('a second upsert edits the prompt, no second row', (SELECT count(*) FROM public.contributor_intake_questions) = 3
  AND (SELECT prompt FROM public.contributor_intake_questions WHERE key = 'engine_build') = 'Who built the 455, and when?');
RESET test.auth_uid;

-- Open: the card, the visit and the counters.
CREATE TEMP TABLE dev AS SELECT '{"user_agent":"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)","platform":"iOS",
  "screen":{"w":393,"h":852,"dpr":3},"timezone":"America/Los_Angeles","language":"en-US",
  "ip_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","ip":"must-be-dropped"}'::jsonb AS d;
CREATE TEMP TABLE card AS SELECT public.contributor_intake_open(inv.r ->> 'token', dev.d) AS c FROM inv, dev;
SELECT pg_temp.ok('open returns the car card', c ->> 'ok' = 'true' AND c ->> 'invite_id' = inv.r ->> 'invite_id' AND c #>> '{vehicle,vin}' = 'TESTVIN0000000001'
  AND c #>> '{vehicle,body,engine}' = '455' AND c #>> '{contributor,display_name}' = 'Sam'
  AND c #>> '{contributor,relationship}' = 'builder') FROM card, inv;
SELECT pg_temp.ok('open lists known facts, round one and round two', jsonb_array_length(c -> 'known_facts') = 1
  AND jsonb_array_length(c -> 'questions') = 2 AND jsonb_array_length(c -> 'round_two') = 1
  AND (c ->> 'documents_count')::int = 0) FROM card;
SELECT pg_temp.ok('open bumps counters and records the attestation without the ip',
  i.open_count = 1 AND i.first_opened_at IS NOT NULL AND v.action = 'open' AND v.device ->> 'platform' = 'iOS'
  AND v.device ->> 'ip_sha256' LIKE 'aaaa%' AND NOT v.device ? 'ip')
  FROM inv, public.vehicle_contributor_invites i JOIN public.vehicle_contributor_invite_visits v ON v.invite_id = i.id
  WHERE i.id = (inv.r ->> 'invite_id')::uuid;

-- Refusals share one shape.
SELECT pg_temp.ok('unknown token: not_found', public.contributor_intake_open(repeat('0', 64), '{}') = '{"ok": false, "error": "not_found"}');
SELECT pg_temp.ok('malformed token: not_found', public.contributor_intake_open('nope', '{}') = '{"ok": false, "error": "not_found"}');
UPDATE public.vehicle_contributor_invites SET expires_at = now() - interval '1 second' WHERE id = (SELECT (r ->> 'invite_id')::uuid FROM inv2);
SELECT pg_temp.ok('expired token: not_found', public.contributor_intake_open(r ->> 'token', '{}') = '{"ok": false, "error": "not_found"}'
  AND public.contributor_intake_answer(r ->> 'token', 'paint', 'x', '{}') = '{"ok": false, "error": "not_found"}') FROM inv2;
SET test.auth_uid = '00000000-0000-0000-0000-00000000000a';
CREATE TEMP TABLE inv3 AS SELECT public.create_contributor_invite('10000000-0000-0000-0000-000000000001', 'Pat', 'shop') AS r;
SELECT public.revoke_contributor_invite((r ->> 'invite_id')::uuid) FROM inv3;
RESET test.auth_uid;
SELECT pg_temp.ok('revoked token: not_found', public.contributor_intake_open(r ->> 'token', '{}') = '{"ok": false, "error": "not_found"}'
  AND public.contributor_intake_file(r ->> 'token', '{}') = '{"ok": false, "error": "not_found"}') FROM inv3;

-- Answer: one observation row with the attestation and the contributor.
CREATE TEMP TABLE ans AS SELECT public.contributor_intake_answer(inv.r ->> 'token', 'engine_build',
  'Built it myself in 2019 with a 455 HO crank.', dev.d) AS a FROM inv, dev;
SELECT pg_temp.ok('answer returns the observation id', a ->> 'ok' = 'true' AND a ->> 'observation_id' IS NOT NULL) FROM ans;
SELECT pg_temp.ok('the answer row carries the source, the observer, the attestation and the contributor',
  o.kind = 'contributor_answer' AND s.slug = 'contributor_link' AND o.observer_id = c.external_identity_id
  AND o.structured_data ->> 'contributor_id' = inv.r ->> 'contributor_id'
  AND o.structured_data ->> 'question_key' = 'engine_build'
  AND o.structured_data ->> 'prompt' = 'Who built the 455, and when?'
  AND o.structured_data ->> 'answer_text' = 'Built it myself in 2019 with a 455 HO crank.'
  AND o.structured_data ->> 'channel' = 'contributor_link'
  AND o.structured_data #>> '{device_attestation,model_hint}' IS NULL
  AND (o.structured_data #>> '{device_attestation,screen,dpr}')::int = 3
  AND o.submitted_by_user_id IS NULL)
  FROM ans, inv, public.vehicle_observations o JOIN public.observation_sources s ON s.id = o.source_id
  CROSS JOIN public.contributors c
  WHERE o.id = (ans.a ->> 'observation_id')::uuid AND c.id = (inv.r ->> 'contributor_id')::uuid;
SELECT pg_temp.ok('the question is answered and the contributor attested',
  (SELECT status FROM public.contributor_intake_questions WHERE key = 'engine_build') = 'answered'
  AND (SELECT verification_level FROM public.contributors c, inv WHERE c.id = (inv.r ->> 'contributor_id')::uuid) = 'attested'
  AND (SELECT verification_level FROM public.contributors c, inv3 WHERE c.id = (inv3.r ->> 'contributor_id')::uuid) = 'invited');
SELECT pg_temp.ok('the same answer again is the same row',
  (public.contributor_intake_answer(inv.r ->> 'token', 'engine_build', 'Built it myself in 2019 with a 455 HO crank.', dev.d)
    ->> 'observation_id') = ans.a ->> 'observation_id') FROM inv, dev, ans;
CREATE TEMP TABLE ans2 AS SELECT public.contributor_intake_answer(inv.r ->> 'token', 'engine_build',
  'Built it in 2018, not 2019.', dev.d, '00000000-0000-0000-0000-00000000000a') AS a FROM inv, dev;
SELECT pg_temp.ok('a changed answer supersedes and keeps the original',
  (SELECT is_superseded AND superseded_by = (ans2.a ->> 'observation_id')::uuid FROM public.vehicle_observations
    WHERE id = (ans.a ->> 'observation_id')::uuid)
  AND (SELECT submitted_by_user_id FROM public.vehicle_observations WHERE id = (ans2.a ->> 'observation_id')::uuid)
    = '00000000-0000-0000-0000-00000000000a'
  AND (SELECT count(*) FROM public.vehicle_observations WHERE kind = 'contributor_answer') = 2) FROM ans, ans2;
SELECT pg_temp.ok('a non-owner cannot be the recorder', public.contributor_intake_answer(inv.r ->> 'token', 'paint', 'x', '{}',
  '00000000-0000-0000-0000-00000000000c') = '{"ok": false, "error": "not_found"}') FROM inv;
SELECT pg_temp.ok('an unknown question is refused', public.contributor_intake_answer(inv.r ->> 'token', 'nope', 'x', '{}')
  ->> 'error' = 'unknown_question') FROM inv;

-- File: one vehicle_images row, its device attribution, dedupe on sha256.
CREATE TEMP TABLE f AS SELECT jsonb_build_object(
  'storage_path', 'vehicle-photos/contributors/' || (inv.r ->> 'invite_id') || '/' || repeat('b', 64) || '/build-sheet.jpg',
  'image_url', 'https://example.test/storage/v1/object/public/vehicle-photos/contributors/x/build-sheet.jpg',
  'file_name', 'build-sheet.jpg', 'mime_type', 'image/jpeg', 'size_bytes', 123456, 'sha256', repeat('b', 64),
  'exif', '{"Make":"Apple","Model":"iPhone 15 Pro","Software":"18.0"}'::jsonb, 'device', dev.d, 'label', 'Build sheet') AS p
  FROM inv, dev;
CREATE TEMP TABLE up AS SELECT public.contributor_intake_file(inv.r ->> 'token', f.p) AS u FROM inv, f;
SELECT pg_temp.ok('the file lands', u ->> 'ok' = 'true' AND u ->> 'duplicate' = 'false') FROM up;
SELECT pg_temp.ok('the image row is a contributor-link import', vi.source = 'contributor_link' AND vi.ingest_kind = 'import'
  AND vi.image_medium = 'received' AND vi.file_hash = repeat('b', 64) AND vi.user_id IS NULL AND vi.ghost_user_id IS NOT NULL
  AND vi.caption = 'Build sheet')
  FROM up, public.vehicle_images vi WHERE vi.id = (up.u ->> 'image_id')::uuid;
SELECT pg_temp.ok('the device attribution points at the contributor', da.contributor_id = (inv.r ->> 'contributor_id')::uuid
  AND da.device_fingerprint = 'Apple-iPhone 15 Pro-Unknown-18.0' AND da.ghost_user_id IS NOT NULL)
  FROM up, inv, public.device_attributions da WHERE da.image_id = (up.u ->> 'image_id')::uuid;
SELECT pg_temp.ok('a repeated sha256 is a duplicate and no second row',
  (public.contributor_intake_file(inv.r ->> 'token', f.p) -> 'duplicate')::boolean
  AND (SELECT count(*) FROM public.vehicle_images) = 1) FROM inv, f;
CREATE TEMP TABLE up2 AS SELECT public.contributor_intake_file(inv.r ->> 'token', jsonb_set(jsonb_set(jsonb_set(f.p,
  '{sha256}', to_jsonb(repeat('c', 64))), '{storage_path}',
  to_jsonb('contributors/' || (inv.r ->> 'invite_id') || '/' || repeat('c', 64) || '/note.pdf')), '{exif}', '{}')) AS u
  FROM inv, f;
SELECT pg_temp.ok('a file without EXIF still gets its contributor attribution', up2.u ->> 'duplicate' = 'false'
  AND da.attribution_source = 'contributor_link' AND da.device_fingerprint = 'contributor_link:' || (inv.r ->> 'contributor_id')
  AND da.contributor_id = (inv.r ->> 'contributor_id')::uuid)
  FROM up2, inv, public.device_attributions da WHERE da.image_id = (up2.u ->> 'image_id')::uuid;
SELECT pg_temp.ok('the duplicate call wrote no second row', (SELECT count(*) FROM public.vehicle_images) = 2);
SELECT pg_temp.ok('a non-owner recorder on a file is not_found', public.contributor_intake_file(inv.r ->> 'token',
  f.p || '{"recorded_by":"00000000-0000-0000-0000-00000000000c"}') = '{"ok": false, "error": "not_found"}') FROM inv, f;
SELECT pg_temp.ok('a path outside this invite is refused', public.contributor_intake_file(inv.r ->> 'token',
  jsonb_set(f.p, '{storage_path}', '"contributors/someone-else/x.jpg"')) ->> 'error' = 'invalid_storage_path') FROM inv, f;

-- Documents: a title goes to the private bucket, sensitive, with no object URL; a photo stays public.
CREATE TEMP TABLE title AS SELECT public.contributor_intake_file(inv.r ->> 'token', jsonb_build_object(
  'bucket', 'ownership-documents', 'is_sensitive', true,
  'storage_path', 'contributors/' || (inv.r ->> 'invite_id') || '/' || repeat('d', 64) || '/title.jpg',
  'image_url', 'https://example.test/should-not-be-kept.jpg', 'file_name', 'title.jpg', 'mime_type', 'image/jpeg',
  'size_bytes', 1000, 'sha256', repeat('d', 64), 'label', 'Title')) AS u FROM inv;
SELECT pg_temp.ok('a title lands sensitive in ownership-documents with no object URL', t.u ->> 'duplicate' = 'false'
  AND vi.is_sensitive AND vi.sensitive_type = 'document' AND vi.image_url = ''
  AND vi.storage_path = 'ownership-documents/contributors/' || (inv.r ->> 'invite_id') || '/' || repeat('d', 64) || '/title.jpg')
  FROM title t, inv, public.vehicle_images vi WHERE vi.id = (t.u ->> 'image_id')::uuid;
SELECT pg_temp.ok('a build photo lands not sensitive in vehicle-photos', NOT vi.is_sensitive AND vi.sensitive_type IS NULL
  AND vi.storage_path LIKE 'contributors/%' AND vi.image_url LIKE 'https://%')
  FROM up, public.vehicle_images vi WHERE vi.id = (up.u ->> 'image_id')::uuid;
SELECT pg_temp.ok('a sensitive file in the public bucket is refused', public.contributor_intake_file(inv.r ->> 'token',
  f.p || '{"is_sensitive": true}') ->> 'error' = 'bucket_sensitivity_mismatch'
  AND public.contributor_intake_file(inv.r ->> 'token', f.p || '{"bucket": "ownership-documents"}') ->> 'error'
    = 'bucket_sensitivity_mismatch'
  AND public.contributor_intake_file(inv.r ->> 'token', f.p || '{"bucket": "vehicles"}') ->> 'error' = 'invalid_bucket') FROM inv, f;
CREATE TEMP TABLE rec AS SELECT public.contributor_intake_file(inv.r ->> 'token', jsonb_set(jsonb_set(f.p, '{sha256}',
  to_jsonb(repeat('e', 64))), '{storage_path}', to_jsonb('contributors/' || (inv.r ->> 'invite_id') || '/' || repeat('e', 64)
  || '/frame.jpg')) || '{"recorded_by": "00000000-0000-0000-0000-00000000000b"}') AS u FROM inv, f;
SELECT pg_temp.ok('an editor recorded on a file lands as submitted_by', vi.submitted_by = '00000000-0000-0000-0000-00000000000b')
  FROM rec, public.vehicle_images vi WHERE vi.id = (rec.u ->> 'image_id')::uuid;

-- Read: everything round-trips to the owner.
SET test.auth_uid = '00000000-0000-0000-0000-00000000000a';
CREATE TEMP TABLE rd AS SELECT public.get_contributor_intake('10000000-0000-0000-0000-000000000001') AS g;
SELECT pg_temp.ok('the read has the invites with visits and no token hash', jsonb_array_length(g -> 'invites') = 3
  AND g::text NOT LIKE '%token_hash%' AND jsonb_array_length(g #> '{invites,0,visits}') >= 4) FROM rd;
SELECT pg_temp.ok('the read has both answers with attestation', jsonb_array_length(g -> 'answers') = 2
  AND g #>> '{answers,0,device_attestation,platform}' = 'iOS' AND jsonb_array_length(g -> 'visits') >= 4) FROM rd;
SELECT pg_temp.ok('the read never returns an object URL for a sensitive row', NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(g -> 'uploads') x WHERE (x ->> 'is_sensitive')::boolean AND x ->> 'image_url' IS NOT NULL)
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(g -> 'uploads') x WHERE x ->> 'bucket' = 'ownership-documents'
    AND x ->> 'storage_path' LIKE 'ownership-documents/%')
  AND g::text NOT LIKE '%should-not-be-kept%') FROM rd;
SELECT pg_temp.ok('the read has the uploads with their contributor', jsonb_array_length(g -> 'uploads') = 4
  AND g #>> '{uploads,0,contributor_id}' = inv.r ->> 'contributor_id') FROM rd, inv;
RESET test.auth_uid;
SELECT pg_temp.ok('the reopened card counts documents and shows the answer',
  ((public.contributor_intake_open(inv.r ->> 'token', dev.d)) ->> 'documents_count')::int = 4
  AND (public.contributor_intake_open(inv.r ->> 'token', dev.d)) #>> '{questions,0,answer}' = 'Built it in 2018, not 2019.')
  FROM inv, dev;

-- An agent holding the service role acts for the owner; never for a stranger; never without the service role.
RESET test.auth_uid;
SELECT pg_temp.ok('the old single-actor signatures are gone', NOT EXISTS (SELECT 1 FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND (p.proname, pg_get_function_identity_arguments(p.oid)) IN
    (('create_contributor_invite', 'p_vehicle_id uuid, p_display_name text, p_relationship text, p_phone text, p_expires_days integer'),
     ('set_contributor_intake_questions', 'p_vehicle_id uuid, p_questions jsonb'),
     ('get_contributor_intake', 'p_vehicle_id uuid'), ('revoke_contributor_invite', 'p_invite_id uuid'))));
SELECT pg_temp.ok('without a session or the service role, acting-as is refused', pg_temp.raises(
  $q$SELECT public.create_contributor_invite('10000000-0000-0000-0000-000000000001', 'Agent Invite', 'shop', NULL, 30,
    '00000000-0000-0000-0000-00000000000a')$q$));
SET request.jwt.claims = '{"role":"service_role"}';
SELECT pg_temp.ok('the service role cannot act for a stranger', pg_temp.raises(
  $q$SELECT public.create_contributor_invite('10000000-0000-0000-0000-000000000001', 'Agent Invite', 'shop', NULL, 30,
    '00000000-0000-0000-0000-00000000000c')$q$));
SELECT pg_temp.ok('the service role with no acting-as is refused', pg_temp.raises(
  $q$SELECT public.set_contributor_intake_questions('10000000-0000-0000-0000-000000000001', '[]')$q$));
CREATE TEMP TABLE inv_agent AS SELECT public.create_contributor_invite('10000000-0000-0000-0000-000000000001', 'Agent Invite',
  'shop', NULL, 30, '00000000-0000-0000-0000-00000000000a') AS r;
GRANT ALL ON inv_agent TO PUBLIC;
SELECT pg_temp.ok('the service role acting for the owner mints a link recorded as the owner', (r ->> 'token') ~ '^[0-9a-f]{64}$'
  AND (SELECT created_by FROM public.vehicle_contributor_invites WHERE id = (r ->> 'invite_id')::uuid)
      = '00000000-0000-0000-0000-00000000000a') FROM inv_agent;
SELECT pg_temp.ok('the service role acting for the owner seeds questions',
  (public.set_contributor_intake_questions('10000000-0000-0000-0000-000000000001',
    '[{"key":"agent_q","prompt":"Seeded by an agent"}]', '00000000-0000-0000-0000-00000000000a') ->> 'upserted') = '1');
SELECT pg_temp.ok('the seeded question records the owner, not the agent',
  (SELECT created_by FROM public.contributor_intake_questions WHERE key = 'agent_q') = '00000000-0000-0000-0000-00000000000a');
SELECT pg_temp.ok('the service role acting for the owner reads the intake',
  jsonb_array_length(public.get_contributor_intake('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a') -> 'invites') >= 2);
SELECT pg_temp.ok('the service role acting for the owner revokes',
  (public.revoke_contributor_invite((r ->> 'invite_id')::uuid, '00000000-0000-0000-0000-00000000000a') ->> 'revoked')::boolean) FROM inv_agent;
SET test.auth_uid = '00000000-0000-0000-0000-00000000000c';
SELECT pg_temp.ok('a signed-in stranger cannot borrow the owner through acting-as even with the service role claim', pg_temp.raises(
  $q$SELECT public.get_contributor_intake('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a')$q$));
RESET test.auth_uid;
RESET request.jwt.claims;
