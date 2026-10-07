-- 20261008010000_vin_decoded_data_registry_and_policy.sql
--
-- vin_decoded_data: declare its writer and close its anonymous write door. Found by the describe-batch6 lane (PR #811):
-- the policy "Service role manages decoded VINs" (ALL, USING true, WITH CHECK true) names no role, so it applies to every
-- role, and anon and authenticated hold INSERT, UPDATE, DELETE and TRUNCATE on the table (has_table_privilege, 2026-10-07
-- 13:35Z). Anyone with the public anon key could insert, overwrite or delete NHTSA decodes through the REST API. The table
-- has no pipeline_registry row.
--
-- EVIDENCE (read-only, prod, 2026-10-07 13:35Z): 115,872 rows, PRIMARY KEY (vin); RLS on; policies "Anyone can view decoded
-- VINs" (SELECT, public, USING true) and "Service role manages decoded VINs" (ALL, public, USING true, WITH CHECK true);
-- no trigger. Writers in the repo: scripts/mass-vin-decode.ts (115,741 rows on 2026-03-14, NHTSA vPIC batch API through the
-- service role; revived 2026-10-07 for the 91,748 undecoded 17-character VINs, PR #813) and scripts/decode-all-vins.js
-- (131 rows, 2025-12-02/03). Readers: the trigger trg_set_vehicle_canonical_taxonomy on vehicles (body_type, vehicle_type),
-- scripts/backfill-from-vin.ts, backfill-vin-decode.mjs, build-canonical-models.ts, enrich-vehicles.mjs.
--
-- WHAT. 1. ALTER POLICY "Service role manages decoded VINs" ... TO service_role: the write policy keeps its predicate and
-- applies to service_role only; the loaders write through the service role and are unaffected; anon and authenticated keep
-- the SELECT policy (NHTSA decodes are public facts about a VIN) and lose every write path (RLS now has no policy for them on
-- INSERT/UPDATE/DELETE; the table grants are left as they are, as the 2026-09-27 pass did for functions). 2. A
-- pipeline_registry table-level row naming the loader. Both guarded; a re-apply changes nothing.
--
-- CONTRACT. supabase/sql/test_vin_decoded_data_policy.sql (PostgreSQL 17, synthetic rows, CI job metric-fold-health-contract).
-- Reversal: ALTER POLICY "Service role manages decoded VINs" ON public.vin_decoded_data TO PUBLIC;
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'vin_decoded_data'
             AND policyname = 'Service role manages decoded VINs' AND NOT (roles = ARRAY['service_role']::name[])) THEN
    ALTER POLICY "Service role manages decoded VINs" ON public.vin_decoded_data TO service_role;
  END IF;
END $$;

INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description, do_not_write_directly, write_via)
SELECT 'vin_decoded_data', NULL, 'scripts/mass-vin-decode.ts',
       'NHTSA vPIC decode per 17-character VIN (one row per VIN, PRIMARY KEY vin): make, model, year, body, engine, plant, provider, confidence and the raw response. Read by trg_set_vehicle_canonical_taxonomy on vehicles.',
       true,
       'scripts/mass-vin-decode.ts (NHTSA DecodeVINValuesBatch, 50 VINs per request, service-role upsert; 2026-03-14 and 2026-10-07 runs) and scripts/decode-all-vins.js (131 rows, 2025-12). Write policy scoped to service_role since 2026-10-07 (20261008010000); anon and authenticated read only.'
WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_registry WHERE table_name = 'vin_decoded_data' AND column_name IS NULL);

DO $$
DECLARE r name[];
BEGIN
  SELECT roles INTO r FROM pg_policies WHERE schemaname = 'public' AND tablename = 'vin_decoded_data' AND policyname = 'Service role manages decoded VINs';
  IF r IS DISTINCT FROM ARRAY['service_role']::name[] THEN
    RAISE EXCEPTION 'vin_decoded_data write policy still applies to %', r;
  END IF;
  RAISE NOTICE 'vin_decoded_data: write policy service_role only; registry row present';
END $$;

COMMIT;
