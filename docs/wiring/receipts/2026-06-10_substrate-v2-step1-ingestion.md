---
id: 2026-06-10_substrate-v2-step1-ingestion
date: 2026-06-10
change_type: substrate_migration
scope: vehicle_custom_circuits + vehicle_build_manifest (columns) + wiring_decisions + wiring_policy_rules + vehicle_harness_landmarks (new tables); docs/wiring file substrate -> DB rows
status: APPLIED
amends: none
---

# Wiring Substrate v2 — Step 1: one-time ingestion of the v1 file-substrate into DB rows

Per `docs/wiring/WIRING_SUBSTRATE_V2_SPEC.md` build order item 1: "Migration: ingest v4.1
wires + decisions + landmarks into rows (one script, idempotent)." Files freeze as archive;
rows become the substrate; documents become projections.

## What changed

1. **Migration** `database/migrations/2026-06-10_wiring_substrate_v2_step1.sql`
   - `vehicle_build_manifest` + `lifecycle_state` (concept→decided→ordered→in_hand→installed→wired→verified) + `subsystem` — columns only, **no backfill** (mapping legacy `status='purchased'` onto ordered-vs-in_hand is Skylar's call; Step 2)
   - `vehicle_custom_circuits` + `build_state` (uncut→cut→terminated_a→terminated_b→routed→verified, default uncut) + `derivation_version` + `planned_length_ft` (NEW — `measured_length_ft` stays reserved for tape measurements; cut-list lengths are zone/twin estimates per the file's own header)
   - unique index `(overlay_id, circuit_code)` — natural key for idempotent ingest
   - new tables `wiring_decisions`, `wiring_policy_rules`, `vehicle_harness_landmarks` — justification comments in the migration per hard rule #2 (no existing table carries decision chains, versioned policy, or landmark distance atoms; audited `wiring_design_issues`, `vehicle_circuit_measurements`, `harness_endpoints`, `pdm_channels`, `*_rules` as non-fits)

2. **Ingest script** `scripts/wiring_v2_ingest.py` (`npm run wiring:v2:ingest`) — INSERT-only,
   `ON CONFLICT DO NOTHING` on natural keys, never UPDATE/DELETE:
   - **168 wires** from `output/K5_cut_list_v4_1.txt` → `vehicle_custom_circuits` rows on overlay `eafee5c6-c105-4148-be9c-61cca0bc2377` (`build_state='uncut'`, `derivation_version='v4.1'`, subsystem via `calc-data/subsystems.json`; 23 post-v3 wires mapped by receipt lineage and flagged in notes)
   - **34 receipts** from `receipts/*.md` → `wiring_decisions` (shallow parse: filename + frontmatter + first heading; bodies remain the human render; `supersedes` from amends/retracts lines)
   - **30 landmarks** from `output/K5_landmarks_blender_derived.yaml` → `vehicle_harness_landmarks` (method `blender_polyline_derived_v2`; L14/L15 `analytic_polyline_derived` per 2026-06-10 battery-corner re-derivation; A1–A6/C1–C2 assumption flags carried in `assumptions`)
   - **10 policy rules** → `wiring_policy_rules` version `v1_file_substrate_2026-06-10`: vdrop_max_pct 3, safety_margin 1.25, slack 1.15, body/engine pads 15/20%, 22 AWG signal floor, PDM30 ratings (8×20A + 22×8A VALIDATED, MoTeC manual p39), PDM15 ratings, 20 A direct-wire threshold, fuse ladder

## Citations

- Cut list: `output/K5_cut_list_v4_1.txt` (v4.1 header: 168 wires, 1122.5 ft) + its receipt `2026-06-10_cut-list-v4.1-ecu-lifelines.md`
- Subsystem registry: `calc-data/subsystems.json` (145 v3 ids; addendum mapping per receipts `2026-05-14_addendum-dakota-dual-sender-wires.md`, `2026-05-14_acceptance-three-decisions.md`, `2026-05-14_decision-high-beam-floor-dimmer.md`, `2026-06-10_cut-list-v4.1-ecu-lifelines.md`)
- Landmarks: `output/K5_landmarks_blender_derived.yaml` (30/30 valued, v2 twin) + `2026-06-10_battery-corner-rederivation.md`
- Policy values: `calc-data/rules_extracted.md` (DOC-05/06 + wiringCompute.ts + harnessConstants.ts triangulation; C2/C6 contradictions resolved to validated variants), `calc-data/pdm_power_budget.md`, `.claude/rules/wiring-wire-closure-protocol.md` field 10, `2026-05-14_substrate-amendment-gauge-audit.md`

## Verification (filled post-run)

- Parse counts: wires 168/168, landmarks 30/30, receipts 34, policy rules 10 — match sources
- First run inserted: 168 circuits, 34 decisions, 30 landmarks, 10 policy rules
- Idempotency proof: second run inserted 0 / 0 / 0 / 0
- Pre-existing rows untouched: 12 prior `vehicle_custom_circuits` rows (PDM15/TRAILER), 141 manifest devices — INSERT-only contract held

## Unknowns

(none blocking this change — the ingestion is a faithful copy of the frozen v1 files; all
upstream unknowns, e.g. battery-corner lengths and PDM channel TBDs, remain flagged inside
the rows' own notes exactly as the files flag them)

## Open items deliberately NOT done here (Step 2+)

- No backfill of `lifecycle_state`/`subsystem` on the 141 manifest devices (would be UPDATE; semantics need Skylar: does `purchased` mean ordered or in_hand?)
- `K5_cut_list_v4_2.txt` (APS pedal, +6 wires, landed 2026-06-10 22:19 by a concurrent session, append-only vs v4.1) — ingest as a `derivation_version='v4.2'` delta in a follow-up; its receipt IS captured as a decision row
- Wires #60/#61 are SUPERSEDED-PENDING-RETIREMENT in v4.1 — ingested verbatim (registry stability per the file); retirement happens at next regen via supersession, not deletion
- `docs/wiring/RECEIPT_FORMAT.md` referenced by `.claude/rules/wiring-receipt.md` does not exist — this receipt follows the de-facto frontmatter convention of the existing 34
