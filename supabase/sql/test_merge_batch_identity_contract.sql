-- Isolated PostgreSQL 17 contract for 20261019030000_merge_carries_identity_unmerge_batch.sql. Synthetic rows only; never production.
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
  id uuid PRIMARY KEY, status text, merged_into_vehicle_id uuid, deleted_at timestamptz, user_id uuid, image_count integer,
  has_photos boolean, vin text, year integer, make text, model text, trim text, series text, generation text, body_style text,
  engine_size text, engine_type text, drivetrain text, fuel_type text, listing_url text, discovery_url text, primary_image_url text,
  sale_date date, color text, interior_color text, transmission text, description text);
CREATE UNIQUE INDEX vehicles_vin_unique_17char_v2 ON public.vehicles (vin)
  WHERE vin IS NOT NULL AND length(vin) = 17 AND status IS DISTINCT FROM 'merged';
CREATE UNIQUE INDEX idx_vehicles_listing_url_unique ON public.vehicles (listing_url)
  WHERE deleted_at IS NULL AND listing_url IS NOT NULL AND listing_url <> '';
CREATE UNIQUE INDEX vehicles_discovery_url_unique ON public.vehicles (discovery_url) WHERE discovery_url IS NOT NULL;
CREATE FUNCTION public.enforce_vin_uniqueness() RETURNS trigger LANGUAGE plpgsql AS $$
declare
  v_norm text;
  v_existing uuid;
begin
  if new.vin is null or length(trim(new.vin)) < 11 then
    return new;
  end if;
  v_norm := upper(trim(new.vin));
  select id into v_existing
    from vehicles
   where upper(trim(vin)) = v_norm
     and id <> new.id
     and status is distinct from 'merged'
   limit 1;
  if v_existing is not null then
    raise exception 'VIN % already exists on vehicle %', v_norm, v_existing
      using errcode = 'unique_violation';
  end if;
  return new;
end;
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
CREATE TABLE public.merge_deleted_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), proposal_id uuid, source_table text, row_id uuid, row_data jsonb, restored_at timestamptz);
CREATE TABLE public.merge_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_a_id uuid NOT NULL, vehicle_b_id uuid NOT NULL, status text DEFAULT 'pending',
  evidence jsonb, detection_source text, ai_decision text, ai_confidence numeric, ai_reasoning text, preferred_primary text,
  match_tier integer, confidence numeric, ai_verified boolean, proposed_by text, UNIQUE (vehicle_a_id, vehicle_b_id));
CREATE TABLE public.superseded_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_table text, row_id uuid, row_data jsonb, asserted_by text, source jsonb, reason text);

\i supabase/migrations/20261019030000_merge_carries_identity_unmerge_batch.sql

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
