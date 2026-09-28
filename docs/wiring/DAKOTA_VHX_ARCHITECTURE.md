> **RED-PEN LOG (adversarial review, 2026-07-12) — verdict: PASS_WITH_FIXES.**
> The corrections below were found by an independent shredder pass and OVERRIDE the body where they conflict. Per repo culture the body is preserved, not silently rewritten; apply these before building from this doc.

- **FIX:** Fuel-over-CAN prerequisite overstated: artifact says 'fuel via #98 → AV6/B20 per v4.2' as if assigned. K5_cut_list_v4_2.txt line 158 says #98's AV pin is UNASSIGNED ('Needs AV pin decision'); v4.2 state row only says AV6/B20 was LEFT FREE for #98. c_Fuel_Level over CAN requires that assignment to actually be made (it's a prerequisite in BOTH paths, since #117 is a parallel tap on #98). Reword to 'AV6/B20 reserved for #98, assignment still open per v4.2 receipt.'
- **FIX:** Missing manual-spec violation that lives in EVERY architecture: 650314:P p.6 requires GROUND at '18 AWG or larger' and p.6/p.7 spec 18 AWG for CONST. POWER and ACC. POWER. Cut list #123 (ground), #71 (ACC power), #124 (backup) are all 22 AWG M22759/32. Draw <1A makes it electrically survivable, but it contradicts the cited manual — belongs in the 'kept either way' row and open items alongside the CONST. POWER gap.
- **FIX:** Stale bulkhead framing: the '#114/#115 are 2 of the 8 D38999 overflow wires' benefit cites the 2026-06-10 state row but ignores the LATER 2026-06-18 row ('Engine-only firewall', Dave correction) which frees the cavities that resolve that same 8-wire overflow. Deleting 2 firewall crossings is still a real BIM benefit; selling it as overflow relief is not — the overflow is already being resolved by segmentation.
- **FIX:** Citation slips (substance verified, page numbers off): VHX BUS-source setup is pp.32-33 of MAN 650874 (p.31 is the VFD3 oil/fuel continuation); Troubleshooting is p.39 per the ToC (p.38 = Quick Tips) — the BIM-powered-from-control-box claim is anyway confirmed by the p.1 diagram (BIM-xx-2 Power/Data cable, 394191 18" / optional 394192 72"); the CANH-red/CANL-black colors are printed on p.29 itself ('Hardwire: RED TO CAN HIGH / BLACK TO CAN LOW'), making the p.23 cite unnecessary. Also Dakota wires sit at cut-list lines 276-286 (273-275 is the section header).
- **FIX:** Add CAN physical-layer questions to Dakota question #1 / MoTeC question #3: (a) does the BIM-EFI-1 carry internal 120Ω termination (4th node on an already-terminated #62 trunk must NOT add a terminator); (b) stub-length discipline — copying the #125 T43 2.0-ft stub pattern is marginal at 1Mbps (ISO 11898 guidance ~0.3 m stubs); prefer daisy-chaining the trunk through the splice point. Neither appears in the artifact's otherwise-good bus-coexistence open item.
- **FIX:** §2 table labels #114/#115 as '(Dakota's own)' but the cut list rows as-written still say 'Factory GM CTS' / 'Factory GM 0-90 PSI'. The artifact flags the supersession two paragraphs later, but the table silently presents the corrected state as current substrate — mark those two cells as-written-vs-superseded until the correction receipt is actually filed.

**Shredder's notes (why):**
- *22 AWG on the gauge system's power and ground when the manual you're citing says 18 AWG in plain English on the same page you quoted for CONST. POWER — you read the page and skipped the spec.*
- *Don't sell me bulkhead relief I already gave you for free: engine-only firewall (my 2026-06-18 correction) resolves the 8-wire overflow. The BIM deletes 2 crossings, fine, but the overflow argument is dead weight.*
- *'The two paths' tune-time dependencies are the same order of effort' — vibed, not cited. Configuring two half-bridge outputs as calibrated tach/speed pulse generators in GPR is not the same as flipping one ECU/Transmit toggle; either cite the GPR config effort or strike the equivalence.*
- *Nobody has said what the Holley T43 actually talks to on this bus. A TCU stub to a MoTeC-only CAN trunk with no named counterpart is an architecture hole, not a footnote — the artifact buries it in a parenthetical inside an open item.*
- *No termination plan for a 4-node 1Mbps bus. Where are the two 120Ω resistors on the #62 trunk today, and does the BIM add one? Ask before you splice, not after the bus goes quiet.*
- *Fuel level over CAN is promised while #98 doesn't even have an ECU pin assigned. Reserved is not wired.*

---

# ARTIFACT C — Dakota VHX Architecture: Dual-Sender (LOCKED) vs CAN Alternative

**Date:** 2026-07-12 · **Scope:** Dakota Digital VHX-73C-PU gauge wiring on the 1977 K5 (LS3, MoTeC M130 + PDM30, Holley T43)
**Status:** Evidence packet. The dual-sender decision (state §1, 2026-05-14) stays LOCKED — this artifact does not unlock it. Skylar decides.
**Ground truth used:** local extracted Dakota manuals (`docs/library/_extracted/component_drawings__dakota_digital_vhx_manual/` = MAN 650314:P; `…vhx73cpu/` = VHX-73C-PU install doc), Dakota BIM-EFI-1 manual MAN #650874 (downloaded this session, now archived at `reference_documents/component_drawings/dakota_digital_bim-efi-1_650874.pdf` — Dakota's own site is geo-blocked from this network), cut list `docs/wiring/output/K5_cut_list_v4_2.txt`, ECUMaster MoTeC-M1 CAN app note (ecumaster.com/files/ADU/AN/motecM1.pdf), HPAcademy MoTeC forum.

---

## 1. First, the truth about "bypassing the stupid Dakota box": there is no jailbreak

The VHX cluster in the dash is a display only. Every input — senders, tach, speed, indicators, power, ground — lands on the **VHX control box's screw terminals** (FUEL SND, OIL SND, WTR SND, TACH, SPD SND, LEFT(+), RIGHT(+), HIGH(+), BRAKE(–), ACC. POWER, CONST. POWER, GROUND), and the box drives the cluster over a Dakota-supplied CAT5 cable. Source: VHX manual MAN 650314:P, wiring diagram p.5 and terminal-description table p.6 (local extract `page-0005.txt`, `page-0006.txt`).

**The box IS the gauge driver.** There is no terminal on the cluster itself to wire to (only two Dakota-supplied turn-arrow pigtails — VHX-73C-PU doc p.1, local extract). "Bypassing the box" is not a wiring move; it's replacing the entire gauge system. What *can* be done is changing **what feeds the box** — that's the CAN alternative in §3.

## 2. The LOCKED path — dual-sender, 11 wires (#114–#124)

Locked 2026-05-14 (`K5_WIRING_STATE.md` §1; receipt `2026-05-14_addendum-dakota-dual-sender-wires.md`), landed in cut list v4 (2026-06-09), current in v4.2 lines 273–286:

| Wire | What | Terminates | Ft |
|---|---|---|---|
| #114 | Coolant temp sender (Dakota's own) | WTR SND | 8.0 |
| #115 | Oil PSI sender (Dakota's own) | OIL SND | 8.0 |
| #116 | Tach from M130:A31 (spare half-bridge OUT_HB3) | TACH | 8.0 |
| #117 | Fuel level tap (parallel with #98 ECU wire) | FUEL SND | 18.4 |
| #118 | Speed from M130:A32 (spare half-bridge OUT_HB4) | SPD SND | 11.5 |
| #119/#120 | Turn signal taps (#80/#82) | LEFT(+)/RIGHT(+) | 1.5+1.5 |
| #121 | High-beam tap on #85b (floor-dimmer high-out) | HIGH(+) | 2.0 |
| #122 | Brake indicator tap (#53) | BRAKE(–) | 1.5 |
| #123 | Dash star ground | GROUND | 3.0 |
| #124 | Switched +12V backup | (see wrinkle below) | 3.0 |

Total 11 wires, 66.4 ft (cut list v4.2, "V4 ADDENDUM TOTALS" line 307). Power feed #71 (PDM30:OUT29 → ACC. POWER) pre-existed.

**Known wrinkles already on the record** (`output/K5_DAKOTA_GAUGE_CARD.md`):
- **CONST. POWER gap** — the box requires an always-hot fused 12V feed to keep clock memory and park the needles (650314:P p.6). OUT29 is switched; #124 duplicates switched. A constant-12V wire is missing from the cut list. Open either way (gauge card §d.2).
- **#122 polarity** — BRAKE(–) wants a ground-switched signal (650314:P p.6 terminal table); #122 taps the +12V brake-light circuit. As drawn it won't light. Re-source at mockup (gauge card §d.4).
- **Use Dakota's senders, not factory GM** — 650314 warns other senders "cause incorrect readings or damage"; the kit's Universal Sender Pack includes SEN-04-5 temp (100–300°F) and SEN-03-8 oil (0–100 PSI) (650314:P p.5 diagram; VHX-73C-PU kit contents p.1). The cut list's "Factory GM sender, PN UNKNOWN" notes on #114/#115 are superseded — substrate-correction receipt still owed.
- **Companion undercount** — temp is 2-wire, oil sender is 3-wire; real dual-sender count is ~13–16 conductors (gauge card §c). Mockup item.

## 3. The CAN alternative — investigated honestly

### 3a. BIM-01-2 (the module in the ask) is the WRONG module for this build

BIM-01-2 is Dakota's **OBD-II** reader: it speaks SAE J1850 VPW/PWM and ISO 15765 CAN (500k, 11-bit) following **SAE J1979 PIDs** (Dakota BIM-01-2 product literature, MAN #650500G). The MoTeC M1 GPR package **does not answer OBD-II/J1979 PID requests**: "The GPA/GPR packages do not provide ODB2 support" — David Ferguson (MoTeC dealer, Veracity Racing Data) on the HPAcademy MoTeC M1 forum (hpacademy.com/forum/motec-m1-software-tutorial/show/obd2-output/). No OBD responder → the BIM-01-2 sees nothing. **Dead on arrival.**

**Substrate correction owed:** `K5_DAKOTA_GAUGE_CARD.md` §b says the BIM-01-2 "listens to the MoTeC's OBD-II broadcast" — no such broadcast exists in GPR. The card's CAN-mode section is built on the wrong module.

### 3b. BIM-EFI-1 is the RIGHT module — it has a native MoTeC mode

Dakota's **BIM-EFI-1** (MAN #650874, archived copy in `reference_documents/component_drawings/`) is a bridge module with an explicit **MoTeC setup section (manual p.29)**:

- **Compatibility:** "compatible with MoTeC M1 series ECUs that transmit the M1 General data stream (base ID 0x640) @ 1Mbps" (p.29). The M130 is an M1-series ECU; the M1 General broadcast is enabled with one setting in M1 Tune ("ECU/Transmit" — ECUMaster MoTeC-M1 app note p.4, which documents the same stream). Ferguson's forum answer independently confirms GPR transmits RPM at CAN ID 0x640, 16-bit, offset 0.
- **Connection:** splice the 394252 unterminated BIM harness — **2 wires: CANH (red), CANL (black)** — into the ECU's CAN bus (p.29, p.23 harness-color note). The BIM itself is powered from the VHX control box through Dakota's plug-in power/data (BIM) cable (troubleshooting table p.38) — no separate power wires.
- **Readings in MoTeC mode (p.29):** Engine RPM, Vehicle Speed, Engine Coolant Temp, Engine Oil Pressure, Intake Air Temp, Trans Fluid Temp, Gear Position, Fuel Pressure, **Fuel Level**, A/F ratio, MAP/Boost. Caveat verbatim: "Availability of each reading depends on attached sensors and MoTeC firmware type. Gear position is only available with GP-AT or other firmware that provide automatic transmission control."
- **VHX side (manual pp.31–33):** the VHX setup menu has an explicit **BUS** source option for speed, tach, water temp, oil pressure, AND fuel level — all five gauges can run from the BIM on a VHX.
- **Cross-check of the M1 General stream contents** (ECUMaster app note, "Supported channels," pp.5+): `ecu.rpm`, `ecu.speed` (vehicle speed), `ecu.clt` (coolant temp), `ecu.oilPress`, plus `c_Fuel_Level` ("Fuel level in litres") in the extended set. The channels the VHX needs are in the broadcast — *if* the M130 has the corresponding sensor (it does: coolant/oil are MoTeC sensors #110/#102; speed via #100 VSS; fuel via #98 → AV6/B20 per v4.2).

### 3c. What each path deletes, keeps, and risks

| | **Dual-sender (LOCKED)** | **BIM-EFI-1 CAN** |
|---|---|---|
| Dakota data wires | #114–#118 (5 wires, 53.9 ft) + companion conductors (real ~13–16 total) | 2-wire CAN splice into #62 trunk (~2 ft twisted pair, same pattern as T43 stub #125) |
| Wires kept either way | #119–#124 + #71 + missing CONST-12V (indicators are hardwired inputs in every mode — 650874 provides no indicator data) | same |
| Senders on engine | +2 Dakota senders (SEN-04-5, SEN-03-8; in kit) needing 2 spare bosses/adapters next to the MoTeC sensors | 0 extra senders, 0 extra bosses |
| Firewall (D38999) | #114/#115 are 2 of the 8 overflow wires flagged on the 61-way bulkhead (state §1 row 2026-06-10) | those 2 crossings deleted |
| M130 pins | A31/A32 half-bridges consumed as tach/speed generators | A31/A32 freed back to spare (rejoin A33/A34 for future provisioning) |
| Hardware cost | $0 (senders in kit) | BIM-EFI-1 module: street ~$110–$180 — **UNKNOWN-verify**: Speedway snippet showed "as low as $109.25" on an ambiguous SKU page; Dakota's site geo-blocked this session. Net after ~$32 wire savings (53.9 ft × ~$0.60/ft 22 AWG striped, RaceSpec Apr 2026 table in `K5_wire_spec_and_costs.md`): **≈ +$80–150** |
| Tune-time config | M1 GPR must be configured to drive A31/A32 as tach/speed pulses (receipt 2026-05-14) | M1 GPR "ECU/Transmit" set to the CAN bus (one setting); BIM set to mode F13 |
| ECU-off behavior | Temp/oil/fuel gauges work with M130 dead/being flashed (tach/speed still need M130 — receipt 2026-05-14) | **Every** gauge blank until the M130 is alive and broadcasting; odometer only accrues then |
| Bus architecture | No new CAN nodes | 4th node on the M130's **single** CAN bus (validation report: M130 has 1 CAN, B17/B18), which already carries PDM30 (#62 trunk) and the Holley T43 stub (#125). Coexistence at 1Mbps + ID-collision check = **UNKNOWN** (see open items) |
| Failure surface | 2 senders, 5 long wires | 1 module (firmware/OTA-updatable, Bluetooth-configured), 1 splice, protocol dependency |

Noticed, out of scope for this artifact: the VHX-73C-PU has a **gear indicator** (kit lenses, GEAR terminal fed by a Dakota GSS unit per 650314:P p.5). No gear wire exists in the cut list in either path, and gear-over-CAN is unavailable because trans control is the Holley T43, not MoTeC GP-AT firmware. Separate open item.

## 4. Recommendation (evidence-weighted; the lock stands unless Skylar reopens)

**Keep dual-sender.** Reasons: (a) $0 hardware and the senders are already in the box on the shelf; (b) temp/oil/fuel gauges stay alive when the M130 is off, dead, or mid-flash — which matters for a truck that will be tuned iteratively; (c) the BIM path parks all five gauges on a CAN bus that already carries an unresolved protocol question (does the T43's Holley CAN coexist cleanly with MoTeC traffic? — never verified); (d) the locked path is fully enumerated and cited today, and the two paths' tune-time dependencies are the same order of effort.

**The BIM-EFI-1 is a genuinely viable reopen**, not a fantasy: it deletes 5 wires (53.9 ft) plus their companion conductors, 2 engine senders and their bosses, 2 of the 8 D38999 overflow crossings, and frees A31/A32 — for ≈$80–150 net and two unknowns (bus coexistence, fuel-level end-to-end). If Skylar values fewer engine-bay wires and a cleaner bulkhead over gauge independence from the ECU, this is the trade to make — after the two questions below come back clean. A hybrid also exists and is legal per the manual (any gauge individually set SENDER vs BUS): e.g., fuel stays on the tank wire #117, everything else over CAN.

## 5. Questions to send (exact wording)

**To Dakota tech support (605-332-6513 / techsupport@dakotadigital.com):**
1. "On a VHX-73C-PU with the BIM-EFI-1 in MoTeC mode (F13): does the fuel gauge accept BUS as a source from the M1 General stream's fuel-level channel, and does the odometer accumulate correctly from BUS speed? Any known issues with the BIM sharing a CAN bus that also carries MoTeC PDM and Holley T43 traffic at 1Mbps?"
2. "Is the 394252 unterminated harness included with the BIM-EFI-1 or ordered separately, and what is the current price of both?"

**To MoTeC forum / dealer (or Dave):**
3. "M130 + GPR: with ECU Transmit enabled (M1 General, base 0x640, 1Mbps) on the same bus as a PDM30 and a Holley T43 stub — any ID-range collisions or bus-load concerns? And does GPR populate Fuel Level in the General broadcast from an AV-input fuel sender?"

## 6. Substrate corrections owed (separate receipts, not applied here)

1. `K5_DAKOTA_GAUGE_CARD.md` §b — replace BIM-01-2/OBD-II framing with BIM-EFI-1/M1-General (GPR has no OBD-II responder).
2. Cut list #114/#115 notes — "Factory GM sender PN UNKNOWN" → Dakota SEN-04-5 / SEN-03-8 from the kit (650314 warning against non-Dakota senders). Gauge card §d.3 already flags this; receipt never filed.
3. `calc-data/subsystems.json` — SGI-100BT reference already flagged wrong in the gauge card; fold into the same correction receipt.