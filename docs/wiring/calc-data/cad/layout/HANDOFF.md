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
