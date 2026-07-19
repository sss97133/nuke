-- concierge-partner-sync — the scheduler the partner-inventory organ never got.
--
-- The concierge-partner edge fn has had a working Shopify sync driver since
-- 2026-07-01, but nothing called it: the 4 boutique connections last synced
-- 2026-07-02 (the day they were hand-fired) and went stale for 17 days.
-- One cron per organ: hourly tick, gated on each connection's own
-- next_sync_at (sync_interval_minutes is per-connection, 1440 for all four
-- today). An hourly gate avoids the fixed-time drift trap where a daily cron
-- fires seconds before next_sync_at and the connection slips to every other
-- day. Only shopify rows are due-able — it is the only channel with a sync
-- driver (the fn 422s the rest; instagram has its own organ, jobid 494).
-- status IN (connected, error) lets a failed sync self-heal on the next tick.

SELECT cron.unschedule('concierge-partner-sync')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'concierge-partner-sync');

SELECT cron.schedule(
  'concierge-partner-sync',
  '23 * * * *',
  $cron$
  SELECT net.http_post(
    url := get_service_url() || '/functions/v1/concierge-partner',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || get_service_role_key_for_cron()),
    body := jsonb_build_object('action','sync','connection_id', c.id),
    timeout_milliseconds := 150000
  )
  FROM concierge_partner_connections c
  WHERE c.channel = 'shopify'
    AND c.status IN ('connected','error')
    AND coalesce(c.endpoint,'') <> ''
    AND (c.next_sync_at IS NULL OR c.next_sync_at <= now());
  $cron$
);
