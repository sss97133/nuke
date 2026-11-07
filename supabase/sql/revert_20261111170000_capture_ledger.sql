-- Revert of 20261111170000_capture_ledger.sql: drops the ledger readers, the phone's skip writer, the re-scan request
-- writers and the two tables they own. capture_skips and capture_rescan_requests hold no testimony (the phone's gate
-- decisions and re-scan asks); vehicle_images, capture_set_links and the review rows are untouched by this file.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DROP FUNCTION IF EXISTS public.get_capture_ledger_day(date, text);
DROP FUNCTION IF EXISTS public.get_capture_ledger(text, date, date, integer);
DROP FUNCTION IF EXISTS public.capture_ledger_frames(uuid, text, date, date);
DROP FUNCTION IF EXISTS public.finish_capture_rescan(uuid, jsonb);
DROP FUNCTION IF EXISTS public.claim_capture_rescan(text);
DROP FUNCTION IF EXISTS public.request_capture_rescan(date, text);
DROP FUNCTION IF EXISTS public.report_capture_skips(jsonb);
DROP TABLE IF EXISTS public.capture_rescan_requests;
DROP TABLE IF EXISTS public.capture_skips;
