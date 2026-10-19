-- supersede_duplicate_bat_bids: mark the repeat copies of a live BaT bid superseded by the first, never delete.
--
-- WHY (2026-10-15): the live stream admitted one vehicle_observations row of kind 'bid' per transport (public_pusher,
-- missed_comments, direct_html) because the frame body was hashed into source_identifier and content_hash. The BaT comment
-- id (structured_data.public_live_frame.data.comment.id) is the same on every copy. Measured 19:00-21:00Z on 2026-10-15:
-- 8,416 unsuperseded rows for 3,630 (vehicle, comment id) keys in 2 hours. Bid counts, bids per hour and bidder activity
-- read about double. The admission is fixed forward in _shared/batLiveEvents.ts (one key per native comment id).
--
-- supersede_duplicate_bat_bids(from, to, limit, asserted_by): for observations of kind 'bid', extraction_method
-- 'bat_public_live_v1', not superseded, ingested in [from, to), whose vehicle already holds an earlier unsuperseded bid with the
-- same native comment id, set is_superseded = true, superseded_by = the first row (earliest ingested_at, then id),
-- superseded_at = now(). The first row stays live. Bounded: window <= 1 day, <= 500 rows per call, caller statement_timeout
-- 1..60 s, lock_timeout 3 s; rows another transaction holds are skipped (SKIP LOCKED) and counted. Idempotent.
-- Service role only. No row changes in this migration.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.supersede_duplicate_bat_bids(
  p_from timestamptz, p_to timestamptz, p_limit integer DEFAULT 200, p_asserted_by text DEFAULT 'agent')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_writer     CONSTANT text := 'supersede_duplicate_bat_bids';
  v_timeout_ms bigint := (SELECT setting::bigint FROM pg_settings WHERE name = 'statement_timeout');
  v_prev_writer text := current_setting('app.writer', true);
  v_lim        integer := least(greatest(coalesce(p_limit, 200), 1), 500);
  r            record;
  v_keeper     uuid;
  v_seen       integer := 0;
  v_done       integer := 0;
  v_first      integer := 0;
  v_skipped    integer := 0;
  v_last_at    timestamptz;
BEGIN
  IF v_timeout_ms < 1 OR v_timeout_ms > 60000 THEN
    RAISE EXCEPTION '%: caller must set statement_timeout between 1 ms and 60 s (now % ms)', c_writer, v_timeout_ms;
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from OR p_to - p_from > interval '1 day' THEN
    RAISE EXCEPTION '%: a window of at most one day is required', c_writer;
  END IF;
  IF coalesce(btrim(p_asserted_by), '') = '' THEN RAISE EXCEPTION '%: asserted_by is required', c_writer; END IF;
  PERFORM set_config('lock_timeout', '3s', true);
  PERFORM set_config('app.writer', c_writer, true);

  FOR r IN
    SELECT o.id, o.vehicle_id, o.ingested_at, o.structured_data #>> '{public_live_frame,data,comment,id}' AS cid
    FROM vehicle_observations o
    WHERE o.kind = 'bid' AND o.extraction_method = 'bat_public_live_v1' AND NOT o.is_superseded
      AND o.ingested_at >= p_from AND o.ingested_at < p_to
      AND o.structured_data #>> '{public_live_frame,data,comment,id}' IS NOT NULL
    ORDER BY o.ingested_at, o.id
    LIMIT v_lim
  LOOP
    v_seen := v_seen + 1;
    v_last_at := r.ingested_at;
    SELECT k.id INTO v_keeper FROM vehicle_observations k
    WHERE k.vehicle_id = r.vehicle_id AND k.kind = 'bid' AND k.extraction_method = 'bat_public_live_v1'
      AND NOT k.is_superseded AND k.structured_data #>> '{public_live_frame,data,comment,id}' = r.cid
    ORDER BY k.ingested_at, k.id LIMIT 1;
    IF v_keeper IS NULL OR v_keeper = r.id THEN v_first := v_first + 1; CONTINUE; END IF;
    PERFORM 1 FROM vehicle_observations WHERE id = r.id FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN v_skipped := v_skipped + 1; CONTINUE; END IF;
    UPDATE vehicle_observations SET is_superseded = true, superseded_by = v_keeper, superseded_at = now()
    WHERE id = r.id AND NOT is_superseded;
    v_done := v_done + 1;
  END LOOP;
  PERFORM set_config('app.writer', coalesce(v_prev_writer, ''), true);

  RETURN jsonb_build_object('ok', true, 'examined', v_seen, 'superseded', v_done, 'kept_first', v_first,
    'skipped_locked', v_skipped, 'reached_ingested_at', v_last_at, 'more', v_seen = v_lim, 'asserted_by', p_asserted_by);
END;
$function$;

REVOKE ALL ON FUNCTION public.supersede_duplicate_bat_bids(timestamptz, timestamptz, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.supersede_duplicate_bat_bids(timestamptz, timestamptz, integer, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supersede_duplicate_bat_bids(timestamptz, timestamptz, integer, text) TO service_role;
COMMENT ON FUNCTION public.supersede_duplicate_bat_bids(timestamptz, timestamptz, integer, text) IS
  'Marks repeat copies of a live BaT bid (same vehicle, same native comment id, one per transport) is_superseded with superseded_by = the first copy; never deletes. Window <= 1 day, <= 500 rows per call, caller statement_timeout 1..60 s, skips locked rows, idempotent, service role only (2026-10-15).';
COMMIT;
