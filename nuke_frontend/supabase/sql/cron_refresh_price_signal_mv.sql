-- Schedule periodic refresh of the vehicle_price_signal materialized view
-- Requires pg_cron extension (enabled by default on Supabase; this is idempotent)
create extension if not exists pg_cron;

-- Initial refresh (optional if MV was just created)
refresh materialized view concurrently public.vehicle_price_signal_mv;

-- Refresh every 10 minutes
select cron.schedule(
  'refresh_vehicle_price_signal_mv_every_10m',
  '*/10 * * * *',
  $$refresh materialized view concurrently public.vehicle_price_signal_mv$$
);
