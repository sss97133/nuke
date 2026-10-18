-- #1754's CREATE INDEX CONCURRENTLY hit the deploy role's 10 s statement_timeout and left source_targets_slug_key_idx INVALID (indisvalid = false).
-- An invalid index is never used by a query but still costs a write; drop it. The sale_at loads and the by-year matview join on
-- source_target_key(listing_url) by hash join over the source's rows (one pass of at most ~270k), so they do not need it.
SET lock_timeout = '10s';
DROP INDEX IF EXISTS public.source_targets_slug_key_idx;
