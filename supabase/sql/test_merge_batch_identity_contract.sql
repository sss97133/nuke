-- Isolated PostgreSQL 17 contract for 20261019030000_merge_carries_identity_unmerge_batch.sql,
-- 20261020011000_merge_batch_discovery_url_fill_only.sql , 20261020050500_merge_vin_carry_and_protected_observations.sql and 20261021040000_merge_batch_same_source_image_stays.sql. Synthetic rows only; never production.
-- Run in an empty, disposable dm_refinement_* database from the repo root:
--   createdb dm_refinement_merge_batch_identity
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_merge_batch_identity -f supabase/sql/test_merge_batch_identity_contract.sql
-- Fixtures carry the live (2026-10-18) columns the batch merge, unmerge_vehicle and correct_vehicle_vin read or write, the live VIN and
-- URL unique indexes on vehicles and the live enforce_vin_uniqueness trigger, so a carried VIN or a restored duplicate meets the same
-- constraints it meets in production.
-- Proof: a merged-away row owns no VIN; the batch merge carries the VIN and identity a survivor lacks, refuses two-VIN pairs and
-- journals what it did; unmerge reverses a journaled batch merge and a journal-less one (derived), parking a colliding listing_url.
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

CREATE SCHEMA auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'service_role'::text $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
CREATE FUNCTION public.is_admin_or_moderator() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.user_can_edit_vehicle(uuid, uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;

CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY, status text, merged_into_vehicle_id uuid, deleted_at timestamptz, user_id uuid, owner_id uuid, uploaded_by uuid, image_count integer,
  has_photos boolean, vin text, year integer, make text, model text, trim text, series text, generation text, body_style text,
  engine_size text, engine_type text, drivetrain text, fuel_type text, listing_url text, discovery_url text, primary_image_url text,
  sale_date date, color text, interior_color text, transmission text, description text, profile_origin text, origin_metadata jsonb);
CREATE UNIQUE INDEX vehicles_vin_unique_17char_v2 ON public.vehicles (vin)
  WHERE vin IS NOT NULL AND length(vin) = 17 AND status IS DISTINCT FROM 'merged';
CREATE UNIQUE INDEX idx_vehicles_listing_url_unique ON public.vehicles (listing_url)
  WHERE deleted_at IS NULL AND listing_url IS NOT NULL AND listing_url <> '';
CREATE UNIQUE INDEX vehicles_discovery_url_unique ON public.vehicles (discovery_url) WHERE discovery_url IS NOT NULL;
-- The live trigger as deployed through 20261019190602 (no status filter): it counted a merged-away duplicate as a holder, so
-- the batch merge's VIN carry raised on every 11+ character VIN (measured 2026-10-19, 10 of 20 live pairs).
-- 20261020050500 below makes it skip status 'merged', as the partial unique indexes already do.
CREATE FUNCTION public.normalize_make(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT lower(trim(p)) $$;
CREATE FUNCTION public.enforce_vin_uniqueness() RETURNS trigger LANGUAGE plpgsql AS $$
  DECLARE
    v_norm text;
    v_existing uuid;
    v_classic_serial boolean;
  BEGIN
    IF NEW.vin IS NULL OR length(trim(NEW.vin)) < 11 THEN
      RETURN NEW;
    END IF;
    v_norm := upper(trim(NEW.vin));
    v_classic_serial := length(v_norm) < 17
      AND NEW.profile_origin = 'device_evidence'
      AND NEW.origin_metadata -> 'device_evidence' ->> 'basis' IN ('serial_album', 'capture_session');
    IF v_classic_serial THEN
      SELECT id INTO v_existing FROM public.vehicles
       WHERE upper(trim(vin)) = v_norm AND upper(public.normalize_make(make)) = upper(public.normalize_make(NEW.make)) AND id <> NEW.id LIMIT 1;
    ELSE
      SELECT id INTO v_existing FROM public.vehicles WHERE upper(trim(vin)) = v_norm AND id <> NEW.id LIMIT 1;
    END IF;
    IF v_existing IS NOT NULL THEN
      RAISE EXCEPTION 'VIN or chassis identifier % already exists on vehicle %', v_norm, v_existing
        USING ERRCODE = 'unique_violation', HINT = 'Attach observations to the existing vehicle via the sanctioned identity path.';
    END IF;
    RETURN NEW;
  END;
$$;
CREATE TRIGGER trg_enforce_vin_uniqueness BEFORE INSERT OR UPDATE OF vin ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_vin_uniqueness();

CREATE TABLE public.vehicle_images (
  id uuid PRIMARY KEY, vehicle_id uuid, merged_from_vehicle_id uuid, image_url text, file_hash text, is_primary boolean,
  is_document boolean, is_superseded boolean, is_duplicate boolean);
CREATE TABLE public.vehicle_observations (
  id uuid PRIMARY KEY, vehicle_id uuid, merged_from_vehicle_id uuid, source_id uuid, source_identifier text, kind text,
  observed_at timestamptz, is_superseded boolean, superseded_by uuid, superseded_at timestamptz, source_vin text,
  source_vin_taxonomy_revision_id bigint, extraction_method text, source_vehicle_event_id uuid, source_observation_id uuid,
  source_comment_id uuid, source_snapshot_id uuid);
CREATE TABLE public.auction_events (id uuid PRIMARY KEY, vehicle_id uuid, merged_from_vehicle_id uuid, source_url text);
CREATE TABLE public.auction_comments (id uuid PRIMARY KEY, vehicle_id uuid, merged_from_vehicle_id uuid, content_hash text);
CREATE TABLE public.observation_discoveries (id uuid PRIMARY KEY, vehicle_id uuid, merged_from_vehicle_id uuid);
CREATE TABLE public.vehicle_events (id uuid PRIMARY KEY, vehicle_id uuid, merged_from_vehicle_id uuid, source_platform text, created_at timestamptz DEFAULT now(),
  source_listing_id text, source_url text);
CREATE TABLE public.timeline_events (id uuid PRIMARY KEY, vehicle_id uuid, merged_from_vehicle_id uuid, user_id uuid, event_type text, event_date date);
CREATE TABLE public.vehicle_merge_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), primary_vehicle_id uuid NOT NULL, duplicate_vehicle_id uuid NOT NULL,
  match_type text, confidence_score integer, status text, detected_by text, detected_at timestamptz, reviewed_by uuid,
  merged_at timestamptz, merge_journal jsonb, pre_merge_dup_status text, unmerged_at timestamptz, unmerged_by uuid,
  UNIQUE (primary_vehicle_id, duplicate_vehicle_id));
CREATE TABLE public.vehicle_user_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid NOT NULL, user_id uuid, role text, is_active boolean DEFAULT true,
  UNIQUE (vehicle_id, user_id));
-- Records a merge carries (20261021200000), with the live unique rules that decide a collision.
CREATE TABLE public.work_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid NOT NULL, start_time timestamptz NOT NULL, title text,
  UNIQUE (vehicle_id, start_time));
CREATE TABLE public.receipts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, scope_type text, scope_id text, total numeric);
CREATE TABLE public.payment_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), scope_type text, scope_id uuid, amount numeric);
CREATE TABLE public.organization_vehicles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, vehicle_id uuid NOT NULL,
  relationship_type text, UNIQUE (organization_id, vehicle_id, relationship_type));
CREATE TABLE public.vehicle_listings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid NOT NULL, status text);
CREATE UNIQUE INDEX vehicle_listings_one_active ON public.vehicle_listings (vehicle_id) WHERE status = 'active';
CREATE UNIQUE INDEX vehicle_listings_one_draft ON public.vehicle_listings (vehicle_id) WHERE status = 'draft';
CREATE TABLE public.qb_transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, amount numeric);
-- a trigger that refuses to move a row: the carry must record it and go on
CREATE FUNCTION public.t_refuse_qb_move() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id THEN RAISE EXCEPTION 'contract trigger: qb rows do not move'; END IF; RETURN NEW; END $$;
CREATE TRIGGER t_refuse_qb_move BEFORE UPDATE ON public.qb_transactions FOR EACH ROW EXECUTE FUNCTION public.t_refuse_qb_move();
-- evidence tables are never carried
CREATE TABLE public.evidence_runs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), named_vehicle_id uuid, vehicle_id uuid);
CREATE TABLE public.merge_deleted_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), proposal_id uuid, source_table text, row_id uuid, row_data jsonb, restored_at timestamptz);
CREATE TABLE public.merge_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_a_id uuid NOT NULL, vehicle_b_id uuid NOT NULL, status text DEFAULT 'pending',
  evidence jsonb, detection_source text, ai_decision text, ai_confidence numeric, ai_reasoning text, preferred_primary text,
  match_tier integer, confidence numeric, ai_verified boolean, proposed_by text, UNIQUE (vehicle_a_id, vehicle_b_id));
CREATE TABLE public.superseded_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_table text, row_id uuid, row_data jsonb, asserted_by text, source jsonb, reason text);

\i supabase/migrations/20261019030000_merge_carries_identity_unmerge_batch.sql
\i supabase/migrations/20261020011000_merge_batch_discovery_url_fill_only.sql
\i supabase/migrations/20261020050500_merge_vin_carry_and_protected_observations.sql
\i supabase/migrations/20261021040000_merge_batch_same_source_image_stays.sql
\i supabase/migrations/20261021170000_merge_gate_reads_every_owner_signal.sql
\i supabase/migrations/20261021200000_merge_carries_records.sql

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. correct_vehicle_vin: a merged-away holder owns nothing; a live holder still does.
-- ---------------------------------------------------------------------------------------------------------------------
INSERT INTO vehicles (id, status, deleted_at, vin) VALUES
  ('00000000-0000-0000-0000-0000000001d0', 'merged', now(), '1G1YY2189J5117603'),
  ('00000000-0000-0000-0000-0000000001a0', 'active', NULL, NULL),
  ('00000000-0000-0000-0000-0000000001b0', 'active', NULL, '2G1FT1EW9A9168675'),
  ('00000000-0000-0000-0000-0000000001c0', 'active', NULL, NULL);
SELECT pg_temp.ok('correct_vehicle_vin fills a VIN whose only other holder is merged away',
  correct_vehicle_vin('00000000-0000-0000-0000-0000000001a0', NULL, '1G1YY2189J5117603',
    '{"type":"merged_duplicate_vin","ref":"vehicles/00000000-0000-0000-0000-0000000001d0","chassis_text":"1G1YY2189J5117603","fill_empty":true}',
    'survivor of a merge that did not carry the VIN') ->> 'status' = 'corrected');
SELECT pg_temp.ok('the survivor now holds the VIN',
  (SELECT vin FROM vehicles WHERE id = '00000000-0000-0000-0000-0000000001a0') = '1G1YY2189J5117603');
SELECT pg_temp.ok('correct_vehicle_vin still answers held_by for a live holder',
  correct_vehicle_vin('00000000-0000-0000-0000-0000000001c0', NULL, '2G1FT1EW9A9168675',
    '{"type":"lot_page","ref":"https://example.test/lot/1","chassis_text":"2G1FT1EW9A9168675","fill_empty":true}',
    'a VIN another live vehicle holds') ->> 'held_by' = '00000000-0000-0000-0000-0000000001b0');

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Batch merge of three pairs.
--    P1 <- D1: P1 has no VIN, trim or listing_url; D1 has them, an observation P1 supersedes, a plain observation and an image.
--    P2 <- D2: two different VINs: refused, D2 stays live.
--    P3 <- D3: D3's chassis number is also held by live vehicle L3: merged, number not carried.
-- ---------------------------------------------------------------------------------------------------------------------
\set P1 '''00000000-0000-0000-0000-0000000002a1'''
\set D1 '''00000000-0000-0000-0000-0000000002d1'''
\set P2 '''00000000-0000-0000-0000-0000000002a2'''
\set D2 '''00000000-0000-0000-0000-0000000002d2'''
\set P3 '''00000000-0000-0000-0000-0000000002a3'''
\set D3 '''00000000-0000-0000-0000-0000000002d3'''
\set L3 '''00000000-0000-0000-0000-0000000002f3'''
\set S '''00000000-0000-0000-0000-00000000005c'''
INSERT INTO vehicles (id, status, vin, year, make, model, trim, listing_url, discovery_url) VALUES
  (:P1, 'active', NULL, 2010, 'Chevrolet', 'Camaro', NULL, NULL, 'https://mecum.com/lots/1/2010-chevrolet-camaro-ss'),
  (:D1, 'active', '2G1FT1EW6A9137982', 2010, 'Chevrolet', 'Camaro', 'SS', 'https://www.mecum.com/lots/1/2010-chevrolet-camaro-ss/', NULL),
  (:P2, 'active', '1C4BJWFG5FL563985', 2015, 'Jeep', 'Wrangler', NULL, 'https://www.mecum.com/lots/2/2015-jeep-wrangler/', NULL),
  (:D2, 'active', '1C4BJWFGXFL688223', 2015, 'Jeep', 'Wrangler', NULL, NULL, 'https://mecum.com/lots/2/2015-jeep-wrangler'),
  (:P3, 'active', NULL, 1985, 'Chevrolet', 'C10', NULL, 'https://www.mecum.com/lots/3/1985-chevrolet-c10/', NULL),
  (:D3, 'active', 'CS1234', 1985, 'Chevrolet', 'C10', NULL, NULL, 'https://mecum.com/lots/3/1985-chevrolet-c10'),
  (:L3, 'active', 'CS1234', 1962, 'Ford', 'Falcon', NULL, NULL, NULL);  -- a short chassis number another make also carries
INSERT INTO vehicle_observations (id, vehicle_id, source_id, source_identifier, kind, observed_at, is_superseded) VALUES
  ('20000000-0000-0000-0000-0000000000a1', :P1, :S, 'lot-1', 'listing', '2026-02-02', false),
  ('20000000-0000-0000-0000-0000000000d1', :D1, :S, 'lot-1', 'listing', '2026-02-01', false),
  ('20000000-0000-0000-0000-0000000000d2', :D1, :S, 'lot-1b', 'listing', '2026-02-01', false);
INSERT INTO vehicle_observations (id, vehicle_id, source_id, source_identifier, kind, observed_at, is_superseded, source_vin, extraction_method) VALUES
  ('20000000-0000-0000-0000-0000000000d3', :D1, :S, 'retained-vin:d1', 'specification', '2026-02-01', false, '2G1FT1EW6A9137982',
   'protected_retained_vin_reference_v1');
INSERT INTO vehicle_images (id, vehicle_id, image_url, file_hash) VALUES ('10000000-0000-0000-0000-0000000000d1', :D1, 'd1.jpg', 'h-d1');

CREATE TABLE pg_temp.res (r jsonb);
INSERT INTO pg_temp.res SELECT merge_into_primary_batch(ARRAY[:P1, :P2, :P3]::uuid[], ARRAY[:D1, :D2, :D3]::uuid[]);
SELECT pg_temp.ok('batch merged two pairs and refused the two-VIN pair: ' || (SELECT r::text FROM pg_temp.res),
  (SELECT (r ->> 'merged_count')::int = 2 AND (r ->> 'vin_conflicts_skipped')::int = 1 AND (r ->> 'vins_carried')::int = 1 FROM pg_temp.res));
SELECT pg_temp.ok('the two-VIN duplicate stays live and unmerged',
  (SELECT status = 'active' AND deleted_at IS NULL FROM vehicles WHERE id = :D2)
  AND NOT EXISTS (SELECT 1 FROM vehicle_merge_proposals WHERE duplicate_vehicle_id = :D2));
SELECT pg_temp.ok('the survivor carries the duplicate''s VIN (upper-case) and the trim and listing_url it lacked',
  (SELECT vin = '2G1FT1EW6A9137982' AND trim = 'SS' AND listing_url = 'https://www.mecum.com/lots/1/2010-chevrolet-camaro-ss/' FROM vehicles WHERE id = :P1));
SELECT pg_temp.ok('a VIN another live vehicle holds is not carried',
  (SELECT vin IS NULL FROM vehicles WHERE id = :P3));
SELECT pg_temp.ok('the retained VIN reference stays on the merged duplicate; the plain observations moved, one superseded',
  (SELECT vehicle_id FROM vehicle_observations WHERE id = '20000000-0000-0000-0000-0000000000d3') = :D1
  AND (SELECT vehicle_id = :P1 AND is_superseded AND superseded_by = '20000000-0000-0000-0000-0000000000a1'
         FROM vehicle_observations WHERE id = '20000000-0000-0000-0000-0000000000d1')
  AND (SELECT vehicle_id = :P1 AND NOT is_superseded FROM vehicle_observations WHERE id = '20000000-0000-0000-0000-0000000000d2'));
SELECT pg_temp.ok('the journal names the supersession and every survivor column the merge filled',
  (SELECT merge_journal -> 'observations_superseded' = '[{"id":"20000000-0000-0000-0000-0000000000d1","by":"20000000-0000-0000-0000-0000000000a1"}]'::jsonb
      AND merge_journal -> 'survivor_filled' = '{"vin":"2G1FT1EW6A9137982","trim":"SS","listing_url":"https://www.mecum.com/lots/1/2010-chevrolet-camaro-ss/"}'::jsonb
     FROM vehicle_merge_proposals WHERE duplicate_vehicle_id = :D1));

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Unmerge the journaled batch merge: the survivor gives back what the merge filled, the duplicate is whole again.
-- ---------------------------------------------------------------------------------------------------------------------
DELETE FROM pg_temp.res;
INSERT INTO pg_temp.res SELECT unmerge_vehicle((SELECT id FROM vehicle_merge_proposals WHERE duplicate_vehicle_id = :D1), 'contract: two cars');
SELECT pg_temp.ok('unmerge of a journaled batch merge ran: ' || (SELECT r::text FROM pg_temp.res),
  (SELECT r ->> 'success' = 'true' AND (r ->> 'observations_returned')::int = 2 AND (r ->> 'observations_unsuperseded')::int = 1
          AND (r ->> 'images_returned')::int = 1 FROM pg_temp.res));
SELECT pg_temp.ok('the survivor no longer holds the VIN, trim or listing_url the merge filled',
  (SELECT vin IS NULL AND trim IS NULL AND listing_url IS NULL FROM vehicles WHERE id = :P1));
SELECT pg_temp.ok('the duplicate is restored with its own VIN and listing_url',
  (SELECT status = 'active' AND deleted_at IS NULL AND merged_into_vehicle_id IS NULL AND vin = '2G1FT1EW6A9137982'
          AND listing_url = 'https://www.mecum.com/lots/1/2010-chevrolet-camaro-ss/' FROM vehicles WHERE id = :D1));
SELECT pg_temp.ok('the superseded observation is live again and back on the duplicate',
  (SELECT vehicle_id = :D1 AND NOT is_superseded AND superseded_by IS NULL FROM vehicle_observations WHERE id = '20000000-0000-0000-0000-0000000000d1'));
SELECT pg_temp.ok('the proposal is unmerged and its journal records what the unmerge reverted',
  (SELECT status = 'unmerged' AND merge_journal -> 'unmerge' -> 'survivor_reverted' ? 'vin' AND merge_journal -> 'unmerge' ->> 'reason' = 'contract: two cars'
     FROM vehicle_merge_proposals WHERE duplicate_vehicle_id = :D1));

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. A journal-less batch merge (the 2026-10-17 version): supersessions are derived; the duplicate's listing_url, now held by
--    the survivor, is parked; a survivor holding the duplicate's own VIN is refused.
-- ---------------------------------------------------------------------------------------------------------------------
\set P4 '''00000000-0000-0000-0000-0000000004a1'''
\set D4 '''00000000-0000-0000-0000-0000000004d1'''
INSERT INTO vehicles (id, status, vin, year, make, listing_url, discovery_url) VALUES
  (:P4, 'active', '1G1AY0788C5117947', 1982, 'Chevrolet', NULL, 'https://mecum.com/lots/4/1982-chevrolet-corvette'),
  (:D4, 'active', '1G1AP87H0CL192817', 1982, 'Chevrolet', 'https://mecum.com/lots/4/1982-chevrolet-corvette', NULL);
INSERT INTO vehicle_observations (id, vehicle_id, source_id, source_identifier, kind, observed_at, is_superseded) VALUES
  ('40000000-0000-0000-0000-0000000000a1', :P4, :S, 'lot-4', 'listing', '2026-02-02', false),
  ('40000000-0000-0000-0000-0000000000d1', :D4, :S, 'lot-4', 'listing', '2026-02-01', false);
-- The VIN refusal is the new rule; the journal-less version merged this pair. Merge it as that version did, then drop the journal.
UPDATE vehicles SET vin = NULL WHERE id = :D4;
SELECT pg_temp.ok('fixture: the pair merges', (merge_into_primary_batch(ARRAY[:P4]::uuid[], ARRAY[:D4]::uuid[]) ->> 'merged_count')::int = 1);
UPDATE vehicles SET vin = '1G1AP87H0CL192817' WHERE id = :D4;
UPDATE vehicle_merge_proposals SET merge_journal = NULL WHERE duplicate_vehicle_id = :D4;
SELECT pg_temp.ok('fixture: the survivor took the duplicate''s listing_url',
  (SELECT listing_url FROM vehicles WHERE id = :P4) = 'https://mecum.com/lots/4/1982-chevrolet-corvette');

DELETE FROM pg_temp.res;
INSERT INTO pg_temp.res SELECT unmerge_vehicle((SELECT id FROM vehicle_merge_proposals WHERE duplicate_vehicle_id = :D4), 'contract: journal-less');
SELECT pg_temp.ok('unmerge of a journal-less batch merge ran with derived supersessions: ' || (SELECT r::text FROM pg_temp.res),
  (SELECT r ->> 'success' = 'true' AND (r ->> 'observations_unsuperseded')::int = 1
          AND r ->> 'dup_listing_url_parked' = 'https://mecum.com/lots/4/1982-chevrolet-corvette' FROM pg_temp.res));
SELECT pg_temp.ok('the duplicate is live with its VIN; the survivor keeps the listing_url',
  (SELECT status = 'active' AND deleted_at IS NULL AND listing_url IS NULL AND vin = '1G1AP87H0CL192817' FROM vehicles WHERE id = :D4)
  AND (SELECT listing_url FROM vehicles WHERE id = :P4) = 'https://mecum.com/lots/4/1982-chevrolet-corvette');
SELECT pg_temp.ok('the derived journal is kept on the proposal with the parked URL',
  (SELECT merge_journal ->> 'derived_at_unmerge' = 'true'
          AND merge_journal -> 'unmerge' ->> 'dup_listing_url_parked' = 'https://mecum.com/lots/4/1982-chevrolet-corvette'
     FROM vehicle_merge_proposals WHERE duplicate_vehicle_id = :D4));

\set P5 '''00000000-0000-0000-0000-0000000005a1'''
\set D5 '''00000000-0000-0000-0000-0000000005d1'''
INSERT INTO vehicles (id, status, vin, merged_into_vehicle_id, deleted_at) VALUES (:D5, 'merged', '1FMNU40L1YED53580', :P5, now());
INSERT INTO vehicles (id, status, vin) VALUES (:P5, 'active', '1FMNU40L1YED53580');
INSERT INTO vehicle_merge_proposals (primary_vehicle_id, duplicate_vehicle_id, match_type, status, detected_by, merged_at)
VALUES (:P5, :D5, 'exact_listing_url', 'merged', 'dedup-worker', '2026-10-17 20:00:00+00');
SELECT pg_temp.ok('unmerge refuses while the survivor holds the duplicate''s VIN on its own record',
  unmerge_vehicle((SELECT id FROM vehicle_merge_proposals WHERE duplicate_vehicle_id = :D5)) ->> 'error' = 'vin_shared');
SELECT pg_temp.ok('the refused duplicate stays merged', (SELECT status FROM vehicles WHERE id = :D5) = 'merged');

INSERT INTO vehicles (id, status) VALUES ('00000000-0000-0000-0000-0000000006a1', 'active'), ('00000000-0000-0000-0000-0000000006d1', 'merged');
INSERT INTO vehicle_merge_proposals (primary_vehicle_id, duplicate_vehicle_id, status, merged_at)
VALUES ('00000000-0000-0000-0000-0000000006a1', '00000000-0000-0000-0000-0000000006d1', 'merged', '2026-06-01');
SELECT pg_temp.ok('an older merge with no journal is still refused with no_journal',
  unmerge_vehicle((SELECT id FROM vehicle_merge_proposals WHERE duplicate_vehicle_id = '00000000-0000-0000-0000-0000000006d1')) ->> 'error' = 'no_journal');

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. propose_listing_vin_merge records the calling writer.
-- ---------------------------------------------------------------------------------------------------------------------
INSERT INTO vehicles (id, status) VALUES ('00000000-0000-0000-0000-0000000007b1', 'active');
SELECT set_config('app.writer', 'mecum-vin-conflict-closeout', false);
CREATE TABLE pg_temp.filed (id uuid);
INSERT INTO pg_temp.filed SELECT propose_listing_vin_merge(:P5, '00000000-0000-0000-0000-0000000007b1', '1FMNU40L1YED53580', 'same VIN on both lot pages');
SELECT pg_temp.ok('a filed proposal names the writer from app.writer',
  (SELECT proposed_by = 'mecum-vin-conflict-closeout' AND status = 'pending' AND ai_decision = 'REVIEW'
     FROM merge_proposals WHERE id = (SELECT id FROM pg_temp.filed)));
SELECT set_config('app.writer', '', false);

SELECT pg_temp.ok('writers are service-role only; unmerge_vehicle is also open to signed-in editors (it checks them itself)',
  NOT has_function_privilege('authenticated', 'correct_vehicle_vin(uuid,text,text,jsonb,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'merge_into_primary_batch(uuid[],uuid[])', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'merge_into_primary_batch(uuid[],uuid[])', 'EXECUTE')
  AND has_function_privilege('service_role', 'merge_into_primary_batch(uuid[],uuid[])', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'propose_listing_vin_merge(uuid,uuid,text,text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'unmerge_vehicle(uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'unmerge_vehicle(uuid,text)', 'EXECUTE'));

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. A primary whose www. URL canonicalizes onto the duplicate's URL still merges (live canonicalize trigger shape).
-- ---------------------------------------------------------------------------------------------------------------------
CREATE FUNCTION pg_temp.canon(u text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(regexp_replace(u, '^(https?://)www\.', '\1'), '/+$', '') $$;
CREATE FUNCTION public.tg_canonicalize_test_discovery_url() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.discovery_url IS NOT NULL THEN NEW.discovery_url := pg_temp.canon(NEW.discovery_url); END IF; RETURN NEW;
END $$;
INSERT INTO vehicles (id, status, vin, year, make, model, discovery_url) VALUES
  ('00000000-0000-0000-0000-0000000008a1', 'active', 'F 251', 1903, 'Packard', 'Model F', 'https://www.goodingco.com/lot/1903-packard-model-f'),
  ('00000000-0000-0000-0000-0000000008d1', 'active', NULL, 1903, 'Packard', 'Model F', 'https://goodingco.com/lot/1903-packard-model-f');
CREATE TRIGGER vehicles_canonicalize_discovery_url BEFORE INSERT OR UPDATE OF discovery_url ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.tg_canonicalize_test_discovery_url();
CREATE TABLE pg_temp.www_merge AS
  SELECT merge_into_primary_batch(ARRAY['00000000-0000-0000-0000-0000000008a1']::uuid[], ARRAY['00000000-0000-0000-0000-0000000008d1']::uuid[]) r;
SELECT pg_temp.ok('a www. primary merges a duplicate holding the canonical URL; the primary keeps its own URL',
  (SELECT (r ->> 'merged_count')::int FROM pg_temp.www_merge) = 1
  AND (SELECT discovery_url FROM vehicles WHERE id = '00000000-0000-0000-0000-0000000008a1') = 'https://www.goodingco.com/lot/1903-packard-model-f'
  AND (SELECT status FROM vehicles WHERE id = '00000000-0000-0000-0000-0000000008d1') = 'merged');
DROP TRIGGER vehicles_canonicalize_discovery_url ON public.vehicles;

-- ---------------------------------------------------------------------------------------------------------------------
-- 7. Re-posted listings: hash-less photos the survivor already holds (by image_url) stay on the duplicate, and a photo two
--    sibling duplicates both carry moves once (the one with the smaller id). 20261021040000.
--    P7 holds x, y.   D7a (smaller image ids): x, y (held by P7), a, b.   D7b: x (held by P7), a (D7a's smaller-id copy moves), c.
--    D7c: a photo with no image_url and a photo with a file_hash: both still move (the rule is for hash-less photos with a URL).
-- ---------------------------------------------------------------------------------------------------------------------
INSERT INTO vehicles (id, status, year, make, model) VALUES
  ('00000000-0000-0000-0000-0000000009a1', 'active', 1978, 'Buick', 'Electra LTD'),
  ('00000000-0000-0000-0000-0000000009d1', 'active', 1978, 'Buick', 'Electra LTD'),
  ('00000000-0000-0000-0000-0000000009d2', 'active', 1978, 'Buick', 'Electra LTD'),
  ('00000000-0000-0000-0000-0000000009d3', 'active', 1978, 'Buick', 'Electra LTD');
INSERT INTO vehicle_images (id, vehicle_id, image_url, file_hash) VALUES
  ('91000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000009a1', 'https://images.example.test/x.jpg', NULL),
  ('91000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000009a1', 'https://images.example.test/y.jpg', NULL),
  ('91000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000009d1', 'https://images.example.test/x.jpg', NULL),
  ('91000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000009d1', 'https://images.example.test/y.jpg', NULL),
  ('91000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000009d1', 'https://images.example.test/a.jpg', NULL),
  ('91000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000009d1', 'https://images.example.test/b.jpg', NULL),
  ('91000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000009d2', 'https://images.example.test/x.jpg', NULL),
  ('91000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000009d2', 'https://images.example.test/a.jpg', NULL),
  ('91000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000009d2', 'https://images.example.test/c.jpg', NULL),
  ('91000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000009d3', NULL, NULL),
  ('91000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000009d3', 'https://images.example.test/x.jpg', 'h-d3');
CREATE TABLE pg_temp.repost_merge AS
  SELECT merge_into_primary_batch(
    ARRAY['00000000-0000-0000-0000-0000000009a1', '00000000-0000-0000-0000-0000000009a1', '00000000-0000-0000-0000-0000000009a1']::uuid[],
    ARRAY['00000000-0000-0000-0000-0000000009d1', '00000000-0000-0000-0000-0000000009d2', '00000000-0000-0000-0000-0000000009d3']::uuid[]) r;
SELECT pg_temp.ok('the three re-posts merged', (SELECT (r ->> 'merged_count')::int = 3 FROM pg_temp.repost_merge));
SELECT pg_temp.ok('images: the survivor holds its two photos plus one copy each of a, b, c (and D7c''s two); no photo twice',
  (SELECT count(*) FROM vehicle_images WHERE vehicle_id = '00000000-0000-0000-0000-0000000009a1') = 7
  AND (SELECT count(DISTINCT image_url) FROM vehicle_images WHERE vehicle_id = '00000000-0000-0000-0000-0000000009a1' AND image_url IS NOT NULL AND file_hash IS NULL) = 5
  AND (SELECT count(*) FROM vehicle_images WHERE vehicle_id = '00000000-0000-0000-0000-0000000009a1' AND image_url = 'https://images.example.test/a.jpg') = 1);
SELECT pg_temp.ok('the photos the survivor already held stay on the duplicates, unstamped, nothing deleted',
  (SELECT vehicle_id = '00000000-0000-0000-0000-0000000009d1' AND merged_from_vehicle_id IS NULL FROM vehicle_images WHERE id = '91000000-0000-0000-0000-0000000000a1')
  AND (SELECT vehicle_id = '00000000-0000-0000-0000-0000000009d2' AND merged_from_vehicle_id IS NULL FROM vehicle_images WHERE id = '91000000-0000-0000-0000-0000000000b1')
  AND (SELECT vehicle_id = '00000000-0000-0000-0000-0000000009d2' FROM vehicle_images WHERE id = '91000000-0000-0000-0000-0000000000b2')
  AND (SELECT count(*) FROM vehicle_images WHERE id::text LIKE '91000000%') = 11);
SELECT pg_temp.ok('the photo two duplicates carry moved once: D7a''s copy (smaller id) moved, D7b''s stayed',
  (SELECT vehicle_id = '00000000-0000-0000-0000-0000000009a1' AND merged_from_vehicle_id = '00000000-0000-0000-0000-0000000009d1' FROM vehicle_images WHERE id = '91000000-0000-0000-0000-0000000000a3'));
SELECT pg_temp.ok('a photo with no URL and a photo with a file_hash both still move',
  (SELECT count(*) FROM vehicle_images WHERE id IN ('91000000-0000-0000-0000-0000000000c1', '91000000-0000-0000-0000-0000000000c2')
     AND vehicle_id = '00000000-0000-0000-0000-0000000009a1' AND merged_from_vehicle_id = '00000000-0000-0000-0000-0000000009d3') = 2);

-- ---------------------------------------------------------------------------------------------------------------------
-- 8. Gate 2 reads every owner signal (20261021170000), not user_id alone. Nine pairs in one call:
--    A user_id on the duplicate   B owner_id on the duplicate   C uploaded_by on the primary   D active owner permission on the primary
--    E active co_owner permission on the duplicate   -> refused (no approved, reviewed proposal)
--    F inactive owner permission   G active contributor permission   I no signal   -> merged
--    H owner_id on the duplicate WITH an approved, reviewed proposal (filed the other way round)   -> merged
-- ---------------------------------------------------------------------------------------------------------------------
INSERT INTO vehicles (id, status, year, make, model, user_id, owner_id, uploaded_by) VALUES
  ('00000000-0000-0000-0000-00000000b0a1', 'active', 1971, 'Ford', 'Bronco', NULL, NULL, NULL), ('00000000-0000-0000-0000-00000000b0d1', 'active', 1971, 'Ford', 'Bronco', '00000000-0000-0000-0000-0000000000f1', NULL, NULL),
  ('00000000-0000-0000-0000-00000000b0a2', 'active', 1972, 'Ford', 'Bronco', NULL, NULL, NULL), ('00000000-0000-0000-0000-00000000b0d2', 'active', 1972, 'Ford', 'Bronco', NULL, '00000000-0000-0000-0000-0000000000f1', NULL),
  ('00000000-0000-0000-0000-00000000b0a3', 'active', 1973, 'Ford', 'Bronco', NULL, NULL, '00000000-0000-0000-0000-0000000000f1'), ('00000000-0000-0000-0000-00000000b0d3', 'active', 1973, 'Ford', 'Bronco', NULL, NULL, NULL),
  ('00000000-0000-0000-0000-00000000b0a4', 'active', 1974, 'Ford', 'Bronco', NULL, NULL, NULL), ('00000000-0000-0000-0000-00000000b0d4', 'active', 1974, 'Ford', 'Bronco', NULL, NULL, NULL),
  ('00000000-0000-0000-0000-00000000b0a5', 'active', 1975, 'Ford', 'Bronco', NULL, NULL, NULL), ('00000000-0000-0000-0000-00000000b0d5', 'active', 1975, 'Ford', 'Bronco', NULL, NULL, NULL),
  ('00000000-0000-0000-0000-00000000b0a6', 'active', 1976, 'Ford', 'Bronco', NULL, NULL, NULL), ('00000000-0000-0000-0000-00000000b0d6', 'active', 1976, 'Ford', 'Bronco', NULL, NULL, NULL),
  ('00000000-0000-0000-0000-00000000b0a7', 'active', 1977, 'Ford', 'Bronco', NULL, NULL, NULL), ('00000000-0000-0000-0000-00000000b0d7', 'active', 1977, 'Ford', 'Bronco', NULL, NULL, NULL),
  ('00000000-0000-0000-0000-00000000b0a8', 'active', 1978, 'Ford', 'Bronco', NULL, NULL, NULL), ('00000000-0000-0000-0000-00000000b0d8', 'active', 1978, 'Ford', 'Bronco', NULL, '00000000-0000-0000-0000-0000000000f1', NULL),
  ('00000000-0000-0000-0000-00000000b0a9', 'active', 1979, 'Ford', 'Bronco', NULL, NULL, NULL), ('00000000-0000-0000-0000-00000000b0d9', 'active', 1979, 'Ford', 'Bronco', NULL, NULL, NULL);
INSERT INTO vehicle_user_permissions (vehicle_id, user_id, role, is_active) VALUES
  ('00000000-0000-0000-0000-00000000b0a4', '00000000-0000-0000-0000-0000000000f1', 'owner', true),
  ('00000000-0000-0000-0000-00000000b0d5', '00000000-0000-0000-0000-0000000000f1', 'co_owner', true),
  ('00000000-0000-0000-0000-00000000b0d6', '00000000-0000-0000-0000-0000000000f1', 'owner', false),
  ('00000000-0000-0000-0000-00000000b0d7', '00000000-0000-0000-0000-0000000000f1', 'contributor', true);
INSERT INTO vehicle_merge_proposals (primary_vehicle_id, duplicate_vehicle_id, match_type, status, reviewed_by)
  VALUES ('00000000-0000-0000-0000-00000000b0d8', '00000000-0000-0000-0000-00000000b0a8', 'owner_approved', 'approved', '00000000-0000-0000-0000-0000000000f1');
CREATE TABLE pg_temp.owner_gate AS SELECT merge_into_primary_batch(
  ARRAY(SELECT ('00000000-0000-0000-0000-00000000b0a' || n)::uuid FROM unnest(ARRAY['1','2','3','4','5','6','7','8','9']) n ORDER BY n),
  ARRAY(SELECT ('00000000-0000-0000-0000-00000000b0d' || n)::uuid FROM unnest(ARRAY['1','2','3','4','5','6','7','8','9']) n ORDER BY n)) r;
SELECT pg_temp.ok('four of nine pairs merge: inactive owner permission, contributor permission, an approved owner pair and a pair with no signal',
  (SELECT (r ->> 'merged_count')::int = 4 FROM pg_temp.owner_gate));
SELECT pg_temp.ok('refused without approval: user_id, owner_id, uploaded_by, an active owner permission and an active co_owner permission',
  (SELECT count(*) FROM vehicles WHERE id IN ('00000000-0000-0000-0000-00000000b0d1', '00000000-0000-0000-0000-00000000b0d2', '00000000-0000-0000-0000-00000000b0d3',
     '00000000-0000-0000-0000-00000000b0d4', '00000000-0000-0000-0000-00000000b0d5') AND status = 'active' AND merged_into_vehicle_id IS NULL) = 5);
SELECT pg_temp.ok('merged: F inactive owner permission, G contributor permission, H approved owner pair, I no signal',
  (SELECT count(*) FROM vehicles WHERE id IN ('00000000-0000-0000-0000-00000000b0d6', '00000000-0000-0000-0000-00000000b0d7', '00000000-0000-0000-0000-00000000b0d8', '00000000-0000-0000-0000-00000000b0d9')
     AND status = 'merged') = 4);

-- ---------------------------------------------------------------------------------------------------------------------
-- 9. A merge carries the records about the car and its people (20261021200000); unmerge returns exactly those rows.
--    P9 survivor (unowned), D9 duplicate (owner_id O1, approved proposal, filed the other way round).
--    work_sessions: D9 has t1 (P9 holds t1 too) and t2        -> t2 moves, t1 stays
--    receipts: one by vehicle_id, one named only by scope     -> both move;  payment_events: scope vehicle moves, scope user does not
--    permissions: D9 has U1 owner and U2 contributor, P9 has U2 -> U1 moves, U2 stays
--    organization_vehicles: D9 (org1 owner, org2 sold_by), P9 (org1 owner) -> org2 sold_by moves
--    vehicle_listings: D9 active (P9 has one active) stays, D9 draft moves
--    qb_transactions: a trigger refuses the move -> recorded in carry.errors, the row stays, the merge still happens
--    evidence_runs naming D9 is never touched
-- ---------------------------------------------------------------------------------------------------------------------
\set P9 '''00000000-0000-0000-0000-00000000c9a1'''
\set D9 '''00000000-0000-0000-0000-00000000c9d1'''
\set O1 '''00000000-0000-0000-0000-0000000000a9'''
INSERT INTO vehicles (id, status, year, make, model, owner_id) VALUES (:P9, 'active', 1966, 'Ford', 'Mustang', NULL), (:D9, 'active', 1966, 'Ford', 'Mustang', :O1);
INSERT INTO vehicle_merge_proposals (primary_vehicle_id, duplicate_vehicle_id, match_type, status, reviewed_by)
  VALUES (:D9, :P9, 'owner_approved', 'approved', '00000000-0000-0000-0000-0000000000a9');
INSERT INTO work_sessions (id, vehicle_id, start_time, title) VALUES
  ('c9000000-0000-0000-0000-000000000001', :P9, '2025-05-01 08:00+00', 'P9 own day'),
  ('c9000000-0000-0000-0000-0000000000d1', :D9, '2025-05-01 08:00+00', 'D9 same day, titled K10'),
  ('c9000000-0000-0000-0000-0000000000d2', :D9, '2025-05-02 08:00+00', 'D9 second day, titled K10');
INSERT INTO receipts (id, vehicle_id, scope_type, scope_id, total) VALUES
  ('c9100000-0000-0000-0000-0000000000d1', :D9, NULL, NULL, 125.50),
  ('c9100000-0000-0000-0000-0000000000d2', NULL, 'vehicle', '00000000-0000-0000-0000-00000000c9d1', 40.00);
INSERT INTO payment_events (id, scope_type, scope_id, amount) VALUES
  ('c9200000-0000-0000-0000-0000000000d1', 'vehicle', :D9, 900),
  ('c9200000-0000-0000-0000-0000000000d2', 'user', :D9, 5);
INSERT INTO vehicle_user_permissions (id, vehicle_id, user_id, role, is_active) VALUES
  ('c9300000-0000-0000-0000-000000000001', :P9, '00000000-0000-0000-0000-0000000000b2', 'contributor', true),
  ('c9300000-0000-0000-0000-0000000000d1', :D9, '00000000-0000-0000-0000-0000000000b1', 'owner', true),
  ('c9300000-0000-0000-0000-0000000000d2', :D9, '00000000-0000-0000-0000-0000000000b2', 'contributor', true);
INSERT INTO organization_vehicles (id, organization_id, vehicle_id, relationship_type) VALUES
  ('c9400000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1', :P9, 'owner'),
  ('c9400000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', :D9, 'owner'),
  ('c9400000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c2', :D9, 'sold_by');
INSERT INTO vehicle_listings (id, vehicle_id, status) VALUES
  ('c9500000-0000-0000-0000-000000000001', :P9, 'active'),
  ('c9500000-0000-0000-0000-0000000000d1', :D9, 'active'),
  ('c9500000-0000-0000-0000-0000000000d2', :D9, 'draft');
INSERT INTO qb_transactions (id, vehicle_id, amount) VALUES ('c9600000-0000-0000-0000-0000000000d1', :D9, 77);
INSERT INTO evidence_runs (id, named_vehicle_id, vehicle_id) VALUES ('c9700000-0000-0000-0000-0000000000d1', :D9, :D9);
CREATE TABLE pg_temp.carry_run AS SELECT merge_into_primary_batch(ARRAY[:P9]::uuid[], ARRAY[:D9]::uuid[]) r;
SELECT pg_temp.ok('the pair merged and the batch reports the rows it carried',
  (SELECT (r ->> 'merged_count')::int = 1 AND (r ->> 'carried_rows')::int = 7 FROM pg_temp.carry_run));
SELECT pg_temp.ok('work_sessions: the new day moved with its title untouched; the day the survivor holds stayed on the duplicate',
  (SELECT vehicle_id = :P9 AND title = 'D9 second day, titled K10' FROM work_sessions WHERE id = 'c9000000-0000-0000-0000-0000000000d2')
  AND (SELECT vehicle_id = :D9 FROM work_sessions WHERE id = 'c9000000-0000-0000-0000-0000000000d1'));
SELECT pg_temp.ok('receipts follow by vehicle_id and by scope; amounts are untouched',
  (SELECT vehicle_id = :P9 AND total = 125.50 FROM receipts WHERE id = 'c9100000-0000-0000-0000-0000000000d1')
  AND (SELECT scope_id = '00000000-0000-0000-0000-00000000c9a1' AND total = 40.00 FROM receipts WHERE id = 'c9100000-0000-0000-0000-0000000000d2'));
SELECT pg_temp.ok('payment_events: the vehicle-scoped row follows, a user-scoped row with the same id does not',
  (SELECT scope_id = :P9 AND amount = 900 FROM payment_events WHERE id = 'c9200000-0000-0000-0000-0000000000d1')
  AND (SELECT scope_id = :D9 FROM payment_events WHERE id = 'c9200000-0000-0000-0000-0000000000d2'));
SELECT pg_temp.ok('permissions: the owner row moved (the owner link), the contributor the survivor already had stayed',
  (SELECT vehicle_id = :P9 FROM vehicle_user_permissions WHERE id = 'c9300000-0000-0000-0000-0000000000d1')
  AND (SELECT vehicle_id = :D9 FROM vehicle_user_permissions WHERE id = 'c9300000-0000-0000-0000-0000000000d2'));
SELECT pg_temp.ok('organization links: the new relationship moved, the one the survivor holds stayed',
  (SELECT vehicle_id = :P9 FROM organization_vehicles WHERE id = 'c9400000-0000-0000-0000-0000000000d2')
  AND (SELECT vehicle_id = :D9 FROM organization_vehicles WHERE id = 'c9400000-0000-0000-0000-0000000000d1'));
SELECT pg_temp.ok('listings: the draft moved; a second active listing stayed (one active per vehicle)',
  (SELECT vehicle_id = :P9 FROM vehicle_listings WHERE id = 'c9500000-0000-0000-0000-0000000000d2')
  AND (SELECT vehicle_id = :D9 FROM vehicle_listings WHERE id = 'c9500000-0000-0000-0000-0000000000d1'));
SELECT pg_temp.ok('a table whose carry fails is recorded and skipped; the merge still happened',
  (SELECT vehicle_id = :D9 FROM qb_transactions WHERE id = 'c9600000-0000-0000-0000-0000000000d1')
  AND (SELECT merge_journal -> 'carry' -> 'errors' ? 'qb_transactions' FROM vehicle_merge_proposals WHERE primary_vehicle_id = :D9 AND duplicate_vehicle_id = :P9 OR primary_vehicle_id = :P9 AND duplicate_vehicle_id = :D9 ORDER BY merged_at NULLS LAST LIMIT 1)
  AND (SELECT status = 'merged' FROM vehicles WHERE id = :D9));
SELECT pg_temp.ok('the owner link filled the unowned survivor and is journaled',
  (SELECT owner_id = :O1 FROM vehicles WHERE id = :P9)
  AND (SELECT merge_journal -> 'carry' -> 'owner_filled' ->> 'owner_id' = '00000000-0000-0000-0000-0000000000a9'
         FROM vehicle_merge_proposals WHERE status = 'merged' AND duplicate_vehicle_id = :D9));
SELECT pg_temp.ok('evidence tables are never carried',
  (SELECT named_vehicle_id = :D9 AND vehicle_id = :D9 FROM evidence_runs WHERE id = 'c9700000-0000-0000-0000-0000000000d1'));
-- a row added to the survivor after the merge must stay through the unmerge
INSERT INTO work_sessions (id, vehicle_id, start_time, title) VALUES ('c9000000-0000-0000-0000-00000000f001', :P9, '2025-06-01 08:00+00', 'added after the merge');
CREATE TABLE pg_temp.carry_unmerge AS
  SELECT unmerge_vehicle((SELECT id FROM vehicle_merge_proposals WHERE status = 'merged' AND duplicate_vehicle_id = :D9), 'contract: carry') r;
SELECT pg_temp.ok('unmerge ran and reports what came back',
  (SELECT r ->> 'success' = 'true' AND (r -> 'carry_returned' ->> 'work_sessions')::int = 1 FROM pg_temp.carry_unmerge));
SELECT pg_temp.ok('unmerge returned exactly the carried rows and the owner link; the survivor kept its own rows and the one added after the merge',
  (SELECT vehicle_id = :D9 FROM work_sessions WHERE id = 'c9000000-0000-0000-0000-0000000000d2')
  AND (SELECT vehicle_id = :P9 FROM work_sessions WHERE id IN ('c9000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-00000000f001') GROUP BY vehicle_id HAVING count(*) = 2)
  AND (SELECT vehicle_id = :D9 FROM receipts WHERE id = 'c9100000-0000-0000-0000-0000000000d1')
  AND (SELECT scope_id = '00000000-0000-0000-0000-00000000c9d1' FROM receipts WHERE id = 'c9100000-0000-0000-0000-0000000000d2')
  AND (SELECT scope_id = :D9 FROM payment_events WHERE id = 'c9200000-0000-0000-0000-0000000000d1')
  AND (SELECT vehicle_id = :D9 FROM vehicle_user_permissions WHERE id = 'c9300000-0000-0000-0000-0000000000d1')
  AND (SELECT vehicle_id = :D9 FROM organization_vehicles WHERE id = 'c9400000-0000-0000-0000-0000000000d2')
  AND (SELECT vehicle_id = :D9 FROM vehicle_listings WHERE id = 'c9500000-0000-0000-0000-0000000000d2')
  AND (SELECT vehicle_id = :P9 FROM vehicle_user_permissions WHERE id = 'c9300000-0000-0000-0000-000000000001')
  AND (SELECT owner_id IS NULL FROM vehicles WHERE id = :P9)
  AND (SELECT owner_id = :O1 AND status = 'active' FROM vehicles WHERE id = :D9));

-- Two different owners are two vehicles' owners: refused, nothing moves.
INSERT INTO vehicles (id, status, year, make, model, owner_id) VALUES
  ('00000000-0000-0000-0000-00000000c9a2', 'active', 1967, 'Ford', 'Mustang', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000c9d2', 'active', 1967, 'Ford', 'Mustang', '00000000-0000-0000-0000-0000000000a2');
INSERT INTO vehicle_merge_proposals (primary_vehicle_id, duplicate_vehicle_id, match_type, status, reviewed_by)
  VALUES ('00000000-0000-0000-0000-00000000c9a2', '00000000-0000-0000-0000-00000000c9d2', 'owner_approved', 'approved', '00000000-0000-0000-0000-0000000000a9');
INSERT INTO receipts (id, vehicle_id, total) VALUES ('c9100000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c9d2', 1);
SELECT pg_temp.ok('two different owners: the batch refuses the pair even with an approved proposal, and nothing is carried',
  (merge_into_primary_batch(ARRAY['00000000-0000-0000-0000-00000000c9a2']::uuid[], ARRAY['00000000-0000-0000-0000-00000000c9d2']::uuid[]) ->> 'merged_count')::int = 0
  AND (SELECT status = 'active' FROM vehicles WHERE id = '00000000-0000-0000-0000-00000000c9d2')
  AND (SELECT vehicle_id = '00000000-0000-0000-0000-00000000c9d2' FROM receipts WHERE id = 'c9100000-0000-0000-0000-0000000000e1'));

-- A merge that ran before this migration is completed from its proposal, once, and an owned pair needs a reviewed proposal.
INSERT INTO vehicles (id, status, year, make, model, merged_into_vehicle_id, deleted_at) VALUES
  ('00000000-0000-0000-0000-00000000c9a3', 'active', 1968, 'Ford', 'Mustang', NULL, NULL),
  ('00000000-0000-0000-0000-00000000c9d3', 'merged', 1968, 'Ford', 'Mustang', '00000000-0000-0000-0000-00000000c9a3', now());
INSERT INTO work_sessions (id, vehicle_id, start_time) VALUES ('c9000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-00000000c9d3', '2025-07-01 08:00+00');
INSERT INTO vehicle_merge_proposals (id, primary_vehicle_id, duplicate_vehicle_id, match_type, status, merge_journal)
  VALUES ('c9800000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000c9a3', '00000000-0000-0000-0000-00000000c9d3', 'exact_listing_url', 'merged', '{"method": "merge_into_primary"}'::jsonb);
CREATE TABLE pg_temp.late_carry AS SELECT carry_children_for_merged_pair('c9800000-0000-0000-0000-000000000003') r;
SELECT pg_temp.ok('an older merge is completed from its proposal: rows moved, the result journaled, and a second call is a no-op',
  (SELECT (r ->> 'carried')::boolean FROM pg_temp.late_carry)
  AND (SELECT vehicle_id = '00000000-0000-0000-0000-00000000c9a3' FROM work_sessions WHERE id = 'c9000000-0000-0000-0000-0000000000e3')
  AND (SELECT merge_journal -> 'carry' -> 'carried' ? 'work_sessions' FROM vehicle_merge_proposals WHERE id = 'c9800000-0000-0000-0000-000000000003')
  AND (SELECT (carry_children_for_merged_pair('c9800000-0000-0000-0000-000000000003') ->> 'already_carried')::boolean));
SELECT pg_temp.ok('the carry helpers are service_role only',
  has_function_privilege('service_role', 'merge_carry_children(uuid,uuid,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'merge_carry_children(uuid,uuid,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'merge_carry_children(uuid,uuid,boolean)', 'EXECUTE')
  AND has_function_privilege('service_role', 'carry_children_for_merged_pair(uuid,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'carry_children_for_merged_pair(uuid,boolean)', 'EXECUTE'));
