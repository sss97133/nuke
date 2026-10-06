-- Isolated PostgreSQL 17 regression: synthetic rows and placeholder handles only, never production data.
-- Contract for migration 20261006113000_merge_writer_reparent_children.sql: the vehicle merge writer relinks every live
-- vehicle_observation in place (never inserts a copy), re-parents auction_comments, bat_bids and vehicle_events, never
-- deletes an auction_events row, keeps children with their lot, demotes a moving primary image when the primary has
-- one, leaves (and counts) what the primary already holds or a guard refuses, reports per-table counts, and the
-- migration's drift guard sees the fingerprint of the live definition.
-- The frozen live writer below is a dependency fixture (pg_get_functiondef of 2026-10-06, verbatim, md5 confirmed
-- against prod), not a rule change. The stub tables carry every column the writer reads or writes, and the unique keys
-- that decide what can move, as read from the live catalog on 2026-10-06: unique_observation is a plain UNIQUE
-- (source_id, source_identifier, kind, content_hash), table-wide and not partial; auction_comments_vehicle_content_hash_key
-- (vehicle_id, content_hash); bat_bids_unique_bid (bat_listing_id, bat_username, bid_amount, bid_timestamp); the two
-- partial keys of vehicle_events; idx_auction_events_vehicle_source_url (vehicle_id, source_url);
-- vehicle_images_one_primary_per_vehicle_idx and idx_unique_vehicle_file_hash with their live predicates. The live
-- trigger ensure_single_primary_image is carried as a fixture too: it clears the other primary flags of a vehicle when
-- a row flagged primary is written, so it is what makes a bulk image move hand the primary photo over.
-- Execute in an empty dm_merge_writer_reparent_ci database with no auth schema.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT IN ('dm_merge_writer_reparent_ci')
   OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='auth')
   OR EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p','v','m')) THEN
 RAISE EXCEPTION 'Refusing fixtures outside isolated DB'; END IF;
END $$;
SET statement_timeout='30s';
SET lock_timeout='3s';

CREATE TABLE public.vehicles(
  id uuid PRIMARY KEY, vin text, year integer, make text NOT NULL DEFAULT '', model text NOT NULL DEFAULT '', trim text,
  mileage integer, current_value numeric, sale_price numeric, purchase_price numeric, primary_image_url text,
  discovery_url text, origin_metadata jsonb, updated_at timestamptz, merged_into_vehicle_id uuid, is_public boolean DEFAULT true);
-- Tables the writer only re-parents by vehicle_id.
CREATE TABLE public.vehicle_timeline(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid);
CREATE TABLE public.vehicle_comments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid);
CREATE TABLE public.vehicle_price_history(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid);
CREATE TABLE public.vehicle_contributors(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid);
CREATE TABLE public.dealer_inventory(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid);
CREATE TABLE public.import_queue(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid);
CREATE TABLE public.timeline_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, event_type text, event_date timestamptz,
  title text, description text, source text, source_type text, metadata jsonb);
CREATE TABLE public.organization_vehicles(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, vehicle_id uuid, relationship_type text);
CREATE TABLE public.external_listings(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), platform text, listing_id text, vehicle_id uuid);
-- Images: the two live unique indexes and the live single-primary trigger.
CREATE TABLE public.vehicle_images(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, is_primary boolean, is_document boolean,
  is_duplicate boolean, is_superseded boolean, file_hash text, file_name text);
CREATE UNIQUE INDEX vehicle_images_one_primary_per_vehicle_idx ON public.vehicle_images(vehicle_id)
  WHERE vehicle_id IS NOT NULL AND is_primary = true AND (is_document IS NULL OR is_document = false)
    AND (is_duplicate IS NULL OR is_duplicate = false);
CREATE UNIQUE INDEX idx_unique_vehicle_file_hash ON public.vehicle_images(vehicle_id, file_hash)
  WHERE file_hash IS NOT NULL AND vehicle_id IS NOT NULL AND COALESCE(is_superseded, false) = false;
CREATE OR REPLACE FUNCTION public.ensure_single_primary_image()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    -- If setting this image as primary, clear all other primary flags for this vehicle
    IF NEW.is_primary = true THEN
        UPDATE vehicle_images
        SET is_primary = false
        WHERE vehicle_id = NEW.vehicle_id
        AND id != NEW.id
        AND is_primary = true;
    END IF;

    RETURN NEW;
END;
$function$;
CREATE TRIGGER trigger_ensure_single_primary_image BEFORE INSERT OR UPDATE ON public.vehicle_images
  FOR EACH ROW EXECUTE FUNCTION public.ensure_single_primary_image();
-- Lots: unique on (vehicle_id, source_url) as live (idx_auction_events_vehicle_source_url).
CREATE TABLE public.auction_events(
  id uuid PRIMARY KEY, vehicle_id uuid, source_url text, source_listing_id text, merged_from_vehicle_id uuid);
CREATE UNIQUE INDEX idx_auction_events_vehicle_source_url ON public.auction_events(vehicle_id, source_url);
-- Comments: auction_event_id is ON DELETE CASCADE as live, so deleting a lot row deletes its comments.
CREATE TABLE public.auction_comments(
  id uuid PRIMARY KEY, auction_event_id uuid REFERENCES public.auction_events(id) ON DELETE CASCADE, vehicle_id uuid,
  content_hash text, bat_comment_id bigint, sequence_number integer, merged_from_vehicle_id uuid,
  CONSTRAINT auction_comments_vehicle_content_hash_key UNIQUE (vehicle_id, content_hash));
CREATE UNIQUE INDEX uq_auction_comments_event_seq ON public.auction_comments(auction_event_id, sequence_number)
  WHERE auction_event_id IS NOT NULL AND sequence_number IS NOT NULL;
-- Bids: auction_event_id has no foreign key, as live.
CREATE TABLE public.bat_bids(
  id uuid PRIMARY KEY, vehicle_id uuid, bat_listing_id uuid NOT NULL, bat_username text NOT NULL,
  bid_amount numeric NOT NULL, bid_timestamp timestamptz NOT NULL, auction_event_id uuid,
  CONSTRAINT bat_bids_unique_bid UNIQUE (bat_listing_id, bat_username, bid_amount, bid_timestamp));
CREATE TABLE public.vehicle_events(
  id uuid PRIMARY KEY, vehicle_id uuid NOT NULL, source_platform text NOT NULL, source_url text, source_listing_id text);
CREATE UNIQUE INDEX idx_vehicle_events_dedup ON public.vehicle_events(vehicle_id, source_platform, source_listing_id)
  WHERE source_listing_id IS NOT NULL;
CREATE UNIQUE INDEX idx_vehicle_events_dedup_url ON public.vehicle_events(vehicle_id, source_platform, source_url)
  WHERE source_url IS NOT NULL AND source_listing_id IS NULL;
-- Observations: unique_observation is plain and global, as live.
CREATE TABLE public.vehicle_observations(
  id uuid PRIMARY KEY, vehicle_id uuid, kind text NOT NULL, source_id uuid, source_identifier text, content_hash text,
  is_superseded boolean DEFAULT false, superseded_at timestamptz, superseded_by uuid REFERENCES public.vehicle_observations(id),
  merged_from_vehicle_id uuid, source_observation_id uuid REFERENCES public.vehicle_observations(id),
  CONSTRAINT unique_observation UNIQUE (source_id, source_identifier, kind, content_hash));
CREATE TABLE public.reattribution_audit(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_type text NOT NULL CHECK (observation_type IN ('image', 'observation')),
  old_observation_id uuid NOT NULL, old_vehicle_id uuid, new_observation_id uuid NOT NULL, new_vehicle_id uuid,
  reason text NOT NULL, actor_user_id uuid, created_at timestamptz DEFAULT now());

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF; RAISE NOTICE 'PASS %', label;
END $$;
-- Synthetic ids: u('c001', 7) is 00000000-0000-0000-c001-000000000007.
CREATE FUNCTION pg_temp.u(grp text, n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('00000000-0000-0000-' || grp || '-' || lpad(to_hex(n), 12, '0'))::uuid $$;

-- Frozen live writer (pg_get_functiondef as installed on 2026-10-06, verbatim) so the guard can match it.
CREATE OR REPLACE FUNCTION public.merge_vehicle_into_primary_by_url(p_primary_vehicle_id uuid, p_duplicate_vehicle_id uuid, p_reason text DEFAULT 'canonical_url_match'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_primary public.vehicles%ROWTYPE;
  v_dup public.vehicles%ROWTYPE;
  r record;
  existing_id uuid;
BEGIN
  IF p_primary_vehicle_id IS NULL OR p_duplicate_vehicle_id IS NULL OR p_primary_vehicle_id = p_duplicate_vehicle_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_ids');
  END IF;

  SELECT * INTO v_primary FROM public.vehicles WHERE id = p_primary_vehicle_id;
  SELECT * INTO v_dup FROM public.vehicles WHERE id = p_duplicate_vehicle_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'vehicle_not_found');
  END IF;

  -- Merge top-level fields (vehicles.make and vehicles.model are NOT NULL in prod)
  UPDATE public.vehicles
  SET
    vin = CASE
      WHEN v_primary.vin IS NOT NULL AND btrim(v_primary.vin) <> '' AND v_primary.vin NOT LIKE 'VIVA-%' THEN v_primary.vin
      WHEN v_dup.vin IS NOT NULL AND btrim(v_dup.vin) <> '' AND v_dup.vin NOT LIKE 'VIVA-%' THEN v_dup.vin
      ELSE COALESCE(v_primary.vin, v_dup.vin)
    END,
    year = COALESCE(v_primary.year, v_dup.year),
    make = COALESCE(NULLIF(btrim(v_primary.make), ''), NULLIF(btrim(v_dup.make), ''), ''),
    model = COALESCE(NULLIF(btrim(v_primary.model), ''), NULLIF(btrim(v_dup.model), ''), ''),
    trim = COALESCE(NULLIF(btrim(v_primary.trim), ''), NULLIF(btrim(v_dup.trim), ''), v_primary.trim, v_dup.trim),
    mileage = COALESCE(v_primary.mileage, v_dup.mileage),
    current_value = GREATEST(COALESCE(v_primary.current_value, 0), COALESCE(v_dup.current_value, 0)),
    sale_price = COALESCE(v_primary.sale_price, v_dup.sale_price),
    purchase_price = COALESCE(v_primary.purchase_price, v_dup.purchase_price),
    primary_image_url = COALESCE(v_primary.primary_image_url, v_dup.primary_image_url),
    discovery_url = COALESCE(v_primary.discovery_url, v_dup.discovery_url),
    origin_metadata = COALESCE(v_primary.origin_metadata, '{}'::jsonb) || COALESCE(v_dup.origin_metadata, '{}'::jsonb),
    updated_at = NOW()
  WHERE id = p_primary_vehicle_id;

  -- Re-parent core child tables (known to exist)
  UPDATE public.vehicle_images SET vehicle_id = p_primary_vehicle_id WHERE vehicle_id = p_duplicate_vehicle_id;
  UPDATE public.vehicle_timeline SET vehicle_id = p_primary_vehicle_id WHERE vehicle_id = p_duplicate_vehicle_id;
  UPDATE public.timeline_events SET vehicle_id = p_primary_vehicle_id WHERE vehicle_id = p_duplicate_vehicle_id;
  UPDATE public.vehicle_comments SET vehicle_id = p_primary_vehicle_id WHERE vehicle_id = p_duplicate_vehicle_id;
  UPDATE public.vehicle_price_history SET vehicle_id = p_primary_vehicle_id WHERE vehicle_id = p_duplicate_vehicle_id;
  UPDATE public.vehicle_contributors SET vehicle_id = p_primary_vehicle_id WHERE vehicle_id = p_duplicate_vehicle_id;
  UPDATE public.dealer_inventory SET vehicle_id = p_primary_vehicle_id WHERE vehicle_id = p_duplicate_vehicle_id;
  UPDATE public.import_queue SET vehicle_id = p_primary_vehicle_id WHERE vehicle_id = p_duplicate_vehicle_id;

  -- organization_vehicles: prevent duplicate relationship collisions
  FOR r IN
    SELECT * FROM public.organization_vehicles WHERE vehicle_id = p_duplicate_vehicle_id
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.organization_vehicles
      WHERE organization_id = r.organization_id
        AND vehicle_id = p_primary_vehicle_id
        AND relationship_type = r.relationship_type
    ) THEN
      UPDATE public.organization_vehicles
      SET vehicle_id = p_primary_vehicle_id
      WHERE id = r.id;
    ELSE
      DELETE FROM public.organization_vehicles WHERE id = r.id;
    END IF;
  END LOOP;

  -- external_listings: prevent duplicate platform/listing_id collisions
  FOR r IN
    SELECT id, platform, listing_id FROM public.external_listings WHERE vehicle_id = p_duplicate_vehicle_id
  LOOP
    SELECT id INTO existing_id
    FROM public.external_listings
    WHERE vehicle_id = p_primary_vehicle_id
      AND platform = r.platform
      AND (listing_id IS NOT DISTINCT FROM r.listing_id)
    LIMIT 1;

    IF existing_id IS NULL THEN
      UPDATE public.external_listings SET vehicle_id = p_primary_vehicle_id WHERE id = r.id;
    ELSE
      DELETE FROM public.external_listings WHERE id = r.id;
    END IF;
  END LOOP;

  -- auction_events: prevent duplicate source_url collisions
  FOR r IN
    SELECT id, source_url FROM public.auction_events WHERE vehicle_id = p_duplicate_vehicle_id
  LOOP
    SELECT id INTO existing_id
    FROM public.auction_events
    WHERE vehicle_id = p_primary_vehicle_id
      AND (source_url IS NOT DISTINCT FROM r.source_url)
    LIMIT 1;

    IF existing_id IS NULL THEN
      UPDATE public.auction_events SET vehicle_id = p_primary_vehicle_id WHERE id = r.id;
    ELSE
      DELETE FROM public.auction_events WHERE id = r.id;
    END IF;
  END LOOP;

  -- Mark the duplicate as merged + hide it from public feeds
  UPDATE public.vehicles
  SET
    merged_into_vehicle_id = p_primary_vehicle_id,
    is_public = false,
    updated_at = NOW()
  WHERE id = p_duplicate_vehicle_id;

  INSERT INTO public.timeline_events (
    vehicle_id,
    event_type,
    event_date,
    title,
    description,
    source,
    source_type,
    metadata
  ) VALUES (
    p_primary_vehicle_id,
    'profile_merged',
    NOW(),
    'Vehicle Profile Merged',
    format('Merged duplicate vehicle %s into %s (%s)', p_duplicate_vehicle_id, p_primary_vehicle_id, p_reason),
    'system',
    'system',
    jsonb_build_object(
      'duplicate_vehicle_id', p_duplicate_vehicle_id,
      'primary_vehicle_id', p_primary_vehicle_id,
      'reason', p_reason,
      'merged_at', NOW()
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'primary_vehicle_id', p_primary_vehicle_id,
    'duplicate_vehicle_id', p_duplicate_vehicle_id
  );
END;
$function$;

DO $$ DECLARE f text; BEGIN
  f := md5(pg_get_functiondef('public.merge_vehicle_into_primary_by_url(uuid,uuid,text)'::regprocedure));
  RAISE NOTICE 'fixture fingerprint %', f;
  PERFORM pg_temp.ok('fixture reproduces the live fingerprint', f = 'cd6ffabcd4253ea4950519eab52784aa'); -- gitleaks:allow (fingerprint)
END $$;

-- ====================================================================================================================
-- Scenario 1: the measured shape of a duplicate that shares a lot with its primary (primary ...0a, duplicate ...0b).
-- Synthetic ids and values; the relationships are the measured ones: 20 live observations (2 with a NULL key column),
-- 56 comments on the duplicate's second lot, all of whose hashes the primary holds, 13 bids the primary holds under another
-- lot row, 2 events that do not collide, 2 lots that are the primary's lot (one with its exact source_url, one without the
-- trailing slash), one primary-flagged image on each vehicle. Added on top of the measurement: three comments and two bids
-- on the exact-URL lot (the cascade of a lot delete and the children-follow-their-lot rule), and images carrying a unique
-- hash and a shared hash.
-- ====================================================================================================================
INSERT INTO public.vehicles(id, vin, year, make, model) VALUES
 ('00000000-0000-0000-0000-00000000000a', '11111111111111111', 1987, 'Make A', 'Model A'),
 ('00000000-0000-0000-0000-00000000000b', NULL, 1987, 'Make A', 'Model A');

-- Lots: the duplicate's first row carries the very source_url the primary holds; its second is the same lot under a URL
-- without the trailing slash, which the exact-URL unique index cannot see and the normalised comparison does.
INSERT INTO public.auction_events(id, vehicle_id, source_url, source_listing_id) VALUES
 (pg_temp.u('f001', 1), '00000000-0000-0000-0000-00000000000a', 'https://example.invalid/lot/1/', 'lot-1'),
 (pg_temp.u('f002', 1), '00000000-0000-0000-0000-00000000000b', 'https://example.invalid/lot/1/', NULL),
 (pg_temp.u('f002', 2), '00000000-0000-0000-0000-00000000000b', 'https://example.invalid/lot/1', 'lot-1');

-- Comments: 56 on the duplicate's second lot, every hash also held by the primary's 56; three more on the colliding lot.
INSERT INTO public.auction_comments(id, auction_event_id, vehicle_id, content_hash, sequence_number)
SELECT pg_temp.u('c001', n), pg_temp.u('f002', 2), '00000000-0000-0000-0000-00000000000b', 'shared-comment-' || n, n
FROM generate_series(1, 56) n;
INSERT INTO public.auction_comments(id, auction_event_id, vehicle_id, content_hash, sequence_number)
SELECT pg_temp.u('c001', n), pg_temp.u('f002', 1), '00000000-0000-0000-0000-00000000000b', 'extra-comment-' || n, n - 56
FROM generate_series(57, 59) n;
INSERT INTO public.auction_comments(id, auction_event_id, vehicle_id, content_hash, sequence_number)
SELECT pg_temp.u('c002', n), pg_temp.u('f001', 1), '00000000-0000-0000-0000-00000000000a', 'shared-comment-' || n, n
FROM generate_series(1, 56) n;

-- Bids: 13 on the duplicate that the primary also holds (same bidder, amount and moment) under its own lot row. The lot
-- pointer is filled on eight of them and NULL on five, as it is on prod for a share of the rows.
INSERT INTO public.bat_bids(id, vehicle_id, bat_listing_id, bat_username, bid_amount, bid_timestamp, auction_event_id)
SELECT pg_temp.u('b001', n), '00000000-0000-0000-0000-00000000000b', pg_temp.u('1b01', 1), 'handle_' || n, 1000 * n,
       timestamptz '2022-08-25 12:00:00+00' + n * interval '1 hour', CASE WHEN n <= 8 THEN pg_temp.u('f002', 2) END
FROM generate_series(1, 13) n;
INSERT INTO public.bat_bids(id, vehicle_id, bat_listing_id, bat_username, bid_amount, bid_timestamp, auction_event_id)
SELECT pg_temp.u('b002', n), '00000000-0000-0000-0000-00000000000a', pg_temp.u('1b02', 1), 'handle_' || n, 1000 * n,
       timestamptz '2022-08-25 12:00:00+00' + n * interval '1 hour', pg_temp.u('f001', 1)
FROM generate_series(1, 13) n;
-- Two more bids on the duplicate's colliding lot, which the primary does not hold.
INSERT INTO public.bat_bids(id, vehicle_id, bat_listing_id, bat_username, bid_amount, bid_timestamp, auction_event_id) VALUES
 (pg_temp.u('b001', 14), '00000000-0000-0000-0000-00000000000b', pg_temp.u('1b01', 1), 'handle_20', 2000, timestamptz '2022-08-26 12:00:00+00', pg_temp.u('f002', 1)),
 (pg_temp.u('b001', 15), '00000000-0000-0000-0000-00000000000b', pg_temp.u('1b01', 1), 'handle_21', 2100, timestamptz '2022-08-26 13:00:00+00', pg_temp.u('f002', 1));

-- Events: the duplicate's two carry a platform and listing id the primary's one does not, so neither collides.
INSERT INTO public.vehicle_events(id, vehicle_id, source_platform, source_url, source_listing_id) VALUES
 (pg_temp.u('e001', 1), '00000000-0000-0000-0000-00000000000b', 'bat', 'https://example.invalid/lot/1', 'listing-path-1'),
 (pg_temp.u('e001', 2), '00000000-0000-0000-0000-00000000000b', 'bat', 'https://example.invalid/lot/1', 'lot-1'),
 (pg_temp.u('e002', 1), '00000000-0000-0000-0000-00000000000a', 'user-submission', 'https://example.invalid/lot/1/', NULL);

-- Images: each vehicle has one primary-flagged image. The duplicate also has an image with a hash only it holds.
INSERT INTO public.vehicle_images(id, vehicle_id, is_primary, file_hash) VALUES
 (pg_temp.u('1002', 1), '00000000-0000-0000-0000-00000000000a', true, NULL),
 (pg_temp.u('1002', 2), '00000000-0000-0000-0000-00000000000a', NULL, NULL),
 (pg_temp.u('1002', 3), '00000000-0000-0000-0000-00000000000a', NULL, NULL),
 (pg_temp.u('1001', 1), '00000000-0000-0000-0000-00000000000b', true, NULL),
 (pg_temp.u('1001', 2), '00000000-0000-0000-0000-00000000000b', NULL, 'hash-unique'),
 (pg_temp.u('1001', 3), '00000000-0000-0000-0000-00000000000b', NULL, NULL),
 (pg_temp.u('1001', 4), '00000000-0000-0000-0000-00000000000b', NULL, NULL);

-- One or two rows in every other table the writer already re-parents.
INSERT INTO public.vehicle_timeline(vehicle_id) SELECT '00000000-0000-0000-0000-00000000000b' FROM generate_series(1, 2);
INSERT INTO public.timeline_events(vehicle_id, event_type, title) SELECT '00000000-0000-0000-0000-00000000000b', 'note', 'note' FROM generate_series(1, 2);
INSERT INTO public.vehicle_comments(vehicle_id) SELECT '00000000-0000-0000-0000-00000000000b' FROM generate_series(1, 2);
INSERT INTO public.vehicle_price_history(vehicle_id) VALUES ('00000000-0000-0000-0000-00000000000b');
INSERT INTO public.vehicle_contributors(vehicle_id) VALUES ('00000000-0000-0000-0000-00000000000b');
INSERT INTO public.dealer_inventory(vehicle_id) VALUES ('00000000-0000-0000-0000-00000000000b');
INSERT INTO public.import_queue(vehicle_id) VALUES ('00000000-0000-0000-0000-00000000000b');
INSERT INTO public.organization_vehicles(organization_id, vehicle_id, relationship_type)
VALUES (pg_temp.u('0a01', 1), '00000000-0000-0000-0000-00000000000b', 'seller');
INSERT INTO public.external_listings(platform, listing_id, vehicle_id)
VALUES ('platform_a', 'listing-1', '00000000-0000-0000-0000-00000000000b');

-- Observations: the primary holds 30 of its own; the duplicate holds 20 live (18 fully keyed, 2 with a NULL hash).
INSERT INTO public.vehicle_observations(id, vehicle_id, kind, source_id, source_identifier, content_hash)
SELECT pg_temp.u('a002', n), '00000000-0000-0000-0000-00000000000a', 'listing', pg_temp.u('5001', 1),
       'https://example.invalid/lot/1#p' || n, 'primary-' || n
FROM generate_series(1, 30) n;
INSERT INTO public.vehicle_observations(id, vehicle_id, kind, source_id, source_identifier, content_hash)
SELECT pg_temp.u('a001', n), '00000000-0000-0000-0000-00000000000b', 'listing', pg_temp.u('5001', 1),
       'https://example.invalid/lot/1#d' || n, CASE WHEN n <= 18 THEN 'dup-' || n END
FROM generate_series(1, 20) n;

-- Supersede-and-copy cannot move a fully keyed row: unique_observation is table-wide, so the copy collides with its own
-- original whatever the primary holds. This is why live rows are relinked in place.
DO $$ BEGIN
  BEGIN
    INSERT INTO public.vehicle_observations(id, vehicle_id, kind, source_id, source_identifier, content_hash)
    SELECT gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', kind, source_id, source_identifier, content_hash
    FROM public.vehicle_observations WHERE id = pg_temp.u('a001', 1);
    RAISE EXCEPTION 'Contract failed: a copy of a fully keyed observation was accepted';
  EXCEPTION WHEN unique_violation THEN
    IF SQLERRM NOT LIKE '%unique_observation%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS a copy of a fully keyed observation collides with its own original';
  END;
END $$;

-- The frozen live writer on this shape (rolled back): it deletes the colliding lot row, the delete cascades to that lot's
-- three comments, 20 live observations, 15 bids and 2 events stay on the duplicate, and the live single-primary trigger
-- hands the primary vehicle's primary photo to the duplicate's image.
BEGIN;
DO $$ DECLARE r jsonb; BEGIN
  r := public.merge_vehicle_into_primary_by_url('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', 'contract: frozen live writer');
  PERFORM pg_temp.ok('frozen writer ran', r ->> 'success' = 'true');
  PERFORM pg_temp.ok('frozen writer deleted the colliding lot row',
    (SELECT count(*) FROM public.auction_events) = 2 AND NOT EXISTS (SELECT 1 FROM public.auction_events WHERE id = pg_temp.u('f002', 1)));
  PERFORM pg_temp.ok('frozen writer gave the primary two rows for one lot: it moved the copy that differs by a trailing slash',
    (SELECT count(*) FROM public.auction_events WHERE vehicle_id = '00000000-0000-0000-0000-00000000000a') = 2);
  PERFORM pg_temp.ok('frozen writer: the delete cascaded to that lot''s comments',
    (SELECT count(*) FROM public.auction_comments WHERE vehicle_id = '00000000-0000-0000-0000-00000000000b') = 56);
  PERFORM pg_temp.ok('frozen writer left 20 live observations, 15 bids and 2 events on the duplicate',
    (SELECT count(*) FROM public.vehicle_observations WHERE vehicle_id = '00000000-0000-0000-0000-00000000000b' AND NOT is_superseded) = 20
    AND (SELECT count(*) FROM public.bat_bids WHERE vehicle_id = '00000000-0000-0000-0000-00000000000b') = 15
    AND (SELECT count(*) FROM public.vehicle_events WHERE vehicle_id = '00000000-0000-0000-0000-00000000000b') = 2);
  PERFORM pg_temp.ok('frozen writer handed the primary photo over: the primary''s own image lost its flag, the duplicate''s took it',
    NOT COALESCE((SELECT is_primary FROM public.vehicle_images WHERE id = pg_temp.u('1002', 1)), false)
    AND (SELECT is_primary AND vehicle_id = '00000000-0000-0000-0000-00000000000a' FROM public.vehicle_images WHERE id = pg_temp.u('1001', 1))
    AND (SELECT count(*) FROM public.vehicle_images WHERE vehicle_id = '00000000-0000-0000-0000-00000000000a' AND is_primary) = 1);
END $$;
ROLLBACK;
SELECT pg_temp.ok('rollback restored the fixture',
  (SELECT count(*) FROM public.auction_events) = 3 AND (SELECT count(*) FROM public.auction_comments) = 115
  AND (SELECT count(*) FROM public.vehicle_observations) = 50
  AND (SELECT count(*) FROM public.vehicle_images WHERE vehicle_id = '00000000-0000-0000-0000-00000000000a') = 3
  AND (SELECT count(*) FROM public.vehicle_images WHERE vehicle_id = '00000000-0000-0000-0000-00000000000b') = 4);

-- An image on each vehicle with the same live file_hash: the move trips idx_unique_vehicle_file_hash.
INSERT INTO public.vehicle_images(id, vehicle_id, is_primary, file_hash) VALUES
 (pg_temp.u('1002', 4), '00000000-0000-0000-0000-00000000000a', NULL, 'hash-shared'),
 (pg_temp.u('1001', 5), '00000000-0000-0000-0000-00000000000b', NULL, 'hash-shared');
-- The frozen live writer aborts on it, and the whole merge with it.
DO $$ BEGIN
  BEGIN
    PERFORM public.merge_vehicle_into_primary_by_url('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', 'contract: frozen live writer');
    RAISE EXCEPTION 'Contract failed: the frozen writer survived a file_hash collision';
  EXCEPTION WHEN unique_violation THEN
    IF SQLERRM NOT LIKE '%idx_unique_vehicle_file_hash%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS the frozen writer aborts the whole merge on a file_hash collision';
  END;
END $$;

\ir ../migrations/20261006113000_merge_writer_reparent_children.sql

DO $$ DECLARE f text; BEGIN
  f := md5(pg_get_functiondef('public.merge_vehicle_into_primary_by_url(uuid,uuid,text)'::regprocedure));
  RAISE NOTICE 'post-migration fingerprint %', f;
  PERFORM pg_temp.ok('migration installs the expected body', f = '9fa01208977c21d54786ad4534560c3e'); -- gitleaks:allow (fingerprint)
END $$;

-- Re-running the migration is a no-op (the guard accepts the post-apply fingerprint and the post-assert holds again).
\ir ../migrations/20261006113000_merge_writer_reparent_children.sql

DO $$ DECLARE f text; BEGIN
  f := md5(pg_get_functiondef('public.merge_vehicle_into_primary_by_url(uuid,uuid,text)'::regprocedure));
  PERFORM pg_temp.ok('re-applying the migration leaves the body unchanged', f = '9fa01208977c21d54786ad4534560c3e'); -- gitleaks:allow (fingerprint)
END $$;

-- The new writer on scenario 1.
DO $$
DECLARE
  v_p uuid := '00000000-0000-0000-0000-00000000000a';
  v_d uuid := '00000000-0000-0000-0000-00000000000b';
  r jsonb; t text;
  n_lots int; n_comments int; n_bids int; n_events int; n_obs int; n_images int; n_left int; n_moved int;
BEGIN
  SELECT count(*) INTO n_lots FROM public.auction_events WHERE vehicle_id IN (v_p, v_d);
  SELECT count(*) INTO n_comments FROM public.auction_comments WHERE vehicle_id IN (v_p, v_d);
  SELECT count(*) INTO n_bids FROM public.bat_bids WHERE vehicle_id IN (v_p, v_d);
  SELECT count(*) INTO n_events FROM public.vehicle_events WHERE vehicle_id IN (v_p, v_d);
  SELECT count(*) INTO n_obs FROM public.vehicle_observations WHERE vehicle_id IN (v_p, v_d);
  SELECT count(*) INTO n_images FROM public.vehicle_images WHERE vehicle_id IN (v_p, v_d);

  r := public.merge_vehicle_into_primary_by_url(v_p, v_d, 'contract: lot twin');
  PERFORM pg_temp.ok('existing result keys kept',
    r ->> 'success' = 'true' AND (r ->> 'primary_vehicle_id')::uuid = v_p AND (r ->> 'duplicate_vehicle_id')::uuid = v_d);

  -- lots: never deleted
  PERFORM pg_temp.ok('no auction_events row deleted', n_lots = 3
    AND (SELECT count(*) FROM public.auction_events WHERE vehicle_id IN (v_p, v_d)) = n_lots);
  PERFORM pg_temp.ok('the colliding lot stays on the duplicate',
    (SELECT vehicle_id FROM public.auction_events WHERE id = pg_temp.u('f002', 1)) = v_d);
  PERFORM pg_temp.ok('the same lot without its trailing slash stays too: the primary does not get two rows for one lot',
    (SELECT vehicle_id FROM public.auction_events WHERE id = pg_temp.u('f002', 2)) = v_d
    AND (SELECT count(*) FROM public.auction_events WHERE vehicle_id = v_p) = 1);
  PERFORM pg_temp.ok('the primary''s own lot is untouched',
    (SELECT vehicle_id = v_p AND merged_from_vehicle_id IS NULL FROM public.auction_events WHERE id = pg_temp.u('f001', 1)));
  PERFORM pg_temp.ok('lots reported', r #> '{reparented,auction_events}' = '{"moved":0,"left_on_duplicate":2}'::jsonb);

  -- images: the primary keeps its own primary photo, the duplicate's flagged image is demoted, a shared hash stays
  PERFORM pg_temp.ok('no image deleted', n_images = 9
    AND (SELECT count(*) FROM public.vehicle_images WHERE vehicle_id IN (v_p, v_d)) = n_images);
  PERFORM pg_temp.ok('exactly one primary image on the primary vehicle, and it is the primary''s own',
    (SELECT count(*) FROM public.vehicle_images WHERE vehicle_id = v_p AND is_primary) = 1
    AND (SELECT is_primary AND vehicle_id = v_p FROM public.vehicle_images WHERE id = pg_temp.u('1002', 1)));
  PERFORM pg_temp.ok('the duplicate''s former primary moved and was demoted',
    (SELECT vehicle_id = v_p AND NOT COALESCE(is_primary, false) FROM public.vehicle_images WHERE id = pg_temp.u('1001', 1)));
  PERFORM pg_temp.ok('the image whose hash the primary holds stays on the duplicate; the unique-hash image moved',
    (SELECT vehicle_id FROM public.vehicle_images WHERE id = pg_temp.u('1001', 5)) = v_d
    AND (SELECT vehicle_id FROM public.vehicle_images WHERE id = pg_temp.u('1001', 2)) = v_p
    AND (SELECT count(*) FROM public.vehicle_images WHERE vehicle_id = v_p) = 8
    AND (SELECT count(*) FROM public.vehicle_images WHERE vehicle_id = v_d) = 1);
  PERFORM pg_temp.ok('images reported', r #> '{reparented,vehicle_images}' = '{"moved":4,"left_on_duplicate":1,"demoted_primary":1}'::jsonb);

  -- observations: every live row of the duplicate now carries the primary's vehicle_id, relinked in place
  PERFORM pg_temp.ok('no observation inserted or deleted',
    n_obs = 50 AND (SELECT count(*) FROM public.vehicle_observations WHERE vehicle_id IN (v_p, v_d)) = n_obs
    AND (SELECT count(*) FROM public.vehicle_observations) = 50);
  PERFORM pg_temp.ok('the duplicate holds no observation at all',
    NOT EXISTS (SELECT 1 FROM public.vehicle_observations WHERE vehicle_id = v_d));
  PERFORM pg_temp.ok('all 20 live observations carry the primary''s vehicle_id: same rows, still live, naming their origin',
    (SELECT count(*) FROM public.vehicle_observations
      WHERE id IN (SELECT pg_temp.u('a001', n) FROM generate_series(1, 20) n)
        AND vehicle_id = v_p AND NOT is_superseded AND superseded_by IS NULL AND merged_from_vehicle_id = v_d) = 20);
  PERFORM pg_temp.ok('the primary''s own observations are untouched and it now holds 50 live ones',
    (SELECT count(*) FROM public.vehicle_observations
      WHERE id IN (SELECT pg_temp.u('a002', n) FROM generate_series(1, 30) n)
        AND vehicle_id = v_p AND NOT is_superseded AND merged_from_vehicle_id IS NULL) = 30
    AND (SELECT count(*) FROM public.vehicle_observations WHERE vehicle_id = v_p AND NOT is_superseded) = 50);
  PERFORM pg_temp.ok('20 audit rows, one per relink: old = new row, duplicate to primary, reason carries the merge reason',
    (SELECT count(*) FROM public.reattribution_audit) = 20
    AND (SELECT count(*) FROM public.reattribution_audit
          WHERE observation_type = 'observation' AND old_vehicle_id = v_d AND new_vehicle_id = v_p
            AND old_observation_id = new_observation_id AND reason LIKE '%contract: lot twin%') = 20
    AND (SELECT count(DISTINCT old_observation_id) FROM public.reattribution_audit) = 20);
  PERFORM pg_temp.ok('observations reported', r #> '{reparented,vehicle_observations}' = '{"moved":20,"left_on_duplicate":0}'::jsonb);

  -- comments: the 56 the primary already holds stay; the colliding lot's three stay with their lot
  PERFORM pg_temp.ok('no comment deleted, and the colliding lot''s comments still exist (no cascade)',
    (SELECT count(*) FROM public.auction_comments WHERE vehicle_id IN (v_p, v_d)) = n_comments AND n_comments = 115
    AND (SELECT count(*) FROM public.auction_comments WHERE auction_event_id = pg_temp.u('f002', 1)) = 3);
  PERFORM pg_temp.ok('the 56 comments the primary already holds stay on the duplicate',
    (SELECT count(*) FROM public.auction_comments WHERE vehicle_id = v_d AND content_hash LIKE 'shared-comment-%') = 56);
  PERFORM pg_temp.ok('children follow their lot: the three comments of the lot that stayed stay with it',
    (SELECT count(*) FROM public.auction_comments WHERE vehicle_id = v_d AND auction_event_id = pg_temp.u('f002', 1)) = 3
    AND (SELECT count(*) FROM public.auction_comments WHERE vehicle_id = v_d) = 59
    AND (SELECT count(*) FROM public.auction_comments WHERE vehicle_id = v_p) = 56);
  PERFORM pg_temp.ok('comments reported', r #> '{reparented,auction_comments}' = '{"moved":0,"left_on_duplicate":59}'::jsonb);

  -- bids: the primary already holds 13 of them, so those stay and none are listed twice; the two on the lot that stayed
  -- stay with it
  PERFORM pg_temp.ok('no bid deleted, none listed twice',
    (SELECT count(*) FROM public.bat_bids WHERE vehicle_id IN (v_p, v_d)) = n_bids AND n_bids = 28
    AND (SELECT count(*) FROM public.bat_bids WHERE vehicle_id = v_p) = 13);
  PERFORM pg_temp.ok('children follow their lot: the two bids of the lot that stayed stay with it',
    (SELECT count(*) FROM public.bat_bids WHERE vehicle_id = v_d AND auction_event_id = pg_temp.u('f002', 1)) = 2
    AND (SELECT count(*) FROM public.bat_bids WHERE vehicle_id = v_d) = 15);
  PERFORM pg_temp.ok('bids reported', r #> '{reparented,bat_bids}' = '{"moved":0,"left_on_duplicate":15}'::jsonb);

  -- vehicle_events: neither collides, both move
  PERFORM pg_temp.ok('both events moved, none deleted',
    (SELECT count(*) FROM public.vehicle_events WHERE vehicle_id = v_p) = 3
    AND NOT EXISTS (SELECT 1 FROM public.vehicle_events WHERE vehicle_id = v_d) AND n_events = 3);
  PERFORM pg_temp.ok('events reported', r #> '{reparented,vehicle_events}' = '{"moved":2,"left_on_duplicate":0}'::jsonb);

  -- everything the writer already moved is still moved
  FOREACH t IN ARRAY ARRAY['vehicle_timeline', 'timeline_events', 'vehicle_comments', 'vehicle_price_history',
                           'vehicle_contributors', 'dealer_inventory', 'import_queue'] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE vehicle_id = $1', t) INTO n_left USING v_d;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE vehicle_id = $1', t) INTO n_moved USING v_p;
    PERFORM pg_temp.ok('core table re-parented: ' || t, n_left = 0 AND n_moved >= 1);
  END LOOP;
  PERFORM pg_temp.ok('organization link and external listing moved',
    (SELECT count(*) FROM public.organization_vehicles WHERE vehicle_id = v_p AND relationship_type = 'seller') = 1
    AND (SELECT count(*) FROM public.external_listings WHERE vehicle_id = v_p AND listing_id = 'listing-1') = 1);

  -- the duplicate is marked merged; the primary keeps its identity and records the merge once
  PERFORM pg_temp.ok('duplicate marked merged and hidden',
    (SELECT merged_into_vehicle_id = v_p AND is_public IS FALSE FROM public.vehicles WHERE id = v_d));
  PERFORM pg_temp.ok('primary keeps its VIN and gets one profile_merged event',
    (SELECT vin FROM public.vehicles WHERE id = v_p) = '11111111111111111'
    AND (SELECT count(*) FROM public.timeline_events WHERE vehicle_id = v_p AND event_type = 'profile_merged') = 1);
END $$;

-- Calling it again moves nothing more, deletes nothing, and reports the same rows left.
DO $$
DECLARE
  v_p uuid := '00000000-0000-0000-0000-00000000000a';
  v_d uuid := '00000000-0000-0000-0000-00000000000b';
  r jsonb;
BEGIN
  r := public.merge_vehicle_into_primary_by_url(v_p, v_d, 'contract: second call');
  PERFORM pg_temp.ok('second call moves and demotes nothing',
    (r #>> '{reparented,vehicle_images,moved}')::int = 0 AND (r #>> '{reparented,vehicle_images,demoted_primary}')::int = 0
    AND (r #>> '{reparented,vehicle_observations,moved}')::int = 0 AND (r #>> '{reparented,auction_comments,moved}')::int = 0
    AND (r #>> '{reparented,bat_bids,moved}')::int = 0 AND (r #>> '{reparented,vehicle_events,moved}')::int = 0
    AND (r #>> '{reparented,auction_events,moved}')::int = 0);
  PERFORM pg_temp.ok('second call reports the same rows left',
    (r #>> '{reparented,vehicle_images,left_on_duplicate}')::int = 1 AND (r #>> '{reparented,vehicle_observations,left_on_duplicate}')::int = 0
    AND (r #>> '{reparented,auction_comments,left_on_duplicate}')::int = 59 AND (r #>> '{reparented,bat_bids,left_on_duplicate}')::int = 15
    AND (r #>> '{reparented,vehicle_events,left_on_duplicate}')::int = 0 AND (r #>> '{reparented,auction_events,left_on_duplicate}')::int = 2);
  PERFORM pg_temp.ok('second call deleted and inserted nothing, and kept the primary''s own primary image',
    (SELECT count(*) FROM public.auction_events) = 3 AND (SELECT count(*) FROM public.auction_comments) = 115
    AND (SELECT count(*) FROM public.bat_bids) = 28 AND (SELECT count(*) FROM public.vehicle_events) = 3
    AND (SELECT count(*) FROM public.vehicle_observations) = 50 AND (SELECT count(*) FROM public.vehicle_images) = 9
    AND (SELECT count(*) FROM public.reattribution_audit) = 20
    AND (SELECT is_primary FROM public.vehicle_images WHERE id = pg_temp.u('1002', 1)));
END $$;

-- Invalid input keeps its existing answers.
DO $$ BEGIN
  PERFORM pg_temp.ok('the same id twice is refused',
    public.merge_vehicle_into_primary_by_url('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a') ->> 'error' = 'invalid_ids');
  PERFORM pg_temp.ok('an unknown duplicate is refused',
    public.merge_vehicle_into_primary_by_url('00000000-0000-0000-0000-00000000000a', pg_temp.u('dead', 1)) ->> 'error' = 'vehicle_not_found');
END $$;

-- ====================================================================================================================
-- Scenario 2: mixed collisions, children that follow their lot, a NULL-url lot, a row a live guard refuses, and unique
-- keys the pre-checks do not model (primary ...a2, duplicate ...b2), merged with a NULL reason.
-- ====================================================================================================================
-- Dependency fixture modelled on the live validate_retained_listing_property_source(): a derived observation
-- (source_observation_id set) cannot change its vehicle; same message and SQLSTATE as live.
CREATE FUNCTION public.fixture_guard_derived_observation() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF OLD.source_observation_id IS NOT NULL AND NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id THEN
    RAISE EXCEPTION 'retained property source tuple is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER fixture_guard_derived_observation BEFORE UPDATE ON public.vehicle_observations
  FOR EACH ROW WHEN (OLD.source_observation_id IS NOT NULL) EXECUTE FUNCTION public.fixture_guard_derived_observation();
-- Synthetic stand-ins for unique keys the writer's pre-checks do not model (one per table that retries row by row),
-- scoped by value so they do not touch scenario 1.
CREATE UNIQUE INDEX fixture_unmodelled_comment_key ON public.auction_comments(vehicle_id, bat_comment_id) WHERE bat_comment_id IS NOT NULL;
CREATE UNIQUE INDEX fixture_unmodelled_bid_key ON public.bat_bids(vehicle_id, bat_username, bid_amount);
CREATE UNIQUE INDEX fixture_unmodelled_event_key ON public.vehicle_events(vehicle_id, source_url) WHERE source_platform = 'bat2';
CREATE UNIQUE INDEX fixture_unmodelled_lot_key ON public.auction_events(vehicle_id, source_listing_id) WHERE source_listing_id = 'listing-2';
CREATE UNIQUE INDEX fixture_unmodelled_image_key ON public.vehicle_images(vehicle_id, file_name) WHERE file_name IS NOT NULL;

INSERT INTO public.vehicles(id, year, make, model) VALUES
 ('00000000-0000-0000-0000-0000000000a2', 1990, 'Make B', 'Model B'),
 ('00000000-0000-0000-0000-0000000000b2', 1990, 'Make B', 'Model B');
-- Lots: the primary and the duplicate each carry a lot with no source_url (the frozen writer deleted such a duplicate row;
-- now it moves, as NULLs never collide). The duplicate's second lot shares a listing id with the primary's (collides only
-- on the stand-in key, so it stays); its third is new to the primary and moves. Its fourth is a lot the primary holds,
-- written in another case with two trailing slashes (collides on the normalised URL, so it stays).
INSERT INTO public.auction_events(id, vehicle_id, source_url, source_listing_id) VALUES
 (pg_temp.u('f003', 1), '00000000-0000-0000-0000-0000000000a2', NULL, 'listing-2'),
 (pg_temp.u('f003', 2), '00000000-0000-0000-0000-0000000000a2', 'https://example.invalid/lot/9', NULL),
 (pg_temp.u('f004', 1), '00000000-0000-0000-0000-0000000000b2', NULL, NULL),
 (pg_temp.u('f004', 2), '00000000-0000-0000-0000-0000000000b2', 'https://example.invalid/lot/2', 'listing-2'),
 (pg_temp.u('f004', 3), '00000000-0000-0000-0000-0000000000b2', 'https://example.invalid/lot/4', NULL),
 (pg_temp.u('f004', 4), '00000000-0000-0000-0000-0000000000b2', 'HTTPS://Example.Invalid/LOT/9//', NULL);
-- Observations on the duplicate: a plain row, a row derived from it (the guard refuses to move it), another plain row,
-- and three superseded history rows that must stay where they are.
INSERT INTO public.vehicle_observations(id, vehicle_id, kind, source_id, source_identifier, content_hash, source_observation_id) VALUES
 (pg_temp.u('a003', 1), '00000000-0000-0000-0000-0000000000b2', 'listing', pg_temp.u('5001', 1), 'https://example.invalid/lot/2#1', 'dup2-1', NULL),
 (pg_temp.u('a003', 2), '00000000-0000-0000-0000-0000000000b2', 'specification', pg_temp.u('5001', 1), 'derived-from-1', 'dup2-2', pg_temp.u('a003', 1)),
 (pg_temp.u('a003', 3), '00000000-0000-0000-0000-0000000000b2', 'listing', pg_temp.u('5001', 1), 'https://example.invalid/lot/2#3', 'dup2-3', NULL);
INSERT INTO public.vehicle_observations(id, vehicle_id, kind, source_id, source_identifier, content_hash, is_superseded, superseded_by)
SELECT pg_temp.u('a003', n), '00000000-0000-0000-0000-0000000000b2', 'listing', pg_temp.u('5001', 1),
       'https://example.invalid/lot/2#h' || n, 'history2-' || n, true, pg_temp.u('a003', 1)
FROM generate_series(4, 6) n;
-- Comments. Primary: two. Duplicate: one that collides only on the stand-in key, one with no lot (moves), one whose hash
-- the primary holds, one on the lot that stayed (stays with it), one on a moved lot and one on the moved NULL-url lot (move).
INSERT INTO public.auction_comments(id, auction_event_id, vehicle_id, content_hash, bat_comment_id) VALUES
 (pg_temp.u('c003', 1), NULL, '00000000-0000-0000-0000-0000000000a2', 'p2-hash-1', 101),
 (pg_temp.u('c003', 2), NULL, '00000000-0000-0000-0000-0000000000a2', 'shared-p2', NULL),
 (pg_temp.u('c004', 1), NULL, '00000000-0000-0000-0000-0000000000b2', 'd2-hash-1', 101),
 (pg_temp.u('c004', 2), NULL, '00000000-0000-0000-0000-0000000000b2', 'd2-hash-2', 102),
 (pg_temp.u('c004', 3), NULL, '00000000-0000-0000-0000-0000000000b2', 'shared-p2', NULL),
 (pg_temp.u('c004', 4), pg_temp.u('f004', 2), '00000000-0000-0000-0000-0000000000b2', 'd2-hash-4', NULL),
 (pg_temp.u('c004', 5), pg_temp.u('f004', 3), '00000000-0000-0000-0000-0000000000b2', 'd2-hash-5', NULL),
 (pg_temp.u('c004', 6), pg_temp.u('f004', 1), '00000000-0000-0000-0000-0000000000b2', 'd2-hash-6', NULL),
 (pg_temp.u('c004', 7), pg_temp.u('f004', 4), '00000000-0000-0000-0000-0000000000b2', 'd2-hash-7', NULL);
-- Bids. Primary: two. Duplicate: one that collides only on the stand-in key, one new with no lot (moves), one the primary
-- holds, one on the lot that stayed (stays with it), one on a moved lot (moves).
INSERT INTO public.bat_bids(id, vehicle_id, bat_listing_id, bat_username, bid_amount, bid_timestamp, auction_event_id) VALUES
 (pg_temp.u('b003', 1), '00000000-0000-0000-0000-0000000000a2', pg_temp.u('1b03', 1), 'handle_1', 500, timestamptz '2022-09-02 12:00:00+00', NULL),
 (pg_temp.u('b003', 2), '00000000-0000-0000-0000-0000000000a2', pg_temp.u('1b03', 1), 'handle_9', 900, timestamptz '2022-09-03 09:00:00+00', NULL),
 (pg_temp.u('b004', 1), '00000000-0000-0000-0000-0000000000b2', pg_temp.u('1b04', 1), 'handle_1', 500, timestamptz '2022-09-01 13:00:00+00', NULL),
 (pg_temp.u('b004', 2), '00000000-0000-0000-0000-0000000000b2', pg_temp.u('1b04', 1), 'handle_2', 1000, timestamptz '2022-09-01 14:00:00+00', NULL),
 (pg_temp.u('b004', 3), '00000000-0000-0000-0000-0000000000b2', pg_temp.u('1b04', 1), 'handle_9', 900, timestamptz '2022-09-03 09:00:00+00', NULL),
 (pg_temp.u('b004', 4), '00000000-0000-0000-0000-0000000000b2', pg_temp.u('1b04', 1), 'handle_4', 400, timestamptz '2022-09-01 15:00:00+00', pg_temp.u('f004', 2)),
 (pg_temp.u('b004', 5), '00000000-0000-0000-0000-0000000000b2', pg_temp.u('1b04', 1), 'handle_5', 550, timestamptz '2022-09-01 16:00:00+00', pg_temp.u('f004', 3));
-- Events: the duplicate's first has another listing id than the primary's but the same URL (collides only on the stand-in
-- key); its second is new; its third has the platform and listing id of one the primary holds (the pre-check leaves it).
INSERT INTO public.vehicle_events(id, vehicle_id, source_platform, source_url, source_listing_id) VALUES
 (pg_temp.u('e004', 1), '00000000-0000-0000-0000-0000000000a2', 'bat2', 'https://example.invalid/lot/2', 'y2'),
 (pg_temp.u('e004', 2), '00000000-0000-0000-0000-0000000000a2', 'bat2', 'https://example.invalid/lot/5', 'z2'),
 (pg_temp.u('e003', 1), '00000000-0000-0000-0000-0000000000b2', 'bat2', 'https://example.invalid/lot/2', 'x2'),
 (pg_temp.u('e003', 2), '00000000-0000-0000-0000-0000000000b2', 'bat2', 'https://example.invalid/lot/3', 'x3'),
 (pg_temp.u('e003', 3), '00000000-0000-0000-0000-0000000000b2', 'bat2', 'https://example.invalid/lot/6', 'z2');
-- Images. The primary has a primary image. The duplicate has a document-flagged primary (outside the one-primary index:
-- the live trigger would still clear the primary's flag when it moves), one image sharing a file name with the primary's
-- (collides only on the stand-in key), and a plain one.
INSERT INTO public.vehicle_images(id, vehicle_id, is_primary, is_document, file_name) VALUES
 (pg_temp.u('1004', 1), '00000000-0000-0000-0000-0000000000a2', true, NULL, NULL),
 (pg_temp.u('1004', 2), '00000000-0000-0000-0000-0000000000a2', NULL, NULL, 'frame-2.jpg'),
 (pg_temp.u('1003', 1), '00000000-0000-0000-0000-0000000000b2', true, true, NULL),
 (pg_temp.u('1003', 2), '00000000-0000-0000-0000-0000000000b2', NULL, NULL, NULL),
 (pg_temp.u('1003', 3), '00000000-0000-0000-0000-0000000000b2', NULL, NULL, 'frame-2.jpg');

DO $$
DECLARE
  v_p uuid := '00000000-0000-0000-0000-0000000000a2';
  v_d uuid := '00000000-0000-0000-0000-0000000000b2';
  r jsonb;
BEGIN
  r := public.merge_vehicle_into_primary_by_url(v_p, v_d, NULL);
  PERFORM pg_temp.ok('merge completes with a NULL reason', r ->> 'success' = 'true');
  PERFORM pg_temp.ok('lots: a NULL-url lot moves, a lot colliding on an unmodelled key stays, none deleted',
    (SELECT count(*) FROM public.auction_events WHERE vehicle_id IN (v_p, v_d)) = 6
    AND (SELECT vehicle_id = v_p AND merged_from_vehicle_id = v_d FROM public.auction_events WHERE id = pg_temp.u('f004', 1))
    AND (SELECT vehicle_id FROM public.auction_events WHERE id = pg_temp.u('f004', 2)) = v_d
    AND (SELECT vehicle_id = v_p AND merged_from_vehicle_id = v_d FROM public.auction_events WHERE id = pg_temp.u('f004', 3))
    AND r #> '{reparented,auction_events}' = '{"moved":2,"left_on_duplicate":2}'::jsonb);
  PERFORM pg_temp.ok('lots: a lot the primary holds, written in another case with two trailing slashes, stays with its comment',
    (SELECT vehicle_id FROM public.auction_events WHERE id = pg_temp.u('f004', 4)) = v_d
    AND (SELECT vehicle_id FROM public.auction_comments WHERE id = pg_temp.u('c004', 7)) = v_d
    AND (SELECT count(*) FROM public.auction_events WHERE vehicle_id = v_p AND lower(rtrim(source_url, '/')) = 'https://example.invalid/lot/9') = 1);
  PERFORM pg_temp.ok('a row the guard trigger refuses stays live and unstamped on the duplicate and is counted; the rest moved',
    (SELECT vehicle_id = v_d AND NOT is_superseded AND merged_from_vehicle_id IS NULL FROM public.vehicle_observations WHERE id = pg_temp.u('a003', 2))
    AND (SELECT count(*) FROM public.vehicle_observations WHERE id IN (pg_temp.u('a003', 1), pg_temp.u('a003', 3)) AND vehicle_id = v_p AND merged_from_vehicle_id = v_d) = 2
    AND r #> '{reparented,vehicle_observations}' = '{"moved":2,"left_on_duplicate":1}'::jsonb);
  PERFORM pg_temp.ok('superseded history rows stay on the duplicate untouched and are not counted as left',
    (SELECT count(*) FROM public.vehicle_observations WHERE vehicle_id = v_d AND is_superseded AND merged_from_vehicle_id IS NULL) = 3);
  PERFORM pg_temp.ok('audit has the two relinks only, with the default reason when none is given',
    (SELECT count(*) FROM public.reattribution_audit WHERE old_vehicle_id = v_d) = 2
    AND NOT EXISTS (SELECT 1 FROM public.reattribution_audit WHERE old_vehicle_id = v_d AND reason NOT LIKE '%canonical_url_match%'));
  PERFORM pg_temp.ok('comments follow their lot: the comment of the lot that stayed stays, a moved lot''s and a lot-less comment move',
    (SELECT vehicle_id FROM public.auction_comments WHERE id = pg_temp.u('c004', 4)) = v_d
    AND (SELECT vehicle_id = v_p AND merged_from_vehicle_id = v_d FROM public.auction_comments WHERE id = pg_temp.u('c004', 5))
    AND (SELECT vehicle_id = v_p AND merged_from_vehicle_id = v_d FROM public.auction_comments WHERE id = pg_temp.u('c004', 6))
    AND (SELECT vehicle_id = v_p AND merged_from_vehicle_id = v_d FROM public.auction_comments WHERE id = pg_temp.u('c004', 2)));
  PERFORM pg_temp.ok('comments: the unmodelled-key row and the hash-colliding row stay, counts match',
    (SELECT vehicle_id FROM public.auction_comments WHERE id = pg_temp.u('c004', 1)) = v_d
    AND (SELECT vehicle_id FROM public.auction_comments WHERE id = pg_temp.u('c004', 3)) = v_d
    AND (SELECT count(*) FROM public.auction_comments WHERE vehicle_id IN (v_p, v_d)) = 9
    AND r #> '{reparented,auction_comments}' = '{"moved":3,"left_on_duplicate":4}'::jsonb);
  PERFORM pg_temp.ok('bids follow their lot: the bid of the lot that stayed stays, a moved lot''s and a lot-less bid move',
    (SELECT vehicle_id FROM public.bat_bids WHERE id = pg_temp.u('b004', 4)) = v_d
    AND (SELECT vehicle_id FROM public.bat_bids WHERE id = pg_temp.u('b004', 5)) = v_p
    AND (SELECT vehicle_id FROM public.bat_bids WHERE id = pg_temp.u('b004', 2)) = v_p);
  PERFORM pg_temp.ok('bids: the unmodelled-key bid and the bid the primary holds stay, counts match',
    (SELECT vehicle_id FROM public.bat_bids WHERE id = pg_temp.u('b004', 1)) = v_d
    AND (SELECT vehicle_id FROM public.bat_bids WHERE id = pg_temp.u('b004', 3)) = v_d
    AND (SELECT count(*) FROM public.bat_bids WHERE vehicle_id IN (v_p, v_d)) = 7
    AND r #> '{reparented,bat_bids}' = '{"moved":2,"left_on_duplicate":3}'::jsonb);
  PERFORM pg_temp.ok('events: the unmodelled-key event and the keyed-like-the-primary event stay, the other moved',
    (SELECT vehicle_id FROM public.vehicle_events WHERE id = pg_temp.u('e003', 1)) = v_d
    AND (SELECT vehicle_id FROM public.vehicle_events WHERE id = pg_temp.u('e003', 3)) = v_d
    AND (SELECT vehicle_id FROM public.vehicle_events WHERE id = pg_temp.u('e003', 2)) = v_p
    AND (SELECT count(*) FROM public.vehicle_events WHERE vehicle_id IN (v_p, v_d)) = 5
    AND r #> '{reparented,vehicle_events}' = '{"moved":1,"left_on_duplicate":2}'::jsonb);
  PERFORM pg_temp.ok('images: a moving row flagged primary is demoted even outside the index, so the primary keeps its own primary photo',
    (SELECT count(*) FROM public.vehicle_images WHERE vehicle_id = v_p AND is_primary) = 1
    AND (SELECT is_primary AND vehicle_id = v_p FROM public.vehicle_images WHERE id = pg_temp.u('1004', 1))
    AND (SELECT vehicle_id = v_p AND NOT COALESCE(is_primary, false) FROM public.vehicle_images WHERE id = pg_temp.u('1003', 1)));
  PERFORM pg_temp.ok('images: the row colliding only on an unmodelled key stays, the others moved, none deleted',
    (SELECT vehicle_id FROM public.vehicle_images WHERE id = pg_temp.u('1003', 3)) = v_d
    AND (SELECT vehicle_id FROM public.vehicle_images WHERE id = pg_temp.u('1003', 2)) = v_p
    AND (SELECT count(*) FROM public.vehicle_images WHERE vehicle_id IN (v_p, v_d)) = 5
    AND r #> '{reparented,vehicle_images}' = '{"moved":2,"left_on_duplicate":1,"demoted_primary":1}'::jsonb);
END $$;

-- ====================================================================================================================
-- Scenario 3: a primary with no primary image keeps the moved flag; a missing primary raises (primary ...a3, duplicate ...b3)
-- ====================================================================================================================
INSERT INTO public.vehicles(id, year, make, model) VALUES
 ('00000000-0000-0000-0000-0000000000a3', 1991, 'Make C', 'Model C'),
 ('00000000-0000-0000-0000-0000000000b3', 1991, 'Make C', 'Model C');
INSERT INTO public.vehicle_images(id, vehicle_id, is_primary) VALUES
 (pg_temp.u('1006', 1), '00000000-0000-0000-0000-0000000000a3', NULL),
 (pg_temp.u('1005', 1), '00000000-0000-0000-0000-0000000000b3', true),
 (pg_temp.u('1005', 2), '00000000-0000-0000-0000-0000000000b3', NULL);
DO $$ BEGIN
  BEGIN
    PERFORM public.merge_vehicle_into_primary_by_url(pg_temp.u('dead', 2), '00000000-0000-0000-0000-0000000000b3');
    RAISE EXCEPTION 'Contract failed: a missing primary was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%primary vehicle % does not exist' THEN RAISE; END IF;
    RAISE NOTICE 'PASS a missing primary raises';
  END;
  PERFORM pg_temp.ok('a missing primary re-parents nothing',
    (SELECT count(*) FROM public.vehicle_images WHERE vehicle_id = '00000000-0000-0000-0000-0000000000b3') = 2);
END $$;
DO $$
DECLARE
  v_p uuid := '00000000-0000-0000-0000-0000000000a3';
  v_d uuid := '00000000-0000-0000-0000-0000000000b3';
  r jsonb;
BEGIN
  r := public.merge_vehicle_into_primary_by_url(v_p, v_d, 'contract: no primary image');
  PERFORM pg_temp.ok('a primary with no primary image keeps the moved flag: exactly one primary, the moved one',
    (SELECT count(*) FROM public.vehicle_images WHERE vehicle_id = v_p AND is_primary) = 1
    AND (SELECT is_primary AND vehicle_id = v_p FROM public.vehicle_images WHERE id = pg_temp.u('1005', 1))
    AND r #> '{reparented,vehicle_images}' = '{"moved":2,"left_on_duplicate":0,"demoted_primary":0}'::jsonb);
END $$;

-- ====================================================================================================================
-- Drift guard: a body that is neither the live definition nor this migration's is refused and left alone.
-- ====================================================================================================================
CREATE OR REPLACE FUNCTION public.merge_vehicle_into_primary_by_url(p_primary_vehicle_id uuid, p_duplicate_vehicle_id uuid, p_reason text DEFAULT 'canonical_url_match'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN jsonb_build_object('success', false, 'error', 'drifted fixture');
END;
$function$;
SELECT md5(pg_get_functiondef('public.merge_vehicle_into_primary_by_url(uuid,uuid,text)'::regprocedure)) AS drifted_fp \gset
\echo The ERROR below is the drift guard of the migration refusing a drifted body: the expected result.
\set ON_ERROR_STOP off
\ir ../migrations/20261006113000_merge_writer_reparent_children.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok('drifted body: migration refused, definition untouched',
  md5(pg_get_functiondef('public.merge_vehicle_into_primary_by_url(uuid,uuid,text)'::regprocedure)) = :'drifted_fp');

SELECT 'merge-writer reparent children contract: all passed' AS result;
