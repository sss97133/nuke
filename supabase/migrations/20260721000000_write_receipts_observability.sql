-- write_receipts — the write-observability ledger (2026-07-20, phase 1: OBSERVE).
--
-- The owner's complaint, verbatim: "i shouldnt have to be worried data writes
-- are or arnt happening." Today nothing records what writes the entity tables:
-- 40+ raw write paths, and a write that silently didn't happen is
-- indistinguishable from one that did. This ledger makes every INSERT/UPDATE/
-- DELETE on the hot entity set leave a receipt: which table, which operation,
-- how many rows, which declared writer (or 'undeclared'), which role, which
-- client. The gate pattern from the substrate-stabilization brief, applied to
-- writes themselves: chokepoint (scripts/entity/write.mjs) -> batch (existing
-- backlog) -> gate. This is the gate's SENSOR HALF; enforcement (rejecting
-- undeclared writes) is phase 2, only after a clean observation window proves
-- every legitimate organ declares itself.
--
-- Design constraints honored:
-- - OBSERVE ONLY: the trigger swallows its own errors — the observer must
--   never break a production write (concierge-notify, instagram-feed-sync,
--   bat_listings sync all write on cron).
-- - Statement-level with transition tables: one receipt per statement, not
--   per row — a 357-row weld is one receipt, cost negligible.
-- - Append-only, SECURITY DEFINER insert, no client DML: receipts are
--   testimony about writes; nothing may edit them.
-- - Writers declare via set_config('app.writer','<path>',true) — txn-local,
--   set by scripts/entity/write.mjs and adoptable one line at a time by every
--   other sanctioned path.

CREATE TABLE IF NOT EXISTS write_receipts (
  id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at       timestamptz NOT NULL DEFAULT now(),
  tbl      text NOT NULL,
  op       text NOT NULL,
  rows     integer NOT NULL,
  writer   text NOT NULL,       -- declared path via app.writer GUC, else 'undeclared'
  db_role  text NOT NULL,       -- current_user at write time
  app_name text,                -- application_name (PostgREST / psql / worker)
  txid     bigint NOT NULL
);

COMMENT ON TABLE write_receipts IS
  'Write-observability ledger (phase 1: observe). One row per DML statement on the gated entity tables. Justification: 40+ raw write paths, zero visibility; owner directive 2026-07-20. Phase 2 = enforcement.';

CREATE INDEX IF NOT EXISTS idx_write_receipts_at  ON write_receipts (at DESC);
CREATE INDEX IF NOT EXISTS idx_write_receipts_tbl ON write_receipts (tbl, at DESC);

REVOKE ALL ON write_receipts FROM anon, authenticated;
GRANT SELECT ON write_receipts TO service_role;

-- Writers declare via EITHER channel:
--   SQL clients:       SELECT set_config('app.writer', '<path>', true);  (txn-local)
--   PostgREST clients: X-Nuke-Writer request header (PostgREST exposes headers
--                      as the request.headers GUC inside the transaction)
CREATE OR REPLACE FUNCTION record_write_receipt() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer := 0;
BEGIN
  BEGIN
    IF    TG_OP = 'INSERT' THEN SELECT count(*) INTO n FROM new_rows;
    ELSIF TG_OP = 'UPDATE' THEN SELECT count(*) INTO n FROM new_rows;
    ELSIF TG_OP = 'DELETE' THEN SELECT count(*) INTO n FROM old_rows;
    END IF;
    IF n > 0 THEN
      INSERT INTO write_receipts (tbl, op, rows, writer, db_role, app_name, txid)
      VALUES (
        TG_TABLE_NAME, TG_OP, n,
        COALESCE(
          NULLIF(current_setting('app.writer', true), ''),
          NULLIF(current_setting('request.headers', true)::json->>'x-nuke-writer', ''),
          'undeclared'
        ),
        current_user,
        current_setting('application_name', true),
        txid_current()
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- The observer must never break the write it observes.
    NULL;
  END;
  RETURN NULL;
END $$;

-- Attach to the hot entity set (the tables the L'Officiel/entity work writes).
-- Vehicle-side testimony tables keep their own existing gates; not touched here.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organizations','properties','price_observations',
    'villa_availability_observations','villa_calendar_crawls',
    'concierge_products','publication_features','organization_brands',
    'publication_pages','concierge_partner_connections','org_assets','mag_stories'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_write_receipt_ins ON %I', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_write_receipt_upd ON %I', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_write_receipt_del ON %I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_write_receipt_ins AFTER INSERT ON %I
         REFERENCING NEW TABLE AS new_rows
         FOR EACH STATEMENT EXECUTE FUNCTION record_write_receipt()', t);
    EXECUTE format(
      'CREATE TRIGGER trg_write_receipt_upd AFTER UPDATE ON %I
         REFERENCING NEW TABLE AS new_rows
         FOR EACH STATEMENT EXECUTE FUNCTION record_write_receipt()', t);
    EXECUTE format(
      'CREATE TRIGGER trg_write_receipt_del AFTER DELETE ON %I
         REFERENCING OLD TABLE AS old_rows
         FOR EACH STATEMENT EXECUTE FUNCTION record_write_receipt()', t);
  END LOOP;
END $$;

-- The pulse: what wrote, through what, when — and what went quiet.
CREATE OR REPLACE VIEW v_write_pulse AS
SELECT tbl, writer, db_role, op,
       count(*)  AS statements,
       sum(rows) AS rows,
       max(at)   AS last_at
FROM write_receipts
WHERE at > now() - interval '7 days'
GROUP BY 1, 2, 3, 4;

GRANT SELECT ON v_write_pulse TO service_role;
