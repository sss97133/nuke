-- Rebuild idx_observations_vehicle_comment_bid, which production holds INVALID, so the comments reads stop running the
-- row policy over every observation of a vehicle.
--
-- Measured 2026-10-14. vehicle_comments_unified (auction_comments UNION ALL user_comments UNION ALL the comment and bid
-- observations of vehicles that have no auction_comments) is read by CommentsPopup, BidsPopup, VehicleComments and
-- useVehicleCommentsUnified. Edge logs, 24 h: the list read 260 calls, mean 1.3 s, max 9.7 s (88 over 1 s); the exact count
-- (HEAD) 133 calls, mean 3.2 s, max 13.1 s (82 over 1 s). pg_stat_statements since 2026-09-29, anon: 659 calls mean 1,299 ms;
-- 288 calls mean 2,367 ms (ordered by observed_at); 389 calls mean 1,004 ms (ordered by source_category, comment_id).
-- EXPLAIN as anon on the Mustang (83f6f033): 958 ms, 12,777 buffer hits, cost 24,281. The observation arm returned 0 rows
-- after running the row policy (a vehicles probe and the observation_is_public regex) on all 3,075 observations of the car.
--
-- Cause: the partial index that serves exactly that arm is INVALID. pg_index on 2026-10-14: indisvalid = false, indisready =
-- true, 39 MB, definition (vehicle_id, observed_at DESC) WHERE kind = ANY (ARRAY['comment','bid']). An interrupted
-- CREATE INDEX CONCURRENTLY left it (no migration ever created it; 20260615210000 cites it as existing). The planner never
-- uses an invalid index, so the arm falls back to idx_observations_vehicle and the policy waits on  kind = ANY (...),  which
-- is not leakproof, so it cannot be an index qual and cannot run ahead of the policy either. A valid partial index changes
-- that: the planner proves its predicate from the arm's own qual and reads only the vehicle's comment and bid rows.
-- Because it is indisready the invalid index is also maintained on every comment and bid insert today: it costs writes
-- and serves no read.
--
-- Steps (the 20261006141000 pattern): if the index is INVALID drop it CONCURRENTLY, build the same definition
-- CONCURRENTLY, assert it is valid and unchanged. A valid index of that name with another definition stops the file.
-- comment and bid observations are about 7% of the 12.2 M rows (pg_stats on kind), so the build writes about 60 MB after
-- reading the 10 GB heap twice. No row, policy, view or function changes; the view and every caller are untouched.
-- Verified on PG17 with the live policies and view text in supabase/sql/test_observations_comment_bid_index.sql.
--
-- Build bounds: lock_timeout covers the wait for older transactions (see 20261006133000: 5 s was too short on this table);
-- both are set for this session only and the deploy's 120 s ceiling is otherwise untouched.
-- No BEGIN: the deploy applies this file with psql -f in autocommit, and CREATE INDEX CONCURRENTLY cannot run in a block.
SET statement_timeout = '900s';
SET lock_timeout = '180s';

SELECT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('public.idx_observations_vehicle_comment_bid') AND NOT indisvalid) AS cb_invalid \gset
\if :cb_invalid
DROP INDEX CONCURRENTLY IF EXISTS public.idx_observations_vehicle_comment_bid;
\endif
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_observations_vehicle_comment_bid
  ON public.vehicle_observations (vehicle_id, observed_at DESC)
  WHERE (kind = ANY (ARRAY['comment'::observation_kind, 'bid'::observation_kind]));

DO $assert$
DECLARE
  def text;
BEGIN
  IF NOT coalesce((SELECT indisvalid AND indisready FROM pg_index WHERE indexrelid = to_regclass('public.idx_observations_vehicle_comment_bid')), false) THEN
    RAISE EXCEPTION 'idx_observations_vehicle_comment_bid is missing or INVALID after the build; DROP INDEX CONCURRENTLY public.idx_observations_vehicle_comment_bid and re-run';
  END IF;
  def := pg_get_indexdef(to_regclass('public.idx_observations_vehicle_comment_bid'));
  IF def NOT LIKE '%(vehicle_id, observed_at DESC) WHERE (kind = ANY (ARRAY[''comment''::observation_kind, ''bid''::observation_kind]))' THEN
    RAISE EXCEPTION 'idx_observations_vehicle_comment_bid exists with another definition: %', def;
  END IF;
END
$assert$;

SET lock_timeout = '5s';
COMMENT ON INDEX public.idx_observations_vehicle_comment_bid IS
'Comment and bid observations by vehicle and time. The arm of vehicle_comments_unified that reads observations, and the per-photo owner-comment lookup in get_user_day_receipt, probe only these rows: under row security the kind test is not leakproof, so without a VALID index the policy ran on every observation of the vehicle (3,075 on the Mustang). Found INVALID 2026-10-14 (an interrupted concurrent build); rebuilt CONCURRENTLY the same day.';
RESET lock_timeout;
RESET statement_timeout;
