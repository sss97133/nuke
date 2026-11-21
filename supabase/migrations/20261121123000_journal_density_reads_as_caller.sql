-- vw_journal_density reads as its caller.
--
-- The journal's day index is read by /api/journal, which has no session and reads with the publishable key. With
-- security_invoker the view's photo, receipt and payment counts and its top vehicle come only from rows the caller
-- may read: a caller without owner rights reads what a logged-out visitor reads, and a service-key caller reads what
-- it read before. Columns, meaning and grants are unchanged.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

ALTER VIEW public.vw_journal_density SET (security_invoker = true);

COMMENT ON VIEW public.vw_journal_density IS
  'The public journal''s day index for the last 90 days: gate-approved photos documented by a user (one (user_id, taken_at) index probe per profile), excluding listing imports, by the day they were taken; receipts; completed payments; the vehicle with the most photos. Counts only; no money. Reads as its caller (security_invoker): each count holds only rows the caller may read. Read by nuke_frontend/api/journal/index.ts with the publishable key.';

COMMIT;
