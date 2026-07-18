---
id: 2026-05-14_open-question-estopp-trigger
date: 2026-05-14
change_type: open_question
scope: docs/wiring/K5_WIRING_STATE.md §3, cut list (interior/dash)
status: PENDING DECISION
---

# Open question: E-Stopp ESK001 trigger signal source

## What's locked

Per `chapters/appendix-d-k5-build.md`: E-Stopp ESK001 electric parking brake actuator. Planned status.

`K5_cut_list_v2.txt`:
- `#54 Electric Parking Brake` = PDM30:OUT7 → 14 AWG ORN/BLK/YEL 18.4 ft — **power/ground actuator drive**

## What's missing

E-Stopp ESK001 needs **THREE** electrical connections, not one:
1. **+12V power** (have it — wire #54)
2. **Ground** (presumably implicit via case ground or PDM channel ground return — need to verify)
3. **Trigger signal** from a dash switch — to tell the actuator to engage or release the parking brake

The trigger source is not in the cut list. Without it, the parking brake actuator has no way to know when to operate.

## Per E-Stopp ESK001 product literature

The ESK001 has multiple trigger options:
- **Direct switch:** push-button on dash → actuator (latching internal)
- **Remote actuation:** signal from an external source (e.g., security system, ECU, key-off trigger)
- **Auto-engage on key-off:** wires to ignition switch + reverses on key-on
- **Manual lever override** (mechanical)

The K5 is a custom build — Skylar's intent matters.

## Three possible architectures

### Option A — Dash switch (latching)

- A dedicated dash button (Carling-style, illuminated, latching) physically wired to the E-Stopp signal pin
- Builder mounts the button anywhere in the dash
- Switch wire goes from dash → ECU digital input (so ECU can log/display state) → E-Stopp
- OR switch wire goes from dash → directly to E-Stopp signal input
- **Required:** 1 new wire from dash button to E-Stopp (~6-10 ft)

### Option B — Auto-engage at key-off

- E-Stopp wired to switched-12V at ignition
- When ignition turns off, parking brake engages automatically
- Release: typically requires brake pedal press + ignition on simulator OR a manual override
- **Required:** 0 new wires (uses existing ignition signal)

### Option C — PDM30 controlled

- A dedicated PDM30 OUT channel switches the E-Stopp signal based on logic conditions
- Inputs: dash button, gear (park/not park), speed (0 mph), brake pedal, ignition state
- Outputs E-Stopp signal when conditions are met
- **Required:** 1 dash button input wire to PDM30 (~3 ft from dash) + 1 new PDM30 OUT signal wire to E-Stopp (~10 ft)

### Option D — Stand-alone (no electronics)

- E-Stopp wired entirely independently of the ECU/PDM
- Just a +12V feed and a manual override lever
- **Required:** verify the actuator works in pure +12V latching mode (likely needs the signal pin tied to +12V or ground depending on logic)

## Recommendation

**Option A or C** if the K5 will see road use — gives builder control + logging.
**Option B** is the cheapest and simplest if Skylar wants set-and-forget.

## What Skylar needs to provide

- **How should the parking brake engage?** Auto on key-off, dash button, or PDM-controlled with logic?
- **If dash button:** what kind (latching toggle, momentary, illuminated indicator showing engaged state)?
- **Any concern about auto-engaging while moving** (Option B has this risk if ignition cycles)?

## Cut list addendum once decided

- Option A: 1 new wire (e.g., `#125 E-Stopp Trigger` 22 AWG from dash button → E-Stopp signal pin, ~10 ft)
- Option B: 0 new wires
- Option C: 2 new wires (dash button input + PDM OUT signal)

## Status

PENDING — added to `K5_WIRING_STATE.md §3` as item #6.
