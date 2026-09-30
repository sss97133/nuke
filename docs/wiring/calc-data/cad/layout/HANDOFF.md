# Pieces lane handoff (2026-09-30, final push before the owner's flight)

The pieces lane places every K5 harness end, audits each part and each other lane's work against its sources, and
publishes the results for Skylar. This folder keeps the scripts that otherwise live only in a session scratchpad: the
ends list, the world positions and the true-size footprints. Paths inside them are local (the session scratchpad,
~/k5-harness-pull); re-point them before running. The layout page's builder lives on branch `wiring/layout-ui`
(docs/wiring/calc-data/layout/, its own HANDOFF.md).

## Where things stand (all merged unless noted)
- **3D coverage** (part-model index on main): 195 models; 161 of 179 ends modelled, 128 complete. By the weakest source
  of shape per end: maker drawing 40, datasheet dims 36, scaled from photo 43, twin object 11, not sourced 31.
- **nuke.ag MAP tab** (#458): live, results only for visitors (lead and pieces both checked logged out, 2026-09-30):
  https://nuke.ag/vehicle/e08bf694-970f-4cbe-8a74-8715158a0f2e/wiring?tab=map
- **Workspace artifact** v20: https://claude.ai/artifact/QVLCDvWkF2XJ6DABBodakh (private). Coverage split by source,
  "modelled, not complete: <missing>" per end, the 61-pin cavity map (#460), the service-manual sections.
- **Firewall** (#452, state 0aj): insert 25-61 stays. The isolator's 16 AWG control circuit stays in the bay on two
  relays; 4 x 22 AWG signals cross; FAN_PWM moves to the bay PDM (61 of 61). The Dakota senders move to CAN only when a
  wheel-speed or fuel-temperature option is built (owner's call on his dual-sender lock).
- **Adapter plate** (#457, #459, #463): stamped outputs (12-hex blob + parameters, --check lint), spot face to 2.794 mm,
  ring gasket, jam nut 120-130 in-lb. The fuse-panel opening is a rounded trapezoid (AAW 510351 illustration) at an
  ASSUMED 4.0 in; the tape measure closes it.

## The 3D layers on the MAP tab (2026-09-30, about 11:10Z)
- **Merge order.** #470 (frame and front sheet metal) merged at 11:02Z. #472 (the layer loader, the true-size parts and
  the hide lists, head 171198052) merges on green, then #468 (the engine, head 8503ee923). The loader draws a layer
  only when its file is served as a GLB; the site's HTML fallback doesn't count.
- **What the layers hide** (#472 scene3d.ts, checked against the three v4 zone GLBs):
  - The engine layer hides 82 of the zones' 92 E3 nodes. Still drawn: the starter and solenoid, the as-built FPR and
    the 6L90 (the new model has none of them). The TB part swap hides the four TB nodes.
  - Sheet metal hides the five flat CTX faces, the toe board included. Frame hides the two rail webs.
  - ZONE_HIDES hides the COIL-1..8 bodies and plugs (see the first item below).
- **Next session, from this pass:**
  1. **The coil bodies are misplaced.** The v4 zone GLBs draw the COIL-1..8 bodies on a 1.37 m ring centred near twin
     (0, -0.10), 45 degrees apart: outside the doors, outside the rear quarters and behind the rear axle. Their towers
     sit on the real cap ring behind the intake (radius about 0.095 m), which is a scale error of about 14x. The fix:
     place the 12611424 true parts on the DEL-Stributor plate, then check the plate against the new intake (the engine
     receipt has coil_1 5 mm inside the rear runner).
  2. **The TB is off its harness spot.** It now stands on the engine layer's tb_flange, 85 mm aft of the tps anchor its
     drop routes to. Move the anchor in the registry pass.
  3. **Injector picking is per bank.** The engine GLB draws one injector mesh per bank, so a pick can't select one
     INJ-n. Split engine_ls3.py's injectors into eight nodes named by end code.
  4. **AC-CLUTCH has no 3D.** A/C is planned (the hard parts were ordered 2026-09-24, state §1), but the installed
     Mid-Mount is the A/C delete. The engine lane models the SD7 and its bracket (Holley's render puts it high on the
     passenger side).
  5. **How the new engine fits the new frame.** This is a mesh check of vertices against #470's rail_profile with its
     57 mm inboard flange:
     - No part enters a rail.
     - The tight spots: header_L comes 2 mm inside the driver flange tips and 1.9 mm from frame_engine_mount_L;
       header_R comes 5 mm from its flange tips.
     - The down-pipes are 3.5-9 mm from the dash panel, and the heads 21 mm from the toe board.
     - The oil pan clears crossmember 2 by 47 mm.
     - chassis-3d's rail clash was with the old twin headers, which the engine layer hides.
  6. **The header brand and part number are unknown.** The owner's two eBay listings return HTTP 403 to a text fetch.
     Ask him to paste each title and its item specifics; the header parameters are engine_ls3.py's hdr_* rows.

## Stopped agents' next steps (stopped by the owner 2026-09-30, no handoff of their own)
- **parts-artist** (fam_* generators, cad/fab/):
  1. The ends with no model: KNOCK-1/2, OILP-ECU, AC-LP-SW, GSS-SENSOR, BRAKE-FLUID-LVL (BRAKE-WARN-SW: switch body
     only, if sourced). CAN-BUS, PCS-HARNESS-4610(-CASE), COIL-GROUND-RINGS, GND-SPLICE-REAR need a pick first. The
     six FUSE-* stay reasons until the 5065 can be sized (ruler sourced: Littelfuse 257 ATO; no seated-fuse photo).
  2. M39029/58-363 and /56-351 contacts: TE's QRG and Preci-dip's brochure give cross-references only (56-351 =
     Preci-dip 83021-1P4-7110-B1), no dimensions. Find a text source.
  3. Builder check: whether the /24WJ61SN body flat sits on the master-keyway side (MILNEC p.B-15 puts the key at 12).
- **harness-cad** (brake job, never pushed): the brief is saved in the lane scratchpad as brake_brief.md. Master
  cylinder (Gen 1 iBooster) -> the valve on the front crossmember (owner testimony; factory spot by the master cylinder,
  LTSM p.385, photo 896767b8) -> front hoses -> frame-rail line; BRAKE-WARN-SW at the valve; tube OD from the LTSM or
  ASSUMED. Then the body and interior accuracy pass.

## For the registry pass (the lead's queue)
12084200 + 15324974 on CKP/CMP/MAP; name the M27500 conductor spec; split PS-STUDS by owning device; the ring picks
already in the terminations (families.yaml ring_small is stale); PDM stud caps; the D-609 stub caps (15 device ends wait
on it); SPL-ISO-YEL and SPL-PDM30-OUT5 splice mismatches; D-609 with no gauge on MIRROR-MON and RADIO; the AC-HP-SW plug;
the QFS kit pigtail vs our DT/DTP at the tank; the isolator rewire per #452; retire FIREWALL-BODY-A/B/C/P; the 14 public
harness_endpoints names with purchase stories (clean endpoints.yaml at the source, mask the live rows by migration); the
3 owner items as DB calls with kinds money/hands/credentials.

## Waiting on Skylar
- Send the Blue Sea question (the lead has the draft).
- A tape measure on the bare fuse-panel opening, and the proportioning valve's part number, next time at the truck.

## Audit rules learned the hard way
- Compare cavity names case-sensitively (the 25-61 insert has A and a). My #445 audit lowercased them and missed a
  crossed map that #460 fixed.
- Read a part's unknowns from part_models.yaml; index.json's slim records don't carry them.
