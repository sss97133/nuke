-- A bid comment that moves to another lot row takes its bid with it (follow-up to 20261018234500).
--
-- Found 2026-10-18 04:5xZ in the first production backfill: scripts/cab-api-sync.mjs created a second C&B lot row for an
-- auction a vehicle already held under a differently slugged URL (…/2023-dodge-challenger-r-t-plus vs …-rt-plus) and its
-- comment upsert re-pointed the 82 comments to it. trg_external_auction_bids_from_comment_lot_key fired only for a
-- comment's first lot, so 59 C&B bid rows stayed on the emptied lot; recording the new lot's comments again would have
-- counted those bids twice. Now any change of a bid comment's lot runs record_external_auction_bids('comment_lot_moves'):
-- the comment's current bid row moves to the new lot, or is superseded (superseded_by) by the row that lot already holds
-- for the same bid, and the comment is then recorded as before. The same source repairs rows moved before this.
BEGIN;
SET LOCAL lock_timeout = '4s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.record_external_auction_bids(p_source text, p_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_candidates integer := 0; v_inserted integer := 0; v_merged integer := 0;
  v_keyed integer := 0; v_superseded integer := 0; v_unresolved integer := 0;
  v_moved integer := 0; v_source text := p_source;
  r record; v_event record; v_holder uuid;
BEGIN
  IF p_source NOT IN ('auction_comments', 'bat_bids', 'bid_history', 'legacy', 'comment_lot_moves') THEN
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

  IF p_source = 'comment_lot_moves' THEN
    -- A bid comment re-pointed to another lot row (a writer re-keying the lot, e.g. a second lot row for the same
    -- auction): its current bid row moves with it, or is superseded by the row the new lot already holds for that bid.
    FOR r IN SELECT b.id, b.bid_amount, b.bidder_username, e.id AS event_id, e.vehicle_id, e.source_url, e.source_listing_id
             FROM auction_comments c
             JOIN external_auction_bids b ON b.auction_comment_id = c.id AND b.superseded_by IS NULL
               AND b.auction_event_id IS DISTINCT FROM c.auction_event_id
             JOIN auction_events e ON e.id = c.auction_event_id
             WHERE c.id = ANY (p_ids)
             ORDER BY b.id LOOP
      SELECT k.id INTO v_holder FROM external_auction_bids k
      WHERE k.auction_event_id = r.event_id AND k.bid_amount = r.bid_amount
        AND k.bidder_username IS NOT DISTINCT FROM r.bidder_username AND k.superseded_by IS NULL;
      IF v_holder IS NOT NULL THEN
        UPDATE external_auction_bids SET superseded_by = v_holder, updated_at = now() WHERE id = r.id;
        v_superseded := v_superseded + 1;
      ELSE
        UPDATE external_auction_bids SET auction_event_id = r.event_id, vehicle_id = r.vehicle_id, source_url = r.source_url,
          source_listing_id = coalesce(r.source_listing_id, source_listing_id), updated_at = now()
        WHERE id = r.id;
        v_moved := v_moved + 1;
      END IF;
    END LOOP;
    v_source := 'auction_comments';
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
    WHERE v_source = 'auction_comments' AND c.id = ANY (p_ids) AND c.platform IN ('bat', 'cars_and_bids')
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
    WHERE v_source = 'bat_bids' AND bb.id = ANY (p_ids)
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
    WHERE v_source = 'bid_history' AND e.id = ANY (p_ids) AND e.source = 'cars_and_bids'
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

  IF p_source = 'comment_lot_moves' THEN
    RETURN jsonb_build_object('source', p_source, 'ids', cardinality(p_ids), 'moved', v_moved, 'superseded', v_superseded,
      'candidates', v_candidates, 'inserted', v_inserted, 'merged', v_merged);
  END IF;
  RETURN jsonb_build_object('source', p_source, 'ids', cardinality(p_ids), 'candidates', v_candidates,
    'inserted', v_inserted, 'merged', v_merged);
END $$;

REVOKE ALL ON FUNCTION public.record_external_auction_bids(text, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_external_auction_bids(text, uuid[]) TO service_role;
COMMENT ON FUNCTION public.record_external_auction_bids(text, uuid[]) IS
'The one writer of external_auction_bids. p_source: auction_comments (comment ids; bat and cars_and_bids comment_type '
'bid rows), bat_bids (bat_bids ids; lot by auction_event_id, else vehicle + BaT lot slug), bid_history (auction_events '
'ids; C&B bid_history JSON), legacy (external_auction_bids ids with no lot key: keyed to their C&B lot, or superseded '
'by the row already holding the bid), comment_lot_moves (comment ids whose lot changed: the current bid row follows '
'the comment or is superseded by the new lot''s row, then the comments are recorded). Merges on (auction_event_id, '
'bid_amount, bidder_username): fills missing links, never overwrites a filled one, a source-posted bid time replaces a '
'bid-list or unverified one (kept in raw_data). Idempotent: a repeat call changes nothing. Returns counts: ids '
'received, candidates (bids it could key to a lot), inserted, merged (and moved/superseded for comment_lot_moves).';

CREATE OR REPLACE FUNCTION public.external_auction_bids_from_comment_lot_key()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.record_external_auction_bids(
    CASE WHEN OLD.auction_event_id IS NULL THEN 'auction_comments' ELSE 'comment_lot_moves' END, ARRAY[NEW.id]);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_external_auction_bids_from_comment_lot_key ON public.auction_comments;
CREATE TRIGGER trg_external_auction_bids_from_comment_lot_key AFTER UPDATE OF auction_event_id ON public.auction_comments
  FOR EACH ROW WHEN (OLD.auction_event_id IS DISTINCT FROM NEW.auction_event_id AND NEW.auction_event_id IS NOT NULL
                     AND NEW.comment_type = 'bid' AND NEW.bid_amount > 0 AND NEW.platform IN ('bat', 'cars_and_bids'))
  EXECUTE FUNCTION public.external_auction_bids_from_comment_lot_key();

COMMENT ON COLUMN public.external_auction_bids.superseded_by IS
'Set on a duplicate: a legacy copy of a bid another row holds, or a bid row whose comment moved to a lot row that already '
'holds the bid. Points at the row that holds it. Superseded rows are kept, never counted.';

COMMIT;
