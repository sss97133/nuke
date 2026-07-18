# K5 Blazer — Master Measurement Plan

**Vehicle:** 1977 Chevrolet K5 Blazer · VIN CCL187Z210370
**Purpose:** Single source of truth for the wire-length data needed to cut a real harness.
**Strategy:** Measure ~30 physical **landmark distances** on the truck once. Compute every wire length by summing landmarks. Replaces per-wire estimation with per-landmark measurement.
**Status:** Empty — no field data yet.

---

## How To Use This Doc

1. Resolve the **DESIGN FREEZE** items below before measuring anything. Without them, you'll measure twice.
2. Walk the truck with a tape measure. Fill in the **LANDMARK DISTANCES** table.
3. Run `scripts/compute_wire_lengths.py` (to be written) — it joins landmarks → wire lengths in DB.
4. Re-export cut list, BOM, EE audit. Sign off. Send to builder.

This doc replaces `K5_measurement_worksheet.md` (per-wire, doesn't scale, was wrong abstraction).

---

## 1. DESIGN FREEZE — Must Be Locked Before Measuring

These must be answered. If any change later, all measurements re-run.

| # | Decision | Status | Lock |
|---|---|---|---|
| F1 | **ECU choice** — M130 vs M150 | **M130 LOCKED** — Skylar owns the M130, $3,500 sunk; BOM, connector_schedule, shopping list all built for it. M150 references in DB are exploration runs from 2026-04-25, not committed. Re-uplift to M150 later is additive (more wires from M130 connector) and doesn't waste this measurement pass. | ✓ |
| F2 | **PDM30 channel assignments** | **`K5_pdm30_channel_plan.md` IS THE TRUTH.** Newer (2026-04-05 vs 2026-03-23), self-declared authoritative, electrically correct (groups switch-shared lights). `connector_schedule.txt` and DB get reconciled TO it in Session 5. | ✓ |
| F3 | **M130 mount on firewall** | Default: driver side, 4–6" right of brake pedal, just below dash lip — close to existing factory iBooster mount so harness exits both connectors converge | ☐ confirm at truck |
| F4 | **PDM30 mount under dash** | Default: driver side, immediately above kick panel, easy reach to fuse access | ☐ confirm at truck |
| F5 | **Battery + master disconnect** | Defaults: battery passenger inner fender (factory tray); master disconnect on driver kick panel inside cab (within reach from seat) | ☐ confirm at truck |
| F6 | **Bulkhead disconnect** (D38999-J61) | Default: engine-bay side of firewall, between M130 and FWG-MAIN — short pigtail to M130, full harness through grommet | ☐ confirm at truck |
| F7 | **Star ground** | Default: bolted to firewall sheet metal, within 12" of M130 connector | ☐ confirm at truck |
| F8 | **iBooster mount** | Factory location (H3) | ✓ |

**Take the mount cheat sheet (next section) to the truck, write coordinates in pen, photograph each, you're done with Session 1 in 15 minutes.**

### Mount cheat sheet — fill at truck (15 min)

For each, mark the actual spot with a Sharpie or piece of tape on the truck, photograph, write description here:

```
F3  M130 connector mount: ____________________________________________
    [photo filename: _________________]

F4  PDM30 mount: _____________________________________________________
    [photo filename: _________________]

F5  Battery: ________________________________________________________
    Master disconnect: ______________________________________________
    [photos: _________________________]

F6  Bulkhead disconnect (D38999): ____________________________________
    [photo filename: _________________]

F7  Star ground bolt location: ______________________________________
    [photo filename: _________________]
```

---

## 2. MOUNT-POINT COORDINATES (fill at truck)

Every wire originates or terminates at one of these. Coordinates are reference-tag descriptions — no need for absolute XYZ, just unambiguous identifiers a builder can find.

| Tag | Component | Location Description | Confirmed? |
|---|---|---|---|
| `M130` | M130 ECU connector face | Firewall, driver side, _____" right of brake pedal, _____" below dash lip | ☐ |
| `PDM30` | PDM30 connector face | Under dash, driver side, _____" right of steering column | ☐ |
| `BAT+` | Battery positive post | Engine bay, passenger inner fender | ☐ |
| `BAT-` | Battery negative post / star ground | _________________ | ☐ |
| `STAR` | Sensor / signal star ground | _________________ | ☐ |
| `MDS` | Master disconnect switch | _________________ | ☐ |
| `BULK` | Bulkhead disconnect (D38999) | _________________ | ☐ |
| `FWG-MAIN` | Firewall main grommet | Driver side, _____" up from floor, _____" right of brake | ☐ |
| `FWG-AC` | Firewall A/C lines pass-through | _________________ | ☐ |
| `FLOOR-TR` | Floor pan grommet, transmission tunnel | _________________ | ☐ |
| `FLOOR-RR` | Floor pan grommet, rear (for fuel/rear loom) | _________________ | ☐ |
| `iBOOST` | iBooster power stud | Firewall, driver, factory location (H3) | ✓ |
| `ALT` | Alternator output stud | Front of engine, driver side | ✓ |
| `STARTER` | Starter solenoid stud | Bellhousing, driver | ✓ |

---

## 3. LANDMARK DISTANCES — THE FIELD CHECKLIST (fill at truck)

**Each measurement = tape-routed distance along the actual planned path.** Not straight-line. Through clips, around obstacles, over the engine, through grommets. Add **+6"** to every measurement for routing slack at landmark transitions (the tape catches on stuff; allow for it).

Service loops (12" total per wire — 6" each end) are added in the computation step, NOT here.

### 3.1 Engine bay landmarks (15 measurements)

| ID | From | To | Path notes | Distance (in) |
|---|---|---|---|---|
| L01 | M130 | FWG-MAIN | Direct, exterior firewall | _____ |
| L02 | FWG-MAIN | Top center of intake manifold (intake valley junction point) | Through grommet, over valve cover | _____ |
| L03 | Intake valley junction | Cyl 1 coil (driver front) | Along DVC | _____ |
| L04 | Cyl 1 coil | Cyl 3 coil | **Single cyl-to-cyl pitch driver bank** (script applies 1×/2×/3× for cyl 3/5/7) | _____ |
| L05 | Intake valley junction | Cyl 2 coil (passenger front) | Across intake | _____ |
| L06 | Cyl 2 coil | Cyl 4 coil | **Single cyl-to-cyl pitch passenger bank** (script applies 1×/2×/3× for cyl 4/6/8) | _____ |
| L07 | Coil → matching injector (any single cyl) | Same cylinder, coil at top → injector at side of fuel rail | _____ |
| L08 | Intake valley junction | Throttle body connector | Along intake top | _____ |
| L09 | Intake valley junction | MAP sensor port | _____ |
| L10 | M130 (B-conn) | CKP at bellhousing rear | Through FWG, down driver block, **shielded — away from coils** | _____ |
| L11 | M130 (B-conn) | CMP at front timing cover | Along DVC | _____ |
| L12 | M130 (B-conn) | KS1 driver block (below exhaust) | **shielded — away from headers** | _____ |
| L13 | M130 (B-conn) | KS2 passenger block (below exhaust) | **shielded — away from headers** | _____ |
| L14 | BAT+ | ALT stud | Along inner fender | _____ |
| L15 | BAT+ | STARTER stud | Along inner fender, down to bellhousing | _____ |

### 3.2 Cab / dash landmarks (8 measurements)

| ID | From | To | Path notes | Distance (in) |
|---|---|---|---|---|
| L16 | PDM30 | FWG-MAIN (interior side) | Under dash, exit firewall | _____ |
| L17 | PDM30 | Steering column ignition switch / column switch cluster | Up the column | _____ |
| L18 | PDM30 | Headlight switch in dash panel | Across under-dash | _____ |
| L19 | PDM30 | Brake pedal switch | Down to pedal | _____ |
| L20 | PDM30 | Driver door boot (through hinge area) | _____ |
| L21 | Driver door boot | Door lock actuator / window motor / speaker | Inside door | _____ |
| L22 | PDM30 | Passenger door boot (across cab) | Across kick panel | _____ |
| L23 | PDM30 | Dome light at headliner center | Up A-pillar, across | _____ |

### 3.3 Frame / chassis landmarks (5 measurements)

| ID | From | To | Path notes | Distance (in) |
|---|---|---|---|---|
| L24 | PDM30 | Floor grommet `FLOOR-RR` (under driver seat or rocker entry) | Through floor | _____ |
| L25 | FLOOR-RR | Rear axle area (junction point for rear loom split) | Along driver frame rail, **measure following actual clip line** | _____ |
| L26 | Rear junction | Tailgate light cluster center | _____ |
| L27 | Rear junction | Fuel tank sender / pump | _____ |
| L28 | PDM30 | Transfer case / NSS / reverse switch on 6L80E | Through tunnel grommet | _____ |

### 3.4 Engine bay → underbody (2 measurements)

| ID | From | To | Path notes | Distance (in) |
|---|---|---|---|---|
| L29 | M130 (engine bay side) | O2 bung driver exhaust | Down driver, **away from exhaust heat** | _____ |
| L30 | M130 (engine bay side) | O2 bung passenger exhaust | Across, down, **away from exhaust heat** | _____ |

**Total measurements to take: 30.** At ~5 min each = ~2.5 hours of pure measurement time.

---

## 4. WIRE LENGTH COMPUTATION RULES

For each wire in DB, length = `sum(landmarks along its path) + service_loop + bend_allowance + gauge_adjustment`.

| Term | Value | Rationale |
|---|---|---|
| `service_loop` | +12" | 6" at each end for strain relief, future re-termination |
| `bend_allowance` | +5% on flexible wire (≤14 AWG), +10% on heavy gauge (≥10 AWG) | Heavy wire can't make tight bends |
| `shielded_bypass` | +6" for any shielded sensor wire that detours around heat/EMI | CKP, CMP, KS1/2 |
| `door_flex` | +6" for wires crossing door boot | Door opens/closes 100K times |

### Example computations (worked from landmarks)

| Wire | Path (landmarks) | Computation | Final length (ft) |
|---|---|---|---|
| Coil cyl 1 (#24) | L01 + L02 + L03 + 12" + 5% | (L01+L02+L03+12) × 1.05 | TBD |
| Coil cyl 8 (#12) | L01 + L02 + L05 + L06 + 12" + 5% | (L01+L02+L05+L06+12) × 1.05 | TBD |
| Injector cyl 5 (#17) | L01 + L02 + L05 + (¾ × L06) + L07 + 12" + 5% | …pitch fraction by cyl position | TBD |
| CKP (#99) | L01 + L02 + L10 + 12" + shielded_bypass(6) + 5% | (L01+L02+L10+18) × 1.05 | TBD |
| Driver door speaker (#26) | L16 + L20 + L21 + 12" + door_flex(6) + 5% | (L16+L20+L21+18) × 1.05 | TBD |
| Fuel pump (#66) | L16 + L24 + L25 + L27 + 12" + 10% (heavy gauge) | (sum + 12) × 1.10 | TBD |

These get committed to DB once landmarks are filled. `scripts/compute_wire_lengths.py` will own this logic.

---

## 5. THE PLAN — Four Sessions To Done

### Session 1 — Decision Freeze (1 hour, at desk)
Skylar + this Claude session. Lock F1–F7 in section 1. Specifically:
- Pick **M130 or M150** based on (a) what you own, (b) channel/pin headroom you actually need
- Either accept `K5_pdm30_channel_plan.md` as the truth and update DB + connector_schedule, OR pick a different reconciliation
- Print 8.5x11 of the truck firewall photo, **circle exact mount points** for M130, PDM30, bulkhead disconnect, master disconnect, star ground

**Output:** Updated section 1 of this doc + a marked-up firewall photo at the bench.

### Session 2 — Landmark Walk (3 hours, in shop)
Bring the equipment list (section 6). Walk the truck.

Order of operations:
1. **Mount the M130, PDM30, and bulkhead disconnect** (or at least bolt-up dummies / cardboard cutouts at the right holes). You can't measure to a connector that isn't located.
2. Drill / mark the firewall grommet locations.
3. Walk landmarks L01–L15 (engine bay) — engine should be in. Use string for routes longer than the tape.
4. Walk landmarks L16–L23 (cab/dash) — dash should be out, or at least kick panels off.
5. Walk landmarks L24–L28 (frame) — body-on works, but expect to lay on creeper.
6. Walk L29, L30 (O2 sensors) — confirm exhaust is in or use planned routing.

**Recording rules:**
- Photograph **every** landmark measurement: tape extended along the route, reading visible. Saves you from re-walking when the number looks wrong on Tuesday.
- Write each number in pen on this printed doc, no phone-only notes that get lost.
- Anything that won't measure cleanly (component not present yet) → mark `TBD-[reason]` and move on. List those as Session 2.5 reshoots.

**Output:** This doc fully filled, plus a folder of ~30 reference photos.

### Session 3 — Compute & Validate (1.5 hours, at desk)
1. Type landmarks into a spreadsheet or directly into DB via `scripts/compute_wire_lengths.py`.
2. Compute all 113+ wire lengths.
3. **Variance check vs current estimates** in `K5_cut_list.txt`:
   - If a wire is within ±15% of estimate → accept
   - ±15–30% → flag, eyeball-check the landmark math
   - >30% → re-measure that landmark in Session 4
4. Total harness footage → update BOM (`K5_bom.txt`) wire purchase quantities.

### Session 4 — String-Route the Heavy Gauges (1 hour, in shop)
Five wires deserve physical string-routing because their bend radius eats length:
- `#6` Starter (4 AWG)
- `#32` Amp power (8 AWG)
- `#52` iBooster (10 AWG)
- `#63` Battery disconnect (4 AWG)
- `#66` Fuel pump (10 AWG)

Lay paracord along each route. Tape at every clip point with masking tape. Cut, lay flat on floor, measure with steel tape. Override the computed value if string says different.

**Output:** Final length values, locked in DB. Cut list re-exported. Sign off.

### Session 5 — Reconciliation Pass (handled by Claude, no shop time)
- Re-run EE audit (`scripts/audit_k5_wiring.py`) — verify no NEW failures from gauge resize for the 6 known FAILs
- Reconcile `K5_wire_labels_v2.csv` (566 rows) against the cut list — explain the delta, prune or expand
- Regenerate `wire_schedule_fiverr.csv` so it matches the locked design
- Generate a single sign-off PDF for the builder

---

## 6. EQUIPMENT LIST (bring to Session 2 + 4)

| Item | Purpose | Have? |
|---|---|---|
| 25' steel tape | Most measurements | ☐ |
| 100' fiberglass tape | Long frame runs (L25, L26) | ☐ |
| 50' paracord (2-3 mm) | String-routing heavy gauge | ☐ |
| Roll of 1" masking tape | Mark routing points for string | ☐ |
| Black Sharpie | Mark on tape, on body (washes off) | ☐ |
| Phone with camera | Photograph every landmark | ✓ |
| **Printed copy of this doc** | Write measurements in pen | ☐ |
| Marked-up firewall photo | Confirm mount points | ☐ (Session 1 output) |
| Mechanic's creeper | Frame rail measurements | ☐ |
| LED work light / headlamp | Under-dash visibility | ☐ |
| Cardboard mockup of M130 connector | Stand in if real ECU not installed | ☐ |

---

## 7. SIGN-OFF GATE

Before sending to builder (Desert Performance or equivalent):

- [ ] All 30 landmark distances filled in section 3
- [ ] All Section 1 design freezes locked
- [ ] Mount-point coordinates filled in section 2
- [ ] `scripts/compute_wire_lengths.py` run; DB updated; cut list regenerated
- [ ] EE audit re-run, **0 FAILs** remaining
- [ ] PDM30 channel assignments reconciled across `K5_pdm30_channel_plan.md`, `K5_connector_schedule.txt`, and DB
- [ ] Pin-level coverage on PARTIAL devices ≥ 80% (currently 43%)
- [ ] Wire labels file reconciled to cut list (currently 566 vs 113)
- [ ] String-routed heavy gauges measured directly
- [ ] Sign-off PDF generated

---

## Open Questions To Surface At Session 1

- Is there a target builder yet? Desert Performance for first build, or Fiverr for a rough harness Skylar finishes?
- Is the truck currently in a state to be measured (engine in, exhaust in, dash position)? If not, Session 2 may need to wait or be split.
- Is Dave (the pin-map expert referenced in `K5_gap_report.md`) available to fill PARTIAL pin data in parallel with measurement?
- Acceptable budget for the harness build? That informs M130 vs M150 (M150 needs more wire + bigger connector kit).
