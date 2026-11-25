-- The receipt-to-work reconciliation's heartbeat, beside the subscription readers' and the fact-doubt loop's
-- (20261112120000, 20261122190000).
--
-- scripts/receipt-work/reconcile-receipt-work.mjs now runs on every full fire of com.nuke.subscription-reader
-- (scripts/photo-pipeline/subscription-reader-batch.sh). For each of the owner's vehicles with linked receipts it re-derives
-- the receipt line x dated photo x work session rows (garage_derivation_evidence, kind receipt_work_correlation) and raises
-- receipt_part_visible questions (evidence_judgment_requests) where a photographed zone after purchase needs a look.
-- Before this, its last runs were by hand on 2026-11-09/10: receipts and photos landed since raised no question
-- (measured 2026-11-24: 0 rows of either kind in 14 days; a dry run finds 615 lines and 194 questions on 26 vehicles).
-- The wrapper posts one heartbeat per step through record_reader_heartbeat; this admits the fourth name, and
-- assay_subscription_readers (cron subscription-reader-watch) raises when it has been silent for 40 minutes, so a run that
-- fails (exit 1 on any vehicle error posts no heartbeat) is seen in v_job_health.
-- Both live bodies are patched at their one reader-name list (anchored, exactly once); nothing else changes.
-- REVERT: the same patch with the name removed. Contract: supabase/sql/test_receipt_work_heartbeat.sql.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $patch$
DECLARE
  d text;
  a1 text := $a$'subscription-frame-classifier', 'fact-doubt-cycle')$a$;
  r1 text := $a$'subscription-frame-classifier', 'fact-doubt-cycle', 'reconcile-receipt-work')$a$;
  a2 text := $a$'subscription-frame-classifier', 'fact-doubt-cycle'])$a$;
  r2 text := $a$'subscription-frame-classifier', 'fact-doubt-cycle', 'reconcile-receipt-work'])$a$;
BEGIN
  d := pg_get_functiondef('public.record_reader_heartbeat(text, jsonb, integer)'::regprocedure);
  IF position('reconcile-receipt-work' IN d) = 0 THEN
    IF (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1 THEN RAISE EXCEPTION 'record_reader_heartbeat: anchor not found exactly once'; END IF;
    EXECUTE replace(d, a1, r1);
  END IF;
  d := pg_get_functiondef('public.assay_subscription_readers()'::regprocedure);
  IF position('reconcile-receipt-work' IN d) = 0 THEN
    IF (length(d) - length(replace(d, a2, ''))) / length(a2) <> 1 THEN RAISE EXCEPTION 'assay_subscription_readers: anchor not found exactly once'; END IF;
    EXECUTE replace(d, a2, r2);
  END IF;
END $patch$;
