-- vehicle_events: a partial index on seller_external_identity_id, the key a seller's listings are read by.
--
-- actor_profile_read reads an actor's listings by this key (PR #1099), and the web's external profile reader
-- (getPublicProfileByExternalIdentity) does the same. Without an index every such read scans the whole table:
-- on 2026-10-14 Viva's listings (106 events, 75 listing pages) took 2.7 s against a 470,968-row, 1.5 GB table,
-- inside a read capped at 5 s. Only 36,075 rows carry the key (209 sellers), so the partial index is small.
-- Autocommit is required: supabase-deploy.yml applies with psql -f, each statement outside a transaction block.
-- The concurrent build follows 20261013110000: refuse on lock waiters, idle transactions or another build, and
-- verify the index is valid with the expected definition after it.
SET statement_timeout = '120s';
SET lock_timeout = '10s';

DO $preflight$
DECLARE
  target oid := to_regclass('public.idx_vehicle_events_seller_identity');
  expected constant text := 'CREATE INDEX idx_vehicle_events_seller_identity ON public.vehicle_events USING btree (seller_external_identity_id) WHERE (seller_external_identity_id IS NOT NULL)';
BEGIN
  IF EXISTS (SELECT FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock')
    OR EXISTS (SELECT FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND datname = current_database()
      AND state IN ('idle in transaction', 'idle in transaction (aborted)'))
    OR EXISTS (SELECT FROM pg_stat_progress_create_index WHERE pid <> pg_backend_pid())
  THEN
    RAISE EXCEPTION 'Seller identity index requires an idle DDL lane without lock waiters, idle transactions or active builds';
  END IF;

  IF target IS NOT NULL AND (
    NOT EXISTS (SELECT FROM pg_index WHERE indexrelid = target AND indrelid = 'public.vehicle_events'::regclass
      AND indisvalid AND indisready AND indislive)
    OR pg_get_indexdef(target) IS DISTINCT FROM expected
  ) THEN
    RAISE EXCEPTION 'Seller identity index conflict or invalid state; inspect the existing object before retry: %', pg_get_indexdef(target);
  END IF;
END
$preflight$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicle_events_seller_identity
  ON public.vehicle_events (seller_external_identity_id)
  WHERE seller_external_identity_id IS NOT NULL;

DO $verify$
DECLARE
  target oid := to_regclass('public.idx_vehicle_events_seller_identity');
  expected constant text := 'CREATE INDEX idx_vehicle_events_seller_identity ON public.vehicle_events USING btree (seller_external_identity_id) WHERE (seller_external_identity_id IS NOT NULL)';
BEGIN
  IF target IS NULL OR NOT EXISTS (
    SELECT FROM pg_index WHERE indexrelid = target AND indrelid = 'public.vehicle_events'::regclass
      AND indisvalid AND indisready AND indislive
  ) OR pg_get_indexdef(target) IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'Seller identity index is not ready/valid with the expected definition after build';
  END IF;
  IF EXISTS (SELECT FROM pg_stat_activity WHERE wait_event_type = 'Lock') THEN
    RAISE EXCEPTION 'Lock waiters observed after seller identity index build; stop and inspect';
  END IF;
END
$verify$;

SELECT count(*) AS lock_waiters_after_seller_identity_index FROM pg_stat_activity WHERE wait_event_type = 'Lock';
RESET lock_timeout;
RESET statement_timeout;
