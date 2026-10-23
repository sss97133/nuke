-- Disposable PG17 only. Proves 20261021140000_fix_attribute_testimony_gate_cast.sql: the body recorded in
-- 20261018201500 (production's body, same md5) fails to file a photo with 42704; after the fix the same call files it,
-- approves a pending gate, leaves a sensitive photo's gate pending and writes one audit row per filing; only the cast
-- changed; the function keeps its settings and the live ACL (owner and service_role); re-applying is a no-op.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_%' OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Empty disposable PG17 database required';
  END IF;
END $$;
SET TimeZone = 'UTC';
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
-- Live shapes read 2026-10-20: both enums with their labels, and the columns the writer reads and sets.
CREATE TYPE public.vision_gate_status AS ENUM ('pending','approved','rejected_personal','rejected_misattributed','review_needed');
CREATE TYPE public.content_approval_status AS ENUM ('pending','auto_approved','approved','rejected');
CREATE TABLE public.vehicles(id uuid PRIMARY KEY);
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY, vehicle_id uuid, file_hash text, is_primary boolean DEFAULT false,
  is_document boolean DEFAULT false, is_duplicate boolean DEFAULT false, is_sensitive boolean NOT NULL DEFAULT false,
  vision_gate_status public.vision_gate_status DEFAULT 'pending', is_approved boolean DEFAULT true,
  approval_status public.content_approval_status NOT NULL DEFAULT 'pending', updated_at timestamptz DEFAULT now());
CREATE TABLE public.vehicle_observations(id uuid PRIMARY KEY, vehicle_id uuid);
CREATE TABLE public.reattribution_audit(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), observation_type text NOT NULL,
  old_observation_id uuid NOT NULL, old_vehicle_id uuid, new_observation_id uuid NOT NULL, new_vehicle_id uuid,
  reason text NOT NULL, actor_user_id uuid, created_at timestamptz DEFAULT now());
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
CREATE FUNCTION public.t_assert(v boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text) TO service_role;

INSERT INTO vehicles VALUES ('a0000000-0000-0000-0000-00000000000a');
INSERT INTO vehicle_images(id, file_hash, is_sensitive) VALUES
  ('10000000-0000-0000-0000-000000000001', 'h1', false),
  ('10000000-0000-0000-0000-000000000002', 'h2', true);

-- Before: the recorded body. Its file also defines seven functions over tables this fixture lacks, so bodies are not
-- checked while it loads (as in a restore).
SET check_function_bodies = off;
\ir ../migrations/20261018201500_org_chronology_session_confirm_functions.sql
RESET check_function_bodies;
SELECT md5(prosrc) AS before_md5, prosrc AS before_src FROM pg_proc
 WHERE oid = 'public.attribute_testimony(text,uuid,uuid,text,uuid,numeric,text)'::regprocedure \gset
SELECT t_assert(:'before_md5' = '0d5acd1a6873c06e7757449744267563', 'the recorded body is production''s (md5 read 2026-10-20)'); -- gitleaks:allow (function-definition fingerprint, not a secret)
DO $$ BEGIN
  PERFORM public.attribute_testimony('image', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'contract');
  RAISE EXCEPTION 'FAIL: the recorded body filed a photo';
EXCEPTION WHEN undefined_object THEN RAISE NOTICE 'PASS: the recorded body fails to file a photo: % (%)', SQLERRM, SQLSTATE;
END $$;
SELECT t_assert((SELECT vehicle_id FROM vehicle_images WHERE id = '10000000-0000-0000-0000-000000000001') IS NULL
  AND NOT EXISTS (SELECT FROM reattribution_audit), 'before the fix nothing is filed or audited');

\ir ../migrations/20261021140000_fix_attribute_testimony_gate_cast.sql
SELECT prosrc AS after_src FROM pg_proc
 WHERE oid = 'public.attribute_testimony(text,uuid,uuid,text,uuid,numeric,text)'::regprocedure \gset
SELECT t_assert(pg_get_functiondef('public.attribute_testimony'::regproc) NOT LIKE '%vision_gate_enum%'
  AND 'approved'::public.vision_gate_status IS NOT NULL, 'the body casts to vision_gate_status, not vision_gate_enum');
SELECT t_assert(replace(:'before_src', '::public.vision_gate_enum', '::public.vision_gate_status') = :'after_src'
  AND md5(:'after_src') = '7492c54c97880e31123dcd49d56b0f9c', 'only the cast changed'); -- gitleaks:allow (function-definition fingerprint, not a secret)

SET ROLE service_role;
SELECT public.attribute_testimony('image', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a',
  'contract', NULL, 0.97, 'contract_signal') AS r1 \gset
SELECT public.attribute_testimony('image', '10000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-00000000000a',
  'contract') AS r2 \gset
RESET ROLE;
SELECT t_assert((:'r1'::jsonb) @> '{"success":true,"mode":"first_attribution"}'
  AND (SELECT (vehicle_id, vision_gate_status, is_approved, approval_status)
         = ('a0000000-0000-0000-0000-00000000000a'::uuid, 'approved'::public.vision_gate_status, true, 'approved'::public.content_approval_status)
       FROM vehicle_images WHERE id = '10000000-0000-0000-0000-000000000001'),
  'service_role files a pending photo and its gate is approved');
SELECT t_assert((:'r2'::jsonb) @> '{"success":true}'
  AND (SELECT (vehicle_id, vision_gate_status, approval_status)
         = ('a0000000-0000-0000-0000-00000000000a'::uuid, 'pending'::public.vision_gate_status, 'pending'::public.content_approval_status)
       FROM vehicle_images WHERE id = '10000000-0000-0000-0000-000000000002'),
  'a sensitive photo is filed and its gate stays pending');
SELECT t_assert((SELECT count(*) FROM reattribution_audit WHERE observation_type = 'image' AND old_vehicle_id IS NULL
    AND new_vehicle_id = 'a0000000-0000-0000-0000-00000000000a' AND reason LIKE 'first_attribution: contract%') = 2
  AND EXISTS (SELECT FROM reattribution_audit WHERE reason = 'first_attribution: contract; confidence=0.97; signal=contract_signal'),
  'each filing writes one first_attribution audit row with its confidence and signal');

SELECT t_assert((SELECT NOT p.prosecdef AND p.proconfig IS NULL AND p.provolatile = 'v' AND l.lanname = 'plpgsql'
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
    WHERE p.oid = 'public.attribute_testimony(text,uuid,uuid,text,uuid,numeric,text)'::regprocedure),
  'still SECURITY INVOKER, VOLATILE plpgsql with no settings');
SELECT t_assert((SELECT array_to_string(proacl::text[], ',') FROM pg_proc
      WHERE oid = 'public.attribute_testimony(text,uuid,uuid,text,uuid,numeric,text)'::regprocedure)
    = format('%1$s=X/%1$s,service_role=X/%1$s', current_user)
  AND NOT has_function_privilege('anon', 'public.attribute_testimony(text,uuid,uuid,text,uuid,numeric,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.attribute_testimony(text,uuid,uuid,text,uuid,numeric,text)', 'EXECUTE'),
  'the ACL is production''s: owner and service_role; anon and authenticated cannot execute');

\ir ../migrations/20261021140000_fix_attribute_testimony_gate_cast.sql
SELECT t_assert((SELECT prosrc FROM pg_proc
    WHERE oid = 'public.attribute_testimony(text,uuid,uuid,text,uuid,numeric,text)'::regprocedure) = :'after_src',
  're-applying the fix is a no-op');
