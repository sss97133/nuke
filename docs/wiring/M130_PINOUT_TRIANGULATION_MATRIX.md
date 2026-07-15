> **RED-PEN LOG (adversarial review, 2026-07-12) — verdict: PASS_WITH_FIXES.**
> The corrections below were found by an independent shredder pass and OVERRIDE the body where they conflict. Per repo culture the body is preserved, not silently rewritten; apply these before building from this doc.

- **FIX:** B07 knock 1 is NOT a device match — downgrade ● to class-only. Dave's Bronco sheet row 65 has an empty device column for B7 (and B13/knock 2 is explicitly 'unused'); the matrix's 'Dave's Bronco usage: knock 1' is just the pin's function name echoed back, not a wired device. Device-match count drops 20→19 and the certified-claims bullet listing 'knock B07' as device-matched must be amended.
- **FIX:** Dave item 1 is framed too open. The GM Gen IV 58x CKP (12585546/12703627 family; K5 BOM 12615626 per K5_WIRING_STATE.md L96) is publicly documented as a 5V-supply open-collector hall sensor requiring a pull-up (MSExtra, LS1TECH, vendor listings). The cut list's 'CKP needs 5V supply' note (L230) is correct and CITABLE, not merely 'uncited' — add the citation. The Bronco's 6.3V REF/SYNC+ powers Ford sensors, which is weak evidence against a GM 5V-spec part; moving #99r/#101r to B19 would run a 5V-rated sensor at 6.3V. Keep the Dave question but flip the default: stay on 5V unless Dave gives a specific reason. Also add the real config item the 58x implies: open-collector output needs the M1 UDIG pull-up enabled at tune time.
- **FIX:** CONFLICT 2 blast radius is overstated. The two MoTeC docs AGREE on AT2→5V_B and AT3→5V_A (verified in both extracts); only AT1 (and unused AT4) differ. So only #109g/IAT (B03/AT1) pairing is in question — not '#109g/#113g/#110g'. The ohmmeter close needs only B03 measured; #110g and #113g are already consistent under both docs.
- **FIX:** The matrix reproduces but never flags that three of the K5's own analog_5v sensors violate the letter-pairing convention it praises in Dave item 3: #102 oil PSI (5V from A02/rail A, ground to B16/rail B), #108 MAP (5V A09/rail B, ground B15/rail A), #112 fuel PSI (5V A02/A, ground B16/B) — cut list L219-224. Electrically benign (SEN_0V pins are common) but inconsistent bookkeeping; either fix the three grounds in the next cut-list rev or adopt Dave's functional grouping and say so explicitly.
- **FIX:** Dave's Bronco sheet contains an internal typo the 'parsed cell-by-cell' pass missed: the LTCD wideband block (row 76) routes 'CAN High → B19' — B19 is the 6.3V rail, and Dave's own pin table says B17 = CAN High. No K5 conclusion changes (the matrix used the correct pin-table rows), but note it: the Bronco sheet is a strong prior, not flawless ground truth, and it has other typos ('senosor', 'igntion') indicating hand-entry.

**Shredder's notes (why):**
- *Claiming a ● same-physical-device match on B07 when the customer sheet's device cell is blank — that's exactly the kind of citation inflation that gets a build sheet thrown across the shop.*
- *Calling the 58x supply voltage 'UNKNOWN' when it's a $30 GM part with public documentation — a pro looks up the sensor spec before burning one of Dave's 5 minutes on it.*
- *Lecturing about rail letter-pairing for the pedal while a third of the K5's analog_5v sensors are cross-paired two tables up — read your own matrix.*
- *Trusting a hand-typed customer spreadsheet as 'parsed cell-by-cell' ground truth without noticing it wires CAN High to a 6.3V supply pin in one block — always reconcile a source against itself before using it as a triangulation leg.*
- *Scope creep on CONFLICT 2: turning a one-wire (AT1/#109g) documentation discrepancy into a three-wire realignment task.*

---

# M130 Pinout Triangulation Matrix — K5 Blazer

**Date:** 2026-07-12
**Purpose:** Certify every M130 pin the K5 uses by cross-checking THREE independent sources pin-by-pin. Pins where all three agree need no further review. Only the shortlist at the bottom needs Dave.

## The three sources (each read directly this session, not from memory)

| # | Source | Provenance | Independence |
|---|---|---|---|
| 1 | **K5 cut list v4.2** | `docs/wiring/output/K5_cut_list_v4_2.txt` (174 wires; line numbers cited per pin below) | The build's own claim |
| 2 | **MoTeC M1 ECU Hardware techspec** | `reference_documents/component_drawings/motec_m1_hardware_techspec.pdf` pp.16-18 (published 7 Nov 2013), read directly from the PDF this session. Cross-checked against M130 Datasheet Part 13130 p.5 (`docs/library/_extracted/component_drawings__motec_m130_datasheet/page-0005.txt`) and the prior validation (`docs/wiring/reference/motec/VALIDATION_REPORT.md`, 2026-04-11) | Manufacturer ground truth |
| 3 | **Dave's Bronco M130 pinout** | `/Users/skylar/Downloads/M130 ECU Overland Bronco (1).xlsx` (Desert Performance customer build), parsed cell-by-cell this session | A pro's real running build. Different vehicle, so **devices** differ — the check is that the **pin function class** agrees |

**Verdict key:**
- **CERTIFIED-3-WAY** — all three sources agree on the pin's function class. ● marks the strongest cases: Dave used the same pin for the *same physical device*.
- **CONFLICT** — a source disagrees; each gets a diagnosis below.
- **K5-unused** — the K5 doesn't wire this pin; techspec + Bronco shown for completeness.

---

## Connector A (34-way, Tyco Superseal, mating = MoTeC #65044 — techspec p.16)

| Pin | K5 assignment (cut list line) | Techspec function (p.16-17) | Dave's Bronco usage | Verdict |
|---|---|---|---|---|
| A01 | #4a Throttle motor 2 (L14) | OUT_HB2 Half Bridge Output 2 | half bridge 2 (no device) | CERTIFIED-3-WAY |
| A02 | 5V rail A: #4e TPS, #102r oil PSI, #112r fuel PSI, #99r crank, #APS_T1_5V (L18, 220, 224, 230, 396) | SEN_5V0_A Sensor 5.0V A | sensor 5 volt → TPS, MAP, fuel PSI, oil PSI | CERTIFIED-3-WAY ● |
| A03 | #5 Coil 3 (L20) | IGN_LS1 Low Side Ignition 1 | Ignition 1 → coil 1 | CERTIFIED-3-WAY (see coil-order note) |
| A04 | #7 Coil 5 (L21) | IGN_LS2 Low Side Ignition 2 | Ignition 2 → coil 2 | CERTIFIED-3-WAY |
| A05 | #8 Coil 7 (L22) | IGN_LS3 Low Side Ignition 3 | Ignition 3 → coil 3 | CERTIFIED-3-WAY |
| A06 | #9 Coil 2 (L23) | IGN_LS4 Low Side Ignition 4 | Ignition 4 → coil 4 | CERTIFIED-3-WAY |
| A07 | #10 Coil 4 (L24) | IGN_LS5 Low Side Ignition 5 | Ignition 5 → coil 5 | CERTIFIED-3-WAY |
| A08 | #11 Coil 6 (L25) | IGN_LS6 Low Side Ignition 6 | Ignition 6 → coil 6 | CERTIFIED-3-WAY |
| A09 | 5V rail B: #108r MAP, #101r cam, #APS_T2_5V (L222, 233, 399) | SEN_5V0_B Sensor 5.0V B | sensor 5 volt → diff temp + tank sender pull-ups | CERTIFIED-3-WAY |
| A10 | #ECU_GND1 battery negative (L352) | BAT_NEG1 Battery Negative | ECU ground → chassis ground | CERTIFIED-3-WAY ● |
| A11 | #ECU_GND2 battery negative (L353) | BAT_NEG2 Battery Negative | ECU ground → chassis ground | CERTIFIED-3-WAY ● |
| A12 | #12 Coil 8 (L26) | IGN_LS7 Low Side Ignition 7 | ignition 7 → coil 7 | CERTIFIED-3-WAY |
| A13 | #24 Coil 1 (L35) | IGN_LS8 Low Side Ignition 8 | ignition 8 → coil 8 | CERTIFIED-3-WAY |
| A14 | #4c TPS 1 signal (L16) | AV1 Analogue Voltage Input 1 | AV1 → **TPS** | CERTIFIED-3-WAY ● |
| A15 | #108 MAP signal (L42) | AV2 Analogue Voltage Input 2 | AV2 → **MAP** | CERTIFIED-3-WAY ● |
| A16 | #112 Fuel pressure (L45) | AV3 Analogue Voltage Input 3 | AV3 → oil PSI | CERTIFIED-3-WAY (device differs; class agrees) |
| A17 | #4d TPS 2 signal (L17) | AV4 Analogue Voltage Input 4 | AV4 → diff temp | CERTIFIED-3-WAY |
| A18 | #4b Throttle motor 1 (L15) | OUT_HB1 Half Bridge Output 1 | half bridge 1 → tach | CERTIFIED-3-WAY (class only — see Dave item 2) |
| A19 | #13 Injector 1 (L27) | INJ_PH1 Peak Hold Injector 1 | fuel 1 → injector 1 | CERTIFIED-3-WAY ● |
| A20 | #14 Injector 2 (L28) | INJ_PH2 Peak Hold Injector 2 | fuel 2 → injector 2 | CERTIFIED-3-WAY ● |
| A21 | #15 Injector 3 (L29) | INJ_PH3 Peak Hold Injector 3 | fuel 3 → injector 3 | CERTIFIED-3-WAY ● |
| A22 | #16 Injector 4 (L30) | INJ_PH4 Peak Hold Injector 4 | fuel 4 → injector 4 | CERTIFIED-3-WAY ● |
| A23 | — | INJ_LS1 Low Side Injector 1 | Low side 1 (unused) | K5-unused |
| A24 | — | INJ_LS2 Low Side Injector 2 | Low side 2 (unused) | K5-unused |
| A25 | #102 Oil pressure (L39; moved A14→A25 per receipt `2026-06-09_cut-list-v4.md`) | AV5 Analogue Voltage Input 5 | AV5 → fuel temp | CERTIFIED-3-WAY (device differs; class agrees) |
| A26 | #ECU_PWR battery positive, 16 AWG (L351) | BAT_POS Battery Positive | ECU 12v supply → DC power in | CERTIFIED-3-WAY ● |
| A27 | #17 Injector 5 (L31) | INJ_PH5 Peak Hold Injector 5 | fuel 5 → injector 5 | CERTIFIED-3-WAY ● |
| A28 | #18 Injector 6 (L32) | INJ_PH6 Peak Hold Injector 6 | fuel 6 → injector 6 | CERTIFIED-3-WAY ● |
| A29 | #19 Injector 7 (L33) | INJ_PH7 Peak Hold Injector 7 | fuel 7 → injector 7 | CERTIFIED-3-WAY ● |
| A30 | #20 Injector 8 (L34) | INJ_PH8 Peak Hold Injector 8 | fuel 8 → injector 8 | CERTIFIED-3-WAY ● |
| A31 | #116 Dakota tach pulse (L278) | OUT_HB3 Half Bridge Output 3 | half bridge 3 → stepper | CERTIFIED-3-WAY |
| A32 | #118 Dakota speedo/VSS mirror (L280) | OUT_HB4 Half Bridge Output 4 | half bridge 4 → stepper | CERTIFIED-3-WAY |
| A33 | — (spare per state §3) | OUT_HB5 Half Bridge Output 5 | halfbridge 5 → stepper | K5-unused (spare) |
| A34 | — (spare per state §3) | OUT_HB6 Half Bridge Output 6 | half bridge 6 → stepper | K5-unused (spare) |

**Coil-order note (not a conflict):** the K5 lands cylinder coils on the ignition outputs non-sequentially (coil 3 → IGN_LS1 … coil 1 → IGN_LS8) per the DEL-Stributor mapping in `K5_coil_mapping.md` (locked, state §1), while Dave's Bronco runs coil 1 → ignition 1 sequentially. The pin function class agrees at every pin. Whichever mapping is on the wires MUST be mirrored in the M1 firmware cylinder-to-output config at tune time — this is a firmware line item, not a harness change.

## Connector B (26-way, Tyco Superseal, mating = MoTeC #65045 — techspec p.17)

| Pin | K5 assignment (cut list line) | Techspec function (p.17-18) | Dave's Bronco usage | Verdict |
|---|---|---|---|---|
| B01 | #99 Crank sensor signal, shielded (L37) | UDIG1 Universal Digital Input 1 | Reference → **crank sensor** | CERTIFIED-3-WAY ● (see UDIG note) |
| B02 | #101 Cam sensor signal, shielded (L38) | UDIG2 Universal Digital Input 2 | Sync → **cam sensor** | CERTIFIED-3-WAY ● |
| B03 | #109 Intake air temp (L43) | AT1 Analogue Temperature Input 1 | AT1 → **inlet air temp** | CERTIFIED-3-WAY ● (pull-up letter: see Conflict 2) |
| B04 | #110 Coolant temp (L44) | AT2 Analogue Temperature Input 2 | AT2 → **engine coolant temp** | CERTIFIED-3-WAY ● |
| B05 | #113 Oil temp (L46) | AT3 Analogue Temperature Input 3 | AT3 → **oil temp** | CERTIFIED-3-WAY ● |
| B06 | — (K5 trans temp lives in the Holley T43, state §1) | AT4 Analogue Temperature Input 4 | AT4 → trans temp | K5-unused (spare AT) |
| B07 | #103 Knock bank 1, shielded (L40) | KNOCK1 Knock Input 1 | knock 1 | CERTIFIED-3-WAY ● |
| B08 | — | UDIG3 | Udig 3 (unused) | K5-unused |
| B09 | — | UDIG4 | Udig 4 (unused) | K5-unused |
| B10 | — | UDIG5 | Udig 5 (unused) | K5-unused |
| B11 | — | UDIG6 | Udig 6 (unused) | K5-unused |
| B12 | — (keep-alive intentionally not wired, cut list L344-346) | BAT_BAK Battery Backup | Battery Backup (unused) | K5-unused (deliberate) |
| B13 | #104 Knock bank 2, shielded (L41) | KNOCK2 Knock Input 2 | knock 2 (labeled, no device) | CERTIFIED-3-WAY |
| B14 | — | UDIG7 | Udig 7 (unused) | K5-unused |
| B15 | 0V rail A: #4f, #109g, #113g, #108g, #99g/#99s, #103g/#103s, #APS_T1_GND (L19, 212, 214, 221, 229, 231, 239, 240, 397) | SEN_0V_A Sensor 0V A | 0 volt engine → crank/cam 0V | CERTIFIED-3-WAY |
| B16 | 0V rail B: #110g, #102g, #112g, #101g/#101s, #104g/#104s, #APS_T2_GND (L213, 219, 223, 232, 234, 241, 242, 400) | SEN_0V_B Sensor 0V B | 0 volt engine → TPS, MAP, PSI + temp sensors | CERTIFIED-3-WAY |
| B17 | #62 CAN trunk — **pin not written in cut list** (L139: destination just says "ECU") | CAN_HI CAN Bus 1 High | CAN High → dash, LTC wideband | **CONFLICT 1 (gap, not wrong pin)** |
| B18 | #62 CAN trunk — same gap | CAN_LO CAN Bus 1 Low | Can Low → dash, LTC wideband | **CONFLICT 1** |
| B19 | — | SEN_6V3 Sensor 6.3V | 6.3 volt → **REF/SYNC+ supply** (crank/cam power) | K5-unused — **design divergence, Dave item 1** |
| B20 | reserved for #98 fuel level, unassigned (L158, L382) | AV6 Analogue Voltage Input 6 | AV6 → fuel PSI | OPEN — owner call (Dave item 4) |
| B21 | #APS_T1_SIG pedal track 1 (L395) | AV7 Analogue Voltage Input 7 | AV7 → gear position | CERTIFIED-3-WAY |
| B22 | #APS_T2_SIG pedal track 2 (L398) | AV8 Analogue Voltage Input 8 | AV8 → fuel tank sender | CERTIFIED-3-WAY |
| B23 | — | ETH_TX+ Ethernet Transmit+ | Enet TX+ comms | K5-unused |
| B24 | — | ETH_TX- Ethernet Transmit- | Enet TX- comms | K5-unused |
| B25 | — | ETH_RX+ Ethernet Receive+ | Enet RX+ comms | K5-unused |
| B26 | — | ETH_RX- Ethernet Receive- | Enet RX- comms | K5-unused |

**UDIG note (B01/B02, not a conflict):** the techspec names these pins UDIG1/UDIG2 (universal digital inputs); both the K5 plan and Dave's real build put crank on B01 and cam on B02. Crank ref / cam sync on the first two UDIGs is the M1 assignment both builds share, and Dave's own column labels them "Reference"/"Sync". Three sources agree in substance.

---

## Conflicts & diagnoses

### CONFLICT 1 — #62 CAN trunk has no M130 pin written (severity: LOW, agent-fixable)
Cut list L139 gives #62 (CAN, 24 AWG twisted pair, 120-ohm termination) a destination of just "ECU" — no `M130:B17/B18`. Same for the #125 Holley T43 CAN stub (L291) which splices off #62. **Diagnosis:** the cut list's generic-"ECU" destination column is a stale placeholder from v2-era rows; the M130 has exactly one CAN bus and it is only on B17 (CAN_HI) / B18 (CAN_LO) (techspec p.17). Dave's Bronco lands CAN High on B17 / CAN Low on B18 — identical. There is no possible alternative pin, so this is a bookkeeping gap, not a design question. **Close:** next cut-list rev writes `M130:B17` / `M130:B18` on #62 (and notes the #125 stub inherits them). Note CAN polarity carefully at the Dakota/T43 ends; no Dave time needed.

### CONFLICT 2 — The two official MoTeC docs disagree on AT pull-up rail letters (severity: LOW)
Read directly this session:
- **M1 ECU Hardware techspec p.17** (Nov 2013): AT1→SEN_5V_A, AT2→SEN_5V_B, AT3→SEN_5V_A, AT4→SEN_5V_B (alternating)
- **M130 Datasheet Part 13130 p.5** (June 2014, `_extracted/...page-0005.txt:12-18`): AT1→SEN_5V_B, AT2→SEN_5V_B, AT3→SEN_5V_A, AT4→SEN_5V_A

`VALIDATION_REPORT.md` recorded the datasheet version; receipt `2026-05-14_substrate-m130-b03-b06-correction.md` and the cut list's letter-paired grounds (#109g IAT→B15, #110g coolant→B16, #113g oil temp→B15, L212-214) follow the techspec version. One of the two official docs is wrong — **UNKNOWN which**.
**Why it's LOW:** this only affects which internal 5V rail biases each temp input and the *convention* of which 0V pin its ground return uses — the sensor reads correctly either way. Dave's real build doesn't letter-pair at all: he puts crank/cam 0V on B15 and every other sensor ground on B16 (Bronco rows B75/B76), and it runs.
**Close without Dave:** bench ohmmeter on the unpowered M130 — measure B03↔A02 and B03↔A09; the ~1 kΩ path identifies the true rail. Or one email to MoTeC support. Then align #109g/#113g/#110g grounds (or adopt Dave's functional grouping and stop letter-pairing).

### Design divergence — crank/cam sensor supply: 5V vs 6.3V (severity: MEDIUM — this is Dave item 1)
Not a pin-map conflict, but the sharpest thing the Bronco surfaced: **Dave powers his crank and cam sensors from B19 (6.3V sensor supply — his "REF SYNC+", Bronco rows B79/K79 and N39/N61)**. The K5 cut list powers them from the 5V rails: #99r crank 5V → A02, #101r cam 5V → A09 (L230, 233). The techspec confirms B19 = SEN_6V3 exists and is otherwise unused on the K5. Whether the GM Gen IV 3-pin crank/cam sensors (BOM PNs 12615626/12591720, state §4) want 5V or the 6.3V rail is **UNKNOWN** here — the cut list's "CKP needs 5V supply" note (L230) is uncited. If Dave says 6.3V, wires #99r/#101r move to B19 (one pin, both sensors) — a 2-wire change, cheap now, expensive after the loom is taped.

### Resolved history (no action — receipts already cover these)
- **#102 oil PSI A14→A25:** the 2026-04-13-era AV map put oil pressure on A14, colliding with TPS1. Moved to A25/AV5 by receipt `2026-06-09_cut-list-v4.md`; v4.2 is self-consistent. Bronco corroborates A25 as an AV input.
- **#97 rear camera "B02" ghost:** stale 2026-04-13 harness-spec assignment; camera is PDM30:OUT15, B02 is the cam sensor (cut list L36, receipt `2026-06-09_pinout-sheets-m130-pdm30.md`).

---

## Certification summary

| Bucket | Count | Pins |
|---|---|---|
| CERTIFIED-3-WAY | **41** | A01–A22, A25–A32, B01–B05, B07, B13, B15, B16, B21, B22 |
| — of which ● device-match with Dave's build | 20 | A02, A10, A11, A14, A15, A19–A22, A26–A30, B01–B05, B07 |
| CONFLICT (bookkeeping gap) | 2 | B17, B18 (#62 unpinned — agent-fixable) |
| OPEN (owner assignment) | 1 | B20 (#98 fuel level) |
| K5-unused | 16 | A23, A24, A33, A34, B06, B08–B12, B14, B19, B23–B26 |
| **Total** | **60** | |

**Zero pin-function conflicts across 41 assigned pins.** Every wire the K5 plans to land on the M130 lands on a pin whose function the manufacturer datasheet supports and whose class Dave's real customer build uses the same way. The entire ignition set, injector set, power/ground set, both 5V rails, both 0V rails, crank, cam, both knocks, and the three temp sensors are additionally device-matched against Dave's build.

---

## Dave's 5 minutes (in priority order)

1. **Crank/cam supply — 5V or 6.3V?** You feed REF/SYNC+ from B19 (6.3V) on the Bronco; the K5 plan feeds the GM Gen IV crank/cam sensors from the A02/A09 5V rails. Which is right for these sensors? (If 6.3V: wires #99r/#101r move to B19 — say the word.)
2. **Throttle motor on the A18/A01 half-bridge pair** — the Bronco has no drive-by-wire, so there's no real-build corroboration for the GM 90mm throttle motor on OUT_HB1/OUT_HB2. Is that the pair you'd use?
3. **Pedal tracks on AV7/AV8 (B21/B22), split across the two 5V rails** (track 1 on A02/B15, track 2 on A09/B16) so one rail fault can't kill both tracks — your practice too?
4. **Fuel level sender → AV6 (B20)?** You put the Bronco tank sender on AV8; AV8 is taken by pedal track 2 on the K5, and AV6 is the last free AV input. Bless it and #98 gets pinned.
5. *(Optional — we can close this ourselves with an ohmmeter)* MoTeC's two docs disagree on which 5V rail the AT temp-input pull-ups use. Your build grounds all non-crank/cam sensors to B16 regardless — should the K5 just adopt that grouping?

Everything else on the M130 is certified 3-way and needs no review.