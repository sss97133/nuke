# Chapter 18 — Construction & Segmentation Canon

This chapter is the order-of-operations and physical-construction canon for the K5 harness. It governs HOW the harness is built once the wires are derived (Ch. 6) and the manifest is closed (Ch. 5). Every line is one atom with a citation. Where the substrate has no value, the line is marked `(UNKNOWN — needs external ingestion: …)` rather than guessed — that is the whole point of this canon.

**Two recurring boundaries run through everything below:**
- **DESIGN vs HANDS.** Some steps are knowable from documents and the digital twin (agent-ownable). Some require the builder's hands, eyes, and the truck (deferred). The boundary is marked at each step and consolidated in §8. An agent never asserts a HANDS step COMPLETE.
- **CITED vs UNKNOWN.** Numbers that exist in our substrate carry a file:line. Numbers that do not (twist lay length, DR-25 recovered diameters, on-vehicle lengths) are explicit unknowns with a close path — never recalled from training data.

---

## 1. The pro design-first order of operations

The professional sequence is **design-down then build-up**: fully resolve the harness on paper / in the twin, then build it once. The K5 follows this; the steps below are the canonical order. Steps marked **[DESIGN]** are agent-ownable; **[HANDS]** must be done by the builder on the bench or truck.

| # | Step | Owner | Substrate / citation |
|---|------|-------|----------------------|
| 1 | **Goal config** — state what the harness must do (e.g. "crank + run the LS3 + show gauges") | [DESIGN] | engine-start minimum config (`K5_WIRING_STATE.md:45`; `configs/k5_engine_start_minimum.toml`) |
| 2 | **Load list** — enumerate every device + endpoint for that goal | [DESIGN] | build manifest, 115 devices / 347 endpoints (`chapters/05-build-manifest.md:13`) |
| 3 | **Current** — per-load draw; sum per branch | [DESIGN] | per-device amps in manifest (`chapters/05-build-manifest.md:80`); spine loads (`research/2026-06-10_power_spine_builders_study.md:234`) |
| 4 | **Power partition** — ECU-driven vs PDM-channel vs direct-wired | [DESIGN] | signal-type classification (`chapters/05-build-manifest.md:16`); direct-wired list (`chapters/05-build-manifest.md:92`) |
| 5 | **OCP + gauge** — fuse each branch to protect the *wire*; size gauge from amperage + length | [DESIGN] | OCP rules (`research/2026-06-10_power_spine_builders_study.md:67`); gauge derivation (`chapters/06-compute-engine.md`, per closure protocol `.claude/rules/wiring-wire-closure-protocol.md`) |
| 6 | **Twist-layer PLAN** — which wires twist together, core selection, layer order, break-out radius (see §2) | [DESIGN, planning only] | this chapter §2; lay-length value is UNKNOWN (§2) |
| 7 | **Segmentation** — split into sub-harnesses at the bulkhead and trunk boundaries (see §3) | [DESIGN] | engine↔body boundary still OPEN (`K5_WIRING_STATE.md:67`); D38999 firewall LOCKED (`K5_WIRING_STATE.md:43`) |
| 8 | **Connector planning** — count cavities per connector; defer device-end PNs (see §6) | [DESIGN, deferred] | connector-deferral lock (`K5_WIRING_STATE.md:52`); D38999 exception (`K5_WIRING_STATE.md:43`) |
| 9 | **Pin / cavity map** — assign each wire to a pin/cavity | [DESIGN] | cut list pins + appendix-g pin maps (`.claude/rules/wiring-wire-closure-protocol.md`); D38999 cavity map (`output/connector-sheets/K5_connector_FIREWALL_D38999.svg`, `K5_WIRING_STATE.md:43`) |
| 10 | **Max-length derive** — compute each wire at its maximum routed length (Dave's step ①, see §4) | [DESIGN] | `output/K5_PROTOTYPE_CUT_PLAN.md:6`; `scripts/compute_wire_lengths.py` → `K5_computed_lengths.csv` |
| 11 | **Formboard** — lay the 1:1 build jig (see §5) | [HANDS] | `output/K5_MATERIALS_FORMBOARD.md:27`; `output/K5_PROTOTYPE_CUT_PLAN.md:70` |
| 12 | **Construct** — pull one-color wire at max, lay on board, twist, bundle, label | [HANDS] | Dave's steps ②, `output/K5_PROTOTYPE_CUT_PLAN.md:6`; label-as-identity (`output/K5_MATERIALS_FORMBOARD.md:40`) |
| 13 | **Terminate** — crimp contacts/lugs, build the heat-shrink stack (see §7) | [HANDS] | `research/2026-05-21_milspec_heatshrink_protocols.md:54`; `research/2026-06-10_power_spine_builders_study.md:213` |
| 14 | **Test** — continuity, pull-test crimps, on-vehicle fit; only then final-cut | [HANDS] | Dave's steps ③④ (`K5_WIRING_STATE.md:51`); pull-test values (`research/2026-05-21_milspec_heatshrink_protocols.md:157`) |

**Canonical rule:** the entire left column above (steps 1–10) is resolved BEFORE any wire is cut. The build (11–14) is executed once, against a closed design. (source: `K5_WIRING_STATE.md:51` — Dave's method; `output/K5_PROTOTYPE_CUT_PLAN.md:6`)

---

## 2. Concentric-twist DESIGN

Concentric twist is the ultra/professional construction geometry: wires are laid in cylindrical **layers** around a central core, each layer twisted helically, so the finished bundle is round and tightly packed. It is the construction method that distinguishes the top tier from a parallel zip-tied bundle. (source: `chapters/03-tier-system.md:46`)

### 2.1 The corrected twist rule — SAME direction, SAME pitch

**All layers of a concentric-twist bundle are laid in the SAME rotational direction at the SAME lay length (pitch). Layers do NOT alternate twist direction.** Same direction + same pitch is what lets each successive layer nest cleanly into the helical valleys of the layer beneath it and close to a round cross-section; alternating direction would fight the underlying layer and bulge the bundle. (UNKNOWN — replacement rule pending external ingestion: HP Academy concentric-twist module or a MIL/SAE wire-construction standard; the alternating-direction claim at 03-tier-system.md:46 is superseded)

> **SUPERSEDES:** `chapters/03-tier-system.md:46` (was: "Concentric twist — wires twisted in alternating-direction layers around a core wire"). The "alternating-direction" claim is wrong. Correct: same direction, same pitch, every layer. The corrections log (`chapters/appendix-b-corrections.md`) should pick this up.

### 2.2 Layer construction

| Element | Rule | Citation |
|---|---|---|
| **Core** | The bundle is built around a central core (a wire or a filler) that all layers wrap; it sets the bundle centerline | (source: `chapters/03-tier-system.md:46` — "around a core wire") |
| **Layer counts** | Successive concentric layers wrap the core; the count-per-layer grows outward as circumference grows. Specific per-layer wire counts for the K5 bundles | (UNKNOWN — needs external ingestion: a cabling lay-up table, e.g. the concentric-stranding count series in a wire/cable construction standard such as ASTM B8 / MIL-STD lay-up tables; not in our 91-doc library per `library_search.py "concentric twist harness"` → no matches) |
| **Lay length (pitch)** | One pitch = the axial distance for one full 360° wrap. Same value for every layer. The K5's chosen lay length | (UNKNOWN — needs external ingestion: builder/standard lay-length spec, typically expressed as a multiple of bundle OD; not in substrate per `library_search.py "lay length cabling"` → no matches) |
| **Direction** | Same for every layer (§2.1) | (rule, §2.1) |

### 2.3 Break-outs

A break-out is where one or more wires exit the bundle to reach a device. **A wire breaks out at the radial layer it occupies** — an outer-layer wire peels off the surface; an inner-layer wire must surface through the lay before exiting. Plan device endpoints so the highest-fan-out devices ride the outer layers and break out with the least disruption to the core. (derived from concentric geometry — engineering reasoning, not a cited standard)

### 2.4 The math closes to a round bundle

The design intent of concentric twist is a round finished cross-section: with same-direction same-pitch layers nesting into the layer below, the bundle OD is predictable and the DR-25 outer jacket recovers cleanly onto a circle rather than printing flats. (the "prints flats" failure mode is derived from concentric geometry — engineering reasoning, not a cited standard) The bundle OD then sets the DR-25 supplied/recovered size (Ch. heat-shrink; §7). The K5's per-bundle OD targets feed loom-jacket sizing. (source: `research/2026-05-21_milspec_heatshrink_protocols.md:48` — DR-25 2:1, recovered ID sets jacket choice; `K5_WIRING_STATE.md:182` — `loom_outer_jacket_pn` is a real property slot, value not yet ingested)

> Note: the recalc engine already exposes **bundle-OD** as a derived output of the workbench toggles (source: `K5_WIRING_STATE.md:119` — "bundle-OD diffs"). The OD comes from the twist lay-up; the lay-up parameters in §2.2 are the missing inputs.

---

## 3. Segmentation — splitting the harness into sub-harnesses

### 3.1 Why segment

A single monolithic harness cannot be built, routed, or serviced. The K5 is segmented into trunks/looms that meet at boundaries. The established trunks are **engine loom, dash loom, rear loom, door looms, and the power runs**. (source: `output/K5_PROTOTYPE_CUT_PLAN.md:71`; `K5_WIRING_STATE.md:119` — color-coded loom trunks in the twin)

### 3.2 The bulkhead is the primary segmentation boundary

The firewall pass-through is where mil-spec engine wiring meets factory body wiring; it is the single most important segmentation point.

| Boundary fact | Value | Citation |
|---|---|---|
| Firewall bulkhead connector | **D38999/24WJ61SN** receptacle + **D38999/26WJ61PN** plug, insert 25-61, M39029 #20 contacts, 20–24 AWG only | (source: `K5_WIRING_STATE.md:43`) |
| Cavity loading | 61/61 used, 0 spare, **8 wires OVERFLOW** (OPS/FPS companions, #100, #60, #114/#115) | (source: `K5_WIRING_STATE.md:43`) |
| Overflow resolution | rail consolidation vs 2nd bulkhead vs grommet — **OPEN, Skylar's call** | (source: `K5_WIRING_STATE.md:43`) |
| Protocol transition at the bulkhead | mil-spec heat-shrink stack STOPS at the firewall; body-side reverts to factory crimp + vinyl sleeve | (source: `research/2026-05-21_milspec_heatshrink_protocols.md:172`) |

### 3.3 The engine ↔ body join method is still open

How the engine sub-harness joins the body sub-harness — bulkhead connector (serviceable) vs solder + heat-shrink (permanent) vs Raychem ES splice — is an **OPEN architectural question** that affects rebuildability. Do not assert it closed. (source: `K5_WIRING_STATE.md:67-68` — open questions 1 and 2)

> The D38999 firewall connector (§3.2) is LOCKED as *a* bulkhead; whether every cross-firewall wire goes through it (vs supplementary grommet runs) is the unresolved part, tied to the 8-wire overflow. (source: `K5_WIRING_STATE.md:43`)

### 3.4 Segmentation respects the power-spine routing schools

Sub-harness boundaries follow the two routing schools: **along-frame** (frame rail = free armor, for rear-bound runs) and **over-firewall** (cowl lip, for side-to-side bay runs). The rear loom is frame-doctrine; bay cross-runs are cowl-doctrine. (source: `research/2026-06-10_power_spine_builders_study.md:24-42`)

---

## 4. Dave's method — calculate max, prototype, verify, cut last

This is the locked construction discipline. **Never cut a wire from a guess.** (source: `K5_WIRING_STATE.md:51` — accepted 2026-05-12)

| Step | What happens | Owner | Citation |
|---|---|---|---|
| ① Calculate **maximum** length | Each wire's longest routed path, computed in the twin with service loop (12"), shielded bypass (+6"), door flex (+6"), bend allowance (×1.05 / ×1.10 heavy) | [DESIGN] | `output/K5_PROTOTYPE_CUT_PLAN.md:12`; `scripts/compute_wire_lengths.py` → `K5_computed_lengths.csv` (113 wires, 913.8 ft) `output/K5_PROTOTYPE_CUT_PLAN.md:5` |
| ② Prototype with **ONE-COLOR** wire at max | Pull one color per gauge at the computed max; circuit identity rides on printed heat-shrink labels, not insulation color | [HANDS] | `output/K5_PROTOTYPE_CUT_PLAN.md:6`; one-color rule `output/K5_MATERIALS_FORMBOARD.md:8`; color reassignment allowed at mockup `K5_WIRING_STATE.md:34` |
| ③ **Verify on vehicle** | Carry the loom to the truck; tape-measure every landmark L01–L30 along the real path; write real values into `K5_landmarks.yaml` (the measured file, kept separate from the derived file) | [HANDS] | `output/K5_PROTOTYPE_CUT_PLAN.md:74`; "Step ③ is not optional" `output/K5_PROTOTYPE_CUT_PLAN.md:67` |
| ④ **Cut to size** | Rerun `compute_wire_lengths.py` with the measured file; the delta report is the final-cut authorization | [HANDS] | `output/K5_PROTOTYPE_CUT_PLAN.md:74-75` |

**Why max-first, cut-last:** cutting short is the expensive, unrecoverable failure. The compute run already caught wires the old zone estimates would have scrapped — e.g. License Plate Lamp est 3.5 ft vs computed 17.7 ft; Dome Light 3.5 → 14.5 ft; coil wires 2.5 → ~4.5 ft once the firewall leg is included. (source: `output/K5_PROTOTYPE_CUT_PLAN.md:14-31`)

**Provenance caveat:** landmark values are derived from the 3D model, not tape-measured; the model bakes 8 asserted positions (A1–A8: M130, PDM30, FWG-MAIN grommet, battery, engine setback, floor grommet). The 12" service loop + bend allowance absorbs ±2" of position error; it does NOT absorb a relocated PDM or moved grommet. (source: `output/K5_PROTOTYPE_CUT_PLAN.md:65-67`) This is why ③ exists.

---

## 5. The 1:1 formboard is the build jig — not paper

The formboard is a full-scale physical jig the loom is laid and built on. It is NOT a printed proof packet. Dave rejected the auto-generated "proof packet" — "Dave wants 1:1 formboard, not more paper." (source: `K5_WIRING_STATE.md:113`)

| Formboard element | Spec | Citation |
|---|---|---|
| Run length | Truck wiring envelope **14.5 ft** (front lighting → tailgate cluster) | (source: `output/K5_MATERIALS_FORMBOARD.md:28`) |
| Board | 2× 4'×8' plywood/OSB, butted end-to-end (16 ft) on sawhorses | (source: `output/K5_MATERIALS_FORMBOARD.md:30`) |
| Centerline layout | 1:1 from the Blender top view (`K5_harness_formboard_top.png`), print-at-scale or grid-transfer | (source: `output/K5_MATERIALS_FORMBOARD.md:31`) |
| Major stations (model Y, front-axle datum) | front axle 0", firewall 18.7", FLOOR-RR 62.8", rear axle 106.4", tail lights 144.8" | (source: `output/K5_MATERIALS_FORMBOARD.md:31`) |
| Guides | pegs/nails + fender washers every ~6" | (source: `output/K5_MATERIALS_FORMBOARD.md:32`) |
| Landmark marking | masking tape + paint pen for L01–L30 | (source: `output/K5_MATERIALS_FORMBOARD.md:33`) |
| Mock points | spring clamps for door-boot and grommet mocks | (source: `output/K5_MATERIALS_FORMBOARD.md:34`) |
| Temporary ties | waxed-polyester lacing cord during prototype — **no DR-25 until final** (sizes follow verified bundle ODs) | (source: `output/K5_MATERIALS_FORMBOARD.md:42`) |

The formboard build order: pull prototype footage from Dave's stock → lay trunk routes per the Blender views → cut prototype wires at computed max, label both ends → carry to truck and measure → rerun compute. (source: `output/K5_PROTOTYPE_CUT_PLAN.md:70-75`)

---

## 6. The connector-deferral rule

**Device-end connectors are NOT finalized until after the formboard is built and verified.** Do not propose connector lists, mating PNs, or terminal counts before then. (source: `K5_WIRING_STATE.md:52` — Skylar's explicit instruction 2026-05-11)

| Item | Status | Citation |
|---|---|---|
| Device-end connector bodies, terminals, seals, backshells, boots | **DEFERRED** until formboard verification | (source: `output/K5_MATERIALS_FORMBOARD.md:46`; lock `K5_WIRING_STATE.md:52`) |
| Prototype/materials list | contains **zero connector part numbers on purpose** | (source: `output/K5_MATERIALS_FORMBOARD.md:4`) |
| DR-25 / SCL / solder sleeves | do **NOT** order yet — sizes follow final bundle diameters off the verified formboard | (source: `output/K5_MATERIALS_FORMBOARD.md:42`) |
| **Firewall D38999** | **EXCEPTION — LOCKED** (the one connector finalized ahead of the formboard) | (source: `K5_WIRING_STATE.md:43`) |
| PDM30 / M130 mating kits | already owned per `K5_bom.txt` (M130-CONN-KIT $35); verify in hand before the gate opens | (source: `output/K5_MATERIALS_FORMBOARD.md:48`) |

The reason device-end connectors wait: real bundle ODs and break-out geometry (from §2) are only known once the loom is laid and verified, and the heat-shrink stack sizing (§7) depends on those ODs. Committing connector/boot PNs earlier is the "explosive diarrhea" / "confident stupidity" failure mode Dave and Skylar already rejected. (source: `K5_WIRING_STATE.md:105-106`)

---

## 7. The lug / heat-shrink termination stack

Every power-spine lug termination is built in this exact order, inside-out. This consolidates the spine study's construction detail (`research/2026-06-10_power_spine_builders_study.md:213`) with the heat-shrink protocol (`research/2026-05-21_milspec_heatshrink_protocols.md:54`).

| Layer | Spec / action | Owner | Citation |
|---|---|---|---|
| 1. **Hex crimp** | Closed-barrel tinned-copper lug crimped with a six-sided **hex die** — cold-forms the barrel 360° into a gas-tight joint. Hydraulic hex preferred; hammer/indent inconsistent. **No solder** on power lugs (a soldered joint wicks stiff and creates a fatigue line at the flex point) | [HANDS] | (source: `research/2026-06-10_power_spine_builders_study.md:216`) |
| 2. **Adhesive-lined shrink, visible bead** | Dual-wall adhesive-lined shrink (M23053/4 Class 2/3, "SCL") starts ON the barrel (ring tongue left bare), extends 1–1.5" onto the cable jacket. Heat until adhesive **beads visibly at both edges** — the bead is the inspection criterion that the hot-melt flowed and sealed | [HANDS] | (source: `research/2026-06-10_power_spine_builders_study.md:220`; SCL flow `research/2026-05-21_milspec_heatshrink_protocols.md:50`) |
| 3. **DR-25 overlap** | Where the cable runs jacketed, the adhesive layer tucks under the DR-25 end and they **thermally weld at the overlap** during shrink (same SCL→DR-25 bond used at every connector) | [HANDS] | (source: `research/2026-06-10_power_spine_builders_study.md:222`; `research/2026-05-21_milspec_heatshrink_protocols.md:73`) |
| 4. **Polarity band** | **Red shrink at every positive lug, black at every negative** — the band is the at-a-glance polarity label against the uniformly-black DR-25 jacket | [HANDS] | (source: `research/2026-06-10_power_spine_builders_study.md:223`) |
| 5. **Boot on splash studs** | At studs exposed to splash (distribution stud, E-Stopp posts), add a fitted **rubber terminal boot** as the outermost layer — a cover, not a structural seal; the adhesive shrink underneath does the sealing | [HANDS] | (source: `research/2026-06-10_power_spine_builders_study.md:224`) |

**What layer 2 actually does (three jobs):** (a) seals the crimp mouth against moisture wicking down the strands; (b) strain-relieves — vibration bends the cable in open span, not at the crimp mouth where strands fatigue; (c) insulates the barrel. (source: `research/2026-06-10_power_spine_builders_study.md:221`)

**Crimp verification:** inspection (crimp centered, no barrel cracks) + pull test per IPC/WHMA-A-620 §19.1 — 16 AWG ≥ 50 lbf, 20 AWG ≥ 13 lbf, 22 AWG ≥ 8 lbf. (source: `research/2026-05-21_milspec_heatshrink_protocols.md:157`)

**Signal-wire terminations** (non-lug, at Superseal/D38999 contacts) follow the same inside-out logic with a different stack: optional solder sleeve (shield drain) → SCL inner → DR-25 outer → AS85049 backshell+boot (D38999 side only; Superseal uses a built-up SCL+DR-25 boot, no formal AS backshell). (source: `research/2026-05-21_milspec_heatshrink_protocols.md:54-86`)

**Recovered-diameter sizing** for each shrink layer (supplied ID ≥ largest OD covered; recovered ID ≤ smallest OD gripped) depends on the verified bundle ODs from §2.4 — which is why DR-25/SCL are not ordered until after the formboard (§6). The K5's per-termination recovered diameters: (UNKNOWN — needs external ingestion: per-wire DR-25/SCL recovered IDs off the verified formboard; `library_search.py "DR-25 recovery ratio"` → no matches; the property slots `wire_termination_*_inner_seal_pn` / `_outer_cover_pn` exist but hold no values — `K5_WIRING_STATE.md:182,185`)

---

## 8. The experiential boundary — design vs hands

This is the load-bearing discipline of the chapter. **An agent may resolve every [DESIGN] step and must defer every [HANDS] step as a marked unknown — never asserting it COMPLETE.** (source: wiring receipt rule `.claude/rules/wiring-receipt.md` — "The builder is the expert"; "may NOT … substitute for hands-on K5/Motec experience")

### 8.1 Agent-ownable (DESIGN) — resolvable from documents + the twin

- Goal config, load list, current sum, power partition, OCP + gauge sizing (§1 steps 1–5)
- Twist-layer **plan**: which wires twist together, core selection, layer order, break-out layer assignment (§2 — the *plan*, not the executed twist)
- Segmentation boundaries, cavity counts, pin/cavity map (§1 steps 7–9; §3)
- Max-length **derivation** in the twin (§4 step ①)

### 8.2 Builder-deferred (HANDS) — marked UNKNOWN, never asserted done

| Hands step | Why it's hands, not design | Citation |
|---|---|---|
| **Twist pitch / lay length** executed on the bench | A physical lay-up feel + the actual pitch value the builder runs; the value isn't in substrate | (§2.2 UNKNOWN; rule `K5_WIRING_STATE.md:53`) |
| **Crimp feel** + pull-test pass | Tactile + tested per gauge; "may NOT substitute for hands-on experience" | (`research/2026-05-21_milspec_heatshrink_protocols.md:157`; `.claude/rules/wiring-receipt.md`) |
| **On-vehicle verify** (Dave step ③) | Tape-measuring real landmarks on the truck; "not optional" | (`output/K5_PROTOTYPE_CUT_PLAN.md:67,74`) |
| **Final cut** (Dave step ④) | Authorized only by the measured-delta report, after ③ | (`output/K5_PROTOTYPE_CUT_PLAN.md:74-75`) |
| **Physical mounts** / routes / grommet selections | Real paths around obstacles; "may NOT decide a wire's actual physical route without confirmation" | (`K5_WIRING_STATE.md:198`; `.claude/rules/wiring-receipt.md`) |
| **Heat-shrink stack execution** (§7 layers 1–5) | Hands-on crimping + bead-confirmed shrink | (`research/2026-06-10_power_spine_builders_study.md:213`) |

### 8.3 The carve-out rule

When a step is HANDS, the agent's job is to hand the builder a fully-resolved DESIGN and a clean unknown — not a fabricated value dressed as done. The done-test for an agent's contribution is: *every design field cited, every hands step explicitly deferred with a close path.* A hands step asserted COMPLETE is the cardinal violation this canon exists to prevent. (source: `.claude/rules/wiring-wire-closure-protocol.md` — "an unknown without a close path is a hand-wave"; `.claude/rules/wiring-receipt.md` — "The builder is the expert")
