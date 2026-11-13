-- field_evidence: money-source rows are read only by viewers tied to their vehicle.
--
-- PRIVACY. 20261008018000 hid money-source rows (quickbooks, invoice, email_receipt, receipt, bank_statement,
-- card_statement) and person-name fields from anonymous readers, and kept every row for any signed-in reader on the
-- assumption "signed-in readers (today only the owner)". Any account can sign in, so every signed-in account reads every
-- money row: 155 rows on 2026-11-12 (quickbooks 74, invoice 67, email_receipt 14), all on one vehicle, vendor and date in
-- field_name and the amount in proposed_value.
--
-- WHAT. The SELECT policy "Anyone can view evidence" becomes:
--   a money-source row is readable only through public.vehicle_listing_viewer_tied(vehicle_id) (the service role, or a
--   signed-in viewer who owns, created, uploaded or has access to the vehicle, active admins included, through
--   vehicle_user_has_access);
--   every other row is readable as before: by anyone when its field does not name a person, by any signed-in reader
--   when it does.
-- Anonymous readers see exactly what they saw. SECURITY DEFINER readers and the service role do not pass through this
-- policy and are unchanged. Readers checked 2026-11-12: the vehicle profile's useFieldEvidence.ts and
-- ValueProvenancePopup.tsx (read by vehicle_id; a visitor never saw money rows; an owner still does); no books page
-- reads field_evidence; the books owner is an active admin, so vehicle_user_has_access keeps their rows readable.
-- CONTRACT: supabase/sql/test_field_evidence_anon_read.sql (PostgreSQL 17).
-- Reversal: re-apply 20261008018000's USING clause.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF to_regprocedure('public.vehicle_listing_viewer_tied(uuid)') IS NULL THEN
    RAISE EXCEPTION 'vehicle_listing_viewer_tied(uuid) is missing; this policy reads it';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'field_evidence'
                 AND policyname = 'Anyone can view evidence' AND cmd = 'SELECT' AND qual LIKE '%quickbooks%') THEN
    RAISE EXCEPTION 'field_evidence read policy drifted from 20261008018000; review it';
  END IF;
END $guard$;

ALTER POLICY "Anyone can view evidence" ON public.field_evidence
  USING (
    (coalesce(source_type, '') NOT IN ('quickbooks', 'invoice', 'email_receipt', 'receipt', 'bank_statement', 'card_statement')
     AND ((SELECT auth.role()) = 'authenticated'
          OR coalesce(field_name, '') NOT IN ('seller_name', 'seller_profile_url', 'seller_phone', 'seller_email', 'buyer_name')))
    OR ((SELECT auth.role()) = 'authenticated' AND public.vehicle_listing_viewer_tied(vehicle_id))
  );

DO $check$
DECLARE q text;
BEGIN
  SELECT qual INTO q FROM pg_policies WHERE schemaname = 'public' AND tablename = 'field_evidence'
    AND policyname = 'Anyone can view evidence';
  IF q IS NULL OR q NOT LIKE '%vehicle_listing_viewer_tied%' OR q NOT LIKE '%seller_name%' THEN
    RAISE EXCEPTION 'field_evidence read policy not as intended: %', q;
  END IF;
END $check$;

COMMIT;
