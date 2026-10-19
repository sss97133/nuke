---
id: 2026-10-15_k5-power-spine-studs
change_type: substrate_correction
scope: docs/wiring/calc-data/catalog/endpoints.yaml (PS-STUDS gains `studs` and `stud_nodes`); kits_v5.py (stud nodes and their ends; the book fold folds them back); load_map_rows.py (the stud set draws no plug and leaves the map; its cables start at their stud nodes); check_plug_ends.py (R14 accepts a stud set's nodes); power_v5.py (stud words); catalog/mounts.yaml (9 stud ends); k5_registry.json, WIRE_CHECKS.json, OPTIONS.md regenerated
case: docs/ledger/theory/data-machine-cases.md 13.12.3 (owed: "the DC primary's stud-to-stud topology")
---

# RSI pass 37: the DC primary's studs become nodes

**Gap.** PS-STUDS was one endpoint for the whole DC primary: the Odyssey and isolator studs, the distribution stud and
its MEGA/MIDI holders, the starter and alternator B+ studs, and the block, frame, head, firewall and ground-star ends of
16 cables. Each cable had one wire end there, with both lugs in one cavity text ("stud, lug 238LTP + 2516LTP"), so:
- **Cables with no second end.** #6 (distribution to starter), #59 (alternator to distribution), G3 (head to
  firewall) and ISO_OUT (isolator B to distribution) had no second end in the model.
- **Ground-star cables missing their ground-star end.** G1 and G2 had no end at the ground star they start from; the
  battery negatives and the cab return reached the star only as "PS-STUDS".
- **No position.** The device-position study could not place PS-STUDS: one point would be wrong for every cable.

The case ledger owed this as "the DC primary's stud-to-stud topology".

**Evidence:** each cable's own record words name its stud ("distribution stud", "starter B+ stud", "isolator stud A
(Blue Sea 7700, 3/8-16)", "alternator B+ stud", "engine block near the starter", "frame rail boss", "engine
head/block", "firewall bond stud"), and PS-STUDS' lug table gives each end's lug in order.

**Change:**
- endpoints.yaml PS-STUDS gains `studs` (each cable's studs in lug order) and `stud_nodes` (9 studs, each with its
  words). PS-STUDS stays the catalog's stud set and lug table.
- **kits_v5:** each lug becomes an end on its stud node (cavity "stud, lug <part>"), and the ground-star ends go on
  GND-BANK-ENG. The stud nodes are endpoints of their own (family lug, `stud_of` PS-STUDS). The book fold folds them
  back, so the diagrams and manual match main.
- **Loader:** the stud set draws no plug and leaves the map, and its cables start at their stud nodes.
- **R14:** a record naming the stud set agrees with its nodes.
- **power_v5:** the stud words go on the pages.
- **mounts.yaml:**
  - isolator studs A/B and the distribution stud sit on the isolator point; the starter B+ stud and the block ground
    on the starter point (all low confidence);
  - ALT-BPLUS, GND-FRAME, GND-HEAD and FW-BOND stay open, with reasons: the alternator's side is unsettled, the
    frame boss isn't drawn, the twin engine insert is offset, and no bond-stud spot is recorded.

**Result (regenerated; a second rebuild is byte-identical):**
- Wire ends 993 → 999: #6, #59, G1, G2, G3 and ISO_OUT each gain their second end.
- Endpoints 203 → 212.
- WIRE_CHECKS counts are unchanged from main; the BOM is unchanged.
- `diagram_v5.py --check` and `manual_v5.py --pages-only` match main.
- The power pages' cable schedule now prints each end's own lug: #6 reads 238LTP at the distribution stud and 2516LTP
  at the starter, where both columns used to read "238LTP + 2516LTP". That is a correction.
- **Loader plan:** 9 new plugs, 16 cables updated, PS-STUDS leaves the map.

**Physics to check after the load:** the distribution stud is a bus (one electrical node before its holders' fuses),
and the ground star takes G1, G2, both battery negatives and the cab return. "Nets that join a supply to ground (must be
0)" has to stay 0.
