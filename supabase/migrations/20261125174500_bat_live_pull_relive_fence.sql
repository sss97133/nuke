-- bat_live_pull_relive_fence_v1: the re-live step of bat_live_pull_run reads its candidates from monitored_auctions
-- first, so its plan cannot drive from vehicles.
--
-- WHY. bat-live-pull failed every run from 2026-11-25 09:08Z (50 s statement_timeout in the UPDATE monitored_auctions
-- SET is_live=true step). Read-only EXPLAIN of that step's SELECT on 2026-11-25: Parallel Index Scan on
-- idx_vehicles_requires_improvement (btree(requires_improvement) WHERE deleted_at IS NULL), i.e. every live vehicle
-- (reltuples 1,485,904) filtered on origin_metadata->>'source' in the heap, then monitored_auctions by vehicle_id; cost
-- 261,301; the backend waited on DataFileRead. At 08:30Z the same statement drove from monitored_auctions (39.6 ms):
-- the plan flips, the data did not. Candidate set it should walk: source bat 11,728 monitored rows, 9,017 NOT is_live,
-- 13 with auction_end_time in (now - 24 h, now + 15 min].
--
-- WHAT. One predicate added to that SELECT, in place:
--   AND m2.id = ANY (ARRAY(SELECT c.id FROM monitored_auctions c WHERE c.source_id = v_src AND NOT c.is_live
--                          AND <the same end window>))
-- It is implied by the statement's own filters, so the rows chosen are the same; the uncorrelated ARRAY is an InitPlan
-- run once over monitored_auctions, and vehicles is then read by its primary key only. Measured read-only on prod with
-- the predicate: cost 4,808, EXPLAIN ANALYZE 17.5 ms, 4,138 shared buffers, 0 rows. No index is built.
-- The body is checked against the live body's sha256 before it is edited (as 20261021231915 does), and the anchor
-- must occur exactly once.
--
-- REVERT. Remove the predicate (marker bat_live_pull_relive_fence_v1) by the same in-place replace.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $patch$
DECLARE
  sig  text := 'public.bat_live_pull_run(integer,boolean)';
  body text;
  n    int;
  a    text := E'    SELECT m2.id FROM monitored_auctions m2 JOIN vehicles v ON v.id=m2.vehicle_id\n    WHERE m2.source_id=v_src AND NOT m2.is_live\n';
  r    text := E'    SELECT m2.id FROM monitored_auctions m2 JOIN vehicles v ON v.id=m2.vehicle_id\n    WHERE m2.source_id=v_src AND NOT m2.is_live\n'
            || E'      -- bat_live_pull_relive_fence_v1: candidates come from monitored_auctions first; vehicles is read by key.\n'
            || E'      AND m2.id = ANY (ARRAY(SELECT c.id FROM monitored_auctions c\n'
            || E'                              WHERE c.source_id=v_src AND NOT c.is_live\n'
            || E'                                AND c.auction_end_time>v_now-interval ''24 hours''\n'
            || E'                                AND c.auction_end_time<=v_now+interval ''15 minutes''))\n';
BEGIN
  body := pg_get_functiondef(sig::regprocedure);
  IF position('bat_live_pull_relive_fence_v1' IN body) > 0 THEN RETURN; END IF;
  IF encode(sha256(convert_to(body, 'UTF8')), 'base64') <> 'okR58VUumLi/ey0z4KTj7bZ7iP0GDQuVPFTlGCiFdhg=' THEN
    RAISE EXCEPTION 'bat_live_pull_relive_fence: bat_live_pull_run differs from the body read on 2026-11-25; rebase on the live body';
  END IF;
  n := (length(body) - length(replace(body, a, ''))) / length(a);
  IF n <> 1 THEN RAISE EXCEPTION 'bat_live_pull_relive_fence anchor drifted: % matches', n; END IF;
  EXECUTE replace(body, a, r);
END
$patch$;
