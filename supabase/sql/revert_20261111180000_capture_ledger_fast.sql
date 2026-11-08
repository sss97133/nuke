-- Revert of 20261111180000: the per-day-subquery body of get_capture_ledger from 20261111170000 (it cancels at 10 s on the
-- owner's window; only revert both together, with revert_20261111170000_capture_ledger.sql, which drops the function).
\echo 'revert: re-run the get_capture_ledger block of supabase/migrations/20261111170000_capture_ledger.sql, or revert both ledger migrations together'
