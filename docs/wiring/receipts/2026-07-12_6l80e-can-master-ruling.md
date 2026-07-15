# Receipt — 6L80E CAN-master ruling: PCS TCM-2650 (Holley path dead)

**Date:** 2026-07-12 · **change_type:** decision (agent ruling per certification-authority protocol) · **resolves:** state §3 0a
**Evidence:** background research agent a9d4bcca (5 paths, all web-verified, full citations in session; fetched datasheets in session scratchpad).

## The landmine defused
The locked 2026-05-14 row "6L80E TCU = Holley 558-499" **was never buildable on this truck**:
1. Holley 199R12431 p.1 + product page: the 558-499 requires a **Terminator X Max engine ECU** as CAN master — the M130 is not one, and a trans-only TXM ride-along has **zero documented instances** (its Virtual Torque derives from its own fuel-flow; no CAN path into its RPM/TPS channels).
2. **The 558-499 kit explicitly does not support 4WD.** The K5 is an NP205 4x4. Dead on arrival regardless of ECU.

## The ruling: PCS TCM-2650
The T43 TCM inside the 6L80E cannot be bypassed, reflashed standalone (HP Tuners staff: myth), or solenoid-driven externally. Every working solution impersonates a GM ECM over CAN. Two products ship; one fits this truck:
- **PCS TCM-2650** (~$1,000–1,130 w/ harness; PSI Conversion / Zero Gravity): CAN master that synthesizes GM ECM traffic to the factory internal T43; needs only a 0–5V TPS signal + engine RPM from any source; "any vehicle with any engine combination." **Field-proven behind non-GM-CAN engines including a mechanical 6.5 diesel** (Truck Stop thread) and two Torque Up (AU) LS builds; PCS dealer on Holley's own forum: "The ONLY way is to use the PCS TCM-2650."
- Everything else verified dead: US Shift (6R80 only), HGM ("coming soon" for years), PCS TCM-2800/SimpleShift (solenoid-drivers, ≤4L80E), GM SuperMatic (license-locked to CP crate ECMs), M1-custom-CAN (no published T43 frame recipe; GMLAN maps stop at signal names — no byte offsets/DBC).

## Wiring consequences (clean)
- **PCS↔T43 GMLAN link = a private 2-node bus.** The M130 CAN bus (M130+PDM30+UTC+possible BIM) is untouched — resolves the F5 4-node congestion worry for trans.
- Wire #125 repurposes as the PCS↔T43 stub.
- **PCS RPM feed = spare half-bridge A33 (OUT_HB5)** as a tach-mirror output — identical pattern to Dakota tach on A31. GPR config at tune.
- TPS = tee off TPS1 (A14) or PCS remote-TPS kit ($170) if loading is a concern.
- The F3 loose wires (brake +12V, park/neutral starter interlock, 5A constant battery) get homes in the PCS harness equivalents.

## Two free verifications BEFORE the PO (Skylar's calls; questions ready)
1. **PCS (via PSI Conversion or Zero Gravity):** "Does the TCM-2650 support a 4WD-output 6L80 with [this trans's] T43 OS? Holley's kit excludes 4WD — do you share that limit?" (4WD T43 OSes exist — GM sells 4WD SuperMatic 6L80 kits.)
2. **MoTeC USA + John Reed Racing:** "Does your GM T43 GMLAN integration (JRR Gen5 Camaro M150 kit) run on an M130 (single CAN)?" — if yes at sane cost, the single-ECU architecture revives.

## Fallback (only if #1 fails verification)
4L80E + US Shift Quick 4 (~$4.5–8.5k after 6L80E resale, loses 2 gears, real mechanical rework). Note: GPR-AT is M150/M190-only (needs HB7–HB10; M130 tops at HB6) — "MoTeC-native 4L80E" would mean a new M150 + license, ~$7.5–12k. Not recommended.

**Cost:** ~$1,100–1,700 all-in (controller + optional TPS kit + optional MPVI3 $399 for shift-table work). Orders with the computers in a few weeks. Blocks nothing current.

## CORRECTION (2026-07-12, close): trans is a 6L90, not 6L80E
Skylar verbal at session close. Ruling unchanged — PCS TCM-2650 supports 6L80E/6L90E/6L50 (the documented diesel install WAS a 6L90); Holley 558-499 covers 6L80/6L90 and is dead for both (TXM required + no 4WD). Verify call updated: 4WD-output 6L90 T43 OS. **Substrate audit owed:** every 6L80E mention (state §1 2026-05-14 row, appendix-d, vehicle_build_manifest, cut list #125 note) — device identity was never verified against the truck; the correction came from the owner, not from any document. Lesson filed.
