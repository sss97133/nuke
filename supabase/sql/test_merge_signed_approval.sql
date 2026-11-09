-- Contract for 20261113120000_merge_signed_approval_and_owner_fill_off.sql: the signed merge approval writer, and a merge
-- whose approval turned the owner fill off never adds an owner to the survivor. Synthetic rows only; never production.
-- Run in an empty, disposable dm_refinement_* database from the repo root:
--   createdb dm_refinement_merge_signed_approval
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_merge_signed_approval -f supabase/sql/test_merge_signed_approval.sql
-- Fixture: the same live-shaped tables as test_merge_into_primary_contract.sql, plus the people tables merge_carry_children
-- carries and the proposal review columns.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '60s';
SET lock_timeout = '5s';
SET TimeZone = 'UTC';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

-- Platform stubs the two functions call.
CREATE SCHEMA auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'service_role'::text $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
CREATE FUNCTION public.is_admin_or_moderator() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.user_can_edit_vehicle(uuid, uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;

CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY, status text, merged_into_vehicle_id uuid, deleted_at timestamptz, user_id uuid, owner_id uuid, uploaded_by uuid, image_count integer, vin text, listing_url text);
CREATE TABLE public.vehicle_user_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid NOT NULL, user_id uuid, role text, is_active boolean DEFAULT true);
CREATE TABLE public.work_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid NOT NULL, start_time timestamptz NOT NULL, title text,
  UNIQUE (vehicle_id, start_time));
CREATE TABLE public.receipts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, scope_type text, scope_id text, total numeric);
CREATE TABLE public.vehicle_images (
  id uuid PRIMARY KEY, vehicle_id uuid, merged_from_vehicle_id uuid, image_url text, file_hash text,
  is_superseded boolean, is_duplicate boolean);
CREATE UNIQUE INDEX idx_unique_vehicle_file_hash ON public.vehicle_images (vehicle_id, file_hash)
  WHERE file_hash IS NOT NULL AND vehicle_id IS NOT NULL AND COALESCE(is_superseded, false) = false;
CREATE TABLE public.vehicle_observations (
  id uuid PRIMARY KEY, vehicle_id uuid, merged_from_vehicle_id uuid, source_id uuid, source_identifier text, kind text,
  content_hash text, observed_at timestamptz, is_superseded boolean, superseded_by uuid, superseded_at timestamptz,
  source_vin text, source_vin_taxonomy_revision_id bigint, extraction_method text, source_vehicle_event_id uuid,
  source_observation_id uuid, source_comment_id uuid, source_snapshot_id uuid);
CREATE UNIQUE INDEX unique_observation ON public.vehicle_observations (source_id, source_identifier, kind, content_hash);
CREATE TABLE public.auction_events (id uuid PRIMARY KEY, vehicle_id uuid, merged_from_vehicle_id uuid, source_url text);
CREATE UNIQUE INDEX idx_auction_events_vehicle_source_url ON public.auction_events (vehicle_id, source_url);
CREATE TABLE public.auction_comments (id uuid PRIMARY KEY, vehicle_id uuid, merged_from_vehicle_id uuid, content_hash text);
CREATE UNIQUE INDEX auction_comments_vehicle_content_hash_key ON public.auction_comments (vehicle_id, content_hash);
CREATE TABLE public.observation_discoveries (id uuid PRIMARY KEY, vehicle_id uuid, merged_from_vehicle_id uuid);
CREATE TABLE public.vehicle_events (id uuid PRIMARY KEY, vehicle_id uuid, source_platform text, source_listing_id text, source_url text);
CREATE UNIQUE INDEX idx_vehicle_events_dedup ON public.vehicle_events (vehicle_id, source_platform, source_listing_id) WHERE source_listing_id IS NOT NULL;
CREATE UNIQUE INDEX idx_vehicle_events_dedup_url ON public.vehicle_events (vehicle_id, source_platform, source_url) WHERE source_url IS NOT NULL AND source_listing_id IS NULL;
CREATE TABLE public.timeline_events (id uuid PRIMARY KEY, vehicle_id uuid, user_id uuid, event_type text, event_date date);
CREATE UNIQUE INDEX idx_timeline_events_one_photo_session_per_day ON public.timeline_events (vehicle_id, event_date, COALESCE(user_id::text, 'system'))
  WHERE event_type = ANY (ARRAY['photo_session', 'batch_image_upload']);
CREATE TABLE public.bat_listings (id uuid PRIMARY KEY, vehicle_id uuid, bat_listing_url text UNIQUE);
CREATE TABLE public.comment_discoveries (id uuid PRIMARY KEY, vehicle_id uuid UNIQUE);
CREATE TABLE public.description_discoveries (id uuid PRIMARY KEY, vehicle_id uuid UNIQUE);
CREATE TABLE public.vehicle_merge_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), primary_vehicle_id uuid NOT NULL, duplicate_vehicle_id uuid NOT NULL,
  match_type text, confidence_score integer, status text, detected_by text, detected_at timestamptz, reviewed_by uuid,
  merged_at timestamptz, merge_journal jsonb, pre_merge_dup_status text, unmerged_at timestamptz, unmerged_by uuid,
  reviewed_at timestamptz, review_notes text, recommended_primary uuid, recommendation_reason text, updated_at timestamptz,
  UNIQUE (primary_vehicle_id, duplicate_vehicle_id));
CREATE TABLE public.merge_deleted_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), proposal_id uuid REFERENCES public.vehicle_merge_proposals (id) ON DELETE CASCADE,
  source_table text, row_id uuid, row_data jsonb, deleted_at timestamptz DEFAULT now(), restored_at timestamptz);
CREATE TABLE public.merge_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_a_id uuid NOT NULL, vehicle_b_id uuid NOT NULL, status text DEFAULT 'pending',
  evidence jsonb, UNIQUE (vehicle_a_id, vehicle_b_id),
  CONSTRAINT merge_proposals_status_check CHECK (status = ANY (ARRAY['pending', 'approved', 'rejected', 'executed'])));


CREATE TABLE public.vehicle_contributors (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid, role text);
CREATE TABLE public.user_vehicle_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid, link_type text);
CREATE TABLE public.vehicle_user_relationships (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid, role text);
CREATE TABLE public.admin_users (user_id uuid PRIMARY KEY, is_active boolean);

\i supabase/migrations/20261015220000_merge_carries_events_and_supersedes.sql
\i supabase/migrations/20261020050500_merge_vin_carry_and_protected_observations.sql
\i supabase/migrations/20261021170000_merge_gate_reads_every_owner_signal.sql
\i supabase/migrations/20261021200000_merge_carries_records.sql
\i supabase/migrations/20261113120000_merge_signed_approval_and_owner_fill_off.sql

-- Owner U owns both records of pair 1 (owner_id on both, uploaded_by only on the duplicate, like the GTO pair).
-- U2 has an owner permission and an owner link on the duplicate; U3 is a contributor and a photographer there.
INSERT INTO vehicles (id, status, owner_id, uploaded_by, vin) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'active',   '00000000-0000-0000-0000-00000000000c', NULL, '1GTGK24M1DJ514592'),
  ('00000000-0000-0000-0000-0000000000d1', 'inactive', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000c', NULL),
  ('00000000-0000-0000-0000-0000000000a2', 'active',   '00000000-0000-0000-0000-00000000000c', NULL, NULL),
  ('00000000-0000-0000-0000-0000000000d2', 'active',   '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000c', NULL),
  ('00000000-0000-0000-0000-0000000000a3', 'active',   '00000000-0000-0000-0000-00000000000c', NULL, '1GTGK24M1DJ514592'),
  ('00000000-0000-0000-0000-0000000000d3', 'active',   '00000000-0000-0000-0000-00000000000c', NULL, '1GCEK14H6DJ501481');
UPDATE vehicles SET deleted_at = now() WHERE id = '00000000-0000-0000-0000-0000000000d1';
INSERT INTO vehicle_user_permissions (vehicle_id, user_id, role, is_active) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b2', 'owner', true),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b3', 'contributor', true),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b4', NULL, true);
INSERT INTO user_vehicle_links (vehicle_id, user_id, link_type) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b2', 'owner'),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b3', 'favorite');
INSERT INTO vehicle_contributors (vehicle_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b3', 'photographer'),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b2', 'consigner');
INSERT INTO vehicle_images (id, vehicle_id, image_url, file_hash) VALUES
  ('00000000-0000-0000-0000-0000000001d1', '00000000-0000-0000-0000-0000000000d1', 'x', 'h1');

-- 1. Owned pair, no approval: Gate 2 refuses.
SELECT pg_temp.ok('owned pair without approval is refused',
  merge_into_primary('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1')->>'skipped' = 'owned_requires_approval');

-- 2. The writer refuses thin evidence, a reviewer without standing, two VINs, and anon.
DO $$ BEGIN
  BEGIN PERFORM approve_vehicle_merge('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1',
          '00000000-0000-0000-0000-00000000000c', '{"basis":"same truck"}', 'n', false, 'contract');
        RAISE EXCEPTION 'no refusal'; EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%evidence must be%' THEN RAISE; END IF; END;
  BEGIN PERFORM approve_vehicle_merge('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1',
          '00000000-0000-0000-0000-0000000000b3', '{"basis":"same truck","items":[{"k":"v"}]}', 'n', false, 'contract');
        RAISE EXCEPTION 'no refusal'; EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%owner signal on both%' THEN RAISE; END IF; END;
  BEGIN PERFORM approve_vehicle_merge('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000d3',
          '00000000-0000-0000-0000-00000000000c', '{"basis":"same truck","items":[{"k":"v"}]}', 'n', false, 'contract');
        RAISE EXCEPTION 'no refusal'; EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%vin_conflict%' THEN RAISE; END IF; END;
END $$;
SELECT pg_temp.ok('refusals wrote nothing', NOT EXISTS (SELECT 1 FROM vehicle_merge_approvals));
SELECT pg_temp.ok('anon cannot call the writer', NOT has_function_privilege('anon', 'public.approve_vehicle_merge(uuid,uuid,uuid,jsonb,text,boolean,text)', 'EXECUTE'));
SELECT pg_temp.ok('authenticated cannot call the writer', NOT has_function_privilege('authenticated', 'public.approve_vehicle_merge(uuid,uuid,uuid,jsonb,text,boolean,text)', 'EXECUTE'));

-- 3. A signed approval on a soft-deleted duplicate, owner fill off (the default).
CREATE TABLE pg_temp.appr AS SELECT approve_vehicle_merge('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1',
  '00000000-0000-0000-0000-00000000000c', '{"basis":"same truck, shared shop sessions","items":[{"kind":"shared_frames","n":214}]}',
  'reviewed in the garage', p_actor => 'contract') r;
SELECT pg_temp.ok('approval is approved with the fill off', (SELECT r->>'status' = 'approved' AND (r->>'fill_owner')::boolean = false FROM pg_temp.appr));
SELECT pg_temp.ok('signature is sha256 of the signed payload',
  (SELECT a.signature = encode(sha256(convert_to(a.signed_payload::text, 'UTF8')), 'hex') AND p.approval_signature = a.signature
     FROM vehicle_merge_approvals a JOIN vehicle_merge_proposals p ON p.id = a.proposal_id));

CREATE TABLE pg_temp.m1 AS SELECT merge_into_primary('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1') r;
SELECT pg_temp.ok('approved merge runs', (SELECT r->>'skipped' IS NULL AND (r->>'images_moved')::int = 1 FROM pg_temp.m1));
SELECT pg_temp.ok('survivor gets no uploaded_by and keeps its owner_id',
  (SELECT uploaded_by IS NULL AND owner_id = '00000000-0000-0000-0000-00000000000c' FROM vehicles WHERE id = '00000000-0000-0000-0000-0000000000a1'));
SELECT pg_temp.ok('owner permission stays on the duplicate',
  (SELECT vehicle_id = '00000000-0000-0000-0000-0000000000d1' FROM vehicle_user_permissions WHERE role = 'owner'));
SELECT pg_temp.ok('owner link stays on the duplicate',
  (SELECT vehicle_id = '00000000-0000-0000-0000-0000000000d1' FROM user_vehicle_links WHERE link_type = 'owner'));
SELECT pg_temp.ok('consigner stays on the duplicate',
  (SELECT vehicle_id = '00000000-0000-0000-0000-0000000000d1' FROM vehicle_contributors WHERE role = 'consigner'));
SELECT pg_temp.ok('non-owner roles still move (contributor, null role, favorite link, photographer)',
  (SELECT count(*) = 2 FROM vehicle_user_permissions WHERE vehicle_id = '00000000-0000-0000-0000-0000000000a1')
  AND (SELECT vehicle_id = '00000000-0000-0000-0000-0000000000a1' FROM user_vehicle_links WHERE link_type = 'favorite')
  AND (SELECT vehicle_id = '00000000-0000-0000-0000-0000000000a1' FROM vehicle_contributors WHERE role = 'photographer'));
SELECT pg_temp.ok('held rows are journaled and no owner fill is recorded',
  (SELECT r->'carry' ? 'ownership_rows_held' AND NOT (r->'carry' ? 'owner_filled') FROM pg_temp.m1));
SELECT pg_temp.ok('duplicate is merged into the survivor, not deleted',
  (SELECT status = 'merged' AND merged_into_vehicle_id = '00000000-0000-0000-0000-0000000000a1' FROM vehicles WHERE id = '00000000-0000-0000-0000-0000000000d1'));

-- 4. unmerge_vehicle returns everything.
SELECT unmerge_vehicle((SELECT r->>'proposal_id' FROM pg_temp.m1)::uuid, 'contract');
SELECT pg_temp.ok('unmerge puts the moved rows back',
  (SELECT count(*) = 3 FROM vehicle_user_permissions WHERE vehicle_id = '00000000-0000-0000-0000-0000000000d1')
  AND (SELECT vehicle_id = '00000000-0000-0000-0000-0000000000d1' FROM vehicle_images WHERE id = '00000000-0000-0000-0000-0000000001d1')
  AND (SELECT status = 'inactive' FROM vehicles WHERE id = '00000000-0000-0000-0000-0000000000d1'));

-- 5. A pending proposal filed the other way round turns to the approved direction in place.
INSERT INTO vehicle_merge_proposals (id, primary_vehicle_id, duplicate_vehicle_id, match_type, confidence_score, status, detected_by)
VALUES ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a2', 'manual_merge', 80, 'proposed', 'identity-cases');
CREATE TABLE pg_temp.appr2 AS SELECT approve_vehicle_merge('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000d2',
  '00000000-0000-0000-0000-00000000000c', '{"basis":"same car","items":[{"kind":"vin_on_survivor"}]}', NULL, false, 'contract') r;
SELECT pg_temp.ok('reverse proposal reused and flipped',
  (SELECT r->>'proposal_id' = '00000000-0000-0000-0000-0000000000f2' AND r->'prior_direction'->>'primary' = '00000000-0000-0000-0000-0000000000d2' FROM pg_temp.appr2)
  AND (SELECT primary_vehicle_id = '00000000-0000-0000-0000-0000000000a2' FROM vehicle_merge_proposals WHERE id = '00000000-0000-0000-0000-0000000000f2'));

-- 6. Revocation sends it back to proposed, and Gate 2 refuses again.
SELECT pg_temp.ok('revoke works', (revoke_vehicle_merge_approval('00000000-0000-0000-0000-0000000000f2', 'changed my mind', 'contract')->>'revoked')::boolean);
SELECT pg_temp.ok('revoked approval no longer opens Gate 2',
  merge_into_primary('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000d2')->>'skipped' = 'owned_requires_approval');
SELECT pg_temp.ok('audit row marked revoked', (SELECT revoked_at IS NOT NULL FROM vehicle_merge_approvals WHERE proposal_id = '00000000-0000-0000-0000-0000000000f2'));

-- 7. A legacy approved proposal (no fill flag) keeps the old behaviour: the owner fill runs.
UPDATE vehicle_merge_proposals SET status = 'approved', reviewed_by = '00000000-0000-0000-0000-00000000000c' WHERE id = '00000000-0000-0000-0000-0000000000f2';
SELECT merge_into_primary('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000d2');
SELECT pg_temp.ok('legacy approval still fills (unchanged for existing callers)',
  (SELECT uploaded_by = '00000000-0000-0000-0000-00000000000c' FROM vehicles WHERE id = '00000000-0000-0000-0000-0000000000a2'));

SELECT 'test_merge_signed_approval: all contracts passed' AS result;
