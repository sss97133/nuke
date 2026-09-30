---
id: 2026-09-29_part-models-batch6
change_type: research
amends: 2026-09-29_part-models-batch5-fixes
scope: docs/wiring/calc-data/cad/fab/ (fam_sensors2.py new; fam_power.py, render_part.py), docs/wiring/calc-data/catalog/part_models.yaml, nuke_frontend/public/wiring/part-models/index.json (both regenerated)
author: claude-opus-5-5 (parts-artist lane, session ebc425ad)
owner_words: "if a part doesnt have its 3d then the endpoint isnt complete" (2026-09-29, relayed by the pieces lane)
---

# Batch 6: the TE splices at every end that names them, the throttle body, the speed sender and the A/C high-side switch

## What changed
- **fam_power.py: TE sealed in-line crimp splices.**
  - Parts: M81824/1-2 (TE D-436-37, blue code) and M81824/1-3 (D-436-38, yellow).
  - Each is drawn with its PVDF sleeve (27.94 long, the as-received ID), its crimp barrel (ØA, ØB and C, at the
    mid of TE's limits) and its two sealing rings (one clear, one colour-coded).
- **fam_power.py: TE stub splicers.**
  - Parts: D-609-03, D-609-04 and D-609-05 (TE 680104-000, 680105-000, 680106-000; red, blue, yellow).
  - Each is a bare tin-plated barrel closed at one end, 7.11 long, drawn at the mid of TE's ID and OD limits.
- **Each splice lands on the ends that name it.**
  - The ends come from the registry's terminations and the endpoint kits, not a hand list:

    | Splice | Ends |
    |---|---|
    | M81824/1-3 | the 14 PDM pigtail splices |
    | M81824/1-2 | SPL-FUEL-SND |
    | D-609-05 | SPL-PDM30-OUT5, OUTLET-12V, RAIL-COIL_PWR (kit: 7), RAIL-INJ_PWR (kit: 7), FLOOR-DIMMER |
    | D-609-04 | VSS-SENDER, DAKOTA-VHX, RADIO, ISOLATOR |
    | D-609-03 | 16 ends: SPL-ISO-YEL, VSS-SENDER, DAK-CTS, DAK-OILP, APS, DAKOTA-VHX, the lamps, USB-PORT, RADIO, MIRROR-MON, ALTERNATOR-SENSE |

  - Every stub end lists "a heat-shrink cap for each stub splice (not named in the registry)" as missing.
    MIRROR-MON and RADIO also list their unsized "D-609 (gauge unknown)".
  - The MiniSeal reasons for the 19 SPL/RAIL ends are gone: those ends now have models.
- **fam_sensors2.py (new): three bodies, each sized off the maker's photo from one sourced number.**
  - GM/Hitachi 12699160 throttle body (TB):
    - Scaled from the build manifest's "about 92 mm" bore, now basis `vendor`, because no GM drawing on file
      states it.
    - Its depth is assumed.
  - Dakota Digital SEN-01-5 speed sender (VSS-SENDER): scaled from its 7/8-18 thread.
  - Vintage Air 11079-VUS binary switch (AC-HP-SW): scaled from its 3/8-24 thread.
  - The sensor-lane ends that cannot be drawn yet are listed with the reason: KNOCK-1/2, OILP-ECU, DAK-CTS,
    DAK-OILP, AC-LP-SW, GSS-SENSOR, BRAKE-FLUID-LVL, both PCS-HARNESS-4610 ends and CAN-BUS.
- **Ends marked incomplete:**
  - AC-HP-SW, because the registry's terminations say the plug is "open (connector not picked)".
  - TB, because the ICT WCTHB50 kit plug's housing part number is not on file.
- **render_part.py:** the camera's clip start is now 0.5 mm. Blender's 0.1 m default rendered parts under about
  30 mm as a blank frame.

## Sources
- **In-line splices:** TE Customer Drawing D-436-36/-37/-38, "Sealed In-Line Crimp Splice, SAE AS81824/1", rev F1
  (2022-02-17), Table I.
  - Read in a browser by the pieces lane on 2026-09-29, from te.com/en/product-650076-000.html.
  - Sleeve: length 27.94 ±1.27; ID as received 2.79 (/1-2) and 4.32 (/1-3).
  - Barrel: ØA 1.75/1.63 and 2.60/2.46; ØB 2.70/2.57 and 3.89/3.73; C 14.86/14.35; D 7.11/6.60 × 2.
  - The stated finish is transparent blue PVDF, with two sealing rings, one clear and one colour-coded.
- **Stub splicers:** TE Specification Control Drawing D-609-03/-04/-05, issue 1 (read by the pieces lane).
  - ID 1.27/1.13, 1.75/1.62 and 2.59/2.46; OD 2.03/1.90, 2.69/2.56 and 3.89/3.73.
  - Red, blue and yellow.
  - The length, 7.11, is from TE's product pages.
- **TB:** docs/wiring/twin/dimensions_v3.json (the build manifest's line for 12699160). GM's product photo
  12699160_Primary (part_media TB), ±20 %.
- **VSS-SENDER and AC-HP-SW:** part_media's thread designations (7/8-18, 3/8-24). Summit's product photos, ±15 %.

## Found in the registry, not fixed (for the registry pass)
- **SPL-ISO-YEL.** Its termination names D-609-03 (drawn here). Its endpoint's open note says to size the stub by
  total CMA (16 + 22 AWG) and points at D-609-04.
- **SPL-PDM30-OUT5.** Its device text and terminations say one D-609-05 stub (drawn here). Its note says "in-line
  MiniSeal M81824/1-2".
- **Stub caps.** No stub splice has a cap named. This covers 22 ends. In all, the splices land on 37 ends: 15 in-line
  and 22 stub.

## Unknowns (red or ± in each drawing)
- **In-line splices:** TE prints no sleeve OD (a 0.35 wall is drawn) and gives no size or place for the sealing
  rings.
- **Stub splicers:** the closed end's wall and the colour code's form are assumed.
- **TB:** the depth is assumed; the photo-scaled features are ±20 %; the pin order is OPEN in the registry.
- **VSS-SENDER and AC-HP-SW:** the bodies are photo-scaled, ±15 %.

## Result
- **The index:** 117 models. 98 of 179 ends have a model and 63 of those are complete; 18 more ends are listed with
  the reason they have none.
  - Complete went from 48 to 63: the 15 in-line splice ends are now complete.
  - VSS-SENDER, AC-HP-SW, and every stub end stay incomplete for the reasons above.
- **Checks:** every build-time check passes, and the GLBs, STEPs and JSON have no 32-hex run and no credential word.
