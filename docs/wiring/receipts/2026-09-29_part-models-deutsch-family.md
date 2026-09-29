---
id: 2026-09-29_part-models-deutsch-family
change_type: research
amends: 2026-09-29_part-models-cad-m130-sample
scope: docs/wiring/calc-data/cad/fab/ (fam_deutsch.py new; k5cad.py, index_v5.py), docs/wiring/calc-data/catalog/part_models.yaml, nuke_frontend/public/wiring/part-models/index.json (both regenerated)
author: claude-opus-5-5 (parts-artist lane, session ebc425ad)
owner_words: "so i looked at the parts... good. right on track ... ok so where the the hundreds more" and "i need the 3d pieces all of them if a part doesnt have its 3d then the endpoint isnt complete" (2026-09-29, relayed by the pieces lane)
---

# Batch 1 of the families: every Deutsch DT / DTM / DTP piece, both halves, and the mated pair at each end

## What changed
- `cad/fab/fam_deutsch.py` is the first family generator. One data table drives two builders, one for receptacles and
  one for plugs, plus the flanges and the two gaskets. It makes:
  - 19 housings: DT04-2P, DT06-2S, DT04-6P-L012, DT06-6S, DT04-08PA, DT06-08SA, DT04-12PA-L012, DT06-12SA,
    DT04-12PB-L012, DT06-12SB, DTP04-2P, DTP06-2S, DTP04-4P, DTP04-4P-L012, DTP06-4S, DTM04-4P (MoTeC #68055),
    DTM06-4S (MoTeC #68054), DTM04-3P and DTM06-3S. The DTM 3-way pair is only for the wheel-speed option.
  - 2 gaskets: DT12-L012-GKT and DTP4P-L012-GKT.
  - 12 mated end assemblies: FIREWALL-BODY-A/B/C/P, DOOR-L/R-PASS, DOOR-L/R-PASS-P, IBST-DIAG, FUEL-LEVEL,
    FUEL-PUMP and WIDEBAND.
- Each housing carries the modelled details: the housing, the rear grommet with a seal hole per cavity, the wedgelock
  in its own colour, the pins (receptacles), the interface seal and lock arm (plugs), and the welded flange (L012).
  - The plug nose is derived from its receptacle's shroud opening (0.3 mm clearance), and the lock arm from the
    receptacle's bridge, so each pair mates without clashing.
  - pins.json gives every cavity at the wire face with its registry wires. The pin side (0460 contacts) and the
    socket side (0462) are told apart by the new `part_prefix` in `k5cad.write_pins`.
- `k5cad.py` changes:
  - A `vendor` basis (teal, ≈) for a number only a distributor states.
  - Drawings can scale 2:1 and 3:1 for small parts.
  - The top view is placed right for parts whose extent is not symmetric about the origin. It was drawn off the
    sheet before; the earlier floor parts are unchanged, because their top views are symmetric.
  - `meta_for` carries kind / family / mates / pieces / missing / cavities / numbering / option.
- `index_v5.py` changes:
  - It loads `fam_*.py` modules (pieces() plus END_NEEDS) as well as `<end id>.py` scripts.
  - It rejects a duplicate id, and allows the `vendor` basis.
  - It writes an `ends` table: each end's models, and whether it is complete or what is still missing.
- Nothing binary is committed. The STEP, GLB, SVG, params and pins files build to `~/k5-harness-pull/parts/samples/<id>/`.
  A scan of the 163 files found no 32+ hex runs and no credential words.

## Sources, per family
- **Envelope** (maker): Deutsch DT family catalog p.19, the DT/DTM/DTP plug and receptacle length, height and width
  per cavity count (reference_documents/component_drawings/DEUTSCH_DT_DTM_DTP_Catalog.pdf).
- **Per-part data** (maker): TE product page for each part number, read 2026-09-29 through Firecrawl (te.com refuses
  curl):
  - centreline pitch, row-to-row spacing and mating pin diameter (1.59 / 1.02 / 2.39);
  - colour, key code, and the DTM dimensions.
- **Flanges** (maker):
  - DT 12-way: TE customer drawing DT04-12PX-L012 rev D2, both sheets:
    - flange 55.12 × 35.56 × 5.08, holes Ø4.29 on 44.96 × 23.88;
    - panel cutout 41.83 × 23.52 R6.35;
    - shroud 19.81 in front of the flange;
    - the wire-side cavity numbers, and key colours A grey / B black / C green / D brown.
  - DT 6-way and DTP 4-way: the TE drawing-viewer screenshots on file:
    - 45.01 hole spacing and the .813 [20.65] shroud;
    - 40.64 hole spacing, 2 × Ø4.93, 38.10, R6.35 TYP, and .868 / .760 / 1.069 on the DTP body.
- **Distributor**: ProWire p-2900 page for the DT 6-way flange thickness, 3.70 (basis `vendor`).
- **Photos**: customconnectorkits.com product photos of each part number (front and back, fetched 2026-09-29). They give:
  - the colours: k-means dominant cluster, one per housing, grommet and wedgelock;
  - the moulded cavity numbers;
  - the photo proportions: shroud length, bridge, lock arm, seal ring and nose depth, each measured on a named photo
    against that part's catalog dimension, ±10–15 %.
  - The gasket openings are scaled off flat photos from the 55.12 / 53.3 flange widths. The photo outlines read
    35.31 and 37.7 against the flanges' 35.56 and 38.1, which is the scale error (under 1.1 %).
- Of the 924 dimension rows in the index (the assemblies repeat their pieces' rows): 461 are maker, 172 scaled,
  270 photo, 2 vendor, 6 design and 13 assumed. The assumed and design rows come from the earlier parts; the Deutsch
  pieces have none.

## Findings
- **The catalog's DTM table has its plug and receptacle headings crossed** for length and height. TE's DTM04-4P page
  gives 43.7 long × 19.2 × 19.6, which the catalog prints under "DTM Plug"; the DTM06-4S page gives 30.1 × 15.2 × 17.6,
  printed under "DTM Receptacle". TE's DTM04-4P view prints .772 [19.61] as the receptacle's height. The models use
  TE's per-part pages.
- **TE's pages disagree with each other in four places.** The models use the drawing, or the mating half's page, and
  note the other number:
  - DT04-08PA: 4.45 row spacing, where its own figure scales 9.0 and DT06-08SA says 9.12.
  - DT04-12P*-L012: 4.45, where the drawing scales 9.1 and DT06-12SA says 9.12.
  - DT04-08PA: 23.88 connector height, where the drawing and catalog say 25.40 (23.88 is the shroud without the top
    plate).
  - DTM06-4S: 4.19 × 4.19 pitch, where DTM04-4P says 3.81 × 4.19. Both halves must share one grid, so the
    receptacle's is used.
- **On the DTP receptacles, the catalog's "overall width" is the rear body.** TE's DTP04-4P-L012 drawing prints
  .868 [22.05] across the rear body, and TE's pages give the shroud as 26.9 (4-way) and 22.1 (2-way).
- **The 12-way flange gasket's opening (photo-scaled 33.3 × 19.1) only clears the rear body.** So on FIREWALL-BODY-A
  and -B the panel and gasket sit on the flange's wire side, and the rear body passes through the 41.83 × 23.52 cutout.
  The models are built that way.
- **The welded flange on the black B-key DT04-12PB-L012 is grey** in the product photos. It is modelled grey.
- **Wedgelock colours** (TE pages and photos): DT receptacle wedges (W2P, W6P, W8P, W12P) are green. DT plug wedges
  (W*S) and all DTP and DTM wedges are orange.

## Unknowns (marked in the models, not guessed)
- **Cavity numbers are not legible** on the photos, and not printed on the pages on file, for these pairs:
  - DT 2-way: FUEL-LEVEL;
  - DTP 2-way: FUEL-PUMP;
  - DTM 4-way: IBST-DIAG and WIDEBAND;
  - DTM 3-way.

  Their positions are drawn from TE's pitch with 1 at +X, and marked `numbering: not sourced`. Read the moulded numbers
  off the parts before pinning them.
- **Mated length depends on a photo number.** It follows the photo-scaled nose depth (0.40 of the plug length),
  because TE prints no mated length. It is flagged fit-critical on every piece.
- **Two flange thicknesses are not the maker's:**
  - DT 6-way, 3.70: ProWire (`vendor`).
  - DTP 4-way, 4.0 ± 1: photo.

  Confirm both before cutting a panel spacer.
- **Other pieces these ends still need** are listed in `ends.<id>.missing`:
  - FUEL-LEVEL and FUEL-PUMP: the QFS-H882 hanger, its sender and pump, and the QFS-BKCN-GM bulkhead;
  - WIDEBAND: the LTCD box and the LSU 4.9 sensors.

## Result
- The index now has 39 models, and 23 of the 178 ends have a model.
- 20 ends are complete: the 12 Deutsch ends except the 3 above, plus the 11 ends of the earlier parts.
- Every build-time check passes: 214, covering the envelope, cavity count, pitch and row spacing measured on the
  solids, flange size, holes and position, and mating clearances.
