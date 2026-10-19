-- external_auction_bids becomes the one cross-platform bid record (owner, 2026-10-17: capture Cars & Bids the way BaT
-- is captured, standardized but keeping its origin, comments and bids treated like BaT's).
--
-- Before: BaT bids lived in bat_bids (BaT-only, keyed to bat_listings); C&B bids lived in three shapes, bid comments in
-- auction_comments, JSON in auction_events.bid_history and 26,163 legacy external_auction_bids rows with no lot key.
-- After: one row per bid per lot in external_auction_bids, keyed (auction_event_id, bid_amount, bidder_username), with
-- the platform, the source lot/comment ids, the bidder's external_identities row, amount + currency, the bid time and
-- what supports it, the source row's own recording time, this row's ingest time, source_url and vehicle_id.
-- Every row points back at the testimony it was derived from (auction_comment_id, bat_bid_id, raw_data of a
-- bid_history element), so each number replays from its source. A bid seen in several sources is one row: sources
-- merge onto the key, a weaker bid time yields to a source-posted one and the replaced value is kept in raw_data.
-- Legacy rows are never deleted: a duplicate is superseded (superseded_by), the rest gain their lot key.
--
-- Writer: record_external_auction_bids(source, ids), the only writer. trg_external_auction_bids_from_comments calls it
-- for every auction_comments INSERT (BaT reader, BaT live stream, C&B reader, cab-api-sync, extract-auction-comments),
-- so no extractor writes bids directly. Comment bids are admitted for bat and cars_and_bids only: their comment_type
-- 'bid' rows are placed bids. pcarmarket also types 'Sold $x' and 'Offer $x' rows as bids, so it waits for its lane.
--
-- Cars & Bids comments get BaT's recipe in the database too: trg_key_cab_auction_comment keys a C&B comment on C&B's own
-- comment id (source_comment_id; content_hash = sha256('cars_and_bids|native-comment:' || id), as the BaT live stream
-- keys native comments), keeps a comment already held under the legacy 'cab_<vehicle>_<id>' key on that key so no
-- writer forks it, and key_auction_comment_author_on_insert keys C&B authors by exact (cars_and_bids, handle).
BEGIN;
SET LOCAL lock_timeout = '4s';
SET LOCAL statement_timeout = '100s';

-- 1. auction_comments: the platform's own text comment id (catalog-only column add, no rewrite)
ALTER TABLE public.auction_comments ADD COLUMN IF NOT EXISTS source_comment_id text;
COMMENT ON COLUMN public.auction_comments.source_comment_id IS
'The platform''s own comment id where it is a stable text id: Cars & Bids (the data-id of the comment on the lot page, '
'the id in its comment API). Set by trg_key_cab_auction_comment from the writer''s value or from a legacy '
'''cab_<vehicle>_<id>'' content_hash. NULL on rows written before 2026-10-18 (their legacy hash carries the id) and on '
'BaT rows, whose numeric id is bat_comment_id.';

CREATE OR REPLACE FUNCTION public.key_cab_auction_comment_on_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id text; v_legacy text;
BEGIN
  v_id := nullif(btrim(coalesce(NEW.source_comment_id, substring(NEW.content_hash from '^cab_[0-9a-fA-F-]{36}_(.+)$'))), '');
  IF v_id IS NULL THEN RETURN NEW; END IF;
  NEW.source_comment_id := v_id;
  v_legacy := 'cab_' || NEW.vehicle_id::text || '_' || v_id;
  IF EXISTS (SELECT 1 FROM auction_comments c WHERE c.vehicle_id = NEW.vehicle_id AND c.content_hash = v_legacy) THEN
    NEW.content_hash := v_legacy;
  ELSE
    NEW.content_hash := encode(sha256(convert_to('cars_and_bids|native-comment:' || v_id, 'UTF8')), 'hex');
  END IF;
  RETURN NEW;
END $$;
COMMENT ON FUNCTION public.key_cab_auction_comment_on_insert() IS
'BEFORE INSERT on auction_comments for platform cars_and_bids: keys the comment on C&B''s own comment id. A comment the '
'vehicle already holds under the legacy cab_<vehicle>_<id> hash keeps that hash (the writer''s upsert lands on it); any '
'other gets sha256(''cars_and_bids|native-comment:'' || id), the hash _shared/batAuctionRecord.ts cabCommentContentHash '
'computes. A row with no derivable id passes unchanged.';
DROP TRIGGER IF EXISTS trg_key_cab_auction_comment ON public.auction_comments;
CREATE TRIGGER trg_key_cab_auction_comment BEFORE INSERT ON public.auction_comments
  FOR EACH ROW WHEN (NEW.platform = 'cars_and_bids') EXECUTE FUNCTION public.key_cab_auction_comment_on_insert();

CREATE OR REPLACE FUNCTION public.key_auction_comment_author_on_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.platform IN ('bat', 'cars_and_bids')
     AND NEW.author_username <> 'Unknown'
     AND btrim(NEW.author_username) <> ''
     AND lower(NEW.author_username) <> 'anonymous' THEN
    -- Unique (platform, handle): at most one row; no row leaves the key NULL. A handle on two platforms is two identities.
    NEW.external_identity_id := (
      SELECT e.id FROM external_identities e
      WHERE e.platform = NEW.platform AND e.handle = NEW.author_username);
  END IF;
  RETURN NEW;
END
$function$;

-- 2. external_auction_bids: the cross-platform columns (catalog-only adds on a 26k-row table)
ALTER TABLE public.external_auction_bids
  ALTER COLUMN bid_timestamp DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS auction_event_id uuid REFERENCES public.auction_events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS source_listing_id text,
  ADD COLUMN IF NOT EXISTS source_comment_id text,
  ADD COLUMN IF NOT EXISTS auction_comment_id uuid REFERENCES public.auction_comments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bat_bid_id uuid REFERENCES public.bat_bids(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS currency text,
  ADD COLUMN IF NOT EXISTS bid_timestamp_basis text,
  ADD COLUMN IF NOT EXISTS source_recorded_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES public.external_auction_bids(id),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'external_auction_bids_time_basis_check') THEN
    ALTER TABLE public.external_auction_bids ADD CONSTRAINT external_auction_bids_time_basis_check CHECK (
      bid_timestamp_basis IS NULL
      OR (bid_timestamp IS NOT NULL AND bid_timestamp_basis IN ('source_posted', 'source_bid_list', 'unverified')));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS external_auction_bids_lot_bid_key ON public.external_auction_bids
  (auction_event_id, bid_amount, bidder_username) NULLS NOT DISTINCT
  WHERE auction_event_id IS NOT NULL AND superseded_by IS NULL;
CREATE INDEX IF NOT EXISTS idx_ext_bids_auction_event ON public.external_auction_bids (auction_event_id);
CREATE INDEX IF NOT EXISTS idx_ext_bids_auction_comment ON public.external_auction_bids (auction_comment_id) WHERE auction_comment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ext_bids_bat_bid ON public.external_auction_bids (bat_bid_id) WHERE bat_bid_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ext_bids_superseded_by ON public.external_auction_bids (superseded_by) WHERE superseded_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ext_bids_bidder_time ON public.external_auction_bids (bidder_external_identity_id, bid_timestamp)
  WHERE bidder_external_identity_id IS NOT NULL AND superseded_by IS NULL;
CREATE INDEX IF NOT EXISTS idx_ext_bids_legacy_unkeyed ON public.external_auction_bids (id)
  WHERE auction_event_id IS NULL AND superseded_by IS NULL;

-- 3. Currency of a bid, from the bid's own text: BaT writes 'USD $5,000 bid placed by …', '$5,000 bid placed by …' or
-- 'EUR €8,888 bid placed by …'; Cars & Bids writes 'Bid $5,000' and auctions in US dollars only. Otherwise unknown.
CREATE OR REPLACE FUNCTION public.external_auction_bid_currency(p_platform text, p_text text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN p_text ~ '^\s*(USD|EUR|GBP|CHF|CAD|AUD|NZD|JPY|SEK|NOK|DKK|MXN)\M' THEN substring(p_text from '^\s*([A-Z]{3})')
    WHEN p_text ~ '^\s*(Bid\s+)?\$' THEN 'USD'
    WHEN p_text ~ '^\s*€' THEN 'EUR'
    WHEN p_text ~ '^\s*£' THEN 'GBP'
    WHEN p_platform = 'cars_and_bids' THEN 'USD'
    ELSE NULL END
$$;

-- 4. The writer. p_source names what p_ids are: 'auction_comments' (comment ids), 'bat_bids' (bat_bids ids),
-- 'bid_history' (auction_events ids; C&B lots' bid_history JSON) or 'legacy' (external_auction_bids ids without a lot key).
CREATE OR REPLACE FUNCTION public.record_external_auction_bids(p_source text, p_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_candidates integer := 0; v_inserted integer := 0; v_merged integer := 0;
  v_keyed integer := 0; v_superseded integer := 0; v_unresolved integer := 0;
  r record; v_event record; v_holder uuid;
BEGIN
  IF p_source NOT IN ('auction_comments', 'bat_bids', 'bid_history', 'legacy') THEN
    RAISE EXCEPTION 'record_external_auction_bids: unknown source %', p_source;
  END IF;
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN
    RETURN jsonb_build_object('source', p_source, 'ids', 0, 'candidates', 0, 'inserted', 0, 'merged', 0);
  END IF;

  IF p_source = 'legacy' THEN
    FOR r IN SELECT b.* FROM external_auction_bids b
             WHERE b.id = ANY (p_ids) AND b.platform = 'cars_and_bids' AND b.auction_event_id IS NULL AND b.superseded_by IS NULL
             ORDER BY b.id LOOP
      v_candidates := v_candidates + 1;
      SELECT e.id, e.vehicle_id, e.source_url, e.source_listing_id INTO v_event
      FROM auction_events e
      WHERE e.vehicle_id = r.vehicle_id AND e.source = 'cars_and_bids'
        AND (substring(e.source_url from 'carsandbids\.com/auctions/([A-Za-z0-9]+)')
               = substring(r.raw_data->>'auction_url' from 'carsandbids\.com/auctions/([A-Za-z0-9]+)')
             OR (r.raw_data->>'auction_url' IS NULL
                 AND (SELECT count(*) FROM auction_events x WHERE x.vehicle_id = r.vehicle_id AND x.source = 'cars_and_bids') = 1))
      ORDER BY e.created_at, e.id LIMIT 1;
      IF v_event.id IS NULL THEN v_unresolved := v_unresolved + 1; CONTINUE; END IF;
      SELECT k.id INTO v_holder FROM external_auction_bids k
      WHERE k.auction_event_id = v_event.id AND k.bid_amount = r.bid_amount
        AND k.bidder_username IS NOT DISTINCT FROM r.bidder_username AND k.superseded_by IS NULL;
      IF v_holder IS NOT NULL THEN
        UPDATE external_auction_bids SET superseded_by = v_holder, updated_at = now() WHERE id = r.id;
        UPDATE external_auction_bids SET bid_number = r.bid_number, updated_at = now()
        WHERE id = v_holder AND bid_number IS NULL AND r.bid_number IS NOT NULL;
        v_superseded := v_superseded + 1;
      ELSE
        UPDATE external_auction_bids b SET
          auction_event_id = v_event.id, vehicle_id = v_event.vehicle_id,
          source_url = coalesce(b.source_url, v_event.source_url), source_listing_id = coalesce(b.source_listing_id, v_event.source_listing_id),
          bidder_external_identity_id = coalesce(b.bidder_external_identity_id, (
            SELECT xi.id FROM external_identities xi WHERE xi.platform = 'cars_and_bids' AND xi.handle = b.bidder_username
              AND b.bidder_username <> 'Unknown' AND lower(b.bidder_username) <> 'anonymous')),
          currency = coalesce(b.currency, 'USD'),
          bid_timestamp_basis = CASE WHEN b.bid_timestamp IS NULL THEN NULL ELSE coalesce(b.bid_timestamp_basis, 'unverified') END,
          source_recorded_at = coalesce(b.source_recorded_at, b.created_at), updated_at = now()
        WHERE b.id = r.id;
        v_keyed := v_keyed + 1;
      END IF;
    END LOOP;
    RETURN jsonb_build_object('source', p_source, 'ids', cardinality(p_ids), 'candidates', v_candidates, 'keyed', v_keyed,
      'superseded', v_superseded, 'unresolved', v_unresolved);
  END IF;

  WITH cand AS (
    SELECT c.platform, e.vehicle_id, e.id AS auction_event_id, coalesce(e.source_url, c.source_url) AS source_url,
           e.source_listing_id,
           coalesce(c.source_comment_id, c.bat_comment_id::text, substring(c.content_hash from '^cab_[0-9a-fA-F-]{36}_(.+)$')) AS source_comment_id,
           c.id AS auction_comment_id, NULL::uuid AS bat_bid_id, c.author_username AS bidder_username,
           coalesce(c.external_identity_id, c.author_external_identity_id) AS bidder_external_identity_id,
           c.bid_amount::integer AS bid_amount, external_auction_bid_currency(c.platform, c.comment_text) AS currency,
           c.posted_at AS bid_timestamp, CASE WHEN c.posted_at IS NOT NULL THEN 'source_posted' END AS bid_timestamp_basis,
           NULL::integer AS bid_number, 'auction_comments'::text AS source, c.created_at AS source_recorded_at, NULL::jsonb AS raw_data
    FROM auction_comments c JOIN auction_events e ON e.id = c.auction_event_id
    WHERE p_source = 'auction_comments' AND c.id = ANY (p_ids) AND c.platform IN ('bat', 'cars_and_bids')
      AND c.comment_type = 'bid' AND c.bid_amount > 0 AND c.bid_amount <= 2147483647 AND c.bid_amount = trunc(c.bid_amount)
    UNION ALL
    SELECT 'bat', e.vehicle_id, e.id, e.source_url, e.source_listing_id,
           coalesce(ac.source_comment_id, ac.bat_comment_id::text), ac.id, bb.id, bb.bat_username,
           coalesce(bb.external_identity_id, ac.external_identity_id, (
             SELECT xi.id FROM external_identities xi WHERE xi.platform = 'bat' AND xi.handle = bb.bat_username
               AND bb.bat_username <> 'Unknown' AND lower(bb.bat_username) <> 'anonymous')),
           bb.bid_amount::integer, external_auction_bid_currency('bat', ac.comment_text), bb.bid_timestamp,
           CASE WHEN bb.bid_timestamp IS NULL THEN NULL WHEN bb.source = 'comment' THEN 'source_posted'
                WHEN bb.source = 'bid_history' THEN 'source_bid_list' ELSE 'unverified' END,
           NULL::integer, 'bat_bids', bb.created_at, NULL::jsonb
    FROM bat_bids bb
    LEFT JOIN bat_listings bl ON bl.id = bb.bat_listing_id
    JOIN LATERAL (
      SELECT x.id, x.vehicle_id, x.source_url, x.source_listing_id FROM (
        SELECT e1.id, e1.vehicle_id, e1.source_url, e1.source_listing_id, 0 AS pref FROM auction_events e1 WHERE e1.id = bb.auction_event_id
        UNION ALL
        SELECT e2.id, e2.vehicle_id, e2.source_url, e2.source_listing_id, 1 FROM auction_events e2
        WHERE e2.vehicle_id = bb.vehicle_id AND bl.bat_listing_url IS NOT NULL
          AND lower(substring(e2.source_url, 'bringatrailer\.com/listing/([^/?#]+)'))
              = lower(substring(bl.bat_listing_url, 'bringatrailer\.com/listing/([^/?#]+)'))
      ) x ORDER BY x.pref, x.id LIMIT 1) e ON true
    LEFT JOIN auction_comments ac ON ac.vehicle_id = bb.vehicle_id AND ac.content_hash = bb.metadata->>'comment_content_hash'
    WHERE p_source = 'bat_bids' AND bb.id = ANY (p_ids)
      AND bb.bid_amount > 0 AND bb.bid_amount <= 2147483647 AND bb.bid_amount = trunc(bb.bid_amount)
    UNION ALL
    SELECT 'cars_and_bids', e.vehicle_id, e.id, e.source_url, e.source_listing_id,
           nullif(btrim(h.el->>'id'), ''), NULL::uuid, NULL::uuid, btrim(h.el->>'bidder'),
           (SELECT xi.id FROM external_identities xi WHERE xi.platform = 'cars_and_bids' AND xi.handle = btrim(h.el->>'bidder')
              AND btrim(h.el->>'bidder') <> 'Unknown' AND lower(btrim(h.el->>'bidder')) <> 'anonymous'),
           (h.el->>'amount')::numeric::integer, 'USD', h.ts, CASE WHEN h.ts IS NOT NULL THEN 'source_bid_list' END,
           CASE WHEN (h.el->>'bid_number') ~ '^[0-9]{1,6}$' THEN (h.el->>'bid_number')::integer END,
           'auction_events.bid_history', coalesce(e.scraped_at, e.updated_at, e.created_at), h.el
    FROM auction_events e
    CROSS JOIN LATERAL (
      SELECT el, CASE WHEN el->>'timestamp' ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d' THEN (el->>'timestamp')::timestamptz
                      WHEN el->>'timeAgo' ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d' THEN (el->>'timeAgo')::timestamptz END AS ts
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(e.bid_history) = 'array' THEN e.bid_history ELSE '[]'::jsonb END) AS a(el)
      WHERE jsonb_typeof(el) = 'object') h
    WHERE p_source = 'bid_history' AND e.id = ANY (p_ids) AND e.source = 'cars_and_bids'
      AND (h.el->>'amount') ~ '^[0-9]{1,9}(\.0+)?$' AND (h.el->>'amount')::numeric > 0
      AND nullif(btrim(h.el->>'bidder'), '') IS NOT NULL
  ), pick AS (
    SELECT DISTINCT ON (auction_event_id, bid_amount, bidder_username) * FROM cand
    ORDER BY auction_event_id, bid_amount, bidder_username,
      CASE bid_timestamp_basis WHEN 'source_posted' THEN 1 WHEN 'source_bid_list' THEN 2 WHEN 'unverified' THEN 3 ELSE 4 END,
      bid_timestamp NULLS LAST, auction_comment_id NULLS LAST, bat_bid_id NULLS LAST
  ), up AS (
    INSERT INTO external_auction_bids AS b (platform, vehicle_id, auction_event_id, source_url, source_listing_id,
      source_comment_id, auction_comment_id, bat_bid_id, bidder_username, bidder_external_identity_id, bid_amount,
      currency, bid_timestamp, bid_timestamp_basis, bid_number, source, source_recorded_at, raw_data)
    SELECT platform, vehicle_id, auction_event_id, source_url, source_listing_id, source_comment_id, auction_comment_id,
      bat_bid_id, bidder_username, bidder_external_identity_id, bid_amount, currency, bid_timestamp, bid_timestamp_basis,
      bid_number, source, source_recorded_at, raw_data
    FROM pick
    ON CONFLICT (auction_event_id, bid_amount, bidder_username) WHERE auction_event_id IS NOT NULL AND superseded_by IS NULL
    DO UPDATE SET
      auction_comment_id = coalesce(b.auction_comment_id, excluded.auction_comment_id),
      bat_bid_id = coalesce(b.bat_bid_id, excluded.bat_bid_id),
      source_comment_id = coalesce(b.source_comment_id, excluded.source_comment_id),
      bidder_external_identity_id = coalesce(b.bidder_external_identity_id, excluded.bidder_external_identity_id),
      currency = coalesce(b.currency, excluded.currency),
      bid_number = coalesce(b.bid_number, excluded.bid_number),
      source_url = coalesce(b.source_url, excluded.source_url),
      source_listing_id = coalesce(b.source_listing_id, excluded.source_listing_id),
      bid_timestamp = CASE WHEN (CASE excluded.bid_timestamp_basis WHEN 'source_posted' THEN 1 WHEN 'source_bid_list' THEN 2 WHEN 'unverified' THEN 3 ELSE 4 END)
                              < (CASE b.bid_timestamp_basis WHEN 'source_posted' THEN 1 WHEN 'source_bid_list' THEN 2 WHEN 'unverified' THEN 3 ELSE 4 END)
                           THEN excluded.bid_timestamp ELSE b.bid_timestamp END,
      raw_data = CASE WHEN b.bid_timestamp IS NOT NULL
                       AND (CASE excluded.bid_timestamp_basis WHEN 'source_posted' THEN 1 WHEN 'source_bid_list' THEN 2 WHEN 'unverified' THEN 3 ELSE 4 END)
                         < (CASE b.bid_timestamp_basis WHEN 'source_posted' THEN 1 WHEN 'source_bid_list' THEN 2 WHEN 'unverified' THEN 3 ELSE 4 END)
                      THEN coalesce(b.raw_data, '{}'::jsonb) || jsonb_build_object('replaced_bid_timestamp', b.bid_timestamp,
                             'replaced_bid_timestamp_basis', b.bid_timestamp_basis)
                      ELSE b.raw_data END,
      bid_timestamp_basis = CASE WHEN (CASE excluded.bid_timestamp_basis WHEN 'source_posted' THEN 1 WHEN 'source_bid_list' THEN 2 WHEN 'unverified' THEN 3 ELSE 4 END)
                              < (CASE b.bid_timestamp_basis WHEN 'source_posted' THEN 1 WHEN 'source_bid_list' THEN 2 WHEN 'unverified' THEN 3 ELSE 4 END)
                           THEN excluded.bid_timestamp_basis ELSE b.bid_timestamp_basis END,
      updated_at = now()
    WHERE (b.auction_comment_id IS NULL AND excluded.auction_comment_id IS NOT NULL)
       OR (b.bat_bid_id IS NULL AND excluded.bat_bid_id IS NOT NULL)
       OR (b.source_comment_id IS NULL AND excluded.source_comment_id IS NOT NULL)
       OR (b.bidder_external_identity_id IS NULL AND excluded.bidder_external_identity_id IS NOT NULL)
       OR (b.currency IS NULL AND excluded.currency IS NOT NULL)
       OR (b.bid_number IS NULL AND excluded.bid_number IS NOT NULL)
       OR (CASE excluded.bid_timestamp_basis WHEN 'source_posted' THEN 1 WHEN 'source_bid_list' THEN 2 WHEN 'unverified' THEN 3 ELSE 4 END)
        < (CASE b.bid_timestamp_basis WHEN 'source_posted' THEN 1 WHEN 'source_bid_list' THEN 2 WHEN 'unverified' THEN 3 ELSE 4 END)
    RETURNING (b.xmax = 0) AS inserted
  )
  SELECT (SELECT count(*) FROM cand), count(*) FILTER (WHERE inserted), count(*) FILTER (WHERE NOT inserted)
  INTO v_candidates, v_inserted, v_merged FROM up;

  RETURN jsonb_build_object('source', p_source, 'ids', cardinality(p_ids), 'candidates', v_candidates,
    'inserted', v_inserted, 'merged', v_merged);
END $$;
REVOKE ALL ON FUNCTION public.record_external_auction_bids(text, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_external_auction_bids(text, uuid[]) TO service_role;
COMMENT ON FUNCTION public.record_external_auction_bids(text, uuid[]) IS
'The one writer of external_auction_bids. p_source: auction_comments (comment ids; bat and cars_and_bids comment_type '
'bid rows), bat_bids (bat_bids ids; lot by auction_event_id, else vehicle + BaT lot slug), bid_history (auction_events '
'ids; C&B bid_history JSON), legacy (external_auction_bids ids with no lot key: keyed to their C&B lot, or superseded '
'by the row already holding the bid). Merges on (auction_event_id, bid_amount, bidder_username): fills missing links, '
'never overwrites a filled one, a source-posted bid time replaces a bid-list or unverified one (kept in raw_data). '
'Idempotent: a repeat call changes nothing. Returns counts: ids received, candidates (bids it could key to a lot), '
'inserted, merged.';

-- 5. Every comment bid reaches the record at insert, whichever writer inserted the comment
CREATE OR REPLACE FUNCTION public.external_auction_bids_from_comment_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_ids uuid[];
BEGIN
  SELECT array_agg(n.id) INTO v_ids FROM new_rows n
  WHERE n.comment_type = 'bid' AND n.bid_amount > 0 AND n.auction_event_id IS NOT NULL AND n.platform IN ('bat', 'cars_and_bids');
  IF v_ids IS NOT NULL THEN PERFORM public.record_external_auction_bids('auction_comments', v_ids); END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_external_auction_bids_from_comments ON public.auction_comments;
CREATE TRIGGER trg_external_auction_bids_from_comments AFTER INSERT ON public.auction_comments
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.external_auction_bids_from_comment_insert();

-- a bid comment keyed to its lot later (key_auction_comment_lots) reaches the record then
CREATE OR REPLACE FUNCTION public.external_auction_bids_from_comment_lot_key()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.record_external_auction_bids('auction_comments', ARRAY[NEW.id]);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_external_auction_bids_from_comment_lot_key ON public.auction_comments;
CREATE TRIGGER trg_external_auction_bids_from_comment_lot_key AFTER UPDATE OF auction_event_id ON public.auction_comments
  FOR EACH ROW WHEN (OLD.auction_event_id IS NULL AND NEW.auction_event_id IS NOT NULL AND NEW.comment_type = 'bid'
                     AND NEW.bid_amount > 0 AND NEW.platform IN ('bat', 'cars_and_bids'))
  EXECUTE FUNCTION public.external_auction_bids_from_comment_lot_key();

-- a lot moved to another vehicle (merge_into_primary keeps the lot row and changes its vehicle) carries its bids
CREATE OR REPLACE FUNCTION public.external_auction_bids_follow_lot_vehicle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE external_auction_bids SET vehicle_id = NEW.vehicle_id, updated_at = now()
  WHERE auction_event_id = NEW.id AND vehicle_id IS DISTINCT FROM NEW.vehicle_id;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_external_auction_bids_follow_lot_vehicle ON public.auction_events;
CREATE TRIGGER trg_external_auction_bids_follow_lot_vehicle AFTER UPDATE OF vehicle_id ON public.auction_events
  FOR EACH ROW WHEN (OLD.vehicle_id IS DISTINCT FROM NEW.vehicle_id) EXECUTE FUNCTION public.external_auction_bids_follow_lot_vehicle();

-- rows are superseded, never deleted (extract-cab-bids and its scripts still delete a vehicle's C&B bids before inserting)
CREATE OR REPLACE FUNCTION public.external_auction_bids_refuse_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'external_auction_bids rows are superseded (superseded_by), never deleted or truncated';
END $$;
DROP TRIGGER IF EXISTS trg_external_auction_bids_refuse_delete ON public.external_auction_bids;
CREATE TRIGGER trg_external_auction_bids_refuse_delete BEFORE DELETE OR TRUNCATE ON public.external_auction_bids
  FOR EACH STATEMENT EXECUTE FUNCTION public.external_auction_bids_refuse_delete();

REVOKE ALL ON FUNCTION public.key_cab_auction_comment_on_insert(), public.external_auction_bids_from_comment_insert(),
  public.external_auction_bids_from_comment_lot_key(), public.external_auction_bids_follow_lot_vehicle(),
  public.external_auction_bids_refuse_delete() FROM PUBLIC, anon, authenticated;

-- 6. Descriptions and ownership
COMMENT ON TABLE public.external_auction_bids IS
'The cross-platform bid record: one row per bid per lot, BaT and Cars & Bids alike, origin kept. Current bids: '
'auction_event_id IS NOT NULL AND superseded_by IS NULL (unique on auction_event_id, bid_amount, bidder_username). '
'Written only by record_external_auction_bids, at comment insert by trg_external_auction_bids_from_comments and by its '
'backfill. Event time bid_timestamp (bid_timestamp_basis says what supports it; NULL = unknown), source row recording '
'time source_recorded_at, this row''s ingest time created_at. A handle on two platforms is two bidders here, as in '
'external_identities. bat_bids stays BaT''s own copy. Rows with auction_event_id NULL are legacy rows the writer could '
'not key to a lot. Never deleted (trg_external_auction_bids_refuse_delete).';
COMMENT ON COLUMN public.external_auction_bids.platform IS 'Auction house: bat, cars_and_bids (hagerty for the one legacy email row).';
COMMENT ON COLUMN public.external_auction_bids.auction_event_id IS 'The lot (auction_events.id) the bid was placed on; part of the bid key.';
COMMENT ON COLUMN public.external_auction_bids.vehicle_id IS 'The lot''s vehicle; follows auction_events.vehicle_id on a merge (trg_external_auction_bids_follow_lot_vehicle).';
COMMENT ON COLUMN public.external_auction_bids.source_url IS 'The lot page URL (auction_events.source_url).';
COMMENT ON COLUMN public.external_auction_bids.source_listing_id IS 'The platform''s own lot id (auction_events.source_listing_id) where known.';
COMMENT ON COLUMN public.external_auction_bids.source_comment_id IS 'The platform''s own id of the bid comment: BaT bat_comment_id, C&B comment id.';
COMMENT ON COLUMN public.external_auction_bids.auction_comment_id IS 'The auction_comments row that records this bid; a bid is counted here once, however many comment rows repeat it.';
COMMENT ON COLUMN public.external_auction_bids.bat_bid_id IS 'The bat_bids row of this bid, for BaT lots with a bat_listings row.';
COMMENT ON COLUMN public.external_auction_bids.bidder_username IS 'The bidder''s handle exactly as the platform shows it; part of the bid key.';
COMMENT ON COLUMN public.external_auction_bids.bidder_external_identity_id IS 'external_identities row for (platform, handle), exact; NULL for Unknown/anonymous or unresolved.';
COMMENT ON COLUMN public.external_auction_bids.bid_amount IS 'Amount bid, whole units of currency; part of the bid key.';
COMMENT ON COLUMN public.external_auction_bids.currency IS 'ISO currency of bid_amount, read from the bid text (external_auction_bid_currency); C&B auctions in USD; NULL = unknown.';
COMMENT ON COLUMN public.external_auction_bids.bid_timestamp IS 'When the bid was placed; NULL when no source gives it.';
COMMENT ON COLUMN public.external_auction_bids.bid_timestamp_basis IS 'What supports bid_timestamp: source_posted (the bid comment''s posted time), source_bid_list (a time in the source''s bid list), unverified (a legacy writer''s value of unknown origin).';
COMMENT ON COLUMN public.external_auction_bids.source IS 'What the row was derived from: auction_comments, bat_bids, auction_events.bid_history; or the legacy writer (extract-cab-bids, extract-cab-bids-pw, extract-cab-vehicles-pw, auction_events_backfill, email_webhook).';
COMMENT ON COLUMN public.external_auction_bids.source_recorded_at IS 'When the source row was recorded (its created_at, or the lot''s scrape time for bid_history).';
COMMENT ON COLUMN public.external_auction_bids.created_at IS 'When this row was written (ingest time).';
COMMENT ON COLUMN public.external_auction_bids.superseded_by IS 'Set on a legacy duplicate: the row that holds the same bid. Superseded rows are kept, never counted.';
COMMENT ON COLUMN public.external_auction_bids.raw_data IS 'Source payload: the bid_history element, the legacy writer''s payload, and replaced_bid_timestamp(_basis) when a better-supported time replaced one.';

INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description, do_not_write_directly, write_via)
SELECT 'external_auction_bids', NULL, 'record_external_auction_bids',
  'The cross-platform bid record: one row per bid per lot (BaT, Cars & Bids), keyed (auction_event_id, bid_amount, bidder_username), origin kept.',
  true, 'record_external_auction_bids(source, ids) only: trg_external_auction_bids_from_comments at auction_comments insert; scripts/backfill-external-auction-bids.sh for bat_bids, C&B bid_history and legacy rows.'
WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_registry WHERE table_name = 'external_auction_bids' AND column_name IS NULL);

COMMIT;
-- the C&B reader writes auction_comments.source_comment_id through PostgREST as soon as it deploys
NOTIFY pgrst, 'reload schema';
