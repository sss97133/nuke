-- 20261008005000_retire_enrich_cross_ref_ext_price.sql
--
-- Retire public.enrich_cross_ref_ext_price(integer): a SECURITY DEFINER function with no SET search_path that UPDATEs
-- vehicles.sale_price from external_listings.final_price wherever sale_price is NULL, and whose EXECUTE was granted to
-- PUBLIC, anon, authenticated and service_role (proacl read 2026-10-07 13:02Z: {=X/postgres, anon=X/postgres,
-- authenticated=X/postgres, service_role=X/postgres}). Anyone holding the public anon key could call it at
-- /rest/v1/rpc/enrich_cross_ref_ext_price and write a sale price onto up to p_limit vehicles. Found by the describe-batch6
-- lane while describing external_listings (PR #805).
--
-- WHY RETIRE, NOT KEEP FOR service_role. (1) It writes testimony outside the sanctioned sale writer
-- (correct_vehicle_sale_provenance_batch; AGENTS.md "Row writes"), with no provenance, no receipt and no currency:
-- external_listings stores no currency and carries Bonhams and Blocket prices that are not USD. (2) external_listings is the
-- retired listing table, superseded by vehicle_events (99.0% of a 5% sample present there under the same URL; last row
-- 2026-04-14). (3) Nothing calls it: no cron.job command, no edge function, script, frontend or MCP code on origin/main
-- (git grep, 2026-10-07 13:02Z). The 2026-09-27 RPC write-door pass (20260927170000) did not list it.
--
-- WHAT: REVOKE EXECUTE from every API role including service_role (the owner role keeps it, as for every function) and
-- mark the function RETIRED in its comment, the same treatment as resolve_organization_from_url (20261007160000). The body
-- is left in place so the retirement is reversible by GRANT; the drop is the owner's call with the drop list.
-- A guard fails the apply if anon, authenticated or service_role can still execute it.
-- Reversal: GRANT EXECUTE ON FUNCTION public.enrich_cross_ref_ext_price(integer) TO service_role;
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

REVOKE ALL ON FUNCTION public.enrich_cross_ref_ext_price(integer) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.enrich_cross_ref_ext_price(integer) IS
'RETIRED 2026-10-07 (20261008005000): EXECUTE revoked from PUBLIC, anon, authenticated and service_role. It UPDATEd vehicles.sale_price from external_listings.final_price (no currency, no provenance, no receipt) wherever sale_price was NULL, outside the sanctioned sale writer correct_vehicle_sale_provenance_batch, and anon could call it through the public key (missed by the 2026-09-27 write-door pass). No caller in the repo or cron on 2026-10-07; external_listings is the retired listing table (superseded by vehicle_events). Body kept for reversibility; drop with the owner''s drop list.';

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.enrich_cross_ref_ext_price(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.enrich_cross_ref_ext_price(integer)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.enrich_cross_ref_ext_price(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'enrich_cross_ref_ext_price is still executable by an API role';
  END IF;
  RAISE NOTICE 'enrich_cross_ref_ext_price: retired, no API role can execute it';
END $$;

COMMIT;
