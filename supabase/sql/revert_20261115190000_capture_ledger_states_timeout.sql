-- Restore the 20261115180000 ledger bodies and drop the open-review index.
-- Parent md5: states 1307e6cf833f75cd8258e94db811dfc2, frames 4d1a11f924dbc4e22da93ee6aba02d44.

\i supabase/sql/helpers/capture_ledger_live_parent_20261115190000.sql

DROP INDEX IF EXISTS public.idx_capture_set_review_open_user;
