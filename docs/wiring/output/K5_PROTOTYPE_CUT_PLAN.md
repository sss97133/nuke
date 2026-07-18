# K5 Prototype Cut Plan — One-Color Max-Length Loom

**Generated:** 2026-06-09 (v2 — re-derived in the digital twin after the from-primitives model was rejected) · landmarks from `K5_landmarks_blender_derived.yaml` run through `scripts/compute_wire_lengths.py`
**Model:** `~/k5-harness-pull/K5_harness_workspace_v2.blend` — TurboSquid 1978 Blazer (scale verified: wheelbase 2,703 mm vs FR-88 2,705 mm) + atom-built LS3/MoTeC engine-bay insert. Body-side runs (dash, doors, rear, lights, dome) are anchored to REAL geometry.
**Data:** `K5_computed_lengths.csv` (113 wires, 0 blocked, 913.8 ft) — that CSV is the cut sheet; this doc is the method and the gaps.
**Method (Dave's, accepted 2026-05-12):** ① calculate max distance → ② prototype with ONE-COLOR wire at max length → ③ verify on vehicle → ④ cut to size. This plan is steps ①–②. **Nothing here is a final cut length.**

---

## 1. What changed vs the old zone estimates

The compute run includes service loop (12"), shielded bypass (+6"), door flex (+6"), and bend allowance (×1.05 / ×1.10 heavy) on top of polyline path lengths. Versus the cut-list estimates:

**Wires the old estimates would have scrapped** (cut short — the expensive failure):

| # | Wire | Old est | Computed max | Why |
|---|------|---------|--------------|-----|
| 79 | License Plate Lamp | 3.5 ft | 17.7 ft | est had it dash-local; it's full rear loom |
| 91 | Side Marker Left Rear | 3.5 ft | 17.7 ft | same mislabel |
| 67 | Dome Light | 3.5 ft | 14.5 ft | A-pillar + headliner cavity (real roof) |
| 90 | Side Marker Left Front | 3.5 ft | 13.3 ft | rocker run, not dash |
| 49 | Wiper Motor | 4.6 ft | 15.2 ft | PDM → cowl crossing |
| 87/88 | Cab Clearance L/R | 4.6 ft | 15.2 ft | up A-pillar to roofline |
| 103 | Knock Sensor B1 | 4.6 ft | 8.2 ft | routed around engine rear, shielded |
| 21/22 | Radiator Fans | 4.6 ft | 7.5–8.2 ft | PDM → core support |
| 52 | iBooster | 4.6 ft | 7.4 ft | power feed path |
| 6/63 | Starter / Battery Disconnect | 4.6 ft | 7.4 ft | 4 AWG along frame |

Rear-loom wires (tails, markers, speakers, amp) computed 17.5–18 ft vs 18.4 ft estimated — the old rear estimates were honest. The damage was concentrated in mis-sectioned short estimates.

**Coil wires (#5–24): computed ≈ 4.5 ft vs cut list 2.5 ft.** The 2.5 ft assumed valve-cover-local routing; the real path M130 → FWG(H3) → valley adds the firewall leg. Prototype at 4.5 ft.

## 2. Per-gauge prototype footage (what to pull from Dave's spools)

113 mapped wires, computed totals + the v3 companion addendum (22 wires, follow their parent wire's path ≈ 4–5 ft each) + 3 power rails:

| Gauge | Spec | Mapped ft | + Companions/rails | Prototype ft (×1.15 handling) |
|-------|------|-----------|--------------------|-------------------------------|
| 4 AWG | M22759/16 | 14.8 | — | **17** |
| 8 AWG | M22759/16 | 25.3 | — | **29** |
| 10 AWG | M22759/16 | 23.8 | — | **28** |
| 12 AWG | M22759/32 | 34.6 | — | **40** |
| 14 AWG | M22759/32 | 108.1 | — | **124** |
| 16 AWG | M22759/32 | 20.0 | +11 (INJ_PWR, COIL_PWR, COIL_GND rails) | **36** |
| 18 AWG | M22759/32 | 416.3 | — | **479** |
| 20 AWG | M22759/32 | 133.3 | — | **153** |
| 22 AWG | M22759/32 | 137.7 | +99 (22 companion wires) | **272** |
| 22 AWG shielded 2C | M27500-class | ~12 (4 cables: CKP/CMP/KS1/KS2, incl bypass) | — | **25** |
| 22 AWG twisted pair | M27500-class | 2.5 (#62 CAN) + #125 TCU ext (path unmapped) | — | **15** |

One color per gauge is fine for the prototype loom — circuit identity carries on printed heat-shrink labels (locked 2026-05-11, color reassignment allowed at mockup).

## 3. Wires with NO landmark path yet (cannot prototype until assigned)

These were accepted by receipt 2026-05-14 but have no entry in `K5_wire_paths.yaml` — and **#114–#126 + #85a/b/#86a/b never landed in `K5_cut_list_v3.txt` at all** (substrate inconsistency, surfaced in today's receipt, not fixed inline):

- **#114–#124 Dakota VHX dual-sender (11 wires)** — dash-local + sender taps; needs paths (mostly L18-class + engine-bay sender legs)
- **#125 Holley T43 TCU CAN extension** — PDM area → TCU under dash; short, needs path
- **#126 E-Stopp dash trigger** — dash button → rear actuator; ~L24+L25-class run
- **#85a/#85b/#86a/#86b high-beam floor dimmer legs** — PDM → dimmer → headlights; needs L19-class + front-light legs
- **#INJ_PWR / #COIL_PWR / #COIL_GND rails** — proposed paths: PDM→FWG→valley→rail/bracket (L16+L02+L07 / L16+L02+L03); block star ground for COIL_GND

Assigning these paths is a 30-minute follow-up in `K5_wire_paths.yaml`; then rerun the compute script and they join the CSV.

## 4. Provenance warning (read before trusting any number)

Landmark values are **derived from the 3D model, not tape-measured**. The model bakes in 8 position assumptions (A1–A8 in `K5_landmarks_blender_derived.yaml`) — M130, PDM30, FWG-MAIN grommet, battery, engine setback, floor grommet are all asserted-not-measured (§4 of `K5_WIRING_STATE.md`). The 12" service loop + bend allowance absorbs ±2" of position error; it does NOT absorb a relocated PDM or a moved grommet. **Step ③ (verify on vehicle) is not optional.**

## 5. Build order on the formboard

1. Pull prototype footage per §2 from Dave's stock (`K5_wire_neighbor_inventory_request.md` has the ask list); buy gaps per `K5_MATERIALS_FORMBOARD.md`.
2. Lay the trunk routes on the board per the Blender model views (`output/blender/*.png`) — engine loom, dash loom, rear loom, door looms, power runs.
3. Cut prototype wires at computed max (CSV column `computed_feet`), label both ends with circuit ID.
4. Carry the loom to the truck. Tape-measure every landmark L01–L30 along the real path. Write the real values into `K5_landmarks.yaml` (the measured file — keep it separate from the derived file).
5. Rerun `compute_wire_lengths.py` with the measured file. The delta report is the final-cut authorization. Connectors get specified AFTER this (locked deferral).
