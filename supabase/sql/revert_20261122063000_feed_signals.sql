-- Revert 20261122063000_feed_signals.sql. Drops the signals and their writer.
DROP FUNCTION IF EXISTS public.record_feed_signals(jsonb);
DROP FUNCTION IF EXISTS public.feed_signals_parse(jsonb);
DROP TABLE IF EXISTS public.feed_signals;
