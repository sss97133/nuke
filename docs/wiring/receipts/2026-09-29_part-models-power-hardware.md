---
id: 2026-09-29_part-models-power-hardware
change_type: research
amends: 2026-09-29_part-models-injectors-coils
scope: docs/wiring/calc-data/cad/fab/ (fam_power.py new; index_v5.py), docs/wiring/calc-data/catalog/part_models.yaml, nuke_frontend/public/wiring/part-models/index.json (both regenerated)
author: claude-opus-5-5 (parts-artist lane, session ebc425ad)
owner_words: "if a part doesnt have its 3d then the endpoint isnt complete" (2026-09-29, relayed by the pieces lane)
---

# Batch 4: power hardware, with the ends that can't be drawn yet listed and their reasons

## What changed
- `cad/fab/fam_power.py` adds three parts, all from maker sources:
  - Blue Sea 1003 CableClam, for FIREWALL-GROMMET and AMP-PASS (one per cable).
  - Blue Sea 2103 PowerPost Plus, for FAN-JUNCTION.
  - TE PIDG 327583 step-down butt splice, for SPL-PDM15-OUT13.
- `index_v5.py` now reads each family's `UNMODELLED` table (end id → why there is no model). Those ends appear in the
  `ends` table with no models, complete: false, and the reason as `missing`. The index writes the count as
  `ends_unmodelled_with_reason`.

## Sources
- **1003 CableClam**: Blue Sea dimensioned drawing 1003-1 ("CableClam 1.385 Inch"):
  - Ø2.67 in (67.70), boss Ø1.50 in (38.16), 1.12 in (28.33) tall;
  - #8 screw holes 1.02 in (25.86) from the centre.
- **2103 PowerPost Plus**: Blue Sea's 2101-2103 drawing (on file):
  - 3.300 (83.82) × 1.750 (44.45);
  - holes 2.500 (63.50) apart, for 1/4 in screws;
  - .450 (11.43) base, 1.025 (26.04) to the ring;
  - dimension A for the 2103: 2.0 (51);
  - stud 3/8-16 × 3/4.

  The product page gives "Base Material is Black Nylon".
- **327583**: TE product page:
  - "Product Length 32.13 mm", "Recovered Inside Diameter 3.89 mm";
  - "Blue - Transluscent" nylon, tin barrel.

  The sleeve's outside diameter is photo-scaled, ±15 %.

## Ends listed without a model, and why (31)
- **MiniSeal splices: M81824/1-3, /1-2, D-609-04, D-609-05 (19 ends)**
  - Ends: every SPL-PDM15-OUT1-7, SPL-PDM30-OUT1-8, SPL-FUEL-SND, SPL-ISO-YEL, RAIL-COIL_PWR and RAIL-INJ_PWR.
  - Why: no dimension on file. TE's data sheet 2347480-1 (DigiKey lists D-609-05 as TE 680106-000 and links the sheet)
    opens only in a browser. ProWire and DigiKey print no dimensions.
  - Needs: the data sheet read in a browser, or calipers on a splice from the ProWire order.
- **Blue Sea 5065 fuse holder (the six FUSE-* ends)**
  - Why: Blue Sea publishes no drawing. Its page reads "There is no documentation for this product" (2026-09-29).
  - Needs: calipers, or a photo of the part with a scale.
- **Stud banks and ring terminals (GND-BANK-ENG, GND-BANK-CAB, GND-SPLICE-REAR, COIL-GROUND-RINGS, STARTER-S)**
  - Why: no part is picked. families.yaml ring_small says "UNKNOWN: ring PN per stud size + gauge".
- **PS-STUDS**
  - Why: the lug set per stud is not picked (six different studs).

## Result
- The index now has 87 models, and 49 of 178 ends have one, 46 of them complete.
- 31 more ends are listed with the reason they have no model.
- Every build-time check passes.
