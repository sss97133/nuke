# K5 Blazer — 10-minute review sheet for Dave

**Truck:** 1977 K5 Blazer · LS3 6.2 · MoTeC M130 + PDM30 · battery passenger firewall corner
**What I'm asking:** red-pen this page. Order + 5 questions. That's it.

---

## The order I'm about to place (~$2,100, wire + tools + distribution)

| What | Spec | Why now |
|---|---|---|
| Signal wire, full harness | M22759/32 Tefzel — 22 AWG ×925 ft (8 solid colors, printed labels instead of stripes), 20 AWG ×75, 16 AWG ×175, 18 AWG ×~90 | Spec locked, no open decision touches it |
| Engine shielded | M27500 — crank/cam 3-core ×25 ft, knock pair ×25 ft, CAN pair ×25 ft | Same |
| Loom + seal | Raychem DR-25 (3/16"–1/2") + SCL, small sizes only | Big sizes wait for the primary-cable decision |
| Distribution | Blue Sea: 2× MaxiBus 250A busbar (pos + neg star), 2× MEGA holder, 125A MEGA (PDM30 feed — 100A continuous max), 2× MIDI holder + 40A (brake booster, fuel pump) | Architecture: battery → isolator → stud → branches |
| Stripper | Ideal 45-1987 Stripmaster, 16–26 AWG Tefzel die | |

**Held back on purpose:** primary battery cables + lugs + hydraulic crimper (until starter cable gauge is settled + runs measured on the truck), alternator (until I confirm what's on the CVF drive), the D38999 bulkhead (until the formboard proves the pin count), all device-end connectors, both computers.

## The 5 questions

**1. Crank/cam sensor supply.** GM Gen IV 58× crank + cam on the front cover. I have them fed from the M130's 5V sensor rails (A02/A09). Your Bronco feeds REF/SYNC+ from B19 (6.3V). Which do the GM 3-pin sensors want on an M130?

**2. Throttle + pedal.** Drive-by-wire: throttle motor on OUT_HB1/HB2 (A18/A01), pedal tracks split across the two 5V rails (AV7 + rail A / AV8 + rail B). Sane?

**3. Trans (the big one).** 6L80E — the T43 is inside the trans, and Holley's 558-499 paperwork says it needs a Terminator X Max as CAN master. M130 obviously isn't one. Have you run a 6L80E behind a MoTeC — TXM riding along trans-only, an external TCU (PCS-style), or something better?

**4. Master disconnect.** I need a battery isolator that kills PDM + starter + alternator with an aux contact into an ECU shutdown input (MoTeC requirement). What do you put in?

**5. Do you have / can you get:** a MoTeC UTC (#61059, USB-to-CAN — need it to program the PDM30)? A hydraulic hex lug crimper I could borrow before I buy one?

---
*Pinouts: I cross-checked all 41 used M130 pins against the MoTeC techspec and your Bronco sheet — zero conflicts, 20 pins device-for-device identical to yours. These 5 are what's left.*
