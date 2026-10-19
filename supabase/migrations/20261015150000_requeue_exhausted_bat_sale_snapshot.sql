-- assay_bat_sale_intake reads work.failed > 0 as 'failed', and no writer revives a failed row, so one exhausted
-- capture (intake_http_or_receipt_failed, 3/3 attempts on 2026-10-09) has held job 515's health at 'failed' since.
-- The job itself runs clean (1,402 runs in 24 h, 0 failures). Requeue that one row through the lane's own writer
-- identity; the claim path, retry budget and guard_bat_sale_work trigger apply unchanged. If it fails again it
-- ends 'failed' honestly with a fresh reason.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';
SELECT set_config('app.writer','batch-extract-snapshots:source_sale_qualification',true);
UPDATE public.derivation_queue
SET status='pending', attempts=0, next_attempt_at=now(), error_message=NULL
WHERE id='72fff7e0-b7e9-4e34-bc42-0d6915f849fb'
  AND evidence_type='listing_page_snapshot' AND extractor_slug='bat-archived-sale-v1' AND status='failed';
COMMIT;
