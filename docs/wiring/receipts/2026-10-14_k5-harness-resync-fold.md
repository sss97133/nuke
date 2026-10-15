---
id: 2026-10-14_k5-harness-resync-fold
change_type: data_model
scope: resync_harness_segments(); scoreboard measure "live segments on superseded legacy rows (must be 0)"; load_map_rows.py calls the fold after every run
case: docs/ledger/theory/data-machine-cases.md 13.12.3
migration: supabase/migrations/20261015003000_k5_harness_resync_fold.sql
contract: supabase/sql/test_k5_harness_resync_fold.sql (db-contracts)
---

# RSI pass 11: the harness model follows the design rows it came from

**Gap.** `harness_segments` point at a wire (`vehicle_custom_circuits`) and its two ends (`wire_termination_specs`). The
registry loader never edits a changed wire in place. It supersedes the wire and its ends, inserts new rows, and links
the old wire to its successor but not the old ends. Measured read-only 2026-10-14 on the K5: 1,851 of 1,941 superseded
wires carry a successor, and 0 of 3,182 superseded ends do. Today 0 live segments sit on a superseded row, but the next
loader run that changes a wire would strand its segments silently.

**Change:**
- `resync_harness_segments(vehicle_id)`, idempotent and service role only:
  - a segment on a superseded wire moves to the live successor, following `superseded_by`;
  - a segment of a wire that left the design is superseded, with a note;
  - each segment end moves to the live end of its wire at the same plug, matched by plug code, when exactly one
    matches;
  - a wire's only segment, still on the legacy zone estimate, takes the successor's planned length. A segment with
    its own better plan keeps it.
- The scoreboard and the owner MODEL tab gain "live segments on superseded legacy rows (must be 0)". An end the fold
  cannot match stays counted there.
- `load_map_rows.py` calls the fold at the end of every run and prints its counts.

**Not done:** nets are not re-folded here. A successor wire that lands on different plugs changes net membership, and
the net fold owns that.

**Unknowns:** none.
