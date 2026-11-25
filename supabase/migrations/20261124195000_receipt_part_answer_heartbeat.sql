-- The receipt_part_visible answerer's heartbeat, beside the subscription readers', the fact-doubt loop's and the
-- receipt-to-work reconciliation's (20261112120000, 20261122190000, 20261124194300).
--
-- scripts/receipt-work/answer-receipt-parts.mjs now runs on every full fire of com.nuke.subscription-reader, after the
-- reconciliation that raises the questions. It claims pending receipt_part_visible questions (claim_evidence_judgments,
-- highest line amount first), has the subscription CLI read the candidate frames blind (line words and photo zone only; no
-- vendor, price or dates), and answers through answer_evidence_judgment. Before this, the only answers were 158 from one
-- hand session on 2026-11-09/10 (answer_model 'claude-code-cli'); nothing answered a question raised since.
-- This admits the fifth name to record_reader_heartbeat and to the watch assay_subscription_readers (cron
-- subscription-reader-watch, 40 minutes), so a silent or failing answerer shows in v_job_health.
-- Both live bodies are patched at their one reader-name list (anchored, exactly once); nothing else changes.
-- REVERT: the same patch with the name removed. Contract: supabase/sql/test_receipt_part_answer_heartbeat.sql.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $patch$
DECLARE
  d text;
  a1 text := $a$'subscription-frame-classifier', 'fact-doubt-cycle', 'reconcile-receipt-work')$a$;
  r1 text := $a$'subscription-frame-classifier', 'fact-doubt-cycle', 'reconcile-receipt-work', 'answer-receipt-parts')$a$;
  a2 text := $a$'subscription-frame-classifier', 'fact-doubt-cycle', 'reconcile-receipt-work'])$a$;
  r2 text := $a$'subscription-frame-classifier', 'fact-doubt-cycle', 'reconcile-receipt-work', 'answer-receipt-parts'])$a$;
BEGIN
  d := pg_get_functiondef('public.record_reader_heartbeat(text, jsonb, integer)'::regprocedure);
  IF position('answer-receipt-parts' IN d) = 0 THEN
    IF (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1 THEN RAISE EXCEPTION 'record_reader_heartbeat: anchor not found exactly once'; END IF;
    EXECUTE replace(d, a1, r1);
  END IF;
  d := pg_get_functiondef('public.assay_subscription_readers()'::regprocedure);
  IF position('answer-receipt-parts' IN d) = 0 THEN
    IF (length(d) - length(replace(d, a2, ''))) / length(a2) <> 1 THEN RAISE EXCEPTION 'assay_subscription_readers: anchor not found exactly once'; END IF;
    EXECUTE replace(d, a2, r2);
  END IF;
END $patch$;
