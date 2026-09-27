-- BaT settlement, retry: register the drain's source_id (by the endpoint URL), and queue the 400 lots the first sync could not.
-- Session cb179857, 2026-09-27.
--
-- MEASURED: jobs 503/504 enabled 18:21Z; a manual bat-closed-lots-sync run (18:22Z, 8 pages) upserted 400 closed
-- lots into bat_listings but queued 0: import_queue.source_id has a FOREIGN KEY to scrape_sources
-- (import_queue_source_id_fkey), and the fixed id bat-closed-lots-sync 1.1.0 stamps
-- (4d3f0c9e-7a6b-5b21-9c0d-2f5e8a1b6c37) was never registered there — reproduced with one row via PostgREST:
-- 23503 "Key (source_id)=(…) is not present in table scrape_sources". The sync reports the error in its errors[]
-- and does not retry: the 400 lots now count as already known.
--
-- 1. Register the id as its own scrape_sources row (575 rows exist, several loosely named BaT ones; a dedicated
--    row keeps the drain — job 504, process-import-queue filtered on this source_id — scoped to what the
--    settlement sync queues).
-- 20260927083000 (18:24Z) failed on scrape_sources_url_key — the results-page URL is already registered; nothing was
-- written. This file is that one with the sync's own endpoint as the URL (CI applies only newly added files).
-- 2. Queue the 400 lots from the 18:22Z sync (bat_listings rows it created in that minute), same shape as the sync.

SET statement_timeout = '120s';

INSERT INTO public.scrape_sources (id, name, url, source_type, is_active, requires_firecrawl, scrape_config)
VALUES ('4d3f0c9e-7a6b-5b21-9c0d-2f5e8a1b6c37',
        'BaT settlement — closed lots (bat-closed-lots-sync → bat-settlement-drain)',
        'https://bringatrailer.com/wp-json/bringatrailer/1.0/data/listings-filter',   -- what the sync pages (scrape_sources.url is unique)
        'auction', true, false,
        '{"owner": "bat-closed-lots-sync", "drain_job": "bat-settlement-drain", "since": "2026-09-27"}'::jsonb)
ON CONFLICT DO NOTHING;

INSERT INTO public.import_queue (listing_url, source_id, listing_title, listing_price, status, priority, raw_data)
SELECT b.bat_listing_url,
       '4d3f0c9e-7a6b-5b21-9c0d-2f5e8a1b6c37',
       b.bat_listing_title,
       COALESCE(b.sale_price, b.final_bid),
       'pending',
       10,
       jsonb_build_object('source', 'bat-closed-lots-sync:1.1.0 (re-queued 2026-09-27, first run hit the FK)',
                          'listing_status', b.listing_status, 'auction_end_date', b.auction_end_date)
FROM public.bat_listings b
WHERE b.created_at >= '2026-09-27 18:22:00+00' AND b.created_at < '2026-09-27 18:23:00+00'
  AND b.bat_listing_url LIKE 'https://bringatrailer.com/listing/%'
ON CONFLICT (listing_url) DO NOTHING;

RESET statement_timeout;

-- POST-APPLY (read-only): 400 pending rows carry the settlement source_id; job 504 drains 10 per 5 min.
--   SELECT status, count(*) FROM import_queue WHERE source_id = '4d3f0c9e-7a6b-5b21-9c0d-2f5e8a1b6c37' GROUP BY 1;
