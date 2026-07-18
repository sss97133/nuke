---
id: 2026-05-14_acceptance-three-decisions
date: 2026-05-14
change_type: substrate_amendment
scope: docs/wiring/output/K5_cut_list_v2.txt + docs/wiring/K5_WIRING_STATE.md §1 (lock these decisions)
status: APPLIED
amends:
  - 2026-05-14_addendum-dakota-dual-sender-wires (acceptance)
  - 2026-05-14_open-question-6l80e-tcu-architecture (decision: Option A — Holley 558-499 T43)
  - 2026-05-14_open-question-estopp-trigger (decision: Option A — dash button)
---

# Three decisions accepted — Dakota / Holley 558-499 T43 / E-Stopp dash button

Skylar's verbal acceptance 2026-05-14: "approve dakota, holley 558, dash button"

## Decisions locked

### 1. Dakota Digital VHX dual-sender wires — APPROVED
11 wires (#114–#124) appended to cut list per `2026-05-14_addendum-dakota-dual-sender-wires.md`. Sub-decisions still open: tach source (#116), VSS source (#118), high-beam tap location (#121). These three wires are enumerated but not yet routable.

### 2. 6L80E TCU architecture — Holley 558-499 T43 standalone (Option A)
- Independent TCU module receives engine state from M130 via CAN
- Includes 16-pin Kostal LKS 1.5 connector (Holley PN 19303772) to 6L80E transmission per `K5_connector_shopping_list.txt:53-58`
- Module power feed: existing `#58 Transmission Controller` (PDM30:OUT23, 3A) covers this
- CAN tap to T43 added as wire #125 (22 AWG twisted pair stub from main CAN trunk #62)
- Holley 558-499 kit includes T43 connector + internal wiring per shopping list note

### 3. E-Stopp ESK001 trigger — Dash button (Option A)
- Latching illuminated dash button → E-Stopp signal pin
- Trigger wire added as #126 (22 AWG, ~10 ft from dash to E-Stopp)
- Button BOM item — needs PN selection (Carling-style latching illuminated typical)
- Power for button (and indicator illumination) shares dash circuit — verify per E-Stopp ESK001 wiring diagram

## Cut list impact

| | Before | After |
|---|---|---|
| Wire count | 145 (123 original + 22 companion) | **158** |
| New section | — | "ADDENDUM 2026-05-14 (b) — DAKOTA / TCU / E-STOPP" |

## Sub-decisions still open (block 3 of the 13 new wires)

Marked in cut list as "TBD" in FROM column:

1. **#116 Dakota Tach Signal source** — three options:
   - M130 outputs tach pulse via spare half-bridge (cleanest, requires M1 GPR config)
   - Tap single coil primary at DEL-Stributor bracket (most common, simplest hardware)
   - Dakota CAN bridge module reads M130 CAN RPM message (requires Dakota's CAN module purchase)
2. **#118 Dakota VSS source** — three options:
   - M130 outputs VSS pulse to Dakota (M1 config + half-bridge)
   - Hardline from transfer case / transmission speedo output (factory-style)
   - Dakota CAN bridge
3. **#121 Dakota High Beam tap location** — identify which existing wire carries high-beam signal at the dash. Candidates: `#39 Headlight Switch` side or PDM-side LED Headlight feed (`#85`/`#86` side). Needs trace through PDM logic.

## What's NOT in the cut list but is BOM

- **Dash latching illuminated button** for E-Stopp trigger — Carling-style or similar
- **Holley 558-499 Transmission Control Kit** — confirm purchased; includes T43 module + 16-pin harness
- **Dakota CAN bridge module** — only needed if tach or VSS chosen via CAN architecture

## What's NOT yet verified

- Dakota VHX-73C-PU pin map (which Dakota cluster pin receives each new wire) — needs Dakota install guide
- Factory GM CTS / OP / fuel level sender part numbers — needs K5 service manual or Dakota install guide
- Holley T43 module physical mount location — needs builder decision (under-dash typical)
- Whether `#71 Dakota Digital Gauge Cluster` (PDM30:OUT29) provides both constant + switched, or if `#124` backup is needed
