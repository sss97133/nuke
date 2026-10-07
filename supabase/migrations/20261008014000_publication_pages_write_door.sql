-- 20261008014000_publication_pages_write_door.sql
--
-- Close the anonymous write door on publication_pages (48,284 L'Officiel magazine pages). Found by the describe-batch7
-- lane (PR #821), verified 2026-10-07 14:21Z: the policies pub_pages_insert (INSERT, WITH CHECK true) and pub_pages_update
-- (UPDATE, USING true, no WITH CHECK) name no role, and anon and authenticated hold the INSERT and UPDATE grants, so anyone
-- with the public key could insert or overwrite any page through the REST API. Three SECURITY INVOKER functions that
-- rewrite publication_pages.spatial_tags across many pages were EXECUTE-granted to anon and authenticated
-- (mag_remediate_coverstar_text(), mag_flag_caption_echoes(), mag_unland_brand_evidence(); the last strips every brand
-- that mag_land_brand_evidence added), and the open update policy let an anonymous call write. The only legitimate
-- writers are the service-role scripts (scripts/stbarth/analyze-publication-pages*.mjs) and the July vision writers
-- recorded in write_receipts; no frontend or edge-function code writes the table or calls the three functions.
--
-- WHAT. 1. ALTER POLICY pub_pages_insert and pub_pages_update ... TO service_role (same predicates; service_role bypasses
-- RLS anyway, so the policies now gate nobody else); pub_pages_read stays for every role (the pages are public magazine
-- content; the masking of names printed on them is a separate owner decision). 2. REVOKE EXECUTE on the three mag_*
-- functions from PUBLIC, anon and authenticated; service_role keeps it (mag_land_brand_evidence was already service_role
-- only). Table grants are left as they are, as the 2026-09-27 pass did. Guarded; a re-apply changes nothing.
--
-- CONTRACT. supabase/sql/test_publication_pages_write_door.sql (PostgreSQL 17, synthetic rows, CI job metric-fold-health-contract).
-- Reversal: ALTER POLICY pub_pages_insert ON public.publication_pages TO PUBLIC; same for pub_pages_update; GRANT EXECUTE on the
-- three functions TO anon, authenticated.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'publication_pages' AND policyname = 'pub_pages_insert'
             AND NOT (roles = ARRAY['service_role']::name[])) THEN
    ALTER POLICY pub_pages_insert ON public.publication_pages TO service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'publication_pages' AND policyname = 'pub_pages_update'
             AND NOT (roles = ARRAY['service_role']::name[])) THEN
    ALTER POLICY pub_pages_update ON public.publication_pages TO service_role;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.mag_remediate_coverstar_text() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mag_flag_caption_echoes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mag_unland_brand_evidence() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mag_remediate_coverstar_text() TO service_role;
GRANT EXECUTE ON FUNCTION public.mag_flag_caption_echoes() TO service_role;
GRANT EXECUTE ON FUNCTION public.mag_unland_brand_evidence() TO service_role;

DO $$
DECLARE r_ins name[]; r_upd name[];
BEGIN
  SELECT roles INTO r_ins FROM pg_policies WHERE tablename = 'publication_pages' AND policyname = 'pub_pages_insert';
  SELECT roles INTO r_upd FROM pg_policies WHERE tablename = 'publication_pages' AND policyname = 'pub_pages_update';
  IF r_ins IS DISTINCT FROM ARRAY['service_role']::name[] OR r_upd IS DISTINCT FROM ARRAY['service_role']::name[] THEN
    RAISE EXCEPTION 'publication_pages write policies still apply to % / %', r_ins, r_upd;
  END IF;
  IF has_function_privilege('anon', 'public.mag_remediate_coverstar_text()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.mag_flag_caption_echoes()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.mag_unland_brand_evidence()', 'EXECUTE') THEN
    RAISE EXCEPTION 'a mag_* rewrite function is still executable by an API role';
  END IF;
  RAISE NOTICE 'publication_pages: write policies service_role only; mag_* rewrites service_role only';
END $$;

COMMIT;
