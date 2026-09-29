# K5 firewall allocation: what goes through the 61-pin, and how the rest gets across

Owner, 2026-09-29 (verbatim): "we have more than 61 wires that are currently proposed to go through the firewall.. so you
need to prioritize which need to go in the 61 pin and then we can suggest other solutions, what if we find we can run a
smaller 34 pin in the back of the vehicle. i dont know. this is up to the engineer to ruminate on."

This is the pieces lane's proposal. Dave and Skylar confirm it before the registry is rewired; only the brake warning switch
end is added in this pass.

## 1. The count

- **The 61-pin** is D38999/26WJ61PN with insert 25-61 (61 size-20 contacts).
  - `check_plug_ends.py --wires` reports 58 used and 3 spare (d, t, u).
  - Shell 25 is the series' largest. No shell-25 insert has more than 25-61's 61 size-20 contacts: 25-4 is 48 × #20 plus
    8 × #16, and 25-43 is 23 × #20 plus 20 × #16 (MILNEC D38999 Series III catalog p.B-19, Insert Arrangement Selection,
    reference_documents/component_drawings/MILNEC_D38999_series_III_catalog.pdf).
  - A size-20 contact takes 20–24 AWG, so 16 AWG circuits can't use it in any shell.
- **The 58 wires in it** (registry endpoint FIREWALL-ENGINE):

  | Group | Wires | Ids |
  |---|---|---|
  | Engine management (M130 to the engine) | 50 | 8 injectors, 8 coils, ETB motor and TPS with 5 V and ground, crank/cam/knock with grounds, shields and supplies, MAP/IAT/CLT/oil/fuel-pressure sensors with references and grounds |
  | Dakota gauge senders | 5 | 114, 115, DAK_CTS_RET, DAK_OILP_5V, DAK_OILP_GND |
  | CAN | 2 | CAN_FW_H, CAN_FW_L |
  | Fan PWM command | 1 | FAN_PWM |

- **Thirteen wires have no crossing.** They're the circuits that used the dropped body bulkheads, listed in harness-cad's v4
  run (receipts/2026-09-30_harness-cad-whole-truck.md on branch wiring/harness-cad):
  - headlight feeds from the floor dimmer: 85a, 85b, 86a, 86b;
  - wiper switch to motor: WIPER_T1, WIPER_T3;
  - blower switch to the resistor taps: BLOWER_BAT, BLOWER_MED, BLOWER_M2;
  - isolator remote switch: ISO_CLOSE, ISO_OPEN, ISO_LED, ISO_SW_PWR.

## 2. What the 61-pin is for, in priority order

1. **Engine management: 50 wires, stays.** The M130 lives in the cab. These are its injector and coil drives and its
   sensor inputs, and none of them can travel as a CAN message.
2. **CAN: 2 wires, stays.** Everything below crosses on it.
3. **The isolator's remote switch: 3 wires, moves in, taking the 3 spares.** The isolator is what powers the PDMs: "The
   isolator must isolate the battery from all devices in the vehicle including the PDM" (MoTeC PDM manual p.4). So the switch
   that closes it can't depend on a PDM, and its circuit has to be copper.
   - ISO_SW_PWR runs from its 5 A fuse at the battery (FUSE-ISO_SW_PWR) up to the dash switch. ISO_CLOSE and ISO_OPEN
     come back down to the Blue Sea 7700.
   - All three are 20 AWG. A size-20 contact carries 7.5 A with 20 AWG (MILNEC catalog p.B-9), above the 5 A fuse.
4. **The Dakota senders (5) and FAN_PWM (1) stay for now, but are the first to move out if room is needed.**
   - Dakota's BIM-EFI-1 has a native MoTeC mode and would read coolant temperature and oil pressure from the M130 over CAN
     (DAKOTA_VHX_ARCHITECTURE.md §3b). That frees 5, but the dual-sender setup is locked (K5_WIRING_STATE.md §1,
     2026-05-14), so moving it is the owner's call.
   - The fan's PWM command can come from the engine-bay PDM beside the fan. That frees 1.

The result is 58 + 3 = 61 of 61, with the isolator's state lead (ISO_LED) reaching the dash over CAN. If the M130's shutdown
input has to be hardwired (ISO_KILL taps that lead today, per PDM manual p.4's "secondary switch that is connected to a
shutdown input on the ECU"), it's a fourth wire, and FAN_PWM moves to the bay PDM to make room.

## 3. The rest: switched in the engine bay, commanded over CAN

This is the pattern the owner locked when he said the PDM replaces relays. The switch stays in the cab as a PDM30 input, the
command crosses on CAN, and the engine-bay PDM drives the load next to it. No copper crosses.

| Circuit | Cab side (PDM30 inputs) | Engine-bay PDM outputs | Wires removed from the firewall |
|---|---|---|---|
| Headlights | floor dimmer: low/high as one or two inputs | 4: left and right, low and high (one lamp per output, so a fault takes out one lamp) | 85a, 85b, 86a, 86b |
| Blower | control-head positions | 3 resistor taps, or one PWM output with the resistor deleted | BLOWER_BAT, BLOWER_MED, BLOWER_M2 |
| Wipers | wiper switch positions | low and high, with the motor's park switch read by the bay PDM | WIPER_T1, WIPER_T3 |

For Dave:
- the wiper park logic;
- resistor taps against PWM for the blower;
- whether a multi-position switch shares one PDM input through a resistor ladder (PDM inputs read 0–51 V in 0.2 V steps,
  PDM manual p.1).

## 4. The power-module question, in plain words

- **What it is.** The engine-bay power box. The registry has it as a MoTeC PDM15, which has 15 outputs.
- **Why it comes up.** The loads in §3 need about 10 more outputs in the engine bay. MoTeC seals only the PDM16 and PDM32
  ("Rubber seal on lid and connectors", PDM manual p.35), and the engine bay is where a box has to be sealed.
- **Recommendation.** Make the engine-bay box a PDM32 in place of the PDM15, not a third box.
  - It has 32 outputs (8 × 20 A, 24 × 8 A) and 23 inputs, and it takes a 4 AWG feed (PDM manual p.42). harness-cad already
    draws it that way.
  - Moving the front loads there also frees cab PDM30 outputs. Those are what the power windows, locks, top lamps and
    Starlink candidates are waiting on.
  - If a PDM15 is already bought, swapping it is a money decision for the owner.

## 5. The rear connector ("a smaller 34 pin in the back")

- The firewall doesn't need it. The rear loads run from the cab PDM30 under the floor and never cross the firewall.
- It's worth having as a service break for the rear body and tailgate (fuel pump, tail lamps, amplifier, rear camera), so
  that harness can come out in one piece. The removable top already has its own 26-way (option TOP-DISC).
- When that's the question, size it from the rear wire count and gauges against the MILNEC insert table. No insert is picked
  here.

## 6. Added in this pass: the brake warning switch

- **Owner, 2026-09-29:** "proportioning valve has a sensor on it a one wire situtation where if it disconnects it triggers the
  brake light on we can wire that and code that ... its mounted on a cross member under the radiator where all the brake lines go".
- **Source:** 1977 LTSM PDF p.406, "Testing Electrical Circuit of Combination Valve": disconnect the wire from the switch
  terminal, jumper it to a good ground, turn the ignition on, and the warning lamp lights. So the switch is one wire and
  grounds through the valve body.
- **New end BRAKE-WARN-SW, with wire BWS_SIG to PDM15 DIG2 (A19).**
  - The valve is in the engine bay, so it doesn't cross the firewall.
  - It goes over CAN so the dash shows its own brake-circuit message, separate from the brake-fluid level (candidate BFL).
- **Open:**
  - which valve is on the truck and its part number (the 2024 build log lists a proportioning valve bought);
  - the switch plug and terminal;
  - its exact spot on the crossmember.
