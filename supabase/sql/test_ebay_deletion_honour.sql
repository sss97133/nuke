-- Isolated PostgreSQL 17 contract for 20261022030000_ebay_deletion_honour.sql. Stand-in tables with the live column names;
-- synthetic members, listings and text only; never production. Run in an empty disposable dm_refinement_* database:
--   scripts/ci/run-db-contracts.sh test_ebay_deletion_honour.sql
-- Covered: the request table keeps hashes only (existing plain handles erased, new ones never written, the constraint);
-- the scan finds a deleted member in every place by hash, pages by keyset, counts stored pages not yet read as not_assessed;
-- finish refuses while anything is unread; the redactor removes the seller's handle and feedback from episodes, observations,
-- the inline getItem JSON, the vehicle, the identity and the parts catalog, replaces the description's contact details on
-- their own listings, replaces a bidder's handle where a page names them, keeps listing, price, place, vehicle and the other
-- members, leaves BaT rows alone, writes a receipt with no handle, is idempotent and refuses a handle that is not the
-- member's; the stored-page receipt; statuses honoured / no_data with counts-only receipts; the proof query; the ACL.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.vehicle_events') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* PostgreSQL 17 database';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE TABLE public.observation_sources (id uuid PRIMARY KEY, slug text UNIQUE);
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, seller_name text, description text, source text, asking_price numeric);
CREATE TABLE public.vehicle_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, source_platform text, source_url text,
  source_listing_id text, current_price numeric, seller_identifier text, buyer_identifier text, metadata jsonb, updated_at timestamptz);
CREATE TABLE public.vehicle_observations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, source_id uuid, source_identifier text,
  kind text DEFAULT 'listing', content_text text, content_hash text, structured_data jsonb, extraction_metadata jsonb);
CREATE TABLE public.listing_page_snapshots (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), platform text, listing_url text, fetched_at timestamptz DEFAULT now(),
  fetch_method text, success boolean DEFAULT true, html text, html_sha256 text, content_length integer, metadata jsonb,
  html_storage_path text, markdown_storage_path text);
CREATE UNIQUE INDEX uq_listing_page_snapshots_platform_url_sha ON public.listing_page_snapshots (platform, listing_url, html_sha256) WHERE html_sha256 IS NOT NULL;
CREATE TABLE public.external_identities (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), platform text, handle text, profile_url text,
  display_name text, updated_at timestamptz, UNIQUE (platform, handle));
CREATE TABLE public.ebay_parts_catalog (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), discovered_sellers text[], top_seller_username text,
  sample_listings jsonb, updated_at timestamptz);
-- the live definition (20261020185000_invoice_party_reads_and_description_redaction.sql)
CREATE FUNCTION public.text_redact_contact(p_text text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO '' AS $f$
  SELECT regexp_replace(regexp_replace(p_text,
    '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}', '[contact through Nuke]', 'g'),
    '(\(\d{3}\)|\m\d{3})[-. )]*\d{3}[-. ]*\d{4}(?![0-9])', '[contact through Nuke]', 'g')
$f$;
CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF; RAISE NOTICE 'PASS %', label; END $$;
CREATE FUNCTION pg_temp.h(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT encode(sha256(convert_to(lower(btrim(p)), 'UTF8')), 'hex') $$;

\ir ../migrations/20261015190000_ebay_deletion_requests.sql

-- synthetic members: deleted_seller_77 sold A (Browse) and B (archived); gone_bidder_12 bid on C, whose seller keeper_seller stays;
-- never_here_99 left no trace. Two notices arrive before the honour migration (plain, as the first receiver stored them).
INSERT INTO public.observation_sources VALUES ('00000000-0000-0000-0000-00000000eb01', 'ebay_motors');
SELECT public.record_ebay_deletion('n-77', 'Deleted_Seller_77', 'uid77', now(), now(), false);
SELECT public.record_ebay_deletion('n-12', 'gone_bidder_12', 'uid12', now(), now(), false);
SELECT public.record_ebay_deletion('n-99', 'never_here_99', 'uid99', now(), now(), false);
SELECT pg_temp.ok('before: the first receiver held the plain handles, and called them no_data from one narrow count',
  (SELECT count(ebay_username) FROM public.ebay_deletion_requests) = 3 AND (SELECT count(*) FILTER (WHERE status = 'no_data') FROM public.ebay_deletion_requests) = 3);

INSERT INTO public.vehicles VALUES
 ('00000000-0000-0000-0000-0000000000a1', 'deleted_seller_77', 'Selling my truck. Call 775-555-0123 or write deleted_seller_77@example.test. Ask for deleted_seller_77.', 'ebay_motors', 18500),
 ('00000000-0000-0000-0000-0000000000b1', NULL, 'Barn find, no rust. Sold by deleted_seller_77.', 'ebay_motors', NULL),
 ('00000000-0000-0000-0000-0000000000c1', 'keeper_seller', 'Clean car from keeper_seller, call 702-555-0199.', 'ebay_motors', NULL),
 ('00000000-0000-0000-0000-0000000000d1', 'deleted_seller_77', 'A BaT car.', 'bat', NULL);
INSERT INTO public.vehicle_events (id, vehicle_id, source_platform, source_url, source_listing_id, current_price, seller_identifier, metadata) VALUES
 ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'ebay_motors', 'https://www.ebay.com/itm/100000000001', '100000000001', 18500, NULL,
  '{"source": "ebay-browse-api", "seller_username": "Deleted_Seller_77", "seller_feedback_score": 12, "seller_feedback_percentage": "100.0",
    "seller_class_claim": {"value": "likely_private", "reasons": ["feedback score 12 (< 100)", "text uses private-seller wording"]}, "location": "Reno, NV"}'),
 ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000b1', 'ebay_motors', 'https://www.ebay.com/itm/100000000002', '100000000002', 9000, NULL,
  '{"source": "ebay-wayback", "seller_username": "deleted_seller_77", "seller_feedback_score": 300, "location": "Elko, NV"}'),
 ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000c1', 'ebay_motors', 'https://www.ebay.com/itm/100000000003', '100000000003', 7000, NULL,
  '{"source": "ebay-wayback", "seller_username": "keeper_seller", "seller_feedback_score": 50}'),
 ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000d1', 'bat', 'https://bringatrailer.com/listing/x', 'x', 50000, 'deleted_seller_77',
  '{"seller_username": "deleted_seller_77"}');
INSERT INTO public.vehicle_observations (id, vehicle_id, source_id, source_identifier, content_text, content_hash, structured_data, extraction_metadata) VALUES
 ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000eb01', '100000000001',
  'Selling my truck. Call 775-555-0123 or write deleted_seller_77@example.test. Ask for deleted_seller_77.', 'hash-a', '{"year": 1969, "make": "Chevrolet"}',
  '{"raw": {"title": "1969 Chevrolet C10", "seller": {"username": "Deleted_Seller_77", "feedbackScore": 12, "feedbackPercentage": "100.0"},
            "seller_class_claim": {"class": "likely_private", "reasons": ["feedback score 12 (< 100)"],
                                   "signals": {"username": "Deleted_Seller_77", "feedback_score": 12, "feedback_percentage": 100}}}}'),
 ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000eb01', '100000000002',
  'Barn find, no rust. Sold by deleted_seller_77.', 'hash-b', '{"year": 1965}', '{"raw": {"seller": {"username": "deleted_seller_77", "feedbackScore": 300}}}'),
 ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000eb01', '100000000003',
  'Clean car from keeper_seller. Thanks gone_bidder_12 for the offer.', 'hash-c', '{"year": 1972}', '{"raw": {"seller": {"username": "keeper_seller"}}}'),
 ('00000000-0000-0000-0000-0000000000f4', NULL, '00000000-0000-0000-0000-00000000eb01', '100000000005', 'An unresolved blip.', 'hash-d', '{}',
  '{"raw": {"seller": {"username": "someone_else_5"}}}');
INSERT INTO public.listing_page_snapshots (id, platform, listing_url, fetch_method, html, html_sha256, content_length, metadata, html_storage_path) VALUES
 ('00000000-0000-0000-0000-000000000051', 'ebay_motors', 'https://www.ebay.com/itm/100000000001', 'ebay_browse_getItem',
  '{"itemId":"v1|100000000001|0","title":"1969 Chevrolet C10","price":{"value":"18500.00"},"seller":{"feedbackPercentage":"100.0","feedbackScore":12,"username":"Deleted_Seller_77"},"description":"<p>Call 775-555-0123.</p><a class=\"eb-post-storelink\" href=\"https://www.ebay.com/usr/deleted_seller_77\">visit</a>"}',
  'sha-a', 300, '{"caller": "extract-ebay-motors"}', NULL),
 ('00000000-0000-0000-0000-000000000052', 'ebay_motors', 'https://www.ebay.com/itm/100000000002', 'wayback_id', NULL, 'sha-b', 1000,
  jsonb_build_object('member_handles_sha256', jsonb_build_array(pg_temp.h('deleted_seller_77'), pg_temp.h('other_bidder_3')),
                     'seller_handles_sha256', jsonb_build_array(pg_temp.h('deleted_seller_77'))), 'ebay_motors/wayback/2006/sha-b.html'),
 ('00000000-0000-0000-0000-000000000053', 'ebay_motors', 'https://www.ebay.com/itm/100000000003', 'wayback_id', NULL, 'sha-c', 1000,
  jsonb_build_object('member_handles_sha256', jsonb_build_array(pg_temp.h('keeper_seller'), pg_temp.h('gone_bidder_12')),
                     'seller_handles_sha256', jsonb_build_array(pg_temp.h('keeper_seller'))), 'ebay_motors/wayback/2006/sha-c.html'),
 ('00000000-0000-0000-0000-000000000054', 'ebay_motors', 'https://www.ebay.com/itm/100000000004', 'wayback_id', NULL, 'sha-d', 1000,
  '{"caller": "extract-ebay-motors archive"}', 'ebay_motors/wayback/2007/sha-d.html');   -- stored, not yet read for handles
INSERT INTO public.external_identities (platform, handle, profile_url) VALUES
 ('ebay', 'Deleted_Seller_77', 'https://www.ebay.com/usr/Deleted_Seller_77'), ('ebay', 'keeper_seller', 'https://www.ebay.com/usr/keeper_seller'),
 ('bat', 'deleted_seller_77', 'https://bringatrailer.com/member/deleted_seller_77/');
INSERT INTO public.ebay_parts_catalog (discovered_sellers, top_seller_username, sample_listings) VALUES
 (ARRAY['deleted_seller_77', 'keeper_seller'], 'deleted_seller_77', '[{"title": "C10 grille", "seller": "deleted_seller_77"}]');

\ir ../migrations/20261022030000_ebay_deletion_honour.sql

-- ---- the request table keeps hashes only -----------------------------------------------------------------------------
SELECT pg_temp.ok('the plain handles and user ids are gone from every request, the hashes are there',
  (SELECT count(*) FROM public.ebay_deletion_requests WHERE ebay_username IS NOT NULL OR ebay_user_id IS NOT NULL) = 0
  AND (SELECT ebay_username_sha256 FROM public.ebay_deletion_requests WHERE notification_id = 'n-77') = pg_temp.h('deleted_seller_77')
  AND (SELECT count(ebay_user_id_sha256) FROM public.ebay_deletion_requests) = 3);
SELECT public.record_ebay_deletion('n-new', 'Fresh_Member_1', 'uid-new', now(), now(), true);
SELECT pg_temp.ok('a new notice is stored as hashes, pending, with no held count',
  (SELECT ebay_username IS NULL AND ebay_user_id IS NULL AND ebay_username_sha256 = pg_temp.h('fresh_member_1') AND status = 'pending'
          AND held_listing_events IS NULL FROM public.ebay_deletion_requests WHERE notification_id = 'n-new'));
DO $$ BEGIN
  BEGIN
    INSERT INTO public.ebay_deletion_requests (notification_id, ebay_username, signature_checked) VALUES ('n-plain', 'someone', false);
    RAISE EXCEPTION 'Contract failed: a plain handle was stored';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS the constraint refuses a plain handle'; END;
END $$;
SELECT pg_temp.ok('the landers'' lookup names deleted members only',
  public.ebay_deleted_member_hashes(ARRAY[pg_temp.h('Deleted_Seller_77'), pg_temp.h('keeper_seller')]) = ARRAY[pg_temp.h('deleted_seller_77')]);

-- ---- the scan ------------------------------------------------------------------------------------------------------------
SET statement_timeout = '30s';
CREATE TEMP TABLE scan_out (place text, page jsonb);
CREATE FUNCTION pg_temp.scan_all() RETURNS void LANGUAGE plpgsql AS $$
DECLARE pl text; a text; p jsonb;
BEGIN
  DELETE FROM scan_out;
  FOREACH pl IN ARRAY ARRAY['vehicle_events', 'vehicle_observations', 'listing_page_snapshots', 'external_identities', 'ebay_parts_catalog'] LOOP
    a := NULL;
    LOOP
      p := public.ebay_deletion_scan(pl, a, 2);         -- pages of 2 rows: the keyset paging is exercised
      INSERT INTO scan_out VALUES (pl, p);
      a := p ->> 'next_after';
      EXIT WHEN a IS NULL;
    END LOOP;
  END LOOP;
END $$;
SELECT pg_temp.scan_all();
CREATE TEMP VIEW matches AS
  SELECT DISTINCT s.place, m ->> 'member_sha256' AS sha, m ->> 'listing_key' AS k, m ->> 'role' AS role
    FROM scan_out s, jsonb_array_elements(s.page -> 'matches') m;
SELECT pg_temp.ok('the scan read every eBay row and no BaT row',
  (SELECT sum((page ->> 'scanned')::int) FROM scan_out WHERE place = 'vehicle_events') = 3
  AND (SELECT sum((page ->> 'scanned')::int) FROM scan_out WHERE place = 'vehicle_observations') = 4
  AND (SELECT sum((page ->> 'scanned')::int) FROM scan_out WHERE place = 'listing_page_snapshots') = 4);
SELECT pg_temp.ok('the deleted seller is found as seller of A and B in episodes, observations and pages',
  (SELECT array_agg(DISTINCT k ORDER BY k) FROM matches WHERE sha = pg_temp.h('deleted_seller_77') AND role = 'seller')
    = ARRAY['100000000001', '100000000002']
  AND (SELECT count(DISTINCT place) FROM matches WHERE sha = pg_temp.h('deleted_seller_77') AND k IS NOT NULL) = 3);
SELECT pg_temp.ok('the deleted bidder is found where the stored page names them, as a member',
  (SELECT array_agg(k || ':' || role) FROM matches WHERE sha = pg_temp.h('gone_bidder_12')) = ARRAY['100000000003:member']);
SELECT pg_temp.ok('the identity and the parts catalog are found by hash; keeper and never-here members are not matched',
  EXISTS (SELECT 1 FROM matches WHERE place = 'external_identities' AND sha = pg_temp.h('deleted_seller_77'))
  AND EXISTS (SELECT 1 FROM matches WHERE place = 'ebay_parts_catalog' AND sha = pg_temp.h('deleted_seller_77'))
  AND NOT EXISTS (SELECT 1 FROM matches WHERE sha IN (pg_temp.h('keeper_seller'), pg_temp.h('never_here_99'), pg_temp.h('someone_else_5'))));
SELECT pg_temp.ok('a stored page not yet read for handles is counted as not assessed',
  (SELECT sum((page ->> 'not_assessed')::int) FROM scan_out) = 1);
SELECT pg_temp.ok('finish refuses while a stored page is unread, and changes no status',
  (public.finish_ebay_deletions(now(), '[]'::jsonb, jsonb_build_object('complete', true, 'not_assessed', 1)) ->> 'finished')::boolean IS FALSE
  AND (SELECT count(*) FROM public.ebay_deletion_requests WHERE checked_at IS NULL AND receipt IS NULL) = 4
  AND (SELECT array_agg(status ORDER BY notification_id) FROM public.ebay_deletion_requests) = ARRAY['no_data', 'no_data', 'no_data', 'pending']);
SELECT pg_temp.ok('the read page''s handles are written', (public.set_ebay_snapshot_handles(jsonb_build_array(jsonb_build_object(
  'snapshot_id', '00000000-0000-0000-0000-000000000054', 'member_handles_sha256', jsonb_build_array(pg_temp.h('someone_else_5')),
  'seller_handles_sha256', jsonb_build_array(pg_temp.h('someone_else_5'))))) ->> 'updated')::int = 1);
SELECT pg_temp.scan_all();
SELECT pg_temp.ok('now nothing is unread', (SELECT sum((page ->> 'not_assessed')::int) FROM scan_out) = 0);
SELECT pg_temp.ok('the spellings the worker rewrites stored pages with: one, lower-cased, from the structured copies',
  public.ebay_member_spellings(pg_temp.h('deleted_seller_77'), ARRAY['100000000001', '100000000002']) = ARRAY['deleted_seller_77']
  AND public.ebay_member_spellings(pg_temp.h('gone_bidder_12'), ARRAY['100000000003']) = '{}'::text[]);
SELECT pg_temp.ok('the stored pages of these listings', jsonb_array_length(public.ebay_listing_storage_snapshots(ARRAY['100000000002', '100000000003'])) = 2);

-- ---- the redaction ----------------------------------------------------------------------------------------------------------
DO $$ BEGIN
  BEGIN PERFORM public.redact_ebay_deleted_member(pg_temp.h('deleted_seller_77'), ARRAY['100000000001'], '{}', ARRAY['keeper_seller']);
    RAISE EXCEPTION 'Contract failed: a handle that is not the member''s was accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'Contract failed%' THEN RAISE; END IF; RAISE NOTICE 'PASS another member''s handle is refused'; END;
  BEGIN PERFORM public.redact_ebay_deleted_member(pg_temp.h('keeper_seller'), ARRAY['100000000003']);
    RAISE EXCEPTION 'Contract failed: a member with no deletion request was redacted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'Contract failed%' THEN RAISE; END IF; RAISE NOTICE 'PASS a member with no request is refused'; END;
END $$;
DO $$ BEGIN
  SET LOCAL statement_timeout = 0;
  BEGIN PERFORM public.redact_ebay_deleted_member(pg_temp.h('deleted_seller_77'), ARRAY['100000000001']);
    RAISE EXCEPTION 'Contract failed: statement_timeout 0 was accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'Contract failed%' THEN RAISE; END IF; RAISE NOTICE 'PASS an unbounded statement_timeout is refused'; END;
END $$;
SET statement_timeout = '30s';

CREATE TEMP TABLE r77 AS SELECT public.redact_ebay_deleted_member(pg_temp.h('deleted_seller_77'), ARRAY['100000000001', '100000000002']) AS j;
SELECT pg_temp.ok('changed rows per place for the seller',
  (SELECT j -> 'changed' FROM r77) = '{"vehicle_events": 2, "vehicle_observations": 2, "listing_page_snapshots": 1, "vehicles": 2,
                                       "external_identities": 1, "ebay_parts_catalog": 1}'::jsonb
  AND (SELECT jsonb_array_length(j -> 'refused') FROM r77) = 0);
-- the worker rewrote B's stored page in Storage (the deleted seller gone, the other bidder kept) and records it
SELECT pg_temp.ok('the stored page receipt', (public.mark_ebay_snapshot_redacted('00000000-0000-0000-0000-000000000052',
  repeat('b', 64), 990, ARRAY[pg_temp.h('other_bidder_3')], '{}', ARRAY['html']) ->> 'ok')::boolean);
CREATE TEMP TABLE r12 AS SELECT public.redact_ebay_deleted_member(pg_temp.h('gone_bidder_12'), '{}', ARRAY['100000000003'], ARRAY['Gone_Bidder_12']) AS j;
SELECT pg_temp.ok('the bidder: only the mention in C''s description changes',
  (SELECT j -> 'changed' FROM r12) = '{"vehicle_events": 0, "vehicle_observations": 1, "listing_page_snapshots": 0, "vehicles": 0,
                                       "external_identities": 0, "ebay_parts_catalog": 0}'::jsonb);
SELECT pg_temp.ok('C''s stored page receipt', (public.mark_ebay_snapshot_redacted('00000000-0000-0000-0000-000000000053',
  repeat('c', 64), 995, ARRAY[pg_temp.h('keeper_seller')], ARRAY[pg_temp.h('keeper_seller')], ARRAY['html']) ->> 'ok')::boolean);

-- ---- the proof: no eBay place holds either handle; the rest stays --------------------------------------------------------
CREATE TEMP VIEW residue AS
  SELECT 'vehicle_events' AS place, count(*) AS n FROM public.vehicle_events
   WHERE source_platform IN ('ebay', 'ebay_motors', 'ebay-motors')
     AND (metadata::text ~* '(deleted_seller_77|gone_bidder_12)' OR coalesce(seller_identifier, '') ~* 'deleted_seller_77')
  UNION ALL SELECT 'vehicle_observations', count(*) FROM public.vehicle_observations
   WHERE source_id = '00000000-0000-0000-0000-00000000eb01'
     AND (extraction_metadata::text || coalesce(content_text, '') || coalesce(structured_data::text, '')) ~* '(deleted_seller_77|gone_bidder_12)'
  UNION ALL SELECT 'listing_page_snapshots', count(*) FROM public.listing_page_snapshots
   WHERE platform = 'ebay_motors' AND (coalesce(html, '') ~* '(deleted_seller_77|gone_bidder_12)'
     OR metadata -> 'member_handles_sha256' ?| ARRAY[pg_temp.h('deleted_seller_77'), pg_temp.h('gone_bidder_12')])
  UNION ALL SELECT 'vehicles', count(*) FROM public.vehicles v
   WHERE v.id IN (SELECT vehicle_id FROM public.vehicle_events WHERE source_platform = 'ebay_motors')
     AND (coalesce(seller_name, '') || coalesce(description, '')) ~* '(deleted_seller_77|gone_bidder_12)'
  UNION ALL SELECT 'external_identities', count(*) FROM public.external_identities
   WHERE platform IN ('ebay', 'ebay_motors') AND (handle || coalesce(profile_url, '')) ~* 'deleted_seller_77'
  UNION ALL SELECT 'ebay_parts_catalog', count(*) FROM public.ebay_parts_catalog
   WHERE (array_to_string(discovered_sellers, ' ') || coalesce(top_seller_username, '') || coalesce(sample_listings::text, '')) ~* 'deleted_seller_77';
SELECT pg_temp.ok('no eBay place holds either deleted handle', (SELECT sum(n) FROM residue) = 0);
SELECT pg_temp.scan_all();
SELECT pg_temp.ok('a second scan finds neither member', NOT EXISTS (SELECT 1 FROM matches WHERE sha IN (pg_temp.h('deleted_seller_77'), pg_temp.h('gone_bidder_12'))));
SELECT pg_temp.ok('the listing, price, place and vehicle stay; the feedback figure is withheld from the class reasons',
  (SELECT current_price FROM public.vehicle_events WHERE id = '00000000-0000-0000-0000-0000000000e1') = 18500
  AND (SELECT metadata ->> 'location' FROM public.vehicle_events WHERE id = '00000000-0000-0000-0000-0000000000e1') = 'Reno, NV'
  AND (SELECT metadata #>> '{seller_class_claim,reasons,0}' FROM public.vehicle_events WHERE id = '00000000-0000-0000-0000-0000000000e1') = 'feedback score (withheld) (< 100)'
  AND NOT (SELECT metadata ?| ARRAY['seller_username', 'seller_feedback_score', 'seller_feedback_percentage'] FROM public.vehicle_events WHERE id = '00000000-0000-0000-0000-0000000000e1')
  AND (SELECT asking_price FROM public.vehicles WHERE id = '00000000-0000-0000-0000-0000000000a1') = 18500
  AND (SELECT seller_name IS NULL FROM public.vehicles WHERE id = '00000000-0000-0000-0000-0000000000a1')
  AND (SELECT structured_data ->> 'make' FROM public.vehicle_observations WHERE id = '00000000-0000-0000-0000-0000000000f1') = 'Chevrolet'
  AND (SELECT extraction_metadata #> '{raw,seller}' FROM public.vehicle_observations WHERE id = '00000000-0000-0000-0000-0000000000f1') = '{}'::jsonb
  AND (SELECT NOT (extraction_metadata #> '{raw,seller_class_claim,signals}' ?| ARRAY['username', 'feedback_score', 'feedback_percentage'])
         FROM public.vehicle_observations WHERE id = '00000000-0000-0000-0000-0000000000f1')
  AND (SELECT content_hash FROM public.vehicle_observations WHERE id = '00000000-0000-0000-0000-0000000000f1') = 'hash-a');
SELECT pg_temp.ok('the seller''s own description loses its phone and address; the getItem JSON keeps its price and loses the seller',
  (SELECT content_text FROM public.vehicle_observations WHERE id = '00000000-0000-0000-0000-0000000000f1')
    = 'Selling my truck. Call [contact through Nuke] or write [contact through Nuke]. Ask for [deleted eBay user].'
  AND (SELECT description FROM public.vehicles WHERE id = '00000000-0000-0000-0000-0000000000a1')
    = 'Selling my truck. Call [contact through Nuke] or write [contact through Nuke]. Ask for [deleted eBay user].'
  AND (SELECT html::jsonb -> 'seller' FROM public.listing_page_snapshots WHERE id = '00000000-0000-0000-0000-000000000051') = '{}'::jsonb
  AND (SELECT html::jsonb #>> '{price,value}' FROM public.listing_page_snapshots WHERE id = '00000000-0000-0000-0000-000000000051') = '18500.00'
  AND (SELECT html::jsonb ->> 'description' FROM public.listing_page_snapshots WHERE id = '00000000-0000-0000-0000-000000000051') LIKE '%[contact through Nuke]%usr/[deleted eBay user]%'
  AND (SELECT html_sha256 = encode(sha256(convert_to(html, 'UTF8')), 'hex') AND content_length = octet_length(html)
         FROM public.listing_page_snapshots WHERE id = '00000000-0000-0000-0000-000000000051'));
SELECT pg_temp.ok('a bidder''s mention goes, the listing''s own seller and their contact details stay (not the deleted member)',
  (SELECT content_text FROM public.vehicle_observations WHERE id = '00000000-0000-0000-0000-0000000000f3')
    = 'Clean car from keeper_seller. Thanks [deleted eBay user] for the offer.'
  AND (SELECT metadata ->> 'seller_username' FROM public.vehicle_events WHERE id = '00000000-0000-0000-0000-0000000000e3') = 'keeper_seller'
  AND (SELECT description FROM public.vehicles WHERE id = '00000000-0000-0000-0000-0000000000c1') = 'Clean car from keeper_seller, call 702-555-0199.'
  AND EXISTS (SELECT 1 FROM public.external_identities WHERE platform = 'ebay' AND handle = 'keeper_seller')
  AND (SELECT discovered_sellers FROM public.ebay_parts_catalog) = ARRAY['keeper_seller']);
SELECT pg_temp.ok('BaT rows of the same handle are not eBay data and stay',
  (SELECT metadata ->> 'seller_username' FROM public.vehicle_events WHERE id = '00000000-0000-0000-0000-0000000000e4') = 'deleted_seller_77'
  AND (SELECT seller_name FROM public.vehicles WHERE id = '00000000-0000-0000-0000-0000000000d1') = 'deleted_seller_77'
  AND EXISTS (SELECT 1 FROM public.external_identities WHERE platform = 'bat' AND handle = 'deleted_seller_77'));
SELECT pg_temp.ok('every changed row carries a receipt, and no receipt names a member',
  (SELECT count(*) FROM public.vehicle_events WHERE metadata ? 'privacy_redactions') = 2
  AND (SELECT count(*) FROM public.vehicle_observations WHERE extraction_metadata ? 'privacy_redactions') = 3
  AND (SELECT count(*) FROM public.listing_page_snapshots WHERE metadata ? 'privacy_redactions') = 3
  AND NOT EXISTS (SELECT 1 FROM public.listing_page_snapshots WHERE (metadata -> 'privacy_redactions')::text ~* '(deleted_seller|gone_bidder)')
  AND (SELECT metadata #>> '{privacy_redactions,0,reason}' FROM public.vehicle_events WHERE id = '00000000-0000-0000-0000-0000000000e1') = 'ebay_marketplace_account_deletion');
SELECT pg_temp.ok('the identity handle became an unlinkable mask', EXISTS (SELECT 1 FROM public.external_identities WHERE platform = 'ebay' AND handle ~ '^deleted-ebay-member-[0-9a-f]{12}$'));
SELECT pg_temp.ok('a second redaction is a no-op',
  (SELECT sum(value::int) FROM jsonb_each_text(public.redact_ebay_deleted_member(pg_temp.h('deleted_seller_77'), ARRAY['100000000001', '100000000002']) -> 'changed')) = 0);

-- ---- status and receipt --------------------------------------------------------------------------------------------------
CREATE TEMP TABLE fin AS SELECT public.finish_ebay_deletions(now(), jsonb_build_array(
    jsonb_build_object('member_sha256', pg_temp.h('deleted_seller_77'), 'changed', (SELECT j -> 'changed' FROM r77) || '{"listing_page_snapshots_stored": 1}'::jsonb, 'residual', 0, 'refused', 0),
    jsonb_build_object('member_sha256', pg_temp.h('gone_bidder_12'), 'changed', (SELECT j -> 'changed' FROM r12) || '{"listing_page_snapshots_stored": 1}'::jsonb, 'residual', 0, 'refused', 0)),
  jsonb_build_object('complete', true, 'not_assessed', 0, 'scanned', '{"vehicle_events": 3}'::jsonb)) AS j;
SELECT pg_temp.ok('two honoured, two no_data (never-here and the fresh member), none pending',
  (SELECT j ->> 'honoured' FROM fin) = '2' AND (SELECT j ->> 'no_data' FROM fin) = '2' AND (SELECT j ->> 'still_pending' FROM fin) = '0'
  AND (SELECT status FROM public.ebay_deletion_requests WHERE notification_id = 'n-77') = 'honoured'
  AND (SELECT status FROM public.ebay_deletion_requests WHERE notification_id = 'n-99') = 'no_data'
  AND (SELECT count(*) FROM public.ebay_deletion_requests WHERE honoured_at IS NULL OR checked_at IS NULL) = 0);
SELECT pg_temp.ok('the receipt holds counts per place and no handle',
  (SELECT (receipt #>> '{changed,vehicle_events}')::int = 2 AND (receipt #>> '{changed,listing_page_snapshots_stored}')::int = 1
     FROM public.ebay_deletion_requests WHERE notification_id = 'n-77')
  AND NOT EXISTS (SELECT 1 FROM public.ebay_deletion_requests WHERE receipt::text ~* '(deleted_seller|gone_bidder|never_here|fresh_member)'));
CREATE TEMP TABLE fin2 AS SELECT public.finish_ebay_deletions(now(), jsonb_build_array(jsonb_build_object('member_sha256', pg_temp.h('deleted_seller_77'),
  'changed', '{"vehicle_events": 1}'::jsonb, 'residual', 0, 'refused', 0)), jsonb_build_object('complete', true, 'not_assessed', 0)) AS j;
SELECT pg_temp.ok('a later run adds to the counts, and leaves checked requests alone otherwise',
  (SELECT j ->> 'honoured' FROM fin2) = '1' AND (SELECT j ->> 'no_data' FROM fin2) = '0'
  AND (SELECT (receipt #>> '{changed,vehicle_events}')::int FROM public.ebay_deletion_requests WHERE notification_id = 'n-77') = 3
  AND (SELECT (receipt #>> '{changed,vehicle_observations}')::int FROM public.ebay_deletion_requests WHERE notification_id = 'n-77') = 2);
CREATE TEMP TABLE fin3 AS SELECT public.finish_ebay_deletions(now(), jsonb_build_array(jsonb_build_object('member_sha256', pg_temp.h('gone_bidder_12'),
  'changed', '{"vehicle_events": 1}'::jsonb, 'residual', 1, 'refused', 0)), jsonb_build_object('complete', true, 'not_assessed', 0)) AS j;
SELECT pg_temp.ok('a residual copy is not counted as honoured', (SELECT j ->> 'honoured' FROM fin3) = '0'
  AND (SELECT (receipt #>> '{changed,vehicle_events}')::int FROM public.ebay_deletion_requests WHERE notification_id = 'n-12') = 0);

-- ---- access -----------------------------------------------------------------------------------------------------------------
SELECT pg_temp.ok('anon and authenticated cannot run any of it; the service role can',
  NOT has_function_privilege('anon', 'public.redact_ebay_deleted_member(text,text[],text[],text[])', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.redact_ebay_deleted_member(text,text[],text[],text[])', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.ebay_deletion_scan(text,text,integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.ebay_deleted_member_hashes(text[])', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.finish_ebay_deletions(timestamptz,jsonb,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.set_ebay_snapshot_handles(jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.record_ebay_deletion(text,text,text,timestamptz,timestamptz,boolean)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.redact_ebay_deleted_member(text,text[],text[],text[])', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.ebay_member_spellings(text,text[])', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.mark_ebay_snapshot_redacted(uuid,text,integer,text[],text[],text[])', 'EXECUTE'));
