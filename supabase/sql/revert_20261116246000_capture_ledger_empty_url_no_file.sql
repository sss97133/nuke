-- Restore capture_ledger_states / capture_ledger_frames to the live #3439
-- bodies (20261116242000). Definition-only; no row writes.

SET statement_timeout = '30s';
SET lock_timeout = '5s';

\i supabase/sql/helpers/capture_ledger_live_parent_20261116246000.sql
