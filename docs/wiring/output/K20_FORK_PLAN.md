# K20 FORK PLAN — '74 Chevrolet K20 LWB · LSX454 + 6L90

**The production-line fork document.** Template: **K5 v4.2** (1977 K5 Blazer, LS3 + 6L80E + MoTeC M130/PDM30 — 174 wires, 1,143.5 ft, `output/K5_cut_list_v4_2.txt`).
Skylar's framing: *"harnesses with minor tweaks between vehicles but the framework is parallel... like a production line of model trim levels."*

**Date:** 2026-06-11 · **Receipt:** `receipts/2026-06-11_k20-fork-plan.md` · **Fork config:** `configs/k20_74_lwb_lsx454.toml`
**Status:** PLAN — no K20 wire may be cut from this document. Every length below is K5-geometry-derived and **invalid until re-derived** on K20 geometry.

---

## 0. VEHICLE IDENTITY — DB finding (no rows created)

Query: `vehicles` for 1974 K20 + the canonical id, 2026-06-11.

| Candidate | What the DB says | Verdict |
|---|---|---|
| **`d7adb919-93d8-4fc3-af1b-afb4e027acb3`** | 1974 Chevrolet **Cheyenne Super K20**, VIN `CKY244Z103570`, **109 images + 23 observations** incl. active build record: chassis dry-ice cleaned at Dri Clean Restoration 2026-04-30, body on lift, engine removed, front clip off, yellow paint, **NP203 transfer case confirmed by physical nameplate read (Tier-4)**. No `owner_id` set. | **This is Doug's K20 per PULSE** ("Doug's K20 — customer build, K5 is the canonical template"). It is the only 1974 K20 in the DB with build substance. |
| `7bce69e1-73f1-4fb2-bb20-1af6bf37a5bf` | 1974 Cheyenne Super K20, "Inventory ID: INV_030, In Stock", owner = Skylar (`0b9f107a`), 0 images / 0 obs | Near-certain **duplicate row** of d7adb919 from an inventory import — merge candidate, flag for Skylar, not actioned here. |
| `d5ec0923-fc83-4ed1-b094-6cfb14713e4c` | **1978 K20 LWB**, VIN `CCL448J172994`, "INV_055, In Progress", owner = Skylar, **338 images + 125 obs** | A *different* K20 LWB in Skylar's orbit (and a C-series VIN wearing a K label — its own anomaly). If "Skylar's '74 K20 LWB" is actually this truck misremembered by year, the fork target changes. |
| `42b05e38` / `eab81aed` | 1973 K20 LWB rows (Photos album import owned by Skylar; a sold BaT '73 K20 LWB) | Year-adjacent noise; not 1974. |

**Finding:** No DB row is labeled "1974 K20 LWB." The strongest read: **Skylar's "'74 K20 LWB" = Doug's K20 = `d7adb919`** (1974, pickup, active build, K5-template relationship already established in PULSE) — but the DB records neither bed length nor the LSX454/6L90 powertrain on it (zero observations mention LSX454 or 6L90 anywhere on this vehicle). The 73–87 VIN does not encode wheelbase, so LWB cannot be confirmed from `CKY244Z103570`.
**→ `vehicle` in the fork config is set TBD-confirm with `d7adb919` as the working candidate. Skylar confirms in one sentence; powertrain observation (LSX454 + 6L90) should then land via `ingest-observation`, not raw insert.**

---

## 1. FORK SEMANTICS — what "trim level" means here

The K5 calc stack proved the harness is **derived, not designed**: `subsystems.json` (22 subsystems) × cut-list registry × landmark lengths → `k5_harness_calc.py` recalculates wires/ft/$/PDM/bundles from toggles. A sibling vehicle is therefore a **fork along the swap axes already encoded in the data**:

- `CORE_ENGINE.swap_axis`: *"engine_type (LS3 V8 today; swapping engine swaps coil/injector count, sensor pinouts, ETB connector — structure stays)"* — `calc-data/subsystems.json`
- `TRANS_6L80E.swap_axis`: *"trans_type (manual swap drops controller #58 + NSS; reverse switch + t-case indicator survive any swap)"* — `calc-data/subsystems.json`
- Geometry axis (not yet encoded as a named axis): every length traces to `K5_landmarks_blender_derived.yaml`, which is **explicitly K5-twin-derived** ("model wheelbase 2,703 mm vs FR-88 cited 2,705 mm"). A LWB pickup invalidates the body-side values wholesale.

So the fork = same 22-subsystem framework, same wire-ID registry semantics, same calc engine; three classes of change:
**CARRIES** (structure and likely lengths) · **ADAPTS** (structure carries, parameters re-derive) · **OPEN** (decision required before the subsystem is derivable).

Geometry anchor for the whole fork: **K5 wheelbase 106.5" (2,705 mm, FR-88 per landmarks header) vs K20 LWB 131.5"** — 1973–87 K20 long-bed pickups ride a 131.5" wheelbase / 117.5" short-bed ([Wikipedia, C/K third generation](https://en.wikipedia.org/wiki/Chevrolet_C/K_(third_generation)); [It Still Runs 1984 K20 spec — dimensions unchanged 1973–87: 131.5" wb / 212.0" OAL on the 8-ft bed](https://itstillruns.com/specifications-1984-chevy-k20-7563575.html)). **Δ wheelbase = +25.0".** Shared hardware fact working in our favor: the 73–80 Blazer and pickup share the cab structure from the B-pillar forward (same dash, doors, firewall, front clip family), so dash/door/engine-bay landmarks are *candidates* to carry while everything aft of the cab re-derives.

---

## 2. CARRIES 1:1 — structure AND likely lengths (5 subsystems)

| Subsystem | Rationale | Citations |
|---|---|---|
| **CORE_ENGINE** (62 wires, the spine) | M130 + PDM30 + CAN backbone + keypad + display architecture is vehicle-agnostic. The 8-coil/8-injector topology **carries because the LSX454 is a Gen-IV-architecture LSX-block V8 and the coil/injector hardware is builder-supplied anyway** (long block ships bare — see §4). The K5's DEL-Stributor central-mount 8× D510C pattern + 8× sequential injectors maps unchanged onto the M130's 8/8 capacity. Engine-loom lengths (L01–L13 class, 2.5–4.6 ft runs) are engine-relative, not body-relative — same engine-bay family → likely carry, verify on K20 twin. Caveat: L01/L10–L13 depend on the M130 mount position, which is an *unknown on the K5 too* (`K5_WIRING_STATE.md` §4). | `subsystems.json` CORE_ENGINE swap_axis; `K5_cut_list_v4_2.txt` engine loom; `K5_coil_mapping.md` |
| **COOLING** (#21/#22/#25 — 2 fans + EWP, PDM OUT1/2/5) | Pattern and position both carry: radiator/fans live at the core support, same front clip family, same 4.6 ft runs. Parameter re-check (not re-derive): 454 ci / 627 hp rejects more heat than the LS3 — fan/EWP sizing should be re-validated, wire gauges re-audited by the calc engine if amps change. | `subsystems.json` COOLING; gauge doctrine `2026-05-14_substrate-amendment-gauge-audit.md` |
| **WIPERS_WASHER** (#46/#49/#50) | Same cab, same cowl, same motor position. Nothing about the bed or wheelbase touches this loom. | `subsystems.json` WIPERS_WASHER; shared-cab fact (§1) |
| **DASH_CLUSTER_DAKOTA** (#71 + #114–#124 dual-sender set) | Dakota VHX-73C-PU is literally the 1973–87 Chevy *pickup* cluster — the K5 borrowed the truck part. CAN-fed via SGI-100BT from the M130; dash-zone lengths (3.5 ft class) carry with the shared dash. Dual-sender wires carry as accepted. | `K5_DAKOTA_GAUGE_CARD.md`; `receipts/2026-05-14_acceptance-three-decisions.md` |
| **ACCESSORY_12V** (#48/#70/#72 — outlet, USB, horn) | Dash-zone + core-support horn; same cab, same positions. | `subsystems.json` ACCESSORY_12V |

**Also carries at the architecture level (not a subsystem):** the v4.1 ECU lifelines (#ECU_PWR/#ECU_GND1/2, #PDM_BPOS/#PDM_GND1/2 — mandatory on every config), the firewall D38999 61-pin bulkhead *concept* (cavity count recomputes — see HARNESS_INFRA), the Tefzel-only wire spec (M22759/32 + /16), the 15%/20% length pads, and the gauge-audit doctrine (≤3% Vdrop, ×1.25). `K5_WIRING_STATE.md` §1–2.

---

## 3. ADAPTS — structure carries, parameters re-derive (8 subsystems)

Every row ends with **the input needed to re-derive** (one line).

| Subsystem | What carries / what changes | Re-derive input |
|---|---|---|
| **ALL body-side lengths** (cross-cutting: L14–L28 class landmarks) | Wire IDs, gauges, colors, PDM channels carry; **every length derived from the K5 Blazer twin is invalid**. Wheelbase +25.0" (106.5"→131.5", §1 citations); rear-loom runs (K5's 18.4 ft class) grow accordingly; dome/roof runs shrink (pickup cab ends at the B-pillar). | K20 digital twin download (TurboSquid #1799009 — see §6) → re-derive L01–L30 equivalents as Blender polylines, same method as `K5_landmarks_blender_derived.yaml` |
| **FUEL** (#66/#94/#98) | PWM pump-controller + relay + level-sender *pattern* carries (the prompt-level "fuel pattern" claim holds at topology level only). **Tank position does NOT carry:** the 73–80 Blazer carries a rear under-floor tank; 73–87 pickups carry frame-mounted side-saddle tanks outside the rails, dual-tank optional ([Wikipedia C/K third gen](https://en.wikipedia.org/wiki/Chevrolet_C/K_(third_generation))). #66's 18.4 ft rear run and L27 are dead numbers. Pump spec re-check for 627 hp (K5's Quantum in-tank build was sized for LS3). | Tank decision (factory side-saddle vs aftermarket EFI tank vs dual) + pump flow spec for 627 hp |
| **CHARGING_STARTING** (#6/#40/#59/#63 — 0 AWG runs) | Direct-battery architecture carries (no PDM channels). Battery corner, alternator model and mount are **all unknown on the K20** — L14 (89.4") and L15 (24.3") are K5-passenger-corner + CVF-driver-low values, doubly invalid here. | Battery corner decision + accessory-drive/alternator selection (§4) → twin polylines |
| **TRANS_6L80E → 6L90** (#55–#58 + #125 CAN stub) | Whole control architecture carries: Holley 558-499 controls **"2007+ GM 6L80 and 6L90E"** via CAN to the internal T43 TCM — the 6L90 is explicitly in the kit's application list ([Holley 558-499 product page](https://www.holley.com/products/fuel_systems/fuel_injection/terminator_x/gm_6_speed_transmission_control/parts/558-499); [Holley instruction 199R12431](https://documents.holley.com/199r12431.pdf)). NSS/reverse/T-case indicator survive per the encoded swap_axis. Caveats inherited and new: (a) Holley notes 20+ T43 OS variants, *not all tested* — the K20's donor 6L90 OS must be checked; (b) see §7 Risk 2 on the 558-499/M130 pairing. Tunnel-run lengths (L28 class) re-derive (minor). | Donor 6L90's TCM OS version + T43 module mount location → tunnel polyline |
| **LIGHTING_EXTERIOR** (22 wires) | Device *list* is nearly identical — the K5 template was already running pickup-flavored devices (cab clearance lights ×3 carry 1:1 with the shared cab). Deltas: tail/backup/license/3rd-brake/rear-marker positions move from Blazer quarters+tailgate to **bed corners + rear bumper/tailgate license + bed-flank markers**, all ~+25–28" farther aft. Front lighting carries (same front clip). | Twin-derived rear-loom polylines + lamp PN decisions for the bed (factory bed-corner housings vs LED) |
| **LIGHTING_INTERIOR** (#68/#69/#73/#74) | Footwell/under-dash/underhood carry (shared cab/bay). "Cargo/Bed Light" becomes a real **pickup bed/cargo lamp** (cab-back or bed-rail mount) — position + length re-derive. | Cargo lamp mount decision (cab-back vs bed) → polyline |
| **DOME_COURTESY** (#42/#43/#67) | Door switches carry (same doors). Dome light: K5's L23 = 153.5" headliner run to the *cargo-area* dome — the pickup cab dome sits above the seat; run shrinks by roughly the cargo-area length. Puddle lights remain optional (no wire IDs even on K5). | Pickup-cab dome position from twin → L23 replacement |
| **HVAC_AC** (#23/#45/#51/#105/#111) | Heater-blower control pattern carries (shared cab/firewall). A/C clutch + trinary wiring carries **only if** the LSX454 accessory drive mounts a compressor — unknown (§4). K5's locked AC architecture (factory Four-Season housing, M130/PDM logic, R134a) is a *K5-specific* decision; K20 cab uses the pickup variant of the same housing family — re-confirm fitment. | Accessory-drive decision (compressor y/n) + K20 heater-box variant check |
| **HARNESS_INFRA** (grounds, bulkhead, junctions, boots) | Concept carries: star ground, firewall bulkhead, rear harness junction. **D38999 61-way sizing must recompute** from the K20 toggle set — the K5 instance is at 61/61 with 8 overflow already (`K5_WIRING_STATE.md` §1, 2026-06-10); a work-truck K20 config crosses fewer circuits, so the same shell may actually fit with spares. Rear junction position re-derives with the frame. | Run `k5_harness_calc.py` on the K20 toggle set for crossing count + twin-derived junction position |

---

## 4. OPEN DECISIONS — engine/trans deltas (decide before derivation)

### 4.1 What the LSX454 actually is (web-verified, not from memory)

GM Performance **LSX454** crate (current PN 19417357): 454 ci / 7.4L, 4.185" bore × 4.125" stroke, **LSX cast-iron block** with 6-bolt cross-bolted mains, forged rotating assembly, 11.0:1 CR, 627 hp @ 6,300 / 586 lb-ft @ 5,100, **LSX-LS7 rectangular-port aluminum heads**, hydraulic roller cam. **Reluctor: 58X** — same Gen-IV crank trigger as the LS3. Ships as an assembled long block **with harmonic balancer and front timing cover, but WITHOUT intake manifold, throttle body, injectors, coils, or accessories** ([GM Performance Motor 19417357 spec page](https://www.gmperformancemotor.com/parts/19417357.html); [Karl Kustoms LSX454 listing](https://karlkustoms.com/product/lsx-crate-engine-19417357-lsx454-7-4l/); [Pro Touring Store listing](https://protouringstore.com/products/lsx-454-627hp-crate-engine-by-chevrolet-performance-19417357)). GM's own completion path is an **LS7-intake kit pre-assembled with fuel rail, injectors, throttle body + controller + harness + DBW pedal** ([DragStory — GMPP LSX454 intake kit announcement](https://dragstory.com/ws/gmpp-announces-lsx454-crate-engine-intake-kit/)) — which confirms the platform is DBW-EFI-native, Gen-IV style.

**Implication for the fork:** because induction/ignition hardware is builder-supplied, the K5's exact electrical pattern (8 coils on a DEL-Stributor central bracket, 8 sequential injectors, 90mm DBW) can be *transplanted as a choice* — the harness structure question collapses into the decisions below.

| # | Open decision | What's known (cited) | What's needed |
|---|---|---|---|
| OD-1 | **Crank trigger** | **58X — carries.** Same M130 ref mode as the LS3 ([GMPM spec](https://www.gmperformancemotor.com/parts/19417357.html)). #99 structure (22 AWG shielded 2C, front-cover CKP per Gen IV — K5 receipt `2026-06-09_as-built-photo-survey-corrections.md`) carries. | Nothing — closed, length re-derives with twin. |
| OD-2 | **Cam signal** | Long block includes the front timing cover (GMPM spec); Gen-IV pattern = front-cover 4X CMP. The spec page does not publish the cam-signal tooth count. | Verify 4X at delivery (sensor PN on the cover) before locking M130 sync mode. #101 structure carries either way. |
| OD-3 | **Knock provisioning** | **UNKNOWN.** LSX iron-block knock-boss location (Gen-III-style valley vs Gen-IV side-of-block) is not stated on the GM spec page; forum traffic ([LS1TECH — knock sensors on LSX](https://ls1tech.com/forums/generation-iv-external-engine/1146538-need-advice-knock-sensors-my-lsx.html)) shows the ambiguity is real. Sensor TYPE differs by generation (flat resonant valley vs side bolt-in) → affects connector + shielded-pair routing for #103/#104. | Inspect the delivered block (or LSX block drawing) — valley bosses or side bosses; pick sensor PN accordingly. |
| OD-4 | **Induction / ETB** | Engine ships intake-less (GMPM spec). K5 pattern = Holley mid-mount + 90mm DBW GM 12605109 (#4a–#4f). GMPP path = LS7 intake kit (DragStory cite). Either is DBW; LS7-port heads need a rectangle-port intake — **the K5's dual-plane/Holley 300-131 LS3 (cathedral... rectangular L92-style) intake does NOT bolt to LSX-LS7 heads.** | Intake selection for LSX-LS7 heads → fixes MAP/IAT positions and ETB connector; #4a–#4f structure carries if 12605109-family ETB chosen. |
| OD-5 | **Injectors** | Builder-supplied. K5 = 8× Siemens Deka 650cc (≈62 lb/hr) — flow-ample for 627 hp NA; electrical pattern (saturated, 2-wire low-side) identical. | Confirm injector PN + connector family (EV1 vs EV6/USCAR) for the chosen fuel rail. |
| OD-6 | **Coils** | Builder-supplied; LSX454 valve covers lack coil-bracket provisions (noted in completion-kit coverage, DragStory/search). K5's DEL-Stributor **central-mount** bracket sidesteps valve-cover mounting entirely — cleanest carry. | Confirm DEL-Stributor bracket clears the LSX454's taller? deck/intake — fitment check on the twin or mockup. |
| OD-7 | **DBW pedal** | K5 = GM 10379038, `gm_aps_6pin`, dual-track analog (v4.2 wires #APS_T1/T2_*). Same cab → same pedal mount. GMPP kit ships its own pedal (DragStory cite) — electrically equivalent class. | One-line confirm: reuse 10379038 → all six APS wires carry verbatim (lengths re-derive trivially, dash zone). |
| OD-8 | **6L90 controller** | **Holley 558-499 covers 6L90 explicitly** (cites in §3 TRANS row). Kit includes the TCM-side connector/harness (K5 shopping list note carries). | (a) Donor 6L90 TCM OS check against Holley's tested list; (b) resolve Risk 2 (§7) FIRST on the K5. |
| OD-9 | **Alternator / accessory drive** | Long block ships with no accessory drive (GMPM spec). K5 as-built = CVF Racing drive, alternator low-driver (photo-surveyed, `2026-06-09_as-built-photo-survey-corrections.md`). K20 = nothing chosen. Determines alternator position (charging runs), compressor presence (HVAC_AC scope), and belt plane. | Accessory-drive selection for the LSX454 (CVF again? Holley mid-mount LSX-compatible?) + alternator amp rating vs the K20 config's calc'd `alternator_required_A`. |
| OD-10 | **Battery location** | Unknown on the K20 (the K5's passenger-firewall-corner working position is an owner statement about the *K5*, `2026-06-10_cut-list-v4.1` §5 — does not transfer). | Skylar picks the K20 corner → L14/L15-class polylines derive from the twin. |
| OD-11 | **Brakes** | iBooster was a K5-specific Tesla-salvage choice. K20 brake architecture undecided (factory hydroboost? vacuum? iBooster again?). Subsystem left ON in the fork config as available structure. | Brake architecture decision; if iBooster, #52/#53/#95 carry with re-derived lengths. |
| OD-12 | **Parking brake** | E-Stopp ESK001 was a K5 choice; the K20 may keep its factory mechanical foot brake. Toggled OFF in the fork baseline. | Confirm factory mechanical (→ stays off, 1 wire + OUT7 stay freed) or E-Stopp again. |

---

## 5. DEFERRED — toggled off in the work-truck baseline (structure available, zero derivation work owed)

`AUDIO`, `POWER_WINDOWS`, `POWER_LOCKS`, `AMP_STEPS`, `CAMERA_REAR`, `EXHAUST_CUTOUTS_QTP` — mirrors the K5 `k5_work_truck.toml` precedent plus the two K5-flavor accessories (steps, cutouts). Any of them can be toggled back on and inherit ADAPTS treatment (rear-loom lengths for camera/audio-rear; door boots return with windows/locks per HARNESS_INFRA dependency rules). `EPARKING_BRAKE` also off per OD-12.

**Counts: CARRIES 5 · ADAPTS 8 · OPEN-gated 2 (BRAKES_IBOOSTER, EPARKING_BRAKE) · DEFERRED 6** — 21 electrical subsystems accounted for (+ NON_ELECTRICAL excluded), against 12 open decisions in §4.

---

## 6. THE K20 DIGITAL TWIN IS ONE DOWNLOAD AWAY

TurboSquid **order #6425842 (Dec 2024)** — the same order that bought the K5's Blazer twin — also included **"1978 Chevrolet Pickup K20 Silverado" (product 1799009), PAID and never downloaded** (`receipts/2026-06-09_3d-model-v2-digital-twin.md` §"New substrate conflicts" item 5). Recoverable from TurboSquid My Downloads. Precedent already set: the K5 uses a *1978* model for a *1977* truck (scale-verified Δ2 mm on wheelbase); same move works for a '74 K20 — 1973–80 share the cab/bed geometry, with year-specific front trim only. **This download is the unblocking action for every ADAPTS row in §3.**

---

## 7. BIG RISKS

1. **Vehicle identity is unconfirmed.** If "Skylar's '74 K20 LWB" is not `d7adb919` (e.g., it's the 338-image '78 K20 LWB `d5ec0923`, or an unrecorded truck), the model-year trim deltas and the twin choice shift. One sentence from Skylar resolves it. (§0)
2. **558-499 pairing risk, inherited from the template.** Holley's own page states *"The Terminator X Max ECU is required for GM 6L80/90E transmission control"* ([Holley 558-499](https://www.holley.com/products/fuel_systems/fuel_injection/terminator_x/gm_6_speed_transmission_control/parts/558-499)) — but the K5's locked Option A treats 558-499 as a standalone T43 module talking CAN to the **MoTeC M130** (`receipts/2026-05-14_acceptance-three-decisions.md`). That pairing is **unproven on the K5**. Prove it there before buying a second kit for the K20 — if it fails, both trucks need Option B (M130 GPR-T1 direct solenoid drive, which eats all six half-bridges) or a different TCU.
3. **LSX-LS7 heads break intake interchange.** The K5's locked intake hardware does not transfer; until OD-4 closes, MAP/IAT/ETB positions — and therefore part of the engine loom — are floating. (§4 OD-4)
4. **Every K20 length is currently fiction.** The smoke-test numbers below run against K5 geometry by construction. Cutting any wire from them would repeat the exact class of error the landmarks header warns about. Twin download (§6) + re-derivation is the gate.
5. **PDM30 headroom is a fresh question, not an inherited answer.** The K5 sits at 30/30. The work-truck K20 baseline frees channels (smoke test shows the toggle effect), but OD-9/OD-11 choices can claim them back. Recompute after decisions, don't assume.

---

## 8. SMOKE TEST — TEMPLATE STRUCTURE ONLY (K5 geometry, NOT K20 numbers)

`python3 scripts/k5_harness_calc.py --config docs/wiring/configs/k5_baseline.toml --diff docs/wiring/configs/k20_74_lwb_lsx454.toml`

> ⚠ **These figures are the K5 template recomputed under the K20 toggle set.** They prove the fork config drives the production line (wires drop, channels free, footage shrinks). They are **NOT K20 cut lengths** — all lengths are K5-twin-derived and flagged invalid until §6 lands.

```
══ DIFF: k5_baseline → k20_74_lwb_lsx454 ══  (actual run, 2026-06-11)
Wires: 145 → 120  (-25 dropped, +0 added)
  dropped: #1, #2, #26a–#30b, #31, #32, #34–#38, #44, #47, #54, #96, #97
Footage: 892.0 → 737.8 ft  (Δ -154.2)
Conductor cost: $752.32 → $523.43  (Δ -$228.89)
Nameplate sum: 393.9 → 273.9 A  |  Alt required (×1.25 worst-case-peak math): 493 → 343 A
PDM channels: 30 → 21  freed: OUT3, OUT4, OUT7, OUT9, OUT10, OUT11, OUT20, OUT21, OUT22
Trunk FW_JUMP: ⌀0.553" → ⌀0.455"  |  DASH_LOOM: ⌀0.238" → ⌀0.22"  |  DOOR_L: → ⌀0
```

The toggle set alone frees **9 PDM channels** — directly relevant to Risk 5: the K5 is pinned at 30/30, the K20 work-truck fork starts with headroom. (Registry is the cut-list-v3-based calc registry; v4.2 additions ride on top per the `K5_ENGINE_START_MINIMUM.md` precedent. The 34 gauge-audit flags in the full output are nameplate-amps-vs-doctrine findings on the *template* — same set the K5 carries, see `2026-05-14_retraction-gauge-audit-and-companion-amendment.md` context — not new K20 findings.)

---

## 9. NEXT ACTIONS (in dependency order)

1. **Skylar:** confirm vehicle identity (§0) + the §4 one-liners that are pure picks (OD-7 pedal, OD-10 battery corner, OD-12 parking brake).
2. **Download TurboSquid product 1799009** (paid) → build `K20_harness_workspace.blend` per the K5 v2 method → derive K20 landmarks YAML.
3. **Prove Risk 2 on the K5** (558-499 ↔ M130 CAN) before duplicating the purchase.
4. Close OD-4 (intake for LSX-LS7 heads) and OD-9 (accessory drive) — they gate the engine-loom re-derivation.
5. Fork the registry: `K20_cut_list_v1.txt` generated from the K5 v4.2 registry + §3 adaptations, every length tagged `needs_rederivation` until the K20 twin polylines exist.
