# Chapter 17 — Power Architecture & ECU/PDM Canon

This chapter consolidates the power topology, overcurrent protection (OCP), and ECU/PDM integration rules for the K5. It is the grounding layer every future agent reads before producing any power-spine, fusing, or ECU/PDM lifeline wire. Each numbered atom ends with a citation. Where a fact is needed but not in our substrate, the atom is marked `(UNKNOWN — needs external ingestion: <spec>)` — no value is recalled from training data.

The spine math, routing, and sourcing live in the builder's study; this chapter is the doctrine distilled from it plus the ECU/PDM accounting. Read alongside `chapters/05-build-manifest.md` (signal types), `chapters/06-compute-engine.md` (ECU derivation), and `research/2026-06-10_power_spine_builders_study.md` (the spine spec table).

---

## 17.1 Protect the wire, not the device

1. A fuse protects **the wire**, not the device. It is sized above the load's draw and below the wire's damage point, so the only thing that opens it is a genuine fault. (source: `research/2026-06-10_power_spine_builders_study.md` §2.2)
2. The compute engine encodes this: non-PDM fuses are sized to the **next standard size above 125% of continuous load**, then checked against wire ampacity. (source: `chapters/06-compute-engine.md:73`)
3. The EE-audit's `fuse_coordination` check makes the rule bidirectional: fuse must be **≤ 85% of wire bundle ampacity** (so the wire never burns before the fuse opens) AND **≥ 125% of normal load** (so it doesn't nuisance-trip). Many K5 circuits currently fail the upper bound (e.g. `DASH-CIGLT-PWR` fuse 10A < 125% of 10A load = nuisance trips; `REAR-AMP-PWR` fuse 30A > 85% of 8 AWG's 32.2A derated ampacity = wire fails first). (source: `output/K5_EE_AUDIT.md:23-24`, `:51`, `:99-100`)
4. Ampacity is computed against the build's real conditions, not free-air tables: Tefzel M22759/32 @ 150°C insulation, **70% bundle derate, 70% engine-bay heat derate**. (source: `output/K5_EE_AUDIT.md:18`)

## 17.2 OCP placement — the 7/40/72 inch rule and the cranking exemption

1. There is no single "12–18 inch rule." The governing standard is **ABYC E-11**: OCP within **7 inches (175 mm)** of the battery terminal, extendable to **40 inches** if the cable is sheathed/enclosed the whole way, and to **72 inches** for certain battery connections, again only if sheathed (split loom, conduit, even spiral tape counts). (source: `research/2026-06-10_power_spine_builders_study.md` §2.1)
2. The car-audio competition variants (IASCA 18", older 14", a marine reg variant of 12") are conflations of the same physics — they are not the standard. (source: `research/2026-06-10_power_spine_builders_study.md` §2.1)
3. The cable between the battery post and the first fuse is the **only unprotected cable on the vehicle**. Nothing protects it but its insulation and your routing. Shorter is strictly better; sheathed and clamped is mandatory regardless of length. (source: `research/2026-06-10_power_spine_builders_study.md` §2.1)
4. **Working rule for the K5:** every fused branch gets its fuse within 7" of the distribution point if physically possible, never more than 18", and the unprotected stub is DR-25-sheathed and clamped. With the battery, disconnect, and fuse holders all clustered at the passenger firewall corner, 7" is achievable. (source: `research/2026-06-10_power_spine_builders_study.md` §2.1)

### The cranking-motor exemption — an allowed exception, NOT a prohibition

5. **The starter feed is unfused. This is correct, universal practice — not an oversight.** A fuse big enough to survive cranking inrush (hundreds of amps for a fraction of a second) is too big to protect the cable from anything short of a dead short. ABYC codifies this as the **"cranking motor conductor" exemption** — cranking circuits are exempt from the OCP distance requirement. (source: `research/2026-06-10_power_spine_builders_study.md` §2.2)
6. The exemption is not a free pass; it carries **compensating controls**: shortest possible run, no abrasion exposure, heat barrier where it passes the manifold, and a master disconnect that kills it. (source: `research/2026-06-10_power_spine_builders_study.md` §2.2, §1.4)
7. The build manifest's own "Direct-Wired" tables already encode the starter as relay-triggered, direct-battery, off-PDM — the starter (200A peak) exceeds any PDM channel. (source: `chapters/05-build-manifest.md:98`, `output/K5_pdm30_channel_plan.md:118`)
8. Every other always-hot branch IS fused: alternator charge cable, PDM30 supply, iBooster feed, fuel pump feed, amplifier feed. (source: `research/2026-06-10_power_spine_builders_study.md` §2.2)

### Fuse hardware selection (MEGA/MIDI)

9. **MEGA** (bolt-down, 100–500A, ~2,000A AIC, slow-blow curve tolerates motor inrush) is the standard for alternator and PDM feeds. **MIDI** (30–150A, same class) is right for the 40A iBooster and fuel-pump branches. (source: `research/2026-06-10_power_spine_builders_study.md` §2.3)
10. AIC ("interrupt capacity") is the largest fault current the fuse can break without arcing over; a fuse that can't break the fault current is decoration. The 1977 GM factory method was **fusible links** (wire 2–4 gauges under the protected cable); a modern bolt-down fuse supersedes it because it's inspectable and trailside-replaceable. Use MEGA/MIDI on this build. (source: `research/2026-06-10_power_spine_builders_study.md` §2.3)

## 17.3 Power topology — battery → isolator → distribution stud → PDM

1. The spine is the small set of fat cables that move real current: battery↔starter, battery↔alternator, battery↔PDM, battery↔iBooster, and the ground cables that carry it all back. Roughly a dozen cables. Everything else (162 signal/output wires) hangs off this spine, which is also where the fire risk lives. (source: `research/2026-06-10_power_spine_builders_study.md` intro)
2. Canonical chain, all hardware clustered at the battery (passenger firewall corner, owner-stated working position):

   ```
   BAT+ post ──(≤12", sheathed, clamped)── E-Stopp ESK001 ── distribution stud
                                                              ├── starter feed (UNFUSED)
                                                              ├── MEGA 125A → PDM30 stud
                                                              ├── MEGA (size TBD) → alternator
                                                              ├── MIDI 40A → iBooster
                                                              ├── MIDI 40A → fuel pump
                                                              └── MIDI 40-50A → amplifier
   ```
   (source: `research/2026-06-10_power_spine_builders_study.md` §2.4)
3. The battery→E-Stopp→stud stub is the **only unprotected cable**, kept under 18" total, sheathed and clamped. Everything downstream of the E-Stopp dies when it opens. (source: `research/2026-06-10_power_spine_builders_study.md` §2.4)

### The MoTeC isolator requirement

4. **MoTeC's hard rule:** battery positive must be connected via an isolator switch or relay, and "the isolator must isolate the battery from **all devices in the vehicle including the PDM, starter motor and alternator**." (source: `research/2026-06-10_power_spine_builders_study.md` §2.4, quoting MoTeC PDM User Manual battery-positive wiring)
5. The isolator must have **a secondary switch connected to a shutdown input on the ECU.** This exists because a spinning alternator can keep the system alive after the battery is cut; the ECU shutdown input kills the engine so the alternator stops generating. (source: `research/2026-06-10_power_spine_builders_study.md` §2.4)
6. The locked disconnect is the **E-Stopp ESK001**, triggered by a dash latching button (wire #126). Its position in the chain satisfies MoTeC's "isolate everything" clause; the secondary-contact-to-ECU-shutdown wiring is the open piece. (source: `K5_WIRING_STATE.md:38`, `research/2026-06-10_power_spine_builders_study.md` §2.4)
7. **VERIFY (UNKNOWN — needs external ingestion: E-Stopp ESK001 install sheet):** whether the ESK001 prefers the positive or negative line, and its stud size. (source: `research/2026-06-10_power_spine_builders_study.md` §2.4, §7 item 5)

## 17.4 Star grounding — single reference, no daisy chains

1. **Star grounding** = every major ground leg runs to one common reference (the battery negative post), never device-to-device daisy chains. The build encodes a three-leg star in `objectTraits.ts`. (source: `research/2026-06-10_power_spine_builders_study.md` §4)
2. **Power grounds and sensor 0V are separate systems.** Power-load returns go to the star; the ECU's sensor grounds (SEN_0V) return on their own dedicated pins and must not share the power-ground path. (source: `chapters/05-build-manifest.md:115-124`, `reference/motec/VALIDATION_REPORT.md:102-103`)
3. **STAR_BAT_ENG** (battery negative → engine block): carries the **entire starter return current**; the spec is "same as the starter positive cable," landed near the starter, never detouring through chassis. The trait's "min 4 AWG" is a floor, not the spec. (source: `research/2026-06-10_power_spine_builders_study.md` §4.1)
4. **STAR_BAT_CHASSIS** (battery negative → frame rail): carries only chassis-grounded accessory returns (lights, horn, body), so 4 AWG is proportionate; welded threaded boss within 12" of the battery per Holley/PSI practice. (source: `research/2026-06-10_power_spine_builders_study.md` §4.2)
5. **G3 cab strap** (engine head/block → firewall): the one strap that makes the rubber-isolated cab electrically alive; 8 AWG welding-cable-class. Missing G3 = no-start, swinging voltmeter, flickering dash. (source: `research/2026-06-10_power_spine_builders_study.md` §4.3)
6. ECM/sensor grounds land **direct on the block or head, never daisy-chained through chassis.** (source: `research/2026-06-10_power_spine_builders_study.md` §4.1, citing `objectTraits.ts` engine notes)
7. The PDM30's own ground reference returns separately: **both Batt− pins (A26, B18) go to battery negative in 2× 20 AWG** per MoTeC practice — it is itself a star leg, not chained off another. (source: `K5_WIRING_STATE.md:44`, `research/2026-06-10_power_spine_builders_study.md` §4.3, §6 row G4)

### SEN_0V letter-pairing rule

8. Each ECU sensor's pullup rail and its ground return must stay on the **same letter (A or B)** to minimize ground-loop voltage offset. The M130's AT inputs are hardwired: AT1 (B03) and AT2 (B04) pull up to SEN_5V_B → ground to B16 (SEN_0V_B); AT3 (B05) and AT4 (B06) pull up to SEN_5V_A → ground to B15 (SEN_0V_A). (source: `chapters/05-build-manifest.md:115-124`, `reference/motec/VALIDATION_REPORT.md:90-93`, `:183-188`)
9. The convention extends by builder choice to AV inputs and is already applied to the APS pedal: track 1 on SEN_5V_A/B15, track 2 on SEN_5V_B/B16, so one rail fault can't take both throttle tracks. (source: `chapters/05-build-manifest.md:124`, `K5_WIRING_STATE.md:46`)

## 17.5 The DC-primary spine — gauges and the 2-vs-0 AWG correction

1. The locked wire spec is **Tefzel only**: 12–22 AWG = M22759/32; 4–10 AWG = M22759/16. M22759/32 tops out at 12 AWG; /16 tops out at 4 AWG. There is no /16 above 4 AWG in this build's spec. (source: `K5_WIRING_STATE.md:21-23`)
2. **The parallel-conductor principle is Skylar's stated design rule:** high-power runs are built from **multiple skinny conductors of identical gauge and identical length in parallel**, not one fat slug — for bend radius, loom packaging, availability, and because under "ONLY TEFZEL" it's how the big cables get built at all (nothing above 4 AWG exists in the spec'd slash numbers). (source: `K5_WIRING_STATE.md:50`, `research/2026-06-10_power_spine_builders_study.md` §3.1)
3. **Equal length is non-negotiable.** Parallel wires divide current in inverse proportion to resistance; same gauge + same length + same termination = equal share. NEC 310.10 codifies the same-everything rule (same length, material, area, insulation, termination). The transferable content is the equal-everything rule, not building-wiring's 1/0 floor — aviation and motorsport parallel smaller gauges routinely. (source: `research/2026-06-10_power_spine_builders_study.md` §3.2)
4. **Bundled wires derate** (they keep each other warm). ABYC schedule: 3 bundled conductors −30%, 4–6 −40%, 7–24 −50%. Both legs of a parallel pair count as current-carrying; size a paralleled pair off the bundled column, not free-air. (source: `research/2026-06-10_power_spine_builders_study.md` §3.3)

### MEGA/MIDI selection per feed (the spine spec)

| Feed | Single cable | Parallel alternative | Fuse |
|------|--------------|----------------------|------|
| PDM30 supply | 4 AWG /16 (~135A free-air) | 2× 8 AWG /16 (~102A bundled worst-case — route solo or step to 2× 6) | **MEGA 125A** |
| iBooster (40A peak) | 8 AWG /16 (cut #52) | 2× 12 AWG /32 | **MIDI 40A** (matches Tesla) |
| Fuel pump (35A) | 8 AWG /16 (cut #66) | 2× 12 AWG /32 if loom OD demands | **MIDI 40A** |
| Amplifier (30A) | 8 AWG /16 (cut #32) | 2× 12 AWG /32 | **MIDI 40–50A** |

(source: `research/2026-06-10_power_spine_builders_study.md` §3.5, §6; `output/K5_pdm30_channel_plan.md:120-122`)

5. **MEGA 125A on the PDM feed** is chosen above the PDM's 100A worst-case so it never nuisance-blows, and below the cable damage threshold. (source: `research/2026-06-10_power_spine_builders_study.md` §3.5)

### The 2 AWG primaries correction (Dave's method)

6. **Dave runs 2 AWG primaries off the distribution stud, not 0 AWG.** (source: Dave / Desert Performance, verbal via Skylar, 2026-06-18 session) The cut list's "0 AWG M22759/16" rows for the starter, alternator, and disconnect cables (#6/#59/#63) are a **substrate inconsistency** — that gauge does not exist in the spec'd /16 slash number, which tops out at 4 AWG. (source: `research/2026-06-10_power_spine_builders_study.md` §3.1, §7 item 2; `K5_WIRING_STATE.md:50`) These are two different answers from two different sources — do not conflate them: the substrate-sourced alternative is the spine study's **parallel pattern** (2× 4 AWG /16 ≈ 1 AWG combined, or a sourced-and-approved 1/0-class Tefzel from another slash number with a spec amendment), while **Dave's 2 AWG single** is the builder's call for the brief crank-duty primaries. Present both; pick at mockup.
7. The EE-audit's two hard FAILs confirm the spine is undersized as currently stored: `PDM30_BAT+` and `PDM30_BAT-` at **2 AWG derate to 73.5A but require 150A** (104% over). The fix is the parallel pattern or a heavier sourced cable — re-derive at mockup. (source: `output/K5_EE_AUDIT.md:30-31`)
8. **Dave's build method governs all spine lengths:** calculate maximum distance first → prototype with one-color wire at max length → verify on vehicle → cut to size. No spine cable is cut from a computed length. (source: `K5_WIRING_STATE.md:51`)
9. **Re-derive battery-relative lengths before cutting.** L14/L15 in the digital twin were derived from a now-dead driver-front battery placeholder; the working position is the passenger firewall corner. Mirror-flip and re-derive in the Blender twin first. (source: `K5_WIRING_STATE.md:89`, `research/2026-06-10_power_spine_builders_study.md` §6, §7 item 1)

## 17.6 The ECU is derived, not chosen

1. **The ECU model is an OUTPUT of the I/O equation, not a decision.** The compute engine counts inputs/outputs by type, evaluates every MoTeC model against the requirement, and reports fit/headroom/bottleneck. The devices define the I/O; the I/O defines the ECU. (source: `chapters/06-compute-engine.md:28-44`)
2. **M130 capacity:** 8 injector, 8 ignition, 6 half-bridge, 9 analog, 4 temp, 8 digital, 1 CAN. M150: 12/12/10/17/6/16/3. M1: 16/16/16/24/8/24/4. (source: `chapters/06-compute-engine.md:31-35`)
3. **M130 fits this build** (8 inj + 8 ign + 4 digital used vs 8/8/7 capacity), saving $2,000 over the M150. (source: `chapters/06-compute-engine.md:42`, `chapters/appendix-d-k5-build.md:54`, `K5_WIRING_STATE.md:63`)
4. **The M130 discovery — signal-type classification IS ECU selection.** Originally all 20 switches were classed generic `switch` → counted as 20 digital inputs → exceeded M130's 7 → system wrongly recommended M150 ($5,500). Corrected: only 4 actually hit ECU digital pins (brake, AC pressure ×2, VSS); the rest are PDM inputs (9), standalone switches (4), standalone module (1), crank/cam (2). After correction 4 ≤ 7 → M130 fits → $2,000 saved. **Misclassifying a signal type costs money.** (source: `chapters/05-build-manifest.md:66-74`)

### Signal-type → wire-count expansion

5. Wire count is **not** one wire per circuit; it derives from the signal type. The expansion rules:

   | Signal type | Wire count | What the wires are |
   |-------------|-----------|--------------------|
   | `analog_5v` | 3 | 5V reference + signal + ground |
   | `analog_temp` | 2 | thermistor signal + ground |
   | `low_side_drive` | 2 | drive + power companion |
   | `logic_coil_drive` | 4 | coil driver bundle |

   (source: `chapters/05-build-manifest.md:21-31`)
6. Companion wires get explicit IDs (suffix `g` = sensor ground, `r` = 5V ref, `s` = shield drain) so terminal counts and routing stay accurate; they are not implicit. (source: `chapters/05-build-manifest.md:105-113`)

### M130 current-rating correction (silicon limit ≠ rated output)

7. **SUPERSEDES — wire injector/ignition sizing to the rated output, not the silicon limit.** The DB stores `max_current_amps = 12A` for M130 INJ_LS, IGN_LS, and INJ_PH, but the official spec is **INJ_LS / IGN_LS 3.5A** (open-collector) and **INJ_PH 8A peak / 4A hold / 2A RMS**. The 12A is the half-bridge driver's absolute silicon limit applied broadly, not the rated operating max; sizing wire to 12A is a documented safety concern. (source: `reference/motec/VALIDATION_REPORT.md:125-127`, `:334-348`, `:450-452`)

## 17.7 ECU lifelines — the wires without which the ECU never boots

1. **The ECU needs power and ground to exist before it can do anything.** Cut list v4 had NO M130 power/ground wires — the ECU could never power on. The lifelines were added in v4.1. (source: `K5_WIRING_STATE.md:44`)
2. **#ECU_PWR → A26 (BAT_POS), 16 AWG** — Superseal cavity max gauge. A26 is the M130's main power-supply pin. (source: `K5_WIRING_STATE.md:44`, `reference/motec/VALIDATION_REPORT.md:72`)
3. **#ECU_GND1 → A10 (BAT_NEG1) and #ECU_GND2 → A11 (BAT_NEG2), 2× 16 AWG, equal length.** Both battery-negative pins must be grounded; they are a deliberate dual-equal-length pair. (source: `K5_WIRING_STATE.md:44`, `reference/motec/VALIDATION_REPORT.md:56-57`)
4. **There is NO #ECU_IGNSW / wake pin.** The M130 has no ignition or wake input pin (techspec pp.16-18); wake is done by **switched BAT_POS upstream**. The switching element is an open decision. Do not invent an ignition pin. (source: `K5_WIRING_STATE.md:44`)
5. The PDM30 battery feed lands the same turn: **#PDM_BPOS → M6 stud** (0 AWG single OR 2× 4 AWG parallel — Skylar's open pick), **#PDM_GND1/2 → A26/B18, 2× 20 AWG** per PDM manual p.5. (source: `K5_WIRING_STATE.md:44`)
6. The engine-start-minimum config treats these lifelines as the first wires built: "battery, ECU, PDM and the essential pinout so we can turn on the engine." (source: `K5_WIRING_STATE.md:45`, `:89`)

## 17.8 PDM software-fusing channel budget

1. The PDM30 is **software-fused**: each output's over-current shutdown is programmable in 1A steps; there are no physical fuses on PDM-switched loads. 20A outputs are 20A continuous / 115A transient; 8A outputs are 8A continuous / 60A transient; all outputs are high-side type. (source: `reference/motec/VALIDATION_REPORT.md:457-460`)
2. **Channel budget is 30/30 — full, zero headroom.** 8 of 8 20A outputs used; 22 of 22 8A outputs used; 16 of 16 digital inputs used. Adding any device requires PDM15 expansion or further load grouping. (source: `output/K5_pdm30_channel_plan.md:33`, `:64-65`, `:107`; `chapters/appendix-d-k5-build.md:56`)
3. The 30/30 fit is achieved by **grouping small loads that share a switch position** onto single channels (markers_clearance, park_tail, interior_courtesy, backup, etc.). Without grouping, 47 PDM loads would overflow 30 channels. (source: `chapters/05-build-manifest.md:76-90`, `output/K5_pdm30_channel_plan.md:11`)
4. **PDM total output ceiling = 100A continuous** (validated datasheet figure; the DB stores a conservative 80A). The C01 VBATT+ stud is M6, fed at 6 AWG ("16 mm² (6#) or 25 mm² (4#)" per the user manual). (source: `reference/motec/VALIDATION_REPORT.md:316`, `:462`, `:302`, `:326`)

### Direct-wired vs PDM-switched partition

5. A load goes **direct-wired (off-PDM)** if it exceeds a PDM channel rating or is itself power infrastructure:

   | Device | Why not PDM | Wire # |
   |--------|-------------|--------|
   | Alternator (220A) | IS the power source | #59 |
   | Starter (200A peak) | exceeds any channel | #6 |
   | Battery disconnect (190A) | IS the master switch | #63 |
   | Fuel pump (35A) | exceeds 20A channel max | #66 |
   | iBooster (40A peak) | exceeds 20A channel max | #52 |
   | Amplifier (30A) | exceeds 20A channel max | #32 |
   | All sensors | powered from ECU 5V ref | — |
   | Injectors + coils | ECU low-side / PDM rail | #5–#24 |

   (source: `output/K5_pdm30_channel_plan.md:115-125`, `chapters/05-build-manifest.md:92-103`)
6. Direct-wired feeds carry an **inline fuse** (MEGA/MIDI per §17.2); PDM-switched loads carry **none** (the PDM is the fuse). The Dakota Digital gauge is a third case — it taps the PDM **ignition rail** (a switched power rail, not a channel), so it consumes no output channel. (source: `output/K5_pdm30_channel_plan.md:125`, `:139`)
7. PDM **input wires** (DIG1–16) are switch-to-ground: each switch connects between a DIG pin and GND_0V (A28 or B22), with the 10K pullup to Batt+ internal. They are inputs that tell the PDM what to do, distinct from output channels. (source: `output/K5_pdm30_channel_plan.md:86`, `:90-105`)

## 17.9 Harness segmentation — engine vs body, and the firewall crossing rule

1. The harness splits into **engine harness vs body harness**; the boundary location and physical join method (grommet, bulkhead connector, or service split) were open architectural questions until the firewall bulkhead was confirmed. (source: `K5_WIRING_STATE.md:67-68`)
2. **The firewall bulkhead is a D38999 61-way connector, CONFIRMED** (receptacle D38999/24WJ61SN + plug D38999/26WJ61PN, insert 25-61, M39029 #20 contacts). (source: `K5_WIRING_STATE.md:43`)
3. **The #20-only rule:** the D38999 takes **20–24 AWG contacts only.** Only signals and CAN cross the bulkhead through this connector. **Power and ground cables do NOT** — they are far heavier than #20 and take their own grommet/stud pass-through. (source: `K5_WIRING_STATE.md:43`)
4. **Generalize Dave's "engine-only connector" correction:** the firewall crossing is the boundary for *signals*; fat cables (starter feed, alternator charge, PDM supply, block ground, cab strap) cross the firewall via dedicated sealed pass-throughs and studs, never through the signal bulkhead. This keeps the spine off the signal connector and respects the §17.2 sheathing rule on the unprotected stub. (source: `research/2026-06-10_power_spine_builders_study.md` §1.2, §2.4; `K5_WIRING_STATE.md:43`)
5. The D38999 is at capacity with **8 wires overflowing** (OPS/FPS companions, #100, #60, #114/#115); resolution (rail consolidation vs second bulkhead vs grommet) is an open Skylar call. If the M130 mounts engine-bay side, the 6 APS bulkhead crossings push the overflow further. (source: `K5_WIRING_STATE.md:43`, `:46`)
6. Every cable landing on the engine must cross the chassis-to-engine gap with a **service loop** so flexing happens in open cable, not at a lug; the engine rocks on its mounts, the chassis does not. (source: `research/2026-06-10_power_spine_builders_study.md` §1.4)

## 17.10 Construction note — concentric twist is same-direction (correction)

1. **Concentric-twist construction (Ultra tier) lays each layer in the SAME direction at the SAME pitch around the core — the layers do NOT alternate twist direction.** Alternating direction would unbalance the lay and is not what HPA concentric-twist practice specifies. The documentable layup standards are HPA concentric-twist practice + MIL-W-22759/44 + DR-25 materials. (UNKNOWN — replacement rule pending external ingestion: HP Academy concentric-twist module or a MIL/SAE wire-construction standard)

   SUPERSEDES: `chapters/03-tier-system.md:46` (was: "Concentric twist — wires twisted in alternating-direction layers around a core wire")

2. The K5 is built at the mil-spec end but uses **Tefzel M22759/32 + DR-25**, not Spec 55 — do not lecture in Spec 55 terms; the substrate is Tefzel. (source: `K5_WIRING_STATE.md:108`)

---

## 17.11 Open items rolled up from this chapter

1. Re-derive L14/L15-class battery-relative lengths in the digital twin (passenger firewall corner), check hood-hinge travel over the tray. (source: `research/2026-06-10_power_spine_builders_study.md` §7 item 1, `K5_WIRING_STATE.md:89`)
2. Big-cable sourcing decision: 1/0-class Tefzel (spec amendment) vs parallel 2× 4 AWG /16 for the spine primaries; fix the "0 AWG /16" cut-list rows (#6/#59/#63). (source: `research/2026-06-10_power_spine_builders_study.md` §7 item 2)
3. **Alternator PN** (CVF Racing drive, low driver-side) — unblocks the alternator-feed gauge and MEGA fuse rating. (UNKNOWN — needs external ingestion: CVF Racing alternator part number / rated output) (source: `research/2026-06-10_power_spine_builders_study.md` §7 item 3, `K5_WIRING_STATE.md:92`)
4. **Starter PN** — confirms cranking figures behind the unfused exemption. (UNKNOWN — needs external ingestion: LS3 starter motor part number / cranking current) (source: `research/2026-06-10_power_spine_builders_study.md` §7 item 4)
5. **E-Stopp ESK001 install sheet** — positive-vs-negative line, stud sizes, secondary-contact wiring to the ECU shutdown input. (UNKNOWN — needs external ingestion: E-Stopp ESK001 instructions) (source: `research/2026-06-10_power_spine_builders_study.md` §7 item 5, §2.4)
6. PDM30 under-dash ventilation + 30-min CAN heat-soak validation before the PDM supply routing is final. (source: `K5_WIRING_STATE.md:88`, `research/2026-06-10_power_spine_builders_study.md` §7 item 6)
7. The ECU wake/ignition switching element (switched BAT_POS upstream of A26) — open decision. (source: `K5_WIRING_STATE.md:44`)
8. D38999 8-wire overflow resolution (rail consolidation vs 2nd bulkhead vs grommet) — open Skylar call. (source: `K5_WIRING_STATE.md:43`)
