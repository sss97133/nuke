-- Revert 20261125014500_receipt_source_custody: the worklist as 20261124207000 defined it, then the rule rows go.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DROP VIEW IF EXISTS public.receipt_reread_worklist;
CREATE OR REPLACE VIEW public.receipt_reread_worklist WITH (security_invoker = true) AS
WITH live AS (
  SELECT r.*, o.outcome
    FROM public.receipts r
    JOIN public.receipt_itemisation_outcomes o ON o.receipt_id = r.id
   WHERE o.outcome IN ('no_lines_held', 'held_unreconciled')
     AND r.is_superseded IS NOT TRUE AND r.duplicate_of IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.receipt_items i WHERE i.receipt_id = r.id)
     AND EXISTS (SELECT 1 FROM public.receipt_vehicle_links l WHERE l.receipt_id = r.id AND l.status = 'linked' AND l.retired_at IS NULL)
     AND coalesce(r.raw_extraction #>> '{reread,prompt_version}', '') <> 'document-read-v1')
SELECT live.id AS receipt_id, coalesce(live.user_id, live.created_by) AS user_id, live.outcome AS reason,
       CASE WHEN live.file_url ~ '/storage/v1/object/' THEN 'storage'
            WHEN coalesce(live.raw_extraction->>'source_file', '') ~ '^/' OR live.file_url ~ '^/' THEN 'local' END AS source_kind,
       CASE WHEN live.file_url ~ '/storage/v1/object/' THEN live.file_url
            WHEN coalesce(live.raw_extraction->>'source_file', '') ~ '^/' THEN live.raw_extraction->>'source_file'
            WHEN live.file_url ~ '^/' THEN live.file_url END AS source,
       live.file_name
  FROM live
 WHERE live.file_url ~ '/storage/v1/object/' OR coalesce(live.raw_extraction->>'source_file', '') ~ '^/' OR live.file_url ~ '^/';
REVOKE ALL ON public.receipt_reread_worklist FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.receipt_reread_worklist TO service_role;
COMMENT ON VIEW public.receipt_reread_worklist IS 'Live linked receipts the itemise fold held with no usable lines (no_lines_held, held_unreconciled) whose own paper can be re-read: source_kind storage (URL) or local (absolute path on the owner''s Mac). Taken by subscription-document-reader; a row leaves once receipt_record_reread stores a document-read-v1 reading or the fold itemises it. Service only.';
DROP TABLE IF EXISTS public.receipt_source_custody_rules;
COMMIT;
