-- Revert of 20261125152500_vehicles_license_plate_anon_revoke.sql: gives anon back the column grant on
-- vehicles.license_plate that production held on 2026-11-24.
SET statement_timeout = '30s';
SET lock_timeout = '5s';
GRANT SELECT (license_plate) ON public.vehicles TO anon;
RESET statement_timeout;
RESET lock_timeout;
