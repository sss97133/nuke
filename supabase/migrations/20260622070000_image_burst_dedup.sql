-- Burst-dedup organ: collapse near-identical frames to one representative.
--
-- The audit (2026-06-22) found phash 0% filled → is_duplicate 0% → the "last of the burst
-- not the best of the set" problem had no fix, and bursts inflated galleries and paid
-- re-analysis. With phash now populated (scripts/backfill-perceptual-hash.py), this flags
-- the redundant frames of a burst as duplicates of the BEST one, by:
--   - same vehicle, both non-superseded, both with a 16-hex phash
--   - perceptual Hamming distance <= p_max_hamming (near-identical pixels)
--   - shot within p_window_seconds of each other (a burst, not two separate visits)
--   - "best" = highest image_hero_score, then larger file, then newer, then id
-- The best frame in each neighborhood has no strictly-better near neighbor, so it is kept;
-- every other frame is flagged is_duplicate=true with duplicate_of -> its best neighbor.
-- Reversible (clear is_duplicate/duplicate_of). NOT a 2x library dedup — bursts only
-- (HD-archive vs capture-relay were shown to be distinct shoots; see Ch.19).

CREATE OR REPLACE FUNCTION public.flag_image_burst_duplicates(
  p_vehicle_id uuid,
  p_max_hamming int DEFAULT 6,
  p_window_seconds int DEFAULT 300
) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE n_flagged int;
BEGIN
  WITH imgs AS (
    SELECT id, phash,
           COALESCE(taken_at, created_at) AS ts,
           COALESCE(file_size,0) AS fsize,
           public.image_hero_score(ai_scan_metadata, file_size) AS hs
    FROM vehicle_images
    WHERE vehicle_id = p_vehicle_id
      AND COALESCE(is_superseded,false) = false
      AND phash IS NOT NULL AND length(phash) = 16
  ),
  pairs AS (   -- a has a strictly-better near neighbor b within the burst window
    SELECT a.id AS a_id, b.id AS b_id, b.hs AS b_hs, b.fsize AS b_fs
    FROM imgs a
    JOIN imgs b ON a.id <> b.id
      AND length(translate(
            (('x'||a.phash)::bit(64) # ('x'||b.phash)::bit(64))::text, '0','')) <= p_max_hamming
      AND abs(extract(epoch FROM (a.ts - b.ts))) <= p_window_seconds
      AND (b.hs, b.fsize, b.id) > (a.hs, a.fsize, a.id)
  ),
  keeper AS (  -- each loser points at its best better-neighbor
    SELECT a_id, b_id FROM (
      SELECT a_id, b_id,
             row_number() OVER (PARTITION BY a_id ORDER BY b_hs DESC, b_fs DESC, b_id DESC) rn
      FROM pairs
    ) r WHERE rn = 1
  )
  UPDATE vehicle_images vi
  SET is_duplicate = true, duplicate_of = k.b_id, updated_at = now()
  FROM keeper k
  WHERE vi.id = k.a_id
    AND (COALESCE(vi.is_duplicate,false) = false OR vi.duplicate_of IS DISTINCT FROM k.b_id);
  GET DIAGNOSTICS n_flagged = ROW_COUNT;

  RETURN jsonb_build_object('vehicle_id', p_vehicle_id, 'flagged_duplicate', n_flagged);
END $$;

COMMENT ON FUNCTION public.flag_image_burst_duplicates(uuid,int,int) IS
  'Flag burst near-duplicates within a vehicle (phash Hamming + time window), keeping the '
  'highest hero-scored frame. Requires phash populated. Reversible. See engineering-manual Ch.19.';
