> **RED-PEN LOG (adversarial review, 2026-07-12) — verdict: PASS_WITH_FIXES.**
> The corrections below were found by an independent shredder pass and OVERRIDE the body where they conflict. Per repo culture the body is preserved, not silently rewritten; apply these before building from this doc.

- **FIX:** MISSING WIRES (most serious): 199R12431 p.3 lists FOUR loose wires on the trans harness — Power (red), Ground (black), Brake Switch (Lt Blue/White, must see +12V from the brake-light switch), and Park/Neutral Safety (Yellow, starter-solenoid interlock: grounded in P/N, open in gear). The memo re-derives #125 and #58 but never enumerates the P/N interlock, brake-switch, or ground wires — none exist in cut list v4.2. The yellow P/N wire sits in the exact starter/E-Stopp circuit the memo touches at the battery corner. This is the same missing-wires class that forced v4.1 (ECU lifelines) and v4.2 (APS pedal). Add all four to the open items / cut-list amendment.
- **FIX:** UNDERSTATED: 199R12431 p.1 says 'The Terminator X Max ECU is REQUIRED for GM 6L80/90E transmission control' — not 'assumes.' The harness physically terminates in J3/J4 connectors that plug into a Terminator X Max; with only an M130 on the truck the harness has nothing to plug into, and the TCM CAN pair (J3 pin B14 TAN / B20 TAN-BLK) must be repinned to reach M130 B17/B18. Upgrade the open item: as shipped, this kit cannot talk to an M130 at all — either a Terminator X Max rides along as trans-only master (two-ECU architecture, handheld flash workflow) or a custom M1 package + repinned CAN interface is engineered.
- **FIX:** SINGLE CAN BUS GLOSSED: M130 datasheet p.2 — 'CAN bus: 1.' The PDM30 is wired onto that same bus (PDM30 datasheet p.2), the heat-soak logging uses it, and the proposed #125 re-derivation lands the T43's GMLAN traffic on the same B17/B18 pins. Bit-rate and message-ID coexistence of GM T43 GMLAN with the MoTeC PDM protocol on one shared bus is part of the CAN-mastering open item and must be named — the M130 has no second CAN bus to give it (Ethernet is not CAN).
- **FIX:** TEMP CRITERION UNCONSERVATIVE: −40 to 85 °C is the M130's INTERNAL operating range (M130 datasheet), not an ambient allowance. The heat-soak plan 'validates the M130's local ambient against its 85 °C ceiling' passes a box that could still exceed 85 °C internally under load. Log the M1's internal ECU-temperature channel during the 30-min soak, not just local ambient.
- **FIX:** ADJACENT MISS: the memo anchors '#123 dash star ground: local' while quoting MAN 650314:P for placement — but the same manual's GROUND terminal description (p.6) requires '18 AWG or larger' to the vehicle's MAIN chassis ground, and cut list #123 is 22 AWG to a dash star point. Flag it the same way #58 was flagged (conflict surfaced, not silently fixed).

**Shredder's notes (why):**
- *A 'consequences' memo that opens the Holley harness doc and still leaves the park/neutral starter-interlock wire unhomed — that wire decides whether the truck can crank in gear; it is not optional trim.*
- *'Contact MoTeC support' as the action on a kit whose own page 1 says a different brand's ECU is REQUIRED — the buildable options should be stated now (Terminator X Max rides along vs custom M1 package + repin), not after an email.*
- *Citing '§1.4.1' of the spine study when the study has an unnumbered list under §1.4 — cite what the document actually says.*
- *Spine study P5 row estimates the battery→PDM feed at ~24–30 in; the memo quotes only the receipt's 16.7 in without acknowledging the earlier estimate it supersedes — cross-cite the supersession or someone re-finds the 30 in number and reopens it.*
- *The 60–80 mm connector clearance is quoted for the M130 plate but no equivalent clearance is stated for the PDM30's own #65044/#65045 boots on the under-dash plate — same connectors, same exit geometry, same requirement.*

---

# Computer Placement Memo — M130 · PDM30 · T43 · Dakota VHX

**Date:** 2026-07-12 · **Status:** DECIDED (mounting-hardware verification only remains; do not reopen)
**Inputs:** `K5_WIRING_STATE.md` §1/§4 · `receipts/2026-06-09_as-built-photo-survey-corrections.md` · `receipts/2026-06-10_battery-corner-rederivation.md` · `research/2026-06-10_power_spine_builders_study.md` · `reference/motec/VALIDATION_REPORT.md` · Holley 558-499 doc 199R12431 (documents.holley.com/199r12431.pdf, fetched 2026-07-12) · Dakota VHX manual MAN 650314:P p.4 (`reference_documents/component_drawings/dakota_digital_vhx_manual.pdf`)
**Fixed nodes:** battery = passenger firewall corner (owner working position, state §4); D38999 engine-only bulkhead on the firewall, passenger-side main pass-through zone (state §1 rows 43/50; spine study §1.1 FWG-MAIN/H3); gauge cluster = stock bezel, driver side (`K5_DAKOTA_GAUGE_CARD.md` §d).

## The decisions

| Box | Placement | Anchor runs |
|---|---|---|
| **MoTeC M130** | **Cabin side, passenger firewall, on the inner face adjacent to the D38999 bulkhead.** Connector face oriented with 60–80 mm clear for the 18° Superseal exit + boot. Vibration-damped bracket, not rigid to bare sheet metal. | D38999 tail: inches. #ECU_PWR/#ECU_GND1/2 to battery stars: one corner crossing, ~2–3 ft (cut list says 4.6 ft zone estimate — see consequences) |
| **MoTeC PDM30** | **Cabin side, passenger under-dash, OPEN mounting — no closed pocket, free airflow on the case.** Near the firewall corner so the battery feed stays short. Separate plate from the M130 with an air gap between them (PDM runs hot; M130 has an 85 °C ceiling). | #PDM_BPOS: 16.7 in derived (battery-corner receipt). PDM outputs to dash/body loads: local |
| **Holley 558-499 “T43”** | **There is no box to mount.** Holley's own document: the kit "communicat[es] via CAN with the internal GM TCM" and "The TCM within the physical transmission will need to be programmed via the Holley EFI OBDII Transmission Tuning Handheld" (199R12431). The T43 lives inside the 6L80E, which is already installed (as-built receipt §4). What DOES get a home: **the OBDII tuning port — driver under-dash near the column**, per Holley "installed in an easily accessible area." | Trans connector: passenger rear of the transmission case (199R12431). OBDII port: dash-local |
| **Dakota VHX control box** | **Driver side under dash, within 3 ft of the cluster** (supplied CAT5; replacement patch cable ≤7 ft allowed), **both terminal rows accessible**, secured by the two case tabs / hook-and-loop per manual. Keep it off the firewall face — manual warns against mounting "next to or just opposite of the firewall from ignition components" (MAN 650314:P p.4); the K5's coils are DEL-Stributor central engine mount (state §1), so driver under-dash is clean. | CAT5 to cluster: ≤3 ft. #123 dash star ground: local |

## Why (the constraints that force this — all previously in substrate)

- **M130 cabin side** is the convergence of four independent constraints: (1) MoTeC environment — "protected location, occasional splash only," 85 °C ceiling, no rigid mount to undamped vibrating structure (as-built receipt, MoTeC-constraints section; state §4); (2) the firewall bulkhead is **engine-signals-only** (state §1 row 50, Dave correction) — engine wires arrive at the cabin face, so the ECU sits where they land; (3) engine-bay mounting would add **+6 bulkhead crossings** for the pedal wires (cut list v4.2 header; state §1 row 46); (4) the ECU lifelines are 16 AWG and **cannot pass through the D38999** (#20 contacts, 20–24 AWG only — state §1 row 43), so they use the corner power pass-through the spine study already routes for the PDM feed (spine study §1.2 table) — shortest when the M130 is at that corner.
- **PDM30 under-dash passenger** is the standing working position (landmark A2, cited in spine study §1.1) and the payoff of the battery corner: the feed crosses the firewall in inches (spine study §1.2). The hard conditions carried from state §4: it **runs hot, a closed pocket is disqualified**, and the spot is only final after a **30-minute CAN-logged heat soak** — that one test also validates the M130's local ambient against its 85 °C ceiling.
- **Shared bracket geometry:** M130 and PDM30 have identical cases (107.5 × 127.5 × 38.7 mm, 3× ⌀5.2 mm holes for M5 — VALIDATION_REPORT.md "Case dimensions"/"Mounting holes" rows and its note that the two are "physically interchangeable in terms of mounting") — one bracket design, two plates.
- **Dakota box driver side** because the box must live within the CAT5's reach of the cluster and the cluster is fixed in the stock bezel. The 11 dual-sender wires reach it as follows: coolant-temp #114 and oil-PSI #115 cross via the D38999 (they are in the row-43 overflow set that the row-50 engine-only rule frees), then run cross-dash; fuel #117 arrives with the body harness from the tank; tach #116 / speedo #118 come from the M130 (passenger cabin) cross-dash; #119–#122 are dash-local taps; #123/#124 are dash-local.

## Discrepancies this memo surfaces (flag, don't silently fix)

1. **Cut list #125 note "Module in cab" is wrong.** No cab module exists (199R12431). The CAN stub's real far end is the Holley trans-harness interface, not a cab box — 2.0 ft length is invalid, needs rederivation.
2. **Cut list #58 "Powers Holley 558-499 T43 module (3A)" conflicts with Holley:** the trans-harness power (red) wire "should be connected directly to the battery or a constant battery source capable of supplying 5 amps" (199R12431, Loose Wires). 3 A < 5 A, and OUT23 is switched, not constant. PDM config/rating decision needed.
3. **CAN mastering:** 199R12431 assumes a **Terminator X Max ECU** as the CAN master talking to the internal T43. Whether the M130 can speak T43 CAN directly is UNVERIFIED — MoTeC's GPR-AT package is direct-solenoid control up to 5 gears (GPR_AT_M1_Package datasheet, milspecwiring.com), which does not cover a CAN-mastered 6-speed. This does not reopen the locked 6L80E decision (internal-TCM-over-CAN stands); it names the integration work.

## Cable-run consequences vs cut-list zone estimates

| Wires | Cut list | Consequence of these placements |
|---|---|---|
| Engine loom → M130 (4.6 ft class) | zone estimates | Stand — path is device → D38999 → short cabin tail. No change class |
| #APS_* (6 wires, 3.5 ft) | dash zone | Stand; cabin M130 avoids the +6 crossings |
| #ECU_PWR/#ECU_GND1/2 (4.6 ft each) | "zone estimate, NOT measured" | **Shorter** (~2–3 ft): battery corner is inches through the firewall. Prototype at max length per Dave's method, then cut |
| #PDM_BPOS (3.5 ft) | zone estimate | **Shorter**: 16.7 in derived (battery-corner receipt) |
| #71 PDM → Dakota box (3.5 ft) | zone estimate | **Longer** (~5 ft): passenger under-dash → driver under-dash cross-car |
| #116 tach / #118 speedo (8.0 / 11.5 ft) | zone estimates | **Shorter** (~5–6 ft): both ends now in the cab, one cross-dash run |
| #114/#115 (8.0 ft = 4.6 engine + 3.5 dash) | zone estimates | Dash leg becomes cross-car — slightly **longer**; re-derive in the twin |
| #125 T43 CAN stub (2.0 ft) | cab-stub estimate | **Invalid** — re-derive once CAN mastering is resolved |
| #126 E-Stopp trigger (10 ft) | estimate | Unchanged — E-Stopp is at the battery corner either way |

## Physical verification remaining (mounting only — placements above are decided)

1. **Open the gold heat-shield panel question (Q4, as-built receipt)** — confirm what's behind it before drilling the M130/PDM plates into the passenger firewall inner face.
2. **30-min CAN-logged heat soak** with the PDM30 in its spot (state §4) — validates PDM ventilation AND M130 local ambient.
3. **Hood-hinge travel envelope** over the battery corner (spine study §1.4.1) — the power pass-through and M130 plate sit inboard of it.
4. **Dakota CAT5 reach check** — supplied cable ~3 ft; if the box lands farther, a CAT5/5E/6 *patch* cable ≤7 ft is manual-approved.
5. **Fab two shared-pattern plates** (3× M5 each per VALIDATION_REPORT) with damped mounts; verify driver under-dash clearance vs steering column and floor-dimmer for the Dakota box and OBDII port.
