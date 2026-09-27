-- timeline_events: a machine-written event does not re-grade the vehicle by itself.
-- Session cb179857 / bat-to-db, 2026-09-27.
--
-- WHY (measured 19:50Z on the reader's phase timings): trg_regrade_on_timeline runs
-- persist_vehicle_grade() → compute_vehicle_grade() for EVERY timeline_events row. The BaT reader writes
-- two per lot (the auction result and the mileage reading), and the gallery insert already grades once
-- per lot through trg_regrade_on_image (statement-level since 44ba0248e). compute_vehicle_grade() on a
-- freshly written lot measured 4.4 s under the day's load (it reads timeline_events ×4, vehicle_images
-- ×3, ownership_transfers ×2, service_records, field_evidence, external_listings, bat_listings — all by
-- vehicle_id, all indexed); three calls per lot is ~10 s of the 10–20 s a lot costs, and the tail
-- (description_timeline 99–116 s on the slowest calls, three 150 s gateway timeouts in 200 calls) sits
-- in that phase.
--
-- WHAT CHANGES: the trigger keeps firing for events people write (source_type NULL or anything but
-- 'system'); rows the extractors stamp source_type='system' (extract-bat-core's auction / mileage
-- events) no longer re-grade — the lot's grade is computed once, from the gallery statement, after
-- every row of the lot has landed. Function unchanged.
--
-- SCHEMA_LAW: §4 no data touched (a WHEN clause); §7 CI-applied. Verify: pg_get_triggerdef shows the
-- WHEN; a reader call's description_timeline phase drops by ~2 × compute_vehicle_grade.

-- One transaction, lock_timeout 10 s (lead): no window without the trigger; a blocked DDL fails fast.
SET lock_timeout = '10s';
BEGIN;
DROP TRIGGER IF EXISTS trg_regrade_on_timeline ON public.timeline_events;
CREATE TRIGGER trg_regrade_on_timeline
  AFTER INSERT ON public.timeline_events
  FOR EACH ROW
  WHEN (NEW.source_type IS DISTINCT FROM 'system')
  EXECUTE FUNCTION public.trigger_regrade_vehicle();
COMMIT;
RESET lock_timeout;

COMMENT ON TRIGGER trg_regrade_on_timeline ON public.timeline_events IS
  'Re-grade the vehicle when a person records an event. Machine-written events (source_type=''system'': the BaT reader''s auction result and mileage reading) do not — the lot''s gallery statement already grades it once (2026-09-27).';
