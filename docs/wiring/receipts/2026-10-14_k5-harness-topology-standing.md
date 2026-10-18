---
id: 2026-10-14_k5-harness-topology-standing
change_type: data_model
scope: harness_topology_nodes and vehicle_harness_landmarks rows for the K5 (the twin route graph with its standing); vehicle_harness_landmarks.is_superseded, .polyline_m, public read, write grants revoked; harness_endpoints.topology_node_id; key_harness_endpoints_to_topology(); v_harness_segment_geometry reads live points; scoreboard measures; load_map_rows.py calls the key fold after every run
case: docs/ledger/theory/data-machine-cases.md 13.12.3
migration: supabase/migrations/20261015013000_k5_harness_topology_standing.sql
contract: supabase/sql/test_k5_harness_topology_standing.sql (db-contracts)
---

# RSI pass 12: the route graph lands in the model, and each point says whether it stands

**Gap.** The dimension layer had tables and no rows, measured read-only 2026-10-14 on production:
`harness_topology_nodes` 0, `vehicle_harness_landmarks` 0, `harness_routings` 0. The 2026-06-10 ingest receipt
(`2026-06-10_substrate-v2-step1-ingestion.md`) says 30 landmarks were written; none are in the live table. The graph
lived only in two repo files:
- `docs/wiring/output/K5_landmarks_blender_derived.yaml`: 30 branch lengths, 2026-06-09, with L14/L15 re-derived
  2026-06-10.
- `nuke_frontend/src/components/wiring/k5LandmarkPaths.ts`: the 29 anchors and the 30 polylines that produced those
  lengths. Each polyline reproduces its length within 0.05 in; the migration checks this.

The registry loader copies anchor coordinates onto plugs as text (`load_map_rows.py` ANCHORS, TWIN_OBJ), so the
scoreboard counted 132 of 638 segments with both plugs positioned.

**The record overtook ten of those anchors** after the twin was drawn (`K5_WIRING_STATE.md`):

| twin point | what the record says now | source |
|---|---|---|
| FWG_MAIN (H3, passenger) | one 61-pin at the original fuse-box hole, driver kick panel | row 0ah; `2026-09-29_owner-calls-one-61pin-at-fusebox-hole.md`; mounts.yaml FIREWALL-61 decided |
| M130, PDM30 (A1, A2, passenger) | follow the 61-pin to the driver side; the spot is open | same receipt; mounts.yaml open |
| COIL1, COIL2 (coils pitched along the banks) | all eight coils on the DEL-Stributor central mount, rear centre behind the intake | row 0ag (h), (i) |
| CKP (front timing cover) | Gen IV 58x CKP in the block above the starter, right rear | row 0ag (f) |
| BAT, K5H_Battery (driver front) | passenger firewall corner, the owner's working position; conflicts with the A/C box | section 4; row 0ag (d) |
| ALT, K5H_Alternator | Holley Mid-Mount installed 2026-09-24; the alternator's side is not modelled | section 4 |
| O2_L, O2_R (exhaust bungs) | LTCD sensors at least 1 m downstream, under the cab; exhaust not built | row 0ag (4); LTC manual pp. 4-5 |

**Change:**
- The K5 graph: 29 twin anchors, the 25 twin objects plugs sit on, and 9 successor points. That is 51 live and 12
  fallen. Each fallen point names its successor. A successor has no coordinates unless they were derived. The one
  derived point is the 61-pin: objectTraits.ts FB lateral and height at the probed firewall plane, y = -1.46 m. The
  twin used the same method for H3.
- 32 branches: the 30 twin branches with their polylines, plus the 2026-06-10 L14/L15. A branch that ends on a fallen
  point falls with it, and its note names the point. 7 stand: L08, L09, L15 (2026-06-10), L21, L25, L26 and L27.
  L14 (2026-06-10) falls because the Holley drive replaced its CVF alternator.
- `harness_endpoints.topology_node_id` keys each plug to its live point. `key_harness_endpoints_to_topology(vehicle)`
  reads the anchor or object the loader names in `pos_source` and follows `superseded_by` to the point that stands.
  It is idempotent, runs as service role only, and the loader calls it after every run.
- `v_harness_segment_geometry` measures straight lines between live points. A plug on a fallen or unplaced point
  has no straight line.
- `vehicle_harness_landmarks` gains a public-read policy like its siblings. Its table-wide anon/authenticated write
  grants are revoked; RLS with no policy had been the only thing blocking them.
- Scoreboard:
  - "segments with both plugs positioned" becomes "segments with both plugs at a standing position".
  - New: "wire ends at a topology node" and "wire ends at a node not yet placed" (the placement backlog).

**Expected on deploy, predicted read-only from production data:**
- Wire ends at a node: 435 of 884.
- Ends whose point is not yet placed: 199 of 884.
- Segments at standing positions: about 46 of 638, down from 132. The drop is the record catching up, not a loss.

**What this unblocks:** a placement is now one row. In the contract, superseding the open M130 point with a placed one
re-keys its plug through the fold, and the straight-line check measures the cab half with no other change. Routing
(`harness_routings`) waits for branches on standing points: today the standing branches join no two plugs.

**Not done:**
- The twin itself is not redrawn.
- The map still draws plugs from the loader's copied coordinates, so the 61-pin shows on the passenger side until the
  map reads points.
- The 2026-10-14 Dakota re-plan (`2026-10-14_dakota-run-twin-length.md`) used L18 from the old PDM30 spot. L18 now
  falls with it, so that plan's basis is stale. A driver-side PDM30 sits nearer the Dakota box, so the 3.7 ft plan
  errs long, not short.

**Unknowns:** none for this change. The placements it records as open stay open: the M130, PDM30, coil, CKP,
battery, alternator and O2 coordinates.
