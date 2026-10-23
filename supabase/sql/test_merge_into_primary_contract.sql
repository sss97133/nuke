-- Isolated PostgreSQL 17 contract for 20261015220000_merge_carries_events_and_supersedes.sql and
-- 20261020050500_merge_vin_carry_and_protected_observations.sql. Synthetic rows only; never production.
-- Run in an empty, disposable dm_refinement_* database from the repo root:
--   createdb dm_refinement_merge_into_primary
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_merge_into_primary -f supabase/sql/test_merge_into_primary_contract.sql
-- Fixtures carry the live columns merge_into_primary / unmerge_vehicle read or write, and the live unique indexes that decide what
-- can move (prod, 2026-10-15): unique_observation (source_id, source_identifier, kind, content_hash), auction_events
-- (vehicle_id, source_url), auction_comments (vehicle_id, content_hash), vehicle_images (vehicle_id, file_hash) partial,
-- vehicle_events listing keys (two partial), timeline_events photo sessions (partial), and the per-vehicle uniques on
-- bat_listings / comment_discoveries / description_discoveries. vehicle_events and timeline_events are created WITHOUT
-- merged_from_vehicle_id and merge_proposals with its old status check: the migration must add them.
-- Proof: merge a synthetic pair that has every table's rows, unmerge, and every table's row count and row checksum is what it was.
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
  UNIQUE (primary_vehicle_id, duplicate_vehicle_id));
CREATE TABLE public.merge_deleted_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), proposal_id uuid REFERENCES public.vehicle_merge_proposals (id) ON DELETE CASCADE,
  source_table text, row_id uuid, row_data jsonb, deleted_at timestamptz DEFAULT now(), restored_at timestamptz);
CREATE TABLE public.merge_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_a_id uuid NOT NULL, vehicle_b_id uuid NOT NULL, status text DEFAULT 'pending',
  evidence jsonb, UNIQUE (vehicle_a_id, vehicle_b_id),
  CONSTRAINT merge_proposals_status_check CHECK (status = ANY (ARRAY['pending', 'approved', 'rejected', 'executed'])));

-- The migration under test.
\i supabase/migrations/20261015220000_merge_carries_events_and_supersedes.sql
\i supabase/migrations/20261020050500_merge_vin_carry_and_protected_observations.sql
\i supabase/migrations/20261021170000_merge_gate_reads_every_owner_signal.sql
\i supabase/migrations/20261021200000_merge_carries_records.sql

SELECT pg_temp.ok('the migration added merged_from_vehicle_id to vehicle_events and timeline_events',
  (SELECT count(*) FROM information_schema.columns WHERE table_name IN ('vehicle_events', 'timeline_events') AND column_name = 'merged_from_vehicle_id') = 2);

-- ---------------------------------------------------------------------------------------------------------------------
-- Synthetic pair. P = primary, D = duplicate. Every table has rows on both, including rows that collide on a unique key.
-- ---------------------------------------------------------------------------------------------------------------------
\set P '''00000000-0000-0000-0000-0000000000a1'''
\set D '''00000000-0000-0000-0000-0000000000d1'''
\set S '''00000000-0000-0000-0000-00000000005c'''
INSERT INTO vehicles (id, status, user_id) VALUES (:P, 'active', NULL), (:D, 'active', NULL);

INSERT INTO vehicle_images (id, vehicle_id, image_url, file_hash, is_duplicate) VALUES
  ('10000000-0000-0000-0000-000000000001', :P, 'p1', 'h-shared', false),
  ('10000000-0000-0000-0000-000000000002', :P, 'p2', 'h-p-only', false),
  ('10000000-0000-0000-0000-0000000000d1', :D, 'd1', 'h-shared', false),   -- collides with P's file_hash: stays on D
  ('10000000-0000-0000-0000-0000000000d2', :D, 'd2', 'h-d-only', false),
  ('10000000-0000-0000-0000-0000000000d3', :D, 'd3', NULL, true);          -- already flagged duplicate: moves, not counted

INSERT INTO vehicle_observations (id, vehicle_id, source_id, source_identifier, kind, content_hash, observed_at, is_superseded) VALUES
  ('20000000-0000-0000-0000-000000000001', :P, :S, 'lot-1', 'listing', 'c-new', '2026-02-02', false),
  ('20000000-0000-0000-0000-0000000000d1', :D, :S, 'lot-1', 'listing', 'c-old', '2026-02-01', false),      -- same (source, identifier, kind), other content: superseded by P's, moved
  ('20000000-0000-0000-0000-0000000000d2', :D, :S, 'lot-2', 'listing', 'c-2', '2026-02-01', false),        -- no counterpart: moved plain
  ('20000000-0000-0000-0000-0000000000d3', :D, :S, 'lot-3', 'condition', 'c-3', '2026-02-01', true);       -- already superseded: moved as is
INSERT INTO vehicle_observations (id, vehicle_id, source_id, source_identifier, kind, content_hash, observed_at, is_superseded, source_vin, extraction_method) VALUES
  ('20000000-0000-0000-0000-0000000000d4', :D, :S, 'retained-vin:d', 'specification', 'c-4', '2026-02-01', false,
   '2G1FT1EW6A9137982', 'protected_retained_vin_reference_v1');                                                -- protected: stays on D (guard_retained_vin_observation refuses to move it in prod)

INSERT INTO auction_events (id, vehicle_id, source_url) VALUES
  ('30000000-0000-0000-0000-000000000001', :P, 'https://x/lot/1'),
  ('30000000-0000-0000-0000-0000000000d1', :D, 'https://x/lot/1'),   -- same (vehicle, source_url) as P's: stays on D
  ('30000000-0000-0000-0000-0000000000d2', :D, 'https://x/lot/2');

INSERT INTO auction_comments (id, vehicle_id, content_hash) VALUES
  ('40000000-0000-0000-0000-000000000001', :P, 'k-shared'),
  ('40000000-0000-0000-0000-0000000000d1', :D, 'k-shared'),          -- same comment: stays on D (kept, not deleted)
  ('40000000-0000-0000-0000-0000000000d2', :D, 'k-d-only'),
  ('40000000-0000-0000-0000-0000000000d3', :D, NULL);

INSERT INTO observation_discoveries (id, vehicle_id) VALUES
  ('50000000-0000-0000-0000-000000000001', :P), ('50000000-0000-0000-0000-0000000000d1', :D);

INSERT INTO vehicle_events (id, vehicle_id, source_platform, source_listing_id, source_url) VALUES
  ('60000000-0000-0000-0000-000000000001', :P, 'ebay-motors', 'item-1', 'https://ebay/1'),
  ('60000000-0000-0000-0000-000000000002', :P, 'bonhams', NULL, 'https://bonhams/9'),
  ('60000000-0000-0000-0000-0000000000d1', :D, 'ebay-motors', 'item-1', 'https://ebay/1'),     -- same listing key as P's: stays on D
  ('60000000-0000-0000-0000-0000000000d2', :D, 'bonhams', NULL, 'https://bonhams/9'),          -- same url key as P's: stays on D
  ('60000000-0000-0000-0000-0000000000d3', :D, 'gooding', 'lot-77', 'https://gooding/77');     -- moves

INSERT INTO timeline_events (id, vehicle_id, user_id, event_type, event_date) VALUES
  ('70000000-0000-0000-0000-000000000001', :P, NULL, 'photo_session', '2026-01-05'),
  ('70000000-0000-0000-0000-0000000000d1', :D, NULL, 'photo_session', '2026-01-05'),           -- same photo-session day: stays on D
  ('70000000-0000-0000-0000-0000000000d2', :D, NULL, 'service', '2026-01-05'),
  ('70000000-0000-0000-0000-0000000000d3', :D, NULL, 'photo_session', '2026-01-09');

INSERT INTO bat_listings (id, vehicle_id, bat_listing_url) VALUES ('80000000-0000-0000-0000-0000000000d1', :D, 'https://bat/1');
INSERT INTO comment_discoveries (id, vehicle_id) VALUES ('81000000-0000-0000-0000-000000000001', :P), ('81000000-0000-0000-0000-0000000000d1', :D);
INSERT INTO description_discoveries (id, vehicle_id) VALUES ('82000000-0000-0000-0000-000000000001', :P), ('82000000-0000-0000-0000-0000000000d1', :D);

UPDATE vehicles v SET image_count = (SELECT count(*) FROM vehicle_images i WHERE i.vehicle_id = v.id AND i.is_duplicate IS NOT TRUE AND i.is_superseded IS NOT TRUE);
INSERT INTO merge_proposals (vehicle_a_id, vehicle_b_id, status) VALUES (:P, :D, 'approved');

-- Snapshot: one row per table with its row count and an order-independent checksum of every column the merge can change.
CREATE TABLE pg_temp.snap (label text, tbl text, n bigint, sum text);
CREATE FUNCTION pg_temp.take(label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  INSERT INTO pg_temp.snap
  SELECT label, 'vehicles', count(*), md5(string_agg(concat_ws('|', id, status, merged_into_vehicle_id, deleted_at IS NOT NULL, image_count), ',' ORDER BY id)) FROM vehicles
  UNION ALL SELECT label, 'vehicle_images', count(*), md5(string_agg(concat_ws('|', id, vehicle_id, merged_from_vehicle_id), ',' ORDER BY id)) FROM vehicle_images
  UNION ALL SELECT label, 'vehicle_observations', count(*), md5(string_agg(concat_ws('|', id, vehicle_id, merged_from_vehicle_id, is_superseded, superseded_by, superseded_at IS NOT NULL), ',' ORDER BY id)) FROM vehicle_observations
  UNION ALL SELECT label, 'auction_events', count(*), md5(string_agg(concat_ws('|', id, vehicle_id, merged_from_vehicle_id), ',' ORDER BY id)) FROM auction_events
  UNION ALL SELECT label, 'auction_comments', count(*), md5(string_agg(concat_ws('|', id, vehicle_id, merged_from_vehicle_id), ',' ORDER BY id)) FROM auction_comments
  UNION ALL SELECT label, 'observation_discoveries', count(*), md5(string_agg(concat_ws('|', id, vehicle_id, merged_from_vehicle_id), ',' ORDER BY id)) FROM observation_discoveries
  UNION ALL SELECT label, 'vehicle_events', count(*), md5(string_agg(concat_ws('|', id, vehicle_id, merged_from_vehicle_id), ',' ORDER BY id)) FROM vehicle_events
  UNION ALL SELECT label, 'timeline_events', count(*), md5(string_agg(concat_ws('|', id, vehicle_id, merged_from_vehicle_id), ',' ORDER BY id)) FROM timeline_events
  UNION ALL SELECT label, 'bat_listings', count(*), md5(string_agg(concat_ws('|', id, vehicle_id), ',' ORDER BY id)) FROM bat_listings
  UNION ALL SELECT label, 'comment_discoveries', count(*), md5(string_agg(concat_ws('|', id, vehicle_id), ',' ORDER BY id)) FROM comment_discoveries
  UNION ALL SELECT label, 'description_discoveries', count(*), md5(string_agg(concat_ws('|', id, vehicle_id), ',' ORDER BY id)) FROM description_discoveries
  UNION ALL SELECT label, 'merge_deleted_rows', count(*), md5(string_agg(id::text, ',' ORDER BY id)) FROM merge_deleted_rows;
END $$;
SELECT pg_temp.take('before');

-- ---------------------------------------------------------------------------------------------------------------------
-- Merge.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE pg_temp.res (r jsonb);
INSERT INTO pg_temp.res SELECT merge_into_primary(:P, :D);
SELECT pg_temp.take('merged');

SELECT pg_temp.ok('merge ran: ' || (SELECT r::text FROM pg_temp.res), (SELECT r ? 'proposal_id' FROM pg_temp.res));
SELECT pg_temp.ok('nothing was deleted: every table has the same row count after the merge',
  NOT EXISTS (SELECT 1 FROM pg_temp.snap b JOIN pg_temp.snap m ON m.tbl = b.tbl AND m.label = 'merged' WHERE b.label = 'before' AND b.n <> m.n));
SELECT pg_temp.ok('merge_deleted_rows stays empty: no row is archived-and-deleted any more',
  (SELECT count(*) FROM merge_deleted_rows) = 0);
SELECT pg_temp.ok('duplicate is soft-deleted and points at the primary',
  (SELECT status = 'merged' AND merged_into_vehicle_id = :P AND deleted_at IS NOT NULL FROM vehicles WHERE id = :D));

SELECT pg_temp.ok('images: the two that do not collide moved and are stamped; the file_hash collision stayed on D',
  (SELECT count(*) FROM vehicle_images WHERE vehicle_id = :P AND merged_from_vehicle_id = :D) = 2
  AND (SELECT vehicle_id FROM vehicle_images WHERE id = '10000000-0000-0000-0000-0000000000d1') = :D);
SELECT pg_temp.ok('observation: the revision P already has a newer one for is SUPERSEDED by it, and moved (not deleted)',
  (SELECT is_superseded AND superseded_by = '20000000-0000-0000-0000-000000000001' AND vehicle_id = :P AND merged_from_vehicle_id = :D
     FROM vehicle_observations WHERE id = '20000000-0000-0000-0000-0000000000d1'));
SELECT pg_temp.ok('observations: the other two moved, stamped, and the already-superseded one kept its flag',
  (SELECT count(*) FROM vehicle_observations WHERE vehicle_id = :P AND merged_from_vehicle_id = :D) = 3
  AND (SELECT is_superseded AND superseded_by IS NULL FROM vehicle_observations WHERE id = '20000000-0000-0000-0000-0000000000d3'));
SELECT pg_temp.ok('observations: the protected retained VIN reference stayed on D, unstamped, and the journal names it',
  (SELECT vehicle_id = :D AND merged_from_vehicle_id IS NULL AND is_superseded IS NOT TRUE FROM vehicle_observations WHERE id = '20000000-0000-0000-0000-0000000000d4')
  AND (SELECT merge_journal -> 'observations_left_ids' = '["20000000-0000-0000-0000-0000000000d4"]'::jsonb FROM vehicle_merge_proposals WHERE primary_vehicle_id = :P AND duplicate_vehicle_id = :D));
SELECT pg_temp.ok('auction_events: the same-url event stayed on D, the other moved and is stamped',
  (SELECT vehicle_id FROM auction_events WHERE id = '30000000-0000-0000-0000-0000000000d1') = :D
  AND (SELECT vehicle_id = :P AND merged_from_vehicle_id = :D FROM auction_events WHERE id = '30000000-0000-0000-0000-0000000000d2'));
SELECT pg_temp.ok('auction_comments: the same-hash comment stayed on D (kept); the other two moved and are stamped',
  (SELECT vehicle_id FROM auction_comments WHERE id = '40000000-0000-0000-0000-0000000000d1') = :D
  AND (SELECT count(*) FROM auction_comments WHERE vehicle_id = :P AND merged_from_vehicle_id = :D) = 2);
SELECT pg_temp.ok('vehicle_events: only the gooding episode moved (stamped); both key collisions stayed on D',
  (SELECT count(*) FROM vehicle_events WHERE vehicle_id = :P AND merged_from_vehicle_id = :D) = 1
  AND (SELECT vehicle_id FROM vehicle_events WHERE id = '60000000-0000-0000-0000-0000000000d3') = :P
  AND (SELECT count(*) FROM vehicle_events WHERE vehicle_id = :D) = 2);
SELECT pg_temp.ok('timeline_events: the service row and the new photo-session day moved (stamped); the same-day photo session stayed',
  (SELECT count(*) FROM timeline_events WHERE vehicle_id = :P AND merged_from_vehicle_id = :D) = 2
  AND (SELECT vehicle_id FROM timeline_events WHERE id = '70000000-0000-0000-0000-0000000000d1') = :D);
SELECT pg_temp.ok('bat_listings, comment_discoveries, description_discoveries were not deleted and stay on D',
  (SELECT count(*) FROM bat_listings WHERE vehicle_id = :D) = 1 AND (SELECT count(*) FROM comment_discoveries WHERE vehicle_id = :D) = 1
  AND (SELECT count(*) FROM description_discoveries WHERE vehicle_id = :D) = 1);
SELECT pg_temp.ok('image_count recounted on both vehicles',
  (SELECT image_count FROM vehicles WHERE id = :P) = (SELECT count(*) FROM vehicle_images WHERE vehicle_id = :P AND is_duplicate IS NOT TRUE AND is_superseded IS NOT TRUE)
  AND (SELECT image_count FROM vehicles WHERE id = :D) = (SELECT count(*) FROM vehicle_images WHERE vehicle_id = :D AND is_duplicate IS NOT TRUE AND is_superseded IS NOT TRUE)
  AND (SELECT image_count FROM vehicles WHERE id = :P) = 3);
SELECT pg_temp.ok('a second merge of the same pair is refused (dup already merged)',
  merge_into_primary(:P, :D) ->> 'skipped' = 'dup_already_merged');

-- generate-merge-proposals.mjs --execute marks the proposal executed after merge_into_primary returns.
UPDATE merge_proposals SET status = 'executed' WHERE vehicle_a_id = :P AND vehicle_b_id = :D;

-- A row added to the primary after the merge has no stamp and must stay there through the unmerge.
INSERT INTO vehicle_images (id, vehicle_id, image_url, file_hash) VALUES ('10000000-0000-0000-0000-0000000000f1', :P, 'post-merge', 'h-post');
INSERT INTO vehicle_events (id, vehicle_id, source_platform, source_listing_id) VALUES ('60000000-0000-0000-0000-0000000000f1', :P, 'mecum', 'post');

-- ---------------------------------------------------------------------------------------------------------------------
-- Unmerge.
-- ---------------------------------------------------------------------------------------------------------------------
DELETE FROM pg_temp.res;
INSERT INTO pg_temp.res SELECT unmerge_vehicle((SELECT id FROM vehicle_merge_proposals WHERE primary_vehicle_id = :P AND duplicate_vehicle_id = :D), 'contract test');
SELECT pg_temp.ok('unmerge ran: ' || (SELECT r::text FROM pg_temp.res), (SELECT r ->> 'success' = 'true' FROM pg_temp.res));

-- Remove the two post-merge rows to compare against the snapshot, after proving they stayed on the primary.
SELECT pg_temp.ok('post-merge additions (no stamp) stayed on the primary through the unmerge',
  (SELECT vehicle_id FROM vehicle_images WHERE id = '10000000-0000-0000-0000-0000000000f1') = :P
  AND (SELECT vehicle_id FROM vehicle_events WHERE id = '60000000-0000-0000-0000-0000000000f1') = :P);
SELECT pg_temp.ok('unmerge returned the stamped rows: 2 images, 3 observations, 1 auction event, 2 comments, 1 discovery, 1 vehicle_event, 2 timeline',
  (SELECT r ->> 'images_returned' = '2' AND r ->> 'observations_returned' = '3' AND r ->> 'events_returned' = '1'
      AND r ->> 'comments_returned' = '2' AND r ->> 'obs_disc_returned' = '1' AND r ->> 'vehicle_events_returned' = '1'
      AND r ->> 'timeline_events_returned' = '2' AND r ->> 'observations_unsuperseded' = '1' FROM pg_temp.res));
-- the post-merge rows are legitimately new; take them out of the comparison
DELETE FROM vehicle_images WHERE id = '10000000-0000-0000-0000-0000000000f1';
DELETE FROM vehicle_events WHERE id = '60000000-0000-0000-0000-0000000000f1';
UPDATE vehicles v SET image_count = (SELECT count(*) FROM vehicle_images i WHERE i.vehicle_id = v.id AND i.is_duplicate IS NOT TRUE AND i.is_superseded IS NOT TRUE) WHERE id = :P;
SELECT pg_temp.take('unmerged');

SELECT pg_temp.ok('the superseded observation is no longer superseded',
  (SELECT NOT is_superseded AND superseded_by IS NULL AND superseded_at IS NULL FROM vehicle_observations WHERE id = '20000000-0000-0000-0000-0000000000d1'));
SELECT pg_temp.ok('the already-superseded observation kept its own flag',
  (SELECT is_superseded FROM vehicle_observations WHERE id = '20000000-0000-0000-0000-0000000000d3'));
SELECT pg_temp.ok('duplicate restored: status, merged_into and deleted_at as before',
  (SELECT status = 'active' AND merged_into_vehicle_id IS NULL AND deleted_at IS NULL FROM vehicles WHERE id = :D));
SELECT pg_temp.ok('proposal row is unmerged', (SELECT status = 'unmerged' AND unmerged_at IS NOT NULL FROM vehicle_merge_proposals WHERE primary_vehicle_id = :P));
SELECT pg_temp.ok('merge_proposals moved from executed to unmerged with the reason recorded',
  (SELECT status = 'unmerged' AND evidence -> 'unmerge' ->> 'reason' = 'contract test' FROM merge_proposals WHERE vehicle_a_id = :P AND vehicle_b_id = :D));
SELECT pg_temp.ok('image_count is back on both vehicles',
  (SELECT image_count FROM vehicles WHERE id = :P) = 2 AND (SELECT image_count FROM vehicles WHERE id = :D) = 2);

-- Proof table: every table's row count and checksum, before the merge and after the unmerge.
SELECT b.tbl AS "table", b.n AS rows_before, m.n AS rows_merged, u.n AS rows_after_unmerge,
       CASE WHEN b.sum IS NOT DISTINCT FROM u.sum AND b.n = u.n THEN 'identical' ELSE 'DIFFERENT' END AS before_vs_after
  FROM pg_temp.snap b
  JOIN pg_temp.snap m ON m.tbl = b.tbl AND m.label = 'merged'
  JOIN pg_temp.snap u ON u.tbl = b.tbl AND u.label = 'unmerged'
 WHERE b.label = 'before' ORDER BY b.tbl;
SELECT pg_temp.ok('EVERY table: row count and row checksum after the unmerge equal the state before the merge',
  NOT EXISTS (SELECT 1 FROM pg_temp.snap b JOIN pg_temp.snap u ON u.tbl = b.tbl AND u.label = 'unmerged'
               WHERE b.label = 'before' AND (b.n <> u.n OR b.sum IS DISTINCT FROM u.sum)));

-- A merge that predates the journal is still refused cleanly.
INSERT INTO vehicles (id, status) VALUES ('00000000-0000-0000-0000-0000000000a2', 'active'), ('00000000-0000-0000-0000-0000000000d2', 'merged');
INSERT INTO vehicle_merge_proposals (id, primary_vehicle_id, duplicate_vehicle_id, status) VALUES
  ('90000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000d2', 'merged');
-- After the before/after checksum: two more live rows for the two-VIN refusal.
INSERT INTO vehicles (id, status, vin) VALUES
  ('00000000-0000-0000-0000-00000000ee01', 'active', '1G1YY2189J5117603'),
  ('00000000-0000-0000-0000-00000000ee02', 'active', '2G1FT1EW9A9168675');
SELECT pg_temp.ok('two live rows with two different 11+ character VINs are two vehicles: the merge is refused (vin_conflict)',
  merge_into_primary('00000000-0000-0000-0000-00000000ee01', '00000000-0000-0000-0000-00000000ee02') ->> 'skipped' = 'vin_conflict'
  AND (SELECT status = 'active' FROM vehicles WHERE id = '00000000-0000-0000-0000-00000000ee02'));

-- Gate 2 reads every owner signal (20261021170000): owner_id, uploaded_by and an active owner / co_owner permission each refuse
-- the merge without an approved, reviewed proposal; an inactive owner permission and a contributor do not; an approval lets it through.
INSERT INTO vehicles (id, status, owner_id, uploaded_by) VALUES
  ('00000000-0000-0000-0000-00000000c0a1', 'active', NULL, NULL), ('00000000-0000-0000-0000-00000000c0d1', 'active', '00000000-0000-0000-0000-0000000000f1', NULL),
  ('00000000-0000-0000-0000-00000000c0a2', 'active', NULL, '00000000-0000-0000-0000-0000000000f1'), ('00000000-0000-0000-0000-00000000c0d2', 'active', NULL, NULL),
  ('00000000-0000-0000-0000-00000000c0a3', 'active', NULL, NULL), ('00000000-0000-0000-0000-00000000c0d3', 'active', NULL, NULL),
  ('00000000-0000-0000-0000-00000000c0a4', 'active', NULL, NULL), ('00000000-0000-0000-0000-00000000c0d4', 'active', NULL, NULL),
  ('00000000-0000-0000-0000-00000000c0a5', 'active', NULL, NULL), ('00000000-0000-0000-0000-00000000c0d5', 'active', NULL, NULL),
  ('00000000-0000-0000-0000-00000000c0a6', 'active', NULL, NULL), ('00000000-0000-0000-0000-00000000c0d6', 'active', '00000000-0000-0000-0000-0000000000f1', NULL);
INSERT INTO vehicle_user_permissions (vehicle_id, user_id, role, is_active) VALUES
  ('00000000-0000-0000-0000-00000000c0d3', '00000000-0000-0000-0000-0000000000f1', 'owner', true),
  ('00000000-0000-0000-0000-00000000c0d4', '00000000-0000-0000-0000-0000000000f1', 'owner', false),
  ('00000000-0000-0000-0000-00000000c0d5', '00000000-0000-0000-0000-0000000000f1', 'contributor', true);
SELECT pg_temp.ok('owner_id on one row: refused (owned_requires_approval)',
  merge_into_primary('00000000-0000-0000-0000-00000000c0a1', '00000000-0000-0000-0000-00000000c0d1') ->> 'skipped' = 'owned_requires_approval');
SELECT pg_temp.ok('uploaded_by on one row: refused',
  merge_into_primary('00000000-0000-0000-0000-00000000c0a2', '00000000-0000-0000-0000-00000000c0d2') ->> 'skipped' = 'owned_requires_approval');
SELECT pg_temp.ok('an active owner permission on one row: refused',
  merge_into_primary('00000000-0000-0000-0000-00000000c0a3', '00000000-0000-0000-0000-00000000c0d3') ->> 'skipped' = 'owned_requires_approval');
SELECT pg_temp.ok('an inactive owner permission and an active contributor permission do not make a vehicle owned',
  merge_into_primary('00000000-0000-0000-0000-00000000c0a4', '00000000-0000-0000-0000-00000000c0d4') ? 'proposal_id'
  AND merge_into_primary('00000000-0000-0000-0000-00000000c0a5', '00000000-0000-0000-0000-00000000c0d5') ? 'proposal_id');
INSERT INTO vehicle_merge_proposals (primary_vehicle_id, duplicate_vehicle_id, match_type, status, reviewed_by)
  VALUES ('00000000-0000-0000-0000-00000000c0d6', '00000000-0000-0000-0000-00000000c0a6', 'owner_approved', 'approved', '00000000-0000-0000-0000-0000000000f1');
SELECT pg_temp.ok('an owner_id row merges once an approved, reviewed proposal names the pair (either direction)',
  merge_into_primary('00000000-0000-0000-0000-00000000c0a6', '00000000-0000-0000-0000-00000000c0d6') ? 'proposal_id');

-- The single-pair merge carries the records too (20261021200000), refuses two different owners, and unmerge returns exactly them.
INSERT INTO vehicles (id, status, owner_id) VALUES
  ('00000000-0000-0000-0000-00000000d0a1', 'active', NULL), ('00000000-0000-0000-0000-00000000d0d1', 'active', '00000000-0000-0000-0000-0000000000f1'),
  ('00000000-0000-0000-0000-00000000d0a2', 'active', '00000000-0000-0000-0000-0000000000f2'), ('00000000-0000-0000-0000-00000000d0d2', 'active', '00000000-0000-0000-0000-0000000000f3');
INSERT INTO vehicle_merge_proposals (primary_vehicle_id, duplicate_vehicle_id, match_type, status, reviewed_by) VALUES
  ('00000000-0000-0000-0000-00000000d0a1', '00000000-0000-0000-0000-00000000d0d1', 'owner_approved', 'approved', '00000000-0000-0000-0000-0000000000f1'),
  ('00000000-0000-0000-0000-00000000d0a2', '00000000-0000-0000-0000-00000000d0d2', 'owner_approved', 'approved', '00000000-0000-0000-0000-0000000000f1');
INSERT INTO work_sessions (id, vehicle_id, start_time, title) VALUES ('d0000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000d0d1', '2025-05-02 08:00+00', 'kept as typed');
INSERT INTO receipts (id, vehicle_id, scope_type, scope_id, total) VALUES ('d0100000-0000-0000-0000-0000000000d1', NULL, 'vehicle', '00000000-0000-0000-0000-00000000d0d1', 61.25);
CREATE TABLE pg_temp.single_carry AS SELECT merge_into_primary('00000000-0000-0000-0000-00000000d0a1', '00000000-0000-0000-0000-00000000d0d1') r;
SELECT pg_temp.ok('single merge: the work session and the scope-named receipt moved, the owner link filled the survivor, all journaled',
  (SELECT vehicle_id = '00000000-0000-0000-0000-00000000d0a1' AND title = 'kept as typed' FROM work_sessions WHERE id = 'd0000000-0000-0000-0000-0000000000d1')
  AND (SELECT scope_id = '00000000-0000-0000-0000-00000000d0a1' AND total = 61.25 FROM receipts WHERE id = 'd0100000-0000-0000-0000-0000000000d1')
  AND (SELECT owner_id = '00000000-0000-0000-0000-0000000000f1' FROM vehicles WHERE id = '00000000-0000-0000-0000-00000000d0a1')
  AND (SELECT merge_journal -> 'carry' -> 'carried' ? 'work_sessions' AND merge_journal -> 'carry' -> 'owner_filled' ? 'owner_id' FROM vehicle_merge_proposals WHERE duplicate_vehicle_id = '00000000-0000-0000-0000-00000000d0d1'));
SELECT pg_temp.ok('single merge: two different owners are refused (owner_conflict) even with an approved proposal',
  merge_into_primary('00000000-0000-0000-0000-00000000d0a2', '00000000-0000-0000-0000-00000000d0d2') ->> 'skipped' = 'owner_conflict');
CREATE TABLE pg_temp.single_unmerge AS
  SELECT unmerge_vehicle((SELECT id FROM vehicle_merge_proposals WHERE duplicate_vehicle_id = '00000000-0000-0000-0000-00000000d0d1' AND status = 'merged'), 'contract: single carry') r;
SELECT pg_temp.ok('unmerge after a single merge returns the session, the receipt scope and the owner link',
  (SELECT vehicle_id = '00000000-0000-0000-0000-00000000d0d1' FROM work_sessions WHERE id = 'd0000000-0000-0000-0000-0000000000d1')
  AND (SELECT scope_id = '00000000-0000-0000-0000-00000000d0d1' FROM receipts WHERE id = 'd0100000-0000-0000-0000-0000000000d1')
  AND (SELECT owner_id IS NULL FROM vehicles WHERE id = '00000000-0000-0000-0000-00000000d0a1')
  AND (SELECT r ->> 'success' = 'true' FROM pg_temp.single_unmerge));

SELECT pg_temp.ok('unmerge of a merge with no journal says no_journal',
  unmerge_vehicle('90000000-0000-0000-0000-000000000001') ->> 'error' = 'no_journal');

-- Grants: merge_into_primary is service_role only; unmerge_vehicle is authenticated + service_role.
SELECT pg_temp.ok('merge_into_primary is not executable by authenticated or anon',
  NOT has_function_privilege('authenticated', 'merge_into_primary(uuid,uuid)', 'EXECUTE') AND NOT has_function_privilege('anon', 'merge_into_primary(uuid,uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'merge_into_primary(uuid,uuid)', 'EXECUTE'));
SELECT pg_temp.ok('unmerge_vehicle(uuid, text) is executable by authenticated and service_role, not anon',
  has_function_privilege('authenticated', 'unmerge_vehicle(uuid,text)', 'EXECUTE') AND has_function_privilege('service_role', 'unmerge_vehicle(uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'unmerge_vehicle(uuid,text)', 'EXECUTE'));
SELECT pg_temp.ok('the old one-argument unmerge_vehicle is gone (no ambiguous overload for the frontend call)',
  (SELECT count(*) FROM pg_proc WHERE proname = 'unmerge_vehicle') = 1);
