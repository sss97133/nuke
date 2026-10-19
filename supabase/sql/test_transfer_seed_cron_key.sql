-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_transfer_seed -f this-file.sql
-- Proves the auction-close transfer seeders' key. With the live definitions, a lot that becomes sold (and the backfill)
-- call transfer-automator with the secrets-table key; after the migration they send what get_service_role_key_for_cron()
-- returns. The rest is unchanged: unsold lots and app.seed_transfers = 'off' send nothing, the body is the same, both
-- run as their owner, and the migration applies twice. net.http_post is a stub that records each call; every value
-- below is a disposable test string, never a key.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.auction_events') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;

-- Production's shapes, the columns the seeders touch.
CREATE TABLE public._app_secrets (key text PRIMARY KEY, value text);
CREATE TABLE public.auction_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid,
  outcome text, auction_end_date timestamptz DEFAULT now());
CREATE TABLE public.ownership_transfers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), trigger_id uuid, trigger_table text);
CREATE SCHEMA net;
CREATE TABLE net.calls (n bigserial PRIMARY KEY, url text, headers jsonb, body jsonb);
CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}', params jsonb DEFAULT '{}',
  headers jsonb DEFAULT '{}', timeout_milliseconds integer DEFAULT 5000) RETURNS bigint LANGUAGE sql AS
$$ INSERT INTO net.calls (url, headers, body) VALUES (url, headers, body) RETURNING n $$;
-- The key reader as a stub: the contract is that the seeders send whatever it returns.
CREATE FUNCTION public.get_service_role_key_for_cron() RETURNS text LANGUAGE sql AS $$ SELECT 'test-reader-key-00000001' $$;

\ir helpers/transfer_seed_callers_live_20261014.sql
CREATE TRIGGER trg_auto_create_transfer_on_auction_close AFTER INSERT OR UPDATE OF outcome ON public.auction_events
  FOR EACH ROW EXECUTE FUNCTION public.auto_create_transfer_on_auction_close();

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
CREATE FUNCTION public.t_last_auth() RETURNS text LANGUAGE sql AS
$$ SELECT headers->>'Authorization' FROM net.calls ORDER BY n DESC LIMIT 1 $$;

INSERT INTO public._app_secrets (key, value) VALUES ('service_role_key', 'test-table-key-000000001');
INSERT INTO public.auction_events (id, outcome) VALUES
  ('10000000-0000-0000-0000-000000000001', 'live'), ('10000000-0000-0000-0000-000000000002', 'live'),
  ('10000000-0000-0000-0000-000000000003', 'live'), ('10000000-0000-0000-0000-000000000004', 'live');

-- 1. Before: the secrets-table key.
UPDATE public.auction_events SET outcome = 'sold' WHERE id = '10000000-0000-0000-0000-000000000001';
SELECT public.t_assert(public.t_last_auth() = 'Bearer test-table-key-000000001', 'before: the trigger sends the secrets-table key');
SELECT public.t_assert((SELECT count(*) FROM net.calls) = 1, 'before: one call for one sold lot');

-- 2. The change.
\ir ../migrations/20261014060000_transfer_seed_sends_cron_key.sql

-- 3. After: the reader's key, everything else as before.
UPDATE public.auction_events SET outcome = 'sold' WHERE id = '10000000-0000-0000-0000-000000000002';
SELECT public.t_assert(public.t_last_auth() = 'Bearer test-reader-key-00000001', 'after: the trigger sends the key reader''s key');
SELECT public.t_assert((SELECT url FROM net.calls ORDER BY n DESC LIMIT 1)
  = 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/transfer-automator', 'after: same function');
SELECT public.t_assert((SELECT body FROM net.calls ORDER BY n DESC LIMIT 1)
  = jsonb_build_object('action', 'seed_from_auction', 'auction_event_id', '10000000-0000-0000-0000-000000000002'), 'after: same body');
UPDATE public.auction_events SET outcome = 'unsold' WHERE id = '10000000-0000-0000-0000-000000000003';
SELECT public.t_assert((SELECT count(*) FROM net.calls) = 2, 'an unsold lot sends nothing');
BEGIN;
SET LOCAL app.seed_transfers = 'off';
UPDATE public.auction_events SET outcome = 'sold' WHERE id = '10000000-0000-0000-0000-000000000003';
COMMIT;
SELECT public.t_assert((SELECT count(*) FROM net.calls) = 2, 'app.seed_transfers off sends nothing');
SELECT public.t_assert((public.backfill_transfers_for_sold_auctions(10)->>'queued')::int = 3, 'the backfill queues the three sold lots without a transfer');
SELECT public.t_assert((SELECT count(*) FROM net.calls WHERE n > 2 AND headers->>'Authorization' = 'Bearer test-reader-key-00000001') = 3,
  'the backfill sends the key reader''s key');
SELECT public.t_assert((SELECT bool_and(prosecdef) FROM pg_proc WHERE oid IN ('public.auto_create_transfer_on_auction_close()'::regprocedure,
  'public.backfill_transfers_for_sold_auctions(integer)'::regprocedure)), 'both still run as their owner');

-- 4. Applied a second time (a re-run of the deploy), the guard accepts its own bodies.
\ir ../migrations/20261014060000_transfer_seed_sends_cron_key.sql
UPDATE public.auction_events SET outcome = 'sold' WHERE id = '10000000-0000-0000-0000-000000000004';
SELECT public.t_assert(public.t_last_auth() = 'Bearer test-reader-key-00000001', 'after a second apply the trigger still sends the reader''s key');

SELECT 'transfer seed cron key contract: PASS' AS result;
