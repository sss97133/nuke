-- disclaim_vehicle_tie / restore_vehicle_tie (20261122004000). Empty disposable PG17 only.
-- Proves: only importer- or agent-made ties end (automatic contributor rows, permission rows no person granted, system
-- discoveries, the record's user_id/owner_id); stated ties stay and are named; first-hand evidence (own device photos,
-- an approved title, an ownership period, ownership paper, a work order) refuses the call and names itself, writes
-- nothing, and only the signed-in person can force past it; every ended tie has a journal row with its before-image;
-- the vehicle, its photos and evidence are untouched; get_user_garage stops showing the car; ties on a merged duplicate
-- count; a permission row with a NULL grantor (refused by the old check) can be ended and restored; restore puts back
-- what is unchanged and names what is not; callers and grants; re-applying the migration is a no-op.
-- The seeds are a disposable database's rows, never production testimony.
\set ON_ERROR_STOP on
SET client_min_messages = warning;
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 dm_refinement_* database';
  END IF;
END $$;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.auth_uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.auth_role', true), '') $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO authenticated, service_role, anon;

-- The live shapes (2026-11-21), cut to the columns the writer and get_user_garage use; the constraints that bite.
CREATE TABLE public.profiles (id uuid PRIMARY KEY);
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, year integer, make text, model text, trim text, primary_image_url text,
  purchase_price numeric, image_count integer, is_public boolean DEFAULT true, deleted_at timestamptz,
  merged_into_vehicle_id uuid, user_id uuid, owner_id uuid, uploaded_by uuid, updated_at timestamptz DEFAULT now());
CREATE TABLE public.vehicle_contributors (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE, role text NOT NULL,
  start_date date NOT NULL DEFAULT current_date, end_date date, notes text, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), status text,
  CONSTRAINT vehicle_contributors_vehicle_id_user_id_role_key UNIQUE (vehicle_id, user_id, role));
CREATE TABLE public.vehicle_user_permissions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, role text NOT NULL, is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(), granted_by uuid REFERENCES auth.users(id), permissions text[], context text,
  granted_at timestamptz DEFAULT now(), expires_at timestamptz, revoked_at timestamptz, revoked_by uuid REFERENCES auth.users(id));
CREATE UNIQUE INDEX idx_vup_vehicle_user_unique ON public.vehicle_user_permissions (vehicle_id, user_id);
CREATE TABLE public.discovered_vehicles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id), discovery_source text, created_at timestamptz DEFAULT now(),
  is_active boolean DEFAULT true, relationship_type text, notes text, UNIQUE (user_id, vehicle_id));
CREATE TABLE public.ownership_verifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, vehicle_id uuid,
  status text NOT NULL, title_document_url text NOT NULL DEFAULT 'https://x/title.jpg', verification_category text,
  expires_at timestamp);
CREATE TABLE public.vehicle_ownerships (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid NOT NULL,
  owner_profile_id uuid, role text NOT NULL, is_current boolean NOT NULL DEFAULT false, ownership_type text, superseded_at timestamptz);
CREATE TABLE public.vehicle_observations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, kind text,
  submitted_by_user_id uuid, extraction_method text, structured_data jsonb, is_superseded boolean DEFAULT false,
  subject_type text, subject_id uuid);
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid,
  documented_by_user_id uuid, image_url text, created_at timestamptz DEFAULT now(), taken_at timestamptz,
  is_superseded boolean DEFAULT false, is_duplicate boolean DEFAULT false, source text, exif_data jsonb,
  vision_gate_status text, user_confirmed_vehicle boolean, is_document boolean);
CREATE TABLE public.vehicle_documents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, uploaded_by uuid, document_type text);
CREATE TABLE public.work_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, customer_id uuid, quoted_by uuid, status text);
CREATE TABLE public.work_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid, session_date date);
CREATE TABLE public.vehicle_activity (vehicle_id uuid PRIMARY KEY, last_activity_at timestamptz);
CREATE TABLE public.vehicle_class_price (vehicle_id uuid PRIMARY KEY, status text, value numeric);
CREATE FUNCTION public.vehicle_image_gallery_eligible(public.vehicle_images) RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT coalesce(($1).is_document, false) = false $$;

\ir helpers/disclaim_vehicle_tie_live_20261121.sql
CREATE TRIGGER trg_enforce_contributor_evidence BEFORE INSERT OR UPDATE ON public.vehicle_contributors
  FOR EACH ROW EXECUTE FUNCTION public.enforce_contributor_evidence();
CREATE TRIGGER trg_enforce_user_vehicle_evidence BEFORE INSERT OR UPDATE ON public.vehicle_user_permissions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_user_vehicle_evidence();
CREATE TRIGGER trg_stamp_vehicle_permission_grantor BEFORE INSERT OR UPDATE ON public.vehicle_user_permissions
  FOR EACH ROW EXECUTE FUNCTION public.stamp_vehicle_permission_grantor();
REVOKE ALL ON FUNCTION public.get_user_garage(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_garage(uuid) TO authenticated, service_role;

CREATE FUNCTION pg_temp.ok(p boolean, what text) RETURNS void LANGUAGE plpgsql AS
$$ BEGIN IF p IS NOT TRUE THEN RAISE EXCEPTION 'contract failed: %', what; END IF; END $$;
CREATE FUNCTION pg_temp.u(n int) RETURNS uuid LANGUAGE sql AS $$ SELECT ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.as_self(p uuid) RETURNS void LANGUAGE sql AS
$$ SELECT set_config('test.auth_uid', p::text, false), set_config('test.auth_role', 'authenticated', false) $$;
CREATE FUNCTION pg_temp.as_service() RETURNS void LANGUAGE sql AS
$$ SELECT set_config('test.auth_uid', '', false), set_config('test.auth_role', 'service_role', false) $$;
CREATE FUNCTION pg_temp.as_nobody() RETURNS void LANGUAGE sql AS
$$ SELECT set_config('test.auth_uid', '', false), set_config('test.auth_role', '', false) $$;
CREATE FUNCTION pg_temp.garage(p uuid) RETURNS uuid[] LANGUAGE sql AS
$$ SELECT coalesce(array_agg(vehicle_id ORDER BY vehicle_id), '{}') FROM public.get_user_garage(p) $$;

SELECT pg_temp.ok(md5(pg_get_functiondef('public.get_user_garage(uuid)'::regprocedure)) = '54f0556edc63ba6b9a6c136f27ed0d94'
  AND md5(pg_get_functiondef('public.enforce_contributor_evidence()'::regprocedure)) = 'd96d8e19bd0e930b5729698db601032f',
  'the fixture starts from the live definitions the migration guards');

-- People: A (the person, 901), B (another account, 902). Vehicles (1xx):
--  101 listing car: 10 listing photos attributed to A (no EXIF, user_upload), an auto contributor row, a permission row no
--      person granted, an old auto work session. Nothing first-hand.
--  102 A's real car: an auto contributor row and A's own device photos (camera EXIF).
--  103 an importer record: user_id/owner_id/uploaded_by = A, a stated contributor row, a listing photo.
--  104 approved title verification for A (and an owner permission).
--  105 canonical car; 106 merged into it, carrying an auto contributor row of A.
--  107 auto contributor row of A whose photo later moved off the car (the old trigger would refuse ending it);
--      a system discovery and a roster discovery.
--  108 ownership paper (unattributed title observation) + a work order with A as customer.
--  109 a permission row B granted A, and a library-source photo with no EXIF (ssd_blast).
INSERT INTO auth.users VALUES (pg_temp.u(901)), (pg_temp.u(902));
INSERT INTO public.profiles VALUES (pg_temp.u(901)), (pg_temp.u(902));
INSERT INTO public.vehicles (id, year, make, model, user_id, owner_id, uploaded_by) VALUES
 (pg_temp.u(101), 1968, 'Fixture', 'Coupe', NULL, NULL, NULL), (pg_temp.u(102), 1972, 'Fixture', 'Pickup', NULL, NULL, NULL),
 (pg_temp.u(103), 1965, 'Fixture', 'Fastback', pg_temp.u(901), pg_temp.u(901), pg_temp.u(901)),
 (pg_temp.u(104), 1977, 'Fixture', 'Wagon', NULL, NULL, NULL), (pg_temp.u(105), 1971, 'Fixture', 'Utility', NULL, NULL, NULL),
 (pg_temp.u(106), 1971, 'Fixture', 'Utility', NULL, NULL, NULL), (pg_temp.u(107), 1981, 'Fixture', 'Truck', NULL, NULL, NULL),
 (pg_temp.u(108), 1983, 'Fixture', 'Truck', NULL, NULL, NULL), (pg_temp.u(109), 1970, 'Fixture', NULL, NULL, NULL, NULL);
UPDATE public.vehicles SET merged_into_vehicle_id = pg_temp.u(105) WHERE id = pg_temp.u(106);
INSERT INTO public.vehicle_images (vehicle_id, user_id, image_url, created_at, taken_at, source, exif_data)
SELECT pg_temp.u(101), pg_temp.u(901), 'https://x/cl' || g || '.jpg', '2025-11-08', '2025-11-08', 'user_upload', '{}'::jsonb FROM generate_series(1, 10) g;
INSERT INTO public.vehicle_images (vehicle_id, user_id, image_url, created_at, taken_at, source, exif_data) VALUES
 (pg_temp.u(102), pg_temp.u(901), 'https://x/p1.jpg', '2025-06-01', '2025-06-01', 'iphoto', '{"camera_make": "Apple", "camera_model": "Phone"}'),
 (pg_temp.u(102), pg_temp.u(901), 'https://x/p2.jpg', '2025-06-02', '2025-06-02', 'user_upload', '{"camera": {"make": "Apple"}}'),
 (pg_temp.u(103), pg_temp.u(901), 'https://x/r1.jpg', '2025-09-01', NULL, 'user_upload', '{"camera": ""}'),
 (pg_temp.u(106), pg_temp.u(901), 'https://x/d1.jpg', '2025-11-02', NULL, 'user_upload', '{}'),
 (pg_temp.u(107), pg_temp.u(901), 'https://x/t1.jpg', '2025-11-07', NULL, 'user_upload', '{}'),
 (pg_temp.u(109), pg_temp.u(901), 'https://x/ssd.jpg', '2024-01-01', '2024-01-01', 'ssd_blast', NULL);
INSERT INTO public.vehicle_contributors (vehicle_id, user_id, role, start_date, notes, status) VALUES
 (pg_temp.u(101), pg_temp.u(901), 'photographer', '2026-07-06', 'Auto-derived: real photo evidence from the users own connected photo library', 'active'),
 (pg_temp.u(102), pg_temp.u(901), 'photographer', '2026-07-06', 'Auto-derived: real photo evidence from the users own connected photo library', 'active'),
 (pg_temp.u(103), pg_temp.u(901), 'mechanic', '2026-11-02', 'Owner request 2026-11-02: did significant work on this car', 'active'),
 (pg_temp.u(106), pg_temp.u(901), 'photographer', '2026-07-06', 'Auto-derived: real photo evidence', 'active'),
 (pg_temp.u(107), pg_temp.u(901), 'photographer', '2026-07-06', 'device_evidence (device_create_vehicle_profile, basis capture_session)', 'active');
-- 107's photo moves to another car afterwards (a misfile relink): its contributor row has no photo left behind it
UPDATE public.vehicle_images SET vehicle_id = pg_temp.u(108) WHERE vehicle_id = pg_temp.u(107);
INSERT INTO public.ownership_verifications (user_id, vehicle_id, status, verification_category) VALUES
 (pg_temp.u(901), pg_temp.u(104), 'approved', 'title_document');
-- importer-era permission rows: no grantor (written before the check existed)
INSERT INTO public.vehicle_user_permissions (vehicle_id, user_id, role, granted_by, context, created_at) VALUES
 (pg_temp.u(101), pg_temp.u(901), 'contributor', NULL, 'Photo evidence: 10 images attributed to user', '2026-03-09'),
 (pg_temp.u(104), pg_temp.u(901), 'owner', NULL, '', '2025-09-24');
INSERT INTO public.vehicle_user_permissions (vehicle_id, user_id, role, granted_by, context) VALUES
 (pg_temp.u(109), pg_temp.u(901), 'contributor', pg_temp.u(902), 'granted by the car''s owner');
ALTER TABLE public.vehicle_user_permissions ADD CONSTRAINT chk_granted_by_not_null CHECK (granted_by IS NOT NULL) NOT VALID;
INSERT INTO public.discovered_vehicles (user_id, vehicle_id, discovery_source, relationship_type) VALUES
 (pg_temp.u(901), pg_temp.u(107), 'system:sale_evidence_v1', 'previously_owned'),
 (pg_temp.u(901), pg_temp.u(108), 'roster_reconcile_2026-06-25', 'previously_owned');
INSERT INTO public.work_sessions (vehicle_id, user_id, session_date) VALUES (pg_temp.u(101), pg_temp.u(901), '2025-11-08');
INSERT INTO public.vehicle_observations (vehicle_id, kind, submitted_by_user_id, extraction_method, structured_data) VALUES
 (pg_temp.u(108), 'ownership', NULL, NULL, '{"document_type": "title"}'),
 (pg_temp.u(101), 'sighting', pg_temp.u(901), 'vision-gate-l4-cron-audit', '{}');
INSERT INTO public.work_orders (vehicle_id, customer_id, status) VALUES (pg_temp.u(108), pg_temp.u(901), 'pending');

-- Before the migration: the old check refuses ending a NULL-grantor row (why revoke_garage_membership cannot end it).
DO $$ BEGIN
  UPDATE public.vehicle_user_permissions SET is_active = false, revoked_at = now() WHERE vehicle_id = pg_temp.u(101);
  RAISE EXCEPTION 'contract failed: the old check let a NULL-grantor row be updated';
EXCEPTION WHEN check_violation THEN NULL; END $$;
SELECT pg_temp.as_self(pg_temp.u(901));
SELECT pg_temp.ok(pg_temp.u(101) = ANY (pg_temp.garage(pg_temp.u(901))), 'before: the listing car is in A''s garage (contributor row)');
SELECT pg_temp.as_nobody();

\i supabase/migrations/20261122004000_disclaim_vehicle_tie.sql
\i supabase/migrations/20261122004000_disclaim_vehicle_tie.sql

-- grants and shape
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'public.disclaim_vehicle_tie(uuid, text, uuid, text, boolean)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.restore_vehicle_tie(uuid, uuid, uuid, text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.disclaim_vehicle_tie(uuid, text, uuid, text, boolean)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.restore_vehicle_tie(uuid, uuid, uuid, text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.disclaim_vehicle_tie(uuid, text, uuid, text, boolean)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.vehicle_tie_first_hand_evidence(uuid[], uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.vehicle_tie_garage_routes(uuid[], uuid)', 'EXECUTE')
  AND NOT has_table_privilege('authenticated', 'public.vehicle_tie_journal', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.vehicle_tie_journal', 'SELECT')
  AND has_table_privilege('service_role', 'public.vehicle_tie_journal', 'SELECT')
  AND has_function_privilege('authenticated', 'public.get_user_garage(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.get_user_garage(uuid)', 'EXECUTE'),
  'disclaim/restore: signed-in and service role, never anon; helpers and journal service role only; reader grants kept');
SELECT pg_temp.ok((SELECT prosecdef AND proconfig::text LIKE '%search_path%' FROM pg_proc
  WHERE oid = 'public.disclaim_vehicle_tie(uuid, text, uuid, text, boolean)'::regprocedure), 'SECURITY DEFINER with a fixed search_path');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_constraint WHERE contype = 'f' AND conrelid = 'public.vehicle_tie_journal'::regclass),
  'the journal has no foreign key (none to vehicles)');

-- callers
DO $$ BEGIN
  PERFORM pg_temp.as_self(pg_temp.u(902));
  PERFORM public.disclaim_vehicle_tie(pg_temp.u(101), 'not mine', pg_temp.u(901));
  RAISE EXCEPTION 'contract failed: B disclaimed A''s tie';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  PERFORM pg_temp.as_nobody();
  PERFORM public.disclaim_vehicle_tie(pg_temp.u(101), 'not mine', pg_temp.u(901));
  RAISE EXCEPTION 'contract failed: a caller with no session disclaimed';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  PERFORM pg_temp.as_service();
  PERFORM public.disclaim_vehicle_tie(pg_temp.u(101), '  ', pg_temp.u(901));
  RAISE EXCEPTION 'contract failed: a blank reason was accepted';
EXCEPTION WHEN null_value_not_allowed THEN NULL; END $$;

-- 101, dry run first (writes nothing), as the service role
SELECT pg_temp.as_service();
SELECT public.disclaim_vehicle_tie(pg_temp.u(101), 'owner: not mine', pg_temp.u(901), NULL, true) AS r \gset
SELECT pg_temp.ok((:'r')::jsonb->>'status' = 'dry_run' AND jsonb_array_length((:'r')::jsonb->'would_end') = 2
  AND (:'r')::jsonb->'blocked_by' = '[]'::jsonb AND ((:'r')::jsonb->>'would_refuse')::boolean = false
  AND (:'r')::jsonb->'still_in_garage_by' = '[]'::jsonb AND jsonb_array_length((:'r')::jsonb->'in_garage_by') = 1,
  'dry run: two importer ties would end, listing photos are not evidence, nothing would remain');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM vehicle_tie_journal)
  AND (SELECT status FROM vehicle_contributors WHERE vehicle_id = pg_temp.u(101)) = 'active', 'the dry run wrote nothing');

-- 101 for real, as the signed-in person
SELECT pg_temp.as_self(pg_temp.u(901));
SELECT public.disclaim_vehicle_tie(pg_temp.u(101), 'owner: not mine', pg_temp.u(901)) AS r \gset
SELECT pg_temp.ok((:'r')::jsonb->>'status' = 'disclaimed' AND jsonb_array_length((:'r')::jsonb->'ended') = 2
  AND (:'r')::jsonb->'still_in_garage_by' = '[]'::jsonb AND (:'r')::jsonb->>'called_as' = 'self', 'listing car disclaimed');
SELECT (:'r')::jsonb->>'run_id' AS run101 \gset
SELECT pg_temp.ok((SELECT status = 'inactive' AND end_date = current_date FROM vehicle_contributors WHERE vehicle_id = pg_temp.u(101))
  AND (SELECT is_active = false AND revoked_at IS NOT NULL AND revoked_by = pg_temp.u(901) AND granted_by IS NULL
         AND context LIKE 'Photo evidence: 10 images attributed to user | ended by disclaim_vehicle_tie run %'
       FROM vehicle_user_permissions WHERE vehicle_id = pg_temp.u(101)),
  'contributor row ended (status, end_date); permission retracted with its NULL grantor kept');
SELECT pg_temp.ok((SELECT count(*) = 10 AND bool_and(user_id = pg_temp.u(901)) FROM vehicle_images WHERE vehicle_id = pg_temp.u(101))
  AND (SELECT count(*) = 1 FROM work_sessions WHERE vehicle_id = pg_temp.u(101))
  AND (SELECT count(*) = 1 FROM vehicle_observations WHERE vehicle_id = pg_temp.u(101) AND is_superseded IS NOT TRUE)
  AND (SELECT is_public AND user_id IS NULL AND year = 1968 FROM vehicles WHERE id = pg_temp.u(101)),
  'photos, work sessions, observations and the record untouched and public');
SELECT pg_temp.ok(NOT (pg_temp.u(101) = ANY (pg_temp.garage(pg_temp.u(901)))), 'get_user_garage no longer lists the listing car');
SELECT pg_temp.ok((SELECT count(*) = 2 AND bool_and(reason = 'owner: not mine' AND called_as = 'self' AND force_reason IS NULL
    AND before_image->>'id' = tie_row_id::text AND overridden_evidence = '[]'::jsonb AND vehicle_id = pg_temp.u(101))
  FROM vehicle_tie_journal WHERE run_id = :'run101'::uuid)
  AND (SELECT before_image->>'status' = 'active' AND after_image->>'status' = 'inactive' FROM vehicle_tie_journal
        WHERE run_id = :'run101'::uuid AND tie_table = 'vehicle_contributors'),
  'one journal row per tie, with before- and after-image');
SELECT pg_temp.ok(public.disclaim_vehicle_tie(pg_temp.u(101), 'again', pg_temp.u(901))->>'status' = 'nothing_to_end', 'a second call finds nothing to end');

-- 102: A's own device photos block; force only by the signed-in person
SELECT pg_temp.as_service();
SELECT public.disclaim_vehicle_tie(pg_temp.u(102), 'not mine', pg_temp.u(901)) AS r \gset
SELECT pg_temp.ok((:'r')::jsonb->>'status' = 'refused' AND (:'r')::jsonb->>'reason' = 'first_hand_evidence'
  AND (:'r')::jsonb->'blocked_by'->0->>'kind' = 'own_photos' AND ((:'r')::jsonb->'blocked_by'->0->>'count')::int = 2,
  'own device photos (camera_make, camera.make) refuse the call and are named');
SELECT pg_temp.ok(public.disclaim_vehicle_tie(pg_temp.u(102), 'not mine', pg_temp.u(901), 'I say so')->>'reason' = 'force_needs_signed_in_person',
  'the service role cannot force');
SELECT pg_temp.ok((SELECT status FROM vehicle_contributors WHERE vehicle_id = pg_temp.u(102)) = 'active'
  AND NOT EXISTS (SELECT 1 FROM vehicle_tie_journal WHERE vehicle_id = pg_temp.u(102)), 'refusals wrote nothing');
SELECT pg_temp.as_self(pg_temp.u(901));
SELECT public.disclaim_vehicle_tie(pg_temp.u(102), 'not mine', pg_temp.u(901), 'forced in the contract') AS r \gset
SELECT pg_temp.ok((:'r')::jsonb->>'status' = 'disclaimed' AND ((:'r')::jsonb->>'forced')::boolean
  AND (SELECT force_reason = 'forced in the contract' AND overridden_evidence->0->>'kind' = 'own_photos'
       FROM vehicle_tie_journal WHERE vehicle_id = pg_temp.u(102)),
  'the signed-in person forces; the journal keeps the force reason and the evidence it overrode');

-- 103: the record's own columns end; a stated contributor role stays and keeps the car listed
SELECT public.disclaim_vehicle_tie(pg_temp.u(103), 'not mine', pg_temp.u(901)) AS r \gset
SELECT pg_temp.ok((:'r')::jsonb->>'status' = 'disclaimed'
  AND (:'r')::jsonb->'ended'->0->>'kind' = 'record:user_id+owner_id'
  AND (:'r')::jsonb->'left'->0->>'kind' = 'contributor:mechanic'
  AND (:'r')::jsonb->'still_in_garage_by'->0->>'route' = 'contributor',
  'record tie ended; the stated mechanic row stays and is named as what still ties the car');
SELECT (:'r')::jsonb->>'run_id' AS run103 \gset
SELECT pg_temp.ok((SELECT user_id IS NULL AND owner_id IS NULL AND uploaded_by = pg_temp.u(901) FROM vehicles WHERE id = pg_temp.u(103)),
  'user_id and owner_id to NULL; uploaded_by kept as provenance');

-- 104: an approved title blocks; the dry run says so
SELECT public.disclaim_vehicle_tie(pg_temp.u(104), 'not mine', pg_temp.u(901), NULL, true) AS r \gset
SELECT pg_temp.ok(((:'r')::jsonb->>'would_refuse')::boolean AND (:'r')::jsonb->'blocked_by'->0->>'kind' = 'ownership_verification',
  'an approved title verification is named in the dry run');
SELECT pg_temp.ok(public.disclaim_vehicle_tie(pg_temp.u(104), 'not mine', pg_temp.u(901))->>'reason' = 'first_hand_evidence', 'and refuses');

-- 105/106: a tie on the merged duplicate keeps the canonical car listed until it ends
SELECT pg_temp.ok(pg_temp.u(105) = ANY (pg_temp.garage(pg_temp.u(901))), 'before: the canonical car is listed through its duplicate');
SELECT public.disclaim_vehicle_tie(pg_temp.u(105), 'not mine', pg_temp.u(901)) AS r \gset
SELECT pg_temp.ok((:'r')::jsonb->>'status' = 'disclaimed' AND (:'r')::jsonb->'ended'->0->>'row_id' =
    (SELECT id::text FROM vehicle_contributors WHERE vehicle_id = pg_temp.u(106))
  AND NOT (pg_temp.u(105) = ANY (pg_temp.garage(pg_temp.u(901)))), 'the duplicate''s tie ended; the car leaves the garage');

-- 107: no photo behind the device contributor row any more: ending it is allowed; the system discovery ends
SELECT public.disclaim_vehicle_tie(pg_temp.u(107), 'not mine', pg_temp.u(901)) AS r \gset
SELECT pg_temp.ok((:'r')::jsonb->>'status' = 'disclaimed' AND jsonb_array_length((:'r')::jsonb->'ended') = 2
  AND (SELECT is_active = false FROM discovered_vehicles WHERE vehicle_id = pg_temp.u(107)),
  'a contributor row with no photo left ends; the system discovery ends');
SELECT (:'r')::jsonb->>'run_id' AS run107 \gset

-- 108: ownership paper, a work order as customer; the roster discovery is the person's own list
SELECT public.disclaim_vehicle_tie(pg_temp.u(108), 'not mine', pg_temp.u(901), NULL, true) AS r \gset
SELECT pg_temp.ok((SELECT array_agg(e->>'kind' ORDER BY e->>'kind') FROM jsonb_array_elements((:'r')::jsonb->'blocked_by') e)
    = ARRAY['ownership_paper', 'work_order']
  AND (:'r')::jsonb->'would_end' = '[]'::jsonb AND (:'r')::jsonb->'left'->0->>'kind' = 'discovered:previously_owned',
  'ownership paper and a work order block (the photo moved here is a listing upload, not first-hand); the roster discovery stays');

-- 109: a library-source photo with no EXIF is first-hand; a permission another account granted stays
SELECT public.disclaim_vehicle_tie(pg_temp.u(109), 'not mine', pg_temp.u(901), NULL, true) AS r \gset
SELECT pg_temp.ok((:'r')::jsonb->'blocked_by'->0->>'kind' = 'own_photos' AND (:'r')::jsonb->'would_end' = '[]'::jsonb
  AND (:'r')::jsonb->'left'->0->>'why' = 'granted by another account', 'ssd_blast photo is first-hand; a granted permission stays');

-- restore 101 as the person: both rows back; the NULL-grantor row comes back granted by the person restoring it
SELECT public.restore_vehicle_tie(NULL, :'run101'::uuid, pg_temp.u(901), 'restored in the contract') AS r \gset
SELECT pg_temp.ok(jsonb_array_length((:'r')::jsonb->'restored') = 2 AND (:'r')::jsonb->'not_restored' = '[]'::jsonb, 'run restored');
SELECT pg_temp.ok((SELECT status = 'active' AND end_date IS NULL FROM vehicle_contributors WHERE vehicle_id = pg_temp.u(101))
  AND (SELECT is_active AND revoked_at IS NULL AND granted_by = pg_temp.u(901) AND context = 'Photo evidence: 10 images attributed to user'
       FROM vehicle_user_permissions WHERE vehicle_id = pg_temp.u(101))
  AND pg_temp.u(101) = ANY (pg_temp.garage(pg_temp.u(901)))
  AND (SELECT bool_and(restored_at IS NOT NULL AND restored_by = pg_temp.u(901) AND restore_note = 'restored in the contract')
       FROM vehicle_tie_journal WHERE run_id = :'run101'::uuid),
  'ties back as before (grantor: the restoring person); the car is listed again; journal stamped');
SELECT pg_temp.ok(public.restore_vehicle_tie(NULL, :'run101'::uuid, pg_temp.u(901))->'restored' = '[]'::jsonb, 'a restored run restores nothing more');

-- restore 103 by journal id, as the service role naming the person
SELECT pg_temp.as_service();
SELECT public.restore_vehicle_tie((SELECT id FROM vehicle_tie_journal WHERE run_id = :'run103'::uuid), NULL, pg_temp.u(901)) AS r \gset
SELECT pg_temp.ok(jsonb_array_length((:'r')::jsonb->'restored') = 1
  AND (SELECT user_id = pg_temp.u(901) AND owner_id = pg_temp.u(901) FROM vehicles WHERE id = pg_temp.u(103)), 'record columns restored');

-- restore 107: the discovery was changed meanwhile (left, named); the contributor row has no photo now (refused, named)
UPDATE public.discovered_vehicles SET is_active = true WHERE vehicle_id = pg_temp.u(107);
SELECT public.restore_vehicle_tie(NULL, :'run107'::uuid, pg_temp.u(901)) AS r \gset
SELECT pg_temp.ok((:'r')::jsonb->'restored' = '[]'::jsonb AND jsonb_array_length((:'r')::jsonb->'not_restored') = 2
  AND EXISTS (SELECT 1 FROM jsonb_array_elements((:'r')::jsonb->'not_restored') e WHERE e->>'why' LIKE 'refused by Cannot add contributor%')
  AND EXISTS (SELECT 1 FROM jsonb_array_elements((:'r')::jsonb->'not_restored') e WHERE e->>'why' LIKE 'the row changed since%')
  AND (SELECT bool_and(restored_at IS NULL AND restore_note IS NOT NULL) FROM vehicle_tie_journal WHERE run_id = :'run107'::uuid),
  'restore leaves changed rows alone and reports a trigger refusal instead of aborting');

-- another person cannot restore A's run; a call needs exactly one of journal id or run id
DO $$ BEGIN
  PERFORM pg_temp.as_self(pg_temp.u(902));
  PERFORM public.restore_vehicle_tie(NULL, (SELECT run_id FROM vehicle_tie_journal LIMIT 1), pg_temp.u(901));
  RAISE EXCEPTION 'contract failed: B restored A''s run';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
SELECT pg_temp.as_service();
SELECT pg_temp.ok(public.restore_vehicle_tie(NULL, (SELECT run_id FROM vehicle_tie_journal WHERE vehicle_id = pg_temp.u(102)), pg_temp.u(902))->'restored' = '[]'::jsonb,
  'a run restores only for the person whose ties it ended');
DO $$ BEGIN
  PERFORM public.restore_vehicle_tie(gen_random_uuid(), gen_random_uuid(), pg_temp.u(901));
  RAISE EXCEPTION 'contract failed: both ids accepted';
EXCEPTION WHEN null_value_not_allowed THEN NULL; END $$;

-- the relaxed check: an active row still needs a grantor
DO $$ BEGIN
  PERFORM pg_temp.as_service();
  INSERT INTO public.vehicle_user_permissions (vehicle_id, user_id, role, granted_by) VALUES (pg_temp.u(102), pg_temp.u(901), 'contributor', NULL);
  RAISE EXCEPTION 'contract failed: an active grant without a grantor was accepted';
EXCEPTION WHEN check_violation THEN NULL; END $$;

\echo 'disclaim_vehicle_tie contract: ok'
