-- 20261008018000_field_evidence_anon_read_private_sources.sql
--
-- PRIVACY. The read policy "Anyone can view evidence" on field_evidence (SELECT, every role, USING true) exposes every row to
-- anyone with the public key, including rows that are not public market facts: 155 spend rows of one vehicle from
-- source types quickbooks (74), invoice (67) and email_receipt (14), where the vendor and date sit in field_name and the
-- dollar amount in proposed_value (some vendors are private individuals), and 2,963 fb_marketplace_listing rows on 491
-- vehicles whose field_name seller_name carries a Facebook seller's profile name. Found by the describe-batch10 lane
-- (counts under SET LOCAL ROLE anon, 2026-10-07 16:2xZ; verified 16:27Z). Private data (contact details, invoices,
-- amounts) lives only in the database and is masked there (privacy is a masking spectrum).
--
-- WHAT (interim rule until the owner's masking design): anonymous readers no longer see rows from money sources
-- (quickbooks, invoice, email_receipt, receipt, bank_statement, card_statement) nor rows whose field_name names a person
-- (seller_name, seller_profile_url, seller_phone, seller_email, buyer_name); signed-in readers (today only the owner)
-- keep every row. Listing-derived facts (bat, mecum, cars_and_bids, craigslist ... 4.4M rows) stay public, so the vehicle
-- profile's evidence popups (useFieldEvidence.ts, ValueProvenancePopup.tsx) keep working for visitors.
-- Guarded; a re-apply changes nothing. CONTRACT: supabase/sql/test_field_evidence_anon_read.sql (PostgreSQL 17).
-- Reversal: ALTER POLICY "Anyone can view evidence" ON public.field_evidence USING (true);
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'field_evidence'
             AND policyname = 'Anyone can view evidence' AND coalesce(qual, '') NOT LIKE '%quickbooks%') THEN
    ALTER POLICY "Anyone can view evidence" ON public.field_evidence
      USING (auth.role() = 'authenticated'
             OR (coalesce(source_type, '') NOT IN ('quickbooks', 'invoice', 'email_receipt', 'receipt', 'bank_statement', 'card_statement')
                 AND coalesce(field_name, '') NOT IN ('seller_name', 'seller_profile_url', 'seller_phone', 'seller_email', 'buyer_name')));
  END IF;
END $$;

DO $$
DECLARE q text;
BEGIN
  SELECT qual INTO q FROM pg_policies WHERE schemaname = 'public' AND tablename = 'field_evidence' AND policyname = 'Anyone can view evidence';
  IF q IS NULL OR q NOT LIKE '%quickbooks%' OR q NOT LIKE '%seller_name%' THEN
    RAISE EXCEPTION 'field_evidence read policy still exposes private rows: %', q;
  END IF;
  RAISE NOTICE 'field_evidence: anon no longer reads money-source rows or person-name fields';
END $$;

COMMIT;
