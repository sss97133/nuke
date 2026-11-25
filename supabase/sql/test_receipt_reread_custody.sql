-- Disposable PG17 contract for 20261125014500_receipt_source_custody (receipt_source_custody_v1). Runs the re-read
-- worklist contract first (its fixtures, its revert), re-applies 20261124207000, then this migration twice. Asserts the
-- worklist keeps its six columns and rows, and custody_state is in_storage / local_path / pixels_not_in_custody by the
-- rule rows; anon reads the rules, not the worklist; the revert restores the six-column view.
\set ON_ERROR_STOP on
\ir test_receipt_reread_worklist.sql
\ir ../migrations/20261124207000_receipt_reread_worklist.sql
-- receipt 1 back on the list: clear its re-read mark (it is held_unreconciled with no lines)
UPDATE public.receipts SET raw_extraction = raw_extraction - 'reread' - 'reread_history' WHERE id = '00000000-0000-4000-8000-000000000001';
CREATE TEMP TABLE cols_before AS SELECT string_agg(column_name, ',' ORDER BY ordinal_position) c FROM information_schema.columns WHERE table_name = 'receipt_reread_worklist';
\ir ../migrations/20261125014500_receipt_source_custody.sql
\ir ../migrations/20261125014500_receipt_source_custody.sql
DO $$
DECLARE r1 constant uuid := '00000000-0000-4000-8000-000000000001';
BEGIN
  IF (SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_name = 'receipt_reread_worklist')
     <> (SELECT c FROM cols_before) || ',custody_state' THEN RAISE EXCEPTION 'contract failed: columns'; END IF;
  IF (SELECT custody_state FROM public.receipt_reread_worklist WHERE receipt_id = r1) <> 'local_path' THEN
    RAISE EXCEPTION 'contract failed: /Users/x/RECEIPTS is local_path, got %', (SELECT custody_state FROM public.receipt_reread_worklist WHERE receipt_id = r1); END IF;
  UPDATE public.receipts SET raw_extraction = jsonb_set(raw_extraction, '{source_file}', '"/Users/x/Downloads/IMG_1.jpeg"') WHERE id = r1;
  IF (SELECT custody_state FROM public.receipt_reread_worklist WHERE receipt_id = r1) <> 'pixels_not_in_custody' THEN RAISE EXCEPTION 'contract failed: Downloads'; END IF;
  UPDATE public.receipts SET raw_extraction = jsonb_set(raw_extraction, '{source_file}', '"/Users/x/Library/Mobile Documents/com~apple~CloudDocs/IMG_1.jpeg"') WHERE id = r1;
  IF (SELECT custody_state FROM public.receipt_reread_worklist WHERE receipt_id = r1) <> 'pixels_not_in_custody' THEN RAISE EXCEPTION 'contract failed: iCloud Drive'; END IF;
  UPDATE public.receipts SET file_url = 'https://x.supabase.co/storage/v1/object/public/receipts/IMG_1.jpeg' WHERE id = r1;
  IF (SELECT custody_state || ' ' || source_kind FROM public.receipt_reread_worklist WHERE receipt_id = r1) <> 'in_storage storage' THEN RAISE EXCEPTION 'contract failed: landed bytes'; END IF;
  IF has_table_privilege('anon', 'public.receipt_reread_worklist', 'SELECT') OR NOT has_table_privilege('anon', 'public.receipt_source_custody_rules', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.receipt_reread_worklist', 'SELECT') THEN RAISE EXCEPTION 'contract failed: grants'; END IF;
END $$;
\ir revert_20261125014500_receipt_source_custody.sql
DO $$ BEGIN
  IF (SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_name = 'receipt_reread_worklist') <> (SELECT c FROM cols_before)
     OR to_regclass('public.receipt_source_custody_rules') IS NOT NULL OR NOT has_table_privilege('service_role', 'public.receipt_reread_worklist', 'SELECT') THEN
    RAISE EXCEPTION 'contract failed: revert'; END IF;
END $$;
\echo receipt_source_custody: ok
