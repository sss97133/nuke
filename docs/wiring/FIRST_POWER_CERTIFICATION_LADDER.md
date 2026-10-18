> **RED-PEN LOG (adversarial review, 2026-07-12) — verdict: PASS_WITH_FIXES.**
> The corrections below were found by an independent shredder pass and OVERRIDE the body where they conflict. Per repo culture the body is preserved, not silently rewritten; apply these before building from this doc.

- **FIX:** STAGE 2 KNOCK ROW — WRONG EXPECTED VALUE (the one real pass/fail inversion). This LS3 runs GM Gen IV flat-response knock sensors; GM's spec is 93-107 kOhm measured across the sensor (ls1tech knock-diagnosis thread, Holley EFI forum LS3/LS7 knock settings, verified by web search). The artifact's primary expectation 'OL (piezo)' would PASS an open circuit and flag every good sensor. Fix: expected = ~93-107 kOhm through-harness, both banks within a few kOhm of each other; OL = open/wrong cavity = FAIL. The '~100 kOhm-class bias resistor' hedge has it backwards — that IS the normal reading.
- **FIX:** STAGE 2 INJECTOR ROW — 'A19…A30 ↔ INJ_PWR rail' is a wrong-pin-range shorthand. Literal A19-A30 sweeps A23/A24 (INJ_LS), A25 (AV5 = oil pressure SIGNAL), and A26 (BAT_POS). Write it as A19-A22/A27-A30 — the exact error class Stage 0 exists to catch, sitting in Stage 2's own table.
- **FIX:** STAGE 4 PRE-MATE SWEEP — the pass rule 'only A26 may show 12V' is only true if injector/coil/fuel-pump connectors are still unmated (or #INJ_PWR/#COIL_PWR channels forced off). A mated injector puts battery voltage on every INJ_PH cavity through the ~12-ohm winding — a false FAIL that sends someone chasing a miswire that isn't there. Stage 3 has this precondition; Stage 4 must restate it in its own precondition line.
- **FIX:** STAGE 5 TIMING SUB-STEP — damage risk as written. 'Plugs out, coils connected, cyl-1 plug grounded' leaves the other 7 D510C smart coils firing into open secondaries (internal flashover risk). Fix: either all 8 plugs in their coil boots and grounded to the block, or plugs installed in the engine (fuel disabled) with the timing light on the cyl-1 coil-to-plug lead. Never fire a smart coil with an open secondary — same logic as the artifact's own dwell warning two lines later.
- **FIX:** OPEN ITEM 4 / PDM CHANNEL ARITHMETIC — assigning #INJ_PWR/#COIL_PWR/#94 'from the 25 freed channels in the start-minimum config' collides with the full build: K5_WIRING_STATE.md §3.4 says PDM30 is at 30/30 with zero headroom, and K5_pdm30_channel_plan.md's full-build plan has injectors/coils as M130 low-side only with NO +12V supply channels allocated. The 3 channels consumed now don't exist at full build. The protocol must flag the reconciliation (PDM15 add-on, load consolidation, or fused rail off the distribution stud) instead of quietly spending start-minimum slack.
- **FIX:** BRONCO TRIANGULATION — the blanket 'K5 sheet uses identical pins for identical functions' has one unexplained divergence the artifact's own rule ('any divergence: explain it in writing') should have caught: Dave's Bronco sheet supplies REF/SYNC+ from B19 (SEN_6V3, the MoTeC idiom for hall ref/sync), while the K5 cut list feeds CKP/CMP 5V from A02/A09 (#99r/#101r). Defensible — GM Gen IV hall sensors are 5V devices — but it must be written down as an explained divergence, not asserted away. (Verified by parsing the actual xlsx: the enumerated ign/inj/power/ground/0V/CAN pins do all match.)
- **FIX:** STAGE 0 UNKNOWN 5 — citation error: 'never over 18 inches' is the IASCA car-audio rule, not ABYC. ABYC E-11 is OCP within 7 inches of the source, extendable to 40 inches sheathed (72 inches for certain battery connections) — per the artifact's own cited source, spine study §2.1-2.2. Conservative in the safe direction, but a mis-attributed cite in a document whose whole pitch is citation discipline.
- **FIX:** STAGE 1 GROUND-PAIR LINE — '#PDM_GND1/2 to A26/B18' needs device prefixes (PDM30:A26/B18). On the M130, A26 is battery POSITIVE; on the PDM30, A26 is battery NEGATIVE. Bare pin IDs that invert polarity across two boxes in the same harness is exactly how a box dies. The cut list prefixes them; the protocol must too.
- **FIX:** MISSING CHECK — CROSS-MATE HAZARD: VALIDATION_REPORT.md documents that M130 and PDM30 use the SAME mating connectors (MoTeC #65044/#65045, both Superseal Keying 1). The M130 harness branch physically mates with the PDM30 and vice versa — a swap puts PDM 20A output pins into ECU inputs. The ladder needs an explicit step (Stage 1 labeling + Stage 4 'confirm you are holding the M130 branch before mating'). Nothing in the current protocol prevents this.

**Shredder's notes (why):**
- *The knock row. You built a whole document about catching wrong expectations on paper, then printed 'expect OL' for a sensor GM specs at 93-107k. A tech following this table to the letter rejects two good sensors and ships two open circuits.*
- *'A19…A30' — an ellipsis in a pin range is how someone ohms BAT_POS against the injector rail and calls it a failed injector. Ranges in a test doc are enumerated, never elided.*
- *Stage 4's 'only A26 may show 12V' with no restated precondition — the pass criterion depends on state established two stages earlier. Every stage's pass rule must be self-contained; techs run stages on different days.*
- *Firing 7 smart coils open-secondary during the timing check. That's a $400 lesson in why the D510C KB article exists.*
- *Spending 'freed' PDM channels that the full-build plan already spent. The start-minimum config is scaffolding, not real estate.*
- *Identical Superseal shells on the ECU and the PDM with identical keying and not one line about preventing a cross-mate. That's the most expensive connector swap available on this truck.*
- *Stage 4 calls itself 'sensors only' then runs DBW throttle calibration — which drives the throttle motor on the half-bridge outputs. First actuator exposure is happening one stage earlier than the table advertises; say so.*
- *'<1 ohm' and '~10 kOhm investigate threshold' labeled 'standard harness-test threshold' with no source — A-620 doesn't set those numbers (isolation specs run megohm-class). They're fine as shop practice; call them shop practice.*
- *Minor: 'CAN pair ~54 ohm predicted' — right math (120R||100R = 54.5), and correctly flagged VERIFY, but the doc should also say a healthy 2-node bus normally reads ~60 with dual 120R, so a 54-vs-60 reading is diagnostic of WHICH termination scheme is installed, not just 'matches prediction'.*
- *What survived the shredder, for the record: every M130/PDM30 pin function checked out against the official MoTeC datasheet and my own Bronco sheet (I parsed it — ign A3-A8/A12/A13, fuel A19-A22/A27-A30, A26/A10/A11 power, B1/B2 ref/sync all match); the E-Stopp-is-a-parking-brake catch is real and it's the best finding in the document; the CTS 3.5k@68F anchor is dead on (3,520 per the GM chart); injectors at 12 ohms high-Z is right; the staged crank-no-start-then-timing-light sequence is how professionals do it; and the vocabulary is clean — TPS, oil PSI, coolant temp, crank/cam throughout. Fix the nine items and this is a build-floor document.*

---

# K5 First-Power Certification Ladder

**Artifact D · docs/wiring · 2026-07-12**
1977 K5 Blazer · VIN CKR187F127263 · LS3 6.2L · MoTeC M130 + PDM30 · Holley 558-499 T43 · Dakota Digital VHX · battery at passenger firewall corner (owner working position 2026-06-10, `K5_WIRING_STATE.md` §4).

This is the staged test protocol that replaces "full confidence." Every wiring mistake gets caught at the cheapest stage that can catch it — on paper, with a multimeter, or with a $2 fuse — never with the $3,000 ECU. **A gate is passed when its checklist is fully initialed in `output/K5_bench_test_log.csv`, not when it "seems fine." A skipped gate means restarting from the skipped gate.**

Pinout under test: `output/K5_cut_list_v4_2.txt` (174 wires) / the 88-wire subset in `output/K5_ENGINE_START_MINIMUM.md`.

| Stage | Gate | Cost of a mistake caught here | Computers exposed |
|---|---|---|---|
| 0 | Pinout frozen + triangulated | $0 — paper | none |
| 1 | Bench buzz-out (continuity + shorts) | $0 — multimeter time | none |
| 2 | Resistance sanity per sensor circuit | $0 — multimeter time | none |
| 3 | Rails-first power, M130 disconnected | a fuse | PDM30 only, behind current limit |
| 4 | M130 first connect — sensors only | first ECU exposure; rails already proven | M130 + PDM30 |
| 5 | First crank, no-start (ref/sync) | starter wear | all |
| 6 | First start | the $3,000 stage — stages 0–5 exist so today is boring | all |

---

## STAGE 0 — PRE-BUILD: PINOUT SHEET FROZEN & TRIANGULATED

**Catches:** wrong pin assignments, pin collisions, missing wires, TBDs hiding in the power path — the exact error class Dave caught in the shredded parts list, fixed here for free.
**Tools:** printer, red pen, the three sources below.
**Pass:** every wire in the 88-wire engine-start minimum has a FROM pin, a TO device, and zero TBD in the power path. Sheet printed, dated, signed. After freeze, changes only by receipt.
**On fail:** fix it on paper and re-print. That is the entire point of this stage.

- [ ] Print the pinout sheet rendered from `K5_cut_list_v4_2.txt` (per-connector faces: `output/pinouts/`, `output/connector-sheets/`).
- [ ] **Triangulation 1 — official MoTeC docs:** M1 ECU Hardware techspec pp.16–18 + M130 datasheet pp.4–5. Already done: `reference/motec/VALIDATION_REPORT.md` shows 60/60 M130 pins and 61/61 PDM30 pins match the official publications. Confirm the report covers the current cut-list version.
- [ ] **Triangulation 2 — Dave's Bronco M130 pinout** (`~/Downloads/M130 ECU Overland Bronco (1).xlsx`, a real running Desert Performance customer build): ignition 1–8 on A3–A8/A12/A13 · injectors 1–8 on A19–A22/A27–A30 · ECU 12V A26 · grounds A10/A11 · sensor 0V B15/B16 · 5V rails A2/A9 · crank/cam B1/B2 · CAN B17/B18 · Ethernet B23–B26. The K5 sheet uses identical pins for identical functions. Any divergence: explain it in writing or fix it.
- [ ] **Triangulation 3 — internal consistency:** every AV/AT/UDIG pin used at most once (v4 AV shuffle resolved the known collisions — v4 receipt); every PDM output channel exists and its 20 A / 8 A rating covers the load (`K5_pdm30_channel_plan.md` + PDM30 datasheet ratings in VALIDATION_REPORT).
- [ ] Walk all 88 wires of `K5_ENGINE_START_MINIMUM.md` against the frozen sheet, initialing each group.

### BLOCKING UNKNOWNS — close before Stage 3, most before ordering

1. **UNKNOWN — battery isolator device has no part number.** State §1 (2026-06-18 row) calls it the "E-Stopp isolator," but E-Stopp ESK001 is the electric **parking brake** actuator (`chapters/appendix-d-k5-build.md` via receipt `2026-05-14_open-question-estopp-trigger.md`; estopp.com sells ESK001 as a push-button parking brake kit). The device that satisfies MoTeC's requirement — "the isolator must isolate the battery from all devices in the vehicle including the PDM, starter motor and alternator," with a secondary contact "connected to a shutdown input on the ECU" (MoTeC PDM User Manual, quoted in `research/2026-06-10_power_spine_builders_study.md` §2.4) — is unselected. **Close:** pick an isolator with an auxiliary contact, file a receipt, correct state §1.
2. **UNKNOWN — ECU shutdown-input wire does not exist** in cut list v4.2. **Close:** assign a free UDIG (B08–B11/B14 candidates — verify against the frozen sheet), add the wire, configure in M1 Tune.
3. **UNKNOWN — #ECU_PWR switching element** (master relay vs freed PDM channel — v4.1 receipt §4). M130 has no ignition pin; wake = switched battery 12V on A26 (techspec pp.16–18).
4. **UNKNOWN — #INJ_PWR / #COIL_PWR / #94 fuel-pump-relay PDM channels** — TBD since 2026-05-14; 25 channels are free in the start-minimum config.
5. **UNKNOWN — #PDM_BPOS battery-end fuse rating** (v4.1 receipt). Fuse within 7" of the distribution point, never over 18", stub sheathed (ABYC OCP practice, spine study §2.2).
6. **UNKNOWN — throttle body identity:** as-built photos show a 4150-flange TB; locked decision is 90 mm DBW GM 12605109 (state §4). Confirm by eye before building the throttle group.
7. **UNKNOWN — battery tray not installed;** battery-relative lengths L14/L15 stale (state §4). Blocks cutting, not the sheet freeze.

---

## STAGE 1 — POST-BUILD BENCH BUZZ-OUT: EVERY WIRE, BEFORE ANY COMPUTER

> Professional floor: **100% electrical test** — continuity of every intended path AND isolation of every unintended one. Sampling is unacceptable for harness electrical test (IPC/WHMA-A-620 practice — wireharnessproduction.com, telewiretech.com A-620 guides).

**Catches:** opens, miswires, crossed pairs, crimp failures, pin-to-pin shorts from a stray strand or misloaded cavity.
**Tools:** multimeter (continuity + ohms) · **correct-size male test pins for Superseal female terminals — never jam meter probes in; a spread terminal is a latent open** · frozen pinout sheet · `K5_bench_test_log.csv`.
**Pass:** every wire logged <1 Ω end-to-end; every unintended pair reads OL; anything under ~10 kΩ between separate circuits investigated to a written explanation (standard harness-test threshold).
**On fail:** repair or re-pin — then **re-test the entire connector**, not just the fixed wire. Re-pinning disturbs neighbors.

- [ ] **Continuity, every wire:** M130/PDM-end terminal to device-end terminal per the frozen sheet, <1 Ω, initial the log row. 174 rows full harness; 88 for the start minimum.
- [ ] **Adjacent-cavity shorts, every pin:** one probe on the pin, sweep its physical neighbors in the Superseal face (left/right/above/below), plus one sweep against the 12V feed wire and one against the ground bus. Expect OL on all.
- [ ] **Shield drains** (#99s/#101s/#103s/#104s): continuous to SEN_0V at the ECU end only; sensor-end shield floats (cut-list note on #99s); no shield-to-conductor continuity.
- [ ] **CAN pair:** measure CAN_H–CAN_L with terminations installed and record. M130 wants 120 Ω, PDM30 wants 100 Ω termination (VALIDATION_REPORT electrical specs) — **VERIFY the termination scheme first**; the two in parallel predicts ~54 Ω. The number matters less than that it matches your own prediction.
- [ ] **Equal-length ground pairs** (#ECU_GND1/2 to A10/A11, #PDM_GND1/2 to A26/B18): both legs continuous to the battery-negative star, lengths matched (v4.1 receipt).
- [ ] **Grounds bonded:** ohm engine block → battery negative, chassis → battery negative, dash star → battery negative — all near zero. (Battery−/block/frame/body straps are hardware items, start-minimum group 2.)

---

## STAGE 2 — RESISTANCE SANITY PER SENSOR CIRCUIT

**Catches:** swaps continuity can't see — two continuous wires landed on the wrong devices, wrong pigtail, damaged sensor. Measuring from the M130-end terminal proves the wire AND the device in one reading.
**Tools:** multimeter · ambient thermometer · log.
**Pass:** every value in range or matching its recorded baseline; all values logged with ambient temp noted.
**On fail:** good continuity + wrong resistance = wrong device or wrong cavity. Physically trace the wire. Never rationalize a reading.

| Circuit | Measure between | Expected @ ~70 °F | Basis |
|---|---|---|---|
| Coolant temp #110 | B04 ↔ B16 | ≈3.5 kΩ @ 68 °F · ≈2.2 kΩ @ 86 °F | GM NTC ohms-vs-temp chart (ls1tech table); cold engine: coolant temp ≈ air temp |
| Intake air temp #109 | B03 ↔ B15 | NTC, same order of magnitude | **UNKNOWN** exact IAT PN/chart — measure the bare sensor, record baseline, compare through harness |
| Oil temp #113 | B05 ↔ B15 | NTC — baseline method | same baseline-and-compare |
| Injectors #13–#20 | A19…A30 ↔ INJ_PWR rail | ≈12 Ω each, all 8 within ±1 Ω | LS3 stock injectors are high-impedance ≈12 Ω (High Performance Injectors / Hondata impedance guides) |
| Coils 8× D510C | — | **no primary-resistance check exists** | D510C is a smart coil with an internal igniter module (Haltech KB "LS2 Ignition Coil"). Check instead: trigger wire not shorted to 12V or ground; supply/ground cavities per sheet |
| Knock #103/#104 | B07/B13 ↔ SEN_0V | OL (piezo) | low reading = pinched shield or wrong cavity; if a bias resistor reads (~100 kΩ-class), record — both banks must match |
| Crank/cam #99/#101 | — | no meaningful ohm value | Gen IV hall-type on front timing cover (as-built receipt 2026-06-09); verify only no dead short between any pin pair; real proof is Stage 5 |
| TPS tracks #4c/#4d | TB pins C/D ↔ E/F | match recorded baseline; smooth sweep | **UNKNOWN** track spec for GM 12605109 — measure the actual throttle body bare first, record baseline |
| Pedal (APS) T1/T2 | B21/B22 side | match baseline; both tracks move together | **UNKNOWN** track detail for GM 10379038 — baseline method; dual-track per v4.2 receipt |
| Fuel level #98/#117 | sender ↔ ground | 0–90 Ω over float sweep | GM 0–90 Ω sender, locked (state §1); sweep the arm before tank install |

- [ ] Record ambient temp before starting — NTC expectations move fast with temperature.
- [ ] **Baseline rule:** any device without a citable resistance spec gets measured bare (known-good), the number written down, and the through-harness reading required to match it. Baseline-and-compare beats a datasheet you don't have.

---

## STAGE 3 — RAILS-FIRST POWER: BATTERY + ISOLATOR + PDM, M130 DISCONNECTED

**Catches:** reversed feeds, main-feed shorts, miswired PDM outputs, load overcurrents — with the M130 on the shelf and the PDM behind a current limit.
**Tools:** current-limited bench supply (1–2 A limit) OR a 10 A fused jumper in place of the main feed · multimeter · laptop + PDM software + MoTeC CAN interface (**UNKNOWN which adapter is on hand — confirm before this stage**).
**Pass:** standby draw in the mA range; isolator kills everything; each channel powers only its intended device at expected current; nothing warm; no fuse blown.
**On fail:** a blown 10 A fuse or a current-limit trip is the ladder working — a short caught for pocket change. Fix, re-run this stage from step 1.

- [ ] **Preconditions:** Stages 1–2 fully logged · isolator device selected + installed (Stage 0 unknowns closed) · #PDM_BPOS fuse fitted · M130 NOT mated · injector, coil, and fuel-pump connectors NOT mated.
- [ ] **Dead-short check before any battery:** ohms from distribution stud to chassis ground. PDM off-state reads high; near-zero = stop.
- [ ] **First energize through the current limit** (or 10 A fused jumper), not the fat feed. Quiescent target: PDM30 standby ≈5 mA typical (PDM User Manual specs via VALIDATION_REPORT) + any always-hot module standby. Amps at rest = STOP.
- [ ] **Isolator test, dead vehicle:** open the isolator — everything dies, PDM included (MoTeC requirement in hardware: isolator isolates battery from PDM, starter, alternator — PDM User Manual).
- [ ] **Swap to the real feed.** Laptop on the PDM; force each configured output ON one at a time with its real load connected:
  - [ ] 12 V at the load connector — and the RIGHT device operates (fan channel spins the fan, not the horn).
  - [ ] Per-channel measured current vs nameplate (PDM reports channel current; 20 A outputs are dual-pin — both pins landed per sheet).
  - [ ] After a soak on each channel: feel connectors and runs by hand — warm is a finding.
- [ ] **Voltage-drop spot check** on the highest-current channel (fans, 12 AWG): supply vs load-end voltage under load; log the delta.

---

## STAGE 4 — M130 FIRST CONNECT: SENSORS ONLY

**Catches:** sensor miswires, 5V-rail shorts, 12 V on a signal pin (the input-killer), ground offsets, wrong M1 config — with the outputs physically incapable of firing anything.
**Tools:** laptop + M1 Tune over Ethernet (B23–B26) · multimeter for the pre-mate sweep.
**Pass:** ECU communicates; every configured input reads physically plausible AND moves when provoked; zero diagnostic faults.
**On fail:** kill power BEFORE unplugging anything — never separate a live Superseal. Diagnose on the frozen sheet; an implicated wire sends that connector back to Stage 1.

- [ ] **Pre-mate sweep — the single most valuable check in this ladder.** Rails live, M130 harness connectors NOT mated: meter every cavity of A and B to ground. **Only A26 (BAT_POS) may show 12 V.** 12 V on any AV/AT/UDIG/5V-rail cavity = a miswire that would have damaged inputs. Verify A02/A09 read 0 V (5V rails are ECU-sourced, not harness-sourced).
- [ ] A26 shows battery voltage only when the switching element is on, 0 V when off. A10/A11 show no offset against battery negative.
- [ ] **Mate A + B. Power up. Connect M1 Tune.** Firmware/package loads; ECU communicates; 5V rail diagnostics in spec.
- [ ] **Cold-soak cross-check:** coolant temp ≈ intake air temp ≈ oil temp ≈ ambient. Any outlier = wrong sensor or wrong calibration.
- [ ] Oil PSI ≈ 0. Fuel pressure ≈ 0 (pump fuse is out).
- [ ] MAP ≈ local barometric — roughly 92–94 kPa at Boulder City's ~2,500 ft elevation (standard-atmosphere estimate, weather-dependent).
- [ ] **TPS:** run M1 throttle calibration; both tracks sweep 0–100 %, tracking inside M1 limits.
- [ ] **Pedal:** slow full-travel presses; both tracks sweep, no dropouts, no diagnostics (tracks ride separate 5V rails by design — v4.2 receipt).
- [ ] Provoke each temp input (warm hand → value moves); log it.
- [ ] Dakota VHX: cluster powers; senders #114/#115/#117 read plausibly (the Dakota runs its own factory senders, independent of the M130's).

---

## STAGE 5 — FIRST CRANK, NO-START: PROVE REF/SYNC

> HPA standalone-ECU practice: crank with coils and injectors disconnected, verify the ECU sees RPM and achieves sync, then verify timing with a timing light before any fuel exists (HPA Practical Standalone Tuning Step 1 + forum guidance).

**Catches:** crank/cam sensors swapped or dead, wrong ref/sync mode in M1, wrong ref offset, shielding problems that only appear with the engine turning.
**Tools:** laptop + M1 Tune (logging ON) · timing light · charged battery.
**Pass:** stable sync through 10+ s of cranking, oil PSI rises, timing light agrees with commanded timing.
**On fail:** no RPM → crank sensor circuit/config. Sync loss → cam circuit or ref/sync mode. Timing off by a constant → ref offset. Timing wandering → wiring/shield — back to the Stage 1 records for that shielded cable.

- [ ] **Preconditions:** fuel-pump fuse OUT · coil connectors UNPLUGGED · injectors unplugged (or their PDM rail disabled) · Stage 4 fully logged.
- [ ] Crank: M1 Tune shows cranking RPM (~150–250), ref/sync achieved, no sync-loss diagnostics across 10+ seconds.
- [ ] Oil PSI rises during crank (doubles as the oil prime).
- [ ] Battery voltage during crank ≥ ~9.5 V — log it. Sagging lower = revisit the power spine before blaming electronics.
- [ ] **Timing verification (before Stage 6):** plugs out, coils connected, cyl-1 plug grounded or timing light on the cyl-1 lead — commanded timing in M1 Tune = observed at the crank pulley. Validates ref offset with zero fuel in the system.
- [ ] Confirm coil trigger config in M1 matches the D510C smart coil (dwell/polarity) before the timing sub-step — a smart coil held ON will overheat.

---

## STAGE 6 — FIRST START

**Catches:** fuel leaks, charging faults, cooling faults, PDM channel overloads — the failures that only exist with a running engine.
**Tools:** fire extinguisher, staged · helper at the isolator/kill · laptop + M1 Tune, logging ON.
**Pass:** oil PSI up within seconds, no leaks, charging in range, temps climbing normally, no PDM faults, stable idle, kill test works.
**On fail:** kill first, diagnose second. The ladder's logs say which stage's assumption broke — go back to that stage, not to guessing.

- [ ] **Pre-start:** extinguisher staged; helper briefed on the kill; coolant filled + burped enough to idle; coils + injectors connected; their PDM channels enabled.
- [ ] **Fuel prime + leak walk:** pump fuse IN, ignition on, pump primes; inspect every fitting tank-to-rail at full pressure BEFORE cranking. Rail pressure at the regulator set point — the A1000 is a bypass-regulated system (Aeromotive A1000 install doc p.2); **VERIFY the LS3 target value against `Marine_LS3_6.2L_Specs.pdf` before priming.**
- [ ] **Start. Watch, in order, first 60 seconds:**
  - [ ] Oil PSI up within ~5 s — or KILL.
  - [ ] Any leak, smoke, or hot-wire smell — KILL.
  - [ ] Charging voltage ~13.8–14.6 V once running.
  - [ ] Coolant temp climbing slowly; no PDM channel faults or overcurrents in the PDM live view.
  - [ ] Idle stabilizes; M1 log capturing throughout.
- [ ] **Within the first session:** fans commanded at threshold and running · water pump running · **kill test with the engine running:** open the isolator — the engine must die. A spinning alternator can keep the system alive after battery cut; the ECU shutdown contact is what stops the engine (the MoTeC secondary-contact requirement, proven here).
- [ ] No revving until pedal→throttle behavior is verified at idle. First run short; shut down, walk the bay by hand, re-check fluids.

---

## Sources

1. `docs/wiring/K5_WIRING_STATE.md` §1–§4 · `output/K5_cut_list_v4_2.txt` · `output/K5_ENGINE_START_MINIMUM.md` · receipts `2026-06-09_pinout-sheets-m130-pdm30.md`, `2026-06-10_cut-list-v4.1-ecu-lifelines.md`, `2026-06-10_cut-list-v4.2-aps-pedal.md`, `2026-05-14_open-question-estopp-trigger.md`
2. `reference/motec/VALIDATION_REPORT.md` — M130/PDM30 pinouts validated against MoTeC M1 ECU Hardware techspec pp.16–18, M130 datasheet pp.4–5, PDM User Manual PN 63029 p.44 (100% match); electrical specs incl. PDM 5 mA standby, CAN 120R (M130) / 100R (PDM30) termination
3. `research/2026-06-10_power_spine_builders_study.md` §2 — MoTeC isolator quote (PDM User Manual), ABYC OCP distances, starter-feed cranking exemption
4. Dave's Bronco M130 pinout — `~/Downloads/M130 ECU Overland Bronco (1).xlsx` (Desert Performance running customer build)
5. HPA Practical Standalone Tuning Step 1 — https://www.hpacademy.com/courses/practical-standalone-tuning/G4X-step01/ + HPA forum first-start guidance — https://www.hpacademy.com/forum/general-tuning-discussion/show/ecu-master-black-initial-start-up/
6. IPC/WHMA-A-620 harness testing (100% continuity + isolation, no sampling) — https://wireharnessproduction.com/blog/ipc-620-wire-harness-inspection-guide · https://www.telewiretech.com/blogs/technical-resources/wire-harness-quality-control-checklist-ipc-620-pull-testing-and-cfm
7. GM coolant-temp NTC ohms-vs-temp table — https://ls1tech.com/forums/pcm-diagnostics-tuning/1508642-anybody-have-ohms-vs-temp-table-gm-coolant-temp-sensor-40-f-284-f.html
8. LS3 stock injectors high-impedance ≈12 Ω — https://highperformanceinjectors.com/blogs/news/what-is-a-high-impedance-injector-and-why-should-you-use-one · https://www.hondata.com/tech-low-high-impedance-injectors
9. D510C = smart coil with internal igniter module — https://support.haltech.com/portal/en/kb/articles/ls2-ignition-coil
10. E-Stopp ESK001 = electric parking brake kit — https://estopp.com/pages/how-to
11. `reference_documents/component_drawings/Aeromotive_A1000_11101_Installation.pdf` p.2 — bypass regulator requirement

**Log discipline:** every measurement lands in `output/K5_bench_test_log.csv` with date and initials. This document certifies the process; the log certifies the harness.