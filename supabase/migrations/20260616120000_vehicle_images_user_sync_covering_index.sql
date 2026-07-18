-- PERF: the profile's two slow RPCs (get_user_sync_status 45s, get_user_contribution_calendar
-- 19s) were timing out → the profile rendered dead. Measured (EXPLAIN ANALYZE, direct conn):
-- both scan the user's ~25K vehicle_images via idx_vehicle_images_user_created, then HEAP-FETCH
-- source/ai_processing_status/vehicle_id/taken_at (not in any index) on cold pages — 7,303 cold
-- page reads = the 45s.
--
-- FIX: a covering index so the scan goes INDEX-ONLY (no heap fetches). After: sync_status
-- 45s→~110ms warm, calendar 19s→1.4s. Built CONCURRENTLY out-of-band (cannot run inside a
-- migration transaction); this is the idempotent record so repo == prod.
--
-- Write-amplification note: this is the 38.9M-row ingestion table — one extra index maintained
-- on every photo write. Accepted (owner green-lit); a single covering btree, not a fan of indexes.
CREATE INDEX IF NOT EXISTS idx_vehicle_images_user_sync
  ON public.vehicle_images (user_id)
  INCLUDE (source, ai_processing_status, vehicle_id, created_at, taken_at);
