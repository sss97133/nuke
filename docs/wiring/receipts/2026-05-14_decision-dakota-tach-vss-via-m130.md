---
id: 2026-05-14_decision-dakota-tach-vss-via-m130
date: 2026-05-14
change_type: substrate_amendment
scope: docs/wiring/output/K5_cut_list_v2.txt + K5_WIRING_STATE.md
status: APPLIED (agent decision; method = constraint analysis)
amends: 2026-05-14_addendum-dakota-dual-sender-wires (resolves #116 and #118)
---

# Dakota tach (#116) and VSS (#118) — both via M130 spare half-bridge

## Method applied

Skylar 2026-05-14: "use the correct scientific method or best practices of an AI agent based on the facts that you have."

## Constraint analysis — tach (#116)

| Option | Hardware deps | Firmware deps | Signal quality | Cost delta |
|---|---|---|---|---|
| M130 spare half-bridge (A31/A32/A33/A34 OUT_HB3-HB6) | none (M130 + Dakota only, no extra modules) | M1 GPR tach output config (one-time at tune) | clean square wave, ECU-synthesized | $0 |
| Coil primary tap | none (wire to D510C terminal) | none | noisy / high-V spikes, needs Dakota filter input | $0 |
| Dakota CAN bridge | requires Dakota CAN module purchase (~$150) | both M130 CAN message + Dakota CAN map config | clean digital | +$150 |

**Decision: M130 spare half-bridge.** Cleanest signal, zero extra hardware, no module purchase. Firmware config is one-time at tune session.

**M130 pin selection:** A31 = OUT_HB3 (currently UNUSED per connector schedule). Assign to "Dakota Tach Out."

## Constraint analysis — VSS (#118)

| Option | Hardware deps | Firmware deps | Notes |
|---|---|---|---|
| M130 spare half-bridge (passthrough of #100 VSS input) | none | M1 GPR config to mirror input VSS to output | M130 already receives VSS via #100 (transmission output speed sensor); reuses that signal |
| Hardline from transfer case speedo cable / gear | requires factory speedo cable + adapter | none | physical mechanical reliability lower; cable runs are long |
| Dakota CAN bridge | requires Dakota CAN module | M130 CAN VSS message + Dakota CAN map | +$150 |

**Decision: M130 spare half-bridge.** Same rationale — M130 already has the speed signal as input via #100, simplest to output a mirrored pulse to Dakota.

**M130 pin selection:** A32 = OUT_HB4 (UNUSED). Assign to "Dakota VSS Out."

## Wires updated

| ID | Field | Was | Now |
|---|---|---|---|
| #116 Dakota Tach Signal | FROM | TBD | **M130:A31** (OUT_HB3) |
| #116 | Color | WHT/BLK | WHT/BLK (kept) |
| #118 Dakota VSS Speedometer | FROM | TBD | **M130:A32** (OUT_HB4) |
| #118 | Color | ORN/BLU | WHT/YEL (changed — ORN/BLU was speculative; new color follows tach naming convention) |

## Connector schedule impact

`K5_connector_schedule.txt` M130 Connector A:
- **A31 = OUT_HB3** — was UNUSED → now "Dakota Tach Out" (wire #116)
- **A32 = OUT_HB4** — was UNUSED → now "Dakota VSS Out" (wire #118)
- A33/A34 (OUT_HB5/HB6) remain UNUSED — spare HB outputs for future provisioning (winch trigger, auxiliary, etc.)

Per the wiring-receipt rule, the connector_schedule.txt update is a substrate_correction in its own right — will land in a quick follow-up commit if desired, OR can stay as "noted in this receipt" until consolidated.

## Sub-decisions still open

Zero. All three of the Dakota addendum's TBD entries are now resolved (#116 tach, #118 VSS, #121 high beam via floor dimmer).

## Trade-offs honestly noted

- **M1 GPR firmware config** is required at tune time to enable OUT_HB3/HB4 tach + VSS output. If GPR doesn't expose these outputs in its standard channel set, would require GPR-T1 firmware (which we're already considering for TCU — see open question #5 acceptance: Holley 558-499 picked, GPR-T1 not needed for transmission). If MoTeC GPR doesn't support arbitrary tach/VSS frequency output, fallback is coil-tap for tach + hardline for VSS (next-best options).
- **Half-bridge ampacity** — HB outputs are rated for actuator loads (~10A). Driving a low-current Dakota input (~5-10mA) is trivial; the HB pin is wildly over-spec for this. That's fine — over-spec on the M130 side, normal on the Dakota side.
- A33/A34 stay as spare HB outputs — Skylar's "provisioning for future winch" use case lands here.
