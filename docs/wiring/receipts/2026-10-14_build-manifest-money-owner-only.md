---
id: 2026-10-14_build-manifest-money-owner-only
change_type: access_control
scope: vehicle_build_manifest grants; vehicle_build_manifest_owner_fields (new); wiring_tech_manifest_summary; compute_build_spend_profile; build_cost_comparison, device_installation_status, harness_workstation, wiring_enrichment_dashboard, invoice_learned_pricing
found_by: K5 full audit, records auditor, 2026-10-14; reproduced by the lead with the anon key (counts only)
migration: supabase/migrations/20261014050000_build_manifest_money_owner_only.sql
contract: supabase/sql/test_build_manifest_money_owner_only.sql (PG17, CI job build-manifest-money-contract)
---

# The build manifest's money and contacts reach the owner only

Owner rule (2026-09-28): the build record is public, its costs are owner-only. The web enforced it client-side
only; the database served everything to the anon key.

**Measured before (2026-10-14, anon key, counts only):**
- `vehicle_build_manifest`: 141 rows; 138 price, 52 invoice_ref, 4 actual_cost, 3 supplier_contact non-null.
- `evidence_sources` carries client-invoice package amounts, and 11 `notes` carry dollar figures.
- `wiring_tech_manifest_summary` returned the spent, pending and total dollars.
- Four cost readers (141 rows each) and `invoice_learned_pricing` (157 rows) were readable.

**After:**
- anon and authenticated select the 59 public columns only.
- The nine owner fields come from `vehicle_build_manifest_owner_fields`. It applies the owner rule of 20261013170000: owner, uploader or a contributor with access.
- The summary and the spend profile mask their money for everyone else.
- The four readers no client uses are service-role only.
- The web half (#1147) shipped first, so no page selects `*` on the table.

**Unknowns:** none for the change. Separate, not addressed: the K5 manifest's purchase flags are wrong (28 rows cite
another customer's invoice). That is a data correction through the sanctioned writer; see the 2026-10-14 audit.
