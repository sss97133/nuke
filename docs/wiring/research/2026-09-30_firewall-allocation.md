# K5 firewall allocation: what goes through the 61-pin, and how the rest gets across

Owner, 2026-09-29 (verbatim): "we have more than 61 wires that are currently proposed to go through the firewall.. so you
need to prioritize which need to go in the 61 pin and then we can suggest other solutions, what if we find we can run a
smaller 34 pin in the back of the vehicle. i dont know. this is up to the engineer to ruminate on."

This is the pieces lane's proposal. Dave and Skylar confirm it before the registry is rewired; only the brake warning switch
end is added in this pass.

## 1. The count

- **The 61-pin** is D38999/26WJ61PN with insert 25-61 (61 size-20 contacts).
  - `check_plug_ends.py --wires` reports 58 used and 3 spare (d, t, u).
  - Shell 25 is the series' largest. No shell-25 insert has more *size-20* contacts than 25-61's 61: 25-4 is 48 × #20 plus
    8 × #16, and 25-43 is 23 × #20 plus 20 × #16 (MILNEC D38999 Series III catalog p.B-19, Insert Arrangement Selection,
    reference_documents/component_drawings/MILNEC_D38999_series_III_catalog.pdf).
  - **But a denser insert fits the same shell: 25-35 has 128 × #22D contacts** (same catalog, the Insert Arrangement
    Selection table, service rating M). See §2a: it's the main alternative to filling the 61 exactly.
  - A size-20 contact takes 20–24 AWG, and a size-22D takes 22–28 AWG, so 16 AWG circuits can't use either (catalog,
    Contact Specifications).
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

This section fills the 61-pin as it is. §2a gives the alternative with more room.

1. **Engine management: 50 wires, stays.** The M130 lives in the cab. These are its injector and coil drives and its
   sensor inputs, and none of them can travel as a CAN message.
2. **CAN: 2 wires, stays.** Everything below crosses on it.
3. **The isolator's remote switch: its control circuit can't use a 61-pin contact (corrected 2026-09-30, see §7).** The
   isolator is what powers the PDMs: "The isolator must isolate the battery from all devices in the vehicle including the
   PDM" (MoTeC PDM manual p.4). So the switch that closes it can't depend on a PDM, and its circuit has to be copper.
   - Blue Sea's 7700 instructions say "Use minimum 16 AWG wire for the Control Circuit" (990180170 Rev.006 p.2), and the
     registry carries ISO_SW_PWR, ISO_CLOSE, ISO_OPEN and ISO_LED at 16 AWG. A #20 contact takes 20–24 AWG and a #22D
     22–28 AWG (MILNEC catalog, Contact Specifications), so none of the four fits either insert.
   - This section first said "all three are 20 AWG" and moved them into the 3 spares. That was wrong. §7 keeps the 7700's
     control circuit in the engine bay on two relays and brings 4 signal wires across instead.
4. **The Dakota senders (5) and FAN_PWM (1) stay for now, but are the first to move out if room is needed.**
   - Dakota's BIM-EFI-1 has a native MoTeC mode and would read coolant temperature and oil pressure from the M130 over CAN
     (DAKOTA_VHX_ARCHITECTURE.md §3b). That frees 5, but the dual-sender setup is locked (K5_WIRING_STATE.md §1,
     2026-05-14), so moving it is the owner's call.
   - The fan's PWM command can come from the engine-bay PDM beside the fan. That frees 1.

The result (corrected in §7): 58 + 4 isolator signal wires = 62, so FAN_PWM moves to the bay PDM and the 61-pin is 61 of 61.

## 2a. The alternative: the same shell with a 25-35 insert (128 × #22D)

It uses the same plate, the same hole and the same shell-25 coupling. Only the insert and the contacts change: receptacle
D38999/24WJ35SN and plug D38999/26WJ35PN in place of /24WJ61SN and /26WJ61PN.

- **Why it's worth it.** 55 of the 58 wires in the 61-pin are 22 AWG (registry FIREWALL-ENGINE). The only 20 AWG ones are
  the ETB motor pair (4a, 4b) and FAN_PWM. A #22D contact takes 22–28 AWG and carries 5 A at 22 AWG. A #20 takes 20–24 AWG
  and carries 7.5 A at 20 AWG ("test ratings only"). Both are from the catalog's Contact Specifications and Current Rating
  tables. With 25-35, every 22 AWG wire moves across and about 70 of the 128 cavities stay spare, where "fill the 61" leaves 0.
- **What fits and what doesn't:**
  - The 55 × 22 AWG, and FAN_PWM as a 22 AWG control lead (Dave's call).
  - Not the isolator's control circuit: Blue Sea asks for 16 AWG minimum (see §2 item 3 and §7).
  - **The ETB motor pair doesn't fit as it's wired.** It's 20 AWG, and a 22D contact is rated 5 A at 22 AWG. The motor's
    current isn't in the registry. It needs one of these, Dave's call:
    - two 22D contacts in parallel per leg;
    - 22 AWG, if the M130's ETB current is under the rating;
    - a small separate path.
  - The headlights, wipers and blower are power wires (16 AWG). The engine-bay PDM route in §3 still applies to them either way.
- **The seal margin.** The #22D seals a jacket of 0.76–1.37 mm (0.030–0.054 in); the #20 seals 1.02–2.11 mm.
  - M22759/16-22 is 1.27–1.37 mm (K5_WIRING_STATE.md row 0p), right at the 22D maximum.
  - This build moved 22 AWG from /32 to /16 on 2026-09-26 (canon ch.16 §1.5). With 22D contacts that choice gets looked at
    again against the 22D range, with the wire's published OD. That's the canon owner's and Dave's call.
- **Contacts and tools.** The 22D pin is TXPP22 and the socket TXSS22, crimped with MILNEC's TP209 (pin) and TP207 (socket)
  positioners. That's new tooling next to the #20 set's TP104 turret (catalog, contacts and tooling table). The rest of the
  kit (backshell, boot, plate) stays.
- **Recommendation.** Put both in front of Dave:
  - **25-35 buys room** for later candidates (wheel speed, fuel temperature, the isolator lines, and more) at the cost of
    22D tooling and the ETB-pair question.
  - **"Fill the 61"** keeps the #20 contacts and tools already in the carts (not bought) and leaves no room.
  - Nothing is bought or rewired either way.

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

## 7. The recount, and the insert pick (pieces lane, 2026-09-30)

The call is the system's to make (owner, 2026-09-29: "dave is an avatar concept. we are building this system"). Counts are
from the registry on main at c5840f1e0; ratings from the MILNEC D38999 Series III catalog (Contact Specifications, Current
Rating, Insert Arrangement Selection), reference_documents/component_drawings/MILNEC_D38999_series_III_catalog.pdf.

### 7.1 Demand

| What wants a cavity | Cavities | Source |
|---|---|---|
| In the 61-pin now | 58: 55 × 22 AWG, 3 × 20 AWG (ETB motor 4a and 4b, FAN_PWM) | registry FIREWALL-ENGINE |
| The isolator, as §7.2 wires it | +4 × 22 AWG | §7.2 |
| Wheel speed: WSS-F2 or WSS-4E | +2 | registry options, demand.pin61_cavities |
| Fuel temperature: FT or FT-FLEX | +2 | same |
| iBooster CAN logging (IBST-CAN) | 0: its port IBST-DIAG is in the engine bay | registry IBST-DIAG |
| M130 shutdown input (ISO_KILL) | 0: both ends are in the cab | registry ISO_KILL |

### 7.2 The isolator crosses as signals, on two relays

The 7700's control circuit stays in the engine bay at 16 AWG, as Blue Sea asks (990180170 Rev.006 p.2): the fused 24-hour
feed, brown to close, orange to open, black to ground, all short runs beside the 7700. Two sealed relays next to it switch that
feed onto brown or onto orange. The 2145 dash switch then drives only the two relay coils, so what crosses is signal wiring:

| New wire (22 AWG, M22759/16) | From | To |
|---|---|---|
| ISO switch feed | small fuse at the battery | 2145 pins 2 and 8 |
| ISO close command | 2145 pin 3 | close relay coil |
| ISO open command | 2145 pin 1 | open relay coil |
| ISO state | 7700 yellow (LED output) | 2145 pin 7, teed in the cab to M130 UDIG7 (ISO_KILL) |

- No PDM is in the path, as MoTeC requires (PDM manual p.4). The relays are a narrow exception to "the PDM replaces relays":
  that lock is about switching loads, and this is the switch that powers the PDMs.
- **Open, for the parts pick:** the relay (sealed, 12 V coil, contacts above the 2 A minimum Blue Sea puts on the switch
  feed, p.2); the fuse on the new 22 AWG feed; and whether Blue Sea's 16 AWG minimum covers the yellow LED lead, which carries
  only LED current (ask Blue Sea, or keep it 16 AWG and move the tee to the engine side).
- The other way is to mount the 2145 in the engine bay. Then only ISO state crosses (1 cavity), but the dash loses the switch.

### 7.3 Fill, by case

| Case | Insert 25-61 (61 × #20) | Insert 25-35 (128 × #22D) |
|---|---|---|
| Today, with §7.2 | 62: FAN_PWM moves to the bay PDM (§2 item 4), 61 of 61 | 62 of 128 (with the ETB pair as in §7.4) |
| Plus one wheel-speed and one fuel-temperature option | 65: the Dakota senders move to CAN (§2 item 4, −5), 60 of 61 | 66 of 128 |

### 7.4 Margins

- **ETB motor pair.** The M1 half bridge is rated "RMS current 4 Amps" (M1 hardware techspec p.11). The canon's check is
  that the protection is at most 85 % of the conductor's capacity (ch.17 §17.1 item 3); taking the M1's 4 A as that limit:
  - #20 at 20 AWG: 0.85 × 7.5 A = 6.4 A. Passes, as the build wires it today.
  - #22D at 22 AWG: 0.85 × 5 A = 4.25 A. Passes by 0.25 A, and only if the pair drops from 20 to 22 AWG. Two #22D per leg,
    same gauge, length and termination (ch.17 §17.5 items 2–3), give the margin back for 2 more cavities and a splice at
    each end.
- **Seal.** M22759/16-22 is 1.27–1.37 mm (state row 0p). The #20 seals 1.02–2.11 mm, so it has room either side. The #22D
  seals 0.76–1.37 mm, so the wire's maximum is the seal's maximum. M22759/32-22 (1.09 mm) would centre in the #22D but is
  under the 1.20 mm GT150 seal at the sensor ends (state §1), so /16-22 stays.
- **Tools and contacts.** The #20 contacts and the M81969/14-10 tool are in the carts (state row 0j, not bought). The #22D
  needs its own contacts and positioners.

### 7.5 The pick

**25-61 stays: D38999/24WJ61SN (cab) and D38999/26WJ61PN (engine).**

1. It holds today's 58 and the isolator's 4 signals once FAN_PWM moves to the bay PDM: 61 of 61.
2. It holds one wheel-speed and one fuel-temperature option once the Dakota senders move to CAN: 60 of 61. That move
   unlocks the owner's dual-sender lock (state §1, 2026-05-14), so it's his call, and it only comes up when one of those
   options is decided.
3. Every margin in §7.4 is comfortable on the #20, and two of them are at the edge on the #22D.
4. 25-35 is the fallback if demand passes 61 after those moves. The shell, the plate, the fuse-box hole, the backshell and
   the boot are the same, so switching costs only the insert and the contacts, and only before purchase.

No other shell-25 insert does better. 25-4 has 48 × #20 and 8 × #16; its #16 cavities would take 16 AWG, but 48 is short of
the 55 wires at 22 AWG. 25-43 (43) and 25-46 (46) are smaller still (catalog, Insert Arrangement Selection).
