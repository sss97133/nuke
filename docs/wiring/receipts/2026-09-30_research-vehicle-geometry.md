---
id: 2026-09-30_research-vehicle-geometry
change_type: research
scope: docs/wiring/calc-data/cad/ (new dimensions.yaml, check_dimensions.py, tape_list.yaml), docs/wiring/research/2026-09-30_k5-body-scans-and-cad-sources.md. No registry, catalog, map row, database row or .blend file changed.
author: claude-opus-5-5 (geometry-scan lane, session ebc425ad; work done 2026-09-29 PDT)
owner_words: "figure out your margin of error situation by actually knowing the vehicle ... the repair manuals the service manuals at some point you actually find like measurements" / "if our blocker starts being that we need a 3-D scan of a Chevy blazer ... we kinda need to find somebody on the Internet partner or ... service" (2026-09-29)
---

# Vehicle geometry: every published dimension we hold, scan options, and the tape list

## What changed
- `calc-data/cad/dimensions.yaml`: **122 published dimensions**, each with value_mm (1 in = 25.4 mm), the printed
  value and unit, the measuring points in the source's words, doc + PDF page (+ printed page) + figure, where on
  the figure it sits, years, applies_to_1977, confidence and why. It also carries 4 printed tolerances and 2 GM routing
  clearances. harness-cad reads it for the margin table against the Blender body.
- `calc-data/cad/check_dimensions.py`: checks shape and units. For the GM manuals (they have a text layer) it finds
  every value on its cited page and table row, plus the same row in each other year's manual. It also closes the
  Mitchell figures on themselves and compares the same feature across sources. `--points` rebuilds the Mitchell frame
  points in 3D. Result: PASS, 0 failing; 32 on-page OK, 113 cross-year OK, 90 read by eye (scans with no text layer).
- `calc-data/cad/tape_list.yaml`: 15 measurements. P1 (4 items): the fuse-box opening, its position, the clearance
  off each face, and the under-dash space. P2 (7): trunk lengths, body on frame, the rear double wall, the tailgate,
  rear runs, door jumpers, the battery corner. P3 (4): cab, windshield and engine-compartment calibration, and the
  removable top.
- `research/2026-09-30_k5-body-scans-and-cad-sources.md`: scan and CAD options ranked, prices with dates, 3 outreach
  drafts. Nothing sent, bought or signed up for.

## Counts (dimensions.yaml)
| Source | Entries | high / medium / low |
|---|---|---|
| Mitchell 1988 Blazer 2-door 4WD, Fig 1 frame + Fig 2 upperbody (FR88) | 75 | 1 / 70 / 4 |
| GM 1975-81 frame table, row KA105 (the K10 Blazer), same in 7 manuals (GM77 + also_in) | 18 | 6 / 12 / 0 |
| GM 1973-74 frame table, row KA105 (fore-aft and widths only) | 5 | 0 / 2 / 3 |
| GM 1987 R/V frame (2 widths) and utility top-strap anchor (2) | 4 | 0 / 4 / 0 |
| GM 1977 removable-top brace (63 in hole spacing) | 1 | 0 / 0 / 1 |
| KLM 1984 Blazer 4WD CHT-1 (underhood 4, cab-mount pads 7, rear spring hangers 1) | 12 | 0 / 2 / 10 |
| GM TX000469 30-series cab-chassis drawing (BBC, front overhang) | 2 | 0 / 0 / 2 |
| 1977 Blazer 4-view orthographic, web copy (rear cargo width 64.8) | 1 | 0 / 0 / 1 |
| GM Powertrain 2009 marine LS3 sheet (outline, bore centre) | 4 | 1 / 0 / 3 |
| **Total** | **122** | **8 / 90 / 24** |

## Method
Scanned figures (Mitchell, KLM, TX000469, the orthographic) were extracted at native resolution, rotated upright,
and read at 2-4x zoom, one view at a time. The GM pages were rendered at 200-400 dpi, and the table rows were read
both from the image and from the page text. The first read of a GM row was checked against the image (e.g. the 1977
KA105 row at 300 dpi). The .blend was copied to the scratchpad and read headless; the original is untouched.

## What the numbers say about the margin of error (check_dimensions.py)
- **Mitchell's frame figure agrees with itself to 0.4 mm.** Its widths, fore-aft lengths and heights rebuild all nine
  printed tram lengths and diagonals within 0.4 mm. That also confirms how the figure reads: the bottom view is
  true 3D point-to-point, and the side view gives the fore-aft and height parts.
- Engine compartment closes to 0.9 mm; windshield to 1.0 mm. **The tailgate opening does not close: 8.2 mm**
  (1657 x 505 wants a 1732 diagonal; it prints 1724). Tape item T-08.
- KLM's cab-mount block closes to +6.2 / -3.3 mm (its two diagonals print 9 mm apart).
- Between sources:
  - Front rails: GM 1987 704.9 vs Mitchell A-A 706.0 (1.1 mm). GM 1975-81 V x2 is 711.2, 5-6 mm wider;
    GM measures to the inside of the web.
  - Rear rails: GM 1975-81 T x2 857.25 = GM 1987 points 11-12, exactly. Mitchell K-K (hole centres) is 862,
    about one web thickness wider.
  - Engine compartment: KLM vs Mitchell 1.0 / 5.8 / 5.2 mm.
  - Rear spring hangers: KLM 1306.5 vs Mitchell's I-M fore-aft 1309.0 (2.5 mm).
  - The 1973-74 table's rail half-widths (14, 16-7/8 in) equal the 1975-81 ones.
- So the published sources hold about 1 mm on the frame and about 6 mm between publishers on the body. Where a
  number applies to the 1977 at all, the source margin is small next to the harness pads (15/20 %).

## Substrate inconsistencies found (not fixed inline; each needs its own substrate_correction receipt)
1. **`docs/wiring/output/K5_dimensions_atoms.yaml` and `K5_DIMENSIONAL_SUBSTRATE.md` misread the Mitchell sheet.**
   - The side-view heights (A 461, B 332, C 463 ...) are filed as "distance from centreline", and the bottom-view
     widths as "longitudinal station".
   - The point legend is shifted: G is filed as a 19x33 oval (the sheet says 16 mm round), I as an exhaust-hanger
     rivet (the sheet says head of bolt, leaf spring mount), J as a 10 mm round hole (the sheet says 18x33 oval;
     the 10 mm hole is L'), K as a leaf-spring bolt (the sheet says 17x33 oval), and L as a tow-package mount (the
     sheet says the exhaust-hanger rivet; N is the tow package).
   - **The motor-mount station is wrong.** E is filed at a "longitudinal station" of 1587 mm. That's the A-to-G tram
     length. On the sheet, E is 791 mm behind A fore-aft (A to G 1582 less E to G 791).
   - Engine compartment: 1102 is filed as "centreline to inner shock tower" (it is the rear-to-front point distance
     on one side), 1523 as "length firewall to front" (it is the front width), 1715 as "width across firewall top"
     (it is the rear width).
   - Camber is filed as 1.5 deg; the sheet prints "Front: +1 +/- .5".
   - The door, pillar and tailgate entries carry no point names ("dimension_1", "corner_dim_1").
   - The frame side-view "heights" 706/938/1020/791/961/1093/810/382/1186/824 are a mix of widths (B-B prints 958,
     not 938), fore-aft lengths and the rear width.
   Supersede both files for geometry with dimensions.yaml. **The misread has spread** (git grep):
   - `scripts/build_k5_twin.py`: `MOTOR_MOUNT_X = 1587` "rearward from front of frame", shock towers at +/-1102,
     bay length 1523.
   - `docs/wiring/output/K5_harness_routing_iso.py`: `"E": 1587`, engine centred on it.
   - `database/migrations/20260522_k5_landmark_estimates.sql`: L01-L30 estimates "derived from
     K5_dimensions_atoms.yaml", in the database at confidence 0.45-0.85, written to be superseded by tape
     measurements.
   The v3 twin places its engine separately (K5H_Engine_v3_root at y -1.40). The twin lane should confirm nothing
   in v3 still reads these numbers. The landmark rows get superseded through the sanctioned writers when T-05/T-06
   come back; this lane doesn't touch the database.
2. **The same atoms file's "Holley Mid-Mount 20-131" envelope (411/433/406/393/339 mm)** is from the 20-131
   bracket-kit guide (holley_midmount_fitment.pdf p.2), not the Mid-Mount complete system on the truck. State row 0ag
   has shipment 766317 carrying a 20-186. The 20-185-family Mid-Mount guide we hold has no outline figure, so the
   Mid-Mount envelope is unknown.
3. **`objectTraits.ts` gives the fuse-block opening as a 4.0 in hole** (factory_holes FB) with no source. The owner's
   61-pin plate depends on it; tape item T-01 measures it.
4. The 1987 manual prints "847.25 mm (33.75-inch)" for points 11-12. 33.75 in is 857.25 mm, a typo in GM's metric
   figure. The entry keeps the inch value.
5. K5_DIMENSIONAL_SUBSTRATE.md's header carries the retired VIN CCL187Z210370 (state header: CKR187F127263). This is
   already known from appendix-d.

## What applies to this 1977 and what doesn't
- **Yes, printed for it:** GM KA105 frame rows (1975-81 and 1973-74), the 1977 top-bolt spacing, wheelbase 106.5 in.
- **Assumed:** Mitchell and KLM frame and cab (the 1973-87 C/K cab and the K5 frame family). The door, pillar and
  windshield openings are the same cab; the half-cab B-pillar numbers are 1976-91 K5.
- **Unverified:** the engine-compartment front points. Mitchell 1988 and KLM 1984 are on 1981+ front sheet metal,
  and the 1973-80 radiator support is a different part (T-14 checks it). The same goes for the 30-series cab-chassis
  numbers and the marine LS3 outline.

## Noticed in the twin (read from a copy; for harness-cad and the twin lane, not acted on)
- The engine's rear face sits behind the nominal firewall. E3_RearCover is at y -1.40, while the brief puts the
  firewall at about y -1.46. The valve-cover rear edges are at -1.492 (L) and -1.468 (R). The dash panel has a
  centre recess for the bellhousing, so this may be right, but the twin has no firewall surface to check it
  against. T-05 and T-06 measure it on the truck.
- Twin wheelbase 2702.5 mm (wheel centres y -1.8955 and +0.807) against 2705 published: -2.5 mm.
- The twin's roof mesh (Exterior_Roof) is 1881 x 1855 mm. No source dimensions the top (T-15).

## Unknowns (open, each with its close)
- The fuse-box opening's size, position and clearances (T-01 to T-04): these block the 61-pin plate and boot choice.
- The firewall's own curves, the floor, the rear double wall: no document we hold dimensions them. Close by scanning
  this truck (research doc ranks 1-2; quotes needed) or by taping T-05 to T-11.
- The removable top (asked by the top-design lane): no source; T-15.
- The Holley Mid-Mount envelope: needs Holley's drawing for the 20-186, or a scan.

## Proposed state row (for the lane that owns K5_WIRING_STATE.md; not edited here)
"0ai. VEHICLE GEOMETRY FROM THE MANUALS (2026-09-30; receipt 2026-09-30_research-vehicle-geometry.md):
calc-data/cad/dimensions.yaml = 122 published dimensions (Mitchell 1988 frame A-N + body openings, GM KA105 frame
rows 1973-81, KLM 1984, GM 1987); the Mitchell frame closes to 0.4 mm, the tailgate opening is 8 mm off; the older
K5_dimensions_atoms.yaml misreads the Mitchell sheet and is superseded for geometry. No scan of a 73-91 square-body
interior exists to buy; scan this truck (quotes pending). Tape list: 15 items, T-01 to T-04 block the 61-pin plate."
