-- receipt_source_custody: whether the system holds the pixels of a paper it still has to re-read, as a state per
-- worklist row read from rule rows.
--
-- WHY. Measured 2026-11-25: receipt_reread_worklist holds 30 papers, all source_kind local, and all 30 point under a
-- macOS privacy-gated folder (Downloads, Documents, Desktop, iCloud Drive). No storage copy exists for any of them: 0
-- with the same content_key or file name in storage (file_content_key is null on all 30), created 2026-04-27 to
-- 2026-05-02. A launchd job that opens such a path blocks on a privacy prompt (the 2026-11-25 02:28-03:44Z reader stall),
-- so subscription-document-reader refuses them unattended (#3826). Until now that refusal lived only in the reader's
-- code and summary; the table did not say the pixels are out of the system's custody.
--
-- WHAT.
--   receipt_source_custody_rules (rule rows): custody_state PK, rank (first match wins), source_pattern (a regex
--     over the worklist source), unattended_readable, description. Three rows: in_storage, pixels_not_in_custody,
--     local_path.
--   receipt_reread_worklist gains custody_state (last column; the rest of the view is 20261124207000 unchanged).
-- Gauge: SELECT custody_state, count(*) FROM receipt_reread_worklist GROUP BY 1. Expected on apply:
-- pixels_not_in_custody 30, in_storage 0, local_path 0.
-- A row leaves pixels_not_in_custody only when its bytes land in storage through the intake writer (file_url becomes a
-- storage URL) or the paper is re-read; no job opens the gated path.
-- Contract: supabase/sql/test_receipt_reread_custody.sql (PG17). Revert: supabase/sql/revert_20261125014500_receipt_source_custody.sql.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.receipt_source_custody_rules (
  custody_state text PRIMARY KEY,
  rank int NOT NULL UNIQUE,
  source_pattern text NOT NULL,
  unattended_readable boolean NOT NULL,
  description text NOT NULL
);
INSERT INTO public.receipt_source_custody_rules (custody_state, rank, source_pattern, unattended_readable, description) VALUES
  ('in_storage', 1, '/storage/v1/object/', true, 'the bytes are in Supabase storage; any reader fetches them by URL'),
  ('pixels_not_in_custody', 2, '^/Users/[^/]+/(Downloads|Documents|Desktop|Library/Mobile Documents)/', false,
   'a path under a macOS privacy-gated folder on the owner''s Mac; no scheduled job opens it, and no copy is in storage'),
  ('local_path', 3, '^/', true, 'an absolute path outside the gated folders; the reader opens it with a deadline')
ON CONFLICT (custody_state) DO UPDATE SET rank = EXCLUDED.rank, source_pattern = EXCLUDED.source_pattern,
  unattended_readable = EXCLUDED.unattended_readable, description = EXCLUDED.description;
ALTER TABLE public.receipt_source_custody_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS receipt_source_custody_rules_read ON public.receipt_source_custody_rules;
CREATE POLICY receipt_source_custody_rules_read ON public.receipt_source_custody_rules FOR SELECT USING (true);
REVOKE ALL ON public.receipt_source_custody_rules FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.receipt_source_custody_rules TO anon, authenticated, service_role;

CREATE OR REPLACE VIEW public.receipt_reread_worklist WITH (security_invoker = true) AS
WITH live AS (
  SELECT r.*, o.outcome
    FROM public.receipts r
    JOIN public.receipt_itemisation_outcomes o ON o.receipt_id = r.id
   WHERE o.outcome IN ('no_lines_held', 'held_unreconciled')
     AND r.is_superseded IS NOT TRUE AND r.duplicate_of IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.receipt_items i WHERE i.receipt_id = r.id)
     AND EXISTS (SELECT 1 FROM public.receipt_vehicle_links l WHERE l.receipt_id = r.id AND l.status = 'linked' AND l.retired_at IS NULL)
     AND coalesce(r.raw_extraction #>> '{reread,prompt_version}', '') <> 'document-read-v1'),
listed AS (
SELECT live.id AS receipt_id, coalesce(live.user_id, live.created_by) AS user_id, live.outcome AS reason,
       CASE WHEN live.file_url ~ '/storage/v1/object/' THEN 'storage'
            WHEN coalesce(live.raw_extraction->>'source_file', '') ~ '^/' OR live.file_url ~ '^/' THEN 'local' END AS source_kind,
       CASE WHEN live.file_url ~ '/storage/v1/object/' THEN live.file_url
            WHEN coalesce(live.raw_extraction->>'source_file', '') ~ '^/' THEN live.raw_extraction->>'source_file'
            WHEN live.file_url ~ '^/' THEN live.file_url END AS source,
       live.file_name
  FROM live
 WHERE live.file_url ~ '/storage/v1/object/' OR coalesce(live.raw_extraction->>'source_file', '') ~ '^/' OR live.file_url ~ '^/')
SELECT listed.*,
       -- receipt_source_custody_v1: the first custody rule (by rank) whose pattern the source matches
       (SELECT c.custody_state FROM public.receipt_source_custody_rules c
         WHERE listed.source ~ c.source_pattern ORDER BY c.rank LIMIT 1) AS custody_state
  FROM listed;
REVOKE ALL ON public.receipt_reread_worklist FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.receipt_reread_worklist TO service_role;
COMMENT ON VIEW public.receipt_reread_worklist IS 'Live linked receipts the itemise fold held with no usable lines (no_lines_held, held_unreconciled) whose own paper can be re-read: source_kind storage (URL) or local (absolute path on the owner''s Mac). custody_state (receipt_source_custody_rules) says whether an unattended reader holds the pixels: in_storage, local_path, or pixels_not_in_custody (a privacy-gated folder no scheduled job opens). Taken by subscription-document-reader; a row leaves once receipt_record_reread stores a document-read-v1 reading or the fold itemises it. Service only.';

DO $$ BEGIN RAISE NOTICE 'receipt custody on apply: %', (SELECT jsonb_object_agg(coalesce(custody_state, 'none'), n)
  FROM (SELECT custody_state, count(*) n FROM public.receipt_reread_worklist GROUP BY 1) x); END $$;

COMMIT;
