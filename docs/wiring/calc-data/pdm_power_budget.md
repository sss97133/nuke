All four sources read. Note up front: there are **two conflicting PDM30 channel plans** in the substrate — `K5_pdm30_channel_plan.md` (2026-04-05, marked AUTHORITATIVE, 8×20A + 22×8A) and `harness_spec_latest.txt` (generated 2026-04-13, 6×20A + 14×15A + 10×10A, different device set including E-Stopp/QTP cutouts/keypad). Both are reported below.

---

# K5 PDM30 CHANNEL PLAN + POWER BUDGET

## 1. The 30 PDM30 output channels

### A. AUTHORITATIVE plan (`/Users/skylar/nuke/docs/wiring/output/K5_pdm30_channel_plan.md`, 2026-04-05)

**20A channels (OUT1–OUT8, dual-pin):**
| Ch | Device | Est. Amps | Rating |
|---|---|---|---|
| OUT1 | Radiator Fan 1 | 18A | 20A |
| OUT2 | Radiator Fan 2 | 18A | 20A |
| OUT3 | Power Window Motor Left | 15A | 20A |
| OUT4 | Power Window Motor Right | 15A | 20A |
| OUT5 | Electric Water Pump | 12A | 20A |
| OUT6 | Heater Blower Motor | 12A | 20A |
| OUT7 | Electric Parking Brake (E-Stopp) | 10A | 20A |
| OUT8 | Cigarette Lighter / 12V Outlet | 10A | 20A |

**8A channels (OUT9–OUT30):**
| Ch | Device(s) | Est. Amps | Rating |
|---|---|---|---|
| OUT9 | AMP Research Step Left | 8A | 8A |
| OUT10 | AMP Research Step Right | 8A | 8A |
| OUT11 | AMP Research Controller | 2A | 8A |
| OUT12 | Windshield Wiper Motor | 6A | 8A |
| OUT13 | `park_tail` group (Tail L/R + Park LF/RF) | 1.6A | 8A |
| OUT14 | Horn | 5A | 8A |
| OUT15 | `backup` group (Backup L/R + 3rd Brake + **Backup Camera**) | 3.0–3.5A | 8A |
| OUT16 | A/C Compressor Clutch | 4A | 8A |
| OUT17 | LED Headlight Left | 3.6A | 8A |
| OUT18 | LED Headlight Right | 3.6A | 8A |
| OUT19 | `markers_clearance` group (8 fixtures) | 1.25–1.3A | 8A |
| OUT20 | Radio / Head Unit | 3A | 8A |
| OUT21 | Power Lock Actuator Left | 3A | 8A |
| OUT22 | Power Lock Actuator Right | 3A | 8A |
| OUT23 | Transmission Controller | 3A | 8A |
| OUT24 | Wideband Lambda Controller | 3A | 8A |
| OUT25 | `interior_courtesy` group (5 fixtures) | 1.9–2.5A | 8A |
| OUT26 | Washer Pump | 2A | 8A |
| OUT27 | Turn Signal Left Front | 2A | 8A |
| OUT28 | Turn Signal Right Front | 2A | 8A |
| OUT29 | Display / Dash (Motec C125) | 1A | 8A |
| OUT30 | USB Charging Port | 1A | 8A |

30 of 30 used. 0 spare. 16 of 16 DIG inputs used, 0 spare.

### B. Harness-spec variant (`/Users/skylar/k5-harness-pull/harness_spec_latest.txt`, 2026-04-13) — DIFFERENT ratings & devices
| Ch | Max | Device | Amps |
|---|---|---|---|
| 1 | 20A | Radiator Fan 1 | 18A |
| 2 | 20A | Radiator Fan 2 | 18A |
| 3 | 20A | Power Window Motor Left | 15A |
| 4 | 20A | Power Window Motor Right | 15A |
| 5 | 20A | Heater Blower Motor | 12A |
| 6 | 20A | Electric Water Pump | 10A |
| 7 | 15A | E-Stopp Actuator | 10A |
| 8 | 15A | E-Stopp Controller Box | 10A |
| 9 | 15A | AMP Research Controller | 8A |
| 10 | 15A | AMP Research Step Left | 8A |
| 11 | 15A | AMP Research Step Right | 8A |
| 12 | 15A | QTP Electric Exhaust Cutout Left | 8A |
| 13 | 15A | QTP Electric Exhaust Cutout Right | 8A |
| 14 | 15A | Windshield Wiper Motor | 8A |
| 15 | 15A | [park_tail] 4 devices | 6A |
| 16 | 15A | Horn | 5A |
| 17 | 15A | [backup] 4 devices | 4.2A |
| 18 | 15A | A/C Compressor Clutch | 4A |
| 19 | 15A | LED Headlight Left | 3.6A |
| 20 | 15A | LED Headlight Right | 3.6A |
| 21 | 10A | Radio/Head Unit | 3A |
| 22 | 10A | Transmission Controller | 3A |
| 23 | 10A | Wideband Lambda Controller | 3A |
| 24 | 10A | Washer Pump | 2A |
| 25 | 10A | [turn_brake_left] | 2A |
| 26 | 10A | [turn_brake_right] | 2A |
| 27 | 10A | SGI-100BT Signal Bridge | 0.5A |
| 28 | 10A | Bosch iBooster Relay | 0.2A |
| 29 | 10A | Fuel Pump Relay | 0.2A |
| 30 | 10A | MoTeC 8-Button Keypad | 0.1A |

The harness spec also adds a **PDM15 secondary unit** (13/15 channels: instruments 13.05A, door_locks 6A, markers_clearance 3.2A, courtesy 2.8A, display 1A, interior_courtesy 0.5A, + 7 low-current mirrors; 2 spare). The authoritative plan has no PDM15; it puts locks/markers/courtesy on PDM30 channels. This is an unresolved substrate fork.

**Direct-wired (NOT on PDM30), per channel plan:** Alternator (220A, source), Starter (200A peak), Battery Disconnect (190A), Fuel Pump (35A, Aeromotive 16301 relay), Bosch iBooster (40A peak, dedicated relay), Amplifier (30A, direct fused battery), ECU sensors (M130 5V), injectors+coils (M130 low-side), Dakota Digital gauge (PDM IGN rail tap, not a channel).

## 2. M130 pin assignments in use (from harness spec wire schedule + appendix G)

**Connector A (34-pin Tyco Superseal):**
- A01 (OUT_HB2) — Electronic Throttle Body, h-bridge (W8)
- A03–A08 (IGN_LS1–LS6) — Ignition Coils 1–6 (W17–22)
- A10/A11 (BAT_NEG1/2) — battery negative / sensor star ground (appendix G §2.3)
- A12, A13 (IGN_LS7, LS8) — Ignition Coils 7, 8 (W23–24)
- A14 (AV1) — Fuel Pressure Sensor (W112)
- A15 (AV2) — MAP Sensor (W116)
- A16 (AV3) — Oil Pressure Sensor (W117)
- A17 (AV4) — Throttle Position Sensor 1 (W119)
- A19–A22 (INJ_PH1–PH4) — Fuel Injectors 1–4 (W9–12)
- A25 (AV5) — Throttle Position Sensor 2 (W120)
- A27–A30 (INJ_PH5–PH8) — Fuel Injectors 5–8 (W13–16)

**Connector B (26-pin Tyco Superseal):**
- B01 (UDIG1) — Crank Position Sensor (W110)
- B02 (UDIG2) — Cam Position Sensor (W108) **and** Rear Backup Camera composite video (W105) — double-assigned in the harness spec; substrate conflict
- B03 (AT1) — Coolant Temp (W109)
- B04 (AT2) — Intake Air Temp (W113)
- B05 (AT3) — Oil Temp (W118)
- B07 (KNOCK1) — Knock Bank 1 (W114)
- B13 (KNOCK2) — Knock Bank 2 (W115)
- B15/B16 (SEN_0V_A/B) — sensor ground returns (appendix G)
- B17/B18 (CAN_H/CAN_L) — CAN backbone to PDM30 B25/B26 + C125/Dakota Digital (W62, W63, W69)

Fit summary from spec header: "M130 fits: 8/8 inj, 4/7 dig, 1/6 hb".

## 3. Power budget (harness spec, lines 281–285)

- **Continuous draw: 299A**
- **Alternator: 250A** ("Dual alternator or 250A+ custom")
- **Headroom: −49A (−20%)** — i.e., continuous demand exceeds alternator capacity by 49A. This is the warning: the budget is **negative**; the spec's mitigation note is the dual-alternator/250A+ custom callout. (Alternator capacity is itself inconsistent across docs: harness spec = 250A; channel plan direct-wire table = 220A; appendix G component_library cites Powermaster 47294 = **150A**. Three different values — needs reconciliation.)
- High-current circuits (≥15A): Radiator Fan 1 (18A), Radiator Fan 2 (18A), Power Window L (15A), Power Window R (15A), all 12 AWG, PDM-protected.
- Related EE-audit FAILs: `PDM30_BAT+` and `PDM30_BAT−` 2 AWG (derated 73.5A) < **150A required** (104% over); `PDM30_Ch7`/`Ch8` (E-Stopp) 16 AWG < 8A required; `REAR-SUB-POS/NEG` 14 AWG < 15A required.

**Continuous current by subsystem** (no per-subsystem table exists in any doc; computed from channel amps — routing-zone totals from the spec listed after):
| Subsystem | Continuous A |
|---|---|
| Cooling (fans ×2 + water pump) | 46A |
| HVAC (blower + A/C clutch) | 16A |
| Windows + locks | 36A (30 windows + 6 locks) |
| AMP steps (×2 + controller) | 24A |
| E-Stopp (actuator + controller) | 20A |
| Exhaust cutouts (QTP ×2) | 16A |
| Audio (amp 30A direct + head unit 3A) | 33A |
| Lighting (all exterior + interior groups) | ~27A |
| Wiper + washer | 10A |
| Instruments/display (PDM15) | ~14A |
| Controllers (trans, wideband, SGI, relays, keypad) | ~7A |
| Fuel pump (direct relay) | 35A |
| iBooster (direct relay) | 40A peak |
| Horn (momentary) | 5A |

Spec's own routing-zone totals: dash→engine_bay 164.5A (54 wires, through bulkhead), dash→underbody 51A, dash→doors 36.6A, dash→dash 24.4A, dash→rear 20.2A, dash→firewall 0.2A.

## 4. Channels freed by removing subsystems

Using the AUTHORITATIVE plan (harness-spec variant in parens):

| Removed subsystem | PDM30 channels freed | Load shed |
|---|---|---|
| Power windows | OUT3 + OUT4 — two **20A** dual-pin channels (spec: Ch3/Ch4, 20A) | 30A |
| Power locks | OUT21 + OUT22 — two 8A channels (spec: PDM15 door_locks ch) + DIG10/DIG11 inputs freed | 6A |
| Audio amp/sub/speakers | **Zero channels** — amp is direct-fused battery (30A), speakers/sub hang off amp/head unit. Head unit is OUT20 (8A); only freed if head unit goes too (spec: Ch21) | 30A (+3A w/ head unit) |
| AMP steps | OUT9 + OUT10 + OUT11 — three 8A channels (spec: Ch9/10/11, 15A) | 18A (spec: 24A) |
| Rear camera | **Zero channels** — shares OUT15 `backup` group with backup lights + 3rd brake; channel stays (video signal is on M130 B02). Sheds 0.5A from OUT15 | 0.5A |
| A/C | OUT16 — one 8A channel (spec: Ch18, 15A); also kills 2 ECU digital inputs (pressure switches W106/107) | 4A |
| E-Stopp | OUT7 — one **20A** dual-pin channel (spec: Ch7 + Ch8, both 15A — and both are EE-audit ampacity FAILs) | 10A (spec: 20A) |

**Net if all six subsystems are cut:** 9 channels freed on the authoritative plan — three 20A (OUT3, OUT4, OUT7) + six 8A (OUT9, OUT10, OUT11, OUT16, OUT21, OUT22) — ten with the head unit (OUT20). Ten/eleven on the harness-spec layout (Ch3,4,7,8,9,10,11,18 + locks + optionally 21). DIG10/DIG11 free; DIG12/DIG13 must stay (door switches still trigger courtesy lights). Load shed ≈ 90–105A continuous, taking the budget from 299A to ~195–210A — flips headroom from **−49A** to roughly **+40–55A positive** on the 250A alternator, and within reach of the 220A unit (still over the 150A Powermaster if that's what's actually in the component library).

**Files:** `/Users/skylar/nuke/docs/wiring/output/K5_pdm30_channel_plan.md`, `/Users/skylar/nuke/docs/wiring/output/K5_EE_AUDIT.md`, `/Users/skylar/k5-harness-pull/harness_spec_latest.txt` (power budget at lines 281–285), `/Users/skylar/nuke/docs/wiring/chapters/appendix-g-diagram-requirements-spec.md` (pin-map references §2.3, §7.1, §7.3).