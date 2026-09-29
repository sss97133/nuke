# DEL-Stributor coil cluster: the parts, the bolt, the circle

Research for the 1977 K5 (vehicle e08bf694-970f-4cbe-8a74-8715158a0f2e), written 2026-09-29 by the delstributor lane.
Data file: `docs/wiring/calc-data/cad/delstributor_geometry.yaml`. Receipt:
`docs/wiring/receipts/2026-09-30_research-delstributor-coil-geometry.md`.

The owner's words (2026-09-29): "you kinda need to figure out how the Del-stributor it's actually laid out ... it's kind
of in a circle ... the brackets that hold the coil one bracket for two coils and then there's a third piece I had to
order separately like a year later ... a billet in the CNc piece that connects to the back of the engine ... figure out
which bolt is holding it".

## Result

- The DEL-Stributor is Delmo Speed's billet centre post, **DELSTRIB01**. It stands at the back of the engine. Delmo's
  four billet coil brackets (**DELCB04**, two coils each) bolt to its four faces.
- The eight coils form a ring around the post, **towers up, plugs down**, like a distributor cap. Two coils sit on each
  bracket, 13.7° either side of that bracket's face. Their axes lie on a circle of about **96 mm radius (±6)**.
- Heights above the post's bolt: tower tips **+179 mm**, coil plug ends **+54 mm**.
- The post has **one foot hole** (10.5 ± 0.8 mm, an M10 clearance hole). In Delmo's install photo the foot drops into
  the joint between the block and the bellhousing, at top centre.
  - The bolt is most likely the **12 o'clock bellhousing bolt**: M10×1.5, GM's 6L80 kit already hangs a bracket under
    it. It must be longer than stock by the foot's thickness.
  - This is probable, not proven. Confirm on the truck.
- The coils are the **GM 12611424 / D510C** family, not D585. The pair on the Delmo bracket reads H6T55272ZC, which is
  the marking Delmo photographs on an "ACDelco 12611424".
  - A second coil style is also on the bench. Its number can't be read in the photo.
- Three fits to check before anything is cut:
  - the firewall behind the rear coil pair;
  - the oil-pressure sensor under the front-driver coil (Delmo warns about exactly this);
  - the rear of the intake.
- Proposed harness: **one Y on the driver side of the post, then two 4-coil stars** (driver half, passenger half).
  Grounds from each half go to that side's cylinder head.

## 1. The parts

| Piece | Maker's part | What it is | Source |
|---|---|---|---|
| Centre post ("the third piece") | Delmo Speed **DELSTRIB01** "Del-Stributer" | "Delmo's Billet Aluminum machined for LS1 and LS3 coil relocation brackets. Made to mount LS engine coil relocation brackets to move the coils off the valve covers. Coils and coil relocation brackets sold separately." Listed 2025-08-04, well after the brackets were bought | https://delmospeed.com/products/del-stributer (Shopify product JSON, read 2026-09-29); the owner's Delmo order (Gmail) |
| Coil brackets | Delmo Speed **DELCB04** "Coil Relocation Brackets For GM LS3 Coils", 1 set | 4 billet U-brackets, 2 coils each (section 2) | the owner's Delmo shipping notice (Gmail) names the SKU. DELCB04 is no longer in Delmo's catalog; the 2024 page is in Wayback but returned HTTP 429 twice. The live sister listing DELCB01 (https://delmospeed.com/products/ls-2-coil-relocation-bracket) says "coil relocation brackets for all 8 coils ... Fits LS Coils (2 Styles) ... 12570616, 12611424 ... Bolt spread 2 7/8"" |
| Plug wires | Delmo Speed **DELPW03** "Vintage Plug Wire Kit, Black W/Red Tracers" | 7.8 mm braided; 2 each of 43, 40, 36 and 32 in; "engine side done with coil side left to crimp on"; extra boots and terminals included | https://delmospeed.com/products/vintage-plug-wires; the owner's Delmo order (Gmail); `receipts` table (Delmo Speed, DELPW03) |
| Coils | GM **12611424** (ACDelco **D510C**), set of 8 | see below | `vehicle_observations` COIL-1..8 "device proof" rows (the eBay order) |
| Coil harness | Delmo DELCH01 "LS Coil Harness" | **not bought**; also out of stock. Our harness replaces it | Delmo product JSON; Gmail (no order) |
| Plug-wire crimper | Delmo CRP "Crimp Tool" | **not bought**. The coil ends of DELPW03 need a plug-wire crimper | Delmo product JSON; Gmail (no order) |

**D510C, not D585.**
- Owner photo IMG_1101 (vehicle_images `71a33780-0884-4df5-bbbd-582b1165d084`, 2024-09-30) shows two coils mounted on one
  Delmo bracket. Both read "H6T55272ZC".
- Delmo's own photo of the bracket shows that marking on a coil also printed "ACDelco 12611424":
  https://cdn.shopify.com/s/files/1/0861/4261/5835/products/IMG_3918.jpg?v=1709224084.
- The vision row that calls these "LS truck-style ignition coils (D585)" guessed "GM D585 / 12558693" at 0.85
  (`vehicle_observations` 13ad609b-466a-42bf-b60a-73bde2f15622). Nothing printed on the coils supports it.
- **Open:** the same bench photo shows a second, squat coil style (4 or more visible, "Delco" script). No part number
  can be read on them. Delmo's brackets take two LS coil styles (DELCB01), but the geometry below is for the
  H6T55272ZC / 12611424 body. The owner should read the GM number on each of the 8 coils before any plug is crimped.

## 2. How it goes together (Delmo's photos)

- **The post.** A billet bar about 53 mm wide and about 145 mm tall. The "DELMO" face has a foot at the bottom with
  one through hole in a pocket for the bolt head. The back face is flat, and the post lies flat on it in NewCR1.
  - https://cdn.shopify.com/s/files/1/0861/4261/5835/files/NewCR1.jpg?v=1754341879 (face-on, three brackets fitted)
  - https://cdn.shopify.com/s/files/1/0861/4261/5835/files/DelStrib3.jpg?v=1754341715 and
    https://cdn.shopify.com/s/files/1/0861/4261/5835/files/DelStrib1.jpg?v=1754341862 (bare)
- **The brackets.** Each one is a U:
  - a web screwed flat to one face of the post with two countersunk screws;
  - a top arm and a bottom arm reaching straight out;
  - each arm tip tapped through, sideways (tangential).
  - Four brackets come on one card (https://cdn.shopify.com/s/files/1/0861/4261/5835/products/IMG_3914.jpg?v=1709224084).
    One bracket goes on each of the post's four faces, all at the same height (NewCR1, NewCR2
    https://cdn.shopify.com/s/files/1/0861/4261/5835/files/NewCR2.jpg?v=1754341890).
- **Two coils per bracket, back to back.**
  - Each coil has two ear lobes on one edge, 2 7/8 in apart: one at the tower end, one under the plug.
  - One coil's ears bolt to one side of the two arm tips, the other coil's to the other side, so the tips are clamped
    between the two coils.
  - The bolt heads are on the pair's outer sides. Sources: IMG_3914; IMG_3917
    (https://cdn.shopify.com/s/files/1/0861/4261/5835/products/IMG_3917.jpg?v=1709224084); IMG_3918; owner IMG_1101.
- **Coils stand up.**
  - Every Delmo install photo and the assembled-kit photo have the towers up and the plugs hanging down: CRInstalled2
    https://cdn.shopify.com/s/files/1/0861/4261/5835/files/CRInstalled2.jpg?v=1754341915 (from above, coils fitted),
    CRInstalled https://cdn.shopify.com/s/files/1/0861/4261/5835/files/CRInstalled.jpg?v=1754341960 (on an engine,
    wires run along the valve covers), CBKnowires1
    https://cdn.shopify.com/s/files/1/0861/4261/5835/files/CBKnowires1.jpg?v=1754687559 (assembled kit).
  - The face printed H6T55272ZC looks outward, away from the post (IMG_1101). The face printed "ACDelco 12611424"
    carries the ear bolts and looks sideways (IMG_3918).
- **Where it sits.** At the back of the engine, behind the intake, just right of the oil-pressure sensor seen from the
  rear: CRInstalled3 https://cdn.shopify.com/s/files/1/0861/4261/5835/files/CRInstalled3.jpg?v=1754341937.
  - The "DELMO" face looks rearward: its engraving faces the camera in CRInstalled3, which is behind the engine.
  - So in NewCR1, photo-left is the driver side.
- **Delmo's warnings** for this layout:
  - "Designed for applications with a deep firewall like most pickups"
    (https://delmospeed.com/products/delmos-coil-relocation-kit);
  - "Some applications require the oil sensor to be relocated or deleted" (the current Delstributor listings,
    https://delmospeed.com/products/delstributor).

## 3. Which bolt holds the post

**Most likely the 12 o'clock bellhousing bolt.** The foot goes under its head, on the bell flange's rear face.

- CRInstalled3 shows the post's foot dropping into the joint between the block's rear top and the bellhousing top,
  centred. No other attachment is visible.
- The foot has one through hole: 10.5 ± 0.8 mm in NewCR1, at the 16.15 px/mm scale (section 4). That is an M10
  clearance hole. The hole's axis is square to the DELMO face, so it runs fore and aft.
- GM's own 6L80 install kit (19367014) bolts the trans with "8 11515768 Bolt M10x1.5x40", torqued to 58 Nm (43 lb-ft),
  and says "Install bracket from transmission kit under center top bolt". So the LS/6L80 pattern has a bolt at top
  centre, and GM already hangs a bracket under it. Source: `reference_documents/component_drawings/GM_Supermatic_6L80_Installation_Kit.pdf` p.2.
- On the owner's LS3 (IMG_0123, vehicle_images `7e2efddd-4593-472e-b554-2ec49f429910`, rear face, no trans), there is
  a tapped hole at top centre. It carried the crate lift bracket, and it sits within about 1.6° (about 7 mm) of the
  block's centre plane.
- **Bolt length:** 40 mm plus the foot's thickness at the pocket. The foot thickness is unknown; calipers on the part.
- **Confirm, owner on the truck:**
  - Is there a bolt at 12 o'clock on the 6L90's bell?
  - Does the foot sit flat under it?
  - Does the post have any anti-rotation? There's one bolt only, so ask Delmo (draft question in the lane report).
- No intake bolt and no valley-cover bolt is involved. The post never touches the intake, so the intake question
  (state 0ag(g)) does not change the mount. It only changes the clearance (section 7).

## 4. Dimensions, and how each was measured

**The ruler** is the coil bolt spread: 2 7/8 in = 73.0 mm (Delmo DELCB01). A bracket's two arm-tip holes take one
coil's two ears, so the holes are 73.0 mm apart. In NewCR1 they measure 1167 and 1192 px (driver and passenger
brackets): mean 1179 px, so 16.15 px/mm. The coil photo IMG_3918 uses the same spread: 398 px, so 5.45 px/mm.
Margins cover perspective (±3–5 %) and pick error.

| Dimension | Value | ± | How | Source |
|---|---|---|---|---|
| Post width | 52.6 mm | 2 | NewCR1 edges x 1095–1945 px | NewCR1 |
| Post depth (fore-aft) | unknown; drawn at 52.6 (square) | — | not visible in any photo | calipers on the part |
| Foot hole | Ø10.5 mm | 0.8 | NewCR1 rim 1255–1425 px | NewCR1 |
| Foot hole to the post centreline | 11.1 mm toward the driver side | 2 | NewCR1 (hole x 1340 px vs axis 1520 px) | NewCR1 |
| Post top above the foot hole | 127 mm | 4 | NewCR1 | NewCR1 |
| Post bottom below the foot hole | 16 mm | 3 | NewCR1 | NewCR1 |
| Arm-tip holes, radius from the post axis | 58.9 mm | 2 | 57.7 (driver) and 60.1 (passenger) | NewCR1 |
| Arm-tip depth (along the hole) | 36 mm | 3 | NewCR1 front bracket arm, 620 px, corrected for its height toward the camera | NewCR1 |
| Upper arm-tip holes above the foot hole | 146.6 mm | 4.5 | NewCR1 | NewCR1 |
| Lower arm-tip holes above the foot hole | 73.7 mm | 2.5 | NewCR1 | NewCR1 |
| Bracket web thickness | 11 mm | 2 | NewCR1 | NewCR1 |
| Bracket web screws | 2, 24.8 mm apart vertically | 2 | NewCR1 | NewCR1 |
| Coil axis, out from the ear line (radially) | 34 mm | 3 | 32.6 on the oblique face, foreshortening allowed | IMG_3918 |
| Coil axis, sideways from its bracket's centre plane | 22.7 mm | 3 | 0.63 × tip depth: tower centres vs arm-tip width, IMG_1101 (0.65) and IMG_3917 (0.61) | IMG_1101, IMG_3917 |
| Coil body height | 64.7 mm | 3 | | IMG_3918 |
| Coil body, radially | 16 in / 21 out of the axis | 3 | | IMG_3918 |
| Coil body, sideways | 36 mm | 5 | against the arm-tip width | IMG_1101, IMG_3917 |
| Tower | Ø17.4 mm, tip 31.9 mm above the upper ear | 2 | | IMG_3918 |
| Plug end | 92.8 mm below the upper ear (19.8 below the lower) | 3 | | IMG_3918 |
| Post-base height above the crank (h_F) | 0.242 m, a **photo estimate** | 0.035 | IMG_0123: the rear top-centre hole is 1241 px from the crank flange centre. Scale from the deck/head joint lines: they sit 234.7 mm from the crank (twin `dimensions_v3.json` deck height) and meet 331.9 mm above it, giving 5.02 and 5.23 px/mm | IMG_0123; tape needed |
| Bell flange at the 12 o'clock boss (t_bell) | **unknown**; world y drawn at 0 | — | not in any photo or document we hold | calipers |

**Self-checks.**
- The coil's body (64.7 mm) plus its lower-ear overhang (8.2 mm) closes to the 73.0 spread.
- The four brackets' arms line up at one height once NewCR1's perspective is taken out (the front bracket's arms stand
  about 40 mm nearer the camera).

## 5. The circle in the twin (COIL-1..8)

**The post base F** (the foot bolt's axis, at the foot's bearing face) is at world (0.000, −1.400 + t_bell, 0.962).
- Twin frame: +x driver, −y forward, +z up.
- F sits on the twin's engine root (0, −1.400, 0.720), plus h_F. The root itself is not taped (twin HANDOFF, open
  unknown 1).

**The post axis** is at x −0.011, y −1.374 + t_bell, vertical, from z 0.946 to 1.089.

**Every coil shares these heights:**
- tower tip z 1.141
- body 1.044 to 1.109
- lower ear 1.036
- plug end 1.016, mating from below

Relative to F these are good to about ±5 mm; absolutely, ±35 mm, which is h_F's margin. Azimuth is measured from
forward toward the driver side, seen from above.

| Coil | Cylinder | Bracket, which side of the pair | Azimuth | Axis x, y (m) | Outer face looks | Ear-bolt heads | Plug wire (Delmo set) |
|---|---|---|---|---|---|---|---|
| COIL-1 | 1 | front, driver side | 13.7° | 0.0115, −1.4666 | forward | driver side | 43 in |
| COIL-3 | 3 | driver, front | 76.3° | 0.0818, −1.3964 | driver | forward | 40 in |
| COIL-5 | 5 | driver, rear | 103.7° | 0.0818, −1.3510 | driver | rearward | 36 in |
| COIL-7 | 7 | rear, driver side | 166.3° | 0.0115, −1.2808 | rearward | driver side | 32 in |
| COIL-8 | 8 | rear, passenger side | 193.7° | −0.0338, −1.2808 | rearward | passenger side | 32 in |
| COIL-6 | 6 | passenger, rear | 256.3° | −0.1040, −1.3510 | passenger | rearward | 36 in |
| COIL-4 | 4 | passenger, front | 283.7° | −0.1040, −1.3964 | passenger | forward | 40 in |
| COIL-2 | 2 | front, passenger side | 346.3° | −0.0338, −1.4666 | forward | passenger side | 43 in |

- **Add t_bell to every y.** The margin is ±6 mm relative to the post; world positions add the root, t_bell and the
  post depth.
- The ring reads 1-3-5-7 down the driver half and 2-4-6-8 down the passenger half. The whole cluster spans x −0.125 to
  +0.103 and y −1.488 to −1.260 (+ t_bell).
- This replaces the 4 × 2 grid ANCHOR_coil_1..8 (`twin_engine_anchors.json`, "numbered by position only") and the flat
  E3_DelStributer_Plate in the v3 twin.

## 6. Which cylinder each coil fires

**COIL-n fires cylinder n:** its plug wire goes to cylinder n's plug. This follows the registry name "LS coil n".

- **Cylinder numbering:** 1, 3, 5 and 7 on the left (driver) bank and 2, 4, 6 and 8 on the right, counted from the
  front (1977 LTSM p.518, `reference_documents/k5_factory_docs/1977_Light_Truck_Service_Manual.pdf`; the same
  convention `catalog/mounts.yaml` uses for the injectors). GM's 1987 manual defines the side: "odd numbered
  cylinders are in the left bank, when viewed from the rear of the engine"
  (`reference_documents/service_manuals/1987_Chevy_Service_Manual.pdf` p.493). Seen from the rear, left is the driver
  side. The GM LS3 documents we hold give "odd" and "even" coil
  banks without naming sides (LS3 E-ROD guide pp.9–10). The side mapping rests on the GM convention.
  - Discrepancy, not resolved here: state row 0i paraphrases Dave's harness sketch as "injectors 8-6-4-2 (D) /
    7-5-3-1 (P)", which is the reverse. Look at the sketch itself. If it is right about this engine, the two halves of
    the table in section 5 swap sides.
- **LS3 firing order:** 1-8-7-2-6-5-4-3 (`LS3_Long_Block_Installation_Guide.pdf` p.5; `Marine_LS3_6.2L_Specs.pdf`
  p.3).
  - Each coil has its own ECU output, so unlike a real distributor cap the ring does not have to follow the firing
    order.
- **Proposed ring order** (the owner's or Dave's call):
  - each bank's four coils on that bank's half of the ring;
  - the most forward coil to the most forward cylinder;
  - so the eight wires fan out to their own side without crossing.
  - Delmo's set has two wires of each length. The two 43 in go to cylinders 1 and 2 and the two 32 in to 7 and 8.
    The coil end is cut to fit anyway.
- **Not settled here (substrate inconsistency, left alone): which M130 output drives which coil.**
  - `output/K5_coil_mapping.md` says IGN_LS(n) fires cylinder n, with wire #24 on A03.
  - Cut list v4.2 and `k5_registry.json` put wire #5 ("coil 3") on A03 and #24 ("coil 1") on A13, i.e. IGN_LS1..8 →
    coils 3, 5, 7, 2, 4, 6, 8, 1.
  - `M130_PINOUT_TRIANGULATION_MATRIX.md` reads the second pattern as the "DEL-Stributor mapping", but
    K5_coil_mapping.md says the opposite.
  - The geometry here does not depend on it. The M1 GPR ignition-output-to-cylinder table (MoTeC) settles it.

## 7. Fit against the engine and the truck

These use the working values (h_F 0.242, t_bell 0, square post). None is decided here. Each needs a tape or the owner's
eyes.

1. **Firewall.**
   - The rear pair (COIL-7, COIL-8) reaches about 0.140 m + t_bell behind the bell face, at z 1.02–1.16.
   - The twin's firewall at the centreline is only 0.033 m behind the bell face: a ray cast on `Under_Main_Blazer`
     at x 0, z 0.95–1.25 hits y −1.367.
   - The real firewall has a large centre dish behind the throttle body (IMG_6531, vehicle_images
     `95eafee3-72c4-4637-b9b0-65aeeae70fbc`).
   - Delmo sells this kit for "a deep firewall like most pickups".
   - Either the dish gives the room, or the engine sits further forward than the twin puts it, or the rear pair won't
     fit.
   - Tape: block rear face to the firewall dish at the centreline, at bolt height + 0.10–0.20 m.
2. **Oil-pressure sensor.**
   - COIL-1 (front bracket, driver side) and its plug land over the Gen IV oil-pressure sensor. On the owner's block it
     threads into the rear top, about 40 mm driver-side of centre (IMG_0123).
   - The twin's ANCHOR_oil_psi (0.025, −1.48, 0.99) sits inside COIL-1's footprint seen from above, 26 mm under its
     plug end, exactly where COIL-1's mating plug and leg go.
   - Delmo: "Some applications require the oil sensor to be relocated or deleted".
   - The build uses the sensor (oil PSI #102 on M130 AV5). If it hits, moving it is an owner/Dave call.
3. **Intake.**
   - The front pair's outer faces reach about 0.088 m ahead of the bell face.
   - The twin's intake port flanges for cylinders 7 and 8 end at y −1.534 / −1.510 (z 0.976–1.05). That is about 22 mm
     clear, inside the margin.
   - The intake on the truck is still unresolved (state 0ag(g)). Check the rear runners and the fuel-rail rear
     fittings with the cluster offered up.
4. **Bellhousing.**
   - A base at crank + 0.242 needs the bell flange to reach that high.
   - The twin's E3_6L90_Bell (an estimated 440 mm envelope) stops at crank + 0.22.
   - The h_F tape settles both.
5. **Hood.** Boots at about z 1.16–1.18, against the twin's hood and cowl skin at about 1.35–1.40. Fine for now.
6. **Fuel regulator.** Not in the way. The Aeromotive regulator is at the front of the valley (state 0ag(h) as
   corrected on main).
   - `catalog/mounts.yaml` FUELP still carries the old reason ("The spot behind the intake that the DEL-Stributor needs
     holds the Aeromotive regulator"). It's flagged in the receipt, not edited here.

## 8. The coil harness around the circle

**Recommendation: a split star.** One Y sits on the driver side of the post, just below the plug ring, where the engine
trunk arrives from the 61-pin. The 61-pin is at the driver-side fuse-box hole (`catalog/mounts.yaml` FIREWALL-61).
From the Y, two 4-coil stars:
- the driver half: COIL-1, 3, 5, 7;
- the passenger half: COIL-2, 4, 6, 8.

**Each leg** carries its coil's four wires into the plug from below: a chassis ground, b signal ground, c trigger,
d +12 V (the registry's COIL-n cavities, Dave's pinout).

**Power.**
- 16 AWG comes in to the Y, with a 16+18+18 splice there.
- Each 18 AWG half then feeds its four coils through three 18+18+18 stub splices.
- That is the same seven D-609-05 splices the registry already lists for RAIL-COIL_PWR, only split 1 + 3 + 3.
- Nothing changes in gauge or splice type.
- Upstream of the Y, the path depends on where the engine PDM goes (state 0ag(b), 0ah: open). Not drawn.

**Grounds.**
- Each half's four a-grounds and four b-grounds leave the star for the back of that side's cylinder head. That gives
  four rings, 4 × 18 AWG each, with chassis and signal kept apart, as the registry has it (COIL-GROUND-RINGS; Swap
  Specialties LS install p.4: "fastened to the back of the cylinder head").
- Ground legs never chain from coil to coil (chapters/17 §17.4.1; §17.4.6, sensor grounds direct on the head).
- The holes are picked on the bench. Their thread is unknown (RING-SMALL is open).

**Why not the other two layouts.**
- **A ring loom round the post.** It would wrap the post, so the cluster couldn't come off without unplugging and
  unthreading the loom. It would also cross the post's rear face, where the foot bolt's head sits in its pocket.
- **One eight-way star.** It sends the four passenger legs round the post, between the post and the intake, which is
  the tightest space in the cluster. That space is also where COIL-1 meets the oil-pressure sensor.
- **The split star:**
  - keeps every leg short and on its own side;
  - matches the driver/passenger trunk split in Dave's harness sketch (state 0i: "trunk split D/P");
  - makes the ground runs to the heads the shortest.

**Construction notes.**
- Ties every 75 mm on branches, 150 mm on the trunk (chapters/16 §8.5).
- The coil-trunk Y is one of the K5's named Y-splices. It needs an AS81765/1 transition boot, PN still to be
  documented (chapters/16 §7.4).
- The Y's size waits on the laid-up bundle (chapters/18 §6–7).

**Tight spot.** At the working values, the plugs' wire exits sit only about 20–50 mm above the bell top, so each leg
turns up into its plug in a small space. Dave's method applies (chapters/18 §4): max length first, mock-up on the
truck, cut last.

## 9. Needs a tape, calipers or the owner's eyes

1. **Coil part numbers.** The GM number on each of the 8 coils going on, and how many of each style.
2. **The bolt.**
   - Is there a 12 o'clock bolt on the 6L90 bell?
   - Does the post foot sit flat under it?
   - Bolt length = 40 mm + the foot's thickness.
3. **h_F.** Crank centreline (balancer bolt) to the 12 o'clock bell bolt, vertical.
4. **t_bell.** Bell flange thickness at that boss (calipers).
5. **Post on the bench (calipers).**
   - depth (fore-aft);
   - foot thickness at the pocket;
   - arm-tip thread;
   - then, with all 8 coils bolted on, the tower-to-tower distance across the ring (checks the 191 mm diameter).
6. **Firewall depth.** Block rear face to the firewall dish at the centreline, at bolt height + 0.10–0.20 m.
7. **Oil-pressure sensor.** Its centre relative to the 12 o'clock bolt (sideways, fore-aft, height of its plug top),
   or a photo with the cluster offered up.
8. **Plug latches.** Which way each coil plug's latch faces once bolted up (not visible in any photo).

## 10. Sources

**Delmo Speed product data**, Shopify product JSON read 2026-09-29, one request per 10 s:
- del-stributer (DELSTRIB01)
- ls-2-coil-relocation-bracket (DELCB01)
- delmos-coil-relocation-kit
- delstributor / delstributor-kit (published 2026-09-24)
- vintage-plug-wires (DELPW03)
- ls-coil-harness (DELCH01)
- sparkplug-wire-crimp-tool (CRP)

**Delmo photos:** the URLs in sections 1–3.

**Owner's orders:** Gmail (Delmo order confirmations and shipping notices; the numbers and dates are in the lane report,
not here); `receipts` table (Delmo Speed, DELPW03); `vehicle_observations` COIL-1..8 device-proof rows (eBay).

**Owner's photos** (vehicle_images):
- IMG_1101 `71a33780-0884-4df5-bbbd-582b1165d084`
- IMG_0123 `7e2efddd-4593-472e-b554-2ec49f429910`
- IMG_6531 `95eafee3-72c4-4637-b9b0-65aeeae70fbc`

**GM and service documents** (`reference_documents/`):
- `component_drawings/GM_Supermatic_6L80_Installation_Kit.pdf` p.2
- `component_drawings/LS3_Long_Block_Installation_Guide.pdf` p.5
- `component_drawings/Marine_LS3_6.2L_Specs.pdf` p.3
- `k5_factory_docs/1977_Light_Truck_Service_Manual.pdf` p.518
- `component_drawings/Swap_Specialties_LS_Installation_Instructions.pdf` p.4
- `component_drawings/LS3_EROD_Installation_Guide.pdf` pp.9–10

**Twin:**
- `docs/wiring/calc-data/twin_engine_anchors.json`
- `docs/wiring/twin/dimensions_v3.json`
- `docs/wiring/twin/HANDOFF.md`
- the v3 blend, read in a copy: object bounds; ray casts on `Under_Main_Blazer`

**Canon:** `docs/wiring/chapters/16-wire-and-protection-canon.md` §7.4, §8.5;
`17-power-architecture-ecu-pdm.md` §17.4; `18-construction-and-segmentation.md` §4, §6–8.
