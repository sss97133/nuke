-- REVERT of 20261126071500_organization_vehicles_vehicle_readable.sql: drops both triggers, both functions and the
-- organization_vehicles.vehicle_readable column (a derived value; the triggers and the backfill job recompute it).
-- DROP COLUMN is RESTRICT: if a policy or view already reads vehicle_readable (step 3), this fails, and step 3 is
-- reverted first. Apply only through a migration that copies it.
BEGIN;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';
DROP TRIGGER IF EXISTS trg_vehicles_relay_readable_to_org_links ON public.vehicles;
DROP TRIGGER IF EXISTS trg_organization_vehicles_vehicle_readable ON public.organization_vehicles;
DROP FUNCTION IF EXISTS public.vehicles_relay_readable_to_org_links();
DROP FUNCTION IF EXISTS public.organization_vehicles_stamp_vehicle_readable();
ALTER TABLE public.organization_vehicles DROP COLUMN IF EXISTS vehicle_readable RESTRICT;
COMMIT;
