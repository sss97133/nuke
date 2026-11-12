-- Realtime decodes every change to a published table, subscribed or not.
-- Measured 2026-11-12 11:30Z over 12.6 h since restart (pg_stat_statements): the realtime WAL poll
-- (realtime.list_changes) was 4,658 s, 7.1% of all database time, with 0 rows in realtime.subscription.
-- public.monitored_auctions took 491,915 writes in that window (stream heartbeats rewrite stream_state)
-- and public.vehicle_live_metrics 15,763; the other eight published tables took 1 write between them.
-- No web or iOS code subscribes to either table (postgres_changes tables grepped in nuke_frontend/src
-- and apps), and anon/authenticated hold no privilege on vehicle_live_metrics.
-- Revert: ALTER PUBLICATION supabase_realtime ADD TABLE public.monitored_auctions, public.vehicle_live_metrics;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['monitored_auctions','vehicle_live_metrics'] LOOP
    IF EXISTS (SELECT 1 FROM pg_publication_tables
               WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
