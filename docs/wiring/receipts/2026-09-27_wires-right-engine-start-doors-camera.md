# Receipt — Every wire checked; engine-start set wired end to end; doors, tailgate window, rear camera

- **Date:** 2026-09-27
- **Change type:** registry design (local toolchain) → map rows; map UI (rule-check marks); decision rows
- **Asks (owner, 2026-09-27):**
  - "m130 position not at all priority. need to ensure all our wires are right … think about the 61 pin connector to
    the firewall think about how the fuel pump communicates … so much missing end points"
  - "you can choose the parts from the internet that best match what we need … get it done. i can tell u to replace
    later … i want you wiring in the factory switches and modules and figure out how they work in a can bus motec
    computer too … perfect union of vintage and modern"
  - "choosing the stuff from prowire has been a major succes … we need power windows its never been addressed. we
    have nothing in the doors. we also want like rear camera and other things like that"
- **Plan:** `~/.claude/plans/vivid-hugging-globe.md` ("make every wire right before any placement call").

## How "right" is measured

`docs/wiring/calc-data/check_plug_ends.py --wires` runs these rules on every wire and device, by code:

| Rule | Checks that |
|---|---|
| R8 | both ends are named, with pins |
| R9 | the pin fits the job (M130 pin table; PDM30/PDM15 20 A / 8 A ratings) |
| R10 | the circuit is complete for its signal type |
| R11 | every PDM load records what switches it |
| R12 | every firewall crossing goes through a 61-pin cavity or the grommet |
| R13 | nothing contradicts a locked decision |
| R14 | the wire record and the plug write-up agree |

The map shows each wire as RIGHT, WRONG or INCOMPLETE, with the reasons, and rolls the counts up per section. The
columns come from migration 20260927200000 (#354).

| Engine-start set (`configs/k5_engine_start_minimum.toml`) | Wires | Pass every rule | Failing |
|---|---|---|---|
| Before (morning) | 136 | 49 | 29 |
| After | 144 | 91 | 0 |

## Engine-start set: what was decided (sources in the registry rows)

- **Engine PDM = MoTeC PDM15** in the engine bay by the battery.
  - Why: owner 2026-09-24, "rule of thumb in motec is to run multiple pdm". The pinout is the MoTeC PDM user manual
    p.43; it shares the PDM30's pin positions.
  - Outputs:
    | Output | Load |
    |---|---|
    | OUT1 | fan (one fan) |
    | OUT2 | injector rail |
    | OUT3 | coil rail |
    | OUT4 | starter S terminal |
    | OUT10 | fuel pump |
    | OUT11 | A/C clutch |
    | OUT12 | LTCD |
    | OUT13 | PCS TCM |
  - Inputs: the A/C low- and high-pressure switches, which frees the M130 analog inputs (state 0e(a)).
- **The PDM30 stays the body PDM** in the cab.
  - The M130 is powered from PDM30 OUT24, on the same side of the firewall (chapters/17 §17.7.4: no wake pin).
  - The factory ignition switch now switches ground into PDM30 inputs: RUN on DIG1 and START on DIG10. PCS neutral is
    on DIG11.
  - The engine PDM takes RUN and START over CAN. That adds no firewall crossing, and a dead bus shuts the engine loads
    off (PDM manual p.23 timeout, p.39 CAN input).
- **CAN bus:** M130 B17/B18 → PDM30 B26/B25 → (61-pin, 2 cavities) → PDM15 → LTCD (DTM 4-pin #68054: 1 Batt−,
  2 CAN Lo, 3 CAN Hi, 4 Batt+).
  - It carries a 100R terminator at each end (PDM manual p.50).
  - The check passes hop by hop.
- **How the fuel pump communicates:** the M130 sends its fuel-pump request over CAN, and PDM15 OUT10 drives the 5.1 A
  Quantum P367. A message that times out switches the pump off.
  - #66 is re-pointed from the retired relay to the pump.
  - The ground goes to the frame near the tank.
  - The hanger connector is a bench read.
- **Wideband:** the LSU 4.9 sensors plug into the LTCD's own leads, so #106/#107 are retired. The LTCD's power, ground
  and CAN are wired.
- **Grounds:** M130 grounds go to the head (§17.4.6); PDM grounds go to battery negative (§17.4.7).
- **Isolator:** the isolator's shutdown wire goes to M130 B14 (UDIG7) through a 61-pin spare cavity.
- **Pins:** the throttle-body, oil-pressure and fuel-pressure pins are copied from their write-ups into the wire records.
- **Dakota:** fed per its manual (18 AWG; constant power from a fused tap at the PDM30 stud, so no crossing). The fuel
  sender goes to the Dakota (dual-sender lock). #98, #124, #65 and #118 are retired.
- **Speed:** from the NP205 mechanical speedometer drive through a Dakota Digital SEN-01-5 sender, which gives true road
  speed in 4-Lo. It feeds the Dakota and M130 B08.
- **Retired:** #22 (one fan), #57 (the 6L90 reverse comes from the PCS), #95/#96 (relays), #36/#37/#44/#47 (relay-era
  window and lock rows).

## Doors, tailgate window, camera, rear lamps (parts picked under delegation — replaceable)

- **Power windows:** Nu-Relics 17383-2 (1973–91 Blazer/Jimmy, bolt-in).
  - The chrome switches reverse the motors themselves, so no relay is needed.
  - PDM30 OUT3 feeds the driver master and OUT4 the passenger switch; the PDM output is the fuse.
- **Power locks:** 2 × AutoLoc AUTZT2000 2-wire actuators.
  - They sit on one bus reversed by both door rockers (rest-to-ground).
  - The feed is always on, on PDM30 OUT21, since the truck gets locked with the key off.
- **Door pass-throughs:** a Deutsch DT 12-way at each hinge pillar carries 8 of its 12 circuits.
- **Factory electric tailgate window:** the factory dash switch and the tailgate key switch both reverse the motor
  (they replace a relay). The feed is PDM30 OUT1, freed by the fan.
- **Rear camera:** Rear View Safety RVS-7180355-IR, a license-plate camera with a replacement mirror display.
  - The camera is powered by the reverse group (OUT15).
  - The mirror is powered by OUT23 (freed by the transmission controller) and triggered from reverse.
  - The RetroSound radio for the 73–87 C/K has no camera input, so the mirror carries the picture and the dash stays
    vintage.
- **Rear lamps:**
  - The right tail lamp now lands on the right lamp; it was wired to the left.
  - The stop/turn filaments get their own outputs (OUT16, OUT22).
  - The third brake light moves off the reverse group onto the brake (OUT5).
- **Brake switch:** the factory pedal switch now switches ground into PDM30 DIG14.

## Where it landed

- **Map rows:** loaded to the map (harness_endpoints, vehicle_custom_circuits, wire_termination_specs).
  - Changed rows are superseded, not overwritten, and the bench state carries over.
  - 233 live plugs/devices.
  - Check results are on 469 wires.
- **Decision rows:** `k5-second-pdm-decided`, `k5-speed-source-decided` (agent picks, T3, replaceable) and
  `k5-gauge-feed-decided` (owner lock, T1). Each supersedes its open call.
- **Map UI (this PR):**
  - Each wire shows RIGHT / WRONG / INCOMPLETE with plain-word reasons.
  - Section rollups show right/wrong/incomplete counts.
  - Decided calls read "LOCKED DECISION" (owner) or "DECIDED FOR YOU — REPLACEABLE" (agent pick).

## Open

- **Body firewall crossing:** the body harness's own firewall crossing is undecided. #50 (washer) crosses with no
  path, and the front lighting, horn, wiper and blower circuits will too. The 61-pin has 1 spare.
- **Parts still to pick:** the fuel-pressure sensor (Dave's pin convention is set), the battery isolator (must isolate
  everything and have an aux contact), the DT 12-way housings and contacts plus door boots (not in the saved ProWire
  catalog), and the fuel-hanger connector (bench).
- **Body and interior wires without far ends:** 38 active wires, mostly lighting, audio and interior.
- **PDM outputs with no recorded switch:** 34.
- **April concept rows:** the 243 aren't reconciled yet. The 34 of them that contradict locked decisions are already
  off the map.
- **Loader write path:** the map loader writes the design tables directly. Moving it onto a sanctioned write function
  is still to do.
