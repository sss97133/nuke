-- Contract: 20261125043000. capture_sets_score reads presence bounds (user_presence_blocks' body) as a scored signal.
-- On the set's local day, outside the set's own span, a roster car with a filed block is present (+0.5 / cars in work),
-- another roster car's block makes the rest absent (-0.3), and no block is unknown (0). Cases:
--   D1 tie between two same-model cars, one filed later that day      -> that one ranks first, 'presence' named in signals
--   D2 tie, the only block that day is a filed sibling inside the set  -> unknown: every score equals the parent scorer's
--   D3 tie, a third car filed earlier that day                         -> both candidates absent, each lowered by 0.3
--   D4 same-model read with year and colour, one car filed that day    -> plan step clears it (a photo leg plus presence)
--   D5 two roster cars filed that day                                  -> the present one gets +0.25, the other candidate -0.3
--   (D2 clears in the plan step on its filed sibling, as it did before; presence takes no part)
--   presence is the only positive signal (stub scorer)                 -> review, presence_only; never clear
--   presence + priors past score and margin, no photo leg (stub)       -> review, priors_only
--   strip mode, a protected car (and a set a protected car leads), the p_only_imgs re-check with null dates, no JWT claims (pg_cron) all work
--   user_presence_blocks keeps its guard and returns the core's rows; the core is not executable by API roles
--   replay is a no-op; the revert restores the three production bodies by md5 and drops the core.
-- The parent bodies are production's of 2026-11-24, installed from the revert file. Disposable PG17 only, synthetic rows.
\set ON_ERROR_STOP on
SET client_min_messages = notice;
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR current_setting('server_version_num')::int / 10000 <> 17
    OR EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','p','v','m')) THEN
    RAISE EXCEPTION 'Refusing fixtures outside an empty disposable PG17 database (dm_refinement_*)';
  END IF;
END $$;
SET statement_timeout = '120s';
SET lock_timeout = '3s';
SET TIME ZONE 'UTC';
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $$;
GRANT USAGE ON SCHEMA auth TO PUBLIC;
CREATE FUNCTION pg_temp.ok(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF; RAISE NOTICE 'PASS %', label; END $$;
CREATE FUNCTION pg_temp.as_claims(sub text, role text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', coalesce(jsonb_strip_nulls(jsonb_build_object('sub', nullif(sub, ''), 'role', role))::text, ''), false) $$;

-- ===== stand-ins: the columns capture_sets_score, capture_landing_plan_step and the presence readers read
-- guardrail-allow(center-key-fk): vehicles: disposable PG17 stand-in of a live table; only the columns the scorer reads
-- guardrail-allow(center-key-fk): vehicle_images: disposable PG17 stand-in of a live table; only the columns the scorer reads
-- guardrail-allow(center-key-fk): image_observations: disposable PG17 stand-in of a live table; only the columns the scorer reads
-- guardrail-allow(center-key-fk): capture_document_pages: disposable PG17 stand-in of a live table; only the columns the scorer reads
-- guardrail-allow(center-key-fk): capture_set_links: disposable PG17 stand-in of a live table; only the columns the scorer reads
-- guardrail-allow(center-key-fk): reattribution_audit: disposable PG17 stand-in of a live table; only the columns the scorer reads
-- guardrail-allow(center-key-fk): auto_filing_audit_queue: disposable PG17 stand-in of a live table; only the columns the scorer reads
-- guardrail-allow(center-key-fk): work_sessions: disposable PG17 stand-in of a live table; only the columns the scorer reads
-- guardrail-allow(center-key-fk): vehicle_identifier_observations: disposable PG17 stand-in of a live table; only the columns the scorer reads
-- guardrail-allow(center-key-fk): image_text_reads: disposable PG17 stand-in of a live table; only the columns the scorer reads
-- guardrail-allow(center-key-fk): capture_landing_sets: disposable PG17 stand-in of a live table; only the columns the scorer reads
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, make text, model text, year int, color text, vin text, license_plate text,
  owner_id uuid, user_id uuid, uploaded_by uuid, deleted_at timestamptz, merged_into_vehicle_id uuid, status text DEFAULT 'active');
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid, source text DEFAULT 'iphoto',
  taken_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), latitude numeric, longitude numeric,
  vehicle_vin text, vehicle_vin_confidence numeric, is_document boolean, doc_flag boolean, is_duplicate boolean,
  is_superseded boolean, is_sensitive boolean, vision_gate_status text, ai_scan_metadata jsonb,
  ai_processing_status text DEFAULT 'completed', image_url text DEFAULT 'x.jpg', exif_data jsonb, merged_from_vehicle_id uuid);
CREATE TABLE public.image_observations(image_id uuid, vehicle_id uuid, is_active boolean, observed_by text,
  observed_at timestamptz, embedding_clip_vitb32 float8[]);
CREATE FUNCTION public.t_cos_dist(a float8[], b float8[]) RETURNS float8 LANGUAGE sql IMMUTABLE AS $$ SELECT 1.0::float8 $$;
CREATE OPERATOR public.<=> (LEFTARG = float8[], RIGHTARG = float8[], FUNCTION = public.t_cos_dist);
CREATE TABLE public.capture_document_pages(image_id uuid, revoked_at timestamptz);
CREATE TABLE public.capture_set_links(run_id uuid, image_id uuid, vehicle_id uuid, reverted_at timestamptz);
CREATE TABLE public.reattribution_audit(new_observation_id uuid, new_vehicle_id uuid, actor_user_id uuid, observation_type text, reason text);
CREATE TABLE public.filing_run_gate(run_id text, passed boolean);
CREATE TABLE public.auto_filing_audit_queue(id bigint GENERATED ALWAYS AS IDENTITY, image_id uuid, vehicle_id uuid, source text,
  run_id text, status text, reason text, verified_at timestamptz);
CREATE TABLE public.work_sessions(id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid, start_time timestamptz, end_time timestamptz,
  status text, owner_confirmed_at timestamptz, metadata jsonb, session_type text);
CREATE TABLE public.vehicle_identifier_observations(id uuid PRIMARY KEY, image_id uuid, user_id uuid, kind text, value_norm text,
  status text, confidence numeric);
CREATE TABLE public.image_text_reads(image_id uuid, revoked_at timestamptz, lines jsonb, vin_candidates jsonb);
CREATE TABLE public.vehicle_model_aliases(alias_norm text, family text);
CREATE TABLE public.user_sites(user_id uuid, lat double precision, lon double precision, radius_m integer);
CREATE TABLE public.user_profiles(user_id uuid PRIMARY KEY, timezone text);
CREATE TABLE public.capture_landing_config(id int PRIMARY KEY DEFAULT 1 CHECK (id = 1), user_id uuid NOT NULL,
  min_score numeric NOT NULL DEFAULT 2.5, min_margin numeric NOT NULL DEFAULT 1.0,
  protected_vehicle_ids uuid[] NOT NULL DEFAULT '{}'::uuid[], updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.capture_landing_chunks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), track text NOT NULL DEFAULT 'manual',
  pass int NOT NULL DEFAULT 1, user_id uuid NOT NULL, t_from timestamptz NOT NULL, t_to timestamptz NOT NULL,
  dry boolean NOT NULL DEFAULT false, state text NOT NULL DEFAULT 'planning', run_id uuid NOT NULL DEFAULT gen_random_uuid(),
  plan_cursor timestamptz, stats jsonb NOT NULL DEFAULT '{}'::jsonb, note text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.capture_landing_sets(chunk_id uuid NOT NULL REFERENCES capture_landing_chunks(id) ON DELETE CASCADE,
  set_key text NOT NULL, t0 timestamptz NOT NULL, t1 timestamptz NOT NULL, vehicle_id uuid, image_ids uuid[] NOT NULL,
  filed_ids uuid[] NOT NULL DEFAULT '{}', cells text[] NOT NULL DEFAULT '{}', score numeric, margin numeric,
  decision text NOT NULL CHECK (decision IN ('clear','review')), reason text, top3 jsonb, applied_at timestamptz,
  apply_result text, PRIMARY KEY (chunk_id, set_key));
CREATE TABLE public.capture_set_review(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, set_key text,
  image_ids uuid[] NOT NULL, status text NOT NULL DEFAULT 'open');
-- helpers as live (vin_match_key, capture_set_photo_sources, capture_landing_has_photo_evidence) or narrowed to what
-- the fixture needs (family = the model's lower-case name, every iphoto row admitted, no identity conflicts)
CREATE FUNCTION public.vin_match_key(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(translate(regexp_replace(upper(coalesce(p, '')), '[^A-Z0-9]', '', 'g'), 'OQISBZG', '0015826'), '') $$;
CREATE FUNCTION public.vehicle_model_family(p_make text, p_model text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(lower(btrim(coalesce(p_model, ''))), '') $$;
CREATE FUNCTION public.capture_set_photo_sources() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['capture_relay_ios', 'iphoto', 'iphoto_60d', 'photo_auto_sync', 'library_recovery'] $$;
CREATE FUNCTION public.capture_set_photo_admits(p_source text, p_vehicle_id uuid, p_exif jsonb) RETURNS boolean
  LANGUAGE sql IMMUTABLE AS $$ SELECT p_source = ANY (public.capture_set_photo_sources()) $$;
CREATE FUNCTION public.capture_landing_set_identity_conflict(p_vehicle uuid, p_ids uuid[]) RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.capture_landing_has_photo_evidence(p_signals jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE((p_signals->>'vin')::numeric, 0) > 0 OR COALESCE((p_signals->>'plate')::numeric, 0) > 0
      OR COALESCE((p_signals->>'badge')::numeric, 0) > 0 OR COALESCE((p_signals->>'model')::numeric, 0) > 0
      OR (COALESCE((p_signals->>'visual')::numeric, 0) >= 1.0 AND COALESCE((p_signals->>'visual_margin')::numeric, 0) >= 0.25) $$;

-- ===== fixture. Owner U on Pacific time; cars A (1966 Mustang), B (1968 Mustang), T (a pickup). Filed photos carry no
-- location so the cell signal stays out; the four days are five days apart so the 72 h continuity signals stay out.
INSERT INTO public.user_profiles VALUES ('00000000-0000-4000-8000-0000000000aa', 'America/Los_Angeles');
INSERT INTO public.capture_landing_config(id, user_id) VALUES (1, '00000000-0000-4000-8000-0000000000aa');
INSERT INTO public.vehicles(id, make, model, year, color, owner_id) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'Ford', 'Mustang', 1966, 'red', '00000000-0000-4000-8000-0000000000aa'),
  ('00000000-0000-4000-8000-0000000000b2', 'Ford', 'Mustang', 1968, 'red', '00000000-0000-4000-8000-0000000000aa'),
  ('00000000-0000-4000-8000-0000000000c3', 'Chevrolet', 'K20', 1985, 'blue', '00000000-0000-4000-8000-0000000000aa');
CREATE FUNCTION pg_temp.img(id text, ts text, veh text, fields jsonb) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.vehicle_images(id, user_id, vehicle_id, taken_at, ai_scan_metadata)
  VALUES (id::uuid, '00000000-0000-4000-8000-0000000000aa', veh::uuid, ts::timestamptz,
          jsonb_build_object('classification', jsonb_build_object('image_type', 'vehicle_exterior', 'v2',
                             jsonb_build_object('vehicle_fields', coalesce(fields, '[]'::jsonb))))) $$;
CREATE TEMP TABLE reads AS SELECT
  '[{"field_name":"make","value":"Ford","confidence":0.9},{"field_name":"model","value":"Mustang","confidence":0.9}]'::jsonb mm,
  '[{"field_name":"make","value":"Ford","confidence":0.9},{"field_name":"model","value":"Mustang","confidence":0.9},
    {"field_name":"year","value":"1968","confidence":0.9},{"field_name":"color","value":"red","confidence":0.9}]'::jsonb mmyc;
-- D1 2026-01-05: set at 10:00 PT; B filed at 14:00 PT
SELECT pg_temp.img('00000000-0000-4000-8000-000000000101', '2026-01-05 18:00:00+00', NULL, (SELECT mm FROM reads));
SELECT pg_temp.img('00000000-0000-4000-8000-000000000102', '2026-01-05 18:01:00+00', NULL, (SELECT mm FROM reads));
SELECT pg_temp.img('00000000-0000-4000-8000-000000000109', '2026-01-05 22:00:00+00', '00000000-0000-4000-8000-0000000000b2', NULL);
-- D2 2026-01-10: set at 10:00 PT with a sibling filed on A inside its span; nothing else that day
SELECT pg_temp.img('00000000-0000-4000-8000-000000000201', '2026-01-10 18:00:00+00', NULL, (SELECT mm FROM reads));
SELECT pg_temp.img('00000000-0000-4000-8000-000000000208', '2026-01-10 18:00:30+00', '00000000-0000-4000-8000-0000000000a1', NULL);
SELECT pg_temp.img('00000000-0000-4000-8000-000000000202', '2026-01-10 18:01:00+00', NULL, (SELECT mm FROM reads));
-- D3 2026-01-15: T filed at 08:00 PT, set at 10:00 PT
SELECT pg_temp.img('00000000-0000-4000-8000-000000000309', '2026-01-15 16:00:00+00', '00000000-0000-4000-8000-0000000000c3', NULL);
SELECT pg_temp.img('00000000-0000-4000-8000-000000000301', '2026-01-15 18:00:00+00', NULL, (SELECT mm FROM reads));
SELECT pg_temp.img('00000000-0000-4000-8000-000000000302', '2026-01-15 18:01:00+00', NULL, (SELECT mm FROM reads));
-- D4 2026-01-20: set at 10:00 PT read as a 1968 red Mustang; B filed at 14:00 PT
SELECT pg_temp.img('00000000-0000-4000-8000-000000000401', '2026-01-20 18:00:00+00', NULL, (SELECT mmyc FROM reads));
SELECT pg_temp.img('00000000-0000-4000-8000-000000000402', '2026-01-20 18:01:00+00', NULL, (SELECT mmyc FROM reads));
SELECT pg_temp.img('00000000-0000-4000-8000-000000000409', '2026-01-20 22:00:00+00', '00000000-0000-4000-8000-0000000000b2', NULL);
-- D5 2026-01-25: set at 10:00 PT; B filed at 14:00 PT and T filed at 16:00 PT (two cars in work)
SELECT pg_temp.img('00000000-0000-4000-8000-000000000501', '2026-01-25 18:00:00+00', NULL, (SELECT mm FROM reads));
SELECT pg_temp.img('00000000-0000-4000-8000-000000000502', '2026-01-25 18:01:00+00', NULL, (SELECT mm FROM reads));
SELECT pg_temp.img('00000000-0000-4000-8000-000000000509', '2026-01-25 22:00:00+00', '00000000-0000-4000-8000-0000000000b2', NULL);
SELECT pg_temp.img('00000000-0000-4000-8000-000000000519', '2026-01-26 00:00:00+00', '00000000-0000-4000-8000-0000000000c3', NULL);

-- ===== the parent: production's bodies of 2026-11-24, from the revert file
\ir revert_20261125043000_capture_sets_presence_signal.sql
SELECT pg_temp.ok((SELECT md5(prosrc) FROM pg_proc WHERE proname = 'capture_sets_score') = '75096c1e43e63be82fc2d308cf62ee10'
  AND (SELECT md5(prosrc) FROM pg_proc WHERE proname = 'capture_landing_plan_step') = '6ef112d20600756350a78e4deb0ef93b'
  AND (SELECT md5(prosrc) FROM pg_proc WHERE proname = 'user_presence_blocks') = '1c4ed13a103e8299cf9c5ec64ce43485',
  'parent bodies are the live ones (md5)');

CREATE FUNCTION pg_temp.score_day(d text, p_mode text DEFAULT 'live') RETURNS TABLE(set_key text, vehicle_id uuid, rank int, signals jsonb)
LANGUAGE sql AS $$
  SELECT x.set_key, x.vehicle_id, x.rank, x.signals
    FROM public.capture_sets_score('00000000-0000-4000-8000-0000000000aa', (d || ' 08:00+00')::timestamptz,
                                   (d || ' 08:00+00')::timestamptz + interval '1 day', p_mode, NULL, NULL) x
   WHERE cardinality(x.image_ids) > 0 $$;
CREATE TEMP TABLE days(d text);
INSERT INTO days VALUES ('2026-01-05'), ('2026-01-10'), ('2026-01-15'), ('2026-01-20'), ('2026-01-25');
CREATE TEMP TABLE parent AS SELECT dd.d, s.* FROM days dd CROSS JOIN LATERAL pg_temp.score_day(dd.d) s;
CREATE TEMP TABLE parent_strip AS SELECT dd.d, s.* FROM days dd CROSS JOIN LATERAL pg_temp.score_day(dd.d, 'strip') s;
SELECT pg_temp.ok((SELECT count(*) FROM parent) = 10 AND (SELECT count(DISTINCT set_key) FROM parent) = 5,
  'parent scores five sets with two candidates each');

-- ===== apply
\ir ../migrations/20261125043000_capture_sets_presence_signal.sql
CREATE TEMP TABLE child AS SELECT dd.d, s.* FROM days dd CROSS JOIN LATERAL pg_temp.score_day(dd.d) s;

-- D1: B ranks first by presence, named in signals and cites; A falls by 0.3; nothing else moves
SELECT pg_temp.ok((SELECT vehicle_id FROM parent WHERE d = '2026-01-05' AND rank = 1) = '00000000-0000-4000-8000-0000000000a1'
  AND (SELECT (signals->>'score')::numeric FROM parent WHERE d = '2026-01-05' AND rank = 1)
    = (SELECT (signals->>'score')::numeric FROM parent WHERE d = '2026-01-05' AND rank = 2),
  'D1 parent: dead tie between the two Mustangs, A first by id');
SELECT pg_temp.ok((SELECT vehicle_id FROM child WHERE d = '2026-01-05' AND rank = 1) = '00000000-0000-4000-8000-0000000000b2',
  'D1: the car filed that day (B) ranks first');
SELECT pg_temp.ok((SELECT (signals->>'presence')::numeric = 0.5 AND signals#>>'{cites,presence,state}' = 'present'
                          AND (signals#>>'{cites,presence,cars_in_work}')::int = 1 AND (signals#>>'{cites,presence,photos}')::int = 1
                          AND signals#>>'{cites,presence,day}' = '2026-01-05'
                     FROM child WHERE d = '2026-01-05' AND vehicle_id = '00000000-0000-4000-8000-0000000000b2'),
  'D1: signals name presence +0.5 and cite it (present, 1 car in work, 1 photo, the local day)');
SELECT pg_temp.ok((SELECT (signals->>'presence')::numeric = -0.3 AND signals#>>'{cites,presence,state}' = 'absent'
                     FROM child WHERE d = '2026-01-05' AND vehicle_id = '00000000-0000-4000-8000-0000000000a1'),
  'D1: the other car is absent, -0.3');
SELECT pg_temp.ok(NOT EXISTS (
    SELECT 1 FROM parent p JOIN child c USING (d, set_key, vehicle_id)
     WHERE (c.signals->>'score')::numeric <> round((p.signals->>'score')::numeric + (c.signals->>'presence')::numeric, 3)
        OR (c.signals - 'presence' - 'score' - 'margin_raw' - 'cites') <> (p.signals - 'score' - 'margin_raw' - 'cites')
        OR (c.signals->'cites') - 'presence' <> coalesce(p.signals->'cites', '{}'::jsonb))
  AND (SELECT count(*) FROM child) = (SELECT count(*) FROM parent),
  'every set: new score = parent score + presence; every other signal and cite unchanged; same candidates');

-- D2: unknown. The only block that day is a sibling filed inside the set (sess scores it), so presence is 0 everywhere
SELECT pg_temp.ok((SELECT bool_and((c.signals->>'presence')::numeric = 0 AND NOT (c.signals->'cites' ? 'presence')
                                   AND c.rank = p.rank AND c.signals->>'score' = p.signals->>'score'
                                   AND c.signals->>'margin_raw' = p.signals->>'margin_raw')
                     FROM parent p JOIN child c USING (d, set_key, vehicle_id) WHERE d = '2026-01-10')
  AND (SELECT (signals->>'session')::numeric > 0 FROM child WHERE d = '2026-01-10' AND vehicle_id = '00000000-0000-4000-8000-0000000000a1'),
  'D2 unknown: a filed sibling inside the set is sess, not presence; scores, ranks and margins equal the parent');

-- D3: T was in work, neither candidate was: both lowered by 0.3, order unchanged
SELECT pg_temp.ok((SELECT bool_and((c.signals->>'presence')::numeric = -0.3 AND c.rank = p.rank
                                   AND (c.signals->>'score')::numeric = (p.signals->>'score')::numeric - 0.3)
                     FROM parent p JOIN child c USING (d, set_key, vehicle_id) WHERE d = '2026-01-15')
  AND (SELECT count(*) FROM child WHERE d = '2026-01-15') = 2,
  'D3 absent: another car filed earlier that day lowers both candidates by 0.3; T is not nominated by presence');

-- D4: the photo read leads by 0.4; presence makes it 1.2
SELECT pg_temp.ok((SELECT (signals->>'margin_raw')::numeric FROM parent WHERE d = '2026-01-20' AND rank = 1) = 0.4
  AND (SELECT vehicle_id FROM child WHERE d = '2026-01-20' AND rank = 1) = '00000000-0000-4000-8000-0000000000b2'
  AND (SELECT (signals->>'score')::numeric FROM child WHERE d = '2026-01-20' AND rank = 1) = 2.8
  AND (SELECT (signals->>'margin_raw')::numeric FROM child WHERE d = '2026-01-20' AND rank = 1) = 1.2,
  'D4: model + year + colour lead 2.3 vs 1.9; with presence 2.8 vs 1.6');

-- D5: two cars in work that day: B +0.5 / 2, A absent
SELECT pg_temp.ok((SELECT (signals->>'presence')::numeric = 0.25 AND (signals#>>'{cites,presence,cars_in_work}')::int = 2 AND rank = 1
                     FROM child WHERE d = '2026-01-25' AND vehicle_id = '00000000-0000-4000-8000-0000000000b2')
  AND (SELECT (signals->>'presence')::numeric = -0.3 FROM child WHERE d = '2026-01-25' AND vehicle_id = '00000000-0000-4000-8000-0000000000a1'),
  'D5: two roster cars in work share the present weight (+0.25); the candidate not in work is absent');

-- strip mode: presence off, the parent's strip scores exactly
SELECT pg_temp.ok(NOT EXISTS (
    SELECT 1 FROM parent_strip p FULL JOIN (SELECT dd.d, s.* FROM days dd CROSS JOIN LATERAL pg_temp.score_day(dd.d, 'strip') s) c
      USING (d, set_key, vehicle_id)
     WHERE c.set_key IS NULL OR p.set_key IS NULL OR (c.signals->>'presence')::numeric <> 0
        OR (c.signals - 'presence') - 'mode' <> (p.signals - 'mode')),
  'strip mode: presence 0 and every signal equals the parent strip');

-- capture_sets_apply's re-check: p_only_imgs with null dates reads the days from the set itself
SELECT pg_temp.ok((SELECT x.vehicle_id FROM public.capture_sets_score('00000000-0000-4000-8000-0000000000aa', NULL, NULL, 'live',
                     ARRAY['00000000-0000-4000-8000-000000000101'::uuid, '00000000-0000-4000-8000-000000000102'::uuid]) x
                    WHERE x.rank = 1) = '00000000-0000-4000-8000-0000000000b2',
  'p_only_imgs with null dates: presence read from the set''s own day');

-- no usable time zone: presence unknown, parent scores
UPDATE public.user_profiles SET timezone = 'Not/AZone';
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM parent p JOIN pg_temp.score_day('2026-01-05') c USING (set_key, vehicle_id)
                               WHERE c.signals->>'score' <> p.signals->>'score' OR (c.signals->>'presence')::numeric <> 0),
  'an unknown time zone leaves presence unknown, not an error');
UPDATE public.user_profiles SET timezone = 'America/Los_Angeles';

-- protected: a protected car gets 0 and makes nobody absent; a set it leads is scored as before
UPDATE public.capture_landing_config SET protected_vehicle_ids = ARRAY['00000000-0000-4000-8000-0000000000b2'::uuid];
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM parent p JOIN pg_temp.score_day('2026-01-05') c USING (set_key, vehicle_id)
                               WHERE c.signals->>'score' <> p.signals->>'score' OR c.rank <> p.rank),
  'protected B: presence 0 for B, A not absent, D1 scored as the parent');
UPDATE public.capture_landing_config SET protected_vehicle_ids = ARRAY['00000000-0000-4000-8000-0000000000a1'::uuid];
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM parent p JOIN pg_temp.score_day('2026-01-05') c USING (set_key, vehicle_id)
                               WHERE c.signals->>'score' <> p.signals->>'score' OR c.rank <> p.rank)
  AND (SELECT vehicle_id FROM pg_temp.score_day('2026-01-05') WHERE rank = 1) = '00000000-0000-4000-8000-0000000000a1',
  'protected A leads D1 without presence: the set is scored as the parent (B present does not overtake it)');
UPDATE public.capture_landing_config SET protected_vehicle_ids = ARRAY['00000000-0000-4000-8000-0000000000c3'::uuid];
SELECT pg_temp.ok((SELECT bool_and((c.signals->>'presence')::numeric = 0) FROM pg_temp.score_day('2026-01-15') c),
  'protected T filed that day does not make the candidates absent');
UPDATE public.capture_landing_config SET protected_vehicle_ids = '{}';

-- no JWT claims ran everything above (pg_cron's context). The public reader keeps its guard and returns the core's rows.
SELECT pg_temp.ok(current_setting('request.jwt.claims', true) IS NULL OR current_setting('request.jwt.claims', true) = '',
  'scorer ran with no JWT claims');
DO $$ BEGIN
  PERFORM * FROM public.user_presence_blocks('00000000-0000-4000-8000-0000000000aa', '2026-01-05', '2026-01-20', 'America/Los_Angeles');
  RAISE EXCEPTION 'Contract failed: user_presence_blocks answered a caller with no claims';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS user_presence_blocks refuses no claims (42501)';
END $$;
SELECT pg_temp.as_claims(NULL, 'service_role');
SELECT pg_temp.ok((SELECT array_agg(b ORDER BY b.block_start, b.day) FROM public.user_presence_blocks('00000000-0000-4000-8000-0000000000aa', '2026-01-05', '2026-01-25', 'America/Los_Angeles') b)
  = (SELECT array_agg(b ORDER BY b.block_start, b.day) FROM public.user_presence_blocks_core('00000000-0000-4000-8000-0000000000aa', '2026-01-05', '2026-01-25', 'America/Los_Angeles') b)
  AND (SELECT count(*) FROM public.user_presence_blocks_core('00000000-0000-4000-8000-0000000000aa', '2026-01-05', '2026-01-25', 'America/Los_Angeles')) = 12,
  'user_presence_blocks returns the core''s rows for the service role');
SELECT pg_temp.as_claims(NULL, NULL);
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'public.user_presence_blocks_core(uuid,date,date,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.user_presence_blocks_core(uuid,date,date,text)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.user_presence_blocks_core(uuid,date,date,text)', 'EXECUTE')
  AND NOT (SELECT prosecdef FROM pg_proc WHERE proname = 'user_presence_blocks_core'),
  'the core is not executable by anon, authenticated or service_role, and is not SECURITY DEFINER');

-- ===== replay is a no-op
\ir ../migrations/20261125043000_capture_sets_presence_signal.sql
SELECT pg_temp.ok((SELECT md5(prosrc) FROM pg_proc WHERE proname = 'capture_sets_score') = '9768d71754f7f1a2865e74d5bed5ae2e'
  AND (SELECT md5(prosrc) FROM pg_proc WHERE proname = 'capture_landing_plan_step') = 'fc7eb8b5c30021f5e806efd14a6fa063'
  AND (SELECT md5(prosrc) FROM pg_proc WHERE proname = 'user_presence_blocks') = 'f33a90cb883abf2532419764d7f09aec'
  AND (SELECT md5(prosrc) FROM pg_proc WHERE proname = 'user_presence_blocks_core') = 'b88c842e8e9e934f98f1e85e434a210f'
  AND NOT EXISTS (SELECT 1 FROM child c FULL JOIN (SELECT dd.d, s.* FROM days dd CROSS JOIN LATERAL pg_temp.score_day(dd.d) s) r
                    USING (d, set_key, vehicle_id) WHERE r.signals IS DISTINCT FROM c.signals OR r.rank IS DISTINCT FROM c.rank),
  'replay: same bodies, same scores');

-- ===== the plan step over the four days: D4 clears on B; D1 and D3 stay review; nothing clears without a photo leg
INSERT INTO public.capture_landing_chunks(id, user_id, t_from, t_to)
VALUES ('00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-0000000000aa', '2026-01-05 08:00+00', '2026-01-26 08:00+00');
SELECT public.capture_landing_plan_step('00000000-0000-4000-8000-00000000c001', 600);
SELECT pg_temp.ok((SELECT count(*) FROM capture_landing_sets) = 5
  AND (SELECT decision = 'clear' AND vehicle_id = '00000000-0000-4000-8000-0000000000b2' FROM capture_landing_sets WHERE t0 = '2026-01-20 18:00+00')
  AND (SELECT decision = 'review' AND reason = 'no_clear_lead' AND vehicle_id = '00000000-0000-4000-8000-0000000000b2'
         AND (top3->0->'signals'->>'presence')::numeric = 0.5 FROM capture_landing_sets WHERE t0 = '2026-01-05 18:00+00')
  AND (SELECT decision = 'review' AND reason = 'no_clear_lead' FROM capture_landing_sets WHERE t0 = '2026-01-15 18:00+00')
  AND (SELECT decision = 'clear' AND vehicle_id = '00000000-0000-4000-8000-0000000000a1' AND (top3->0->'signals'->>'presence')::numeric = 0
         FROM capture_landing_sets WHERE t0 = '2026-01-10 18:00+00'),
  'plan step: D4 clear on B (model leg + presence); D1 review on B with presence in top3; D3 review; D2 clears on its filed sibling (sess), presence 0');

-- ===== revert restores the parent bodies and drops the core
\ir revert_20261125043000_capture_sets_presence_signal.sql
SELECT pg_temp.ok((SELECT md5(prosrc) FROM pg_proc WHERE proname = 'capture_sets_score') = '75096c1e43e63be82fc2d308cf62ee10'
  AND (SELECT md5(prosrc) FROM pg_proc WHERE proname = 'capture_landing_plan_step') = '6ef112d20600756350a78e4deb0ef93b'
  AND (SELECT md5(prosrc) FROM pg_proc WHERE proname = 'user_presence_blocks') = '1c4ed13a103e8299cf9c5ec64ce43485'
  AND to_regprocedure('public.user_presence_blocks_core(uuid,date,date,text)') IS NULL
  AND NOT EXISTS (SELECT 1 FROM parent p FULL JOIN (SELECT dd.d, s.* FROM days dd CROSS JOIN LATERAL pg_temp.score_day(dd.d) s) r
                    USING (d, set_key, vehicle_id) WHERE r.signals IS DISTINCT FROM p.signals OR r.rank IS DISTINCT FROM p.rank),
  'revert: production bodies by md5, core dropped, parent scores');

-- ===== re-apply, then the plan step's rule against a stub scorer: presence alone never clears
\ir ../migrations/20261125043000_capture_sets_presence_signal.sql
CREATE OR REPLACE FUNCTION public.capture_sets_score(p_user uuid, p_from timestamptz, p_to timestamptz, p_mode text DEFAULT 'live',
  p_only_imgs uuid[] DEFAULT NULL, p_prov jsonb DEFAULT NULL)
RETURNS TABLE (set_key text, t0 timestamptz, t1 timestamptz, image_ids uuid[], filed_ids uuid[], vehicle_id uuid, rank integer, signals jsonb)
LANGUAGE sql STABLE AS $$
  SELECT * FROM (VALUES
    -- presence is the only positive signal, even at a score past both bars
    ('P_only', '2026-02-01 18:00+00'::timestamptz, '2026-02-01 18:05+00'::timestamptz, ARRAY['00000000-0000-4000-8000-000000000101'::uuid], '{}'::uuid[],
      '00000000-0000-4000-8000-0000000000b2'::uuid, 1,
      '{"score":3.0,"margin_raw":3.0,"presence":3.0,"vin":0,"visual":0,"plate":0,"session":0,"cell":0,"recent":0,"work_session":0,"prev_day":0,"make":0,"model":0,"year":0,"color":0,"badge":0}'::jsonb),
    -- presence + priors past both bars, no photo leg
    ('P_priors', '2026-02-01 19:00+00', '2026-02-01 19:05+00', ARRAY['00000000-0000-4000-8000-000000000102'::uuid], '{}'::uuid[],
      '00000000-0000-4000-8000-0000000000b2'::uuid, 1,
      '{"score":3.0,"margin_raw":3.0,"presence":0.5,"session":2.5,"vin":0,"visual":0,"plate":0,"model":0,"badge":0}'::jsonb),
    -- a photo leg (model) + presence: may clear
    ('P_model', '2026-02-01 20:00+00', '2026-02-01 20:05+00', ARRAY['00000000-0000-4000-8000-000000000201'::uuid], '{}'::uuid[],
      '00000000-0000-4000-8000-0000000000b2'::uuid, 1,
      '{"score":2.8,"margin_raw":1.2,"presence":0.5,"model":1.0,"make":0.6,"year":0.4,"color":0.3,"vin":0,"visual":0,"plate":0,"badge":0}'::jsonb)
  ) AS v(set_key, t0, t1, image_ids, filed_ids, vehicle_id, rank, signals)
  WHERE v.t0 >= p_from AND v.t0 < p_to $$;
INSERT INTO public.capture_landing_chunks(id, user_id, t_from, t_to)
VALUES ('00000000-0000-4000-8000-00000000c002', '00000000-0000-4000-8000-0000000000aa', '2026-02-01 08:00+00', '2026-02-02 08:00+00');
SELECT public.capture_landing_plan_step('00000000-0000-4000-8000-00000000c002', 60);
SELECT pg_temp.ok((SELECT decision = 'review' AND reason = 'presence_only' FROM capture_landing_sets WHERE set_key = 'P_only'),
  'presence as the only positive signal: review, presence_only');
SELECT pg_temp.ok((SELECT decision = 'review' AND reason = 'priors_only' FROM capture_landing_sets WHERE set_key = 'P_priors'),
  'presence + priors with no photo leg: review, priors_only');
SELECT pg_temp.ok((SELECT decision = 'clear' FROM capture_landing_sets WHERE set_key = 'P_model'),
  'a photo leg + presence past both bars: clear');

SELECT 'test_capture_sets_presence_signal: all contracts passed' AS result;
