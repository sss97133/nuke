---
id: 2026-09-29_part-models-batch7
change_type: research
amends: 2026-09-29_part-models-batch6
scope: docs/wiring/calc-data/cad/fab/ (fam_fuel.py new; fam_deutsch.py, fam_power.py), docs/wiring/calc-data/catalog/part_models.yaml, nuke_frontend/public/wiring/part-models/index.json (both regenerated)
author: claude-opus-5-5 (parts-artist lane, session ebc425ad)
owner_words: "if a part doesnt have its 3d then the endpoint isnt complete" (2026-09-29, relayed by the pieces lane)
---

# Batch 7: the in-tank fuel pieces, so FUEL-LEVEL and FUEL-PUMP are complete; the 5065's reason brought up to date

## What changed
- **`cad/fab/fam_fuel.py` (new): the Quantum QFS-BKCN-GM electrical bulkhead.**
  - The body is yellow, with the oval 4-way harness shroud on top and the round boss below.
  - The stem passes through the hanger lid's keyed 10 mm hole, sealed by a brown O-ring. It carries four blades on each
    side of the lid.
  - A stainless lock clip holds it from below.
- **`fam_fuel.py`: the Quantum QFS-H882 hanger (1973-91 Blazer, 31 gal tank).** It is drawn with:
  - the top plate and its three lock tabs;
  - the 8AN and 6AN fuel tubes with their AN male ends;
  - the stand down to the pump holder's ring, 12 in below the plate;
  - the level sender, float arm and float;
  - the P367 pump body, which is ASSUMED;
  - the QFS-BKCN-GM in its hole.
- **fam_deutsch: FUEL-LEVEL and FUEL-PUMP now need the two pieces by id** (QFS-H882, QFS-BKCN-GM), not as need
  strings. Both ends are complete.
- **fam_power: the six FUSE-* ends keep their no-model reason, now brought up to date.**
  - Every Blue Sea 5065 listing photo checked is Blue Sea's own stock photo, with the holder open and empty.
  - The ruler is ready: Littelfuse's 257 Series ATO data sheet (DigiKey's mirror) prints 19.1 (.75") and 5.1 (.20"),
    which DigiKey's spec line labels L and W.
  - Needs: a photo with a fuse seated, calipers, or a photo with a scale.

## Sources
- **QFS-BKCN-GM**
  - The vendor page, saved 2026-09-28: "a keyed 10mm hole", "4 wires, supporting up to 14 amps per terminal".
  - The product photo reference_documents/product_images/QFS-BKCN-GM.jpg, scaled off the O-ring's 172 px inside,
    which is taken as that 10 mm hole (±20 %; the photo is a three-quarter view).
  - Colours are medians of the photo's pixels: body #c4bc46, O-ring #402316, clip #868582.
- **QFS-H882**
  - The vendor page's Q&A, saved 2026-09-28: "The measurement is 12 inches from the top plate to the bottom of the fuel
    housing that holds the fuel pump". That is the sourced number (304.8), and the build checks it.
  - The side-view product photo (page image 633481, viewed in a browser tab of my own on 2026-09-29; nothing was saved)
    spans that 12 in over 505 px. The plate (Ø106), the tubes (9.8 as photographed), the AN reach, the pump holder
    (Ø47), the sender and the float are scaled from it (±20–25 %).
  - The 8AN / 6AN sizes are the listing's.
- **5065:** DigiKey's page for Littelfuse 0257010.PXPV and its linked 257 Series data sheet (mm.digikey.com mirror).
  eBay's listing text for "blue sea 5065".

## Unknowns
- **QFS-BKCN-GM:** the mating harness plug. The registry routes the pump pair to a DTP 2-way and the sender pair to a
  DT 2-way above the lid.
- **QFS-H882, the pump:** no product photo shows it. Its body (38 × 130) is drawn red (ASSUMED).
- **QFS-H882, the kit's pigtail:** black loom, a 2-pin plug and a ring lug in the photos. It is not drawn.
- **Photo scaling:** every photo-scaled number carries its ± in the drawings.

## Also found (not changed here)
- **Master key.** MILNEC's catalog p.B-15 draws the master key at 12 o'clock, and says "Inserts maintain a fixed
  position regardless of keying". So the 25-61 arrangement's up (+Y in #460) is the master key.
  - The adapter plate's D-flat is drawn at 12 o'clock.
  - Whether the receptacle's body flat sits on the master keyway's side is not printed. The builder checks it on the
    part.
- **Jam nut torque.** The same page gives the shell 25 jam nut torque for aluminium: 120–130 in-lb (13.6–14.7 N·m).
  It belongs on the adapter plate's drawing in its next change.

## Result
- **Index:** 195 models. 161 of 179 ends have a model, and 128 are complete (+2: FUEL-LEVEL, FUEL-PUMP). 17 more ends
  are listed with the reason they have no model.
- **Checks:** every build-time check passes, and the new outputs have no 32-hex run and no credential word.
