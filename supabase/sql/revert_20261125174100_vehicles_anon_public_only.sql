-- Revert 20261125174100_vehicles_anon_public_only: drop the restrictive anon policy and the anon role setting.
SET lock_timeout = '3s';
DROP POLICY IF EXISTS vehicles_anon_public_only ON public.vehicles;
ALTER ROLE anon RESET constraint_exclusion;
NOTIFY pgrst, 'reload config';
