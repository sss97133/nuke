BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

-- The Accounting screen learns about another reviewer's correction by polling financial_documents every 5 seconds.
-- Publish the table so the screen receives each admitted run as it lands (useAccountingRevision subscribes with
-- owner_id=eq.<book>); polling stays as its fallback and heartbeat. Realtime evaluates the existing owner and
-- delegate SELECT policies per subscriber, so this adds no access. Rows are small (owner book 2026-10-23: p95 2.7 KB,
-- max 6 KB) and originals are never deleted (custody guard), so no replica identity change is needed.
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='financial_documents') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.financial_documents;
  END IF;
END $$;

COMMIT;
