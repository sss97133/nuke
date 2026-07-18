-- Gallery load timeout fix (2026-06-18).
--
-- VehicleDetailView's photo query:
--   WHERE vehicle_id = X
--     AND ai_processing_status = 'completed'
--     AND taken_at IS NOT NULL
--   ORDER BY taken_at DESC  (paginated)
--
-- MEASURED bottleneck (EXPLAIN): it scanned vehicle_images_taken_date (vehicle_id,
-- taken_at) and applied `Filter: ai_processing_status = 'completed'` on the HEAP.
-- Because fresh uploads are PENDING and sort newest-first by taken_at, the scan had
-- to heap-fetch through every pending photo before finding a page of completed ones
-- — which blew past statement_timeout on vehicles with large/fresh libraries (the
-- in-app "Couldn't load photos"). Got worse right after a big upload, not better.
--
-- Fix: a partial index that excludes pending rows at the index level, so the page
-- comes straight off the index in taken_at order with no heap filter.
--
-- Applied to PROD CONCURRENTLY out-of-band on 2026-06-18 (38.9M-row table — cannot
-- take an AccessExclusive lock during business hours). This statement is idempotent
-- (IF NOT EXISTS) and instant on fresh/small environments.
CREATE INDEX IF NOT EXISTS idx_vehicle_images_vehicle_gallery
ON public.vehicle_images (vehicle_id, taken_at DESC)
WHERE ai_processing_status = 'completed' AND taken_at IS NOT NULL;
