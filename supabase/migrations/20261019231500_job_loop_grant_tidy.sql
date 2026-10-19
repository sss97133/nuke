-- Grants match intent on the job-loop tables (QUOTE lane RSI pass 7). Every table below is written only by its SECURITY
-- DEFINER Sign or projector (owner postgres) and read through the open readers; the migrations granted service_role
-- SELECT only, but Supabase's default privileges also gave service_role INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER
-- on provider_vouches, contact_requests and contact_messages (live 2026-10-19). Their guard triggers already refuse
-- direct writes; this makes the grants say the same. anon and authenticated keep no table privileges. No function,
-- policy or data changes; tables absent in a fixture are skipped.
-- Contract: supabase/sql/test_job_loop_grant_tidy.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['provider_vouches','contact_requests','contact_messages',
    'work_order_quotes','work_order_quote_acceptances','work_order_quote_release_terms',
    'work_order_completion_attestations','work_order_completion_acceptances',
    'work_order_invoices','work_order_payment_witnesses',
    'work_order_evidence_attachments','work_order_evidence_images',
    'work_order_resource_requirements','work_order_resource_fulfillments',
    'work_order_resource_attestations','work_order_resource_specifications'] LOOP
    CONTINUE WHEN to_regclass('public.'||t) IS NULL;
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM service_role', t);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO service_role', t);
  END LOOP;
END $$;

COMMIT;
