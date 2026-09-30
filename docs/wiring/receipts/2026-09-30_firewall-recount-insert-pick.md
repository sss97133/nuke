# Receipt: firewall recount with candidate demand, the insert pick, and a correction on the isolator lines

- date: 2026-09-30
- change_type: research (the recount and the pick) + substrate_correction (the isolator lines in §2)
- amends: 2026-09-30_firewall-allocation-and-brake-warn-switch
- scope: docs/wiring/research/2026-09-30_firewall-allocation.md (§2 item 3, §2's result, two §2a bullets, new §7)
- owner direction: 2026-09-29, "prioritize which need to go in the 61 pin ... this is up to the engineer to ruminate on";
  and "dave is an avatar concept. we are building this system".

## What changed

1. **Correction.** §2 item 3 moved the isolator's dash-switch lines into the 61-pin's 3 spares "at 20 AWG". The registry
   carries them at 16 AWG, and Blue Sea's 7700 instructions say "Use minimum 16 AWG wire for the Control Circuit"
   (990180170 Rev.006 p.2). A #20 contact takes 20–24 AWG and a #22D 22–28 AWG (MILNEC catalog, Contact Specifications),
   so they fit neither. The paragraph now says so, and §2a's isolator bullet with it.
2. **Correction.** §2a said "fill the 61" keeps "the parts already bought". The #20 contacts and tool are in the carts, not
   bought (state row 0j). Fixed.
3. **§7, new.** The recount with candidate demand, and the pick:
   - Demand: 58 today; +4 isolator signal wires (§7.2); +2 wheel speed and +2 fuel temperature if those options are built
     (registry options, demand.pin61_cavities). IBST-CAN and ISO_KILL need none.
   - The isolator crosses as 4 × 22 AWG signal wires: the 7700's 16 AWG control circuit stays in the engine bay on two relays
     that the dash switch drives.
   - **Pick: insert 25-61 stays** (D38999/24WJ61SN and /26WJ61PN). FAN_PWM moves to the bay PDM now (61 of 61). The Dakota
     senders move to CAN when a wheel-speed or fuel-temperature option is built (60 of 61), which is the owner's call on his
     dual-sender lock. 25-35 is the fallback past 61.
   - Why: on the #20 the ETB pair passes the canon's 85 % check at 6.4 A against the M1's 4 A RMS rating, and the
     M22759/16-22 jacket sits inside the seal range. On the #22D the ETB pair passes by 0.25 A only at 22 AWG, and the jacket's
     maximum equals the seal's maximum.

## Sources

- Registry on main at c5840f1e0: FIREWALL-ENGINE wires and gauges, ISO_* gauges and sources, options demand, IBST-DIAG side.
- MILNEC D38999 Series III catalog: Contact Specifications (wire range, sealing range), Current Rating ("test ratings only"),
  Insert Arrangement Selection (25-4, 25-35, 25-43, 25-46, 25-61).
- MoTeC M1 hardware techspec p.11 (half bridge: "RMS current 4 Amps"); MoTeC PDM user manual p.4 (the isolator isolates
  the PDM).
- Blue Sea 7700 ML-RBS instructions 990180170 Rev.006 p.2 (16 AWG minimum; 2145 pin 1 open, pin 3 close, pin 7 LED;
  2 A minimum on the switch feed).
- Canon ch.17 §17.1 item 3 (protection at most 85 % of capacity) and §17.5 items 2–3 (parallel conductors: same gauge,
  length and termination); state rows §1 (22 AWG on /16), 0j (carts), 0p (/16-22 OD).

## Unknowns

- The relay part: sealed, 12 V coil, contacts above 2 A. needs: a pick by the parts lane.
- The fuse on the new 22 AWG switch feed. needs: sized to the 22 AWG wire under canon ch.17 §17.1.
- Whether Blue Sea's 16 AWG minimum covers the yellow LED lead. needs: Blue Sea's answer; until then the lead can stay 16 AWG
  on the engine side with the tee there.

## Not changed

The registry. Rewiring ISO_*, adding the four signal wires and the two relays, moving FAN_PWM to the bay PDM, and retiring
the body bulkheads go in the registry pass after placement.
