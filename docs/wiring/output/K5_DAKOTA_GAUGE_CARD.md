# The Dakota Gauge Thing, Demystified

*One page. 1977 K5 Blazer, Dakota Digital VHX-73C-PU. Sources: Dakota manuals 650371E (VHX-73C-PU), 650314 (VHX main), 650701D (SGI-100BT), 650500G (BIM-01-2); `K5_cut_list_v4.txt`; receipts 2026-05-14 (addendum + tach/VSS decision); `calc-data/subsystems.json`.*

---

## a) The mental model — it's a TV with a cable box

- **The cluster in the dash is just a screen.** Nothing wires to it except two tiny Dakota-supplied turn-arrow pigtails.
- **The control box is the brain.** A 5.5" x 3.5" box you stick under the dash within 3 ft of the cluster. Every wire you build lands on its screw terminals. The terminals are *labeled in English* (TACH, SPD SND, OIL SND, FUEL SND, LEFT, RIGHT, HIGH, BRAKE...).
- **Dakota ships the cable between screen and brain.** It's an ordinary CAT5 (ethernet) patch cable, in the box. **You build zero wires between cluster and control box.**
- So "wiring the Dakota" = "running wires to one small box under the dash." That's the whole job.

## b) CAN mode — the skinny version (and one correction)

`subsystems.json` says cluster data can arrive over CAN "via the SGI-100BT bridge." **That's wrong on the part number** — the SGI-100BT manual (650701D) shows it has no CAN terminals; it's a pulse recalibrator (see glossary). Dakota's actual CAN reader is the **BIM-01-2**, which plugs into the control box's BIM jack *with Dakota's own plug-in cable* and listens to the MoTeC's OBD-II broadcast. Flagged for a substrate-correction receipt (also affects build-plan W069/W070).

Your harness wires in CAN mode (the brain still needs feeding):

| Wire | Cut-list ID | Lands on |
|---|---|---|
| Switched +12V | **#71** (PDM30 OUT29) | ACC. POWER |
| Constant +12V | **gap — not in cut list** (keeps clock + parks needles) | CONST. POWER |
| Ground | **#123** (dash star ground) | GROUND |
| CAN-H / CAN-L stub to the BIM | build-plan **W069/W070** pattern (tap #62 trunk) | BIM module |

**~5 wires** and the BIM hands the cluster speed, tach, and water temp. Fine print: fuel level **never** comes over CAN (tank wire #117 always exists), oil pressure over OBD-II is not guaranteed, the 4 indicator taps (#119–#122) are hardwired in every mode, and it needs the M1 GPR tuned to broadcast OBD-II plus a ~$100-150 BIM-01-2 purchase.

## c) What the 11 wires #114–#124 are — the analog fallback

This is the **dual-sender path**: the gauges get their own dedicated senders and signals, so they work even if the MoTeC is off, dead, or being tuned. The 11 break down as:

- **4 you'd skip in CAN mode:** #114 water temp, #115 oil pressure, #116 tach (M130:A31 half-bridge), #118 speedo (M130:A32 half-bridge)
- **7 you build either way:** #117 fuel, #119/#120 turn taps, #121 high-beam tap, #122 brake, #123 ground, #124 power backup

**Honest wire counts: CAN-only ≈ 10 wires + BIM purchase + tune-time config. Dual ≈ 13–16 wires** (the senders want companion conductors: temp is 2-wire, oil is 3-wire+shield — the cut list's single rows undercount; mockup item).

**The one decision for Dave: CAN-only vs dual.** CAN-only = fewer engine wires, but gauges are blind without the MoTeC alive, and it adds a module + firmware dependency. Dual = a few more wires and 2 senders on the engine — which are **already in the kit** (the "Universal Sender Pack": SEN-04-5 temp, SEN-03-8 oil) — and the temp/oil/fuel gauges run standalone. Note even "dual" tach/speedo come from the M130 (decided 2026-05-14), so true MoTeC-independence is only for temp/oil/fuel.

## d) What's currently specced, and what to do at the dash

**The receipts spec DUAL.** Accepted 2026-05-14, landed in cut list v4 (2026-06-09). All sub-decisions closed: tach = M130:A31, VSS = M130:A32, high-beam tap = #85b. The `subsystems.json` CAN-only note is the *alternative*, not the spec.

At the dash, in order:
1. Mount cluster in the stock bezel (Dakota tabs + stock screws), control box under dash, plug in the CAT5.
2. Power: #71 → ACC. POWER, #123 → GROUND. **Open item:** find a constant-12V source for CONST. POWER (OUT29 is switched; #124 duplicates switched — verify against Dakota diagram, receipt already flags it as possibly unnecessary).
3. Senders: #114 → WTR SND, #115 → OIL SND, #117 → FUEL SND, #116 → TACH, #118 → SPD SND. **Use Dakota's senders, not factory GM** — manual 650314 says other senders "cause incorrect readings or damage" (resolves the addendum's "PN UNKNOWN"; needs a substrate-correction receipt for #114/#115 notes).
4. Indicators: #119 → LEFT(+), #120 → RIGHT(+), #121 → HIGH(+). **Catch on #122:** the BRAKE(–) terminal wants a *ground* signal (parking-brake or pressure switch), but #122 taps the +12V brake-light circuit (#53). As drawn it won't light. Re-source it at mockup — flag for Dave.
5. Config from the front buttons or the phone app: fuel sender type = GM 0–90 ohm, tach cylinder/signal per M130 output, speedo cal. No laptop, no software purchase.

---

## GLOSSARY — the cortisol words

1. **BIM** — Dakota's plug-in accessory boxes ("Bus Interface Modules"); they snap into the control box's BIM jack with Dakota's cable and feed it extra data — you never build BIM wiring.
2. **SGI-100BT** — a Dakota signal-fixer box that takes a speed or tach pulse that's the wrong flavor and re-sizes it; with the M130 making clean pulses on A31/A32, you very likely don't need one.
3. **CAN-H / CAN-L** — the two wires of a CAN network, always run as a twisted pair; think of them as one data hose with two halves, not two separate circuits.
4. **Sender** — the screw-in probe on the engine or in the tank that turns temperature/pressure/fuel level into an electrical value a gauge can read.
5. **VSS** — vehicle speed sensor: anything that makes electrical pulses faster as the truck goes faster; the speedo counts the pulses.
6. **Half-bridge** — a MoTeC output pin (A31/A32 here) that can be told in software to make any pulse you want — we use two as tach and speedo signal generators.
7. **Pull-up** — a small reference voltage one device puts on a wire so another device can pull it down to make a signal; matters only because some outputs read as "dead" with a meter until a pull-up is present.
8. **OBD-II (PIDs)** — the standardized "engine data over CAN" dialect every scan tool speaks; the BIM-01-2 only understands this dialect, so the MoTeC would have to be configured to speak it.
9. **Control box** — the brain: all your wires land on its labeled screw terminals; it does the math and sends the result up the CAT5 to the screen.
10. **CAT5** — a normal ethernet patch cable; Dakota supplies it, any computer-store replacement under 7 ft works.
