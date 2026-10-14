-- vehicle_events: an index for the organization page's event reads, so LIMIT applies before the vehicle join.
--
-- Measured 2026-10-14. The organization profile (profileStatsService.getOrganizationProfileData) reads
--   vehicle_events.* + vehicle:vehicles(*)  where source_organization_id = $1 and source_platform = 'bat'
--   [and event_status = 'sold']  order by ended_at desc  limit 100 | 50
-- and pg_stat_statements (since 2026-09-29 09:20Z) holds 9 authenticated calls at a mean of 4,614 ms (max 10,414 ms)
-- and 12 at 2,533 ms (max 6,264 ms).
-- EXPLAIN ANALYZE as authenticated for the organization with the most BaT events (3,007 events): 9,512 ms, 12,899
-- blocks read. Existing indexes serve only source_organization_id (idx_vehicle_events_source_org); no index orders by
-- ended_at within an organization. So the planner reads all 3,007 events, runs the lateral vehicles join for every one
-- of them (3,007 loops, each building row_to_json of a 6 KB vehicles row, 12,896 blocks read from disk), and only then
-- sorts and keeps 100.
-- With an index on (source_organization_id, source_platform, ended_at DESC) the events arrive already in the requested
-- order, the limit stops the scan after 100 events, and the join runs 100 times. The same query, shaped that way on
-- production as authenticated: 62 ms (two runs, 61.7 and 61.9 ms) against 3,614 ms for the current shape on the same
-- second look.
--
-- The index is partial on source_organization_id IS NOT NULL: 50,691 of 470,984 events carry an organization (all BaT),
-- so it holds about a ninth of the rows. Equality on source_organization_id implies the predicate, so every query that
-- filters by organization can use it. ORDER BY ended_at DESC means DESC NULLS FIRST, which is what a plain DESC key
-- stores; the existing idx_vehicle_events_ended is DESC NULLS LAST and cannot serve that order.
--
-- Pure addition: one index. No table, policy, row, function or cron change.
-- Build: CONCURRENTLY, so writers keep writing (vehicle_events heap is 223 MB; seconds). lock_timeout covers the wait
-- for older snapshots.
SET statement_timeout = '900s';
SET lock_timeout = '180s';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicle_events_org_platform_ended
  ON public.vehicle_events (source_organization_id, source_platform, ended_at DESC)
  WHERE source_organization_id IS NOT NULL;

-- An interrupted concurrent build leaves an INVALID index that IF NOT EXISTS would then skip.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indexrelid = 'public.idx_vehicle_events_org_platform_ended'::regclass AND NOT i.indisvalid
  ) THEN
    RAISE EXCEPTION 'idx_vehicle_events_org_platform_ended is INVALID; DROP INDEX CONCURRENTLY public.idx_vehicle_events_org_platform_ended and re-run';
  END IF;
END $$;

COMMENT ON INDEX public.idx_vehicle_events_org_platform_ended IS
  'An organization''s events by platform, newest first (ended_at DESC NULLS FIRST, the order of a plain DESC). Partial: only events with a source organization (50,691 of 470,984 on 2026-10-14, all BaT). Serves the organization profile reads of vehicle_events by source_organization_id and source_platform, with or without event_status, ordered by ended_at DESC with a small limit, so the limit applies before the vehicles join (9,512 ms to about 60 ms for the busiest organization, 2026-10-14).';

-- Live verification (after apply), as authenticated, for any organization with BaT events:
--   EXPLAIN (ANALYZE) SELECT ve.*, row_to_json(v1.*)::jsonb FROM vehicle_events ve
--     LEFT JOIN LATERAL (SELECT v.* FROM vehicles v WHERE v.id = ve.vehicle_id LIMIT 1) v1 ON true
--     WHERE ve.source_organization_id = '<org>' AND ve.source_platform = 'bat' ORDER BY ve.ended_at DESC LIMIT 100;
--   -- an Index Scan using idx_vehicle_events_org_platform_ended, the vehicles probe at loops=100, under 200 ms.
