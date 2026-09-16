---
id: 2026-05-14_open-question-6l80e-tcu-architecture
date: 2026-05-14
change_type: open_question
scope: docs/wiring/K5_WIRING_STATE.md §3, cut list (engine + chassis)
status: PENDING DECISION
---

# Open question: 6L80E TCU communication architecture

## Why this is unresolved

The K5 build uses a GM 6L80E automatic transmission (per cut list inferences and shopping list). The TCU (transmission control unit) needs to:
- Receive engine state from M130 (throttle position, RPM, MAP, coolant temp, brake input)
- Output shift commands to the 6L80E solenoids
- Receive transmission state back (gear, output speed)
- Possibly drive a tach signal and gear indicator

**Current cut list state:**
- `#58 Transmission Controller` = PDM30:OUT23 → 20 AWG ORN/YEL — **POWER feed only, 3 A**
- `#56 Neutral Safety Switch` = PDM30 → 14 AWG ORN/RED 11.5 ft
- `#57 Reverse Light Switch` = PDM30 → 18 AWG ORN/BLU 11.5 ft

That's it. **No CAN bus to the TCU. No solenoid drives. No throttle position bridge. No tach output. No gear indicator wire.**

## Per the shopping list (`K5_connector_shopping_list.txt:53-58`)

> "1× 19303772 Kostal LKS 1.5 16-pin harness connector | 6L80E T43 TCM (component side: 15131300) | $45 GM dealer | Alt: Holley 558-499 kit includes this connector"
>
> **NOTE: If using Holley 558-499 Transmission Control Kit, the T43 connector and wiring are included. Check before ordering separately.**

So the shopping list assumes architecture **(a)** below (Holley 558-499 T43 module). But this hasn't been verbally locked.

## Three viable architectures

### Option A — Holley 558-499 T43 standalone TCU (most common LS swap path)

- Holley sells a T43 controller box + harness kit specifically for 4L60E/6L80E/6L90E swaps
- The kit includes the 16-pin Kostal connector to TCM + all required wiring
- Communication: CAN-A from M130 (throttle, RPM, brake) → T43 controller → 6L80E
- Plus hardlines: brake switch, neutral safety, reverse light to T43
- **Required cut list additions:** CAN extension from M130 CAN_HI/CAN_LO (B17/B18) → T43 location → 6L80E (~2 wires + 6-10 ft routing through firewall)
- **Pros:** turnkey, common, well-supported. Programming via Holley HP Tuners or BSL.
- **Cons:** ~$1500 for the kit + tuning software. Adds a separate box.

### Option B — MoTeC M130 with GPR-T1 firmware (direct TCU control)

- M130 directly drives the 6L80E solenoids via the OUT_HB outputs (half-bridges A01, A18, A31-A34)
- Requires GPR-T1 firmware (not GPR base)
- Half-bridges drive: TCC, line pressure, shift solenoids A/B/C/D, etc.
- **Required cut list additions:** 7-8 solenoid drive wires from M130 Connector A half-bridges → 16-pin Kostal connector → 6L80E. Each is 14-16 AWG (2-3 A typical solenoid current). ~6 ft each through firewall + along trans tunnel.
- **Pros:** Single ECU. No extra box. Tighter integration. MoTeC's logging captures trans state natively.
- **Cons:** Uses up all 6 half-bridges (currently the cut list shows OUT_HB1/HB2 for ETB only — OUT_HB3-HB6 would now drive solenoids, leaving zero spare). Requires GPR-T1 firmware upgrade (cost + reflashing). M130 limits half-bridge total current — large solenoids may not be drivable directly.

### Option C — Holley HP Tuners / Dominator TCU with CAN to M130

- A standalone Holley Terminator or similar TCU box that handles 6L80E solenoid drives internally
- Receives engine state from M130 via CAN
- Outputs tach + speedo signals back on CAN
- **Required cut list additions:** CAN extension from M130 → TCU (~2 wires); power feed to TCU box (already #58)
- **Pros:** Less invasive than 558-499, more flexible for future trans changes
- **Cons:** Less common, requires manual integration of Holley CAN messages with M130 — substantial calibration work

## Recommendation hierarchy

1. **If Desert Performance has already specified the kit** (likely — they typically pick option A for swap builds): commit to A. Add the CAN extension wires + verify Holley 558-499 in BOM.
2. **If undecided**: A is the lowest-risk path. Mature kit, predictable behavior, decent documentation.
3. **B is only sensible** if you want maximum integration AND have GPR-T1 firmware budget — typically reserved for race / high-performance builds.

## What Skylar needs to provide

- **Which TCU architecture?** A / B / C
- **Is Holley 558-499 already in the parts plan, or are we still picking?**
- **Has the 6L80E been bench-tested or driven previously?** (matters for which trans calibration to start from)

## Cut list addendum (will be specified once architecture is picked)

Approximate per option:
- A → 2 new wires (CAN-H/CAN-L extension from M130 B17/B18 → T43 mount location) + verify shopping list line 53-58
- B → 7-8 new wires (M130 half-bridge solenoid drives → 16-pin Kostal) + GPR-T1 firmware purchase
- C → 2 new wires (CAN extension) + add Holley TCU box to BOM

## Status

PENDING — added to `K5_WIRING_STATE.md §3 Open Architectural Questions` as item #5.
