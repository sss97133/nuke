-- Revert for the DRAFT 001_feed_signals.sql.
DROP FUNCTION IF EXISTS public.record_feed_signals(jsonb);
DROP TABLE IF EXISTS public.feed_signals;
