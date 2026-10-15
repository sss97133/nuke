-- cars-and-bids-targets-landing: land Cars & Bids lots 1964-1991 from source_targets through extract-cars-and-bids-core.
--
-- Measured 2026-10-15: direct fetch of C&B pages is 403; the last C&B vehicle_event was 2026-03-20; 8,861 sitemap auctions
-- are held as source_targets (discover_targets, 1 credit). One Firecrawl scrape with three click actions (full comment
-- thread, full gallery) costs 1 credit (verified against /v1/team/credit-usage). The shared pool is allocated by the owner's
-- tiers (FIRECRAWL-BUDGET.md): this lane gets 1,500 credits for 1964-1991 lots. Each run claims up to 7 lots (the
-- import_queue unique listing_url is the atomic claim), stops after 1,500 lots tried (max_total) or when the account
-- balance is at or under min_balance 5,200, and on any 402/403/429.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'cars-and-bids-targets-landing';

SELECT cron.schedule(
  'cars-and-bids-targets-landing',
  '*/5 * * * *',
  $job$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/extract-cars-and-bids-core',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(
        get_service_role_key_for_cron(),
        current_setting('app.settings.service_role_key', true),
        current_setting('app.service_role_key', true)
      )
    ),
    body := '{"action": "batch_from_targets", "limit": 7, "delay_ms": 2000, "max_total": 1500, "min_balance": 5200, "year_min": 1964, "year_max": 1991}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
);

COMMIT;
