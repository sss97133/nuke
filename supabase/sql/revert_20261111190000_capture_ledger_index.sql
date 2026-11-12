-- Revert of 20261111190000_capture_ledger_index.sql: drops the lean classifier and the covering index, and puts back the
-- 20261111180000 body of get_capture_ledger (reads capture_ledger_frames). capture_ledger_frames keeps its bounded window
-- test (same rows as before). No table and no row is touched; the index holds no testimony.
-- CREATE/DROP INDEX CONCURRENTLY run outside a transaction block (psql autocommit).
SET lock_timeout = '60s';
SET statement_timeout = '600s';

DROP INDEX CONCURRENTLY IF EXISTS public.idx_vehicle_images_capture_ledger;
\echo 'revert: restoring get_capture_ledger to the 20261111180000 body'
\i supabase/migrations/20261111180000_capture_ledger_fast.sql
DROP FUNCTION IF EXISTS public.capture_ledger_states(uuid, text, date, date);
\echo 'revert: capture_ledger_frames keeps the bounded window test (same rows); re-run the frames block of 20261111170000 to restore the original text'
