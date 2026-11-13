-- Restore capture_privacy_from_document_ocr_v1 to absent.
-- Refuses while unreverted rows from this producer remain.
-- Does not drop capture_privacy_promote_log or capture_non_vehicle_log;
-- only drops the columns this migration added, after those rows are reverted.

SET statement_timeout = '30s';
SET lock_timeout = '5s';

DO $do$
BEGIN
  IF to_regclass('public.capture_privacy_promote_log') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.capture_privacy_promote_log
       WHERE reverted_at IS NULL
         AND signature LIKE 'privacy_from_document_ocr_v1 run=%'
     ) THEN
    RAISE EXCEPTION 'capture_privacy_from_document_ocr: unreverted privacy log rows; revert those runs first';
  END IF;
  IF to_regclass('public.capture_non_vehicle_log') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.capture_non_vehicle_log
       WHERE reverted_at IS NULL
         AND signature LIKE 'privacy_from_document_ocr_v1 run=%'
     ) THEN
    RAISE EXCEPTION 'capture_privacy_from_document_ocr: unreverted non_vehicle log rows; revert those runs first';
  END IF;
END
$do$;

DROP FUNCTION IF EXISTS public.capture_privacy_from_document_ocr_v1(uuid, uuid, uuid, boolean, integer);
DROP FUNCTION IF EXISTS public.capture_privacy_from_document_ocr_revert_v1(uuid, uuid);
DROP FUNCTION IF EXISTS public.capture_privacy_from_document_ocr_match_v1(text, text, text, text, text);

ALTER TABLE IF EXISTS public.capture_privacy_promote_log
  DROP COLUMN IF EXISTS rule_id,
  DROP COLUMN IF EXISTS prior_is_sensitive,
  DROP COLUMN IF EXISTS prior_sensitive_type,
  DROP COLUMN IF EXISTS prior_redacted_by,
  DROP COLUMN IF EXISTS prior_redacted_at,
  DROP COLUMN IF EXISTS prior_redaction_reason;
