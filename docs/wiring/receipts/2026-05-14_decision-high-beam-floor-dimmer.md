---
id: 2026-05-14_decision-high-beam-floor-dimmer
date: 2026-05-14
change_type: substrate_amendment
scope: docs/wiring/output/K5_cut_list_v2.txt + K5_WIRING_STATE.md
status: APPLIED (agent decision per Skylar "use the scientific method ... figure out on your own")
amends: 2026-05-14_addendum-dakota-dual-sender-wires (resolves #121 high-beam tap location)
---

# High-beam circuit — factory floor dimmer pattern (agent decision)

## Why this is a decision, not a question

Earlier investigation (this session) surfaced that **no high-beam circuit exists anywhere in the substrate**. Cut list, PDM channel plan, connector schedule all show single-feed-per-headlight (low beam only). Skylar's directive: "use the correct scientific method ... figure out on your own."

## Constraints applied

| Constraint | Source |
|---|---|
| Truck-Lite 27270C is dual-input (low + high are separate +12V pins) | Truck-Lite product catalog (cite-able; standard sealed-LED architecture) |
| PDM30 at 30/30 capacity — no spare output channel | `chapters/appendix-d-k5-build.md` "Computed Configuration" |
| Factory 73-87 K5 includes a floor-mounted dimmer switch | GM service manual standard (square-body chassis is the foundation) |
| Existing wires #85 / #86 feed headlights from PDM30:OUT17/OUT18 | `K5_cut_list_v2.txt`; `K5_pdm30_channel_plan.md` |
| LED headlights need over-current protection on the supply side; toggle (not PWM) on the low/high select | Truck-Lite 27270C accepts on/off-style +12V at each pin |

## Decision: factory floor dimmer topology

PDM30:OUT17/OUT18 → floor dimmer common → exclusive switch between low and high beam → headlight LOW pin or HIGH pin.

**Rationale (lowest-invasive option):**
- Retains existing factory floor dimmer in the truck (no new dash switch position, no PDM channel needed)
- PDM still provides over-current protection on the +12V supply to the dimmer common (so the headlight circuit is protected up to the dimmer)
- Floor dimmer is single-pole-double-throw (SPDT): mechanically guarantees low and high can't both be on
- Industry-standard pattern for square-body LS swaps with LED headlights
- Dakota high-beam indicator (#121) taps the dimmer high-output wire — natural, no extra logic

**Trade-off:** the high-beam side of the dimmer is not individually protected (it inherits OUT17/OUT18 ampacity). For 27270C at ~3.6A per side, the 8A PDM channel rating handles it fine.

## Wires modified or added

### Modified (TO field updated, route changes)

| ID | Was | Now |
|---|---|---|
| `#85 LED Headlight Left` | PDM30:OUT17 → LED Headlight Left | PDM30:OUT17 → **Floor Dimmer common terminal** |
| `#86 LED Headlight Right` | PDM30:OUT18 → LED Headlight Right | PDM30:OUT18 → **Floor Dimmer common terminal** (or its own dimmer if separate switches per side — standard is one dimmer for both, fed by both PDM outputs paralleled at the dimmer common) |

### Added (4 new wires)

| ID | Label | From | Spec | Color | Length |
|---|---|---|---|---|---|
| `#85a` | LED Headlight Left LOW beam | Floor dimmer low-out | 16 AWG M22759/32 | LT GRN | 4.0 ft |
| `#85b` | LED Headlight Left HIGH beam | Floor dimmer high-out | 16 AWG M22759/32 | LT GRN/BLK | 4.0 ft |
| `#86a` | LED Headlight Right LOW beam | Floor dimmer low-out (paralleled with #85a) | 16 AWG M22759/32 | LT GRN/WHT | 4.0 ft |
| `#86b` | LED Headlight Right HIGH beam | Floor dimmer high-out (paralleled with #85b) | 16 AWG M22759/32 | LT GRN/WHT/BLK | 4.0 ft |

### Updated: #121 Dakota High Beam tap

- Was: TBD (open sub-decision)
- Now: **tap on #85b at the dimmer high-out terminal** — single point captures high-beam state for indicator

## BOM additions

- **Floor dimmer switch** — factory GM PN (likely 1992-93 K5 floor-mount, ~$15 from rock-auto class supplier) OR aftermarket panel-mount SPDT toggle (~$10). Selection deferred to builder. Specify mating connector when chosen.
- **Truck-Lite 27270C connector pigtail** if not included with headlight — typically a 4-pin Deutsch DT-style on these. Not currently in `K5_connector_shopping_list.txt`. Flag for next BOM pass.

## Open / verify

- Does Skylar want **one floor dimmer for both headlights** (factory pattern, both PDM outputs join at dimmer common) OR **separate dimmers per side** (allows asymmetric / DRL / adaptive logic per appendix-d "Independent left/right for future DRL or adaptive logic" — chapter 5 already flags this)? Default chosen here: single dimmer (factory). If separate, the wire count doubles to 8.
- Does the 27270C connector pigtail need to be added to `K5_connector_shopping_list.txt`? Probably yes — currently not enumerated.
- Floor dimmer mating connector (factory uses a specific 3-position connector). Need PN.

## Total impact

- Cut list before: 158 wires (after the three decisions earlier today)
- Cut list after: **162 wires** (+4)
- Sub-decision #121 (Dakota high-beam tap): RESOLVED
