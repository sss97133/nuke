-- Revert last_activity_at v1. Restores get_user_garage exactly as backed up, drops triggers/functions/tables/cron.
-- Preferred: select public.revert_last_activity_at_v1();
-- Fallback (if the function was removed): run backup_20261103_get_user_garage_pre_last_activity.sql after the drops below.
select cron.unschedule('vehicle-activity-backfill');
drop trigger if exists z_vehicle_activity_img_ins on public.vehicle_images;
drop trigger if exists z_vehicle_activity_img_upd on public.vehicle_images;
drop trigger if exists z_vehicle_activity_ws on public.work_sessions;
drop trigger if exists z_vehicle_activity_te on public.timeline_events;
drop function if exists public.get_user_garage(uuid);
\i backup_20261103_get_user_garage_pre_last_activity.sql
drop function if exists public.backfill_vehicle_activity(int, int);
drop function if exists public.trg_vehicle_activity_image();
drop function if exists public.trg_vehicle_activity_work_session();
drop function if exists public.trg_vehicle_activity_timeline();
drop function if exists public.compute_vehicle_activity(uuid);
drop function if exists public.vehicle_activity_bump(uuid, text, timestamptz);
drop function if exists public.vehicle_activity_user_ok(uuid, uuid);
drop function if exists public.timeline_event_is_genuine_activity(text, text, text, jsonb, uuid, date);
drop table if exists public.vehicle_activity_backfill_state;
drop table if exists public.vehicle_activity;
drop function if exists public.revert_last_activity_at_v1();
