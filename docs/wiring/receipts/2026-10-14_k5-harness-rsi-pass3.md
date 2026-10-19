---
id: 2026-10-14_k5-harness-rsi-pass3
change_type: data_model
scope: 65 K5 factory-circuit observations (through ingest-observation); factory_harness_circuits.gm_circuit_number; link_harness_evidence(); v_harness_factory_residual; v_harness_coverage baseline and residual measures; three SH needs
proposal: schema_proposals 47ad7e95 (approved for build 2026-10-14 under owner direction)
case: docs/ledger/theory/data-machine-cases.md 13.12.1 item 8, 13.12.2
migration: supabase/migrations/20261014133000_k5_harness_rsi_pass3_factory_residual.sql
contract: supabase/sql/test_k5_harness_rsi_pass3.sql (PG17, CI job k5-harness-rsi-pass3-contract)
---

# RSI pass 3 on the K5 harness model: the factory baseline and the residual

After pass 2, stack SH's baseline and residual layers were missing. The case ledger set the test in 13.12.1 item 8.
The test is not that the factory harness accounts for the build, because a standalone-ECU restomod is mostly new
circuits. The test is the classification itself: each factory circuit carried or not, and each build net
factory-derived or new.

**Measured before the pass, read-only, 2026-10-14:**
- `factory_harness_circuits` holds 71 squarebody rows beside 60 `nuke_build` rows. The generation column already tells
  them apart, and the K5 overlay's `factory_generation` selects the squarebody rows.
- 63 rows apply to a 1977 truck. 26 of them cite a GM circuit number in `source_document` ("Circuit #N"). 37 do not
  (mostly "GM Service Manual 1985 C/K" with no page or number).
- The registry names the factory circuit a wire end takes the place of on 65 K5 wire ends, 28 distinct GM numbers.
  Examples: circuit 9 brown at the lamps, 150 black grounds, 183 / 184 at the tailgate window.
  - That text never reached the database. It landed 2026-10-14 as 65 observations through ingest-observation
    (`load_observations.py --factory-refs`; source k5-wiring-design, confidence 0.60 computed by the writer).
  - All 65 resolve to one live wire end by plug + wire. 64 name a number; TG_FEED's says "the factory switch's place".
- Evidence links were one-shot in pass 1, so observations landing later had no path to the harness rows.

**Preview of the result on live rows, read-only, before merge.** Of 42 GM circuit numbers:
- **carried: 5** (3, 5, 9, 11, 29). The build's wire ends cite them and the baseline has them.
- **unassessed: 14.** Baseline only, no evidence either way. This is never read as deleted.
- **baseline gap: 23.** The build cites them but no baseline row is keyed to them: turn 14 / 15, stop 18 / 19,
  backup 24, ground 150, courtesy 156, the blower circuits, the tailgate window. These are the baseline's own
  missing rows, and that is the next pass's target.

**Not claimed:**
- No GM numbers are filled from colour or name. A number not in the row's own source stays null.
- No circuit is called deleted; absence of evidence is "unassessed".
- Rows sharing a number (circuit 9 feeds parking, marker and clearance lamps) are reported together at number grain.
  One citation does not prove each lamp row.

**Still missing, as SH names them:**
- The baseline's own completeness: 37 rows unkeyed and 23 cited circuits absent.
- Topology and routing.
- Load models on nets.
- Measured lengths.

**Unknowns:** none for this pass.
