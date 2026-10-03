-- Validate comment_claims_progress_comment_id_fkey on public.comment_claims_progress against existing rows (declared NOT VALID in 20261003200000).
-- The deploy runs psql without a transaction, so the timeouts sit inside an explicit one.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '900s';
alter table public.comment_claims_progress validate constraint comment_claims_progress_comment_id_fkey;
commit;
