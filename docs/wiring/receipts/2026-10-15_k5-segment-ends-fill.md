---
id: 2026-10-15_k5-segment-ends-fill
change_type: data_model
scope: fill_harness_segment_ends(); one scoreboard measure (wire ends on no live segment); load_map_rows.py calls the fill and key_harness_wire_ends after the resync fold
case: docs/ledger/theory/data-machine-cases.md 13.12.3
migration: supabase/migrations/20261015100000_k5_harness_segment_ends_fill.sql
contract: supabase/sql/test_k5_harness_segment_ends_fill.sql (db-contracts)
---

# RSI pass 19: wire ends that arrive after a segment land on it

**Gap.** The reshape (20261014101500) made each decided wire's segments from its live wire ends. 22 wires had no ends
then, so each got one segment with both ends empty. The registry has their ends: the late-September wires (wiper and
washer, the PCS leads, the fuse pigtails, the third brake light's pigtails). The loader's run of 2026-10-15 inserted
them (56 wire ends), but nothing put them on the segments, because the resync fold (pass 11) only follows supersession.
Measured read-only after that run: 47 live wire ends of 21 decided wires sit on no live segment of their wire (of 931
non-grommet ends). No scoreboard measure saw them, because every wire-end measure counts only ends on live segments.

That run also showed that the loader never keys new ends to terminal and tool parts: those three key measures dipped
by 4 to 8 after it.

**Change:**
- `fill_harness_segment_ends(vehicle)` acts on a decided wire whose only live segment has no ends but which now has
  live ends. It applies the reshape's segmentation: from the wire's from-end, split at terminating pass-throughs, the
  61-pin's halves a mate, grommets not splitting.
  - Hop 1 fills the existing segment in place, so its option links, net and evidence stay with it.
  - Further hops are new segments copied from it.
  - A wire split into several hops loses its whole-wire length, with the reshape's reason (the estimate was never
    split at its junctions).
  - The fill is idempotent, runs as service role only, and every UPDATE has a WHERE.
- The loader calls the fill after the resync fold, then `key_harness_wire_ends` (pass 6) for the new ends.
- New scoreboard measure: wire ends of decided wires on no live segment (must be 0). Grommet ends are excluded,
  because a grommet never splits a wire.

**Expected after the next loader run:** wire ends on no segment 47 to 0 (or the count of ends with an ambiguous
match, named by the measure); segments with both ends known up by the filled hops; the terminal and tool keys back on
the new ends.

**Unknowns:** none for this change. The cavity keys (passes 2 and 9) were set inline by their migrations, with no
re-runnable fold, so a new end gets no cavity key yet. That is the next gap.
