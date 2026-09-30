---
id: 2026-09-29_part-models-batch5-fixes
change_type: research
amends: 2026-09-29_part-models-batch5
scope: docs/wiring/calc-data/cad/fab/ (fam_misc.py, fam_power.py, fam_rings.py, index_v5.py, k5cad.py), docs/wiring/calc-data/catalog/part_models.yaml, nuke_frontend/public/wiring/part-models/index.json (both regenerated)
author: claude-opus-5-5 (parts-artist lane, session ebc425ad)
owner_words: "if a part doesnt have its 3d then the endpoint isnt complete" (2026-09-29, relayed by the pieces lane)
---

# Batch 5 fixes: the fuel pressure pinout, unmodelled reasons beside another lane's model, and a pins.json for every stud end

The pieces lane's audit of batch 5 asked for four things before it merges. All four are done here. The branch was
rebased onto main (41d6aeef2, the squash of #439), so it carries only the batch 5 commit and this one.

## What changed
- **FUELP (AEM 30-2131-100).**
  - The pins are named from AEM's own pinout. Instructions 10-2131 Rev C p.1 has a view "Pinout Shown Looking At
    Sensor": SIG GND upper left, 5 VOLTS upper right, Signal (Input) the vertical blade below. AEM prints no pin
    numbers or letters, so the old "pin 1/2/3" labels are gone. Each wire takes its pin from the function in the
    registry's cavity text (0 V, 5 V, signal). The unknowns now say this.
  - The connector end was redrawn at the size AEM's side view shows. The view is to scale: the printed 15/16 in hex
    is 211 px and the printed 2.15 in overall is 483 px at 300 dpi.
    - The connector is Ø17.0 × 10.1 on an Ø11.2 neck. The batch 5 model drew it Ø20.0.
    - The face is scaled off the pinout view at that 17.0 (±20 %): the bore, the keyed terminal tower, the three
      terminals and the key.
    - The bore depth, tower height, recess depth and blade thickness are assumed (red).
  - The NPT thread's diameter is now scaled off the side view (10.2 ±0.3). It is no longer a standard's number from
    memory.
  - FUELP stays incomplete: the kit's mating plug has no part number and no drawing.
- **index_v5: an unmodelled reason is kept beside another lane's model.** When an end has a model and also a
  family's UNMODELLED reason, the ends table lists the models and puts the reason under missing. STARTER-S reads
  "S-terminal ring not picked" once the device lane's starter body lands.
- **A pins.json for every stud end** except PS-STUDS (see Unknowns). Each row is one ring: its place in the stack, its
  part, and the wire on it. The top level gives the stud, the torque, the stack order's basis, the clocking, the nut
  and whether the stack fits the stud.

  | End | Stud | Stack from the seat | Torque | Fit |
  |---|---|---|---|---|
  | FAN-JUNCTION | Blue Sea 2103, 3/8-16 × 3/4 in | 838TP (21, the 8 AWG tail) · 9918 (FAN_LEG1) · 9918 (FAN_LEG2), then Blue Sea's lock washer and nut | 140 in-lb (15.82 Nm), Blue Sea product page | 12.37 of 18.70 mm |
  | PDM30-STUD | MoTeC M6, 17.9 out of the case | DL214 (PDM_BPOS) · 9916 (DAK_CONST_FH) · 9916 (PCS_BATT_FH) · 9916 (TRANS_BATT_FH), then the M6 nut | not printed by MoTeC | 11.07 of 11.40 mm |
  | PDM15-STUD | MoTeC M6 | DL214 (PDM15_BPOS), then the M6 nut | not printed by MoTeC | 8.07 of 11.40 mm |
  | GND-BANK-ENG | not picked | layout only: rings 1-24 in the registry's order (ring 19 is OPEN) | open | open |
  | GND-BANK-CAB | not picked | layout only: rings 1-21 in the registry's order | open | open |

  - The stack order is a proposal, not a source. The ring that carries the stud's whole current sits on the seat,
    and the rest follow in the registry's order. No document on file gives an order. It is marked as the builder's
    call in each pins.json and in the unknowns.
  - The barrels are drawn spread round the stud so they clear. Their real clocking follows the cable runs.
- **Blue Sea 2103.** Batch 4's nut was drawn from two numbers with no source (14.3 and 8.0). They are replaced by
  what the 2101-2103 drawing's front view shows, scaled at the printed 83.82 and A 51:
  - the lower hex (the rings' seat, top at z 32.3);
  - the split lock washer, whose split shows in the view (2.9 thick);
  - the terminal nut (20.3 across the corners, 6.2 tall).
- **k5cad.write_pins.** A terminal row can name its wire, which one ring of a stack needs. The stack fields and a
  module's PINS_EXTRA pass into pins.json.

## Sources
- **AEM instructions 10-2131 Rev C p.1**
  (reference_documents/component_drawings/AEM_30-2131_Pressure_Sensor_Instructions_10-2131C.pdf):
  - the pinout view and the side view;
  - "Each sensor comes with a mating connector plug and pin kit";
  - "Electrical Connection: Packard 3-Pin".
- **Blue Sea 2101-2103 PowerPost Plus drawing**
  (reference_documents/component_drawings/BlueSea_2101-2103_PowerPost_Plus_dim.jpg): the front view, and the thread
  table "3/8"-16 UNC X 3/4"".
- **Blue Sea 2103 product page, saved 2026-09-28**
  (reference_documents/web_snapshots/www.bluesea.com__PowerPost_Plus_-_3_8in-16_Stud.md): "Terminal Stud Torque 140
  in-lb (15.82 Nm)".
- **MoTeC PDM user manual** (reference_documents/component_drawings/motec_pdm_user_manual.pdf):
  - PDF p.46-47, connector C: "M6 stud", "Mating: eyelet and M6 nut";
  - PDF p.50 (printed p.47): "M6 Stud", 17.9, and "Cover power stud with insulating cap".
  - The stud's hex base (14.0 across the flats, 6.5 tall) and its nut (10.0, 5.0) are the values motec_pdm.py (#443)
    scaled off that side view. They are reused here so both lanes draw one stud.
- **Ring thicknesses:** ProWire's tables. For 838TP and DL214, T is 0.05 and 0.121 in. The hi-temp rings' T is
  photo-scaled, ±25 % (batch 5).

## Unknowns
- **Stack order and clocking at FAN-JUNCTION and PDM30-STUD:** proposed, not sourced (the builder's call).
- **MoTeC's M6 stud torque:** neither the PDM user manual nor the PDM30 data sheet on file prints one.
- **PDM30-STUD fit is marginal.** The rings and nut take 11.07 of the 11.40 mm above the hex base, and the three 9916
  rings' thickness is ±0.75 in total. Measure the stack at the bench before the nut goes on.
- **The insulating cap MoTeC asks for** is not named in the registry. PDM30-STUD and PDM15-STUD are incomplete until
  it is.
- **The 2103 product page's colour.** Its specification table says "Color | Red" and its feature list says "Base
  Material is Black Nylon 8231 GHS". The base is drawn black. The included 4004 PowerPost Insulator is not drawn.
- **PS-STUDS has no pins.json yet.** Each primary cable carries two lugs ("238LTP + 2516LTP"), and the registry does
  not say which lug lands on which stud, or which studs the cables share. The wire labels name some studs ("stud A",
  "the distribution stud") but not all.

## Proposed for the registry pass (not applied)
- Name the MoTeC stud's insulating cap for PDM30-STUD and PDM15-STUD.
- Confirm, or replace, the proposed stack rule: the ring that carries the whole current on the seat.
- For PS-STUDS, give each cable's lug per end (stud by stud), so its stacks can be written the same way.
- The rest of batch 5's proposals stand.

## Result
- **The index:** 109 models. 59 of 179 ends have a model and 48 of those are complete; 28 more ends are listed with
  the reason they have none.
  - Complete is 2 lower than batch 5 said: the two PDM stud ends now wait on the cap.
  - Main's mounts.yaml now lists 179 ends.
- **Checks:** every build-time check passes, and the new GLBs, STEPs and JSON have no 32-hex run and no credential
  word.
