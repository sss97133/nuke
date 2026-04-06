# WIRE ROUTING GUIDE — 1977 Chevrolet K5 Blazer LS3/Motec

**Vehicle:** 1977 K5 Blazer, VIN CCL187Z210370
**Engine:** Delmo Speed LS3 6.2L
**ECU:** Motec M130 (firewall, passenger side)
**PDM:** Motec PDM30 (firewall, passenger side — under dash)
**Generated:** 2026-04-04

This document maps every physical wire path through the truck. Not schematics — the actual step-by-step route from connector to component, with grommets, clips, protection, and hazards.

All distances are ESTIMATED. Tape-measure every run on the truck before cutting wire.

---

## TABLE OF CONTENTS

1. [Vehicle Reference Points](#vehicle-reference-points)
2. [Route 1: Firewall to Engine (Engine Loom)](#route-1-firewall-to-engine-engine-loom)
3. [Route 2: Firewall to Front Lighting](#route-2-firewall-to-front-lighting)
4. [Route 3: Dash to Driver Door](#route-3-dash-to-driver-door)
5. [Route 4: Dash to Passenger Door](#route-4-dash-to-passenger-door)
6. [Route 5: Firewall to Rear (The Big Run)](#route-5-firewall-to-rear-the-big-run)
7. [Route 6: Underbody / Engine Bay Ancillaries](#route-6-underbody--engine-bay-ancillaries)
8. [Route 7: Power Cables](#route-7-power-cables)
9. [Route 8: Audio System](#route-8-audio-system)
10. [Route 9: Transmission and Drivetrain](#route-9-transmission-and-drivetrain)
11. [Route 10: Cab Clearance and Roof](#route-10-cab-clearance-and-roof)
12. [Firewall Penetration Map](#firewall-penetration-map)
13. [Grommet and Hardware Schedule](#grommet-and-hardware-schedule)
14. [Protection Standards](#protection-standards)
15. [Keep-Away Zones](#keep-away-zones)

---

## VEHICLE REFERENCE POINTS

Understanding the K5 Blazer body structure is critical for routing. This is NOT a pickup truck with a separate bed — it is a one-piece SUV body bolted to a ladder frame.

### Key Dimensions (from 1971 Blazer 4x4 frame drawing)
- **Overall frame length:** 168.86"
- **Wheelbase:** 104.00"
- **Frame rail width (outside):** ~33-34" (varies front to rear)
- **Front axle centerline to firewall:** ~28"
- **Rear axle centerline to rear bumper:** ~33"

### Landmark Locations (driver's perspective, sitting in the truck)
- **Battery:** Passenger side, behind right headlight, on inner fender / battery tray
- **M130 ECU:** Firewall, passenger side, approximately centered vertically
- **PDM30:** Under dash, passenger side, mounted to the firewall interior face
- **Fuse/relay area:** Near PDM30, under dash passenger side
- **Factory bulkhead connector (C100):** Firewall, driver side, approximately 6" right of steering column — held by two diagonal screws
- **Heater box:** Center of firewall, inside the cab
- **Steering column:** Passes through firewall at driver center
- **Brake booster (iBooster):** Firewall, driver side, above the steering column penetration
- **Radiator support:** Bolted between fender tops, directly above radiator
- **Front crossmember:** Below radiator, engine mount attachment point
- **Transfer case:** Behind transmission, center of vehicle, approximately under the front seats
- **Rear axle:** Centered under the rear cargo area
- **Fuel tank:** Passenger side, under the rear cargo floor, behind the rear axle
- **Tail light housings:** Rear body panel, each side, accessible from inside the cargo area

### K5 Blazer Body Structure
Unlike C/K pickup trucks, the K5 Blazer has a SINGLE body shell from firewall to tailgate. There is no separate bed. The body is one continuous welded structure with:
- Cab area (front seats, dash)
- Rear passenger / cargo area (rear seat folds, open cargo behind it)
- Removable fiberglass top (1969-1975) or fixed steel top (1976-1991)
- Rear endgate (drop-down tailgate that also swings to the side)

Wiring to the rear does NOT need to cross a cab-to-bed gap (as on pickup trucks). Instead, wires can route INSIDE the body along the rocker panels, under the carpet, or OUTSIDE along the frame rails.

---

## ROUTE 1: FIREWALL TO ENGINE (ENGINE LOOM)

**Wires:** 27 engine loom wires (all coils, injectors, sensors)
**From:** M130 Connectors A+B, mounted on the firewall passenger side, engine bay face
**To:** Various engine components (valve covers, intake, block, front, rear)
**Estimated total route length:** 2-5 ft depending on branch

### Step-by-Step Route

#### Step 1: Exit M130 Connectors
- M130 sits on the engine-bay face of the firewall, passenger side
- Connector A (34-pin) and Connector B (26-pin) face downward or outward
- All 27 wires originate here as a single trunk
- Trunk diameter at M130 exit: approximately 0.72"

#### Step 2: Run Along Firewall to Engine Centerline
- From M130, the trunk routes LEFT (toward driver side) along the upper firewall
- Stay ABOVE the engine — route along the firewall face, 2-3" below the cowl/windshield base
- Use adel clamps (cushioned P-clamps) every 8-10" to secure the trunk to the firewall
- Cross over the engine — the trunk passes above the intake manifold valley
- The trunk reaches the engine centerline approximately 18-24" from M130

**Hazard:** The trunk passes above the rear of the engine. On the LS3 with headers/exhaust manifolds, ensure at least 2" clearance from any exhaust surface. If headers route close to the firewall, add Raychem DR-25 heat shrink or DEI heat sleeve to the trunk section nearest the exhaust.

**Hazard:** Accessory belt and A/C compressor are on the passenger side. Keep the trunk above and behind these components. Do not let wires drape across the belt path.

#### Step 3: Main Branch Point (Intake Valley)
- At the center of the intake manifold valley, the trunk fans out into 6 branches
- This is the primary branch point — mark it with a branch label
- The intake manifold valley on an LS3 is a natural "highway" for wiring — the valley between the valve covers provides a sheltered channel

#### Step 4: Branch 1 — Driver Valve Cover (8 wires: Coils 1,3,5,7 + Injectors 1,3,5,7)
- From the branch point, the 8-wire sub-harness turns LEFT along the driver (left) valve cover
- Route along the inboard edge of the valve cover, between the valve cover and the intake manifold
- At each cylinder (front to rear: 1, 3, 5, 7), one coil wire and one injector wire break off
- Each breakoff drops approximately 2" to reach the coil pack connector
- Leave 6" pigtail at each coil/injector for service access
- Secure the main rail to valve cover bolts or existing studs with tie-down points every 4-6"
- **Protection:** Harness tape (Tesa 51036) wrapping the rail, DR-25 over the pigtail drops
- **Hazard:** Driver exhaust manifold/header is directly below — maintain 2" minimum clearance from all coil pigtails to exhaust surfaces

#### Step 5: Branch 2 — Passenger Valve Cover (8 wires: Coils 2,4,6,8 + Injectors 2,4,6,8)
- Mirror image of Branch 1, routing RIGHT along the passenger valve cover
- Same construction: inboard edge, breakoffs at each cylinder
- Same 6" pigtail, same tie-down spacing
- **Protection:** Same as Branch 1
- **Hazard:** Passenger exhaust manifold/header below, plus A/C compressor and accessory belt on this side. Extra care with routing near the accessory drive

#### Step 6: Branch 3 — Front of Engine (2 wires: CMP shielded + CLT)
- From the branch point, these 2 wires route FORWARD along the top of the engine
- Pass over the front of the intake manifold, then drop down to the timing cover area
- CMP sensor is on the front timing cover (typically upper left or right, varies by LS3 cam sensor location)
- Coolant temp sensor is in the front of the cylinder head or intake (driver side head, typically)
- Route the CMP shielded cable on the OUTSIDE of the bundle, separated from coil/injector power wires by at least 1"
- **Protection:** 1/4" split loom where exposed near the front of the engine. The water pump and serpentine belt are nearby.
- **Hazard:** Keep both wires away from the serpentine belt path and any pulleys. Keep CMP shielded cable away from the alternator (EMI source)

#### Step 7: Branch 4 — Rear of Engine (1 wire: CKP shielded)
- From the branch point, the CKP shielded cable routes REARWARD
- Pass behind the intake manifold, drop down behind the engine block
- The LS3 58x crank position sensor is at the rear of the block, passenger side, just above the bellhousing flange
- Route the cable between the block and the firewall, dropping down the passenger side of the block
- **Protection:** DR-25 heat shrink over the full length. This is the most EMI-sensitive wire in the vehicle.
- **Hazard:** The starter motor is directly below and to the right. Route the CKP cable at least 2" from the starter motor and its power cable. Starter motor EMI is a major source of false crank position errors.
- **Hazard:** Keep at least 2" from all ignition coil wires, alternator output wire, and injector drive wires

#### Step 8: Branch 5 — Block Sensors (4 wires: KS1 shielded, KS2 shielded, OPS, OTS)
- From the branch point, these 4 wires drop DOWN into the engine valley, between the exhaust manifolds
- Knock Sensor 1 (shielded): breaks off to the driver side of the block, below the exhaust manifold. Access from below.
- Knock Sensor 2 (shielded): breaks off to the passenger side of the block, below the exhaust manifold. Access from below.
- Oil Pressure Sensor: routes to the rear driver side of the block (near the distributor/coil pack area on the old engine, above the oil filter on LS3)
- Oil Temperature Sensor: routes to the oil pan or block boss, typically driver side
- **Protection:** HIGH-TEMP split loom (3/8") rated to 300F minimum — these wires run between exhaust manifolds
- **Hazard:** This is the hottest zone in the engine bay. Both exhaust manifolds are within inches. Use silicone-insulated wire or high-temp split loom. Consider DEI titanium exhaust wrap or heat shield on adjacent header tubes.

#### Step 9: Branch 6 — Top of Intake (4 wires: ETB, MAP, IAT, FPS)
- These wires stay at the top of the intake manifold, shortest runs
- Electronic Throttle Body: front of intake, 6-pin connector (actually needs 6 wires — see build sheets note)
- MAP Sensor: rear of intake manifold, Bosch 3-pin
- Intake Air Temp: in an intake runner or MAF housing
- Fuel Pressure Sensor: on the fuel rail, driver side
- **Protection:** Harness tape only — this is a low-heat, sheltered zone on top of the intake
- **No significant hazards** — this is the coolest, most protected area of the engine

### Engine Loom Clip/Mount Points
| Location | Mount Method | Spacing |
|----------|-------------|---------|
| Firewall (M130 to centerline) | Adel clamps (cushioned P-clamps) to firewall | Every 8-10" |
| Intake valley (main trunk) | Tie to intake manifold bolts or studs | Every 6-8" |
| Valve cover rails (B1, B2) | Tie to valve cover bolts or bracket | Every 4-6" |
| Block sensor drops (B5) | Tie to head bolt or block boss | 1-2 points |
| Front engine (B3) | Tie to timing cover bolt or bracket | 1-2 points |
| Rear engine (B4) | Tie to bellhousing bolt or block boss | 1-2 points |

### Inline Connector Location
- Place a SINGLE inline connector (Deutsch DT 12-pin or similar) at the firewall penetration point
- This allows the entire engine loom to disconnect from the vehicle for engine removal
- All 27 engine wires pass through this connector
- Alternative: use two smaller connectors (Deutsch DTM 12-pin) — one for Connector A wires, one for Connector B wires

### Estimated Wire Lengths for Engine Loom
| Branch | Route | Estimated Length |
|--------|-------|-----------------|
| Trunk (M130 to branch point) | 18-24" | ~2 ft |
| B1 Driver VC (branch to cyl 7 rear) | 24-30" | ~2.5 ft |
| B2 Passenger VC (branch to cyl 8 rear) | 24-30" | ~2.5 ft |
| B3 Front engine (branch to timing cover) | 18-24" | ~2 ft |
| B4 Rear engine (branch to CKP) | 12-18" | ~1.5 ft |
| B5 Block sensors (branch to KS/OPS/OTS) | 12-24" | ~1.5 ft |
| B6 Intake top (branch to ETB/MAP/IAT/FPS) | 6-12" | ~1 ft |
| **Longest single wire** (M130 to Cyl 7/8 rear coil) | | **~4.5-5 ft** |

---

## ROUTE 2: FIREWALL TO FRONT LIGHTING

**Wires:** 11 wires (headlights L/R, turns L/R, parking L/R, markers L/R, horn, wiper motor, washer pump)
**From:** PDM30 (under dash, passenger side) through firewall
**To:** Headlights, turn signals, parking lights, markers, horn, wiper motor, washer pump
**Estimated route length:** 4-7 ft per wire

### Step-by-Step Route

#### Step 1: Exit PDM30 Through Firewall
- PDM30 is mounted inside the cab, on the firewall, passenger side
- The front lighting wires exit the PDM30 connectors and pass through the firewall
- Use the SAME grommet hole as the engine loom if space permits, OR drill a separate 1.5" hole in the firewall approximately 4" from the engine loom grommet
- If using a separate hole: position it on the passenger side of the firewall, below the cowl line, above the heater box. Deburr the hole and install a rubber grommet. Seal with RTV.
- The 11-wire bundle diameter is approximately 0.40" — it will fit through a standard 3/4" ID grommet

#### Step 2: Route Along Upper Firewall (Engine Bay Side)
- Once through the firewall, the trunk routes along the upper firewall toward the DRIVER side
- This follows the factory forward lamp harness routing visible in the base layer images
- Secure with adel clamps every 8-10" along the upper firewall

#### Step 3: Route Forward Along Driver Fender Well
- At the driver side corner of the firewall, the trunk transitions forward
- Route along the UPPER INNER FENDER — the flat shelf where the inner fender meets the cowl/firewall
- This is above the engine, in the valley between the fender and the engine compartment
- Continue forward along the inner fender toward the radiator support

#### Step 4: Branch Point at Radiator Support
- Where the inner fenders meet the radiator support (the structural crossmember behind the grille), the trunk splits
- This is the main front lighting branch point

#### Step 5: Branch 1 — Driver Side (4 wires: headlight L, turn L, parking L, marker L)
- From the radiator support, route LEFT along the back face of the radiator support
- The headlight connector is at the headlight bucket, accessed from behind
- Turn signal, parking, and side marker are in the front fender assemblies
- On the 73-87 C/K series, the front lights mount to the radiator grille lower panel and fender assembly
- Route wires behind the headlight bucket to each fixture
- **Protection:** 3/8" split loom — this area is exposed to road spray, heat, and engine vibration
- Terminate with weatherpack or Metri-Pack sealed connectors at each fixture

#### Step 6: Branch 2 — Passenger Side (4 wires: headlight R, turn R, parking R, marker R)
- From the radiator support, route RIGHT along the back face of the radiator support
- Cross BEHIND the radiator (between the radiator and the engine)
- On 73-87 trucks, the forward lamp harness crosses behind the radiator core support, secured to the radiator support crossmember with factory clips
- Route to passenger headlight and fender fixtures
- **Protection:** 3/8" split loom
- **Hazard:** Keep wiring away from radiator fan path. Electric fans on this build — ensure no wire can contact the fan blades. Use rigid split loom and secure every 6" near the fan area.

#### Step 7: Branch 3 — Center (3 wires: horn, wiper motor, washer pump)
- Horn: routes from radiator support area to horn mount (typically on the radiator support or front crossmember, driver side). Short drop-down from the main trunk.
- Wiper Motor: routes from the firewall area — the wiper motor mounts on the COWL, at the base of the windshield, driver side. This wire may not need to go all the way to the radiator support — it can branch off early, staying on the firewall/cowl. Route it along the cowl behind the fender area.
- Washer Pump: routes to the washer reservoir, typically mounted on the inner fender, driver side. Branch off with the wiper motor wire.
- **Protection:** 3/8" split loom for the horn wire (exposed to road spray). Harness tape for wiper/washer (protected under cowl).

### Front Lighting Clip/Mount Points
| Location | Mount Method | Spacing |
|----------|-------------|---------|
| Firewall to fender corner | Adel clamps to firewall | Every 8-10" |
| Along inner fender | Adel clamps to fender shelf | Every 8-10" |
| Radiator support crossmember | Factory-style push-in clips or adel clamps | Every 6" |
| Behind headlight buckets | Tie to headlight adjuster bracket | 1-2 points per side |

### Inline Connector Location
- Place inline connectors (Weatherpack 4-pin) at each headlight bucket, behind the light
- This allows headlight removal without cutting wires
- Horn, wiper, and washer can use individual weatherpack 2-pin connectors at each component

---

## ROUTE 3: DASH TO DRIVER DOOR

**Wires:** 5 wires (window motor, lock actuator, door switch, window master switch, lock switch)
**From:** PDM30 / dash loom branch point behind instrument panel
**To:** Inside the driver door
**Estimated route length:** 5-7 ft per wire

### Step-by-Step Route

#### Step 1: Route from PDM30 to A-Pillar
- From PDM30 (under dash, passenger side), the 5 wires route LEFT as part of the dash loom trunk
- They run behind the instrument panel, along the lower dash structure
- The trunk follows the factory I/P harness channel — a natural channel behind the dash pad, above the heater/defroster ducting
- At the driver A-pillar (the vertical post between windshield and door), the 5 door wires break off from the main dash trunk

#### Step 2: Route Down the A-Pillar
- From the A-pillar area, the 5 wires drop down toward the lower door hinge area
- Route along the kick panel / cowl side panel on the driver side
- The wires need to transition from the fixed cab body to the moving door

#### Step 3: Through the Door Boot / Conduit
- The 73-87 C/K trucks use a rubber wire boot (conduit) at the door hinge area
- **Factory location:** The boot passes from the cab (A-pillar/cowl area) to the door, roughly midway between the upper and lower hinges
- **Boot specification:** The factory boot is riveted to both the cab and the door shell. The boot has one end slightly larger than the other — the larger end goes on the door side.
- **Hole size:** approximately 1-1/4" diameter hole in both the cab pillar and the door shell
- **Grommet:** Install a rubber grommet in each hole for extra protection. The wires pass through the grommet, through the flexible boot, and into the door.
- Classic Parts PN# 18-860 (1977-87 Power Window/Door Lock Wire Boot) is the correct replacement part
- **CRITICAL:** This is a flex point. The door opens and closes thousands of times. Use wires rated for flexing (TXL is good). Leave sufficient service loop (8") inside the door so the wires are not taut when the door is fully open.

#### Step 4: Inside the Door
- Once inside the door, the wires route along the inner door shell
- Follow the factory wire path: along the TOP of the inner door panel, behind the weather seal channel
- Window motor: routes to the window regulator motor, mounted inside the door approximately halfway down
- Lock actuator: routes to the door lock mechanism, near the door latch
- Door switch (jamb switch): mounts in the door jamb, not inside the door. This wire stays on the cab side of the boot — it terminates in the jamb/pillar area
- Window master switch: routes to the armrest/switch panel on the door panel
- Lock switch: routes to the lock switch on the armrest

#### Step 5: Terminate
- Each component inside the door gets a Weatherpack or Metri-Pack sealed connector
- Leave 8" service loop inside the door at the window motor and lock actuator

### Door Wire Protection
| Section | Protection |
|---------|-----------|
| Behind dash to A-pillar | Harness tape (dry, protected environment) |
| A-pillar to boot entry | 3/8" split loom |
| Through boot / conduit | Rubber boot provides the protection |
| Inside door | Harness tape, route along top of inner shell |

### Hazards
- **Pinch point:** The door hinge area is a pinch/shear zone. Ensure wires are not in the hinge gap when the door closes. The rubber boot keeps them in a safe path.
- **Window regulator:** The window motor and regulator mechanism move. Leave slack so the window motor wires do not get pulled by the regulator carriage.
- **Water intrusion:** Doors are not watertight. Water enters through window channels and weep holes. Route wires above the waterline inside the door. Use sealed connectors.
- **Sharp edges:** Door inner shells have stamped edges and spot-weld flanges. Add split loom or edge protection where wires cross any sharp metal edge.

---

## ROUTE 4: DASH TO PASSENGER DOOR

**Wires:** 4 wires (window motor, lock actuator, door switch, window switch)
**From:** PDM30 / dash loom branch point behind instrument panel
**To:** Inside the passenger door
**Estimated route length:** 7-9 ft per wire (longer than driver — must cross the full dash width)

### Step-by-Step Route

The passenger door route is a MIRROR of Route 3 (Driver Door) with one important difference: the wires must cross the full width of the dash.

#### Step 1: Route Across the Dash
- From PDM30 (passenger side), the 4 wires route RIGHT, staying behind the instrument panel
- They cross the heater box area (center of the firewall/dash) — route ABOVE or BELOW the heater ducting
- Continue to the passenger A-pillar
- This adds approximately 3 ft compared to the driver door route
- **Total estimated run:** 7-9 ft (vs 5-7 ft for driver side)

#### Step 2: Through the Passenger Door Boot
- Identical to driver side: rubber boot/conduit at the passenger hinge area
- Same 1-1/4" holes, same grommet, same boot part (may be mirror-image)
- Same flex-point precautions

#### Step 3: Inside the Passenger Door
- Window motor, lock actuator, and window switch route to their components
- Door switch mounts in the passenger door jamb — stays on the cab side of the boot
- Same protection, same service loops, same hazard awareness

### Note on Door Wire Count
The driver door has 5 wires (includes master window switch and lock switch that control both doors). The passenger door has 4 wires (window switch is passenger-only, no master lock switch needed).

---

## ROUTE 5: FIREWALL TO REAR (THE BIG RUN)

**Wires:** 14 wires through the frame rail, plus 3 cab clearance lights
**From:** PDM30 (under dash, passenger side)
**To:** Tail lights, backup lights, third brake light, side markers, license plate, fuel pump, camera, parking brake, cargo light
**Estimated route length:** 16-20 ft per rear wire

This is the longest and most complex route in the vehicle. On a K5 Blazer, the body is one piece (no separate bed), which gives you two routing options.

### Routing Option A: INSIDE THE BODY (Preferred for K5 Blazer)
Route wires inside the vehicle along the rocker panel area, under carpet/trim, from the dash to the rear body panels. This keeps wires protected from road debris, water, and corrosion.

### Routing Option B: ALONG THE FRAME RAILS (Traditional, works for all trucks)
Route wires along the inside of the frame rails, underneath the body. This is the factory method for rear body lighting on C/K trucks and works on K5 Blazers too.

### RECOMMENDED: Combination Approach
- Route the trunk from PDM30 DOWN through the floor (or through a rocker panel grommet) to the driver-side frame rail
- Run the main trunk along the driver-side frame rail from the cab to the rear
- At the rear axle area, wires exit the frame rail and route up into the body to reach their components

### Step-by-Step Route

#### Step 1: Exit PDM30 and Route to Floor/Frame
- From PDM30, the rear loom trunk (14 wires, ~0.55" diameter) routes DOWN and REARWARD
- **Option A (floor penetration):** Find or drill a 1" hole in the cab floor, driver side, behind the driver seat. Install a rubber grommet. The wires pass through the floor and drop down to the frame rail. This is the cleanest method on a K5 Blazer.
- **Option B (rocker panel):** Route the wires behind the driver kick panel, along the rocker sill (the bottom edge of the cab body), and exit through a grommet in the rocker panel near the rear of the cab. Wires then drop to the frame rail.
- **Option C (existing factory hole):** On 73-87 trucks, there are factory holes in the floor pan and rocker panels where the original rear body harness exits the cab. Look for existing grommeted holes behind the driver seat, near the rear of the cab floor pan. Use these if present.
- Seal all penetrations with RTV to prevent water and exhaust gas intrusion into the cab.

#### Step 2: Cab Clearance Lights Branch (3 wires)
- BEFORE the main trunk drops below the cab, 3 wires branch off UPWARD for the cab clearance lights
- These branch at the rear wall of the cab, inside the vehicle
- The 3 cab clearance light wires (#79, #90, #91) route UP behind the rear trim panel, along the roof edge
- Left clearance light: upper left corner of cab roof
- Center clearance light: top center of cab roof
- Right clearance light: upper right corner of cab roof
- On the K5 Blazer with a fixed steel top (1977), the roof wiring routes behind the headliner, along the drip rail channel
- Short runs — 3.5 ft each estimated
- **Protection:** Harness tape inside cab. Weatherpack connectors at each fixture.
- **Hazard:** If the 1977 K5 has a removable fiberglass top, these wires need a connector at the top-to-body junction so the top can be removed. On a fixed-top 1977+ Blazer, they can be hardwired.

#### Step 3: Attach to Driver-Side Frame Rail
- Once below the cab, the trunk attaches to the INSIDE face of the driver-side frame rail
- The frame rail is a C-channel, approximately 7" tall by 2.5" wide
- Route the trunk along the INBOARD face of the frame rail (the face toward the center of the vehicle), approximately 2" from the TOP of the rail
- This position keeps wires:
  - Away from road debris (inboard, sheltered by the frame)
  - Away from the body mount bolts and rubber isolators
  - Above most of the road spray zone
  - Clear of the rear leaf spring hangers and shackles

#### Step 4: Run Along Frame Rail — Cab to Rear Axle
- The trunk runs straight rearward along the driver frame rail
- Distance from rear of cab to rear axle: approximately 60-72" (5-6 ft)
- Secure with adel clamps (cushioned P-clamps) every 12" — bolt or self-tap into the frame rail
- Use 1/2" or 3/4" split loom over the entire frame rail section for protection from abrasion and road debris
- The trunk passes ABOVE the rear leaf spring front hanger mount (where the spring bolts to the frame)
- The trunk passes ABOVE or INBOARD of the body mount puck locations

**Hazards along the frame rail:**
- **Exhaust pipes:** The exhaust runs between the frame rails, on the underside of the vehicle. The catalytic converters (or mid-pipe on a long-tube header setup) are typically in the center of the vehicle. Maintain 6" clearance from exhaust components. If the exhaust route passes close to the driver frame rail, use DEI heat shield or re-route the exhaust.
- **Driveshaft:** The front driveshaft (front axle) and rear driveshaft run along the center of the vehicle between the frame rails. Do NOT let wires droop toward the center or they will contact the spinning driveshaft.
- **Transfer case:** Located behind the transmission, approximately under the front seat area. The transfer case linkage and output flanges are close to the frame rails. Route the trunk behind/above the transfer case, not across it.
- **Leaf spring shackles:** The rear springs have shackles that pivot as the suspension moves. Ensure wires are clipped to the frame ABOVE the shackle pivot range.
- **Brake lines:** Factory brake lines run along the frame rails. Do not bundle wiring with brake lines — a chafed wire could short and damage a brake line.

#### Step 5: Cross the Rear Axle Area
- At the rear axle, the frame rail trunk must navigate around the axle, leaf springs, and shock mounts
- Route ABOVE the axle — stay on the frame rail. The axle moves up and down with suspension travel; wires must be fixed to the frame and have enough slack at any crossover points to accommodate axle movement.
- Do NOT route wires over the top of the rear axle housing (it moves with the suspension)
- Do NOT route wires between the axle and the frame (they will get crushed)

#### Step 6: Exit Frame Rail to Body (Rear Corners)
- Behind the rear axle, the trunk continues along the driver frame rail for approximately 18-24" to the rear of the vehicle
- At the rear body panel area, the wires need to transition from the frame rail UP into the body
- **Transition point:** Look for factory holes in the rear body floor pan or rear wheelhouse area where the factory rear lamp harness entered the body. On the K5 Blazer, there are typically holes in the rear wheelhouse inner panels (the sheet metal above the rear axle, inside the body)
- Drill or enlarge a 1" hole if needed. Install a rubber grommet. Route the wires UP through the grommet from the frame rail into the rear cargo area.
- From inside the cargo area, the wires route behind the side trim panels to each tail light and marker

#### Step 7: Fan-Out to Rear Components
Once inside the rear body, the wires fan out to their destinations:

**Tail Lights (2 wires: #75 right, #81 left):**
- Route behind the rear quarter trim panels, one wire to each side
- Tail light housings are accessible from inside the cargo area (remove trim panel)
- Terminate with sealed connectors at each tail light socket

**Backup Lights (2 wires: #76 right, #89 left):**
- Same routing as tail lights — behind rear quarter trim to each backup light fixture
- On 73-87 C/K, backup lights are typically part of the tail light assembly or in a separate housing below

**Third Brake Light (1 wire: #93):**
- Routes to the upper center of the rear endgate area
- On the K5 Blazer, the third brake light (CHMSL) mounts on the endgate or above the rear glass
- If mounted on the endgate: wiring must cross the endgate hinge. Use a flexible wire boot at the endgate hinge, similar to a door boot. Leave service loop for endgate swing.
- If mounted above the rear glass (aftermarket): route wire behind the headliner/trim to the mounting location

**Rear Backup Camera (1 wire: #97):**
- Routes with the third brake light wire to the rear center
- Camera typically mounts on or near the license plate area or endgate handle
- May need additional conductors (power, ground, video signal) — verify camera wiring requirements
- Camera video cable may need shielding (coax or shielded multi-conductor)

**Rear Side Markers (2 wires: #77 left, #78 right):**
- Route behind rear quarter trim panels to marker light locations on the rear fenders/body sides
- Short drops from the tail light wiring path

**License Plate Light (1 wire: #92):**
- Routes to the rear bumper / endgate area
- License plate light is mounted on the rear bumper or endgate
- If on bumper: wire drops from rear body down to the bumper. Use a grommet where it passes through the bumper bracket.
- If on endgate: routes with third brake light wire through the endgate boot

**Fuel Pump (1 wire: #66, 10 AWG heavy):**
- This wire routes along the frame rail to the fuel tank area (passenger side, behind the rear axle)
- The fuel pump wire may need to CROSS from the driver-side frame rail to the passenger side where the tank is
- Cross-over point: at the rear crossmember behind the rear axle, route the fuel pump wire across the bottom of the crossmember, secured with adel clamps
- From the crossmember, route to the fuel tank sending unit / fuel pump access plate
- **Protection:** 1/2" split loom over the entire run — this is a 10 AWG wire carrying 30A
- **Hazard:** Keep away from exhaust. This wire is hot current — use high-quality split loom and secure every 12"

**Fuel Level Sender (1 wire: #98, 20 AWG):**
- Routes with the fuel pump wire to the fuel tank sending unit
- Bundle with fuel pump wire for the frame rail section

**Electric Parking Brake (1 wire: #54, 14 AWG):**
- Routes along the frame rail to the E-Stopp unit, mounted near the rear axle
- May be on a separate bracket near the brake caliper or rear axle housing
- Bundle with the main rear trunk for the frame rail section, then break off at the rear axle

**Cargo / Bed Light (1 wire: #74, 20 AWG):**
- Routes inside the body, behind trim, to the cargo area light fixture
- Can branch off from the main trunk as it enters the body at the rear

### Rear Loom Clip/Mount Points
| Location | Mount Method | Spacing |
|----------|-------------|---------|
| Under dash to floor penetration | Harness tape, tie to dash structure | Every 6-8" |
| Floor penetration | Rubber grommet, RTV sealed | -- |
| Frame rail (cab to rear axle) | Adel clamps bolted to frame rail | Every 12" |
| Rear axle area (transition) | Adel clamps, careful routing | Every 6" |
| Frame rail to body transition | Rubber grommet through floor/wheelhouse | -- |
| Inside rear body (to fixtures) | Harness tape, plastic clips to body panels | Every 8-10" |

### Inline Connector Locations
- **At the floor/frame rail transition (under cab):** Install a Deutsch DT 12-pin connector so the rear loom can disconnect from the cabin wiring. This allows body-off restoration or frame work without cutting wires.
- **At each tail light:** Weatherpack 2-pin connectors for individual fixture service
- **At the fuel tank:** Weatherpack 2-pin for fuel pump, 2-pin for fuel sender

### Estimated Wire Lengths
| Section | Distance |
|---------|----------|
| PDM30 to floor penetration | ~3 ft |
| Floor to frame rail attachment | ~1 ft |
| Frame rail: cab to rear axle | ~6 ft |
| Frame rail: rear axle to rear body | ~2 ft |
| Inside body: to tail lights | ~3 ft each side |
| Inside body: to fuel tank | ~4 ft (across to passenger side) |
| **Total longest wire** (PDM30 to far tail light) | **~15-18 ft** |

---

## ROUTE 6: UNDERBODY / ENGINE BAY ANCILLARIES

These are medium-length runs from the firewall to components in the engine bay, under the cab, and along the underside.

### 6A: Radiator Fans and Water Pump (4 wires)
**Wires:** #21 Fan 1 (12AWG), #22 Fan 2 (12AWG), #25 Water Pump (14AWG), #23 A/C Compressor (18AWG)
**From:** PDM30 through firewall
**To:** Radiator area and compressor

- Exit the firewall through the front lighting grommet or a shared engine bay grommet
- Route along the upper firewall, then down the PASSENGER side of the engine bay (where the A/C compressor and accessories live)
- Radiator fans: the electric fans mount on the radiator shroud. Route fan wires along the radiator support crossmember from the passenger side to the fan connector(s). Estimated run: 3-5 ft.
- Water pump: if electric (Meziere or similar), routes to the front of the engine. Follow the passenger inner fender to the front, then across to the water pump. Estimated run: 3-5 ft.
- A/C compressor clutch: short run from the firewall down to the compressor, mounted on the lower passenger side of the engine. Estimated run: 2-3 ft.
- **Protection:** 1/2" split loom — fan wires carry 18A each. These are in the hot, wet engine bay.
- **Hazard:** Fan blades. Absolutely no slack near fan path. Secure rigidly with adel clamps near the radiator.

### 6B: Wideband O2 Sensors (2 wires + controller)
**Wires:** #106 O2 Bank 1 (22AWG), #107 O2 Bank 2 (22AWG), #64 Wideband Controller (20AWG)
**From:** M130/PDM30 through firewall
**To:** Exhaust pipes (behind catalytic converters) and wideband controller

- The wideband controller (AEM, Innovate, or Bosch) typically mounts in the engine bay, on the firewall or inner fender
- Controller power wire (#64) is a short run from PDM30 through the firewall to the controller: ~2 ft
- The O2 sensor wires (#106, #107) run from the controller DOWN through the engine bay to the exhaust
- Route: from the controller, drop down along the passenger side of the engine bay, then route under the engine to each exhaust pipe
- Bank 1 (driver): O2 sensor bung is in the driver-side exhaust pipe, typically 6-12" after the header collector or behind the catalytic converter
- Bank 2 (passenger): O2 sensor bung is in the passenger-side exhaust pipe
- The O2 sensors come with their own pigtail harnesses (Bosch LSU 4.9 typically has 6 wires). The #106/#107 wires may be extensions or controller signal wires — verify with the wideband controller wiring diagram.
- **Protection:** HIGH-TEMP split loom rated to 500F for the last 12-18" near the exhaust bungs. Standard split loom for the rest.
- **Hazard:** EXTREME HEAT near exhaust. Catalytic converters reach 1200-1600F. Keep wiring as far as possible from converters. Use DEI heat shield if within 3".

### 6C: Vehicle Speed Sensor (1 wire)
**Wire:** #100 VSS (22AWG)
**From:** M130 through firewall
**To:** Transfer case or transmission tail housing

- Route from the firewall DOWN along the passenger side of the engine bay
- Continue under the vehicle, along the transmission tunnel
- The VSS is typically on the transfer case tail housing (NP205 or NP241) or the transmission output housing
- Follow the transmission tunnel — stay on the transmission/transfer case, secured to the crossmember or transmission mount bracket
- Estimated run: 8-11 ft from M130 to the VSS
- **Protection:** Split loom (3/8") for abrasion protection. This is under the vehicle exposed to road debris.
- **Hazard:** Driveshaft clearance. Route along the SIDE of the transmission tunnel, not underneath the driveshaft. Secure tightly to prevent drooping.

### 6D: AMP Research Power Steps (3 wires)
**Wires:** #1 Step Left (14AWG), #2 Step Right (14AWG), #3 Controller (14AWG)
**From:** PDM30 through floor or rocker panel
**To:** AMP Research step motors (rocker panels) and controller (center of cab underside)

- Route from PDM30, under the dash, down through the driver kick panel area
- Exit the cab through the ROCKER PANEL — drill a 3/4" hole in the rocker panel, install grommet, drop wires below the cab floor
- The AMP Research controller mounts under the cab, centered between the rockers, typically on a crossmember or cab mount bracket
- From the controller:
  - LEFT step wire routes along the driver rocker panel to the step motor. Secure to the rocker panel lip or pinch weld with adel clamps every 12".
  - RIGHT step wire routes across the underside of the cab to the passenger rocker panel, then along the rocker to the step motor.
- Estimated run: 8-11 ft per step wire
- **Protection:** 3/8" split loom. These wires are exposed to road spray, mud, and debris under the rocker panels.
- **Hazard:** Road debris impact. The rocker panel area takes direct hits from gravel and road spray. Use rigid conduit or heavy split loom. Secure with adel clamps at every mounting point.

---

## ROUTE 7: POWER CABLES

Power cables are routed SEPARATELY from signal wires. Heavy gauge cables generate magnetic fields and carry high transient currents. Keep at least 6" separation from sensor signal wires (CKP, CMP, KS, O2).

### 7A: Battery to PDM30 (6 AWG, ~3 ft)
**From:** Battery positive terminal (passenger side engine bay, battery tray)
**To:** PDM30 C01 M6 stud (firewall, passenger side, inside cab)

- Battery sits on the inner fender / battery tray, passenger side, near the headlight
- The PDM30 main feed cable routes from the battery positive terminal through the firewall to the PDM30 inside the cab
- Route: from battery, along the top of the inner fender (under the hood line), rearward to the firewall, through a grommet in the firewall, to the PDM30 M6 stud
- Install an 80A MEGA fuse within 12" of the battery positive terminal
- **Protection:** Split loom (1/2") for the engine bay section. The cable passes through a dedicated firewall grommet (separate from signal wire grommets if possible).
- **Hazard:** This is a direct battery feed. Any short on this cable will produce hundreds of amps until the fuse blows. Route away from sharp edges. Use high-quality ring terminals with heat-shrink boots.

### 7B: Battery to PDM30 Ground (6 AWG, ~3 ft)
**From:** Battery negative terminal
**To:** PDM30 A26 + B18 (both ground pins MUST be connected)

- Route with (or parallel to) the positive cable
- Both PDM30 ground pins must be connected — missing either will cause ground faults
- Ground cable routes through the same firewall penetration as the positive feed

### 7C: Battery to Starter (4 AWG, ~4-5 ft)
**From:** Battery positive terminal (or PDM30 starter output)
**To:** Starter solenoid (passenger side of engine, below and behind the exhaust manifold)

- Route: from battery, along the inner fender to the firewall, then DOWN along the passenger side of the engine to the starter
- The starter is at the rear of the engine, passenger side, bolted to the bellhousing
- This cable routes through the engine bay — keep clear of exhaust manifold and accessory belt
- A starter relay (solenoid) is mounted in the engine bay, typically on the inner fender or firewall. The 4 AWG cable goes from battery to relay, and a shorter 4 AWG cable goes from relay to starter.
- **Protection:** Split loom (1/2") or braided cable sheath
- **Hazard:** The starter cable is the heaviest current cable in the vehicle (150-300A during cranking). All terminals must be clean, tight, and protected from shorts. Use boot covers on all ring terminals.

### 7D: Alternator to Battery (8 AWG, ~4-5 ft)
**From:** Alternator output stud (front of engine, passenger side)
**To:** Battery positive terminal (or junction point near battery)

- The alternator is at the front of the LS3, typically on the passenger side (unless repositioned by the accessory bracket)
- Route: from alternator, along the passenger side of the engine bay, rearward along the inner fender to the battery
- Install a fusible link (or 100-120A MEGA fuse) within 18" of the alternator
- **Protection:** Split loom (3/8") — this wire is in the hot engine bay, near the alternator heat
- **Hazard:** The alternator output stud is always hot (connected to battery at all times). Cover the stud with a boot to prevent shorts.

### 7E: Engine Ground Strap (4 AWG braided, ~18")
**From:** Engine block (stud on rear of driver cylinder head)
**To:** Frame rail (bolt on driver frame rail, near engine mount)

- Braided ground strap, not solid wire — must be flexible to accommodate engine movement on mounts
- Use star washers or serrated flange bolts at both ends to ensure clean metal-to-metal contact
- Clean paint/coating from frame rail at ground point down to bare metal
- Apply anti-seize compound to prevent galvanic corrosion

### 7F: Chassis Ground (4 AWG, ~24")
**From:** Battery negative terminal
**To:** Frame rail (passenger side frame rail, near battery tray)

- Short, direct connection from battery negative to frame
- Clean bare metal at frame bolt point
- This is the main chassis ground — all other grounds reference this point

---

## ROUTE 8: AUDIO SYSTEM

### 8A: Front Speakers (2 pairs, ~6-7 ft each)
**Wires:** #26 Front L (18AWG), #27 Front R (18AWG) — EACH NEEDS + AND - PAIR
**From:** Head unit (center dash) or amplifier
**To:** Door speakers or kick panel speakers

- Route from the head unit behind the dash to the driver and passenger doors
- Follow the same dash loom path as the door wires (Routes 3 and 4)
- Speaker wires can share the door boot/conduit with the power window/lock wires
- Terminate at speaker connectors inside each door
- **Note:** Each speaker needs 2 conductors (+ and -). The cut list shows single wires — use 2-conductor speaker cable or double the wire count.

### 8B: Rear Speakers (2 pairs, ~18 ft each)
**Wires:** #28 Rear L (18AWG), #29 Rear R (18AWG) — EACH NEEDS + AND - PAIR
**From:** Head unit or amplifier
**To:** Rear quarter panel speaker locations

- Route from the head unit, under the dash, along the driver rocker panel area (under carpet/trim)
- Continue rearward inside the body to rear speaker locations
- On a K5 Blazer, rear speakers typically mount in the rear quarter panels or rear pillar area
- Keep speaker wires separated from power cables (amplifier power, fuel pump) to avoid noise/hum
- **Protection:** Harness tape — these are inside the vehicle

### 8C: Amplifier Power (8 AWG, ~18 ft)
**Wire:** #32 Amplifier (8AWG)
**From:** Battery or PDM30
**To:** Amplifier (rear cargo area)

- This is a HEAVY power wire — route separately from all signal/speaker wires
- Route from the battery (passenger side engine bay) through the firewall, UNDER the carpet along the passenger rocker panel, to the rear of the vehicle
- Use a dedicated firewall grommet for the amp power wire
- Keep on the OPPOSITE side of the vehicle from the speaker wires (speaker left side, amp power right side) to minimize electrical noise coupling
- Install an inline fuse (60A ANL) within 18" of the battery
- **Protection:** Split loom (3/8") for the full run
- Amplifier remote turn-on wire (#96, 22AWG) routes with the speaker wires — it is a signal wire

---

## ROUTE 9: TRANSMISSION AND DRIVETRAIN

### 9A: Transmission Controller (1 wire, short)
**Wire:** #58 Trans Controller (20AWG, 3.5ft)
**From:** PDM30
**To:** 6L80E TCM (mounted on firewall or under dash, near PDM30)

- Short local run — the TCM mounts near the PDM30
- Bundle with the dash loom trunk

### 9B: Transfer Case Indicator (1 wire, 11.5 ft)
**Wire:** #55 (16AWG)
**From:** PDM30
**To:** Transfer case position switch (on the transfer case, center of vehicle, under cab)

- Route from PDM30, through the floor or rocker panel (same penetration as the AMP Research wires), to the transfer case
- The transfer case is behind the transmission, approximately under the front seats
- Route along the transmission tunnel to the transfer case
- **Protection:** Split loom (3/8") — under-vehicle environment

### 9C: Neutral Safety Switch (1 wire, 11.5 ft)
**Wire:** #56 (14AWG)
**From:** PDM30
**To:** Transmission (6L80E neutral safety switch, side of transmission case)

- Routes with the transfer case wire along the transmission tunnel
- Bundle together for the shared routing segment

### 9D: Reverse Light Switch (1 wire, 11.5 ft)
**Wire:** #57 (18AWG)
**From:** PDM30
**To:** Transmission (reverse switch, side of transmission case)

- Routes with the neutral safety and transfer case wires
- All three transmission/drivetrain wires can share a single split loom trunk along the transmission tunnel

### Transmission Wire Bundle
All 3 wires (#55, #56, #57) route together:
1. Exit PDM30 under the dash
2. Drop through the floor (use same grommet as AMP Research wires, or a nearby penetration)
3. Route along the driver-side transmission tunnel to the transfer case area
4. #55 terminates at the transfer case
5. #56 and #57 continue forward along the transmission to their switch locations

**Protection:** 3/8" split loom for the full under-vehicle section
**Hazard:** Driveshaft clearance. Route along the side of the tunnel, not under the driveshaft.

---

## ROUTE 10: CAB CLEARANCE AND ROOF

### 10A: Cab Clearance Lights (3 wires, 3.5 ft each)
**Wires:** #79 Left (18AWG), #90 Center (18AWG), #91 Right (18AWG)
**From:** Rear loom branch point (inside cab, behind rear seat area)
**To:** Top of cab, drip rail area

Covered in Route 5, Step 2. Summary:
- Branch off from the rear loom BEFORE it exits the cab
- Route upward behind the rear cab trim panel
- Follow the drip rail / headliner edge to each clearance light position
- Left, center, right across the top of the cab
- Short runs — protected by the headliner/trim. Harness tape only.

### 10B: Third Brake Light (if roof-mounted)
**Wire:** #93 (18AWG, 18.4ft)
If the third brake light is mounted on the roof (above the rear glass), the wire routes up from the rear loom through the headliner to the roof mounting point. If on the endgate, see Route 5 Step 7.

---

## FIREWALL PENETRATION MAP

The firewall is the most critical routing surface. Every wire that crosses from engine bay to cab passes through here. Organize penetrations to keep signal and power separated.

### Recommended Firewall Holes (Engine Bay Side, Looking at Firewall)

```
╔══════════════════════════════════════════════════════════════════╗
║                        FIREWALL (ENGINE BAY SIDE)               ║
║                                                                  ║
║   DRIVER SIDE                              PASSENGER SIDE        ║
║                                                                  ║
║   ┌─────────┐                                                    ║
║   │ STEERING │   ┌──────────┐              ┌──────────────┐      ║
║   │ COLUMN   │   │ HEATER   │              │   M130 ECU   │      ║
║   │ PASS-    │   │ BOX      │              │   (mounted   │      ║
║   │ THROUGH  │   │          │              │    here)     │      ║
║   └─────────┘   └──────────┘              └──────────────┘      ║
║                                                                  ║
║   [H3]         [H2]                    [H1]        [H4]          ║
║   Brake        Front                   Engine      Power         ║
║   booster      Lighting                Loom        Cables        ║
║   (iBooster)   + misc                  (27 wires)  (6+8 AWG)    ║
║                                                                  ║
║   ── COWL / WINDSHIELD BASE ──────────────────────────────── ──  ║
╚══════════════════════════════════════════════════════════════════╝
```

### Hole Schedule

| ID | Location | Diameter | Grommet | Purpose | Wire Count |
|----|----------|----------|---------|---------|------------|
| H1 | Passenger side, near M130 | 1.5" | Rubber, sealed with RTV | Engine loom (27 wires) | 27 |
| H2 | Center-left, above heater box | 1.25" | Rubber, sealed with RTV | Front lighting + misc underbody | 15-18 |
| H3 | Driver side, above brake pedal | Existing | Factory iBooster mount | iBooster power and signal | 3-4 |
| H4 | Passenger side, near battery | 1" | Rubber, sealed with RTV | Power cables (battery to PDM30) | 2 (6 AWG each) |
| Factory | Driver side, near steering | Existing | Factory C100 bulkhead | May reuse for switch inputs | -- |

### Rules for Firewall Penetrations
1. **Always deburr** drilled holes — file smooth, no sharp edges
2. **Always use a rubber grommet** — wire loom alone is NOT sufficient for metal holes
3. **Seal with RTV** (black or clear silicone) on both sides after wires are installed
4. **Separate signal from power** — engine loom (H1) and power cables (H4) should be in different holes, spaced at least 4" apart
5. **Feed from inside out** — push connectors through from the cab side, largest connector first
6. **Do NOT use the factory C100 bulkhead connector** for new wiring unless specifically adapting it. The factory connector is a 20-pin design for the original 71-circuit harness — it is not suitable for the Motec system. Retain it if original wiring is kept for a switch or two, or delete it entirely.

---

## GROMMET AND HARDWARE SCHEDULE

### Firewall Grommets
| Qty | Size (hole) | ID (wire passage) | Type | Use |
|-----|-------------|-------------------|------|-----|
| 1 | 1.5" hole | 1" ID | Rubber push-in, slit type | Engine loom (H1) |
| 1 | 1.25" hole | 3/4" ID | Rubber push-in, slit type | Front lighting/misc (H2) |
| 1 | 1" hole | 5/8" ID | Rubber push-in, slit type | Power cables (H4) |

### Floor / Rocker Panel Grommets
| Qty | Size (hole) | ID | Type | Use |
|-----|-------------|-----|------|-----|
| 1 | 1" hole | 5/8" ID | Rubber push-in | Rear loom exit to frame rail |
| 1 | 3/4" hole | 1/2" ID | Rubber push-in | AMP Research / trans wires exit |
| 1 | 3/4" hole | 1/2" ID | Rubber push-in | Amp power cable to passenger rocker |

### Door Boot / Conduit
| Qty | Part Number | Use |
|-----|-------------|-----|
| 2 | Classic Parts 18-860 (or equivalent) | Driver and passenger door wire boot |

### Adel Clamps (Cushioned P-Clamps)
| Qty | Size | Use |
|-----|------|-----|
| 30 | 1/2" | Frame rail rear loom, power cables |
| 20 | 3/8" | Engine bay, front lighting, misc runs |
| 10 | 1/4" | Small signal wire runs |
| 10 | 3/4" | Heavy cable runs (4-6 AWG) |

### Split Loom
| Qty | Size | Temp Rating | Use |
|-----|------|-------------|-----|
| 30 ft | 3/4" | Standard | Frame rail rear loom main trunk |
| 20 ft | 3/8" | Standard | Front lighting, door runs, misc |
| 10 ft | 3/8" | High-temp (300F+) | Block sensor wires near exhaust |
| 10 ft | 1/2" | Standard | Power cables, fan wires |
| 5 ft | 1/4" | Standard | Small individual sensor runs |

### Heat Protection
| Qty | Size | Use |
|-----|------|-----|
| 10 ft | DR-25 3/8" | Engine loom trunk, CKP cable |
| 5 ft | DEI heat sleeve 1/2" | O2 sensor wires near exhaust |
| 2 ft | DEI titanium wrap | Extreme heat areas (near headers) |

### Harness Tape
| Qty | Type | Use |
|-----|------|-----|
| 3 rolls | Tesa 51036 (harness tape) | Interior runs, engine loom branches |
| 1 roll | 3M Super 33+ (electrical tape) | Terminal insulation, temporary bundling |

---

## PROTECTION STANDARDS

Use the following protection for each environment:

| Zone | Environment | Primary Protection | Secondary Protection |
|------|------------|-------------------|---------------------|
| Engine bay — intake valley | Hot, dry, vibration | DR-25 heat shrink | Tesa 51036 harness tape |
| Engine bay — near exhaust | Extreme heat (300-1200F) | High-temp split loom | DEI heat sleeve or titanium wrap |
| Engine bay — near accessories | Oil splash, moderate heat | 3/8" split loom | Adel clamps every 6-8" |
| Firewall penetration | Metal edges, weather seal | Rubber grommet + RTV | Tape or loom on both sides |
| Behind dash / interior | Dry, protected, low heat | Harness tape | None needed |
| Door interior | Wet (water intrusion), flex | Split loom at boot, tape inside | Sealed connectors at components |
| Door boot / hinge | High flex, pinch hazard | Rubber boot/conduit | Service loop (8" minimum) |
| Under vehicle — frame rail | Road debris, water, mud | 1/2-3/4" split loom | Adel clamps every 12" |
| Under vehicle — near exhaust | Extreme heat, road debris | High-temp split loom + heat shield | Minimum 6" from exhaust surface |
| Under vehicle — near driveshaft | Rotating hazard | Rigid split loom, tight clamps | Minimum 2" from driveshaft |
| Rear body interior | Dry, protected | Harness tape | Plastic push-in clips |
| Roof / headliner | Dry, hidden | Harness tape | None needed |

---

## KEEP-AWAY ZONES

These areas will damage wires. Maintain the listed clearance at all times.

| Zone | Hazard | Minimum Clearance | What Happens If Violated |
|------|--------|-------------------|--------------------------|
| Exhaust manifolds / headers | 600-1200F surface temp | 2" with heat shield, 6" without | Wire insulation melts, shorts, fire risk |
| Catalytic converters | 1200-1600F surface temp | 6" minimum | Same as above, more severe |
| Exhaust pipes (downstream) | 300-600F | 3" with split loom | Slow melt, eventual short |
| Serpentine belt path | Moving belt, pulleys | 2" from any belt/pulley surface | Wire caught in belt, sheared, engine damage |
| Radiator fan blades | Spinning blades | 3" from blade tips | Wire chopped, short, fan damage |
| Driveshaft | Spinning at road speed | 2" from shaft surface | Wire wraps around shaft, torn from harness |
| Steering shaft / column | Rotating, moving | 2" from shaft | Wire caught in steering, driver loses control |
| Suspension travel | Springs, shocks, axle move | Route on frame ONLY (fixed) | Wire crushed by axle/spring at bump |
| Brake lines | High-pressure hydraulic | Do NOT bundle together | Chafed wire shorts, damages brake line |
| A/C refrigerant lines | Cold/hot, high pressure | 1" minimum | Insulation damage from thermal cycling |
| Sharp body edges | Stamped metal, welds | Always use grommet or split loom | Wire chafes through insulation, shorts to body |

---

## FINAL NOTES

### Wire Length Validation
Every length in this guide is ESTIMATED based on vehicle dimensions, base layer images, and typical routing paths. Before cutting any wire:
1. Run a measuring tape along the exact route on the actual truck
2. Record the measured distance
3. Add 10% for service loop
4. Add 6" for connector termination at each end
5. Cut to the measured+service+termination length

### Inline Connector Strategy
Place inline connectors at these 5 separation points to allow harness sections to disconnect independently:

| Location | Connector Type | Purpose |
|----------|---------------|---------|
| Firewall (engine loom) | Deutsch DT 12-pin (x2) | Disconnect engine harness for engine removal |
| Under dash (rear loom) | Deutsch DT 12-pin | Disconnect rear harness for body-off |
| Each door boot (x2) | Weatherpack 6-pin | Disconnect doors for removal |
| Rear body (fuel pump) | Weatherpack 2-pin | Disconnect fuel pump for tank drop |

### Color Code Reference
All wire colors are defined in the cut list (`K5_cut_list.txt`). This routing guide does not redefine colors — refer to the cut list for the authoritative color assignments.

### Critical Shielded Cable Routing Rules
The 4 shielded cables (CKP, CMP, KS1, KS2) have special routing requirements:
1. Shield drain wire grounds at the M130 end ONLY (B15 or B16)
2. Do NOT ground the shield at the sensor end
3. Route at least 2" from coil drive wires, injector drive wires, starter cable, and alternator output
4. Route together through the engine loom trunk, but on the OUTER edge of the bundle (not buried in the center with power wires)
5. If CAN bus noise or false knock events occur, consider separating shielded cables into their own conduit for the firewall penetration
