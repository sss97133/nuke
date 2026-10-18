---
id: 2026-09-30_research-delstributor-coil-geometry
change_type: research
scope: docs/wiring/research/2026-09-30_delstributor-coil-geometry.md (new), docs/wiring/calc-data/cad/delstributor_geometry.yaml (new)
author: claude-opus-5-5 (delstributor lane, session ebc425ad), 2026-09-29
owner_words: "you kinda need to figure out how the Del-stributor it's actually laid out ... it's kind of in a circle ... one bracket for two coils and then there's a third piece ... that connects to the back of the engine Which you should figure out which bolt is holding it" (2026-09-29)
amends: none
---

# Research receipt: DEL-Stributor coil geometry

## What this produces
- A sourced research packet: the parts, how the cluster goes together, which bolt holds it, every dimension with its
  method and margin, COIL-1..8 in the twin's axes, the cylinder each coil fires, fit checks, and a proposed coil-harness
  layout.
- A data file for parts-artist (build123d) and harness-cad (Blender) with the same numbers. It replaces the placeholder
  4 × 2 grid ANCHOR_coil_1..8.
- **Nothing else changes.** No registry edit (`k5_registry.json` untouched), no database write, no pin or gauge change,
  no route decided on the truck.

## Pre-flight gate (wiring-receipt.md)
1. Read `K5_WIRING_STATE.md` §1–4. Row 30 ("Coil bracket: DEL-Stributor, central mount, 8× D510C") stands; this adds
   detail and does not re-propose it. Also read rows 0ag(g)/(h), 0ah, 0i and 0v.
2. Canon read:
   - ch.16: §7.4 Y-splice boots, §8.5 tie spacing;
   - ch.17: §17.4 star grounding, no daisy-chained grounds, sensor grounds on the head;
   - ch.18: §2.3 break-outs, §4 Dave's method, §6–8 connector deferral and the design/hands line.
3. Library search:
   - "firing order" → `LS3_Long_Block_Installation_Guide.pdf` p.5 and others;
   - "bellhousing bolt" / "bell housing" → the GM 6L80 kit p.2;
   - "valley cover", "oil pressure sensor", "coil relocation", "D510C", "12611424" → no LS3 coil or bracket document
     in the library;
   - cylinder numbering from 1977 LTSM p.518 and `service_manuals/1987_Chevy_Service_Manual.pdf` p.493 ("odd numbered cylinders are in the left bank, when viewed from the rear of the engine").
   - The LS deck height is not in the library, so the photo scale that uses it inherits the twin's own
     `dimensions_v3.json` value (stated in the research).
4. Every number is cited, or it is an unknown with its close path (research §4 table, data-file `unknowns`).
5. Owner decisions this depends on (stated, not invented):
   - the engine PDM's mount (the coil rail's upstream path; state 0ag(b), 0ah);
   - the intake part (clearance only; state 0ag(g));
   - relocating the oil-pressure sensor if it hits.
6. Would Dave shred it? See the end.
7. Deferred to the builder (hands): the mock-up, the leg lengths, the ground-hole pick, the plug latch direction, and the
   final route of the split star.

## Sources
- **Maker:** Delmo Speed product JSON (del-stributer DELSTRIB01, ls-2-coil-relocation-bracket DELCB01,
  delmos-coil-relocation-kit, delstributor, vintage-plug-wires DELPW03, ls-coil-harness DELCH01,
  sparkplug-wire-crimp-tool CRP), read 2026-09-29, one request per 10 s.
- **Maker's photos:** read by URL (listed in the research); none committed. Local copies stay in
  `~/k5-harness-pull/cad/delstrib/` and the session scratchpad.
- **The owner's orders:** Gmail (Delmo confirmations and shipping notices; PayPal receipt), the DB `receipts` table
  (Delmo Speed, DELPW03), and the `vehicle_observations` COIL-1..8 device-proof rows (eBay). Order numbers, dates and
  amounts went to the lane report, not to these files.
- **The owner's photos** (vehicle_images): IMG_1101 71a33780-0884-4df5-bbbd-582b1165d084; IMG_0123
  7e2efddd-4593-472e-b554-2ec49f429910; IMG_6531 95eafee3-72c4-4637-b9b0-65aeeae70fbc.
- **GM and service documents:** GM Supermatic 6L80 kit 19367014 p.2 (M10×1.5×40, 58 Nm, "center top bolt"); LS3 long
  block guide p.5 and Marine LS3 sheet p.3 (firing order); 1977 LTSM p.518 (cylinder numbering); Swap Specialties LS
  install p.4 (ground eyelet on the back of the head); LS3 E-ROD guide pp.9–10 (odd/even coil banks).
- **Twin:** `twin_engine_anchors.json`, `twin/dimensions_v3.json`, `twin/HANDOFF.md`, and a read-only copy of
  `K5_harness_workspace_v3.blend` (object bounds; ray casts on the body at the centreline).

## Findings
1. **Parts:**
   - post: Delmo DELSTRIB01;
   - brackets: Delmo DELCB04 (4 U-brackets, 2 coils each);
   - plug wires: Delmo DELPW03 (7.8 mm, 2 each of 43/40/36/32 in, coil end to crimp);
   - coils: GM 12611424 / D510C.
   - Not bought: Delmo's coil harness DELCH01 (not needed) and a plug-wire crimper for the DELPW03 coil ends (a real
     tool gap).
2. **Coils are D510C family, not D585.**
   - The pair on the bracket reads H6T55272ZC, which is the marking on Delmo's photographed "ACDelco 12611424".
   - The D585 label is a vision guess (`vehicle_observations` 13ad609b-466a-42bf-b60a-73bde2f15622,
     part_number_guess "GM D585 / 12558693").
   - Open: a second coil style on the bench (IMG_1101), part number not legible.
3. **Layout:**
   - four brackets on the post's four faces, all at one height, two coils back to back on each;
   - towers up, plugs down;
   - coil axes on a 95.6 ± 6 mm circle, ±13.7° either side of each bracket face.
4. **Bolt:** probably the 12 o'clock bellhousing bolt (M10×1.5). The post has one M10-size foot hole. The bolt needs
   40 mm + the foot thickness. To be confirmed on the truck.
5. **Heights above that bolt:** upper ears +146.6, lower ears +73.7, tower tips +178.5, plug ends +53.8 mm (±5).
6. **Proposed ring order:** driver half 1-3-5-7 and passenger half 2-4-6-8, front coil to front cylinder. Plug wires
   43/40/36/32 in from front to rear. This is the builder's call.
7. **Proposed harness:** a split star. One Y on the driver side of the post, then two 4-coil stars. The same seven
   D-609-05 power splices as the registry, split 1 + 3 + 3. Grounds from each half go to that side's head rings.
8. **Fit checks** (owner or tape):
   - firewall depth behind the rear pair (the twin's firewall is 0.107 m too close);
   - COIL-1 over the Gen IV oil-pressure sensor (Delmo warns about exactly this);
   - the front pair against the rear of the intake (about 22 mm clear in the twin);
   - the bell flange height at the bolt.

## Substrate inconsistencies surfaced (not fixed inline)
- **The M130 output → coil mapping disagrees.**
  - `output/K5_coil_mapping.md`: IGN_LS(n) = cylinder n, wire #24 on A03.
  - Cut list v4.2 and `k5_registry.json` `m130_pinout`: A03 → #5 "coil 3" … A13 → #24 "coil 1".
  - `M130_PINOUT_TRIANGULATION_MATRIX.md` line 78 calls the second pattern the DEL-Stributor mapping "per
    K5_coil_mapping.md", which says the opposite.
  - Needs the M1 GPR ignition-output-to-cylinder table. The geometry does not depend on it.
- **`catalog/mounts.yaml` FUELP** still says the DEL-Stributor spot "holds the Aeromotive regulator in photo IMG_6531".
  State 0ag(h) on main corrected that: the regulator is at the front of the valley.
- **State 0i's paraphrase of Dave's sketch** ("injectors 8-6-4-2 (D) / 7-5-3-1 (P)") puts the even cylinders on the
  driver side, against the 1977 LTSM p.518 and `catalog/mounts.yaml` INJ-n. Look at the sketch.
- **`vehicle_observations` COIL device-proof rows and the 13ad609b vision row** say D585. The printed marking says
  12611424. Superseding the vision row is a sanctioned-writer job (ingest-observation), not done here.
- **Twin vs cluster:**
  - The twin's firewall at the centreline (y −1.367) leaves 33 mm behind the bell face, where the cluster needs about
    140 mm.
  - The twin's E3_6L90_Bell tops out at crank + 0.22 m, below the bolt estimate (crank + 0.242).
  - Both are estimates, so tapes are listed.
- **objectTraits.ts** has no trait entry for the DEL-Stributor cluster, the bellhousing top or the firewall dish. Routing
  near them needs one first (wiring-receipt rule). Not added here (out of scope).

## Unknowns (with close paths)
| Unknown | Needs |
|---|---|
| Coil PN on each of the 8, count per style | owner reads the GM number on each coil |
| 12 o'clock bolt present on the 6L90 bell; foot seats under it | owner, on the truck |
| h_F (bolt height above the crank; photo estimate 0.242 ± 0.035 m) | tape, balancer bolt to the 12 o'clock bolt |
| t_bell (bell flange at the boss) | calipers, or bolt length minus exposed thread |
| Post depth, foot thickness, arm-tip thread, ring diameter across the towers | calipers on the parts (in hand) |
| Anti-rotation of the one-bolt post | ask Delmo (draft question in the lane report) |
| Firewall dish depth at the centreline | tape, block rear face to the dish at bolt + 0.10–0.20 m |
| Oil-pressure sensor vs COIL-1 | owner's eyes with the cluster offered up |
| Plug latch direction per coil | bench, once bolted up |
| Ground-ring holes and thread at the back of each head | bench |
| Coil rail's upstream path | engine PDM mount decision (open) |

## Would Dave shred this?
- **Cited, not vibed:** every number carries a photo and scale, a document page, or "unknown".
- **Calculate first, cut last:** no lengths are set. The legs are mock-up items; the plug-wire lengths are Delmo's set,
  cut at the coil end.
- **Parallel-skinny:** not applicable. Gauges are unchanged.
- **Crimped, not soldered:** unchanged, D-609-05 splices.
- **Engine-only firewall:** nothing here crosses it.
- **Dave's vocabulary:** "oil pressure sensor", "coil", "plug wires".
- **Scoped:** three files; no registry edit.
- **Risk:** the tangential offset and body size come from two small Delmo photos, ±3–5 mm. The bench check (item 5 in
  the research §9) closes it in a minute.

## Proposed state row (for whoever edits the state file)
0aj. **DEL-STRIBUTOR GEOMETRY (2026-09-30; receipt `receipts/2026-09-30_research-delstributor-coil-geometry.md`).**
- Parts: Delmo DELSTRIB01 post, DELCB04 brackets (4, two coils each), DELPW03 plug wires (coil end to crimp; no crimper
  on hand); coils are the 12611424 / D510C family (not D585).
- Layout: the post bolts at the back of the block, probably under the 12 o'clock bell bolt (M10×1.5, longer by the foot
  thickness). The 8 coils stand in a ring around it (axes r 96 mm, towers up, plugs down).
- COIL-n positions are in `calc-data/cad/delstributor_geometry.yaml`.
- Fit checks: firewall dish depth, oil-pressure sensor under COIL-1, rear of the intake.
- Harness: split star (driver half / passenger half), grounds to each head's rear.
