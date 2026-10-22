-- Schedule extract-bat-seller-location (PR #2486). One job, every 3 minutes, mode 'auto':
--   while the backlog is not drained -> one batch of 500 snapshots by id cursor (bat_seller_location_progress);
--   once drained -> at most one 'recent' pass per ~20h over snapshots fetched since the last pass (i.e. daily).
-- Auth mirrors existing jobs: Bearer get_service_role_key_for_cron() (Vault cron secret key), url from get_service_url().
-- Bound: one function call per 3 min; each reads <=500 snapshots and writes only bat_seller_locations (additive).
-- Revert: select cron.unschedule('bat-seller-location'); drop table bat_seller_location_progress.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
create table if not exists public.bat_seller_location_progress (
  id int primary key default 1 check (id = 1), last_id uuid, drained boolean not null default false,
  batches int not null default 0, recent_since timestamptz, last_recent_at timestamptz, updated_at timestamptz not null default now());
alter table public.bat_seller_location_progress enable row level security;
insert into public.bat_seller_location_progress(id) values (1) on conflict do nothing;
DO $u$ BEGIN PERFORM cron.unschedule('bat-seller-location'); EXCEPTION WHEN OTHERS THEN NULL; END $u$;
SELECT cron.schedule(
  'bat-seller-location',
  '*/3 * * * *',
  $cmd$
  SELECT net.http_post(
    url := get_service_url() || '/functions/v1/extract-bat-seller-location',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || get_service_role_key_for_cron()
    ),
    body := jsonb_build_object('mode', 'auto', 'limit', 500, 'run_id', 'bat-loc-cron'),
    timeout_milliseconds := 140000
  );
  $cmd$
);
DO $check$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bat-seller-location' AND active AND schedule = '*/3 * * * *') THEN
    RAISE EXCEPTION 'bat-seller-location cron not scheduled';
  END IF;
END $check$;
COMMIT;
