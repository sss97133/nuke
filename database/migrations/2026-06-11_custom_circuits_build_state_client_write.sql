-- =============================================================================
-- CUSTOM CIRCUITS: scoped client write path for build_state (2026-06-11)
-- Receipt: docs/wiring/receipts/2026-06-10_connector-inspector-skins.md
-- Spec: docs/wiring/WIRING_SUBSTRATE_V2_SPEC.md — build_state is mutable
--       physical-build WORKFLOW state ("Dave's 28 of 61 pins as live data"),
--       not testimony. The Connector Inspector BUILD skin advances it from
--       the browser keyed on (overlay_id, circuit_code).
--
-- JUSTIFICATION: RLS on vehicle_custom_circuits was Public-read +
-- service-role-write-all. Browser (anon/authenticated) updates silently
-- no-op'd (0 rows). This migration opens EXACTLY ONE column to clients:
--   * column-level GRANT UPDATE (build_state) — every other column stays
--     service-role-only (blanket UPDATE revoked from anon/authenticated)
--   * RLS UPDATE policy for the client roles
--   * values bounded by vehicle_custom_circuits_build_state_check
--     ('uncut','cut','terminated_a','terminated_b','routed','verified')
-- No new tables. No DDL on data shape. Table has 174 rows — instantaneous.
-- =============================================================================

BEGIN;

REVOKE UPDATE ON vehicle_custom_circuits FROM anon, authenticated;
GRANT UPDATE (build_state) ON vehicle_custom_circuits TO anon, authenticated;

DROP POLICY IF EXISTS "Build state workflow write" ON vehicle_custom_circuits;
CREATE POLICY "Build state workflow write" ON vehicle_custom_circuits
  FOR UPDATE TO anon, authenticated
  USING (true)
  WITH CHECK (true);

COMMENT ON POLICY "Build state workflow write" ON vehicle_custom_circuits IS
  'Connector Inspector BUILD skin: clients may flip build_state only (column-level grant). Receipt docs/wiring/receipts/2026-06-10_connector-inspector-skins.md.';

COMMIT;
