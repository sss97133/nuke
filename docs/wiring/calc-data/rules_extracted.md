All sources read. Here is the structured rule spec.

# K5 Wiring Doctrine — Complete Derivation Rule Set

Sources: `docs/wiring/chapters/05-build-manifest.md` (DOC-05), `docs/wiring/chapters/06-compute-engine.md` (DOC-06), `nuke_frontend/src/components/wiring/overlayCompute.ts` (CLIENT), `nuke_frontend/src/components/wiring/harnessCalculations.ts` + `harnessConstants.ts` (CALC/CONST), `supabase/functions/_shared/wiringCompute.ts` (SERVER — the real engine behind `compute-wiring-overlay`), `supabase/functions/generate-cut-list/index.ts` (CUTLIST), `supabase/functions/generate-wiring-bom/index.ts` (BOM), `supabase/functions/generate-harness-spec/index.ts` (HSPEC).

---

## 1. Signal Type → Wire Count + Companion Wires (DOC-05, the FULL table)

### ECU-connected
| signal_type | wire count | companions | example |
|---|---|---|---|
| `analog_5v` | **3** | signal + 5V ref (`r` suffix) + ground (`g` suffix) | MAP, fuel pressure |
| `analog_temp` | **2** | signal + ground return (`g`) | CLT, oil temp, IAT |
| `ecu_digital_input` | **1–3** | varies | brake switch, AC request, VSS |
| `ecu_crank_cam` | **3 (shielded)** | signal + ground + shield drain (`s`) | crank, cam sensor |
| `piezoelectric` | **2 (shielded)** | + shield drain | knock bank 1/2 |
| `wideband_lambda` | **5 (to LTCD)** | Bosch LSU 4.9 via LTCD controller | O2 |
| `h_bridge_motor` | **2 (motor) + 4 (sensor)** = 6 | electronic throttle body | DBW |
| `low_side_drive` | **2** | signal + power (from `#INJ_PWR` rail) | injectors |
| `logic_coil_drive` | **4** | signal + power + grounds | ignition coils |

### PDM-connected (power from PDM channel)
`led_lighting`, `motor` (with `pdm_controlled=true`), `audio`, `controller`, `can_display`, `power_outlet`

### PDM inputs (switches → PDM)
`pdm_input` — headlight switch, turn signal switch, ignition switch

### Standalone (no ECU/PDM connection)
`standalone_switch` (reversing-polarity window/lock switches), `standalone_module` (hazard flasher, AMP Research controller)

### Infrastructure
`ground`, `power_source`, `can_bus` (twisted pair), `relay`, `alternator`, `bulkhead_passthrough` (SERVER only — not in DOC-05's table)

### Companion wire naming (DOC-05, added 2026-05-14)
- Suffix `g` = sensor ground return — 22 AWG M22759/32 BLK (e.g. #110g CLT ground → M130:B16)
- Suffix `r` = 5V ref companion — 22 AWG M22759/32 GRY (e.g. #108r MAP 5V → M130:A02 SEN_5V_A)
- Suffix `s` = shield drain (M27500 cables) — 22 AWG bare/BLK (e.g. #99s CKP shield → M130:B15)

**SEN_0V pairing rule** (motec_m1_hardware_techspec.pdf p17): keep pullup rail and ground on the same letter. AT1(B03)→SEN_5V_A→B15; AT2(B04)→SEN_5V_B→B16; AT3(B05)→SEN_5V_A→B15; AT4(B06)→SEN_5V_B→B16. Extended to AV inputs by builder choice.

**Bus rails** (not parented to a signal wire): `#INJ_PWR` injector +12V rail, 16 AWG, PDM30 channel TBD, 8x daisy-chained via WPINJ40 pigtails; `#COIL_PWR` coil +12V rail, 14 AWG (DEL-Stributor bracket bus, 8 coils); `#COIL_GND` coil ground rail, 14 AWG (bracket → engine block stud).

> **CONTRADICTION C1 (doc vs ALL code):** No compute engine implements companion-wire expansion. CLIENT, SERVER, and CUTLIST all emit **exactly 1 wire per device** (`for device → wires.push(one entry)`). DOC-05 says analog_5v=3, logic_coil_drive=4, etc. The calc engine you code MUST implement the doc's expansion; the existing code undercounts wires, terminals, and lengths by roughly 2–4×.

---

## 2. Gauge Derivation (amps → AWG)

**Formula** (SERVER `selectWireGauge`, lines 22-38 — this is the doctrine version):
```
effectiveAmps = amps × 1.25            // 25% safety margin
maxDropVolts  = (3 / 100) × 12 = 0.36 V
vDrop = effectiveAmps × ohmsPerFt × lengthFt × 2   // ×2 = round trip
pick smallest wire (highest AWG number, iterating 22→0) where
  vDrop ≤ 0.36  AND  maxAmps ≥ effectiveAmps
fallback: 0 AWG (SERVER) / 4 AWG (CUTLIST) / heaviest in table (CALC)
```
Motor loads (CALC `isMotor`): effectiveAmps = amps × 1.25 (same multiplier, applied for inrush).

**AWG table** (identical constants in CONST, SERVER, CUTLIST; resistance Ω/ft @20°C, ampacity = chassis wiring in enclosed bundle):
| AWG | Ω/ft | maxAmps |
|---|---|---|
| 22 | 0.01614 | 5 |
| 20 | 0.01015 | 7.5 |
| 18 | 0.00639 | 10 |
| 16 | 0.00402 | 15 |
| 14 | 0.00253 | 20 |
| 12 | 0.00159 | 25 |
| 10 | 0.00100 | 35 |
| 8 | 0.000628 | 50 |
| 6 | 0.000395 | 65 |
| 4 | 0.000249 | 85 |
| 2 | 0.000156 | 115 |
| 0 | 0.0000983 | 150 |

(CUTLIST's local copy stops at 4 AWG.)

**Override order:** `device.wire_gauge_recommended` (manifest column) beats the computed gauge in every engine.

> **CONTRADICTION C2 (client vs server):** CLIENT's `selectWireGauge` (CALC) applies the 1.25 multiplier ONLY for motors (`effectiveAmps = isMotor ? amperage*1.25 : amperage`), then reports actual drop using raw amps. SERVER and CUTLIST apply ×1.25 to ALL loads for both drop and ampacity checks. DOC-06 says "amperage + wire length + 3% max voltage drop + 25% safety margin" — server behavior matches the doc; client is looser by one gauge step on non-motor loads.

**Wire spec by gauge** (wire-closure protocol, `.claude/rules/wiring-wire-closure-protocol.md`): M22759/32 for 12–22 AWG, M22759/16 for 4–10 AWG, M27500-series for shielded/twisted-pair. Tiers (CONST): professional = M22759/32 Tefzel MIL-spec 200°C; standard = TXL automotive 125°C. CUTLIST spec strings: `"{gauge} AWG {tier}"`, shielded → `"{gauge} AWG SHIELDED 2C"`, CAN → `"{gauge} AWG TWISTED PAIR"` + note "120Ω termination each end".

**Drop-quality bands** (CALC): <1% Excellent, <2% Good, <3% Acceptable, ≥3% "Marginal — consider upsizing" + warning.

---

## 3. Fuse Rating

`fuse = next standard size ≥ continuousAmps × 1.25` from `[1, 2, 3, 5, 7.5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100]`; cap 100. Only for non-PDM circuits (PDM channels self-protect). CLIENT/SERVER only attach a fuse when `amps > 1` and wire is not on a PDM channel.

---

## 4. Length Estimation

**Simple zone table** (CLIENT, CUTLIST): `lengthFt = ZONE_LENGTHS[zone] × 1.15` (15% slack); `{engine_bay: 4, firewall: 2, dash: 3, doors: 6, rear: 16, underbody: 10, roof: 5}`, default 5.

**Zone-aware routing** (SERVER only — `estimateRouteLength`): pair table × 1.15, e.g. `engine_bay→dash: 9` (4+2+3 through firewall), `engine_bay→rear: 22`, `dash→rear: 16`, `doors→doors: 8`. Direct (no bulkhead) overrides: `engine_bay→dash: 6`, `engine_bay→doors: 8`, `engine_bay→rear: 18`. Fallback = sum of both zones' estimates × 1.15. Source zone = PDM zone if PDM-fed else ECU zone; `device.measured_length_ft` overrides everything (DOC-06: "measured value if vehicle_circuit_measurements exist").

**Firewall crossing:** engine side = `{engine_bay}`; interior side = `{dash, doors, rear, roof}`. If a `bulkhead_passthrough` device exists, crossing wires get sequential bulkhead pins; warnings at overflow (`pins_used > pin_count`) and headroom ≤ 5.

Wire-closure protocol pads estimates "+15% body / +20% engine" — the 20% engine pad exists nowhere in code (doc-only rule).

CONST also has a per-vehicle-type `TYPICAL_LENGTHS` matrix (hot_rod/car/truck/race_car, e.g. truck `engine_bay→rear: 20`) with `SLACK_MULTIPLIER = 1.15` — used by the load-summary path, not the overlay path.

---

## 5. I/O Counting → ECU Model Derivation

**Counting rules** (CLIENT and SERVER agree except where flagged):
- injectorOutputs = count(`device_name.startsWith('Fuel Injector')`)
- ignitionOutputs = count(`device_name.startsWith('Ignition Coil')`)
- halfBridgeOutputs = count(`signal_type === 'h_bridge_motor'` OR (`'motor'` AND `pdm_controlled === false`))
- tempInputs = count(`signal_type === 'analog_temp'`)
- digitalInputs = count(signal_type ∈ `['ecu_digital_input', 'digital']`)
- knockInputs = count(`signal_type === 'piezoelectric'`)
- analogInputs: SERVER = count(`signal_type === 'analog_5v'`); CLIENT = count(`signal_type.startsWith('analog')` && ≠ `analog_temp`) — same result today but CLIENT would also swallow future `analog_*` types.
- canBuses: SERVER = `some(can_bus || can_display) ? 1 : 0`; CLIENT = `some(can_bus) ? 2 : 1`. **CONTRADICTION C3** — client demands 2 CAN buses if any CAN device exists (forcing M150), server demands 1. DOC-06 doesn't specify; M130 has 1 CAN, so the client rule silently disqualifies M130 from any CAN build.

**ECU spec table** (identical in CLIENT/SERVER; prices in BOM too):
| Model | Inj | Ign | HB | Analog | Temp | Digital | CAN | Knock | Price |
|---|---|---|---|---|---|---|---|---|---|
| M130 | 8 | 8 | 6 | 8* | 4 | **7** | 1 | 2 | $3,500 |
| M150 | 12 | 12 | 10 | 17 | 6 | 16 | 3 | 2 | $5,500 |
| M1 | 16 | 16 | 16 | 24 | 8 | 24 | 4 | 4 | $8,000 |

> **CONTRADICTION C4 (doc vs code):** DOC-06's table says M130 has **9 analog** and **8 digital**. Code says **8 analog** (comment: "8 Analog Voltage") and **7 digital** (comment: "NOT 8 — corrected from verified source racespeconline.com"). Code is the corrected truth (the M130 Discovery in DOC-05 explicitly uses "M130's 7"); DOC-06's table is stale. M150/M1 rows match.

**Selection:** fits = every requirement ≤ spec (CLIENT omits the knock check from `fits`; SERVER includes it — **CONTRADICTION C5**, minor). Minimum ECU = first fitting model in ascending price order; if nothing fits → `M1+` @ $10,000. Headroom (CLIENT) = `1 − ΣtotalNeeded/ΣtotalAvail` over the 6 non-CAN/knock dims. ECU is an OUTPUT, never a choice. Bottleneck reporting enumerates each insufficient dimension as `need X, has Y`.

> **Note:** CUTLIST derives ECU model by injector count alone (`inj ≤ 8 → M130, ≤ 12 → M150, else M1`) — a shortcut that ignores digital/analog bottlenecks. Don't replicate.

The M130 lesson (DOC-05): generic `switch` classification → 20 digital inputs → M150; correct classification → 4 ECU digital inputs (brake, AC pressure ×2, VSS) ≤ 7 → M130, $2,000 saved. A calc engine should reject/flag generic `signal_type='switch'`.

---

## 6. PDM Rules

**Channel candidates filter** (CLIENT + SERVER + CUTLIST identical): `pdm_controlled !== false` AND `power_draw_amps > 0` AND signal_type ∉ `{power_source, ground, can_bus}` AND name not starting with `Fuel Injector` / `Ignition Coil` / `Throttle Position`. (Injectors/coils get power from PDM **rail** channels `#INJ_PWR`/`#COIL_PWR`, controlled by ECU pins — DOC-05.)

**Grouping:** devices sharing `pdm_channel_group` collapse to one channel with summed amps. K5 canonical groups (DOC-05): `markers_clearance` (8 dev, 3.2A), `park_tail` (4, 6.0A), `interior_courtesy` (5, 2.5A), `backup` (4, 4.7A), `turn_brake_left` (1, 2.0A), `turn_brake_right` (1, 2.0A). Effect: 47 loads → 30 channels (exact PDM30 fit).

**Assignment:** sort descending by amps; heaviest loads take lowest-numbered (highest-rated) outputs; assign OUT1..OUT30 sequentially.

**Channel ratings — CONTRADICTION C6 (three versions):**
- CLIENT `overlayCompute` + validated comment (MoTeC PDM User Manual p39): **PDM30 = 8×20A (OUT1-8, dual-pin, 115A transient) + 22×8A (OUT9-30, 60A transient); PDM15 = 8×20A + 7×8A**. Dual-pin pairs documented: A01+A10, A03+A12, A05+A14, A07+A16, A09+A17, B03+B09, B05+B11, B07+B13. ← marked VALIDATED, use this.
- SERVER `assignPDMChannels`: Ch1-6=20A, Ch7-20=15A, Ch21-30=10A. ← stale, contradicts the validated manual.
- CALC `calculateLoadSummary`: ch≤10→20A, ≤15→25A, ≤20→20A, ≤25→15A, else 10A. ← stale, a third invention.

**PDM config matrix** (CLIENT): PDM15 $2,200 (15ch); PDM30 $3,140 (30ch); 2×PDM15 $4,400 (30ch); PDM30+PDM15 $5,340 (45ch). Fits = channelsUsed ≤ totalChannels. SERVER instead picks a single model: `channels ≤ 16 → PDM15 else PDM30` (note: ≤16 is off-by-one vs PDM15's 15 channels — **bug**, channel 16 would overflow a PDM15).

**Warnings:** headroom ≤ 2 channels; per-channel `totalAmps > maxAmps` overload; >30 channels overflow ("need dual PDM"). PDM max per channel = 20A — anything above is direct-wired.

**Direct-wired (NOT PDM)** (DOC-05): Alternator 220A (IS the source; direct to battery + sense wire), Starter 200A peak (direct battery + relay trigger), Battery disconnect 190A (inline master), Fuel pump 35A (Aeromotive 16301 relay kit), Brake booster/iBooster 40A peak (dedicated relay), Amplifier 30A (direct fused battery wire), all sensors (ECU 5V ref), injectors+coils (PDM rails, ECU-pin control). Rule: >20A continuous → cannot ride a PDM channel.

**Config matrix:** all fitting ECU × PDM combos, `totalCost = ecu.price + pdm.price`, sorted ascending; cheapest valid = recommendation (e.g. M130+PDM15 $5,700 … M150+PDM30+PDM15 $10,840).

---

## 7. Alternator + Battery Sizing

`required = ceil(totalContinuousAmps × 1.25)` where totalContinuousAmps = Σ power_draw_amps excluding `power_source` devices. Ladder (CLIENT+SERVER): ≤80→"80A stock"; ≤105→"105A stock high-output"; ≤145→"145A CS130D"; ≤180→"180A AD244"; ≤220→"220A AD244"; else dual alternator / 250A+ custom. (CALC has a divergent legacy ladder 80/100/130/160/200 — ignore.)

Battery (CALC only): `minAh = ceil(totalContinuousAmps × 0.5 + 20)`; ≤40→Optima 34R 50Ah, ≤55→Optima 75/25, ≤75→Optima D34, else dual. Cranking assumption 600 CCA if a `starting` device exists. Warning at total load >150A.

---

## 8. Wire Color Derivation

Deterministic by function group + stripe sequence. Base map (CLIENT/SERVER identical): injector GRN, ignition_coil WHT, crank_cam BLU/WHT, sensor_5v_ref RED/BLK, sensor_signal VIO, sensor_ground BLK/WHT, temp_sensor TAN, knock GRY, o2_wideband VIO/BLU, throttle_motor ORG, tps_signal DK BLU, can_high WHT/GRN, can_low GRN/WHT, headlight_high LT GRN, headlight_low TAN, tail_park BRN, turn_left LT BLU, turn_right DK BLU, backup LT GRN, brake WHT, horn DK GRN, wiper PPL, door_trigger GRY, window_motor DK BLU, lock_motor BLK, battery_positive RED, ground BLK, ignition_switched PNK, accessory ORN, pdm_high RED/BLK, pdm_medium ORN/BLK, pdm_low YEL/BLK; fallback WHT.

Stripe sequence: `['', '/WHT', '/BLK', '/RED', '/BLU', '/YEL', '/VIO', '/ORG', '/GRN', '/GRY', '/BRN', '/TAN']` — index = nth device in same function group (injector 1 = GRN, 2 = GRN/WHT, 3 = GRN/BLK…). CUTLIST truncates stripes to 8 entries (`['', '/WHT', '/BLK', '/RED', '/BLU', '/YEL', '/VIO', '/ORG']`) — minor drift. Post-Tefzel 3-color-stripe remap lives in `K5_wire_spec_and_costs.md` §"Three-Color Stripe Problem" (doc substrate, not code).

Function-group classification precedence: device_name prefix (`Fuel Injector`/`Ignition Coil`/`Crank|Cam`) → signal_type mapping → name-based lighting/motor subtyping. Default differs: CLIENT → `accessory`, SERVER → `sensor_signal` (cosmetic contradiction).

---

## 9. Shielding / Twisted Pair

Shielded: `requires_shielding` flag — doctrine = crank, cam, knock (VR/hall noise susceptibility), per DOC-05/06. Order shielded as 2-conductor shielded cable (M27500). Twisted pair: `signal_type === 'can_bus'` only; 120Ω termination each end.

---

## 10. ECU Pin Assignment Order (edge functions, not in docs)

From `device_pin_maps` table filtered by ECU model: injectors → `signal_type='injector_output'` pins sorted by numeric pin_function; coils → `ignition_output` likewise; Crank → pin_function `UDIG1`; Cam → `UDIG2`; knock → `knock_input` pins in order; analog_temp → `analog_temp_input` pins in order; analog_5v → `analog_voltage_input` pins in order. First-come-first-served per device iteration order (manifest sorted by `device_category`). Wire `from` ref = `"{model}:{pin_number}"` or `"PDM30:OUT{n}"`.

---

## 11. Bundle / Trunk + Labor + Misc Constants

- **No bundle-OD rule exists anywhere** (docs or code). HSPEC groups wires into trunk bundles by `fromZone→toZone` pair, reporting wire_count, total_amps, gauges — no OD math.
- Labor: `laborHours = round(wireCount × 0.5)`; default `labor_rate = $65/hr` (BOM); overlay `estimated_hours = round(wires × 0.5)`.
- BOM extras: TXL wire $0.15/ft; avg wire length 7.3 ft (`totalWireFt = wireCount × 7.3`); terminations $0.50 each; connector kits M130 $35 / M150 $56.21 (ProWire); DTM kits 15×$7; DR-25 heat shrink $70; consumables $100. **Note:** BOM hardcodes `ecuModel='M130'` (line 31, "simplified") — it does not derive.
- Spool suggestion (CUTLIST): next of {10, 25, 50, 100, ceil(ft/100)×100} ≥ needed ft.
- Wire-emission skip rule: devices with `pin_count` 0/null, `ground`, `power_source` (and SERVER: `bulkhead_passthrough`) generate no wires.
- Delta rule (DOC-06/CLIENT): on add/remove, report devicesΔ, wiresΔ, lengthΔ, ampsΔ, ECU model change, PDM channelsΔ, costΔ, new/resolved warnings.

---

## Contradiction Summary

| # | What | Doc says | Code says | Use |
|---|---|---|---|---|
| C1 | Wires per device | analog_5v=3, logic_coil_drive=4, etc. | All engines emit 1 wire/device | **Doc** — implement expansion |
| C2 | 25% safety margin in gauge calc | Always (DOC-06) | CLIENT: motors only; SERVER/CUTLIST: always | **Server/doc** |
| C3 | CAN bus requirement | unspecified | CLIENT: 2 if any can_bus; SERVER: 1 if can_bus/can_display | **Server** (1) — client forces M150 wrongly |
| C4 | M130 analog/digital | 9 analog, 8 digital (DOC-06 table) | 8 analog, 7 digital (verified source) | **Code** — DOC-06 stale; DOC-05's M130 story confirms 7 |
| C5 | Knock in ECU fit check | implied | CLIENT omits, SERVER includes | **Server** |
| C6 | PDM30 channel ratings | DOC-05 grouping assumes 30ch | CLIENT: 8×20A+22×8A (validated, manual p39); SERVER: 6×20/14×15/10×10A; CALC: third variant | **Client** (validated) |
| C7 | SERVER PDM15 cutoff | — | `channels ≤ 16 → PDM15` but PDM15 has 15 channels | off-by-one bug |
| C8 | Engine-zone length pad | +20% engine (wire-closure protocol) | 1.15 everywhere | doc rule unimplemented |

Key file paths: `/Users/skylar/nuke/docs/wiring/chapters/05-build-manifest.md`, `/Users/skylar/nuke/docs/wiring/chapters/06-compute-engine.md`, `/Users/skylar/nuke/nuke_frontend/src/components/wiring/overlayCompute.ts`, `/Users/skylar/nuke/nuke_frontend/src/components/wiring/harnessCalculations.ts`, `/Users/skylar/nuke/nuke_frontend/src/components/wiring/harnessConstants.ts`, `/Users/skylar/nuke/supabase/functions/_shared/wiringCompute.ts`, `/Users/skylar/nuke/supabase/functions/generate-cut-list/index.ts`, `/Users/skylar/nuke/supabase/functions/generate-wiring-bom/index.ts`, `/Users/skylar/nuke/supabase/functions/generate-harness-spec/index.ts`.