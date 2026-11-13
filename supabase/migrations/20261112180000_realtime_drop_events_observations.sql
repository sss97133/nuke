-- Remove vehicle_events and vehicle_observations from the supabase_realtime publication.
--
-- realtime.list_changes (Realtime's WAL poll) was the costliest statement on the database after the 2026-11-08 hang:
-- 1,712 s and 33,427 calls between the 21:06Z restart and 2026-11-09 02:33Z, ~400-480 s/h, because every write to these
-- two ingest tables is decoded for Realtime. Their four web subscribers now read on a timer instead (#3146: vehicle
-- profile auction pulse 30 s while a lot is live, /auctions 60 s, analysis stream 30 s, admin image processing 60 s);
-- iOS and edge functions subscribe to neither table. The other ten published tables are unchanged.
-- Revert: ALTER PUBLICATION supabase_realtime ADD TABLE public.vehicle_events, public.vehicle_observations;
SET lock_timeout = '5s';
SET statement_timeout = '30s';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['vehicle_events', 'vehicle_observations'] LOOP
    IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
