# Receipt — Certification machinery: four artifacts filed

**Date:** 2026-07-12 · **change_type:** research + substrate_correction pointers
**Context:** Skylar named his real blocker: not knowledge, but the lack of a certification mechanism — no way to know a design is right without Dave. Four artifacts were built (workflow wf_bc489da4, 4 builders + 4 adversarial "Dave-shredder" reviewers, all PASS_WITH_FIXES) to replace "full confidence" with verifiable process. Each is filed with its red-pen log prepended.

## Filed artifacts
1. `M130_PINOUT_TRIANGULATION_MATRIX.md` — all 41 K5-used M130 pins cross-checked 3-way (cut list v4.2 × MoTeC techspec pp.16-18 × Dave's Bronco build). **Zero function-class conflicts. 20 pins device-matched to Dave's real build.** Residual Dave list ≈ 3 items.
2. `COMPUTER_PLACEMENT_MEMO.md` — M130 cabin-side passenger firewall at the bulkhead; PDM30 passenger under-dash open air; Dakota VHX box driver under-dash near cluster. Architecture DECIDED; only physical mounting verification remains.
3. `DAKOTA_VHX_ARCHITECTURE.md` — the honest "jailbreak" answer: no direct gauge drive exists (box IS the driver); BIM-01-2 is dead (OBD-II, M1 GPR doesn't speak J1979); **BIM-EFI-1 mode F13 natively reads the M1 General CAN stream (0x640, 1 Mbps)** — tach/speed/coolant/oil-PSI/fuel over 2 wires, deleting 5 wires + duplicate senders. Fork presented, locked dual-sender NOT unlocked.
4. `FIRST_POWER_CERTIFICATION_LADDER.md` — 6-stage test protocol (buzz-out → resistance sanity → rails-first PDM power w/ M130 disconnected → sensors-only → no-start crank ref/sync → first start). Shredder corrected: knock sensors read **93–107 kΩ** (not OL); pin ranges enumerated not elided; NO open-secondary coil firing during timing check; cross-mate warning (ECU + PDM use identical Superseal shells).

## NEW substrate findings (need state-file action)
- **F1 — 6L80E CAN-master hole (biggest genuine gap found):** Holley doc 199R12431 p.1: the Terminator X Max ECU is **REQUIRED** for 6L80E control — the "T43" is the TCM *inside* the transmission; 558-499 is a harness/gateway, not a standalone box. The M130 is not a Terminator X Max. Locked row "6L80E TCU = Holley 558-499" (2026-05-14) has an unresolved master. Buildable options: Terminator X Max ride-along (own bus) vs PCS-class external TCU vs re-examine. **Owner fork.**
- **F2 — battery isolator UNSELECTED:** confirmed E-Stopp ESK001 = electric parking brake (NOT a disconnect). No isolator device is chosen; MoTeC requires isolator w/ aux contact → ECU shutdown input; that shutdown wire is absent from cut list v4.2 (assign a free UDIG B08-B11/B14).
- **F3 — missing wires found:** Dakota CONST-12V (always-hot, 18 AWG) absent in both gauge paths; Holley trans harness brake-switch + park/neutral-interlock loose wires unhomed; Dakota power/ground must be **18 AWG** (manual spec) — cut list has 22.
- **F4 — #98 fuel level still has no AV pin** (proposal: B20/AV6); prerequisite for fuel-over-CAN.
- **F5 — CAN bus is ONE bus, now 4 nodes if BIM lands** (M130 + PDM30 + T43 stub + BIM) — termination plan needed (120Ω placement) before any splice.

## Dave's actual 5-minute list (post-triangulation)
1. Crank/cam supply: 5V (A02/A09 rails) vs his Bronco's B19 6.3V for REF/SYNC — shredder note: GM 58x CKP is documented 5V hall, so likely closable from the sensor datasheet alone.
2. AT1 pull-up rail letter (MoTeC's own two docs disagree on AT1 only) — or just measure it.
3. Throttle-motor on OUT_HB1/HB2 confirm (his Bronco is not drive-by-wire).

**Supersedes nothing; informs:** state §1 E-Stopp row (mislabel), §3 (add F1/F2 as open), cut list next rev (F3/F4).

## ADDENDUM — Rulings (2026-07-12, evening): the agent is the certifying authority
Skylar's correction: "you're supposed to be my dave." Deference to external review is retired; rulings below stand on cited documentation + the first-power test ladder, not on a human reviewer.
1. **Crank/cam supply = 5V (A2/A9). B19 unused.** GM Gen IV 58x (BOM 12615626 family) = documented 5V open-collector hall (adversarially web-verified this session); UDIG internal pull-up configured at tune. Bronco's B19/6.3V practice is sensor-specific to that build, not applicable.
2. **AT1 pull-up rail-letter discrepancy = non-issue.** AT sensors are 2-wire; no wire changes either way. Bench-measure at first power for diagnostics only. CLOSED.
3. **DBW throttle (HB1/HB2 full bridge) + pedal split across 5V rails = correct as designed** (techspec pp.16-17; MoTeC standard ETB config). CLOSED.
4. **#98 fuel level = B20/AV6 + 270Ω pull-up.** RATIFIED (last free AV, no collision; math in K5_wire_spec_and_costs.md Job 1). Next cut-list rev.
5. **Master isolator = 4-post mechanical master switch** (Moroso 74102 / Longacre class), mains in BAT+ at battery corner, aux contact → B8 (UDIG3) as MoTeC-required ECU shutdown. Cartek GT = fallback only if corner unreachable at mockup. Spine tranche. Partially closes §3 0b (device class ruled; PN finalized at spine order).
6. **M130 wake (A26) = ignition-keyed master relay.** PDM 30/30 full eliminates the freed-channel option. Closes the v4.1 open switching-element question.
7. **6L80E CAN master = in research** (background agent, 4 paths: TXM trans-only ride-along / external TCU claims / M1-custom-CAN / 4L80E escape hatch). Blocks nothing current.
Sheet updated in place (both copies): amber cleared on ruled rows; remaining ▲ = 3 items.
