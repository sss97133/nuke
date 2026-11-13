# last_activity_at v1 — APPLIED 2026-11-03 ~21:50 PT (authorized by skylar)

Files: `20261104001000_last_activity_at_v1.sql` (parts A-E, as applied), `20261104001000_last_activity_at_v1_revert.sql`,
`backup_20261103_get_user_garage_pre_last_activity.sql` (+ DB table `public.backup_20261103_get_user_garage_fn`).
Revert: `select public.revert_last_activity_at_v1();`

## What it is
`public.vehicle_activity(vehicle_id, last_activity_at, last_photo_taken_at, last_work_session_at, last_event_at, computed_at)` — side table
(not a column on vehicles, so the `vehicles_update_timestamp` trigger / audit triggers never fire and `vehicles.updated_at` is never touched).
last_activity_at = greatest of:
1. EXIF `vehicle_images.taken_at` (<= now) of photos filed to the vehicle by owner / uploader / active non-previously_owned permission / contributor / current ownership / approved title verification; excludes superseded, duplicate, gate `rejected_*`, match_status mismatch/unrelated; images without EXIF taken_at never count.
2. `work_sessions` end_time (else start_time, else session_date noon PT) for sessions by those people; excludes unconfirmed `derived`/`capture_derived` sessions.
3. `timeline_events.event_date` (noon PT, capped at now) by those people; excludes event_type pending_analysis/photo_session/batch_image_upload, merged_from_vehicle_id rows, and source/data_source/metadata matching owner_request|profile_fix|merge|backfill|repoint|recompute|migration.
Triggers (`z_vehicle_activity_*`) on vehicle_images (insert; update of vehicle_id/taken_at/gate/superseded/duplicate/match), work_sessions, timeline_events call a monotonic bump (never lowers; never raises beyond the real EXIF/event time, so refiling/merging an old photo cannot make a car look fresh). Triggers swallow all errors. `compute_vehicle_activity(uuid)` = exact recompute/repair for one vehicle.
Backfill: pg_cron job `vehicle-activity-backfill` (every minute, 6s budget, self-unschedules when done). Phase 0 = all vehicles with a relationship row, phase 1 = vehicles with a user_id/owner_id/uploaded_by. Vehicles with no human relationship cannot have eligible activity and correctly have no row.

## get_user_garage
Return type gained `last_activity_at timestamptz` (appended last). ORDER BY: relationship group (unchanged) then `last_activity_at DESC NULLS LAST, year`. ACL unchanged (postgres, authenticated, service_role).

## Not changed
`vehicles.updated_at` semantics, `vehicle_event_summary`, any frontend code.
