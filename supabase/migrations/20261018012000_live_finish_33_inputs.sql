-- live_finish_33_inputs: what the model 33 writer reads for each live BaT lot it is about to price, in one bounded call.
--
-- Model 33 (where a live lot should finish: model 32's analog read moved by trim, the room, cultural pull, other markets
-- and the same car's history) needs four listing facts and the lot's bid and comment rows up to the moment. The Mac writer
-- (scripts/market/live-finish-33.py, after model 32 in the hourly ag.nuke.market-live-finish run) calls this through
-- PostgREST with the service key for the lots due a new row, 200 at most per call.
-- Returns {"as_of", "lot_columns", "lots", "comment_columns", "comments"}:
--   lots      [vehicle_id, mileage, transmission, vin, image_count, title]
--   comments  [vehicle_id, posted_at, comment_type, author_key, is_seller, has_question, bid_amount, word_count], posted
--             rows only, ordered by lot and time. author_key = md5(lower(author_username)): distinct bidders and commenters
--             survive, no username leaves the database. comment_text is never read (it is TOASTed and not needed).
-- Index path: vehicles by primary key; auction_comments by its unique (vehicle_id, content_hash) index, the only index
-- leading on vehicle_id. Measured 2026-10-15 on prod as a plain SELECT for 100 and 200 live lots: see the PR.
-- plpgsql rather than sql only to refuse a null or oversized list (more than 200 lots) before reading anything.
-- service_role only: the payload holds every comment row of the lots named, which no public reader needs.
-- Contract: supabase/sql/test_live_finish_33_inputs.sql (db-contracts).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.live_finish_33_inputs(p_vehicle_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '10s'
AS $$
BEGIN
  IF p_vehicle_ids IS NULL OR cardinality(p_vehicle_ids) = 0 OR cardinality(p_vehicle_ids) > 200 THEN
    RAISE EXCEPTION 'live_finish_33_inputs reads 1 to 200 lots per call (got %)', coalesce(cardinality(p_vehicle_ids)::text, 'null')
      USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object(
    'as_of', now(),
    'lot_columns', jsonb_build_array('vehicle_id', 'mileage', 'transmission', 'vin', 'image_count', 'title'),
    'lots', coalesce((
      SELECT jsonb_agg(jsonb_build_array(v.id, v.mileage, v.transmission, v.vin, v.image_count, v.title) ORDER BY v.id)
      FROM public.vehicles v
      WHERE v.id = ANY (p_vehicle_ids)), '[]'::jsonb),
    'comment_columns', jsonb_build_array('vehicle_id', 'posted_at', 'comment_type', 'author_key', 'is_seller', 'has_question',
                                         'bid_amount', 'word_count'),
    'comments', coalesce((
      SELECT jsonb_agg(jsonb_build_array(c.vehicle_id, c.posted_at, c.comment_type, md5(lower(c.author_username)), c.is_seller,
                                         c.has_question, c.bid_amount, c.word_count) ORDER BY c.vehicle_id, c.posted_at)
      FROM public.auction_comments c
      WHERE c.vehicle_id = ANY (p_vehicle_ids) AND c.posted_at IS NOT NULL), '[]'::jsonb));
END
$$;

COMMENT ON FUNCTION public.live_finish_33_inputs(uuid[]) IS
  'Model 33 writer inputs for up to 200 named lots: listing facts (mileage, transmission, vin, image_count, title) and '
  'posted bid and comment rows (time, type, md5 author key, seller, question, bid, word count; never names or text). '
  'service_role only. 2026-10-15.';

REVOKE ALL ON FUNCTION public.live_finish_33_inputs(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.live_finish_33_inputs(uuid[]) TO service_role;

COMMIT;
