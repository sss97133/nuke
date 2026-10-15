---
id: 2026-10-15_k5-device-terminal-splices
change_type: substrate_correction
scope: docs/wiring/calc-data/kits_v5.py (device-terminal splices into reg["splices"]; 10 AWG in the area table; an unknown gauge no longer sized as zero area); k5_registry.json regenerated
case: docs/ledger/theory/data-machine-cases.md 13.12.3
---

# RSI pass 18: splices at device terminals join the design's splice list

**Gap.** RSI pass 16 measured 11 device terminals that hold several wires and have no splice in the registry's
`splices` list. Among them:
- the floor dimmer's feed, HIGH and LOW cavities;
- the blower motor's + blade;
- the passenger door-jamb switch;
- both subwoofer push terminals;
- three tailgate-switch terminals;
- the VSS sender's signal lead.

The registry already marks every one of those devices as a splice point (`catalog/endpoints.yaml` `splice_point:
true`). It records the join, or the question still open about it, in each endpoint's `open` notes. But `kits_v5.py`
added only ECU and PDM pin splices to `splices`. A device's join existed only as prose, or as a per-end part (the
VSS sender's D-609-04).

**Change:**
- At an endpoint marked `splice_point`, wires that share one named terminal now produce a splice in `splices`. It is
  sized like the pin splices, by the wires' combined circular mils (`splice_for`). The device splices come after the
  ECU and PDM pin splices, so the book's S-numbers for those hold. The BOM counts the new splice parts, except where a
  MiniSeal end already counts its group splice.
- `CMA` gains 10 AWG (10,380 CM, the value the file's other area table already used). `splice_for` returns no part
  when a gauge is missing from the table. Before this, two 10 AWG subwoofer wires summed to zero area and "fit" the
  smallest splice.

**Result (regenerated registry):**
- Splices go from 37 to 49. All 37 earlier splices are unchanged.
- 7 of the new splices get a MiniSeal part: the VSS lead (D-609-04, already counted); the dimmer feed and both
  door-jamb switches (D-609-04); the dimmer LOW and HIGH cavities (D-609-05).
- BOM: D-609-04 goes from 20 to 23 and D-609-05 from 32 to 34.
- 5 get no MiniSeal part, because the combined area is past the largest MiniSeal cavity. They stay recorded as splices
  with no part, which matches each endpoint's open note:
  - the blower motor + blade (2 x 12 AWG);
  - three tailgate-switch terminals (2 x 14 AWG each);
  - the two subwoofer push terminals (2 x 10 AWG each).

**Unknowns:** none for this change. The 5 joins with no part are named in their endpoints' `open` notes. The lead from
each splice into its terminal is still unnamed, at devices as at ECU and PDM pins. Sizing it needs cited contact and
seal ranges (next pass).
