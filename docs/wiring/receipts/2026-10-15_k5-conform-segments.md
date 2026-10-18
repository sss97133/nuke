---
id: 2026-10-15_k5-conform-segments
change_type: data_model
scope: conform_harness_segments(); one scoreboard measure (decided wires with no live segment); load_map_rows.py calls it after the resync fold, in place of the fill
case: docs/ledger/theory/data-machine-cases.md 13.12.3
migration: supabase/migrations/20261015150000_k5_harness_conform_segments.sql
contract: supabase/sql/test_k5_harness_conform_segments.sql (db-contracts)
---

# RSI pass 25: every decided wire's segments follow its live ends

**Gap.** RSI pass 24 moved the A/C clutch to PDM15 OUT8. The loader added its two pigtails and re-inserted #23 starting at
the new splice node. The scoreboard then read 1 / 643 live segments on superseded rows and 1 / 931 wire ends on no
segment, both must-be-zero:
- The pigtails had no segment at all. The reshape segmented only the wires that existed on 2026-10-14, and no measure
  counted decided wires without a segment.
- #23's segment kept its old PDM15-A A6 end. The resync fold (pass 11) moves an end only to the successor's end at the
  same plug.

**Change:**
- `conform_harness_segments(vehicle)` applies to each decided wire with live ends the reshape's segmentation of those
  ends (the rule pass 19 uses), compared with all of the wire's live segments whatever their design status:
  - a segment that already is a desired hop stays;
  - an unmatched segment takes an unmatched hop in place, so its links stay;
  - a hop left over becomes a new segment copied from a kept one;
  - a segment left over is superseded.

  A wire with no segment gets its hops on a net of its own, which the net refold then joins. A wire with two live ends
  on one plug is skipped: that is the ambiguity pass 11 leaves in place. The fold is idempotent and every UPDATE has a
  WHERE.
- The loader calls it after the resync fold, in place of the fill.
- New scoreboard measure: decided wires with no live segment (must be 0).

**Simulated read-only on production before writing (2026-10-15 ~06:10Z):** it touches 3 wires. #23's segment updates
in place to start at SPL-PDM15-OUT8, and 23_PT1 and 23_PT2 get one segment each. No other wire changes.

**Unknowns:** none for this change.
