-- C12: the atlas already folds write_receipts, but the comment log has no sensor.
-- Live 2026-10-02 11:59Z: 177/177 post-C6 comments have identity edges, yet
-- auction_comments has NULL writers_30d / last_write and no receipt trigger.
-- The newest 100 receipts all describe organizations; only three tables have
-- receipts in the atlas. At 12:06Z: 0 comment receipts in 30 days, 0 active
-- comment queries, 0 lock waiters. Reuse record_write_receipt() from 13d780885, verified
-- against its live definition. No new log, logger, schedule, or historical DML.
-- One receipt per nonempty INSERT statement; source/event/ingest times stay intact.
-- Writer is caller-declared (X-Nuke-Writer / app.writer), not authentication;
-- other callers remain 'undeclared'. Existing write guard and grants stay intact.

BEGIN;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';

CREATE TRIGGER trg_write_receipt_ins
AFTER INSERT ON public.auction_comments
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.record_write_receipt();

COMMENT ON TRIGGER trg_write_receipt_ins ON public.auction_comments IS
  'C12: observe nonempty comment INSERT statements through the existing write_receipts ledger and v_schema_atlas. Writer is caller-declared; receipts.at is transaction ingest time. Never changes comment testimony.';
COMMIT;
