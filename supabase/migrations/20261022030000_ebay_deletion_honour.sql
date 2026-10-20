-- Honour eBay Marketplace Account Deletion requests: the worker 20261015190000_ebay_deletion_requests.sql left unbuilt.
--
-- eBay notifies us when a member deletes their account, and we must then stop holding that member's personal data.
-- Where an eBay member's handle sits, measured 2026-10-20 with bounded keyset scans (aggregate counts only):
--   vehicle_events (eBay rows, 21,646)        metadata.seller_username / seller_feedback_score / seller_feedback_percentage,
--                                             seller_identifier, buyer_identifier
--   vehicle_observations (ebay_motors, 24,388) extraction_metadata.raw.seller {username, feedbackScore, feedbackPercentage},
--                                             raw.seller_class_claim.signals.username, and content_text (the seller's own
--                                             description); 2,628 are unresolved listings with no episode
--   listing_page_snapshots (ebay_motors)      the getItem JSON inline (1,216: the seller object and the description's
--                                             ebay.com/usr/<handle> store link) and 21,446 stored pages (Wayback 20,286,
--                                             Firecrawl 1,160) that name the seller and, on archived pages, the bidders
--   vehicles (through the eBay episodes)      seller_name (ingest writes the eBay handle) and description
--   external_identities, ebay_parts_catalog, vehicle_price_history.seller_name: no eBay handle held (0 rows each)
--
-- WHY NEW WRITERS (checked 2026-10-20): no writer can erase a value. correct_vehicle_event_attribution is BaT-only and
-- keeps every original in a before-image; supersede_observation keeps the original row whole; privacy_mask_email_handle
-- copies each original to private.privacy_masked_values. Superseding a row with a redacted copy would keep the handle in
-- the original, which is what eBay forbids. So the redaction is this repo's privacy-mask shape without the private copy:
-- the row, its listing, price, vehicle and photos stay; the member's handle, feedback and (on their own listings) the
-- e-mail addresses and phone numbers in their description are replaced in place; each changed row carries a
-- privacy_redactions[] entry (reason, time, writer) and never the removed value.
--
-- WHAT THIS ADDS
--   ebay_deletion_requests keeps only sha256(lower(handle)) and sha256(user id): the plain values are erased from every
--   existing row and never written again (constraint ebay_deletion_requests_no_plain_handle). The hash is the tombstone:
--   the landers (extract-ebay-motors landItem, landArchived) look a page's member handles up by hash before they store
--   anything, so a deleted member's later listings and archived pages land already redacted.
--   ebay_member_sha256(text), ebay_redact_handles(text, text[])        the hash and the token-bounded replacement
--   ebay_deleted_member_hashes(text[])                                 the landers' lookup
--   ebay_deletion_scan(place, after, limit)                            one keyset page of one place, matched by hash
--   ebay_listing_storage_snapshots(text[]), ebay_member_spellings, ebay_snapshot_handles_todo, set_ebay_snapshot_handles,
--   mark_ebay_snapshot_redacted                                        the stored pages (bodies live in Storage)
--   redact_ebay_deleted_member(sha, seller_keys, mention_keys, handles) the SQL places of one member's listings
--   finish_ebay_deletions(cutoff, results, scan)                       status, honoured_at, receipt (counts only)
--   cron ebay-deletion-honour (every 6 h) -> extract-ebay-motors {"action": "honour_deletions"}
-- A request is stamped (checked_at, honoured or no_data, receipt) only by a complete scan of every place with no stored
-- page left unread for member handles (scan.not_assessed = 0); the first receiver's no_data, from one narrow count of
-- vehicle_events, is re-checked that way too.
-- EXECUTE on every function is for service_role only; the table readers and writers are SECURITY DEFINER, search_path
-- public, pg_temp, and bounded: keyset pages of at most 5,000 rows, at most 200 listings per redaction, caller
-- statement_timeout 1..60 s, lock_timeout 3 s.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

-- ---- the request row keeps hashes only --------------------------------------------------------------------------------
ALTER TABLE public.ebay_deletion_requests
  ADD COLUMN IF NOT EXISTS ebay_username_sha256 text,
  ADD COLUMN IF NOT EXISTS ebay_user_id_sha256  text,
  ADD COLUMN IF NOT EXISTS checked_at           timestamptz,
  ADD COLUMN IF NOT EXISTS receipt              jsonb;
CREATE INDEX IF NOT EXISTS ebay_deletion_requests_username_sha256 ON public.ebay_deletion_requests (ebay_username_sha256);

CREATE OR REPLACE FUNCTION public.ebay_member_sha256(p_handle text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
  SELECT CASE WHEN nullif(btrim(p_handle), '') IS NULL THEN NULL
              ELSE encode(sha256(convert_to(lower(btrim(p_handle)), 'UTF8')), 'hex') END
$$;
COMMENT ON FUNCTION public.ebay_member_sha256(text) IS
  'sha256 hex of the lower-cased, trimmed eBay member handle: the only form ebay_deletion_requests keeps. extract-ebay-motors deletedMembers.ts handleHash() computes the same value.';

UPDATE public.ebay_deletion_requests
   SET ebay_username_sha256 = coalesce(ebay_username_sha256, public.ebay_member_sha256(ebay_username)),
       ebay_user_id_sha256 = coalesce(ebay_user_id_sha256, CASE WHEN nullif(btrim(ebay_user_id), '') IS NULL THEN NULL
                                       ELSE encode(sha256(convert_to(btrim(ebay_user_id), 'UTF8')), 'hex') END),
       ebay_username = NULL, ebay_user_id = NULL
 WHERE ebay_username IS NOT NULL OR ebay_user_id IS NOT NULL;

ALTER TABLE public.ebay_deletion_requests DROP CONSTRAINT IF EXISTS ebay_deletion_requests_no_plain_handle;
ALTER TABLE public.ebay_deletion_requests ADD CONSTRAINT ebay_deletion_requests_no_plain_handle
  CHECK (ebay_username IS NULL AND ebay_user_id IS NULL);

COMMENT ON COLUMN public.ebay_deletion_requests.ebay_username IS 'Never held (always null since 2026-10-20, constraint ebay_deletion_requests_no_plain_handle): see ebay_username_sha256.';
COMMENT ON COLUMN public.ebay_deletion_requests.ebay_user_id IS 'Never held (always null since 2026-10-20, constraint ebay_deletion_requests_no_plain_handle): see ebay_user_id_sha256.';
COMMENT ON COLUMN public.ebay_deletion_requests.ebay_username_sha256 IS 'ebay_member_sha256(the notice''s username): sha256 hex of the lower-cased handle. The tombstone landers and the honour worker match by; the handle itself is not kept.';
COMMENT ON COLUMN public.ebay_deletion_requests.ebay_user_id_sha256 IS 'sha256 hex of the notice''s eBay user id (as sent). Nothing we hold carries eBay user ids; kept to recognise a repeated notice.';
COMMENT ON COLUMN public.ebay_deletion_requests.held_listing_events IS 'Rows counted at receipt by the first receiver (to 2026-10-20; null when the count timed out). Not counted since: the honour worker searches every place once per run (receipt).';
COMMENT ON COLUMN public.ebay_deletion_requests.checked_at IS 'When the honour worker (extract-ebay-motors honour_deletions) last completed a full scan that covered this request.';
COMMENT ON COLUMN public.ebay_deletion_requests.receipt IS 'What honouring changed, counts only, no handle: changed {place: rows} summed over runs, scan {place: rows read, not_assessed}, last_run. Written by finish_ebay_deletions.';
COMMENT ON COLUMN public.ebay_deletion_requests.status IS 'pending = not yet covered by a complete scan; honoured = a complete scan found the member''s data and every copy was redacted (receipt.changed); no_data = a complete scan found nothing held. Set by finish_ebay_deletions.';
COMMENT ON COLUMN public.ebay_deletion_requests.honoured_at IS 'When the request was first satisfied: the redaction (honoured) or the complete scan that found nothing (no_data).';

-- The receiver keeps hashes only and no longer counts held rows (the worker does, once per run, for every request).
CREATE OR REPLACE FUNCTION public.record_ebay_deletion(
  p_notification_id text, p_username text, p_user_id text,
  p_event_date timestamptz, p_publish_date timestamptz, p_signature_checked boolean
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '5s'
AS $$
BEGIN
  INSERT INTO ebay_deletion_requests AS r
    (notification_id, ebay_username, ebay_user_id, ebay_username_sha256, ebay_user_id_sha256, event_date, publish_date,
     signature_checked, held_listing_events, status)
  VALUES (p_notification_id, NULL, NULL, ebay_member_sha256(p_username),
          CASE WHEN nullif(btrim(p_user_id), '') IS NULL THEN NULL ELSE encode(sha256(convert_to(btrim(p_user_id), 'UTF8')), 'hex') END,
          p_event_date, p_publish_date, p_signature_checked, NULL, 'pending')
  ON CONFLICT (notification_id) DO UPDATE
    SET signature_checked = r.signature_checked OR EXCLUDED.signature_checked;
  RETURN 'pending';
END $$;
REVOKE ALL ON FUNCTION public.record_ebay_deletion(text, text, text, timestamptz, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_ebay_deletion(text, text, text, timestamptz, timestamptz, boolean) TO service_role;

-- ---- the replacement ----------------------------------------------------------------------------------------------------
-- Every token-bounded, case-insensitive mention of each handle -> [deleted eBay user]. A handle is a token: not preceded by
-- a handle character, not followed by one (a sentence's closing period is not part of it). deletedMembers.ts redactHandles()
-- is the same rule for the landers.
CREATE OR REPLACE FUNCTION public.ebay_redact_handles(p_text text, p_handles text[])
RETURNS text LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
DECLARE v text := p_text; h text;
BEGIN
  IF p_text IS NULL OR p_handles IS NULL THEN RETURN p_text; END IF;
  FOREACH h IN ARRAY p_handles LOOP
    CONTINUE WHEN nullif(btrim(h), '') IS NULL;
    v := regexp_replace(v, '(?<![A-Za-z0-9_*.-])' || regexp_replace(btrim(h), '([^A-Za-z0-9])', '\\\1', 'g')
                           || '(?![A-Za-z0-9_*-])(?!\.[A-Za-z0-9_])', '[deleted eBay user]', 'gi');
  END LOOP;
  RETURN v;
END $$;
COMMENT ON FUNCTION public.ebay_redact_handles(text, text[]) IS
  'Replaces every token-bounded, case-insensitive mention of each handle with [deleted eBay user]. Used by redact_ebay_deleted_member; deletedMembers.ts redactHandles() is the same rule.';

-- ---- the landers' lookup ------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ebay_deleted_member_hashes(p_hashes text[])
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(array_agg(DISTINCT d.ebay_username_sha256), '{}')
    FROM ebay_deletion_requests d
   WHERE d.ebay_username_sha256 = ANY ((coalesce(p_hashes, '{}'))[1:1000])
$$;
COMMENT ON FUNCTION public.ebay_deleted_member_hashes(text[]) IS
  'Which of these member-handle hashes (ebay_member_sha256, at most 1,000) belong to an eBay account deletion. extract-ebay-motors asks before it stores a listing or page, and redacts those handles first.';

-- ---- one page of one place --------------------------------------------------------------------------------------------
-- Returns {place, scanned, next_after (null = the place is done), matches: [{member_sha256, listing_key, role}], not_assessed}.
-- role seller = the listing's own seller field; member = a handle the stored page names (seller or bidder, from its labels).
CREATE OR REPLACE FUNCTION public.ebay_deletion_scan(p_place text, p_after text DEFAULT NULL, p_limit integer DEFAULT 2000)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_platforms constant text[] := ARRAY['ebay', 'ebay_motors', 'ebay-motors'];
  v_timeout_ms bigint := (SELECT setting::bigint FROM pg_settings WHERE name = 'statement_timeout');
  v_limit integer := least(greatest(coalesce(p_limit, 2000), 1), 5000);
  v_src uuid;
  v_out jsonb;
BEGIN
  IF v_timeout_ms < 1 OR v_timeout_ms > 60000 THEN
    RAISE EXCEPTION 'ebay_deletion_scan: caller must set statement_timeout between 1 ms and 60 s (now % ms)', v_timeout_ms;
  END IF;
  IF p_place = 'vehicle_events' THEN
    WITH ids AS MATERIALIZED (
           SELECT e.id FROM vehicle_events e
            WHERE e.source_platform = ANY (c_platforms)
              AND e.id > coalesce(nullif(p_after, '')::uuid, '00000000-0000-0000-0000-000000000000'::uuid)),
         pg AS (SELECT id FROM ids ORDER BY id LIMIT v_limit),
         h AS (SELECT coalesce(e.source_listing_id, substring(e.source_url from '/itm/(\d+)')) AS k, t.role, ebay_member_sha256(t.v) AS sha
                 FROM vehicle_events e JOIN pg USING (id)
                 CROSS JOIN LATERAL (VALUES ('seller', e.metadata ->> 'seller_username'), ('seller', e.seller_identifier),
                                            ('member', e.buyer_identifier)) t(role, v)
                WHERE t.v IS NOT NULL)
    SELECT jsonb_build_object('place', p_place, 'scanned', (SELECT count(*) FROM pg), 'not_assessed', 0,
             'next_after', CASE WHEN (SELECT count(*) FROM pg) < v_limit THEN NULL ELSE (SELECT id::text FROM pg ORDER BY id DESC LIMIT 1) END,
             'matches', coalesce((SELECT jsonb_agg(DISTINCT jsonb_build_object('member_sha256', h.sha, 'listing_key', h.k, 'role', h.role))
                                    FROM h JOIN ebay_deletion_requests d ON d.ebay_username_sha256 = h.sha), '[]'::jsonb))
      INTO v_out;
  ELSIF p_place = 'vehicle_observations' THEN
    SELECT id INTO v_src FROM observation_sources WHERE slug = 'ebay_motors';
    WITH b AS (SELECT max(si) AS m, count(*) AS n FROM (
                 SELECT o.source_identifier si FROM vehicle_observations o
                  WHERE o.source_id = v_src AND o.source_identifier > coalesce(p_after, '')
                  ORDER BY o.source_identifier LIMIT v_limit) x),
         pg AS (SELECT o.source_identifier AS k, o.extraction_metadata AS em, o.structured_data AS sd
                  FROM vehicle_observations o, b
                 WHERE o.source_id = v_src AND o.source_identifier > coalesce(p_after, '') AND o.source_identifier <= b.m),
         h AS (SELECT pg.k, 'seller'::text AS role, ebay_member_sha256(t.v) AS sha
                 FROM pg CROSS JOIN LATERAL (VALUES (pg.em #>> '{raw,seller,username}'), (pg.em #>> '{raw,seller_class_claim,signals,username}'),
                                                    (pg.sd ->> 'seller_username'), (pg.sd ->> 'seller_name')) t(v)
                WHERE t.v IS NOT NULL)
    SELECT jsonb_build_object('place', p_place, 'scanned', (SELECT count(*) FROM pg),
             -- an observation with no listing key cannot be routed to its listing: counted, never silently skipped
             'not_assessed', CASE WHEN (SELECT n FROM b) < v_limit
                               THEN (SELECT count(*) FROM vehicle_observations WHERE source_id = v_src AND source_identifier IS NULL) ELSE 0 END,
             'next_after', CASE WHEN (SELECT n FROM b) < v_limit THEN NULL ELSE (SELECT m FROM b) END,
             'matches', coalesce((SELECT jsonb_agg(DISTINCT jsonb_build_object('member_sha256', h.sha, 'listing_key', h.k, 'role', h.role))
                                    FROM h JOIN ebay_deletion_requests d ON d.ebay_username_sha256 = h.sha), '[]'::jsonb))
      INTO v_out;
  ELSIF p_place = 'listing_page_snapshots' THEN
    WITH b AS (SELECT max(u) AS m, count(*) AS n FROM (
                 SELECT s.listing_url u FROM listing_page_snapshots s
                  WHERE s.platform = 'ebay_motors' AND s.listing_url > coalesce(p_after, '')
                  ORDER BY s.listing_url LIMIT v_limit) x),
         pg AS (SELECT substring(s.listing_url from '/itm/(\d+)') AS k, s.metadata, s.html_storage_path, s.markdown_storage_path,
                       CASE WHEN s.html IS NOT NULL AND s.fetch_method = 'ebay_browse_getItem'
                            THEN substring(s.html from '"seller":\{[^{}]*"username":"([^"]+)"') END AS json_seller
                  FROM listing_page_snapshots s, b
                 WHERE s.platform = 'ebay_motors' AND s.listing_url > coalesce(p_after, '') AND s.listing_url <= b.m),
         h AS (SELECT pg.k, 'seller'::text AS role, ebay_member_sha256(pg.json_seller) AS sha FROM pg WHERE pg.json_seller IS NOT NULL
               UNION ALL
               SELECT pg.k, CASE WHEN coalesce(pg.metadata -> 'seller_handles_sha256', '[]'::jsonb) ? x THEN 'seller' ELSE 'member' END, x
                 FROM pg CROSS JOIN LATERAL jsonb_array_elements_text(
                        CASE WHEN jsonb_typeof(pg.metadata -> 'member_handles_sha256') = 'array' THEN pg.metadata -> 'member_handles_sha256' ELSE '[]'::jsonb END) x)
    SELECT jsonb_build_object('place', p_place, 'scanned', (SELECT count(*) FROM pg),
             -- a stored page not yet read for member handles: the request cannot be called no_data until it is
             'not_assessed', (SELECT count(*) FROM pg WHERE (pg.html_storage_path IS NOT NULL OR pg.markdown_storage_path IS NOT NULL)
                                                      AND NOT (coalesce(pg.metadata, '{}'::jsonb) ? 'member_handles_sha256')),
             'next_after', CASE WHEN (SELECT n FROM b) < v_limit THEN NULL ELSE (SELECT m FROM b) END,
             'matches', coalesce((SELECT jsonb_agg(DISTINCT jsonb_build_object('member_sha256', h.sha, 'listing_key', h.k, 'role', h.role))
                                    FROM h JOIN ebay_deletion_requests d ON d.ebay_username_sha256 = h.sha), '[]'::jsonb))
      INTO v_out;
  ELSIF p_place = 'external_identities' THEN
    SELECT jsonb_build_object('place', p_place, 'scanned', count(*), 'not_assessed', 0, 'next_after', NULL,
             'matches', coalesce(jsonb_agg(DISTINCT jsonb_build_object('member_sha256', d.ebay_username_sha256, 'listing_key', NULL, 'role', 'member'))
                                   FILTER (WHERE d.ebay_username_sha256 IS NOT NULL), '[]'::jsonb))
      INTO v_out
      FROM external_identities e
      LEFT JOIN ebay_deletion_requests d ON d.ebay_username_sha256 = ebay_member_sha256(e.handle)
     WHERE e.platform = ANY (c_platforms);
  ELSIF p_place = 'ebay_parts_catalog' THEN
    SELECT jsonb_build_object('place', p_place, 'scanned', (SELECT count(*) FROM ebay_parts_catalog), 'not_assessed', 0, 'next_after', NULL,
             'matches', coalesce(jsonb_agg(DISTINCT jsonb_build_object('member_sha256', d.ebay_username_sha256, 'listing_key', NULL, 'role', 'member')), '[]'::jsonb))
      INTO v_out
      FROM (SELECT unnest(discovered_sellers) AS v FROM ebay_parts_catalog UNION ALL SELECT top_seller_username FROM ebay_parts_catalog) x
      JOIN ebay_deletion_requests d ON d.ebay_username_sha256 = ebay_member_sha256(x.v);
  ELSE
    RAISE EXCEPTION 'ebay_deletion_scan: unknown place % (vehicle_events, vehicle_observations, listing_page_snapshots, external_identities, ebay_parts_catalog)', p_place;
  END IF;
  RETURN v_out || jsonb_build_object('at', now());   -- the database clock: the worker's cutoff is the first page's 'at'
END $$;

-- ---- stored pages --------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ebay_listing_storage_snapshots(p_listing_keys text[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF cardinality(p_listing_keys) > 200 THEN RAISE EXCEPTION 'ebay_listing_storage_snapshots: at most 200 listings per call'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', s.id, 'listing_key', substring(s.listing_url from '/itm/(\d+)'),
             'html_storage_path', s.html_storage_path, 'markdown_storage_path', s.markdown_storage_path) ORDER BY s.listing_url, s.id)
      FROM listing_page_snapshots s
     WHERE s.platform = 'ebay_motors'
       AND s.listing_url = ANY (ARRAY(SELECT 'https://www.ebay.com/itm/' || k FROM unnest(coalesce(p_listing_keys, '{}')) k))
       AND (s.html_storage_path IS NOT NULL OR s.markdown_storage_path IS NOT NULL)), '[]'::jsonb);
END $$;

-- The spellings of one deleted member that the structured copies on these listings hold (lower-cased), so the worker can
-- rewrite a stored page that names them without a label. Service role only; the worker keeps them in memory and logs none.
CREATE OR REPLACE FUNCTION public.ebay_member_spellings(p_member_sha256 text, p_listing_keys text[])
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  c_platforms constant text[] := ARRAY['ebay', 'ebay_motors', 'ebay-motors'];
  v_src uuid; v_urls text[];
BEGIN
  IF p_member_sha256 IS NULL OR p_member_sha256 !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'ebay_member_spellings: p_member_sha256 must be a sha256 hex'; END IF;
  IF cardinality(p_listing_keys) > 200 THEN RAISE EXCEPTION 'ebay_member_spellings: at most 200 listings per call'; END IF;
  IF NOT EXISTS (SELECT 1 FROM ebay_deletion_requests WHERE ebay_username_sha256 = p_member_sha256) THEN
    RAISE EXCEPTION 'ebay_member_spellings: no eBay deletion request for this member';
  END IF;
  SELECT id INTO v_src FROM observation_sources WHERE slug = 'ebay_motors';
  v_urls := ARRAY(SELECT 'https://www.ebay.com/itm/' || x FROM unnest(coalesce(p_listing_keys, '{}')) x);
  RETURN ARRAY(SELECT DISTINCT lower(btrim(x.v)) FROM (
      SELECT t1.v FROM vehicle_events e
        CROSS JOIN LATERAL (VALUES (e.metadata ->> 'seller_username'), (e.seller_identifier), (e.buyer_identifier)) t1(v)
       WHERE e.source_platform = ANY (c_platforms) AND coalesce(e.source_listing_id, substring(e.source_url from '/itm/(\d+)')) = ANY (p_listing_keys)
      UNION ALL SELECT t2.v FROM vehicle_observations o
        CROSS JOIN LATERAL (VALUES (o.extraction_metadata #>> '{raw,seller,username}'), (o.extraction_metadata #>> '{raw,seller_class_claim,signals,username}'),
                                   (o.structured_data ->> 'seller_username'), (o.structured_data ->> 'seller_name')) t2(v)
       WHERE o.source_id = v_src AND o.source_identifier = ANY (p_listing_keys)
      UNION ALL SELECT substring(s.html from '"seller":\{[^{}]*"username":"([^"]+)"') FROM listing_page_snapshots s
       WHERE s.platform = 'ebay_motors' AND s.listing_url = ANY (v_urls) AND s.html IS NOT NULL
    ) x WHERE ebay_member_sha256(x.v) = p_member_sha256);
END $$;

-- Stored eBay pages not yet read for member handles, one keyset page (by listing_url) at a time.
CREATE OR REPLACE FUNCTION public.ebay_snapshot_handles_todo(p_after text DEFAULT NULL, p_limit integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 200); v_out jsonb;
BEGIN
  WITH b AS (SELECT max(u) AS m, count(*) AS n FROM (
               SELECT s.listing_url u FROM listing_page_snapshots s
                WHERE s.platform = 'ebay_motors' AND s.listing_url > coalesce(p_after, '')
                ORDER BY s.listing_url LIMIT v_limit) x),
       pg AS (SELECT s.id, s.fetch_method, s.html_storage_path, s.markdown_storage_path, (s.html IS NOT NULL) AS inline, s.metadata
                FROM listing_page_snapshots s, b
               WHERE s.platform = 'ebay_motors' AND s.listing_url > coalesce(p_after, '') AND s.listing_url <= b.m)
  SELECT jsonb_build_object('next_after', CASE WHEN (SELECT n FROM b) < v_limit THEN NULL ELSE (SELECT m FROM b) END,
           'rows', coalesce(jsonb_agg(jsonb_build_object('id', pg.id, 'fetch_method', pg.fetch_method, 'inline', pg.inline,
                      'html_storage_path', pg.html_storage_path, 'markdown_storage_path', pg.markdown_storage_path))
                    FILTER (WHERE NOT (coalesce(pg.metadata, '{}'::jsonb) ? 'member_handles_sha256')
                              AND (pg.inline OR pg.html_storage_path IS NOT NULL OR pg.markdown_storage_path IS NOT NULL)), '[]'::jsonb))
    INTO v_out FROM pg;
  RETURN v_out;
END $$;

-- p_rows [{snapshot_id, member_handles_sha256: [...], seller_handles_sha256: [...]}] (at most 200): the hashes of the member
-- handles a stored page names, written into its metadata so a later deletion request finds the page without reading it.
CREATE OR REPLACE FUNCTION public.set_ebay_snapshot_handles(p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_timeout_ms bigint := (SELECT setting::bigint FROM pg_settings WHERE name = 'statement_timeout');
  r jsonb; v_n integer := 0; v_c integer;
BEGIN
  IF v_timeout_ms < 1 OR v_timeout_ms > 60000 THEN
    RAISE EXCEPTION 'set_ebay_snapshot_handles: caller must set statement_timeout between 1 ms and 60 s (now % ms)', v_timeout_ms;
  END IF;
  PERFORM set_config('lock_timeout', '3s', true);
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) > 200 THEN
    RAISE EXCEPTION 'set_ebay_snapshot_handles: p_rows must be an array of at most 200';
  END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    IF NOT pg_input_is_valid(r ->> 'snapshot_id', 'uuid')
       OR jsonb_typeof(r -> 'member_handles_sha256') IS DISTINCT FROM 'array'
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(r -> 'member_handles_sha256') x WHERE x #>> '{}' !~ '^[0-9a-f]{64}$' OR jsonb_typeof(x) <> 'string')
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(r -> 'seller_handles_sha256', '[]')) x WHERE x #>> '{}' !~ '^[0-9a-f]{64}$' OR jsonb_typeof(x) <> 'string') THEN
      RAISE EXCEPTION 'set_ebay_snapshot_handles: each row needs a snapshot_id and arrays of sha256 hex';
    END IF;
    UPDATE listing_page_snapshots
       SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
             'member_handles_sha256', r -> 'member_handles_sha256',
             'seller_handles_sha256', coalesce(r -> 'seller_handles_sha256', '[]'::jsonb))
     WHERE id = (r ->> 'snapshot_id')::uuid AND platform = 'ebay_motors'
       AND (metadata -> 'member_handles_sha256' IS DISTINCT FROM r -> 'member_handles_sha256'
            OR metadata -> 'seller_handles_sha256' IS DISTINCT FROM coalesce(r -> 'seller_handles_sha256', '[]'::jsonb));
    GET DIAGNOSTICS v_c = ROW_COUNT; v_n := v_n + v_c;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'updated', v_n);
END $$;

-- A stored page the worker rewrote in Storage (same path): its row takes the new sha256 and length (sha256 null when another
-- capture of the listing now has the same bytes, so the unique key holds), the page's remaining handle hashes, and a receipt.
CREATE OR REPLACE FUNCTION public.mark_ebay_snapshot_redacted(p_snapshot_id uuid, p_html_sha256 text, p_content_length integer,
  p_member_handles_sha256 text[], p_seller_handles_sha256 text[], p_parts text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_timeout_ms bigint := (SELECT setting::bigint FROM pg_settings WHERE name = 'statement_timeout');
  s listing_page_snapshots%ROWTYPE; v_sha text := p_html_sha256;
BEGIN
  IF v_timeout_ms < 1 OR v_timeout_ms > 60000 THEN
    RAISE EXCEPTION 'mark_ebay_snapshot_redacted: caller must set statement_timeout between 1 ms and 60 s (now % ms)', v_timeout_ms;
  END IF;
  PERFORM set_config('lock_timeout', '3s', true);
  IF (v_sha IS NOT NULL AND v_sha !~ '^[0-9a-f]{64}$')
     OR EXISTS (SELECT 1 FROM unnest(coalesce(p_member_handles_sha256, '{}') || coalesce(p_seller_handles_sha256, '{}')) x WHERE x !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'mark_ebay_snapshot_redacted: hashes must be sha256 hex';
  END IF;
  SELECT * INTO s FROM listing_page_snapshots WHERE id = p_snapshot_id FOR UPDATE;
  IF NOT FOUND OR s.platform <> 'ebay_motors' OR (s.html_storage_path IS NULL AND s.markdown_storage_path IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'why', 'not a stored eBay page');
  END IF;
  IF v_sha IS NOT NULL AND EXISTS (SELECT 1 FROM listing_page_snapshots WHERE platform = s.platform AND listing_url = s.listing_url
                                     AND html_sha256 = v_sha AND id <> s.id) THEN
    v_sha := NULL;
  END IF;
  UPDATE listing_page_snapshots
     SET html_sha256 = CASE WHEN p_html_sha256 IS NULL THEN html_sha256 ELSE v_sha END,
         content_length = coalesce(p_content_length, content_length),
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
           'member_handles_sha256', to_jsonb(coalesce(p_member_handles_sha256, '{}')),
           'seller_handles_sha256', to_jsonb(coalesce(p_seller_handles_sha256, '{}')),
           'privacy_redactions', CASE WHEN jsonb_typeof(metadata -> 'privacy_redactions') = 'array' THEN metadata -> 'privacy_redactions' ELSE '[]'::jsonb END
             || jsonb_build_array(jsonb_build_object('reason', 'ebay_marketplace_account_deletion', 'at', now(), 'writer', 'mark_ebay_snapshot_redacted',
                  'rewrote', to_jsonb(coalesce(p_parts, '{}')), 'note', 'stored body rewritten in place at the same path; html_sha256 is the rewritten body''s')))
   WHERE id = s.id;
  RETURN jsonb_build_object('ok', true, 'sha_cleared', p_html_sha256 IS NOT NULL AND v_sha IS NULL);
END $$;

-- ---- the SQL places of one member's listings -------------------------------------------------------------------------------
-- p_seller_keys: eBay item numbers the member sold (their own seller field matched); p_mention_keys: listings whose stored
-- page names the member otherwise (a bidder). p_handles: spellings the worker read on stored pages, each must hash to
-- p_member_sha256. On seller listings the seller fields go, feedback figures are withheld, and e-mail addresses and phone
-- numbers in the description are replaced (text_redact_contact); on every listing each mention of the handle is replaced.
-- External identities and the parts catalog are redacted by hash. Returns changed rows per place; never a handle.
CREATE OR REPLACE FUNCTION public.redact_ebay_deleted_member(p_member_sha256 text, p_seller_keys text[] DEFAULT '{}',
  p_mention_keys text[] DEFAULT '{}', p_handles text[] DEFAULT '{}')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_writer    constant text := 'redact_ebay_deleted_member';
  c_platforms constant text[] := ARRAY['ebay', 'ebay_motors', 'ebay-motors'];
  v_timeout_ms bigint := (SELECT setting::bigint FROM pg_settings WHERE name = 'statement_timeout');
  v_prev_writer text := current_setting('app.writer', true);
  v_seller text[]; v_mention text[]; v_keys text[]; v_urls text[]; v_src uuid; v_handles text[];
  v_entry jsonb; r record; j jsonb; j0 jsonb; t text; t2 text; sd jsonb; k text; v_sha text; v_is_seller boolean;
  n_ev integer := 0; n_obs integer := 0; n_snap integer := 0; n_veh integer := 0; n_ident integer := 0; n_parts integer := 0;
  v_refused jsonb := '[]'::jsonb;
BEGIN
  IF v_timeout_ms < 1 OR v_timeout_ms > 60000 THEN
    RAISE EXCEPTION 'redact_ebay_deleted_member: caller must set statement_timeout between 1 ms and 60 s (now % ms)', v_timeout_ms;
  END IF;
  PERFORM set_config('lock_timeout', '3s', true);
  IF p_member_sha256 IS NULL OR p_member_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'redact_ebay_deleted_member: p_member_sha256 must be a sha256 hex';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ebay_deletion_requests WHERE ebay_username_sha256 = p_member_sha256) THEN
    RAISE EXCEPTION 'redact_ebay_deleted_member: no eBay deletion request for this member';
  END IF;
  v_seller := ARRAY(SELECT DISTINCT x FROM unnest(coalesce(p_seller_keys, '{}')) x WHERE x IS NOT NULL);
  v_mention := ARRAY(SELECT DISTINCT x FROM unnest(coalesce(p_mention_keys, '{}')) x WHERE x IS NOT NULL AND NOT x = ANY (v_seller));
  v_keys := v_seller || v_mention;
  IF cardinality(v_keys) > 200 THEN RAISE EXCEPTION 'redact_ebay_deleted_member: at most 200 listings per call (got %)', cardinality(v_keys); END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_keys) x WHERE x !~ '^\d{6,19}$') THEN
    RAISE EXCEPTION 'redact_ebay_deleted_member: listing keys are eBay item numbers';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(coalesce(p_handles, '{}')) x WHERE ebay_member_sha256(x) IS DISTINCT FROM p_member_sha256) THEN
    RAISE EXCEPTION 'redact_ebay_deleted_member: a handle does not hash to this member';
  END IF;
  v_urls := ARRAY(SELECT 'https://www.ebay.com/itm/' || x FROM unnest(v_keys) x);
  SELECT id INTO v_src FROM observation_sources WHERE slug = 'ebay_motors';

  -- The spellings held: what the worker read on stored pages, and every structured copy on these listings.
  v_handles := ARRAY(SELECT DISTINCT lower(btrim(x.v)) FROM (
      SELECT unnest(coalesce(p_handles, '{}')) AS v
      UNION ALL SELECT t1.v FROM vehicle_events e
        CROSS JOIN LATERAL (VALUES (e.metadata ->> 'seller_username'), (e.seller_identifier), (e.buyer_identifier)) t1(v)
       WHERE e.source_platform = ANY (c_platforms) AND coalesce(e.source_listing_id, substring(e.source_url from '/itm/(\d+)')) = ANY (v_keys)
      UNION ALL SELECT t2.v FROM vehicle_observations o
        CROSS JOIN LATERAL (VALUES (o.extraction_metadata #>> '{raw,seller,username}'), (o.extraction_metadata #>> '{raw,seller_class_claim,signals,username}'),
                                   (o.structured_data ->> 'seller_username'), (o.structured_data ->> 'seller_name')) t2(v)
       WHERE o.source_id = v_src AND o.source_identifier = ANY (v_keys)
      UNION ALL SELECT substring(s.html from '"seller":\{[^{}]*"username":"([^"]+)"') FROM listing_page_snapshots s
       WHERE s.platform = 'ebay_motors' AND s.listing_url = ANY (v_urls) AND s.html IS NOT NULL
      UNION ALL SELECT ei.handle FROM external_identities ei WHERE ei.platform = ANY (c_platforms)
      UNION ALL SELECT pc.top_seller_username FROM ebay_parts_catalog pc
      UNION ALL SELECT unnest(pc.discovered_sellers) FROM ebay_parts_catalog pc
    ) x WHERE ebay_member_sha256(x.v) = p_member_sha256);

  v_entry := jsonb_build_object('reason', 'ebay_marketplace_account_deletion', 'at', now(), 'writer', c_writer);
  PERFORM set_config('app.writer', c_writer, true);

  -- 1. vehicle_events: the episode keeps its listing, price, clocks and vehicle
  FOR r IN SELECT e.id, coalesce(e.source_listing_id, substring(e.source_url from '/itm/(\d+)')) AS k, e.metadata, e.seller_identifier, e.buyer_identifier
             FROM vehicle_events e
            WHERE e.source_platform = ANY (c_platforms) AND coalesce(e.source_listing_id, substring(e.source_url from '/itm/(\d+)')) = ANY (v_keys)
            FOR UPDATE LOOP
    BEGIN
      j0 := coalesce(r.metadata, '{}'::jsonb); j := j0;
      IF ebay_member_sha256(j ->> 'seller_username') = p_member_sha256 THEN
        -- seller_feedback_percent: the older URL door's spelling (index.ts; no row carries it on 2026-10-20)
        j := regexp_replace((j - 'seller_username' - 'seller_feedback_score' - 'seller_feedback_percentage' - 'seller_feedback_percent')::text,
                            'feedback score \d+', 'feedback score (withheld)', 'g')::jsonb;
      END IF;
      IF cardinality(v_handles) > 0 THEN j := ebay_redact_handles(j::text, v_handles)::jsonb; END IF;
      IF j IS DISTINCT FROM j0 OR ebay_member_sha256(r.seller_identifier) = p_member_sha256 OR ebay_member_sha256(r.buyer_identifier) = p_member_sha256 THEN
        UPDATE vehicle_events
           SET metadata = j || jsonb_build_object('privacy_redactions',
                 CASE WHEN jsonb_typeof(j -> 'privacy_redactions') = 'array' THEN j -> 'privacy_redactions' ELSE '[]'::jsonb END || jsonb_build_array(v_entry)),
               seller_identifier = CASE WHEN ebay_member_sha256(seller_identifier) = p_member_sha256 THEN NULL ELSE seller_identifier END,
               buyer_identifier = CASE WHEN ebay_member_sha256(buyer_identifier) = p_member_sha256 THEN NULL ELSE buyer_identifier END,
               updated_at = now()
         WHERE id = r.id;
        n_ev := n_ev + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_refused := v_refused || jsonb_build_object('place', 'vehicle_events', 'id', r.id, 'sqlstate', SQLSTATE, 'why', left(ebay_redact_handles(SQLERRM, v_handles), 200));
    END;
  END LOOP;

  -- 2. vehicle_observations: the claim keeps its fields, clocks and vehicle; the raw seller object and the description's
  --    mentions go (content_hash is the digest written at landing and is left as it was)
  FOR r IN SELECT o.id, o.source_identifier AS k, o.extraction_metadata, o.content_text, o.structured_data
             FROM vehicle_observations o WHERE o.source_id = v_src AND o.source_identifier = ANY (v_keys) FOR UPDATE LOOP
    BEGIN
      v_is_seller := r.k = ANY (v_seller);
      j0 := r.extraction_metadata; j := j0;
      IF j IS NOT NULL AND ebay_member_sha256(j #>> '{raw,seller,username}') = p_member_sha256 THEN
        j := jsonb_set(j, '{raw,seller}', '{}'::jsonb);
      END IF;
      IF j IS NOT NULL AND ebay_member_sha256(j #>> '{raw,seller_class_claim,signals,username}') = p_member_sha256 THEN
        j := regexp_replace((j #- '{raw,seller_class_claim,signals,username}' #- '{raw,seller_class_claim,signals,feedback_score}'
                              #- '{raw,seller_class_claim,signals,feedback_percentage}')::text,
                            'feedback score \d+', 'feedback score (withheld)', 'g')::jsonb;
      END IF;
      IF j IS NOT NULL AND cardinality(v_handles) > 0 THEN j := ebay_redact_handles(j::text, v_handles)::jsonb; END IF;
      -- contact details first, so an address that embeds the handle goes whole
      t := ebay_redact_handles(CASE WHEN v_is_seller THEN text_redact_contact(r.content_text) ELSE r.content_text END, v_handles);
      sd := r.structured_data;
      IF sd IS NOT NULL THEN
        IF ebay_member_sha256(sd ->> 'seller_username') = p_member_sha256 THEN sd := sd - 'seller_username'; END IF;
        IF ebay_member_sha256(sd ->> 'seller_name') = p_member_sha256 THEN sd := sd - 'seller_name'; END IF;
        IF cardinality(v_handles) > 0 THEN sd := ebay_redact_handles(sd::text, v_handles)::jsonb; END IF;
      END IF;
      IF j IS DISTINCT FROM j0 OR t IS DISTINCT FROM r.content_text OR sd IS DISTINCT FROM r.structured_data THEN
        UPDATE vehicle_observations
           SET extraction_metadata = coalesce(j, '{}'::jsonb) || jsonb_build_object('privacy_redactions',
                 CASE WHEN jsonb_typeof(j -> 'privacy_redactions') = 'array' THEN j -> 'privacy_redactions' ELSE '[]'::jsonb END || jsonb_build_array(v_entry)),
               content_text = t,
               structured_data = sd
         WHERE id = r.id;
        n_obs := n_obs + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_refused := v_refused || jsonb_build_object('place', 'vehicle_observations', 'id', r.id, 'sqlstate', SQLSTATE, 'why', left(ebay_redact_handles(SQLERRM, v_handles), 200));
    END;
  END LOOP;

  -- 3. listing_page_snapshots held inline (the getItem JSON); stored pages are rewritten by the worker in Storage
  FOR r IN SELECT s.id, s.listing_url, s.fetch_method, s.html, s.metadata FROM listing_page_snapshots s
            WHERE s.platform = 'ebay_motors' AND s.listing_url = ANY (v_urls) AND s.html IS NOT NULL FOR UPDATE LOOP
    BEGIN
      v_is_seller := substring(r.listing_url from '/itm/(\d+)') = ANY (v_seller);
      t := r.html;
      IF r.fetch_method = 'ebay_browse_getItem' AND pg_input_is_valid(r.html, 'jsonb') THEN
        j0 := r.html::jsonb; j := j0;
        IF ebay_member_sha256(j #>> '{seller,username}') = p_member_sha256 THEN j := jsonb_set(j, '{seller}', '{}'::jsonb); END IF;
        IF v_is_seller THEN
          FOREACH k IN ARRAY ARRAY['description', 'shortDescription', 'subtitle'] LOOP
            IF jsonb_typeof(j -> k) = 'string' THEN j := jsonb_set(j, ARRAY[k], to_jsonb(text_redact_contact(j ->> k))); END IF;
          END LOOP;
        END IF;
        IF j IS DISTINCT FROM j0 THEN t := j::text; END IF;
      END IF;
      t2 := ebay_redact_handles(t, v_handles);
      IF t2 IS DISTINCT FROM r.html THEN
        v_sha := encode(sha256(convert_to(t2, 'UTF8')), 'hex');
        IF EXISTS (SELECT 1 FROM listing_page_snapshots WHERE platform = 'ebay_motors' AND listing_url = r.listing_url AND html_sha256 = v_sha AND id <> r.id) THEN
          v_sha := NULL;
        END IF;
        UPDATE listing_page_snapshots
           SET html = t2, html_sha256 = v_sha, content_length = octet_length(t2),
               metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
                 'member_handles_sha256', (SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM jsonb_array_elements_text(
                    CASE WHEN jsonb_typeof(metadata -> 'member_handles_sha256') = 'array' THEN metadata -> 'member_handles_sha256' ELSE '[]'::jsonb END) x
                    WHERE x <> p_member_sha256),
                 'seller_handles_sha256', (SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM jsonb_array_elements_text(
                    CASE WHEN jsonb_typeof(metadata -> 'seller_handles_sha256') = 'array' THEN metadata -> 'seller_handles_sha256' ELSE '[]'::jsonb END) x
                    WHERE x <> p_member_sha256),
                 'privacy_redactions', CASE WHEN jsonb_typeof(metadata -> 'privacy_redactions') = 'array' THEN metadata -> 'privacy_redactions' ELSE '[]'::jsonb END
                   || jsonb_build_array(v_entry || jsonb_build_object('note', 'body rewritten in place; html_sha256 is the rewritten body''s')))
         WHERE id = r.id;
        n_snap := n_snap + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_refused := v_refused || jsonb_build_object('place', 'listing_page_snapshots', 'id', r.id, 'sqlstate', SQLSTATE, 'why', left(ebay_redact_handles(SQLERRM, v_handles), 200));
    END;
  END LOOP;

  -- 4. vehicles reached through these listings' eBay episodes: seller_name and the description
  FOR r IN SELECT v.id, v.seller_name, v.description, v.source, bool_or(x.k = ANY (v_seller)) AS sold_by_member
             FROM vehicles v
             JOIN (SELECT e.vehicle_id, coalesce(e.source_listing_id, substring(e.source_url from '/itm/(\d+)')) AS k FROM vehicle_events e
                    WHERE e.source_platform = ANY (c_platforms) AND e.vehicle_id IS NOT NULL
                      AND coalesce(e.source_listing_id, substring(e.source_url from '/itm/(\d+)')) = ANY (v_keys)) x ON x.vehicle_id = v.id
            GROUP BY v.id, v.seller_name, v.description, v.source LOOP
    BEGIN
      t := CASE WHEN ebay_member_sha256(r.seller_name) = p_member_sha256 THEN NULL ELSE ebay_redact_handles(r.seller_name, v_handles) END;
      -- the description is the member's own only on a vehicle the eBay intake created from their listing
      t2 := ebay_redact_handles(CASE WHEN r.sold_by_member AND r.source IN ('ebay_motors', 'ebay')
                                     THEN text_redact_contact(r.description) ELSE r.description END, v_handles);
      IF t IS DISTINCT FROM r.seller_name OR t2 IS DISTINCT FROM r.description THEN
        UPDATE vehicles SET seller_name = t, description = t2 WHERE id = r.id;
        n_veh := n_veh + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_refused := v_refused || jsonb_build_object('place', 'vehicles', 'id', r.id, 'sqlstate', SQLSTATE, 'why', left(ebay_redact_handles(SQLERRM, v_handles), 200));
    END;
  END LOOP;

  -- 5. external_identities (eBay platforms): the handle becomes an unlinkable mask
  FOR r IN SELECT ei.id, ei.handle, ei.display_name, ei.profile_url FROM external_identities ei
            WHERE ei.platform = ANY (c_platforms) AND ebay_member_sha256(ei.handle) = p_member_sha256 FOR UPDATE LOOP
    BEGIN
      UPDATE external_identities
         SET handle = 'deleted-ebay-member-' || substr(md5(gen_random_uuid()::text), 1, 12),
             display_name = CASE WHEN ebay_member_sha256(display_name) = p_member_sha256 THEN NULL ELSE ebay_redact_handles(display_name, v_handles) END,
             profile_url = ebay_redact_handles(profile_url, v_handles), updated_at = now()
       WHERE id = r.id;
      n_ident := n_ident + 1;
    EXCEPTION WHEN OTHERS THEN
      v_refused := v_refused || jsonb_build_object('place', 'external_identities', 'id', r.id, 'sqlstate', SQLSTATE, 'why', left(ebay_redact_handles(SQLERRM, v_handles), 200));
    END;
  END LOOP;

  -- 6. ebay_parts_catalog: the seller lists
  UPDATE ebay_parts_catalog pc
     SET discovered_sellers = ARRAY(SELECT x FROM unnest(pc.discovered_sellers) x WHERE ebay_member_sha256(x) IS DISTINCT FROM p_member_sha256),
         top_seller_username = CASE WHEN ebay_member_sha256(pc.top_seller_username) = p_member_sha256 THEN NULL ELSE pc.top_seller_username END,
         sample_listings = CASE WHEN cardinality(v_handles) > 0 AND pc.sample_listings IS NOT NULL
                                THEN ebay_redact_handles(pc.sample_listings::text, v_handles)::jsonb ELSE pc.sample_listings END,
         updated_at = now()
   WHERE ebay_member_sha256(pc.top_seller_username) = p_member_sha256
      OR EXISTS (SELECT 1 FROM unnest(pc.discovered_sellers) x WHERE ebay_member_sha256(x) = p_member_sha256);
  GET DIAGNOSTICS n_parts = ROW_COUNT;

  PERFORM set_config('app.writer', coalesce(v_prev_writer, ''), true);
  RETURN jsonb_build_object('ok', true,
    'changed', jsonb_build_object('vehicle_events', n_ev, 'vehicle_observations', n_obs, 'listing_page_snapshots', n_snap,
                                  'vehicles', n_veh, 'external_identities', n_ident, 'ebay_parts_catalog', n_parts),
    'handles_found', cardinality(v_handles), 'listings', cardinality(v_keys), 'refused', v_refused);
END $$;

-- ---- status, honoured_at and the receipt -------------------------------------------------------------------------------
-- p_results [{member_sha256, changed: {place: rows}, residual: n, refused: n}] from one run; p_scan {complete, not_assessed,
-- scanned: {place: rows}}. Only a complete scan with not_assessed = 0 changes a status: a member whose data was found and
-- fully redacted (residual 0, refused 0) is honoured; every other request received by p_cutoff that no complete scan has
-- covered yet is no_data. Receipts hold counts only.
CREATE OR REPLACE FUNCTION public.finish_ebay_deletions(p_cutoff timestamptz, p_results jsonb, p_scan jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_timeout_ms bigint := (SELECT setting::bigint FROM pg_settings WHERE name = 'statement_timeout');
  v_scan jsonb; v_h integer := 0; v_n integer := 0; v_held integer := 0;
  v_cutoff timestamptz := least(p_cutoff, now());   -- the caller's clock may run ahead of the database's
BEGIN
  IF v_timeout_ms < 1 OR v_timeout_ms > 60000 THEN
    RAISE EXCEPTION 'finish_ebay_deletions: caller must set statement_timeout between 1 ms and 60 s (now % ms)', v_timeout_ms;
  END IF;
  PERFORM set_config('lock_timeout', '3s', true);
  IF p_cutoff IS NULL THEN RAISE EXCEPTION 'finish_ebay_deletions: p_cutoff (when the run''s scan began) is required'; END IF;
  IF jsonb_typeof(coalesce(p_results, '[]'::jsonb)) <> 'array' OR jsonb_typeof(p_scan) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'finish_ebay_deletions: p_results must be an array and p_scan an object';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) x WHERE coalesce(x ->> 'member_sha256', '') !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'finish_ebay_deletions: every result needs a member_sha256';
  END IF;
  v_scan := jsonb_build_object('complete', p_scan -> 'complete', 'not_assessed', p_scan -> 'not_assessed', 'scanned', p_scan -> 'scanned', 'at', now());
  IF (p_scan ->> 'complete')::boolean IS NOT TRUE OR coalesce((p_scan ->> 'not_assessed')::bigint, 1) <> 0 THEN
    SELECT count(*) INTO v_held FROM ebay_deletion_requests WHERE received_at <= v_cutoff AND checked_at IS NULL;
    RETURN jsonb_build_object('ok', true, 'finished', false, 'why', 'scan incomplete or stored pages not yet read for member handles',
                              'honoured', 0, 'no_data', 0, 'still_pending', v_held);
  END IF;

  WITH res AS (
         SELECT x ->> 'member_sha256' AS sha, coalesce(x -> 'changed', '{}'::jsonb) AS changed,
                coalesce((x ->> 'residual')::int, 0) AS residual, coalesce((x ->> 'refused')::int, 0) AS refused
           FROM jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) x),
       ok AS (SELECT * FROM res WHERE residual = 0 AND refused = 0
                AND (SELECT coalesce(sum(value::bigint), 0) FROM jsonb_each_text(res.changed)) > 0),
       upd AS (
         UPDATE ebay_deletion_requests d
            SET status = 'honoured', honoured_at = coalesce(d.honoured_at, now()), checked_at = now(),
                receipt = jsonb_build_object(
                  'changed', (SELECT jsonb_object_agg(key, total) FROM (
                                SELECT key, sum(value::bigint) AS total FROM (
                                  SELECT * FROM jsonb_each_text(coalesce(d.receipt -> 'changed', '{}'::jsonb))
                                  UNION ALL SELECT * FROM jsonb_each_text(ok.changed)) a GROUP BY key) b),
                  'scan', v_scan, 'last_run', now(), 'signature_checked', d.signature_checked)
           FROM ok
          WHERE d.ebay_username_sha256 = ok.sha AND d.received_at <= v_cutoff
         RETURNING 1)
  SELECT count(*) INTO v_h FROM upd;

  WITH res AS (SELECT x ->> 'member_sha256' AS sha FROM jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) x),
       upd AS (
         UPDATE ebay_deletion_requests d
            SET status = CASE WHEN d.status = 'honoured' THEN 'honoured' ELSE 'no_data' END,
                honoured_at = coalesce(d.honoured_at, now()), checked_at = now(),
                receipt = jsonb_build_object('changed', coalesce(d.receipt -> 'changed', '{}'::jsonb), 'scan', v_scan, 'last_run', now(),
                                             'signature_checked', d.signature_checked)
                          || CASE WHEN d.ebay_username_sha256 IS NULL THEN jsonb_build_object('note', 'the notice carried no username; nothing we hold carries eBay user ids') ELSE '{}'::jsonb END
          WHERE d.checked_at IS NULL AND d.received_at <= v_cutoff
            AND NOT EXISTS (SELECT 1 FROM res WHERE res.sha = d.ebay_username_sha256)
         RETURNING 1)
  SELECT count(*) INTO v_n FROM upd;

  SELECT count(*) INTO v_held FROM ebay_deletion_requests WHERE received_at <= v_cutoff AND checked_at IS NULL;
  RETURN jsonb_build_object('ok', true, 'finished', true, 'honoured', v_h, 'no_data', v_n, 'still_pending', v_held);
END $$;

-- ---- grants -----------------------------------------------------------------------------------------------------------------
DO $grants$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.ebay_member_sha256(text)', 'public.ebay_redact_handles(text, text[])', 'public.ebay_deleted_member_hashes(text[])',
    'public.ebay_deletion_scan(text, text, integer)', 'public.ebay_listing_storage_snapshots(text[])', 'public.ebay_member_spellings(text, text[])',
    'public.ebay_snapshot_handles_todo(text, integer)', 'public.set_ebay_snapshot_handles(jsonb)',
    'public.mark_ebay_snapshot_redacted(uuid, text, integer, text[], text[], text[])',
    'public.redact_ebay_deleted_member(text, text[], text[], text[])', 'public.finish_ebay_deletions(timestamptz, jsonb, jsonb)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $grants$;

COMMENT ON FUNCTION public.ebay_deletion_scan(text, text, integer) IS
  'One keyset page of one place (vehicle_events, vehicle_observations, listing_page_snapshots, external_identities, ebay_parts_catalog) matched against every eBay deletion request by ebay_member_sha256: {place, scanned, next_after, matches[{member_sha256, listing_key, role}], not_assessed}. Read-only; service role (extract-ebay-motors honour_deletions).';
COMMENT ON FUNCTION public.redact_ebay_deleted_member(text, text[], text[], text[]) IS
  'Erases one deleted eBay member''s handle (and, on listings they sold, feedback figures and description contact details) from vehicle_events, vehicle_observations, inline listing_page_snapshots, vehicles, external_identities and ebay_parts_catalog, in place, with a privacy_redactions[] receipt on each changed row and no copy of the removed value. Listings, prices, vehicles and photos stay. At most 200 listings per call; service role only (2026-10-20).';
COMMENT ON FUNCTION public.finish_ebay_deletions(timestamptz, jsonb, jsonb) IS
  'Stamps ebay_deletion_requests after a complete honour run: honoured (data found and fully redacted), no_data (nothing held), receipt counts only. Refuses to change a status while the scan is incomplete or stored pages are unread for member handles.';
COMMENT ON FUNCTION public.set_ebay_snapshot_handles(jsonb) IS
  'Writes metadata.member_handles_sha256 / seller_handles_sha256 (ebay_member_sha256 of each member handle a stored eBay page names) on listing_page_snapshots rows; at most 200 per call; service role only.';
COMMENT ON FUNCTION public.mark_ebay_snapshot_redacted(uuid, text, integer, text[], text[], text[]) IS
  'Records a stored eBay page the honour worker rewrote in Storage: new html_sha256 and length, remaining handle hashes, privacy_redactions[] receipt. Service role only.';

-- ---- the schedule: every 6 hours --------------------------------------------------------------------------------------------
-- Off with: select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'ebay-deletion-honour'), active := false);
DO $job$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN RETURN; END IF;   -- isolated contract databases have no pg_cron
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ebay-deletion-honour') THEN
    PERFORM cron.schedule('ebay-deletion-honour', '40 */6 * * *', $c$
      SELECT net.http_post(
        url := get_service_url() || '/functions/v1/extract-ebay-motors',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key_for_cron()),
        body := '{"action": "honour_deletions"}'::jsonb,
        timeout_milliseconds := 150000
      );
    $c$);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ebay-deletion-honour' AND active) THEN
    RAISE EXCEPTION 'ebay-deletion-honour is not scheduled and active';
  END IF;
END $job$;
COMMIT;
