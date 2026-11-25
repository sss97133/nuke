-- Disposable PG17: 'paint' is a receipt system key and the book's paint operations point at it
-- (receipt_line_system_paint_v1). Builds on the labor_operations system_key contract, whose PAINT-X row (book system
-- 'paint') stays unkeyed there because no 'paint' key exists. Checks: the key row lands once (re-run safe); PAINT-X
-- becomes paint/book_system; rows already keyed and rows of other systems are untouched; the FK now admits 'paint'.
-- Synthetic rows only.
\set ON_ERROR_STOP on
\ir test_labor_operations_system_key.sql
\ir ../migrations/20261125114500_receipt_line_system_paint.sql
\ir ../migrations/20261125114500_receipt_line_system_paint.sql

DO $$
BEGIN
  IF (SELECT count(*) FROM receipt_line_systems WHERE system_key = 'paint' AND expects_operation) <> 1 THEN
    RAISE EXCEPTION 'paint key row';
  END IF;
  IF (SELECT string_agg(code || '=' || coalesce(system_key, '-') || '/' || coalesce(system_key_basis, '-'), ' ' ORDER BY code)
        FROM labor_operations)
     <> 'INT-NOHOURS=interior/book_system INT-SEATS=interior/book_system MECH-ENGINE-X=engine/line_edges MECH-TIE=-/- PAINT-X=paint/book_system' THEN
    RAISE EXCEPTION 'keyed: %', (SELECT string_agg(code || '=' || coalesce(system_key, '-'), ' ' ORDER BY code) FROM labor_operations);
  END IF;
  -- the CHECK still refuses a key without its basis
  BEGIN
    UPDATE labor_operations SET system_key_basis = NULL WHERE code = 'PAINT-X';
    RAISE EXCEPTION 'basis CHECK did not fire';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
\echo receipt_line_system_paint: ok
