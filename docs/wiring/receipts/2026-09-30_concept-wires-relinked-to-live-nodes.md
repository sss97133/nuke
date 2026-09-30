---
id: 2026-09-30_concept-wires-relinked-to-live-nodes
change_type: data_correction
scope: vehicle_custom_circuits (K5 overlay eafee5c6), derivation april_2026_candidate — through calc-data/load_map_rows.py --relink-only
found_by: the MAP status-line work (PR #478), 2026-09-30: 115 of the 131 open-end wires were concept rows linked to retired nodes
---

# 115 concept wires relinked to the live nodes their retired ends lead to

**Before (2026-09-30 14:30Z, read-only):** 115 live April concept rows had 166 ends on 89 superseded `harness_endpoints`
rows. Every one of those 89 reaches a live node along `superseded_by` (at most 6 hops).

**Change:** `load_map_rows.py` gains a relink step. Each such row is superseded and reinserted with its ends moved along
the chain, one row at a time (supersede, insert the copy, point the old row at it), with the source "ends relinked along
superseded_by to the live nodes". Concept rows carry no wire ends, so none moved with them. `--plan` shows the count first.

**Interruption:** the first run stopped after 81 rows (14:41Z, a TLS handshake timeout). One row, LR-W007, had been
superseded without its copy: found by its update transaction (xmin 200263860, one after the 81st row's). `--resume-row`
finished it; the second run did the other 33.

**After:** see the state row 0ak for the probe: live ends on retired nodes, and live April rows back to 138.

## Unknowns

None.
