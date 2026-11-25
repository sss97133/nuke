-- organization_vehicles_readable_index_v1: partial index (organization_id, status) WHERE vehicle_readable, for step 3's
-- read policy on organization-vehicle links.
--
-- WHY. Step 3 gives anon the read policy USING (vehicle_readable). The storefront's exact count (organization + status
-- 'active') is then an index-only scan of this index instead of a heap visit per link: on a PG17 scale model of the
-- table (895,839 links; the largest organization 21%, 181k active; 94.5% readable), warm, as anon:
--   count, live policy USING (true), idx_org_vehicles_org_status        4.1-4.5 ms  (index only)
--   count, USING (vehicle_readable), no new index                       18.7-21.0 ms (bitmap heap, filter)
--   count, USING (vehicle_readable), this index                         4.2-4.7 ms  (index only, this index)
--   count, one policy (vehicle_readable OR uid-guarded ties), this index 17.3-18.0 ms (cannot use it: the OR does
--     not imply the predicate; so step 3 states anon's policy as vehicle_readable alone)
--   org, 3 statuses, ORDER BY created_at DESC LIMIT 50: 18-20 ms in every variant (37-44 ms with the single OR policy).
-- Prod's live times for the two shapes that timed out under the EXISTS-on-vehicles policy are 133-187 ms and 60-68 ms;
-- neither reads vehicles any more.
-- SIZE. idx_org_vehicles_org_status (same key, about 896k entries) is 10 MB on prod; this one holds the ~94.5% of links on
-- a readable car (1/256 slice, 2026-11-25: 3,336 of 3,530), so about 10 MB. Build: one scan of the 165 MB heap.
-- WHEN. After the backfill job (20261126073000) has recorded done_at: rows still NULL are not in the index, and the
-- backfill's updates stay HOT-eligible while no index names vehicle_readable. The guard refuses otherwise.
-- HOW. Autocommit on purpose (as 20261125150000): CREATE INDEX CONCURRENTLY cannot run in a transaction and blocks no
-- writer. A build that fails leaves an INVALID index; a re-run drops it first. Merge in a quiet window.
-- Revert: DROP INDEX CONCURRENTLY IF EXISTS public.idx_org_vehicles_org_status_readable.
SET lock_timeout = '8s';
SET statement_timeout = '120s';

SELECT EXISTS (SELECT 1 FROM public.platform_config WHERE config_key = 'org_vehicles_readable_backfill_state'
               AND config_value ? 'done_at') AS backfill_done \gset
\if :backfill_done
SELECT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                WHERE c.relname = 'idx_org_vehicles_org_status_readable' AND NOT i.indisvalid) AS readable_invalid \gset
\if :readable_invalid
DROP INDEX CONCURRENTLY IF EXISTS public.idx_org_vehicles_org_status_readable;
\endif

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_org_vehicles_org_status_readable
  ON public.organization_vehicles (organization_id, status)
  WHERE vehicle_readable;

DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                 WHERE c.relname = 'idx_org_vehicles_org_status_readable' AND i.indisvalid
                   AND i.indrelid = 'public.organization_vehicles'::regclass
                   AND pg_get_expr(i.indpred, i.indrelid) = 'vehicle_readable') THEN
    RAISE EXCEPTION 'idx_org_vehicles_org_status_readable is missing, invalid or not as intended';
  END IF;
END $check$;
\else
DO $guard$ BEGIN
  RAISE EXCEPTION 'the vehicle_readable backfill (20261126073000) has not recorded done_at; nothing built';
END $guard$;
\endif
