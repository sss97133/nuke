# Chapter 16 — Wire & Protection Canon

This chapter is the durable reference for the *physical conductor* and everything that terminates, sizes, protects, and sheathes it. It does not cover routing (Ch. 13), the cut list (Ch. 9), or connector pinouts (Ch. 10) except where those touch the wire itself. Every line below is one atom with a citation. Where a fact is needed but absent from our substrate, it is written as a rule and marked `UNKNOWN — needs external ingestion`. Nothing here is recalled from training data.

---

## 1. The two wire specs — M22759/16 vs /32

1.1 **Both are the same wire family — but the ETFE is NOT made the same way**: both are **ETFE (Tefzel)** insulation on a **tin-plated (tin-coated) copper** conductor, both **−65 to +150 °C**, both **600 V RMS**, per SAE-AS22759 (formerly MIL-W-22759). The conductor metal and temperature/voltage rating are identical between the two slash numbers. **The insulation construction differs**: /32 is **cross-linked (radiation cross-linked) modified ETFE, thin-wall**; /16 is **extruded ETFE, standard-wall — explicitly NOT cross-linked**. The earlier shorthand calling both "cross-linked" was wrong; only /32 is cross-linked. **This is now externally grounded**: the SAE standard title for /16 is *"WIRE, ELECTRIC, FLUOROPOLYMER-INSULATED, **EXTRUDED ETFE**, MEDIUM WEIGHT, TIN-COATED COPPER CONDUCTOR, 600-VOLT, 150°C"*, while /32 is sold as *"M22759/32 Lightweight Wall **Cross-Linked ETFE**"*. Both confirmed tin-coated copper, 150 °C, 600 V. (source: SAE International — AS22759/16A standard title page https://www.sae.org/standards/content/as22759/16a/ ; ProWire USA /32 product page https://www.prowireusa.com/m22759-32-tefzel-wire.html ; corroborated by TE Connectivity AS22759 extruded-ETFE page | internal: `docs/wiring/output/K5_wire_spec_and_costs.md:280,299,304`; `docs/wiring/research/2026-05-21_milspec_heatshrink_protocols.md:24-28`)

1.2 **The real difference is wall thickness and OD, which forces the gauge split.** /32 is thin-wall (**0.005" / 0.127 mm** min insulation); /16 is standard-wall (**0.010" / 0.254 mm**, ~2× thicker, stiffer, heavier per foot). /32 is gauge-equivalent ~30 % smaller OD than PVC/TXL — that is why signal wiring is /32. (source: `docs/wiring/output/K5_wire_spec_and_costs.md:284,302-304` | source: `docs/wiring/research/2026-05-21_milspec_heatshrink_protocols.md:29`) The qualitative standard-wall (/16) vs light-weight-wall (/32) distinction is externally confirmed (§1.1); the verbatim numeric tolerances (0.010" / 0.005") are `UNKNOWN — needs external ingestion: paid SAE AS22759/16 and /32 slash sheets (sae.org body paywalled)` and remain substrate-sourced, not independently re-verified.

1.3 **/32 tops out at 12 AWG.** AS22759/32 spans **30 AWG through 12 AWG** (NEPP sizes: 30, 28, 26, 24, 22, 20, 18, 16, 14, 12) — the small end is **30 AWG**, one size smaller than the canon previously stated ("28 through 12"); the load-bearing **12-AWG ceiling is confirmed correct**. It does not exist in 10, 8, 6, 4, or 2 AWG — for larger gauges use /16. Light-weight wall, tin-coated copper, 150 °C, 600 V. (source: NASA NEPP / NPSL — MIL-W-22759/32 https://nepp.nasa.gov/npsl/wire/22759/22759_32.htm | internal: `docs/wiring/output/K5_wire_spec_and_costs.md:106-108`)

1.4 **REVERSAL — /16 spans 24 AWG through 2/0, NOT "2–24 AWG / maxes at 2 AWG."** The canon previously called 2–24 AWG the authoritative range and treated 2 AWG as the /16 ceiling. **That ceiling was an internal-substrate artifact, not the SAE/manufacturer spec.** Three independent sources confirm the /16 AWG range is **24 AWG through 2/0**: sizes 24, 22, 20, 18, 16, 14, 12, 10, 8, 6, 4, 2, 1, 1/0, 2/0 (part numbers M22759/16-24 … M22759/16-01 (1/0), M22759/16-02 (2/0)). The prior "internal substrate disagreement" (heat-shrink table 10–4 AWG vs appendix 2–24 AWG) is moot — **both were build-use sub-ranges, neither was the spec ceiling**. The /16 *use* on this build is bounded by the build mapping in §1.5; the spec itself reaches 2/0. (source: ProWire USA / Thermax — MIL-W-22759/16,/17 datasheet https://www.prowireusa.com/content/50813/M22759-16-DataSheet.pdf ; corroborated by Jaycor International — Single Core Tefzel M22759 datasheet https://www.jaycor.co.za/PDF/M22759%20ETFE%20Tefzel%20Wires.pdf ; and NASA NEPP/NPSL — MIL-W-22759/16 https://nepp.nasa.gov/npsl/wire/22759/22759_16.htm | internal, now superseded as a ceiling: `docs/wiring/output/K5_wire_spec_and_costs.md:303`; `docs/wiring/research/2026-05-21_milspec_heatshrink_protocols.md:26`)

1.5 **THIS BUILD'S LOCKED MAPPING (do not re-propose):**

| AWG range | Spec | Locked |
|---|---|---|
| 12–22 AWG | M22759/32 | 2026-05-11 |
| 4–10 AWG | M22759/16 | 2026-05-11 |

Tefzel-only — no TXL, no marine-cable substitution for 4 AWG. (source: `docs/wiring/K5_WIRING_STATE.md` §1 "DECISIONS LOCKED IN" — Skylar verbal "ONLY TEFZEL", 2026-05-11)

1.6 **One historical inconsistency to suppress:** `K5_wire_spec_and_costs.md` Appendix C and the gauge table still say 4 AWG = "Welding cable or marine-grade" (source: `docs/wiring/output/K5_wire_spec_and_costs.md:138,309,320`). That predates the lock in §1.5. **SUPERSEDES:** `docs/wiring/output/K5_wire_spec_and_costs.md:138` (was: "4 | Welding cable or marine-grade ... PVC/rubber") — the locked spec is **M22759/16 in 4 AWG**, Tefzel-only.

1.7 **Color code** (last PN digit = base color, two digits = base+stripe): 0 Black · 1 Brown · 2 Red · 3 Orange · 4 Yellow · 5 Green · 6 Blue · 7 Violet · 8 Gray · 9 White. /16 carries a reduced palette: 10 AWG = Black/Red/White/Gray/Yellow; 8 AWG = Black/Red only. **Three-color stripes do not exist in /32** — remap to two-color + heat-shrink label (Ch. 9 / `K5_wire_spec_and_costs.md` §"Three-Color Stripe Problem"). (source: `docs/wiring/output/K5_wire_spec_and_costs.md:142-152,189-190,255-270`)

1.8 **M22759/16 per-AWG physical constants** (Thermax/ProWire datasheet). Strand OD feeds loom sizing (§6 heat-shrink), DC resistance feeds the §2.4 voltage-drop check, and the weights numerically confirm the "standard-wall, heavier per foot" claim of §1.2.

| AWG | Stranding (count/strand-AWG) | Finished OD nom–max (in) | OD (mm) | Max DC res (Ω/1000ft @20 °C) | Weight (lb/1000ft) |
|---|---|---|---|---|---|
| 2/0 | 1330/30 | .539–.553 | 13.69–14.05 | .091 | 485 |
| 1/0 | 1045/30 | .473–.485 | 12.01–12.32 | .126 | 380 |
| 1 | 817/30 | .426–.436 | 10.82–11.07 | .149 | 293 |
| 2 | 665/30 | .384–.392 | 9.75–9.96 | .183 | 231 |
| 4 | 133/25 | .308–.316 | 7.82–8.03 | .280 | 152 |
| 6 | 133/27 | .247–.253 | 6.27–6.43 | .445 | 96.9 |
| 8 | 133/29 | .196–.202 | 4.98–5.13 | .701 | 61.5 |
| 10 | 37/26 | .136–.142 | 3.45–3.61 | 1.26 | 34.0 |
| 12 | 37/28 | .111–.117 | 2.82–2.97 | 2.02 | 21.8 |
| 14 | 19/27 | .091–.095 | 2.31–2.41 | 3.06 | 14.5 |
| 16 | 19/29 | .077–.081 | 1.96–2.06 | 4.81 | 9.68 |
| 18 | 19/30 | .069–.073 | 1.75–1.85 | 6.23 | 7.65 |
| 20 | 19/32 | .058–.062 | 1.47–1.57 | 9.88 | 5.18 |
| 22 | 19/34 | .050–.054 | 1.27–1.37 | 16.2 | 3.52 |
| 24 | 19/36 | .043–.047 | 1.09–1.19 | 26.2 | 2.45 |

(source: ProWire USA / Thermax — MIL-W-22759/16 datasheet, Stranding / Insulation Diameter / Maximum Resistance / Weight columns https://www.prowireusa.com/content/50813/M22759-16-DataSheet.pdf)

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

### 2.2 Bundle derate schedule (ABYC) — CORRECTED

**CORRECTION: under ABYC E-11, the K5's DC harness derates a FLAT 0.7 (−30 %), regardless of conductor count.** The stepped cascade the canon previously listed (3 → −30 %, 4–6 → −40 %, 7–24 → −50 %) is **AC-only** — ABYC E-11 Table VI is AC/DC-split, and the stepped tiers live in the **AC** sub-tables (titled "AC CIRCUITS"). For DC circuits (the entire K5 12 V system) the factor is a single flat 0.7. So the "4–6 → −40 %" and "7–24 → −50 %" tiers **DO NOT APPLY** to this build under ABYC.

| Basis | Derate rule |
|---|---|
| **ABYC E-11 DC circuits (the K5)** | **flat 0.7 (−30 %)** once bundled > 24 in / 610 mm — regardless of conductor count |
| ABYC E-11 AC circuits (not the K5) | stepped: 2–3 → 0.7, 4–6 → 0.6 (−40 %), 7–24 → 0.5 (−50 %), 25+ → 0.4 (−60 %) |
| ISO 13297 (for contrast) | applies the stepped cascade to DC too; ABYC does not |

**Trigger condition (§11.14.3.7.1):** bundle-derating applies only past **24 in / 610 mm** of bundled run — a short shared run does not derate. Both legs of a parallel pair count as current-carrying, and so does everything else in the same loom. (source: ABYC E-11 (2008) Table VI-A/B/C/D headers + §11.14.3.7.1, Paneltronics-hosted excerpts https://www.paneltronics.com/images/technical/E11Excerpts.pdf ; corroborated by Professional BoatBuilder / IBEX "Derating Standards for Bundled Wires" (Jan 2022) https://www.proboat.com/2022/01/derating-standards-for-bundled-wires/ | internal, now superseded: `docs/wiring/research/2026-06-10_power_spine_builders_study.md:150`)

### 2.3 The build-standard derate (what the audit enforces)

The K5 audit stacks **70 % bundle derate × 70 % engine-bay heat derate** on the Tefzel @ 150 °C base ampacity, and checks gauge ≥ load on the derated number. (source: `docs/wiring/output/K5_EE_AUDIT.md:16`) This is the compound figure behind every per-gauge "derated A" value in the audit, e.g. 14 AWG → 11.9 A, 12 AWG → 16.1 A, 18 AWG → 7.0 A, 8 AWG → 32.2 A, 16 AWG → 9.1 A, 20 AWG → 5.2 A. (source: `docs/wiring/output/K5_EE_AUDIT.md:41-110`)

**Free-air single-wire chart (now sourced — and it FAILS the 135 A figure).** The ProWire/RB-Racing Tefzel single-conductor free-air chart is a fixed-temperature-**RISE** chart (rise above ambient, one wire, free air):

| AWG | 35 °C-rise (A) | 10 °C-rise (A) |
|---|---|---|
| 2 | 100 | 54 |
| 4 | 72 | 40 |
| 6 | 54 | 30 |
| 8 | 40 | 20 |
| 10 | 30 | 15 |
| 12 | 20 | 12.5 |
| 14 | 15 | 10 |
| 16 | 12.5 | 7 |
| 18 | 10 | 5 |
| 20 | 7 | 4 |
| 22 | 5 | 3 |

**VERIFY-FAILED:** at 4 AWG the chart shows **72 A (35 °C-rise)**, NOT 135 A. The "135 A @ 4 AWG free-air" figure (and the 146 A 2×8-parallel figure derived from it) used in the power-spine study **fails verification against the very datasheet it cited** — replace 135 A with **72 A (35 °C-rise) / 40 A (10 °C-rise)**. (source: ProWire USA — Tefzel Wire Amperage Chart, data credited to RB Racing, Wayback snapshot 20250813124700 https://www.prowireusa.com/tefzel-amperage-chart | the failed figure: `docs/wiring/research/2026-06-10_power_spine_builders_study.md:165-166`)

> **Basis caveat — the 150 °C-absolute free-air table stays UNKNOWN.** The chart above is a fixed-temperature-RISE basis, not a flat "150 °C-absolute free-air" table. The literal 150 °C-absolute free-air column the audit script computes from is **not published by any manufacturer on that basis** and `REMAINS UNKNOWN — the audit's internal table is computed in code, not published`. ABYC Table VI tops at a 125 °C column then jumps to 200 °C, so it cannot source 150 °C either. A second source on a **different** basis: Pegasus Auto Racing publishes **BUNDLED** amps at full 150 °C (24=5.1, 22=6.3, 20=8.9, 18=11.4, 16=13.9, 14=17.7, 12=24.0, 10=32.9) — **do NOT interchange** with the rise-basis chart; here "free-air vs bundled" is basis-dependent, not a fixed derate. (source: Pegasus Auto Racing — MIL-W-22759/16 current ratings https://www.pegasusautoracing.com/group.asp?GroupID=WIRE2)

### 2.4 Voltage-drop ceiling

Power runs: **≤ 3 % drop** (≤ 0.42 V on a 14 V system). Voltage drop scales with **area** (resistance), not ampacity — so on a *long* run, size by cross-section, not by the ampacity method, because the ampacity method can pass current while still dropping too much voltage. (source: `docs/wiring/output/K5_EE_AUDIT.md:18` | source: `docs/wiring/research/2026-06-10_power_spine_builders_study.md:148`)
> **Tighter for sensor references:** a 5 V reference or a thermistor return cannot tolerate the same drop as a lamp feed — millivolts of IR drop on a SEN_5V or SEN_0V leg become measurement error at the ADC. The build expresses this structurally (letter-paired SEN_5V/SEN_0V to minimize ground-loop offset — Ch. 5 §"SEN_0V pairing rule") rather than as a numeric Vdrop budget. A specific mV-drop ceiling for reference legs is `UNKNOWN — needs external ingestion: MoTeC M1 hardware sensor-input accuracy spec (motec_m1_hardware_techspec.pdf)`.

### 2.5 Core-of-bundle runs hottest

The conductors in the geometric **center of a bundle** shed heat worst — they are surrounded by other warm wires on all sides. When a derate is applied to a bundle, it protects the core wire; an edge wire has margin to spare. Size the bundle for its hottest member (the core), not its average. **Primary-source grounding:** the NASA NESC wire-derating test (NESC-RP-17-01264, the modern re-derivation of the AS50881/MIL-W-5088 bundle curves) instruments a 32-wire bundle with thermocouples on a central (internal) wire and an exterior (surface) wire, builds its model around "Central Conductor Steady State," and states the objective as "simulate the hottest possible (worst-case) thermal conditions." Lectromec (AS50881/EWIS authority): "placing high-current wires in a bundle's center generates higher temperatures than random placement." Lineage: the bundle-derate curves originated as MIL-W-5088 (1960s generalized conductor-count test curves), now part of SAE AS50881 — conductor-count-driven continuous curves (distinct from ABYC's stepped/flat factors). **CAVEAT:** "core hottest" is sourced to the aerospace test basis, NOT to an ABYC clause — ABYC expresses derate only as count-keyed/flat factors, with no center-conductor clause. (source: NASA NESC Technical Assessment Report NESC-RP-17-01264 (Rickman et al.) https://ntrs.nasa.gov/api/citations/20180007922/downloads/20180007922.pdf ; Lectromec — "An Introduction to AS50881" / "Maximum Harness Ampacity" https://lectromec.com/introduction-to-as50881/ | internal: `docs/wiring/research/2026-06-10_power_spine_builders_study.md:150`)

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

## 4. The "0 AWG /16" question — REVERSED: it is buildable

4.1 **REVERSAL — "0 AWG M22759/16" is NOT a defect; it is an in-spec, buildable part.** The cut list shows **"0 AWG M22759/16"** for the starter, alternator, and disconnect cables (#6 / #59 / #63 in v4; same circuits as #6/#63 in earlier versions). The canon previously called this "a substrate inconsistency, not a buildable spec" on the premise that "/16 maxes at 2 AWG." **That premise is FALSE (§1.4 reversed):** /16 spans 24 AWG through 2/0, so 0 AWG (= 1/0) exists as **M22759/16-01** and 2/0 as **M22759/16-02**. The cut-list entries are a **buildable spec**, not an impossibility. (source: ProWire USA / Thermax — MIL-W-22759/16 datasheet https://www.prowireusa.com/content/50813/M22759-16-DataSheet.pdf ; Jaycor International — Single Core Tefzel M22759 https://www.jaycor.co.za/PDF/M22759%20ETFE%20Tefzel%20Wires.pdf ; NASA NEPP/NPSL — MIL-W-22759/16 https://nepp.nasa.gov/npsl/wire/22759/22759_16.htm | the now-superseded "defect" framing: `docs/wiring/research/2026-06-10_power_spine_builders_study.md:132,256`)

4.2 **A second, smaller item from the same family (still valid):** cut-list #51 (blower) shows "10 AWG M22759/32" — but /32 tops at 12 AWG (§1.3), so 10 AWG must be /16. This one is a real slash-number correction (the /32 ceiling is confirmed). (source: `docs/wiring/research/2026-06-10_power_spine_builders_study.md:256`)

4.3 **The two paths — RE-FRAMED (both are now in-spec):**
- **(a) Single 0 AWG /16** — **now in-spec; needs NO spec amendment** (it falls inside the /16 range per §1.4). This is the simplest path: one cable, fewer joints.
- **(b) 2 × 4 AWG /16 parallel** (42.3 mm² ≈ 1 AWG), equal length, both legs crimped into one combined-area lug — remains a valid **packaging / bend-radius** alternative (§3), not a spec workaround.

The choice is now purely §3.6 (single-vs-parallel by geometry), not a spec-availability constraint. This is the concrete form of the open reconciliation in `K5_WIRING_STATE.md` §9.8. The cut-list v4.1 PDM battery feed already encodes it as **owner-pick**: `#PDM_BPOS` is specced as "0 AWG single OR 2× 4 AWG parallel — Skylar picks." **NOTE:** this reversal does NOT override Dave's verbal call to run **2 AWG single** primaries (Ch. 17 §17.5.6) — that is a builder choice for brief crank-duty runs, separate from spec availability. **Single-conductor ampacity for 0 AWG (1/0) and 2/0 /16 is `UNKNOWN — needs external ingestion`:** OD/strand/resistance/weight are sourced (§1.8) but the ProWire amperage chart tops out at 2 AWG; no consulted source publishes a 1/0 or 2/0 free-air ampacity. (Moot for path (b) — 4 AWG ampacity is sourced.) (source: `docs/wiring/research/2026-06-10_power_spine_builders_study.md:132,236-238,256` — spine spec table rows P1/P2/P3/G1; `docs/wiring/K5_WIRING_STATE.md` §1, cut list v4.1 entry)

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
| **Outer jacket** | /16 | **DR-25** | 2:1 | NO | the bundle outer cover, build-wide; radiation-crosslinked elastomeric (System-25), **−75/+150 °C**, diesel/oil/hydraulic + abrasion rated; **recovered ID 1.6 mm–38 mm (1/8"–3")** |
| **Adhesive transition** | **/4 Class 1** (2:1) or Class 3 (3:1/4:1) | **SCL** (ATUM for high-mismatch) | 2:1–4:1 | **YES, dual-wall** | every termination seal and high-mismatch transition (small wire → larger boot/connector back); **−55/+110 °C** continuous (NOT the DR-25 envelope) |
| **Solder sleeve** | **AS83519** | clear PVDF (Raychem S03) | 2:1 | internal solder preform | **shielded-cable ground drains ONLY** (§7.3); −55/+150 °C |

(source: `docs/wiring/research/2026-05-21_milspec_heatshrink_protocols.md:39-50,116-120`; per-branch primary datasheets cited in §6.7–§6.9 below)

**AMS-DTL-23053 slash-sheet material map** (cited): **/4** = dual-wall adhesive-lined polyolefin, outer wall crosslinked (2:1 nominal; Class 3 = ATUM runs 3:1–4:1); **/5** = flexible flame-retardant irradiated (crosslinked) polyolefin, 2:1; **/15** = 3:1 adhesive-lined medium-wall polyolefin; **/16** = diesel-resistant semi-rigid elastomeric (= DR-25), 2:1; **/18** = clear PVDF, 2:1. The /4 title is corroborated verbatim ("INSULATION SLEEVING, ELECTRICAL, HEAT SHRINKABLE, POLYOLEFIN, DUAL-WALL, OUTER WALL CROSSLINKED"). (source: SEA Wire & Cable — M23053 / AMS-DTL-23053 slash-sheet reference https://www.sea-wire.com/m23053/ ; /4 title via everyspec MIL-DTL-23053/4D https://everyspec.com/MIL-SPECS/MIL-SPECS-MIL-DTL/MIL-DTL-23053-4D_11115/) Per-size dimensional tables for bulk /5, /15, /18 tubing are `UNKNOWN — needs external ingestion: AMS-DTL-23053/5,/15,/18 slash sheets (SAE/ANSI paywall)`; they are not used as named branches in the K5 §6 tree.

6.1 **DR-25 is the load-bearing outer layer** and the bundle's armor. (source: `docs/wiring/research/2026-05-21_milspec_heatshrink_protocols.md:48`)

6.2 **SCL is what seals every termination.** Its inner adhesive is hot-melt polyamide that **flows** when shrunk, spreading into the void between bundle and boot — this is what makes the harness IP67 at each termination without molded backshells. The inspection criterion is **visible adhesive bead at both edges**. (source: `docs/wiring/research/2026-05-21_milspec_heatshrink_protocols.md:50,70-72`; `docs/wiring/research/2026-06-10_power_spine_builders_study.md:220`)

6.3 **Which ratio, sized by mismatch:** SCL 3:1 (or 4:1) for the inner seal when it must bridge a big bundle down to a small connector back; DR-25 2:1 for the outer cover, which only has to cover the SCL. Rule of thumb: 2:1 cannot grip a connector back if the recovered min is still larger than the back; that is what forces 3:1 SCL. (source: `docs/wiring/research/2026-05-21_milspec_heatshrink_protocols.md:92-110`)

6.4 **The termination stack, inside-out** (the canonical order at every wire end): conductor → ETFE → [optional solder sleeve for shield drains] → **SCL** inner shrink (1–1.5" past the contact back, ~20 % of recovered ID flows into the bundle void) → **DR-25** outer (covers the SCL transition, extends ~3" into the bundle, thermally welds to the SCL at the overlap) → [boot/backshell on D38999 side only]. (source: `docs/wiring/research/2026-05-21_milspec_heatshrink_protocols.md:58-86`)

6.5 **At a power lug** the same logic: hex crimp → adhesive-lined dual-wall shrink (SCL / M23053/4) starting ON the barrel, leaving the ring tongue bare, extending 1–1.5" onto the cable jacket, heated until adhesive beads at both edges; it does three jobs — **seals** the crimp mouth against moisture wicking, **strain-relieves** the stiff-barrel-to-flexible-cable transition, and **insulates**. Then red shrink at every positive lug / black at every negative (polarity label at a glance), and a fitted rubber terminal **boot** over splash-exposed studs as a cover (not a structural layer). (source: `docs/wiring/research/2026-06-10_power_spine_builders_study.md:216-224`)

6.6 **The stack stops at the firewall.** Mil-spec engine-harness wire transitions to factory PVC at the D38999 bulkhead; body-side splices revert to 1977-GM protocol (crimp + vinyl sleeve) — no DR-25 dragged across the cab. (source: `docs/wiring/research/2026-05-21_milspec_heatshrink_protocols.md:170-174`)

6.7 **DR-25 per-size table** (AMS-DTL-23053/16; TE/Raychem catalog 1654025, 2:1). Format: as-supplied min ID → recovered max ID, plus recovered wall:

| Size | As-supplied min ID | Recovered max ID | Recovered wall |
|---|---|---|---|
| 1/8 | 3.2 mm [.125"] | 1.6 mm [.062"] | 0.76 mm [.030"] |
| 3/16 | 4.8 mm [.187"] | 2.4 mm [.093"] | 0.84 mm [.033"] |
| 1/4 | 6.4 mm [.250"] | 3.2 mm [.125"] | 0.89 mm [.035"] |
| 3/8 | 9.5 mm [.375"] | 4.8 mm [.187"] | 1.02 mm [.040"] |
| 1/2 | 12.7 mm [.500"] | 6.4 mm [.250"] | 1.22 mm [.048"] |
| 3/4 | 19.0 mm [.748"] | 9.5 mm [.375"] | 1.45 mm [.057"] |
| 1 | 25.4 mm [1.000"] | 12.7 mm [.500"] | 1.78 mm [.070"] |
| 1-1/2 | 38.0 mm | 19.0 mm | 2.41 mm [.095"] |
| 2 | 51.0 mm | 25.4 mm | 2.79 mm [.110"] |
| 3 | 76.0 mm | 38.0 mm | 3.18 mm [.125"] |

**CORRECTION:** the actual standard range is **1/8" (recovered 1.6 mm) to 3" (recovered 38 mm)**, NOT the "1/16"–4"" the canon previously stated. Ratings (now primary-sourced): radiation cross-linked elastomeric System-25, −75 °C to +150 °C, min full-recovery 175 °C, min shrink 150 °C, flame-retarded, fluid-qualified (diesel @70 °C, hydraulic H515 @70 °C, lube oil @100 °C) + abrasion. **EXCEPTION:** the 1/8 and 3/16 sizes are NOT /16-spec-qualified per the catalog. (source: TE Connectivity / Raychem DR-25 datasheet, catalog 1654025, Corsa Technic mirror https://www.corsa-technic.com/productdata/DR-25-Specs.pdf ; RB Racing mirror https://www.rbracing-rsr.com/downloads/wiring_pdfs/dr-25_data_sheet.pdf)

6.8 **SCL / ATUM per-size tables** (AMS-DTL-23053/4). **SUBSTRATE CORRECTION:** SCL is **/4 CLASS 1** (not Class 2), rated **−55 °C to +110 °C continuous** (NOT the DR-25 −75/+150 envelope), UL-recognized 125 °C / 600 V, full-recovery 135 °C; dual-wall (semirigid crosslinked-polyolefin outer + meltable polyolefin encapsulant inner). Per-size (as-supplied → recovered, total wall, adhesive wall):

| Size | As-supplied | Recovered | Total wall | Adhesive wall |
|---|---|---|---|---|
| 1/8 | 3.2 mm | 0.6 mm | 0.96 mm [.038"] | 0.51 mm [.020"] |
| 3/16 | 4.7 mm | 1.5 mm | 1.09 mm [.043"] | 0.64 mm [.025"] |
| 1/4 | 6.4 mm | 2.0 mm | 1.19 mm [.047"] | 0.69 mm [.027"] |
| 3/8 | 9.5 mm | 3.4 mm | 1.27 mm [.050"] | 0.76 mm [.030"] |
| 1/2 | 12.7 mm | 5.0 mm | 1.39 mm [.055"] | 0.89 mm [.035"] |
| 3/4 | 19.1 mm | 8.0 mm | 1.65 mm [.065"] | 1.01 mm [.040"] |
| 1 | 25.4 mm | 10.2 mm | 1.90 mm [.075"] | 1.01 mm [.040"] |

The separate 3:1/4:1 "high-mismatch" product named parenthetically in §6 (**ATUM**) is **AMS-DTL-23053/4 CLASS 3**, same −55/+110 °C envelope; recovered-by-size (3:1 series): 9/3 = 9.0 → 3.0, 24/8 = 24.0 → 8.0, 40/13 = 40.0 → 13.0 mm (qualified sizes 3/1, 6/2, 12/4, 24/8, 40/13). (source: TE Connectivity / Raychem SCL datasheet, doc 1654049, ProWire mirror https://www.prowireusa.com/content/6596/Raychem%20SCL%20Datasheet.pdf ; ATUM datasheet cat. 9-1773447-9, Boersig mirror https://www.boersig.com/fileadmin/user_upload/Datenblatt_Produkte/te-connectivity-raychem-atum-datasheet-en.pdf)

6.9 **S03 SolderSleeve per-size table** (Raychem, **SAE-AS83519**; see §7.3). **CORRECTION:** the S03 shield terminator is governed by **SAE-AS83519** (formerly MIL-S-83519), **NOT M23053/18** — the PVDF material attribution is correct (radiation-crosslinked heat-shrinkable transparent PVDF, for joint inspectability, which is why it reads as "/18 PVDF"), but the governing spec is AS83519. Rated −55 °C to +150 °C (system max 150 °C), Sn63Pb37 solder, ROL1/RMA flux, thermochromic temp indicator, preinstalled ground lead = MIL-W-22759/32 min 150 mm. **Select by CABLE DIMENSIONS** (jacket OD max / shield OD min):

| PN | Jacket OD max (mm) | Shield OD min (mm) |
|---|---|---|
| S03-01 | 1.95 | 0.90 |
| S03-02 | 2.7 | 1.40 |
| S03-03 | 4.3 | 2.15 |
| S03-04 | 6.0 | 3.30 |
| S03-05 | 7.0 | 4.30 |

(source: TE Connectivity / Raychem SolderSleeve Shield Terminators, catalog 1654025 sec 8, Corsa Technic mirror https://www.corsa-technic.com/productdata/SoldersleeveShieldTerm-Specs.pdf)

---

## 7. Shielding & splice hardware (where solder is allowed)

7.1 **Shielded cable is required on: crank (CKP), cam (CMP), knock B1, knock B2, CAN, wideband O2, video.** (source: `docs/wiring/output/K5_EE_AUDIT.md:19` | source: `docs/wiring/chapters/05-build-manifest.md:26-28`)

7.2 **CAN is a twisted pair**, ≥ 33 twists/meter per SAE J1939, 120 Ω termination at each physical end. (source: `docs/wiring/chapters/appendix-g-diagram-requirements-spec.md:197,320,343`)

7.3 **The shield drain terminates in a Raychem S03 solder sleeve** (clear PVDF + internal fluxed solder preform, governed by **SAE-AS83519** — NOT M23053/18; the "/18" slash was a misattribution, corrected in §6.9) — the drain enters the side slot, the preform melts, the clear window confirms the joint wetted. This is the one place solder is doctrine, not error, because it must bond a fine drain wire to a shield braid. Select by cable dimensions per the §6.9 S03 table. (source: `docs/wiring/research/2026-05-21_milspec_heatshrink_protocols.md:116-120`; TE Connectivity / Raychem SolderSleeve Shield Terminators, catalog 1654025 sec 8 https://www.corsa-technic.com/productdata/SoldersleeveShieldTerm-Specs.pdf)

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

The K5 is Class 2 (source: `docs/wiring/chapters/appendix-g-diagram-requirements-spec.md:321`).

**Class definitions (sourced, matching A-620 §1.3 Classification):**
- **Class 1 — General Electronic Products:** function of the completed assembly is the requirement; typically short life cycle.
- **Class 2 — Dedicated Service Electronic Products (the K5):** continued performance + extended life required; uninterrupted service desired but not critical (industrial/commercial/computing/comms).
- **Class 3 — High-Performance / Harsh-Environment:** continued high-reliability / performance-on-demand critical; downtime intolerable; harsh environments (aerospace/medical/military/life-support).

The classes **match quality requirements to end-use; they are NOT a good/better/best ranking.** K5 = Class 2 confirmed. (Section locations per the official TOC: class defs = Ch. 1 §1.3; pull-force = Ch. 19 §19.7.2 Tables 19-11/19-12/19-13; crimp inspection = Ch. 5.) **CAVEAT:** verbatim §1.3 wording is paywalled — this is a sourced summary aligned to the public TOC, `pending paid-standard verification`. (source: Matric Group — IPC Class Definitions https://blog.matric.com/ipc-class-definitions-class-1-2-3-electronics ; section/table locations from IPC/WHMA-A-620C official TOC https://www.electronics.org/TOC/IPC-A-620C.pdf)

8.3 **Canonical gauge-indexed crimp pull-force table — MISLABEL CORRECTED.** **SUBSTRATE ERROR SURFACED:** the canon previously declared "canonical 16 AWG = 50 lbf." **That is a one-gauge mislabel.** In the UL 486 / A-620 crimp-secureness column, **50 lbf is the 14 AWG value; 16 AWG = 30 lbf.** The prior "Copy A is mil-spec-aligned and canonical" reconciliation propagated the 14-AWG number onto the 16-AWG row.

| AWG | A-620 min pull (lbf) — CORRECTED | Prior canon | Note |
|---|---|---|---|
| 22 | **8** | 8 | confirmed correct (Copy B's 10 was a shop round-number) |
| 20 | **13** | 13 | confirmed correct |
| 18 | **20** | (provisional) | now sourced (§8.4) |
| 16 | **30** | ~~50~~ | **CORRECTED — 50 was the 14-AWG value mislabeled** |
| 14 | **50** | (provisional) | now sourced; this is where the 50 lbf belongs |

(source: Checkline — Wire Pull Test Standards, UL 486 / MIL-T-7928 crimp-tensile columns https://www.checkline.com/res/products/126677/wire_pull_test_standards.pdf | prior copies: A `docs/wiring/research/2026-05-21_milspec_heatshrink_protocols.md:157`; B `docs/wiring/output/K5_harness_protection_catalog.md:627`; C `docs/wiring/research/2026-06-10_power_spine_builders_study.md:216`)

**SUPERSEDES (two corrections):**
1. The prior §8.3 "canonical 16 AWG = 50 lbf" → **16 AWG = 30 lbf**; the 50 lbf figure belongs to **14 AWG**.
2. `docs/wiring/output/K5_harness_protection_catalog.md:627` (was: "10 lb minimum for 22 AWG, 20 lb for 18 AWG, 30 lb for 14 AWG") — for 22 AWG the minimum is **8 lbf** not 10; 18 AWG = **20 lbf** (confirmed); the catalog's "30 lb for 14 AWG" is **wrong** — that 30 is the **16-AWG** value, and 14 AWG = 50 lbf.

**NOTE — flows downstream:** this also flows to Ch. 18 §7 "Crimp verification" and any Ch. 17 reference quoting "16 AWG ≥ 50 lbf" — those instances are likewise the **14-AWG value mislabeled as 16 AWG** and must be corrected the same way.

8.4 **Full per-AWG crimp pull-force minimum table (now sourced).** Copper crimps, UL 486 / MIL-T-7928 lineage that A-620's default table draws from:

| AWG | Min pull lbf [N] | AWG | Min pull lbf [N] |
|---|---|---|---|
| 30 | 1.5 [6.7] | 16 | 30 [133] |
| 28 | 2 [8.9] | 14 | 50 [222] |
| 26 | 3 [13.3] | 12 | 70 [311] |
| 24 | 5 [22.2] | 10 | 90 [400] * |
| 22 | 8 [35.6] | | |
| 20 | 13 [57.8] | | |
| 18 | 20 [89] | | |

\* UL 486 lists 10 AWG = 80 lbf; the A-620/Cloom reproduction lists 90 — the **only** cross-table delta. This fills the previously-provisional **18 AWG (= 20 lbf)** and **14 AWG (= 50 lbf)** rows.

**NORMATIVE FRAMING:** A-620's binding acceptance criterion is a **PERCENT of the wire's ultimate tensile strength** (~60 % baseline across classes, up to ~90 % for Class 3); the absolute lbf table (Tables 19-12/19-13) is the **DEFAULT applied "unless otherwise specified."** **CAVEAT:** values are from secondary reproductions consistent with the public TOC + UL 486/MIL-T-7928 lineage; tag as `sourced default, A-620 revision (B/C/D/E) unverified` — not verbatim-from-620C. The verbatim cell values of Tables 19-12/19-13 (and whether 19-13 assigns different absolute minimums per Class) remain `UNKNOWN — paid standard, character-for-character unconfirmed`. Do not fabricate beyond this table. (source: Cloom Tech — Wire Crimping Standards https://cloomtech.com/wire-crimping-standards/ ; %-of-tensile framing: SuperEngineer — IPC/WHMA-A-620 crimped terminations https://www.superengineer.net/blog/ipc-a-620-crimped-terminations ; lbf column lineage: Checkline UL 486 / MIL-T-7928 https://www.checkline.com/res/products/126677/wire_pull_test_standards.pdf)

8.5 **Tie/lace spacing** (A-620 workmanship, for completeness): tape/tie every **150 mm on the trunk, 75 mm on branches**. (source: `docs/wiring/chapters/appendix-g-diagram-requirements-spec.md:304`)

---

## 9. Corrections this chapter lands

9.1 **Concentric-twist direction — wires do NOT alternate.** Chapter 3's Ultra-tier description says concentric-twist construction uses "wires twisted in **alternating-direction** layers around a core wire." That is wrong. In concentric/twisted-bundle construction the conductors are laid **in the same direction at the same pitch** around the core; the lay does not reverse layer to layer. **SUPERSEDES:** `docs/wiring/chapters/03-tier-system.md:46` (was: "Concentric twist — wires twisted in alternating-direction layers around a core wire"). The correct statement: *concentric twist — conductors laid same-direction, same-pitch (same lay) around a central core wire, in successive layers.* (UNKNOWN — replacement rule pending external ingestion: HP Academy concentric-twist module or a MIL/SAE wire-construction standard. The 'alternating-direction' claim at 03-tier-system.md:46 is superseded regardless.)
> The K5 sits at **Professional tier** (parallel-bundle construction), not Ultra/concentric-twist, so this corrects a reference description rather than a build instruction. (source: `docs/wiring/chapters/03-tier-system.md:33-37` — "The K5 Blazer build is at this tier" [Professional])

9.2 The 4 AWG = "welding/marine" remnant is superseded by §1.6.

9.3 The 22 AWG = 10 lbf pull figure is superseded by §8.3 (correct = 8 lbf).

9.4 **REVERSAL — "/16 maxes at 2 AWG / 0 AWG /16 does not exist" is superseded by §1.4 and §4.1.** /16 spans 24 AWG through 2/0 (3 external sources); the cut-list 0 AWG /16 is **buildable in-spec**, not a defect.

9.5 **VERIFY-FAILED — the "135 A @ 4 AWG free-air" figure is superseded by §2.3.** The cited ProWire datasheet shows 72 A (35 °C-rise) at 4 AWG; replace 135 A wherever it appears.

9.6 **CORRECTION — the ABYC bundle-derate cascade (3/4-6/7-24 → −30/−40/−50 %) is superseded by §2.2 for DC.** ABYC DC = flat 0.7 (−30 %) past 24 in; the cascade is AC-only.

9.7 **MISLABEL — "canonical 16 AWG = 50 lbf" is superseded by §8.3.** 50 lbf = 14 AWG; 16 AWG = 30 lbf. Flows to Ch. 18 §7 and any Ch. 17 "16 AWG ≥ 50 lbf" reference.

9.8 **SLASH-NUMBER CORRECTIONS landed in §6:** SCL = /4 **Class 1** (−55/+110 °C), not Class 2 under the DR-25 envelope; S03 solder sleeve = **AS83519**, not M23053/18 (§6.9, §7.3).

> **Still open (per the workflow's `still_pending`, left UNKNOWN — not fabricated):** the positive concentric-twist replacement rule (§9.1); the literal 150 °C-absolute free-air ampacity base table (§2.3); single-conductor ampacity for 0 AWG/2/0 /16 (§4.3); verbatim /16-vs-/32 wall-thickness mils (§1.2); bulk /5,/15,/18 per-size tubing tables (§6); verbatim A-620 Table 19-12/19-13 cells + revision (§8.4); AS81765/1 Y-splice boot PNs (§7.4).
