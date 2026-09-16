# The Power Spine — Builder's Study

**Date:** 2026-06-10 · research receipt (`change_type: research`)
**Vehicle:** 1977 K5 Blazer · LS3 · MoTeC M130 + PDM30 · battery at **passenger firewall corner** (owner's stated position — closes open unknown A4 in `K5_landmarks_blender_derived.yaml`; state-file §4 update + receipt still owed)
**Status:** Workshop reference, written from published motorsport / marine / aircraft practice. Every external claim is sourced in §8. Every number that came from this build's own substrate cites the file. Anything not nailed down is marked **VERIFY** — there are no silent guesses in here.

**What this document is:** the "power spine" is the small set of fat cables that move real current — battery to starter, battery to alternator, battery to the PDM, battery to the iBooster, and the ground cables that carry all of it back. Maybe a dozen cables total. Everything else on the truck (162 signal and output wires) hangs off this spine. The spine is also where the real fire risk lives, which is why pros treat it with different rules than signal wiring.

**How to read it:** §1–§5 are the practice — what professional builders actually do and why. §6 is the K5-specific spec table you can build from. §7 is the open list. Terms are defined the first time they appear; after that they're used bare.

---

## §1. Battery at the passenger firewall corner — getting cables out of it

### 1.1 Why this location is actually good

The factory put square-body batteries on the passenger side at the front (core support area). The owner's position — passenger side, but back at the firewall corner — is non-factory, and for THIS build it's a strong choice, because three of the biggest loads cluster right there:

- **The starter is on the passenger side of an LS engine**, low on the block at the rear (bellhousing end). From the passenger firewall corner that's a short drop-and-forward run instead of the 68.7" cross-bay run the digital twin derived from the old driver-front placeholder (`K5_landmarks_blender_derived.yaml` L15 — flagged there as "flips if passenger wins").
- **The PDM30 lives under the dash on the passenger side** (`K5_landmarks_blender_derived.yaml` A2). Its supply cable goes through the firewall inches from the battery. Short fat cable = less voltage drop, less unprotected length, less money.
- **The firewall main grommet/bulkhead zone (FWG-MAIN, factory hole H3) is passenger side** (`objectTraits.ts`).

The cost: the **alternator is low on the DRIVER side** on this truck's CVF accessory drive (`research/2026-06-09_design-inputs-recon.md` §B), so the charge cable becomes the long run instead of the starter cable. That's the right trade — the charge cable carries less current than the starter cable and is fused, so it's the safer one to make long.

### 1.2 The two routing schools, and which applies where

For getting a fat cable from one corner of an engine bay to another, builders use two routes:

**Along-frame:** drop the cable down the inner fender to the frame rail, run it along the rail (inside the C-channel where possible — the channel is free armor), come back up near the target. This is the desert/trophy-truck default for anything going to the back of the vehicle, because the frame is the stiffest, coolest, most protected real estate on the truck. The K5 substrate already uses this doctrine — the driver-side rail carries the rear loom, clipped to the inside surface (`objectTraits.ts` frame-rail notes).

**Over-firewall:** run the cable along the top of the firewall shelf / cowl lip, secured to the sheet metal. This is the hot-rod default for side-to-side runs in the bay, because it's short, visible, serviceable, and stays away from exhaust heat and driveline movement.

**Applied to this battery position:**

| Run | Route | Why |
|---|---|---|
| Battery → starter | Down the inner fender / firewall corner, short forward run high on the block side | Short; but it passes the **passenger exhaust manifold** — see heat note below |
| Battery → alternator (driver low front) | **Over-firewall** along the cowl lip, then down the driver inner fender to the alternator | Stays out of the fan, steering, and exhaust zones; serviceable; the under-engine shortcut is forbidden territory (heat + moving parts) |
| Battery → PDM30 | **Straight through the firewall** at the corner, sealed pass-through | Inches away; this is the payoff of the battery location |
| Battery → iBooster (driver firewall) | Over-firewall along the cowl lip | Same logic as the alternator run; they can share clamps for most of the distance |
| Battery → fuel pump / rear loads | Down to the frame rail, along the rail rearward | Frame doctrine, already established for the rear loom |

### 1.3 Clamp spacing — the actual numbers

"Secure it well" has published numbers:

- **ABYC E-11** (the American Boat & Yacht Council marine electrical standard — the closest thing the 12-volt world has to a building code) requires conductors be **supported continuously or secured at intervals not exceeding 18 inches (455 mm)** ([Direct Current Boatworks ABYC summary](https://directcurrentboatworks.com/blogs/safety/abyc-marine-safety-standards), [ToolGrit ABYC DC wiring guide](https://www.toolgrit.com/guides/abyc-marine-dc-wiring)).
- **FAA AC 43.13-1B** (the aircraft maintenance standard the mil-spec harness world borrows from) uses **24 inches as the usual maximum between supports**, less where vibration or load demands it ([AC 43.13-1B Ch. 11](https://www.faa.gov/documentlibrary/media/advisory_circular/ac_43.13-1b_w-chg1.pdf)).

Use 18" as the working number on this truck; tighten to ~12" near the exhaust crossing and at direction changes.

**Clamp type:** cushioned loop clamps — a metal P-shaped strap lined with rubber, called an **Adel clamp** in aircraft work (MS21919 is the mil part family). ABYC's version of the rule: non-metallic clamps are fine in benign zones but **not over the engine, moving shafts, or anywhere failure drops a cable into danger** — those zones get lined metal clamps; and **wherever a metal clamp touches the cable, the cable gets a wrap of loom or tape under the clamp** ([Direct Current Boatworks](https://directcurrentboatworks.com/blogs/safety/abyc-marine-safety-standards)). Translation for this bay: zip ties are acceptable on the cowl lip; everything near the engine and frame gets rubber-lined metal clamps on welded or bolted tabs.

### 1.4 Abrasion points specific to this layout

Walk the route and armor these (abrasion = the cable sawing its insulation open against an edge over thousands of vibration cycles — the #1 killer of relocated-battery installs):

1. **The hood hinge.** Square-body hood hinges sit exactly at the firewall corners. The hinge scissors through a big arc right above the proposed battery. Check the full hinge travel envelope before finalizing tray height and cable dress. **VERIFY on truck.**
2. **Every sheet-metal pass-through gets a grommet** (a rubber ring that converts a sharp punched edge into a smooth bore). Zero grommets are currently fitted anywhere on the firewall (`research/2026-06-09_design-inputs-recon.md` §B) — nothing is committed wrong yet.
3. **Frame rail lips and body-mount brackets** on the rail run rearward — clamp the cable so it cannot touch an edge even at full flex; sleeve it in DR-25 through those zones (DR-25 is the semi-rigid abrasion- and fluid-rated heat-shrink jacket already spec'd build-wide — `research/2026-05-21_milspec_heatshrink_protocols.md` §2).
4. **The passenger exhaust manifold/header on the starter run.** The build's own trait table says headers reach 800°F+ and wires need 1" minimum clearance plus DR-25 when crossing (`objectTraits.ts` engine notes). For the starter cable add reflective heat barrier sleeve where it's within a few inches of the manifold, and clamp it so it cannot sag toward the pipe.
5. **Engine movement.** The engine rocks on its rubber mounts; the chassis doesn't move with it. **Every cable that lands on the engine (starter feed, block ground) must cross the chassis-to-engine gap with a deliberate slack loop** — a service loop — so the flexing happens in open cable, not at a lug. RB Racing's harness guide treats service loops as mandatory on engine-bound runs ([RB Racing ECU wiring guide](https://www.rbracing-rsr.com/wiring_ecu.html)).

---

## §2. Main fusing — what the "12–18 inch rule" actually is

### 2.1 The rule, de-mythologized

There is no single standard called "the 12–18 inch rule." It's a conflation of three real ones:

| Source | The actual rule |
|---|---|
| **ABYC E-11** (marine) | Overcurrent protection (a fuse or breaker — "OCP" from here on) within **7 inches (175 mm)** of the battery terminal. Extendable to **40 inches** if the cable is sheathed/enclosed the whole way, and to **72 inches** for certain battery connections, again only if sheathed (split loom, conduit, even spiral tape counts as sheathing) ([Marine How To — Battery Banks & OCP](https://marinehowto.com/battery-banks-over-current-protection/), [PKYS ABYC E-11.10 summary](https://shop.pkys.com/abyc-overcurrent-protection-summary)) |
| **IASCA / car-audio competition rules** | Main fuse within **18 inches** of the battery (older editions said 14"); one widely-cited marine safety reg variant says 12" ([the12volt.com installer forum](https://www.the12volt.com/installbay/forum_posts.asp?tid=108159)) |
| **The physics** | The cable between the battery post and the fuse is the only unprotected cable on the vehicle. Nothing protects it but its insulation and your routing. Shorter is strictly better; sheathed and clamped is mandatory ([BestCarAudio on battery fuses](https://www.bestcaraudio.com/car-audio-battery-fuse-size-and-purpose/)) |

**Working rule for the K5:** every fused branch gets its fuse within 7" of the distribution point if physically possible, never more than 18", and the unprotected stub is DR-25-sheathed and clamped regardless. With the battery, disconnect, and fuse holders all at the firewall corner, 7" is achievable.

### 2.2 What gets fused, and the one thing that doesn't

A fuse exists to protect **the wire**, not the device. It's sized above the load's draw and below the wire's damage point, so the only thing that opens it is a genuine fault.

- **Fused:** alternator charge cable, PDM30 supply, iBooster feed, fuel pump feed, amplifier feed — every always-hot branch off the battery.
- **NOT fused: the starter feed.** This is universal practice across automotive, hot-rod, and marine. Two reasons: a fuse big enough to survive cranking inrush (hundreds of amps for a fraction of a second) is too big to protect the cable from anything short of a dead short; and a century of unfused starter circuits has shown the failure mode it would guard against is managed by routing and the master disconnect instead ([YBW forum engineering discussion](https://forums.ybw.com/threads/fuse-for-starter-cable.502163/), [GT40s alternator/starter fusing thread](https://www.gt40s.com/threads/alternator-starter-fuse-question.57369/)). **ABYC codifies this as the "cranking motor conductor" exemption** — cranking circuits are exempt from the OCP distance requirement ([Marine How To](https://marinehowto.com/battery-banks-over-current-protection/)). The compensating controls are: shortest possible run, no abrasion exposure, and a disconnect that kills it.

### 2.3 Fuse hardware — which big fuse

The big-cable fuse families, by interrupt capacity ("AIC" — the largest fault current the fuse can break without arcing over or exploding; a fuse that can't break the fault current is decoration):

| Type | AIC | Builder's read |
|---|---|---|
| **MEGA** (bolt-down, 100–500 A) | ~2,000 A | The hot-rod and OEM standard for alternator and PDM feeds; slow-blow curve tolerates motor inrush ([Marine How To](https://marinehowto.com/battery-banks-over-current-protection/), [Hot Rod Forum](https://www.hotrodders.com/threads/adding-a-main-fuse-or-breaker-at-the-battery.547750/)) |
| **MIDI** (MEGA's little brother, 30–150 A) | similar class | Right size for the 40 A iBooster and fuel pump branches |
| **ANL** | ~6,000 A | Car-audio staple; fine, bulkier holders |
| **MRBF** (bolts directly to the battery post) | 10,000 A @ 14 V | The cleanest way to get OCP at literally zero inches; worth considering for the branch stub |
| **Class T** | 20,000 A | Overkill for a flooded/AGM auto battery; the lithium-bank fuse |
| **Fusible link** (a short length of wire 2–4 gauge sizes smaller than the cable it protects, in special slow-burning insulation) | n/a | The 1977 GM factory method — GM used links two sizes under the protected wire ([GM-Trucks.com Ask the GM Technician](https://www.gm-trucks.com/forums/topic/85910-fusible-link/)). Period-correct, but a modern bolt-down fuse is inspectable, replaceable trailside, and doesn't burn insulation to operate. Use MEGA/MIDI on this build |

### 2.4 Disconnect placement (the E-Stopp)

The build already locked an E-Stopp ESK001 remote battery disconnect with a dash latching button (wire #126, `K5_WIRING_STATE.md` §1, 2026-05-14). Where it sits in the chain matters, and MoTeC has an explicit requirement:

> "Battery positive must generally be connected via an isolator switch or relay. The isolator must isolate the battery from **all devices in the vehicle including the PDM, starter motor and alternator**" — and the isolator should have "a secondary switch that is connected to a shutdown input on the ECU" ([MoTeC PDM User Manual, battery positive wiring](https://www.manualsdir.com/manuals/322364/motec-pdm30-pdm15-pdm32-pdm16.html?page=7)).

The secondary-switch clause exists because a spinning alternator can keep the system alive after the battery is cut; the ECU shutdown input kills the engine so the alternator stops generating. The 2026-06-09 recon already flagged this same requirement (`research/2026-06-09_design-inputs-recon.md` §D2).

**Resulting chain, all hardware clustered at the battery:**

```
BAT+ post ──(≤12", sheathed, clamped)── E-Stopp ESK001 ── distribution stud
                                                            ├── starter feed (UNFUSED)
                                                            ├── MEGA 125A → PDM30 stud
                                                            ├── MEGA (size TBD) → alternator   [charge return path]
                                                            ├── MIDI 40A → iBooster
                                                            ├── MIDI 40A → fuel pump
                                                            └── MIDI 40-50A → amplifier
```

Everything downstream dies when the E-Stopp opens — satisfying MoTeC — and every branch except the starter is fused within inches of the stud. The battery→E-Stopp→stud stub is the only unprotected cable, kept under 18" total, sheathed and clamped per §2.1. **VERIFY:** E-Stopp's own instructions for whether it prefers the positive or negative line and its stud size; wire it per its sheet.

---

## §3. The parallel conductor pattern — what Skylar saw at Dave's

### 3.1 What it is and why pros do it

Instead of one fat cable, run **N smaller wires of identical gauge and identical length, terminated identically at both ends**, sharing the current. What it buys:

- **Bend radius.** A fat cable fights you at every corner; small wires drape. A single 4 AWG Tefzel cable is ~7 mm OD and wants gentle sweeps; a pair of 8 AWG at ~4.5 mm each will follow the harness around corners the 4 AWG can't make without bulging the loom. (ODs approximate from supplier data — **VERIFY against ProWire's datasheet when ordering**.)
- **Loom packaging.** Two small wires nest into a round bundle cross-section; one fat wire forces the whole loom OD up and prints through the DR-25 jacket.
- **Availability.** This build's locked wire spec tops out at 4 AWG: M22759/32 covers 12–22 AWG, M22759/16 covers 4–10 AWG (`K5_WIRING_STATE.md` §1; `research/2026-05-21_milspec_heatshrink_protocols.md` §1). The cut list currently shows "0 AWG M22759/16" for the starter, alternator, and disconnect cables (`K5_cut_list_v4.txt` #6/#59/#63) — **a substrate inconsistency: that size doesn't exist in the spec'd slash number per this build's own docs.** So for the K5 the parallel pattern isn't just a packaging trick — under the "ONLY TEFZEL" rule it's how the big cables get built at all, unless 1/0-class Tefzel from another slash number is sourced and approved.
- **It's factory-blessed in this ecosystem.** MoTeC's own PDM16/PDM32 take battery supply through multi-pin Autosport connectors — many small pins in parallel — rather than one lug ([MoTeC PDM manual](https://www.motec.com.au/hessian/uploads/PDM_User_Manual_3a926f869d.pdf)). HPA's instructors call breaking a large gauge into multiple smaller wires "perfectly acceptable," with the math below ([HPA forum — calculating parallel wire counts](https://www.hpacademy.com/forum/practical-motorsport-cad-design/show/calculating-how-many-smaller-gauge-wires-are-required-to-make-up-for-a-larger-size-gauge-wire/)). RB Racing publishes a parallel-splice diameter calculator as a standard harness construction tool ([RB Racing parallel splices](https://www.rbracing-rsr.com/22759_parallel_splices.html)).

### 3.2 The current-sharing rule (why equal length is non-negotiable)

Parallel wires divide current in inverse proportion to their resistance. Same gauge + same length + same termination = same resistance = equal share. Make one leg shorter and it takes more than its share, runs hotter, and its resistance protection margin erodes first.

The formal codification is the National Electrical Code: **NEC 310.10 requires paralleled conductors to be the same length, same material, same circular-mil area, same insulation, and "terminated in the same manner"** — explicitly so "each conductor in the parallel set will carry the same amount of current" ([EC&M on NEC paralleling](https://www.ecmweb.com/national-electrical-code/qa/article/21260929/stumped-by-the-code-nec-requirements-paralleling-of-conductors), [Electrical Contractor Magazine](https://www.ecmag.com/magazine/articles/article-detail/codes-standards-conductors-connected-parallel-each-set-must-have-same-electrical)). Note the NEC also restricts paralleling to 1/0 AWG and larger — but that's building-wiring jurisdiction, written so unequal sharing can't overload branch circuits behind walls. Vehicles aren't NEC territory; aviation and motorsport parallel smaller gauges routinely (RB Racing, HPA, MoTeC above). **The engineering content that transfers is the equal-everything rule, not the 1/0 floor.**

ABYC's blessing is at the terminal: multiple conductors may land in one terminal **provided the combined circular mils don't exceed the terminal's capacity, and the joint passes the E-11 pull test** ([BoatHowTo ABYC ampacity guide](https://boathowto.com/electrics/abyc-ampacity-tables/), [West Marine ABYC practices](https://www.westmarine.com/west-advisor/Marine-Wire-Terminal-Tech-Specs.html)).

### 3.3 The sizing math (and the derate that comes with bundling)

Two ways to size a parallel set, per the HPA thread above:

1. **Cross-section:** N wires whose summed copper area ≥ the single cable's area. (4 AWG = 21.2 mm²; 8 AWG = 8.37 mm²; 10 AWG = 5.26 mm²; 12 AWG = 3.31 mm².)
2. **Ampacity** ("ampacity" = the current a wire can carry continuously without its insulation exceeding rated temperature): N × (one wire's ampacity) ≥ the load. Ampacity doesn't scale linearly with area — small wires shed heat better per unit copper — so this method usually needs fewer wires than the area method. Use whichever gives MORE copper when the run is long (voltage drop scales with area, not ampacity).

**The catch — bundled wires derate.** Ampacity tables assume a wire in free air. Wires bundled together keep each other warm. ABYC's derate schedule: **3 bundled current-carrying conductors → −30%; 4–6 → −40%; 7–24 → −50%** ([BoatHowTo ABYC ampacity tables](https://boathowto.com/electrics/abyc-ampacity-tables/)). Both legs of a parallel pair count as current-carrying, and so does everything else in the same loom. A parallel pair inside the main harness bundle should be sized off the bundled column of the ampacity table, not the free-air column.

### 3.4 Where the parallel legs consolidate

The set has to become one termination at each end. In descending order of preference for power-spine gauges:

1. **Both/all legs crimped into one lug barrel** (a "lug" = a closed-barrel ring terminal for big cable, crimped then bolted to a stud). Legal per the ABYC combined-circular-mils + pull-test rule (§3.2). Cleanest: zero extra joints. Pick the lug barrel size for the COMBINED area — e.g., two 8 AWG legs ≈ 16.7 mm² → a 6 AWG-barrel lug. Hex-crimp it (see §5).
2. **Crimped parallel splice band** (an open tinned-copper sleeve crimped over the joined conductors — RB Racing uses Molex parallel splices, crimped with a Rennsteig PEW9-class tool, then sealed under adhesive-lined shrink). RB Racing prefers parallel splices over butt splices because "they are shorter and provide better strain relief" ([RB Racing parallel splices](https://www.rbracing-rsr.com/22759_parallel_splices.html)). Use mid-run only when geometry forces a transition.
3. **Solder sleeves are NOT for this.** Solder sleeves (the clear shrink tubes with a solder ring inside) are shield-drain and small-gauge hardware — the S03 size range stops far below power gauges (`research/2026-05-21_milspec_heatshrink_protocols.md` §5). The heat needed to wet 8 AWG would cook the sleeve. Crimp the spine, always — same doctrine as RB Racing's "do not solder, crimp" rule for the rest of the harness ([RB Racing ECU wiring](https://www.rbracing-rsr.com/wiring_ecu.html)).

**Honest counterpoint from the pros:** when nothing constrains you, one cable is still simpler — fewer joints, fewer failure points. The HPA moderators' first suggestion for a main feed was a single cable to a through-bulkhead battery post ([HPA forum](https://www.hpacademy.com/forum/practical-motorsport-cad-design/show/calculating-how-many-smaller-gauge-wires-are-required-to-make-up-for-a-larger-size-gauge-wire/)). The pattern earns its keep when bend radius, loom OD, connector cavities, or wire availability (the K5's case) constrain — exactly the conditions Dave's shop and this build are under.

### 3.5 Applied to the K5's two candidate feeds

**PDM30 supply.** The PDM30's validated ceiling is **100 A continuous total output** (official datasheet figure; the DB stores a conservative 80 A — `docs/wiring/reference/motec/VALIDATION_REPORT.md`). Its input is an M6 stud ("6 mm eyelet to suit the wire size" — [MoTeC PDM manual](https://www.manualsdir.com/manuals/322364/motec-pdm30-pdm15-pdm32-pdm16.html?page=7)).
- Single-cable answer: **4 AWG M22759/16** — commonly published free-air rating ≈135 A (MIL-W-5088-basis tables; **VERIFY against ProWire datasheet**), comfortably above 100 A even after a bundling derate on this short, mostly-solo run.
- Parallel answer (Dave's pattern): **2 × 8 AWG M22759/16**, equal length, both crimped into one 6 AWG-barrel M6 lug at the PDM and one lug at the fuse. Combined area 16.7 mm² (between 6 and 4 AWG); combined free-air ampacity ≈146 A; with a worst-case −30% bundle derate ≈102 A — still above the 100 A ceiling, marginal enough that **if the pair rides inside a populated loom, keep the single 4 AWG instead or step the pair to 2 × 6 AWG.** Route solo (it's a ~2-foot run) and the pair clears with margin.
- Fuse either way: **MEGA 125 A** — above the PDM's 100 A worst case so it never nuisance-blows, below the cable damage threshold.

**iBooster feed.** 40 A peak, dedicated relay, not on the PDM (`K5_pdm30_channel_plan.md`; `chapters/appendix-d-k5-build.md` §"Direct-Wired"). Tesla's own harness uses 4 mm² wire and a **40 A fuse** on the always-hot input ([EVcreate — wiring the iBooster](https://www.evcreate.com/wiring-the-ibooster/)).
- Single-cable answer: **8 AWG M22759/16** (what the cut list already holds, #52) — generous next to Tesla's 4 mm².
- Parallel answer: **2 × 12 AWG M22759/32**, equal length — combined 6.6 mm², free-air ≈82 A, bundled-pair worst case ≈46 A, still above the 40 A peak. This pair packages beautifully across the cowl in the same clamps as other firewall wiring, and 12 AWG /32 is already on the build's spool list.
- Fuse either way: **MIDI 40 A** at the distribution stud, matching Tesla's own protection.

---

## §4. Ground architecture — validating the star that's already designed

"Star grounding" = every major ground leg runs to one common reference point (the battery negative post) instead of daisy-chaining device to device. The build already encodes a three-leg star in `objectTraits.ts`. Validation of each leg against practice:

### 4.1 STAR_BAT_ENG — battery negative → engine block

Traits entry: rear head bolt or bellhousing lug near the starter, drilled/tapped boss preferred, min 4 AWG (`objectTraits.ts`).

**Practice check — the minimum is too thin by itself.** The block leg carries the **entire starter return current**. Every cranking amp that goes out the unfused 1/0-class positive cable comes back through this cable. Standard practice across the LS-swap and hot-rod world: **battery-to-block negative matches the starter positive cable's size**, landed near the starter, and it must not detour through the chassis ([Speedway Motors — Grounding the Electrical System](https://www.speedwaymotors.com/the-toolbox/grounding-the-electrical-system/28749), [LS1Tech ground strap locations](https://ls1tech.com/forums/conversions-swaps/1658711-ground-strap-locations-where-they-all-supposed.html)). The trait's "min 4 AWG" reads as a floor, not a spec — **the spec is: same as row 1 of the spine table (2 × 4 AWG parallel or 1/0).** The build's own trait notes already carry the companion rule: ECM grounds land direct on the block/head, never daisy-chained through chassis (`objectTraits.ts` engine notes).

With the battery at the passenger firewall corner this leg is short (~2 ft), and the engine-rocking service loop from §1.4 applies.

### 4.2 STAR_BAT_CHASSIS — battery negative → frame rail

Traits entry: welded threaded boss on the rail, **within 12" of the battery** per Holley/PSI practice, 4 AWG min, serrated washer, bare metal, dielectric grease, shrink boot (`objectTraits.ts`).

**Practice check — confirmed as written.** The chassis leg only carries chassis-grounded accessory returns (lights, horn, body accessories), not starter current, so 4 AWG is proportionate; the 12" rule and the welded-boss detail match Holley/PSI install doctrine already cited in the trait. Keep it.

### 4.3 G3 — engine/firewall cab strap

Traits entry: the one strap that makes the rubber-isolated cab electrically alive; replace the factory braid with a welded tab + 8 AWG welding-cable-class strap, head/block to firewall (`objectTraits.ts`, including the classic-failure note: missing G3 = no-start, swinging voltmeter, flickering dash).

**Practice check — confirmed, with one note.** 8 AWG is right for cab loads (gauges, ignition switch, blower, dash) given the PDM's own ground reference returns separately — both PDM Batt− pins go to battery negative in 20 AWG per MoTeC practice (`research/2026-06-09_design-inputs-recon.md` §D2). The LS-swap community treats the block→body strap as mandatory alongside the two battery legs ([Speedway Motors](https://www.speedwaymotors.com/the-toolbox/grounding-the-electrical-system/28749)).

### 4.4 The joint detail every leg shares

At every ground landing (and the trait table already specifies most of this — this is confirmation from practice, not new doctrine):

1. **Bare metal.** Grind/sand the landing spot to bright metal — paint and powdercoat are insulators ([Speedway Motors](https://www.speedwaymotors.com/the-toolbox/grounding-the-electrical-system/28749)).
2. **Serrated (star) washer** between lug and metal — its teeth bite through surface oxide and keep bite under vibration.
3. **Fastener into a welded/tapped boss**, never a sheet-metal screw (the G3 trait note says exactly this).
4. **Dielectric grease over the assembled joint** — on top, after torquing, as a moisture barrier. (Not between the mating faces; the faces need metal contact, the coating keeps oxygen and water out afterward.)
5. **Adhesive-lined shrink boot** over the lug barrel — §5.

---

## §5. Heat-shrink anchoring at lugs — the construction detail

The question: what physically goes over a big crimped lug, and why does it matter?

**The crimp itself first.** Spine lugs are closed-barrel tinned-copper, crimped with a **hex die** — a six-sided die that cold-forms the barrel 360° around the strands into a gas-tight joint. This is the consensus across marine and motorsport: hydraulic hex crimpers produce "perfect neat crimps"; hammer-style indent tools are inconsistent (one HPA member's fix: put the hammer die in a hydraulic press) ([HPA battery lug crimping thread](https://www.hpacademy.com/forum/professional-motorsport-wiring-harness-construction/show/battery-lug-crimping/), [Haisstronica lug-crimp guide](https://haisstronica.com/blogs/wire-connectors/how-to-crimp-lugs-on-battery-cable-factory-grade-results-at-home)). No solder on power lugs — a soldered joint wicks stiff up the strands and creates a fatigue line right where vibration flexes; crimp-only is the OE/F1/RB Racing rule ([RB Racing](https://www.rbracing-rsr.com/wiring_ecu.html)). Verify by inspection (crimp centered, no barrel cracks) and a pull test (IPC/WHMA-A-620 values per gauge — `research/2026-05-21_milspec_heatshrink_protocols.md` §7).

**Then the stack, inside out** (consistent with the build's existing termination doctrine, `research/2026-05-21_milspec_heatshrink_protocols.md` §3):

1. **Adhesive-lined dual-wall heat shrink over the barrel** — M23053/4 Class 2/3 ("SCL" in this build's vocabulary), or its commercial marine equivalent (Ancor adhesive-lined battery-cable shrink). It starts ON the lug barrel (leave the ring tongue bare) and extends 1–1.5" onto the cable jacket. Heat until the adhesive beads visibly at both edges — that bead is the inspection criterion that the hot-melt has flowed and sealed ([Haisstronica marine terminal guide](https://haisstronica.com/blogs/wire-connectors/marine-electrical-connections-using-heat-shrink-crimp-terminals-for-boat-wiring), [West Marine — Ancor adhesive-lined battery cable tubing](https://www.westmarine.com/ancor-adhesive-lined-battery-cable-heat-shrink-tubing-P009_275_003_004.html)).
2. **What this layer actually does — three jobs:** (a) **seals** the crimp mouth against moisture wicking down the strands (corrosion inside a crimp is invisible until it's a resistance heater); (b) **strain-relieves** — the shrink bridges the stiff barrel and the flexible cable so vibration bends the cable in open span, not at the crimp mouth, which is exactly where strands fatigue; (c) **insulates** the barrel against incidental contact.
3. **DR-25 jacket overlap.** Where the cable runs jacketed in DR-25, the adhesive layer tucks under the DR-25 end and they thermally weld at the overlap during shrink — the same SCL-to-DR-25 bond used at every connector on this harness (`research/2026-05-21_milspec_heatshrink_protocols.md` §3).
4. **Color identity:** red shrink at every positive lug, black at every negative — the band is the polarity label at a glance with the cable jacket being uniformly black DR-25.
5. **At terminal blocks/studs exposed to splash** (the distribution stud, the E-Stopp posts), add a fitted **rubber terminal boot** over the assembled stud as the outermost layer — that's a cover, not a structural layer; the adhesive shrink underneath is what's doing the sealing.

---

## §6. The K5 power spine spec

Assumptions baked into this table, stated once: battery at **passenger firewall corner** (owner-stated); PDM30 under dash passenger (A2, still needs the ventilation/heat-soak validation from recon D2); M130 position open (A1); alternator low driver-side on the CVF drive (as-built photos); LS starter passenger-side low rear. **All lengths are estimate-class.** L-numbers cite the digital twin (`K5_landmarks_blender_derived.yaml`); twin values for L14/L15 were derived from the now-dead driver-front battery placeholder and are quoted only as the superseded baseline. **Re-derive L14/L15-class runs in the twin with the battery moved before cutting anything** — and Dave's method still finishes on the truck: prototype at max length, verify on vehicle, then cut (`K5_WIRING_STATE.md` §2).

Gauge column gives both answers per §3; pick per-run at mockup. "/16" = M22759/16 Tefzel; "/32" = M22759/32.

| # | From → To | Serves | Single cable | Parallel alternative (equal length, equal gauge, one lug both legs) | Fuse | Lugs / termination | Length est. |
|---|---|---|---|---|---|---|---|
| P1 | BAT+ post → E-Stopp ESK001 | everything | 1/0 Tefzel-class (**VERIFY sourcing** — exceeds /16 range per substrate) | **2 × 4 AWG /16** (42.3 mm² ≈ 1 AWG) | none — THE unprotected stub; ≤12", DR-25 sheathed, clamped | tinned closed-barrel hex-crimp; battery-post terminal + E-Stopp stud (**VERIFY stud size**) | ≤ 12" |
| P2 | E-Stopp → distribution stud | everything | as P1 | as P1 | none (same stub, ≤6") | as P1 | ≤ 6" |
| P3 | Stud → starter B+ | LS3 cranking (~150–250 A nominal, brief inrush higher — **VERIFY starter PN**) | as P1 | **2 × 4 AWG /16** | **UNFUSED** (cranking exemption, §2.2); compensate with routing + heat barrier | 3/8" (M10) starter-stud lug (**VERIFY**) | ~30–35" (re-derive; superseded driver-front baseline L15 = 68.7") |
| P4 | Stud → alternator B+ | charge current (CVF drive alternator, **PN unknown**) | 4 AWG /16 pending alternator rating | 2 × 8 AWG /16 pending rating | MEGA at stud, 1.25–1.5× alternator rated output — **blocked on PN** | alternator output stud lug (**VERIFY size**) | ~70–75" over-firewall (superseded baseline L14 = 61.6") |
| P5 | Stud → PDM30 M6 stud | 100 A continuous max (validated — `VALIDATION_REPORT.md`) | **4 AWG /16** | **2 × 8 AWG /16** (≈102 A bundled worst-case — route solo or step to 2 × 6; §3.5) | **MEGA 125 A** | M6 eyelet at PDM (datasheet); 6-AWG-barrel lug if paralleled | ~24–30" through firewall at corner |
| P6 | Stud → iBooster pin 1 (Tulay harness) | 40 A peak | **8 AWG /16** (cut list #52) | **2 × 12 AWG /32** | **MIDI 40 A** (matches Tesla) | to Tulay pigtail splice — crimp band + SCL, no solder sleeve at this gauge | ~45–55" over-firewall |
| P7 | Stud → fuel pump (Aeromotive A1000) | 35 A (`appendix-d`) | **8 AWG /16** (cut list #66, 18.4 ft) | 2 × 12 AWG /32 if loom OD demands | **MIDI 40 A** | per pump terminal spec (**VERIFY**) | ~18.4 ft via frame rail (cut list) |
| P8 | Stud → amplifier B+ | 30 A (`appendix-d`) | **8 AWG /16** (cut list #32, 18.4 ft) | 2 × 12 AWG /32 | **MIDI 40–50 A** | amp set-screw or ring per amp (**VERIFY**) | ~18.4 ft (cut list) |
| G1 | BAT− post → engine block (STAR_BAT_ENG) | starter return — **must match P3** (§4.1) | as P1 | **2 × 4 AWG /16** | n/a (grounds unfused) | lug to drilled/tapped boss near starter; bare metal + serrated washer + grease + boot | ~24–30" + engine-rock service loop |
| G2 | BAT− post → frame rail (STAR_BAT_CHASSIS) | chassis accessory returns | **4 AWG /16** (traits — confirmed §4.2) | n/a | n/a | welded threaded boss, joint detail §4.4 | ≤ 12" (Holley/PSI per traits) |
| G3 | Engine head/block → firewall (cab strap) | all cab electrical | **8 AWG** welding-cable-class strap (traits — confirmed §4.3) | n/a | n/a | welded tab both ends, joint detail §4.4 | ~18–24" + service loop |
| G4 | PDM30 Batt− ×2 → BAT− | PDM ground reference | **2 × 20 AWG /32** (MoTeC practice, recon D2) | (it IS a parallel pair — equal length) | n/a | M130-style crimp at PDM pins, lug at battery | ~24–30" |

Every lug barrel on this table gets the §5 stack: hex crimp → adhesive-lined shrink onto the jacket with visible adhesive bead → red/black polarity band → boot on exposed studs.

---

## §7. What this study surfaces (open items, in priority order)

1. **Re-derive L14/L15-class lengths in the digital twin** with the battery at the passenger firewall corner, and check the **hood-hinge travel envelope** over the tray position. (A4 is now closed by owner statement; the model still holds the driver-front placeholder.)
2. **Big-cable sourcing decision:** 1/0-class Tefzel (outside the locked /16 range — needs a spec amendment if chosen) **vs the parallel 2 × 4 AWG /16 pattern** for P1/P2/P3/G1. This is the concrete version of the §2-principle reconciliation already open in `K5_WIRING_STATE.md` §9.8 — and the cut list's "0 AWG M22759/16" rows (#6, #59, #63) are inconsistent with the substrate either way. (Also minor: #51 blower shows "10 AWG M22759/32"; /32 tops out at 12 AWG.)
3. **Alternator PN** (CVF drive) → unblocks P4 gauge and fuse rating.
4. **Starter PN** → confirms P3 cranking figures.
5. **E-Stopp ESK001 instructions** → positive-vs-negative line placement and stud sizes (P1/P2).
6. **PDM30 under-dash ventilation + 30-min CAN heat-soak validation** before the P5 routing is final (carried from recon D2).
7. Hardware stud sizes marked VERIFY in §6 — collect at mockup, per the connector-deferral rule.

---

## §8. Sources

**This build's substrate (cited inline):** `K5_WIRING_STATE.md` · `K5_landmarks_blender_derived.yaml` · `K5_cut_list_v4.txt` · `K5_pdm30_channel_plan.md` · `chapters/appendix-d-k5-build.md` · `objectTraits.ts` (ground points, frame/engine/firewall traits) · `reference/motec/VALIDATION_REPORT.md` (PDM30 100 A continuous validation) · `research/2026-05-21_milspec_heatshrink_protocols.md` · `research/2026-06-09_design-inputs-recon.md`

**Fusing / OCP distance:**
- [Marine How To — Battery Banks & Over Current Protection](https://marinehowto.com/battery-banks-over-current-protection/) (ABYC 7"/40"/72", cranking exemption, fuse AIC table)
- [PKYS — ABYC E-11.10 Overcurrent Protection summary](https://shop.pkys.com/abyc-overcurrent-protection-summary)
- [Blue Sea Systems — DC Circuit Protection](https://www.bluesea.com/support/articles/Circuit_Protection/98/DC_Circuit_Protection)
- [the12volt.com — why fuse within 18 inches of battery](https://www.the12volt.com/installbay/forum_posts.asp?tid=108159) (IASCA 18", older 14", marine 12" variants)
- [BestCarAudio — battery fuse size and purpose](https://www.bestcaraudio.com/car-audio-battery-fuse-size-and-purpose/)
- [YBW forum — fuse for starter circuit](https://forums.ybw.com/threads/fuse-for-starter-cable.502163/) · [GT40s — alternator & starter fuse question](https://www.gt40s.com/threads/alternator-starter-fuse-question.57369/)
- [GM-Trucks.com — fusible link, Ask the GM Technician](https://www.gm-trucks.com/forums/topic/85910-fusible-link/)
- [Hot Rod Forum — main fuse/breaker at the battery](https://www.hotrodders.com/threads/adding-a-main-fuse-or-breaker-at-the-battery.547750/) · [Speedway Motors — battery relocation guide](https://www.speedwaymotors.com/the-toolbox/battery-relocation-to-trunk-or-other-area-of-your-vehicle/120166)

**Parallel conductors:**
- [RB Racing — Motorsport Wiring Harness Splice Wire Diameter Calculator (22759 parallel splices)](https://www.rbracing-rsr.com/22759_parallel_splices.html)
- [HPA forum — calculating how many smaller gauge wires replace a larger gauge](https://www.hpacademy.com/forum/practical-motorsport-cad-design/show/calculating-how-many-smaller-gauge-wires-are-required-to-make-up-for-a-larger-size-gauge-wire/)
- [HPA — Wire Sizing Quick Guide](https://www.hpacademy.com/blog/wire-sizing-quick-guide/) · [HPA — Wiring Fundamentals: Sizing the Wires](https://www.hpacademy.com/courses/wiring-fundamentals/power-supply-sizing-the-wires/)
- [EC&M — NEC requirements, paralleling of conductors](https://www.ecmweb.com/national-electrical-code/qa/article/21260929/stumped-by-the-code-nec-requirements-paralleling-of-conductors) · [Electrical Contractor Magazine — conductors connected in parallel](https://www.ecmag.com/magazine/articles/article-detail/codes-standards-conductors-connected-parallel-each-set-must-have-same-electrical) · [VoltPrep — NEC 310.10(G) 1/0 minimum](https://voltprep.app/blog/nec-310-10-g-parallel-conductors-1-0-awg-minimum)
- [BoatHowTo — ABYC ampacity tables & bundling derates & terminal consolidation rule](https://boathowto.com/electrics/abyc-ampacity-tables/) · [West Marine — ABYC wiring practices](https://www.westmarine.com/west-advisor/Marine-Wire-Terminal-Tech-Specs.html)
- [MoTeC PDM User Manual](https://www.motec.com.au/hessian/uploads/PDM_User_Manual_3a926f869d.pdf) · [manualsdir excerpt — PDM battery positive wiring](https://www.manualsdir.com/manuals/322364/motec-pdm30-pdm15-pdm32-pdm16.html?page=7) · [PDM30 datasheet (milspecwiring mirror)](https://www.milspecwiring.com/DATA%20SHEETS/PDM/PDM30_datasheet.pdf)

**Routing / support:**
- [Direct Current Boatworks — ABYC marine safety standards (18" support rule, clamp types)](https://directcurrentboatworks.com/blogs/safety/abyc-marine-safety-standards) · [ToolGrit — ABYC marine DC wiring guide](https://www.toolgrit.com/guides/abyc-marine-dc-wiring)
- [FAA AC 43.13-1B Ch. 11 — aircraft electrical systems (24" clamp maximum)](https://www.faa.gov/documentlibrary/media/advisory_circular/ac_43.13-1b_w-chg1.pdf)
- [RB Racing — Motorsports ECU Wiring Harness Construction (service loops, crimp doctrine, 1:1 layout)](https://www.rbracing-rsr.com/wiring_ecu.html)

**Grounds:**
- [Speedway Motors — Grounding the Electrical System](https://www.speedwaymotors.com/the-toolbox/grounding-the-electrical-system/28749)
- [LS1Tech — ground strap locations](https://ls1tech.com/forums/conversions-swaps/1658711-ground-strap-locations-where-they-all-supposed.html) · [BP Automotive — LS swap ground strap kit](https://bp-automotive.com/product/ls-swap-ground-strap-kit/)

**Lugs & heat shrink:**
- [HPA forum — battery lug crimping](https://www.hpacademy.com/forum/professional-motorsport-wiring-harness-construction/show/battery-lug-crimping/)
- [Haisstronica — how to crimp battery cable lugs (strip length, dies, pull tests, heat shrink)](https://haisstronica.com/blogs/wire-connectors/how-to-crimp-lugs-on-battery-cable-factory-grade-results-at-home) · [Haisstronica — marine heat-shrink crimp terminals](https://haisstronica.com/blogs/wire-connectors/marine-electrical-connections-using-heat-shrink-crimp-terminals-for-boat-wiring)
- [Selterm — crimping best practices for tinned copper lugs](https://selterm.com/blogs/selterm/crimping-best-practices-for-tinned-copper-lugs-in-heavy-gauge-cables) · [Selterm — 4-gauge lugs in high-vibration setups](https://selterm.com/blogs/selterm/best-practices-for-securing-4-gauge-lugs-in-high-vibration-environments)
- [West Marine — Ancor adhesive-lined battery cable heat shrink](https://www.westmarine.com/ancor-adhesive-lined-battery-cable-heat-shrink-tubing-P009_275_003_004.html)

**iBooster:**
- [EVcreate — Wiring the iBooster (4 mm² main feed, 40 A fuse, 5 A ignition)](https://www.evcreate.com/wiring-the-ibooster/) · [Tulay's Wire Werks — iBooster Gen-2 harness](https://tulayswirewerks.com/product/bosch-ibooster-gen-2-universal-wire-harness/)
