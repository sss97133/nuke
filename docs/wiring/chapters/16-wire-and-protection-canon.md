# Chapter 16 — Wire & Protection Canon

This chapter is the durable reference for the *physical conductor* and everything that terminates, sizes, protects, and sheathes it. It does not cover routing (Ch. 13), the cut list (Ch. 9), or connector pinouts (Ch. 10) except where those touch the wire itself. Every line below is one atom with a citation. Where a fact is needed but absent from our substrate, it is written as a rule and marked `UNKNOWN — needs external ingestion`. Nothing here is recalled from training data.

---

## 1. The two wire specs — M22759/16 vs /32

1.1 **Both are the same wire family — but the ETFE is NOT made the same way**: both are **ETFE (Tefzel)** insulation on a **tin-plated (tin-coated) copper** conductor, both **−65 to +150 °C**, both **600 V RMS**, per SAE-AS22759 (formerly MIL-W-22759). The conductor metal and temperature/voltage rating are identical between the two slash numbers. **The insulation construction differs**: /32 is **cross-linked (radiation cross-linked) modified ETFE, thin-wall** (source: `docs/wiring/output/K5_wire_spec_and_costs.md:280`); /16 is **extruded ETFE, standard-wall — explicitly NOT cross-linked** (source: `docs/wiring/output/K5_wire_spec_and_costs.md:299,304`). The earlier shorthand calling both "cross-linked" was wrong; only /32 is cross-linked. (source: `docs/wiring/research/2026-05-21_milspec_heatshrink_protocols.md:24-28`)

1.2 **The real difference is wall thickness and OD, which forces the gauge split.** /32 is thin-wall (**0.005" / 0.127 mm** min insulation); /16 is standard-wall (**0.010" / 0.254 mm**, ~2× thicker, stiffer, heavier per foot). /32 is gauge-equivalent ~30 % smaller OD than PVC/TXL — that is why signal wiring is /32. (source: `docs/wiring/output/K5_wire_spec_and_costs.md:284,302-304` | source: `docs/wiring/research/2026-05-21_milspec_heatshrink_protocols.md:29`)

1.3 **/32 tops out at 12 AWG.** MIL-W-22759/32 covers **28 AWG through 12 AWG only** — it does not exist in 10, 8, 6, 4, or 2 AWG. For larger gauges use /16. (source: `docs/wiring/output/K5_wire_spec_and_costs.md:106-108`)

1.4 **/16 gauge range is 2–24 AWG** per this build's spec sheet (Appendix B). (source: `docs/wiring/output/K5_wire_spec_and_costs.md:303`) — Note an internal substrate disagreement: the heat-shrink protocol summary table states /16 as **10–4 AWG** (source: `docs/wiring/research/2026-05-21_milspec_heatshrink_protocols.md:26`). The wider 2–24 range is the spec's own appendix and is the more authoritative figure; the /16 *use* on this build is bounded by the build mapping in §1.5, not by the spec's full range.

1.5 **THIS BUILD'S LOCKED MAPPING (do not re-propose):**

| AWG range | Spec | Locked |
|---|---|---|
| 12–22 AWG | M22759/32 | 2026-05-11 |
| 4–10 AWG | M22759/16 | 2026-05-11 |

Tefzel-only — no TXL, no marine-cable substitution for 4 AWG. (source: `docs/wiring/K5_WIRING_STATE.md` §1 "DECISIONS LOCKED IN" — Skylar verbal "ONLY TEFZEL", 2026-05-11)

1.6 **One historical inconsistency to suppress:** `K5_wire_spec_and_costs.md` Appendix C and the gauge table still say 4 AWG = "Welding cable or marine-grade" (source: `docs/wiring/output/K5_wire_spec_and_costs.md:138,309,320`). That predates the lock in §1.5. **SUPERSEDES:** `docs/wiring/output/K5_wire_spec_and_costs.md:138` (was: "4 | Welding cable or marine-grade ... PVC/rubber") — the locked spec is **M22759/16 in 4 AWG**, Tefzel-only.

1.7 **Color code** (last PN digit = base color, two digits = base+stripe): 0 Black · 1 Brown · 2 Red · 3 Orange · 4 Yellow · 5 Green · 6 Blue · 7 Violet · 8 Gray · 9 White. /16 carries a reduced palette: 10 AWG = Black/Red/White/Gray/Yellow; 8 AWG = Black/Red only. **Three-color stripes do not exist in /32** — remap to two-color + heat-shrink label (Ch. 9 / `K5_wire_spec_and_costs.md` §"Three-Color Stripe Problem"). (source: `docs/wiring/output/K5_wire_spec_and_costs.md:142-152,189-190,255-270`)

---

## 2. Ampacity & gauge sizing — the three inputs and the WHICH-CHART rule

A gauge is sized from **current**, then checked against **voltage drop over length**, then **derated for bundle and temperature**. The smallest gauge that survives all three is the answer.

### 2.1 The WHICH-CHART rule (governs which decision)

There are three ampacity numbers for any gauge and they are NOT interchangeable. Use the right one for the decision in front of you:

| Chart | What it assumes | Governs |
|---|---|---|
| **Manufacturer free-air** | one wire, still air, rated insulation temp | the *floor* — never size below this; used only for a single solo run (e.g. a battery-corner stub) |
| **Bundle-derated (chassis)** | N current-carrying wires nested in a loom keeping each other warm | **every wire inside a harness bundle** — this is the working chart for the K5 |
| **Build-standard derate** | the project's own conservative compound derate | the *audit gate* — what `audit_k5_wiring.py` enforces before bench test |

The free-air number is a sales figure. The bundle number is reality inside a loom. The build-standard is what passes audit. When they disagree, the *tighter* one wins for that wire. (source: `docs/wiring/research/2026-06-10_power_spine_builders_study.md:150` — "A parallel pair inside the main harness bundle should be sized off the bundled column ... not the free-air column" | source: `docs/wiring/output/K5_EE_AUDIT.md:16`)

### 2.2 Bundle derate schedule (ABYC)

| # current-carrying conductors in bundle | Derate |
|---|---|
| 3 | −30 % |
| 4–6 | −40 % |
| 7–24 | −50 % |

Both legs of a parallel pair count as current-carrying, and so does everything else in the same loom. (source: `docs/wiring/research/2026-06-10_power_spine_builders_study.md:150`)

### 2.3 The build-standard derate (what the audit enforces)

The K5 audit stacks **70 % bundle derate × 70 % engine-bay heat derate** on the Tefzel @ 150 °C base ampacity, and checks gauge ≥ load on the derated number. (source: `docs/wiring/output/K5_EE_AUDIT.md:16`) This is the compound figure behind every per-gauge "derated A" value in the audit, e.g. 14 AWG → 11.9 A, 12 AWG → 16.1 A, 18 AWG → 7.0 A, 8 AWG → 32.2 A, 16 AWG → 9.1 A, 20 AWG → 5.2 A. (source: `docs/wiring/output/K5_EE_AUDIT.md:41-110`)
> The base free-air ampacity-per-AWG table for M22759 Tefzel @ 150 °C is `UNKNOWN — needs external ingestion: SAE-AS22759 / MIL-W-5088 (or M22759/16,/32 manufacturer datasheet) ampacity-vs-AWG table`. The audit script computes from it internally; the table itself is not captured as citable substrate. The 135 A (4 AWG) and 146 A (2×8 parallel) free-air figures used in the power-spine study are explicitly flagged **VERIFY against ProWire datasheet** (source: `docs/wiring/research/2026-06-10_power_spine_builders_study.md:165-166`).

### 2.4 Voltage-drop ceiling

Power runs: **≤ 3 % drop** (≤ 0.42 V on a 14 V system). Voltage drop scales with **area** (resistance), not ampacity — so on a *long* run, size by cross-section, not by the ampacity method, because the ampacity method can pass current while still dropping too much voltage. (source: `docs/wiring/output/K5_EE_AUDIT.md:18` | source: `docs/wiring/research/2026-06-10_power_spine_builders_study.md:148`)
> **Tighter for sensor references:** a 5 V reference or a thermistor return cannot tolerate the same drop as a lamp feed — millivolts of IR drop on a SEN_5V or SEN_0V leg become measurement error at the ADC. The build expresses this structurally (letter-paired SEN_5V/SEN_0V to minimize ground-loop offset — Ch. 5 §"SEN_0V pairing rule") rather than as a numeric Vdrop budget. A specific mV-drop ceiling for reference legs is `UNKNOWN — needs external ingestion: MoTeC M1 hardware sensor-input accuracy spec (motec_m1_hardware_techspec.pdf)`.

### 2.5 Core-of-bundle runs hottest

The conductors in the geometric **center of a bundle** shed heat worst — they are surrounded by other warm wires on all sides. When a derate is applied to a bundle, it protects the core wire; an edge wire has margin to spare. Size the bundle for its hottest member (the core), not its average. (source: `docs/wiring/research/2026-06-10_power_spine_builders_study.md:150` — the bundle-derate exists precisely because "wires bundled together keep each other warm")

### 2.6 Live audit FAILs (size-from-current violations to know)

These are open ampacity FAILs that block bench test — the canonical examples of getting §2.1–§2.3 wrong:

| Circuit | Finding |
|---|---|
| `PDM30_BAT+` / `BAT-` | 2 AWG (derated 73.5 A) < 150 A required (104 % over) |
| `PDM30_Ch7` / `Ch8` | 16 AWG (derated 6.4 A) < 8 A required |
| `REAR-SUB-NEG` / `POS` | 14 AWG (derated 11.9 A) < 15 A required |

(source: `docs/wiring/output/K5_EE_AUDIT.md:30-35`) The `PDM30_BAT+/-` FAIL is the §3 parallel-conductor question in numeric form — and was remediated in cut-list v4.1 by the PDM battery-feed redesign (source: `docs/wiring/K5_WIRING_STATE.md` §1, cut list v4.1 entry).

---

## 3. The parallel-conductor doctrine

3.1 **What it is:** instead of one fat cable, run **N smaller wires of identical gauge, identical length, terminated identically at both ends**, sharing the current. (source: `docs/wiring/research/2026-06-10_power_spine_builders_study.md:128`)

3.2 **Why pros do it — it is NOT about skin effect.** At DC and 14 V automotive, skin effect is irrelevant; current uses the full cross-section. The reasons are mechanical and logistical: **bend radius** (small wires drape where a fat cable fights every corner), **loom packaging** (small wires nest into a round cross-section instead of bulging the DR-25), **availability** (under the Tefzel-only lock the big cables may have to be built this way at all — §3.6), and **redundancy/routing**. (source: `docs/wiring/research/2026-06-10_power_spine_builders_study.md:130-133`) It is also factory-blessed in this ecosystem: MoTeC PDMs take battery supply through many small parallel pins, not one lug. (source: `docs/wiring/research/2026-06-10_power_spine_builders_study.md:133`; `docs/wiring/reference/connectors/CONNECTOR_DATA_REPORT.md:560` — PDM30 20 A outputs use 2 paralleled Superseal pins each)

3.3 **The non-negotiable rule — equal length.** Parallel wires divide current in inverse proportion to resistance. Same gauge + same length + same termination = equal resistance = equal share. Make one leg shorter and it takes more than its share, runs hotter, and loses its protection margin first. This is the NEC 310.10 paralleling rule (same length, material, circular-mil area, insulation, termination) — the engineering content that transfers to vehicles is the **equal-everything rule**, not the NEC's 1/0 floor (which is building-wiring jurisdiction; aviation and motorsport parallel smaller gauges routinely). (source: `docs/wiring/research/2026-06-10_power_spine_builders_study.md:136-139`)

3.4 **Sizing a parallel set** (two methods, use whichever gives MORE copper on a long run):
- **Cross-section:** N wires whose summed copper area ≥ the single cable's area. Reference areas: 4 AWG = 21.2 mm² · 8 AWG = 8.37 mm² · 10 AWG = 5.26 mm² · 12 AWG = 3.31 mm². (source: `docs/wiring/research/2026-06-10_power_spine_builders_study.md:147`)
- **Ampacity:** N × (one wire's ampacity) ≥ load. Ampacity doesn't scale linearly with area (small wires shed heat better per unit copper), so this usually needs fewer wires — but **apply the §2.2 bundle derate to each leg**. (source: `docs/wiring/research/2026-06-10_power_spine_builders_study.md:146-150`)

3.5 **Consolidation at the ends** (descending preference for spine gauges):
1. **All legs crimped into one lug barrel** sized for the COMBINED area (e.g. 2×8 AWG ≈ 16.7 mm² → a 6-AWG-barrel lug), hex-crimped. Legal per ABYC: multiple conductors in one terminal **provided combined circular mils ≤ terminal capacity AND the joint passes the E-11 pull test**. Cleanest — zero extra joints.
2. **Crimped parallel-splice band** mid-run only when geometry forces a transition (shorter + better strain relief than a butt splice).
3. **NOT solder sleeves** — they are shield-drain / small-gauge hardware; the heat to wet 8 AWG cooks the sleeve.

(source: `docs/wiring/research/2026-06-10_power_spine_builders_study.md:141,154-158`)

3.6 **Honest counterpoint:** when nothing constrains you, one cable is simpler — fewer joints, fewer failure points. The pattern earns its keep only when bend radius, loom OD, connector cavities, or wire availability constrain — which is exactly the K5's case under the Tefzel-only lock. (source: `docs/wiring/research/2026-06-10_power_spine_builders_study.md:160`) This is a **stated design principle, not yet encoded in the cut list** — current cut list still has 4/8/10 AWG single runs; reconciling them is an open task. (source: `docs/wiring/K5_WIRING_STATE.md` §2 design principles)

---

## 4. The "0 AWG /16" inconsistency and its resolution

4.1 **The defect:** the cut list shows **"0 AWG M22759/16"** for the starter, alternator, and disconnect cables (#6 / #59 / #63 in v4; same circuits as #6/#63 in earlier versions). **This size does not exist in the spec'd slash number** — /16 maxes at 2 AWG per §1.4, and 0 AWG is well above that. It is a substrate inconsistency, not a buildable spec. (source: `docs/wiring/research/2026-06-10_power_spine_builders_study.md:132,256`)

4.2 **A second, smaller defect from the same family:** cut-list #51 (blower) shows "10 AWG M22759/32" — but /32 tops at 12 AWG (§1.3), so 10 AWG must be /16. (source: `docs/wiring/research/2026-06-10_power_spine_builders_study.md:256`)

4.3 **The resolution — two valid paths, Skylar's open call:**
- **(a) Source 1/0-class Tefzel from a different slash number** — outside the locked /16 range, so it requires a spec amendment if chosen.
- **(b) Build it as the §3 parallel pattern: 2 × 4 AWG /16** (42.3 mm² ≈ 1 AWG), equal length, both legs crimped into one combined-area lug.

(source: `docs/wiring/research/2026-06-10_power_spine_builders_study.md:132,236-238,256` — spine spec table rows P1/P2/P3/G1) This is the concrete form of the open reconciliation in `K5_WIRING_STATE.md` §9.8. The cut-list v4.1 PDM battery feed already encodes the choice as **owner-pick**: `#PDM_BPOS` is specced as "0 AWG single OR 2× 4 AWG parallel — Skylar picks." (source: `docs/wiring/K5_WIRING_STATE.md` §1, cut list v4.1 entry)

---

## 5. Termination doctrine

5.1 **Crimp, do not solder.** A soldered joint wicks solder stiff up the strands and creates a fatigue line — a stress riser **exactly at the wick line**, where vibration then flexes the now-rigid-to-flexible transition until strands break. Crimp-only is the OE / F1 / RB-Racing / marine consensus for the whole harness, spine to signal. (source: `docs/wiring/research/2026-06-10_power_spine_builders_study.md:216` | source: `docs/wiring/research/2026-06-10_power_spine_builders_study.md:158`)
> The lone sanctioned solder exceptions are the **shield-drain solder sleeve** (§7.3) and the factory body-side splices past the firewall (Ch. 8 / `milspec_heatshrink_protocols.md` §8) — both outside the mil-spec harness proper.

5.2 **Barrel types:**
- **Open barrel** (F-crimp / wings fold over) — stamped-and-formed automotive contacts (Superseal 1.0, Metri-Pack). (source: `docs/wiring/reference/connectors/CONNECTOR_DATA_REPORT.md:204-213`)
- **Closed barrel** (cylindrical, wire inserted end-on) — machined mil-spec contacts (M39029 D38999 sockets/pins) and **lugs** for power cable. (source: `docs/wiring/reference/connectors/CONNECTOR_DATA_REPORT.md:74-101`)
- **Machined (solid) barrel** — the gold one-piece motorsport contact (ProWire SSC-N, RaceSpec solid) used as a Superseal upgrade; one size spans 16–24 AWG. (source: `docs/wiring/reference/connectors/CONNECTOR_DATA_REPORT.md:214-221`)

5.3 **Controlled-cycle tooling — the crimp must be repeatable, not feel-based:**
- **Signal/contact crimps:** ratcheting **8-indent** mil-spec frame that will not release until the cycle completes — **M22520/2-01 (AFM8)** + size-specific positioner, or the TE **HDT-48-00** for Superseal. Verify with a go/no-go gauge. (source: `docs/wiring/reference/connectors/CONNECTOR_DATA_REPORT.md:147,155-156,433-477`)
- **Power lugs:** **hex die** (six-sided, cold-forms the barrel 360° into a gas-tight joint). Hammer-style indent tools are inconsistent — the field fix is to put the hammer die in a hydraulic press. (source: `docs/wiring/research/2026-06-10_power_spine_builders_study.md:216`)

5.4 **Every crimp is verified two ways:** visual (crimp centered, no barrel cracks, correct indent count) **and** a pull test to the A-620 value for the gauge (§8). (source: `docs/wiring/research/2026-06-10_power_spine_builders_study.md:216` | source: `docs/wiring/research/2026-05-21_milspec_heatshrink_protocols.md:157`)

5.5 **Contact ↔ wire-gauge matching is hard-bounded by the contact, not the wire:** e.g. D38999 size #20 accepts **20–24 AWG only**; an 18 or 16 AWG wire physically cannot terminate in a #20 cavity. Pick the contact variant for the gauge before committing the bulkhead arrangement. (source: `docs/wiring/reference/connectors/CONNECTOR_DATA_REPORT.md:60-67,544-556`)

---

## 6. The M23053 heat-shrink tree

Heat shrink is M23053 (formerly MIL-I-23053, now SAE-AMS-DTL-23053); the slash number sets material, ratio, and adhesive. Three branches carry the K5, applied by job:

| Branch | Slash | Brand alias | Ratio | Adhesive | Where it applies |
|---|---|---|---|---|---|
| **Outer jacket** | /16 | **DR-25** | 2:1 | NO | the bundle outer cover, build-wide; semi-rigid, −75/+150 °C, diesel/oil/hydraulic + abrasion rated; recovered ID 1/16"–4" |
| **Adhesive transition** | /4 Class 2 (2:1) or Class 3 (3:1/4:1) | **SCL** (ATUM for high-mismatch) | 2:1–4:1 | **YES, dual-wall** | every termination seal and high-mismatch transition (small wire → larger boot/connector back) |
| **Solder sleeve** | /18 | clear PVDF (Raychem S03, per AS83519) | 2:1 | internal solder preform | **shielded-cable ground drains ONLY** (§7.3) |

(source: `docs/wiring/research/2026-05-21_milspec_heatshrink_protocols.md:39-50,116-120`)

6.1 **DR-25 is the load-bearing outer layer** and the bundle's armor. (source: `docs/wiring/research/2026-05-21_milspec_heatshrink_protocols.md:48`)

6.2 **SCL is what seals every termination.** Its inner adhesive is hot-melt polyamide that **flows** when shrunk, spreading into the void between bundle and boot — this is what makes the harness IP67 at each termination without molded backshells. The inspection criterion is **visible adhesive bead at both edges**. (source: `docs/wiring/research/2026-05-21_milspec_heatshrink_protocols.md:50,70-72`; `docs/wiring/research/2026-06-10_power_spine_builders_study.md:220`)

6.3 **Which ratio, sized by mismatch:** SCL 3:1 (or 4:1) for the inner seal when it must bridge a big bundle down to a small connector back; DR-25 2:1 for the outer cover, which only has to cover the SCL. Rule of thumb: 2:1 cannot grip a connector back if the recovered min is still larger than the back; that is what forces 3:1 SCL. (source: `docs/wiring/research/2026-05-21_milspec_heatshrink_protocols.md:92-110`)

6.4 **The termination stack, inside-out** (the canonical order at every wire end): conductor → ETFE → [optional solder sleeve for shield drains] → **SCL** inner shrink (1–1.5" past the contact back, ~20 % of recovered ID flows into the bundle void) → **DR-25** outer (covers the SCL transition, extends ~3" into the bundle, thermally welds to the SCL at the overlap) → [boot/backshell on D38999 side only]. (source: `docs/wiring/research/2026-05-21_milspec_heatshrink_protocols.md:58-86`)

6.5 **At a power lug** the same logic: hex crimp → adhesive-lined dual-wall shrink (SCL / M23053/4) starting ON the barrel, leaving the ring tongue bare, extending 1–1.5" onto the cable jacket, heated until adhesive beads at both edges; it does three jobs — **seals** the crimp mouth against moisture wicking, **strain-relieves** the stiff-barrel-to-flexible-cable transition, and **insulates**. Then red shrink at every positive lug / black at every negative (polarity label at a glance), and a fitted rubber terminal **boot** over splash-exposed studs as a cover (not a structural layer). (source: `docs/wiring/research/2026-06-10_power_spine_builders_study.md:216-224`)

6.6 **The stack stops at the firewall.** Mil-spec engine-harness wire transitions to factory PVC at the D38999 bulkhead; body-side splices revert to 1977-GM protocol (crimp + vinyl sleeve) — no DR-25 dragged across the cab. (source: `docs/wiring/research/2026-05-21_milspec_heatshrink_protocols.md:170-174`)

---

## 7. Shielding & splice hardware (where solder is allowed)

7.1 **Shielded cable is required on: crank (CKP), cam (CMP), knock B1, knock B2, CAN, wideband O2, video.** (source: `docs/wiring/output/K5_EE_AUDIT.md:19` | source: `docs/wiring/chapters/05-build-manifest.md:26-28`)

7.2 **CAN is a twisted pair**, ≥ 33 twists/meter per SAE J1939, 120 Ω termination at each physical end. (source: `docs/wiring/chapters/appendix-g-diagram-requirements-spec.md:197,320,343`)

7.3 **The shield drain terminates in a Raychem S03 solder sleeve** (M23053/18 clear PVDF + internal fluxed solder preform, AS83519) — the drain enters the side slot, the preform melts, the clear window confirms the joint wetted. This is the one place solder is doctrine, not error, because it must bond a fine drain wire to a shield braid. (source: `docs/wiring/research/2026-05-21_milspec_heatshrink_protocols.md:116-120`)

7.4 **Y-splices / branches use AS81765/1 Type II transition boots** (molded, adhesive-lined; 1→2 Y, 1→3 W, 1→4 X). Each K5 Y-splice (coil +12 V trunk → 8 branches; injector +12 V trunk → 8 branches; M130 ground bus; ETB fan-out) needs its boot PN documented as cited substrate, not invented. (source: `docs/wiring/research/2026-05-21_milspec_heatshrink_protocols.md:121-129`)

---

## 8. IPC/WHMA-A-620 — the workmanship gate

8.1 **A-620** ("Requirements and Acceptance for Cable and Wire Harness Assemblies") is the construction standard the K5 is built to: it specifies crimp inspection criteria, pull-test minimums, solder-joint quality, and lacing/tying. **Class 2 (Dedicated Service Electronic Products) applies to this build.** (source: `docs/wiring/chapters/appendix-g-diagram-requirements-spec.md:321`)

8.2 **The three classes** (what they mean for acceptance):

| Class | Name | Bar |
|---|---|---|
| 1 | General Electronic Products | lowest — function is enough |
| **2** | **Dedicated Service Electronic Products** | **the K5 standard** — continued performance and extended life required; uninterrupted service desired but not critical |
| 3 | High-Performance / Harsh / Life-Support | highest — continued high-reliability where downtime cannot be tolerated |

The K5 is Class 2 (source: `docs/wiring/chapters/appendix-g-diagram-requirements-spec.md:321`). The full normative text of the Class 1/2/3 definitions is `UNKNOWN — needs external ingestion: IPC/WHMA-A-620 §1 (General) class definitions` — the one-line bars above are the working summary, not the standard's verbatim wording.

8.3 **Canonical gauge-indexed crimp pull-force table.** Three copies of pull-test minimums exist in our substrate and **two of them disagree** — reconciled here:

| AWG | A-620 min pull (lbf) — canonical | Source copy A (`milspec_heatshrink §7`) | Source copy B (`harness_protection_catalog`) | Source copy C (`power_spine §5`) |
|---|---|---|---|---|
| 22 | **8** | 8 | 10 | — |
| 20 | **13** | 13 | — | — |
| 18 | (see note) | — | 20 | — |
| 16 | **50** | 50 | — | — |
| 14 | (see note) | — | 30 | — |

(source A: `docs/wiring/research/2026-05-21_milspec_heatshrink_protocols.md:157` | source B: `docs/wiring/output/K5_harness_protection_catalog.md:627` | source C: `docs/wiring/research/2026-06-10_power_spine_builders_study.md:216`)

**Reconciliation:** Copy A (16/20/22 AWG = 50/13/8 lbf) is the mil-spec-aligned set and is **canonical** for the gauges it covers. Copy B (22/18/14 AWG = 10/20/30 lbf) is a rounded shop approximation that **conflicts at 22 AWG** (10 vs 8) and is otherwise non-overlapping. **SUPERSEDES:** `docs/wiring/output/K5_harness_protection_catalog.md:627` (was: "10 lb minimum for 22 AWG, 20 lb for 18 AWG, 30 lb for 14 AWG") — for 22 AWG the A-620 minimum is **8 lbf**, not 10; the 18 and 14 AWG figures in copy B are shop round-numbers pending the authoritative table.

8.4 **The authoritative full table is NOT in substrate.** No single source carries every AWG (note the gaps at 18 and 14 above). The complete crimp tensile-strength table is `UNKNOWN — needs external ingestion: IPC/WHMA-A-620 Table (crimp tensile / pull-test minimums by AWG)`. Until ingested, use Copy A's values for 16/20/22 AWG verbatim, and treat 14/18 AWG as the shop round-numbers from Copy B (≥30/≥20 lbf) **provisionally**. Do not fabricate the missing rows.

8.5 **Tie/lace spacing** (A-620 workmanship, for completeness): tape/tie every **150 mm on the trunk, 75 mm on branches**. (source: `docs/wiring/chapters/appendix-g-diagram-requirements-spec.md:304`)

---

## 9. Corrections this chapter lands

9.1 **Concentric-twist direction — wires do NOT alternate.** Chapter 3's Ultra-tier description says concentric-twist construction uses "wires twisted in **alternating-direction** layers around a core wire." That is wrong. In concentric/twisted-bundle construction the conductors are laid **in the same direction at the same pitch** around the core; the lay does not reverse layer to layer. **SUPERSEDES:** `docs/wiring/chapters/03-tier-system.md:46` (was: "Concentric twist — wires twisted in alternating-direction layers around a core wire"). The correct statement: *concentric twist — conductors laid same-direction, same-pitch (same lay) around a central core wire, in successive layers.* (UNKNOWN — replacement rule pending external ingestion: HP Academy concentric-twist module or a MIL/SAE wire-construction standard. The 'alternating-direction' claim at 03-tier-system.md:46 is superseded regardless.)
> The K5 sits at **Professional tier** (parallel-bundle construction), not Ultra/concentric-twist, so this corrects a reference description rather than a build instruction. (source: `docs/wiring/chapters/03-tier-system.md:33-37` — "The K5 Blazer build is at this tier" [Professional])

9.2 The 4 AWG = "welding/marine" remnant is superseded by §1.6.

9.3 The 22 AWG = 10 lbf pull figure is superseded by §8.3.
