-- Lock 3 of the data locks (P3.4 of the approved lock-down plan, 2026-09-27):
-- nobody but the owner can DELETE or TRUNCATE testimony.
--
-- The rule is .claude/rules/agent-trust-invariants.md: testimony is never deleted, only superseded.
-- Until today it was a rule for agents; the grants below make it a rule the database refuses to break.
-- Binds anon, authenticated and service_role (every edge function and every script that uses the service
-- key). The owner (postgres) keeps every privilege; the DDL tripwire (lock 4) records a GRANT that undoes
-- this. This is a lock against everything except the owner credentials.
--
-- MEASURED (prod, read-only, 2026-09-27 ~17:10Z, session cb179857) — grants before this file:
--   anon, authenticated, service_role held DELETE and TRUNCATE on vehicle_observations (10.1M rows),
--   vehicle_events (411K), auction_comments (14.8M), vehicle_timeline, merge_proposals, merge_deleted_rows,
--   comment_discoveries, description_discoveries; service_role alone on vehicle_images (43.0M; anon and
--   authenticated had already lost DELETE) and observation_discoveries (anon/authenticated: SELECT only).
--   Not present in prod, so not listed: vehicle_aliases, merge_audit (the rules file says "when it lands";
--   the migration that lands them must carry the same REVOKE).
--
-- WHAT STOPS WORKING — checked in deployed code and cron.job, named so nothing breaks silently:
--   * merge_into_primary(uuid, uuid) is SECURITY INVOKER and DELETEs from vehicle_observations,
--     auction_comments, bat_listings, comment_discoveries, description_discoveries after copying each row
--     into merge_deleted_rows. Its one deployed caller, dedup-vehicles, runs it over a direct postgres
--     connection (postgres.js `sql` template, DATABASE_URL) → owner privileges → unaffected. The scripts
--     generate-merge-proposals.mjs, data-quality-cleanup.mjs and data-quality-cleanup-phase4.mjs call it
--     with the service key → they now fail at the first DELETE. They are dormant (no cron, no workflow);
--     when a merge is needed it runs as the owner, with an approved merge_proposals row (rule 3).
--   * tr_delete_timeline_event_image (AFTER DELETE ON timeline_events → DELETE FROM vehicle_images as the
--     invoker): a service_role delete of an image_upload timeline event now fails; authenticated already
--     failed (no DELETE on vehicle_images before today). No deployed function deletes timeline_events.
--   * Six dormant edge functions DELETE vehicle_images before re-importing a listing's photos:
--     import-pcarmarket-listing:1061, extract-gooding:833, extract-broad-arrow:867,
--     trickle-backfill-images:236, extract-cars-and-bids-core:920, extract-hagerty-listing:1009.
--     None is on an active cron (371, 451, 452 are inactive) or a workflow; each fails at that step when
--     next invoked. The fix is supersession: vehicle_images already has is_superseded / superseded_by.
--   * Active cron jobs (12): none deletes from these tables (417 field_extraction_log and 480 app_events
--     are the only DELETEs). process-account-deletions v14 bans the auth user and never touches testimony.
--   * Frontend deletes as authenticated (ImageLightbox.tsx:612, imageUploadService.ts:744,
--     duplicateDetectionService.ts:248, vehicleDeduplicationService.ts:211 — all vehicle_images) were
--     already refused before today; unchanged.
--
-- SCHEMA_LAW §5 (invariant at the data layer) and §7 (CI-applied; undo = GRANT DELETE, TRUNCATE ... TO
-- <role>, which the tripwire records). db-safety: catalog-only; no rows written, no long locks.

SET statement_timeout = '120s';
SET lock_timeout = '10s';

REVOKE DELETE, TRUNCATE ON TABLE
  public.vehicle_observations,
  public.vehicle_events,
  public.vehicle_images,
  public.auction_comments,
  public.vehicle_timeline,
  public.merge_proposals,
  public.merge_deleted_rows,
  public.observation_discoveries,
  public.comment_discoveries,
  public.description_discoveries
FROM PUBLIC, anon, authenticated, service_role;

-- ─── Live verification (run after apply) ─────────────────────────────────────────────────────────
-- SELECT table_name, grantee, string_agg(privilege_type, ',' ORDER BY privilege_type)
--   FROM information_schema.role_table_grants
--  WHERE table_schema = 'public' AND grantee IN ('anon','authenticated','service_role')
--    AND table_name IN ('vehicle_observations','vehicle_events','vehicle_images','auction_comments','vehicle_timeline',
--        'merge_proposals','merge_deleted_rows','observation_discoveries','comment_discoveries','description_discoveries')
--  GROUP BY 1, 2 ORDER BY 1, 2;
--   -> no DELETE, no TRUNCATE in any row.
-- Attack test (rolled back): BEGIN; SET LOCAL ROLE service_role;
--   DELETE FROM vehicle_observations WHERE id = <any>;   -- ERROR 42501 permission denied for table vehicle_observations
--   ROLLBACK;
