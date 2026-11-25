-- tag_analysis_view and enhanced_tag_context run as the caller (security_invoker), so they obey the row policies of
-- the tables they read instead of their owner's.
--
-- The defect (2026-11-25, read-only). Both views are owned by postgres and have no security_invoker, so a read through
-- them runs with the owner's rights and skips row-level security on image_tags, timeline_events, vehicle_images and
-- receipts. anon holds SELECT on both: each answers anon with all 3,263 image_tags rows, 274 of them on private or
-- deleted cars. image_tags has had row policies since #3917 (merged 2026-11-25 02:06 PT): as anon the table now answers
-- 2,989 rows and each view still answers 3,263, the 274 the table withholds included. enhanced_tag_context also LEFT JOINs receipts (vendor_name AS receipt_vendor, total_amount AS
-- receipt_amount) and timeline_events (title, labor_hours), whose own policies give anon no receipt and no private-source
-- event.
--
-- The fix: ALTER VIEW ... SET (security_invoker = true). No column, grant or owner changes. Through either view a
-- caller now reads exactly the rows the base tables' policies give that caller; a receipt or event the caller may not
-- read joins as NULL.
--
-- Consumers (grep of nuke_frontend, apps, supabase/functions, scripts, 2026-11-25): none. The names appear only in
-- docs (dictionary, an archived fix) and in scripts/guardrails/pii-columns.json for a third view. anon already holds the
-- privileges an invoker read needs: SELECT on image_tags, timeline_events and receipts, and column SELECT on
-- vehicle_images id, image_url and taken_at.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER VIEW public.tag_analysis_view SET (security_invoker = true);
ALTER VIEW public.enhanced_tag_context SET (security_invoker = true);

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class
              WHERE oid IN ('public.tag_analysis_view'::regclass, 'public.enhanced_tag_context'::regclass)
                AND NOT coalesce('security_invoker=true' = ANY (reloptions), false)) THEN
    RAISE EXCEPTION 'tag views are not security_invoker';
  END IF;
END
$verify$;

COMMIT;

-- Live verification (after apply), as anon, counts only:
--   tag_analysis_view?select=id with Prefer count=exact  == image_tags?select=id   (3,263 -> 2,989 as of 2026-11-25)
--   enhanced_tag_context?select=id&receipt_amount=not.is.null  -> 0
