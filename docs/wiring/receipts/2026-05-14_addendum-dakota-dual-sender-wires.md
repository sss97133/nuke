---
id: 2026-05-14_addendum-dakota-dual-sender-wires
date: 2026-05-14
change_type: substrate_amendment_proposal
scope: docs/wiring/output/K5_cut_list_v2.txt (engine + body + dash loom additions)
status: PROPOSED — needs Skylar approval
amends: none
---

# Dakota Digital VHX-73C-PU dual-sender wire enumeration

## Decision already made (this is enumeration, not a new decision)

Per `chapters/appendix-d-k5-build.md`:
> "Dual sender strategy: Factory gauge senders kept for Dakota Digital, separate Motec sensors for ECU. Not elegant, cheapest path to professional engine management without replacing gauge cluster."

This is locked. M130 uses MoTeC sensors (already in cut list as #110 CTS, #113 OTS, #102 OPS, #98 Fuel Level, etc.). **Dakota Digital uses factory GM senders in parallel** — those wires are NOT in the cut list yet.

## What's currently in the cut list for Dakota

- `#71 Dakota Digital Gauge Cluster` → `PDM30:OUT29` — 18 AWG ORN/VIO — **POWER feed only** (3.5 ft)

That's it. No sensor inputs to Dakota, no indicator feeds, no speedo signal, no tach.

## What's missing — proposed wire IDs

Skylar's proposed approach: "running hard lines for the gauges on the engine harness." Right call — engine-mounted factory senders join the engine loom and pass through the firewall via the same grommet as the M130 trunk.

### Engine loom additions (3 wires)

| ID | Label | From | To | Spec | Approx length | Note |
|---|---|---|---|---|---|---|
| `#114` | Dakota CTS Sender (factory) | GM CTS sender, driver-side head boss | Dakota cluster (via dash) | 22 AWG M22759/32 | 4.6 ft engine + 3.5 ft dash = ~8 ft | Single-wire sender; case-grounded to engine block. **Factory PN UNKNOWN** — typically GM 25036311 for square-body or aftermarket Dakota-supplied sender. Confirm Dakota's required signal range. |
| `#115` | Dakota Oil Pressure Sender (factory) | GM oil pressure sender, galley boss | Dakota cluster | 22 AWG M22759/32 | 4.6 ft + 3.5 ft = ~8 ft | Single-wire 0-90 PSI sender, case-grounded. **PN UNKNOWN.** |
| `#116` | Dakota Tach Signal | M130 tach output OR coil-pack tap | Dakota cluster | 22 AWG M22759/32 | varies | **Architecture decision needed**: (a) M130 outputs a tach pulse on a spare half-bridge → wire it to Dakota; (b) tap a single coil primary → wire to Dakota tach in; (c) Dakota receives tach via CAN from M130 (no hardline). Per Dakota VHX-73C-PU docs, (a) and (b) are both supported; (c) requires Dakota's CAN bridge module. |

### Body/chassis loom additions (2 wires)

| ID | Label | From | To | Spec | Approx length | Note |
|---|---|---|---|---|---|---|
| `#117` | Dakota Fuel Level Sender (factory) | GM 0-90Ω sender in fuel tank | Dakota cluster | 22 AWG M22759/32 | 18.4 ft | **In parallel with `#98 Fuel Level Sender (ECU)`** which goes to M130:A25 AV5. The factory sender is single-wire on K5 (case grounds via tank to body). Wire #117 is the tap. |
| `#118` | Dakota VSS / Speedo | Speedometer signal source | Dakota cluster | 22 AWG M22759/32 | 11.5 ft (chassis) | **Architecture decision needed**: (a) M130 outputs VSS pulse → wire to Dakota; (b) factory speedo gear/sensor on transfer case or transmission → hardline to Dakota; (c) Dakota CAN bridge receives M130 CAN VSS message. K5 currently has `#100 Vehicle Speed Sensor` at 22 AWG ORN/BLU 11.5 ft — could share with Dakota via splice OR Dakota gets its own. |

### Dash loom additions (4 indicator wires)

| ID | Label | From | To | Spec | Approx length | Note |
|---|---|---|---|---|---|---|
| `#119` | Dakota Turn Signal Left input | tap on #80 (Turn Signal Left Front) at dash side | Dakota cluster | 22 AWG M22759/32 | ~1.5 ft (splice in dash) | Dakota turn arrows light when this signal is active. Spliced off existing PDM-controlled turn output. |
| `#120` | Dakota Turn Signal Right input | tap on #82 (Turn Signal Right Front) at dash side | Dakota cluster | 22 AWG M22759/32 | ~1.5 ft | Same as #119 mirrored |
| `#121` | Dakota High Beam input | tap on high-beam side of headlight switch / PDM output | Dakota cluster | 22 AWG M22759/32 | ~2 ft | Lit when high beams active. Need to identify which existing wire provides this signal (`#39 Headlight Switch` or PDM-side LED headlight feed) |
| `#122` | Dakota Brake Indicator | tap on brake light circuit (#81 / #75 tail-light side OR brake switch side) | Dakota cluster | 22 AWG M22759/32 | ~1.5 ft | Brake-warning indicator on cluster. |

### Dash power/ground additions (2 wires)

| ID | Label | From | To | Spec | Length | Note |
|---|---|---|---|---|---|---|
| `#123` | Dakota Ground | star ground point at dash | Dakota cluster | 22 AWG M22759/32 | ~3 ft | Dedicated dash ground — not body case ground — for clean signal reference |
| `#124` | Dakota Switched +12V Backup | switched-ign at dash (probably PDM30:OUT29 splice or dedicated input) | Dakota cluster | 22 AWG M22759/32 | ~3 ft | Dakota cluster needs constant + switched; #71 might cover both via internal jumper. Verify Dakota wiring diagram. |

**Total: 11 new wires (3 engine loom + 2 body/chassis + 4 dash indicators + 2 power/ground).**

## Total cut list impact

- Wires before: 145 (123 original + 22 companion from earlier today)
- Wires after this addendum: **156**
- Engine loom wire count: 33 → 36
- Body/chassis combined: +2
- Dash: +6

Approximate added length: ~60-80 ft of 22 AWG M22759/32.

## Open within this addendum

- **#116 Tach source** — architecture pick (M130 output vs coil tap vs CAN bridge)
- **#118 VSS** — architecture pick (M130 output vs hardline vs CAN bridge)
- **#121 High beam source** — identify which existing wire to tap
- **GM factory sender PNs** — need to be cited from GM service manual or Dakota Digital VHX-73C-PU installation guide
- **Dakota VHX-73C-PU pin map** — has 16-26 input pins in a single Molex connector; need the install guide to know which Dakota pin each new wire terminates at

## Unknowns flagged honestly

- Lengths above are estimates from the same zone-distance pattern as the rest of v2 (NOT measured)
- Tach/VSS architecture is genuinely open
- The factory K5 already has wires for some of these (high beam, turn signal, brake indicator) — could we splice the existing wires at the dash rather than running new ones? Yes for those 4 indicators; this addendum proposes that approach (splice = "tap" in the table)

## Apply on approval

If Skylar accepts: append these 11 wires to `K5_cut_list_v2.txt` in a new section `>> DAKOTA DIGITAL DUAL-SENDER ADDENDUM`. Update `chapters/appendix-d-k5-build.md` "What's Left" to note Dakota sender wiring is now enumerated. Regenerate diagrams.
