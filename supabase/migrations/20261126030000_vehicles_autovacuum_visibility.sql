-- vehicles: autovacuum often enough that index-only reads stay index-only.
--
-- MEASURED (prod, 2026-11-25 13:35Z, pg_stat_user_tables + pg_class). 1,491,250 live rows and 136,362 dead. The last
-- autovacuum was 2026-11-23 13:24Z, there have been 5 ever, and the table has no reloptions. relallvisible 219,038 of
-- relpages 308,969 (70.9 percent) for a 2,414 MB heap with 57 indexes (5,054 MB). The defaults (vacuum scale factor 0.2,
-- insert scale factor 0.2) start a run after about 298,000 changes. That is about 4-5 days at the measured rate (136k dead
-- in the 2 days since the last run), so between runs about 29 percent of the heap is not all-visible. hero_heat's per-make
-- read is an index-only scan of idx_vehicles_hero_heat: 119,175 index entries in 3.8 MB, which paid 37,266 heap fetches
-- (31 percent, the stale share) and 35,779 buffers warm, and took over 10 s cold (57014 under the 10 s statement_timeout,
-- 2026-11-25). Every index-only read on vehicles pays the same share.
--
-- WHAT. Storage parameters on public.vehicles only: autovacuum_vacuum_scale_factor 0.02 and
-- autovacuum_vacuum_insert_scale_factor 0.02, a run after about 30,000 changes or inserts, about two a day at the
-- measured rate. These are the values auction_events and nuke_estimates already carry. Each run costs one pass over the
-- 5 GB of indexes plus the pages that changed since the last run. The first run starts within an autovacuum naptime of
-- the deploy, because 136k dead rows exceed the new threshold, so this merges away from lot closes. No data, index,
-- compute, plan or disk setting changes. The parameters are metadata, and ALTER TABLE ... SET (autovacuum_*) takes
-- ShareUpdateExclusiveLock, which waits for no reader or writer.
SET lock_timeout = '5s';
ALTER TABLE public.vehicles SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_vacuum_insert_scale_factor = 0.02
);
RESET lock_timeout;
