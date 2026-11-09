-- Schema rollback of the lifecycle amendment of 20261111210000_receipt_work_reconciliation (PR #3168 review repair) back to
-- its reading at 74916ea18. Use only after undoing the amendment's producer runs WHILE the amendment is still live:
--   select * from rollback_evidence_judgment_run('<run>', '<reason>', false);
--   select * from rollback_garage_derivation_run('<run>', '<reason>', false);
-- then run this file, then re-apply supabase/migrations/20261111210000_receipt_work_reconciliation.sql as of 74916ea18
-- (git show 74916ea18:supabase/migrations/20261111210000_receipt_work_reconciliation.sql). Added columns stay (additive,
-- ignored by the older code); rows in status 'withdrawn' keep it (the older check is re-added NOT VALID).
SET lock_timeout = '5s';
DROP FUNCTION IF EXISTS public.receipt_work_withdrawals(uuid);
DROP FUNCTION IF EXISTS public.raise_evidence_judgment(jsonb, uuid);
DROP FUNCTION IF EXISTS public.retire_evidence_judgment(uuid, uuid, text, text, uuid);
DROP FUNCTION IF EXISTS public.claim_evidence_judgments(text, text, int, text, int);
DROP FUNCTION IF EXISTS public.answer_evidence_judgment(uuid, text, jsonb, text, text, text);
DROP FUNCTION IF EXISTS public.evidence_judgment_ineligibility(uuid);
DROP FUNCTION IF EXISTS public.evidence_judgment_transition(text, text, uuid, text, text, text);
DROP FUNCTION IF EXISTS public.rollback_evidence_judgment_run(uuid, text, boolean);
DROP FUNCTION IF EXISTS public.receipt_work_lines(uuid, int, int);
DROP FUNCTION IF EXISTS public.receipt_work_frame_eligible(public.vehicle_images);
ALTER TABLE public.evidence_judgment_requests DROP CONSTRAINT IF EXISTS evidence_judgment_requests_retire_kind_check;
ALTER TABLE public.evidence_judgment_requests DROP CONSTRAINT IF EXISTS evidence_judgment_requests_status_check;
ALTER TABLE public.evidence_judgment_requests ADD CONSTRAINT evidence_judgment_requests_status_check
  CHECK (status IN ('pending', 'claimed', 'answered', 'cancelled')) NOT VALID;
