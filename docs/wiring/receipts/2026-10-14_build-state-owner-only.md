---
id: 2026-10-14_build-state-owner-only
change_type: security
scope: vehicle_custom_circuits update policy and grants; comment in useBuildState.ts
migration: supabase/migrations/20261014193000_custom_circuits_build_state_owner_only.sql
contract: supabase/sql/test_custom_circuits_build_state_owner_only.sql (PG17, CI job custom-circuits-build-state-contract)
amends: 2026-06-10_connector-inspector-skins
---

# Build-state writes: owner only

**Measured, read-only, 2026-10-14.** Policy "Build state workflow write" (UPDATE; roles anon and authenticated;
USING true; WITH CHECK true), together with the column grant UPDATE (build_state), let anyone holding the public key set
`build_state` on any of the table's 2,469 rows. All of them are on the K5, and 528 are live.
- No history is kept.
- Anonymous sign-in is on for the project, so "authenticated" includes anyone.
- The only writer in the app is the connector inspector's BUILD skin. The builder share page only reads build state.
- Every row is still 'uncut': the path has never been used.
- anon and authenticated also held leftover table-level INSERT and DELETE grants and column-level INSERT on every
  column. Row security blocked them.

**Change:**
- Only the vehicle's owner (`vehicles.user_id` or `owner_id`), signed in and not an anonymous sign-in, may update
  `build_state`, and only on live rows.
- anon and authenticated keep SELECT. Authenticated keeps UPDATE on `build_state`, gated by the policy. Every other
  grant is revoked.
- Anyone else's write returns no row, and the BUILD skin reverts it with its "NOT SAVED" toast.

**Not decided here:** a builder writing without an account, through a share link, would need a share credential. That
is the owner's call.

**Still owed:** build-state changes keep no history. In the data-machine shape they would be logged events (cut,
terminated, routed, verified), and `build_state` would be folded from them. That is the outcome layer of stack SH.

**Unknowns:** none.
