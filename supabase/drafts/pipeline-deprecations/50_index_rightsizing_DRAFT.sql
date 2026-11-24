-- DRAFT. NOT APPLIED. Index right-sizing on public.vehicle_images (README section 4).
-- user_id is NULL on 99.95% of 66.2M rows, yet five indexes lead with it and store every NULL (~10.1 GB).
-- Every caller filters user_id = $1 (or IN), which the planner proves implies user_id IS NOT NULL, so a
-- partial index serves the same plans. Run each statement on its own: CONCURRENTLY cannot run in a transaction.
-- Check EXPLAIN on get_user_ingestion_status / capture ledger / contribution calendar before the DROPs.
-- Scan counts since the last stats reset (2026-11-23): user_sync 9,234; user_created 2,472; user_capture_stats 20,680;
-- user_contrib_day 516; user_taken_at 39,969; auto_suggested_vehicle_id 147; condition_score 0; zone_not_null 1.

create index concurrently idx_vehicle_images_user_sync_p on public.vehicle_images using btree (user_id)
  include (source, ai_processing_status, vehicle_id, created_at, taken_at) where user_id is not null;
create index concurrently idx_vehicle_images_user_created_p on public.vehicle_images using btree (user_id, created_at desc) where user_id is not null;
create index concurrently idx_vehicle_images_user_capture_stats_p on public.vehicle_images using btree (user_id, source, created_at, taken_at) where user_id is not null;
create index concurrently idx_vehicle_images_user_contrib_day_p on public.vehicle_images using btree (user_id, coalesce(taken_at, created_at)) where user_id is not null;
create index concurrently idx_vehicle_images_user_taken_at_p on public.vehicle_images using btree (user_id, taken_at) where user_id is not null;
create index concurrently idx_vehicle_images_auto_suggested_vehicle_id_p on public.vehicle_images using btree (auto_suggested_vehicle_id) where auto_suggested_vehicle_id is not null;

-- After plans are confirmed to use the *_p indexes:
drop index concurrently public.idx_vehicle_images_user_sync;             -- 6,322 MB
drop index concurrently public.idx_vehicle_images_user_created;          -- 1,265 MB
drop index concurrently public.idx_vehicle_images_user_capture_stats;    -- 1,018 MB
drop index concurrently public.idx_vehicle_images_user_contrib_day;      --   793 MB
drop index concurrently public.idx_vehicle_images_user_taken_at;         --   730 MB
drop index concurrently public.idx_vehicle_images_auto_suggested_vehicle_id; -- 629 MB
drop index concurrently public.idx_vehicle_images_condition_score;       --     4 MB, 0 scans (retired YONO lane)
drop index concurrently public.idx_vehicle_images_zone_not_null;         --    15 MB, 1 scan
-- Rename the *_p indexes back to the original names if any migration or monitor refers to an index by name.

-- REVERT (original definitions captured 2026-11-23 with pg_get_indexdef):
-- create index concurrently idx_vehicle_images_user_sync on public.vehicle_images using btree (user_id) include (source, ai_processing_status, vehicle_id, created_at, taken_at);
-- create index concurrently idx_vehicle_images_user_created on public.vehicle_images using btree (user_id, created_at desc);
-- create index concurrently idx_vehicle_images_user_capture_stats on public.vehicle_images using btree (user_id, source, created_at, taken_at);
-- create index concurrently idx_vehicle_images_user_contrib_day on public.vehicle_images using btree (user_id, coalesce(taken_at, created_at));
-- create index concurrently idx_vehicle_images_user_taken_at on public.vehicle_images using btree (user_id, taken_at);
-- create index concurrently idx_vehicle_images_auto_suggested_vehicle_id on public.vehicle_images using btree (auto_suggested_vehicle_id);
-- create index concurrently idx_vehicle_images_condition_score on public.vehicle_images using btree (condition_score) where (condition_score is not null);
-- create index concurrently idx_vehicle_images_zone_not_null on public.vehicle_images using btree (id) where (vehicle_zone is not null);
-- then drop the *_p indexes.
