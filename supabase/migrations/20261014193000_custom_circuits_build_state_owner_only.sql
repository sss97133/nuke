-- vehicle_custom_circuits: build-state writes become owner-only.
--
-- Measured 2026-10-14 (read-only): policy "Build state workflow write" (UPDATE, roles anon and authenticated, USING true,
-- WITH CHECK true) plus a column grant UPDATE (build_state) to anon and authenticated let anyone holding the public key
-- set build_state on any of the table's 2,469 rows (528 live, all on the K5), with no history kept. Anonymous sign-in is
-- on for the project, so "authenticated" includes anyone. The grant came from 2026-06-11 for the connector inspector's
-- BUILD skin (nuke_frontend/src/components/wiring/connector-inspector/useBuildState.ts), the only writer in the app; the
-- builder share page reads build state and sends verdicts through ingest-observation. Every row is still 'uncut': the
-- path has never been used. anon and authenticated also held table-level INSERT and DELETE and column-level INSERT on
-- every column (row security blocked them; the grants were left over).
--
-- After this migration:
--   - UPDATE of build_state on a live row, by a signed-in, non-anonymous user who owns the vehicle (vehicles.user_id or
--     owner_id). The BUILD skin keeps working for the owner; anyone else's write returns no row and the skin reverts it.
--   - anon and authenticated: SELECT on the table, UPDATE (build_state) for authenticated only, nothing else.
-- A builder's write without an account (a share link) needs a share credential: the owner's call, not made here.
BEGIN;
SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='2s';

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.vehicle_custom_circuits'::regclass AND polname = 'Build state workflow write') THEN
    RAISE EXCEPTION 'policy "Build state workflow write" is not where this migration expects it';
  END IF;
END $guard$;

DROP POLICY "Build state workflow write" ON public.vehicle_custom_circuits;
CREATE POLICY "Owner build state write" ON public.vehicle_custom_circuits FOR UPDATE TO authenticated
USING (
  NOT coalesce(is_superseded, false)
  AND coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
  AND EXISTS (SELECT 1 FROM public.vehicle_wiring_overlays o JOIN public.vehicles v ON v.id = o.vehicle_id
              WHERE o.id = vehicle_custom_circuits.overlay_id AND (v.user_id = auth.uid() OR v.owner_id = auth.uid())))
WITH CHECK (
  NOT coalesce(is_superseded, false)
  AND coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
  AND EXISTS (SELECT 1 FROM public.vehicle_wiring_overlays o JOIN public.vehicles v ON v.id = o.vehicle_id
              WHERE o.id = vehicle_custom_circuits.overlay_id AND (v.user_id = auth.uid() OR v.owner_id = auth.uid())));
COMMENT ON POLICY "Owner build state write" ON public.vehicle_custom_circuits IS 'The vehicle''s owner (signed in, not an anonymous sign-in) may advance build_state on live rows; the column grant limits the write to build_state. Replaced the open anon write of 2026-06-11 on 2026-10-14.';

-- Revoking at table level also revokes the column privileges; then grant back what readers and the owner need.
REVOKE ALL ON public.vehicle_custom_circuits FROM anon, authenticated;
GRANT SELECT ON public.vehicle_custom_circuits TO anon, authenticated;
GRANT UPDATE (build_state) ON public.vehicle_custom_circuits TO authenticated;

DO $check$
BEGIN
  IF has_column_privilege('anon', 'public.vehicle_custom_circuits', 'build_state', 'UPDATE')
     OR has_table_privilege('anon', 'public.vehicle_custom_circuits', 'INSERT')
     OR has_table_privilege('authenticated', 'public.vehicle_custom_circuits', 'DELETE')
     OR has_column_privilege('authenticated', 'public.vehicle_custom_circuits', 'circuit_code', 'UPDATE')
     OR NOT has_table_privilege('anon', 'public.vehicle_custom_circuits', 'SELECT') THEN
    RAISE EXCEPTION 'vehicle_custom_circuits grants are not as intended';
  END IF;
  RAISE NOTICE 'vehicle_custom_circuits: build_state writable by the vehicle owner only; anon read-only';
END $check$;

COMMIT;
