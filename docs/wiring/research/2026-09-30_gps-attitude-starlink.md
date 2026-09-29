# GPS, attitude, Wi-Fi and Starlink for the K5 (research)

- **Date:** 2026-09-29 (file dated 2026-09-30 by the lead's naming)
- **Lane:** nav-comms, branch `wiring/nav-comms`
- **Ask (owner, 2026-09-29, voice-typed):** "what about GPS topology and topology I like knowing that angle position on the
  vehicle and the other important features like that communication Wi-Fi connection small starling connector Starlink"
- **Read as:** GPS (position, speed, heading); the truck's pitch and roll ("that angle position"); Wi-Fi in and around the
  truck, cellular, and a Starlink Mini ("small Starlink"). "Topology" is covered both ways in §0.
- **Pre-flight:** state §1–4; canon ch.16 (§1.5 wire specs, §1.8 resistances, §2.3 charts, §2.4 drop, §7), ch.17 (§17.1
  fuse rule, §17.2 OCP placement, §17.8 PDM channels), ch.18; `scripts/library_search.py` for GPS, accelerometer,
  inclinometer, Starlink, antenna, RS232, compass, removable top, steel cab, roof panel; the registry, `endpoints.yaml`,
  `mounts.yaml`; options-rd's (#416) and top-design's (#420) candidates for what they have claimed.
- **Web:** every page below was saved on 2026-09-29 through the repo's Firecrawl path to
  `reference_documents/web_snapshots/` (gitignored; third-party text stays out of the public repo). One request per host
  every 10 s or more. No accounts, no logins, nothing bought. Prices are testimony with a short half-life.
- **Nothing here is decided.** Candidates live in `calc-data/catalog/options.yaml` under the codes in §4.

## Sources

Library (page numbers are the PDF's; printed numbers in brackets where they differ):

| id | document | used for |
|---|---|---|
| L1 | MoTeC M130 datasheet, part 13130, published 6 June 2014 (`reference_documents/component_drawings/motec_m130_datasheet.pdf`) | p.2 "CAN bus: 1", "Logging Memory: 120 Mb", logging licences 1–3; pp.4–5 pinout (B11 UDIG6, B14 UDIG7, B17/B18 CAN bus 1, B23–B26 Ethernet; no RS232, LIN or RF pin) |
| L2 | MoTeC M1 ECU Hardware tech spec, published 7 November 2013 (`motec_m1_hardware_techspec.pdf`) | p.6 comparison table (M130: CAN 2.0B 1, LIN –, RS232 –, Ethernet 1); p.14 sensor 0 V pins are FET earths, "no current paths"; p.15 "CAN messaging is implemented in the CanComms libraries which are incorporated into scripts by the application developer" |
| L3 | MoTeC C125 user manual (`motec_c125_user_manual.pdf`) | p.9 [8] #41304 GPS L10 accessory; p.14 [13] GPS lead is for "a compatible 5 V GPS unit only"; p.20 [19] "Other ECUs will require a custom template"; p.25 [24] GPS is an RS232 device; p.59 [58] internal 3-axis accelerometer ±5 G, 2 CAN, 2 RS232, 6–32 V, 0.5 A typical at 14 V |
| L4 | MoTeC PDM user manual PN 63029 (`motec_pdm_user_manual.pdf`) | p.4 [1] "Logic functions can be used to selectively turn off systems during low battery voltage"; p.24 [21] "All devices on the CAN bus must be set to the same speed"; p.27 [24] maximum current settable to 10 A on 8 A outputs and 25 A on 20 A outputs, up to four outputs stay alive in standby; p.38 [35] battery 6.5–30 V; p.51 [48] wire table; p.33 [30] PDM CAN at 250 kbps, 500 kbps or 1 Mbps; p.52 [49] CAN bus wiring (twisted trunk, 100R each end, 16 m max, devices on stubs up to 500 mm) |
| L5 | 1977 Light Truck Service Manual (`k5_factory_docs/1977_Light_Truck_Service_Manual.pdf`) | p.155 [2D-29] "force the removable top against the steel cab"; p.156 [2D-30] Fig. 2D-77 roof-to-header brackets; p.157 [2D-31] Fig. 2D-78 removable top (drawing shows the steel cab roof over the front seats) |
| L6 | Dakota Digital VHX manual MAN 650314:P (`dakota_digital_vhx_manual.pdf`) | p.13 AUX I/O jack is for BIM modules only; p.26 BIM readings show on the tach/LCD2 message display |

Web (all fetched 2026-09-29):

| id | page | snapshot file |
|---|---|---|
| W1 | Starlink Mini specification sheet, https://starlink.com/public-files/specification_sheet_mini.pdf (PDF created 2026-05-28; text read with pdftotext, drawing pages rendered) | `starlink.com__specification_sheet_mini.md` |
| W2 | Starlink specifications page, https://www.starlink.com/specifications?spec=5 | `www.starlink.com__specifications__spec=5.md` |
| W3 | Starlink help: "What are the supported power sources on Starlink Mini?" https://starlink.com/support/article/0b2d5227-1db6-0002-ecee-f49d3b516b49 | `starlink.com__0b2d5227-…md` |
| W4 | Starlink help: "How much power does my Starlink need?" https://starlink.com/support/article/18836c7e-2d97-6153-fe67-c18427bd0558 | `starlink.com__18836c7e-…md` |
| W5 | Starlink help: "What USB power rating do I need to power my Starlink Mini?" https://starlink.com/support/article/fba85643-e7fa-4b55-21e5-021422d5701e | `starlink.com__fba85643-…md` |
| W6 | Starlink help: "Does Starlink Mini support power over ethernet?" https://starlink.com/support/article/6ee2d80c-cb4a-3339-9a31-2090666bf634 | `starlink.com__6ee2d80c-…md` |
| W7 | Starlink help: "Starlink Mini - USB-C Cable" https://starlink.com/support/article/7c9fb509-e3c4-c6af-b2f5-ef95e645c046 | `starlink.com__7c9fb509-…md` |
| W8 | Starlink Mini setup guide ("Mini_Install Guide_102825"), https://starlink.com/public-files/installation_guide_mini_kit.pdf | `starlink.com__installation_guide_mini_kit.md` |
| W9 | Starlink Mini accessories guide ("V4_MINI_Accessories_Guide_042525"), https://starlink.com/public-files/accessories_guide_mini.pdf | `starlink.com__accessories_guide_mini.md` |
| W10 | Starlink Roam, https://starlink.com/roam | `starlink.com__roam.md` |
| W11 | CSS Electronics CANmod.gps product page, https://www.csselectronics.com/products/gps-to-can-bus-gnss-imu | `www.csselectronics.com__gps-to-can-bus-gnss-imu.md` |
| W12 | CANmod.gps docs 01.04.01, specification, https://canlogger.csselectronics.com/canmod-gps-docs/specification/specification.html | `canlogger.csselectronics.com__specification.md` |
| W13 | … connector, `/hardware/connector/connector.html` | `…__connector.md` |
| W14 | … installation, `/hardware/installation.html` | `…__installation.md` |
| W15 | … CAN termination, `/hardware/termination.html` | `…__termination.md` |
| W16 | … output, `/configuration/output.html` | `…__output.md` |
| W17 | … attitude output, `/configuration/gnss/output/attitude.html` | `…__attitude.md` |
| W18 | … dynamic model and lever arms, `/configuration/gnss/sensor/dyn_model.html` | `…__dyn_model.md` |
| W19 | … IMU mount alignment, `/configuration/gnss/sensor/imu_mount_alignment.html` | `…__imu_mount_alignment.md` |
| W20 | MoTeC GPS-L10 user manual, https://www.motec.com.au/products/GPS-L10%20User%20Manual | `www.motec.com.au__GPS-L10%20User%20Manual.md` |
| W21 | MoTeC 3 Force Combined Sensor, https://www.motec.com.au/products/3%20Force%20Combined%20Sensor | `www.motec.com.au__3%20Force%20Combined%20Sensor.md` |
| W22 | Dakota Digital expansion modules (BIM list), https://www.dakotadigital.com/index.cfm/page/ptype=results/category_id=646/mode=cat/cat646.htm | `www.dakotadigital.com__cat646.md` |
| W23 | Dakota Digital GPS-50-2, https://www.dakotadigital.com/index.cfm/page/ptype=product/product_id=837/category_id=646/mode=prod/prd837.htm (its manual, https://www.dakotadigital.com/pdf/GPS-50-2.pdf, answered HTTP 500: not read) | `www.dakotadigital.com__prd837.md` |
| W24 | Peplink MAX BR1 Pro 5G, https://www.peplink.com/products/max-br1-pro-5g/ | `www.peplink.com__max-br1-pro-5g.md` |
| W25 | Peplink comparison, BR1 Pro 5G column, https://www.peplink.com/compare/routers/?series=max&product1=MAX-BR1-PRO-5GH-T-PRM&product2=MAX-HD1-DOM-PRO-5GH&product3=MAX-BR2-PRO-5GH-T-PRM | `www.peplink.com__routers__series=max_…md` |
| W26 | Peplink Mobility antenna series, https://www.peplink.com/products/accessories/mobility-antenna-series/ | `www.peplink.com__mobility-antenna-series.md` |
| W27 | Peplink Mobility 42G datasheet, https://download.peplink.com/resources/peplink_mobility_42g_datasheet.pdf | `download.peplink.com__peplink_mobility_42g_datasheet.md` |
| W28 | Teltonika RUTX50 power consumption, https://wiki.teltonika-networks.com/view/RUTX50_Power_Consumption | `wiki.teltonika-networks.com__RUTX50_Power_Consumption.md` |
| W29 | Teltonika RUTX50 interfaces, https://wiki.teltonika-networks.com/view/RUTX50_Interfaces | `wiki.teltonika-networks.com__RUTX50_Interfaces.md` |
| W30 | eBay listing 176340608229, "Rugged Ridge 13309.01 Clinometer" (a reseller, not the maker) | `www.ebay.com__176340608229.md` |
| W31 | Blue Sea 1011 dash socket (the registry's existing snapshot), https://www.bluesea.com/products/1011/Dash_Socket_12V_DC_with_Watertight_Cap | `www.bluesea.com__Dash_Socket_12V_DC_with_Watertight_Cap.md` |

## 0. "Topology", both ways

- **Terrain (topography).** Every GPS option below reports altitude: CANmod.gps "Altitude (1 Hz)" (W12), GPS-L10
  "altitude, heading" (W20), GPS-50-2 "Altimeter data" on the VHX (W23). Contour maps are a display app's job, not the
  harness's. Nothing extra is wired for terrain.
- **Network.** Two data networks: the one M1 CAN trunk (M130 → PDM30 → 61-pin → PDM15 → LTCD, 100R at each end,
  `endpoints.yaml` CAN-BUS) and an Ethernet/Wi-Fi network in the cab (router or the Starlink Mini's own), whose outside
  links are Starlink and, optionally, cellular.
- **This design serves the network topology.** Terrain comes free as GPS altitude. (A third reading, "telemetry", is the
  same network question: §2.6.)

## 1. GPS and attitude

### 1.1 What the M130 can take

- **One CAN bus and no serial port.** M130: "CAN bus: 1" (L1 p.2); CAN 2.0B 1, LIN –, RS232 – (L2 p.6). Its pinout has no
  RS232, LIN or antenna pin (L1 pp.4–5).
- **A MoTeC GPS on a digital input.** The GPS-L10 manual wires it to the M130 on "B11, B14 — Udig 6 or 7 — Revision Q or
  higher only"; M1 Tune takes it as Serial 1 RX or Serial 2 RX; "M1 ECU's require a minimum of level 2 Logging"; an M130
  before rev Q "can only receive GPS data via CAN" through a MoTeC STC (Serial to CAN) #61125 (W20). On this truck B14 is
  the isolator shutdown input (UDIG7, state §1 row 57) and B11 is unused (`k5_registry.json` m130_pinout).
- **Logging.** The M130 comes with Logging Level 1, "a fixed log set and rate"; Level 2 (200 channels, 200 Hz) and Level 3
  are paid upgrades (L1 p.2).
- **Other CAN devices.** What an M1 receives on CAN is set by its firmware package's scripts (L2 p.15). Whether the M1 GPR
  package can receive a third-party GPS/IMU frame is **unknown** (needs: Dave or MoTeC, M1 GPR help). The M130 does not
  need GPS to run the engine; a display or a logger can read a CAN GPS directly off the trunk.

### 1.2 The options

| | CSS Electronics CANmod.gps | MoTeC GPS-L10 (#41304, 2.8 m / #41308, 1.5 m) | Dakota Digital GPS-50-2 |
|---|---|---|---|
| What it gives | GNSS position, speed, altitude, time and **roll, pitch, heading** at 1 Hz; 3-axis accel + 3-axis gyro at 100 Hz; dead reckoning (u-blox NEO-M8U, UDR) (W11, W12) | Position, speed, altitude, heading, time at 10 Hz (W20) | Speed, compass heading, altitude, clock on the VHX; 10 Hz; accelerometers bridge GPS gaps (W23) |
| Attitude | yes: roll −180…180°, pitch −90…90° (W17); "a good attitude output requires ... automotive sensor fusion" (W17) | none | none |
| Reaches | the M1 CAN trunk; any CAN display, bridge or logger | the M130 on UDIG6 (rev Q+) or a MoTeC dash's RS232 (W20) | the VHX cluster's BIM port only (L6 p.13) |
| Interface | CAN 5k–1M, IDs 11 or 29-bit set per message, push or poll (W12, W16) | RS232 ±5 V, 38400 baud, NMEA RMC + GGA (W20) | Dakota BIM bus; speed pulse out 4k/8k/16k PPM (W23) |
| Supply | 5.0–26 V, 0.6 W (W12); DB9 pin 9 (W13) | 4.0–6.0 V, 38 mA; "More than 6 V ... risks damaging the GPS" (W20) | **unknown** (manual would not load: W23) |
| Antenna | external, supplied: u-blox, SMA plug, 3 m, magnetic base (W11); tested with u-blox ANN-MS-0 (W13) | built in; outside, horizontal, clear sky; 150 mm metal plate under it on a non-metallic surface (W20) | built in; optional 600041 external antenna, 110 in cable (W23) |
| Size, weight | 48 × 70 × 24 mm, 75 g (W12) (the shop page says 65 × 48 × 24 mm, 70 g: W11) | 48 × 41 × 14 mm, 106 g (W20) | 4-3/4 × 2-3/4 × 1 in (W23) |
| Environment | −25 to +70 °C, IP40 (W11, W12) | −30 to +80 °C (W20) | not published |
| Price 2026-09-29 | 300 EUR ex VAT (W11) | via a MoTeC dealer (not published: W20) | $250.00; 600041 antenna $30.00 (W23) |

Also looked at:
- **MoTeC 3 Force Combined Sensor #57213** (W21): accel ±16 g, gyro 500 °/s, magnetometer; CAN 125k–1M, default IDs 0x610,
  0x611, 0x612; accel and gyro 1–500 Hz, compass 1–100 Hz; 5–24 V, 20 mA typical, 40 mA max; −20 to 70 °C;
  52 × 32 × 15 mm, under 55 g; DR-25 and M22759/16 pigtail on a #68054 DTM 4-way. Raw axes only, no roll/pitch angle;
  MoTeC lists its compatibility as "MoTeC Display Loggers and Enclosed Loggers". It is the IMU for an all-MoTeC version
  (GPS-L10 + 3 Force + a MoTeC dash).
- **The display's own sensors.** A MoTeC C125 has a 3-axis accelerometer, ±5 G (L3 p.59), and takes a 5 V RS232 GPS on its
  GPS lead (L3 p.14). An accelerometer gives tilt only while the truck is not accelerating; no gyro. A phone or tablet on
  the wireless-display path has its own GPS and IMU but they measure the tablet, not the truck.
- **Dakota BIM list** (W22): GPS-50-2 and a compass module BIM-17-2. No inclinometer or pitch/roll module is listed.

### 1.3 Where the GPS antenna goes

- **The roof over the front seats is steel.** The 1977 K5's removable fiberglass top covers the rear only and bolts to the
  steel cab: "force the removable top against the steel cab" (L5 p.155); Fig. 2D-78 (L5 p.157) draws the steel cab roof
  over the front seats. top-design reads it the same way (message 2026-09-29): with the top off, the cab roof's underside is
  bare painted steel with the dome-lamp wire at its centre (vehicle_images 61df4ea0 and d2c5f364, 2024-10/12), and
  bce3d70b (2026-01-31) shows a white steel cab roof with the top off, so the DB note "white roof" fits either.
- **So:** every antenna and the dish go on the steel half-cab roof, outside, and nothing of this design crosses the top's
  disconnect (§3.4). The CANmod.gps antenna's magnetic base holds on steel (W11). The GPS-L10 wants an external horizontal
  surface (W20).
- **Cable reach.** The CANmod.gps antenna lead is 3 m (W11); the GPS-L10 lead is 1.5 m or 2.8 m (W20). Whether 3 m reaches
  from a module under the dash, up a pillar, to the roof is **unknown** (needs: the tape at the mock-up or the twin).
- **The roof entry** (a sealed gland through the steel roof into the headliner cavity, which is a routing channel:
  `objectTraits.ts` Exterior_Roof) is a builder item.

### 1.4 Where the IMU goes

- **Rigid, flat, x-axis forward.** CSS: "the simplest mounting configuration is obtained by placing the device flat in the
  Vehicle-Reference-Point with the x-axis ... pointing towards the front of the vehicle and the antenna close to the
  device" (W14). Sensor fusion needs the IMU mount alignment and the lever arms set, and "can be worse compared to leaving
  the feature disabled" without them (W18); a few degrees of misalignment degrades it, tens of degrees fail it (W19).
- **The reference point is the rear axle, not the centre of gravity.** "The VRP is defined as the center of the vehicle's
  rear axle"; the module and antenna offsets from it are entered in cm, x forward, y left, z up (W18). Pitch and roll are
  the same everywhere on a rigid body; the lever arms let the fusion correct for where the box sits.
- **The CAN stub sets the place.** A CAN device may sit on up to 500 mm of twisted wire off the trunk (L4 p.52), and the
  trunk runs M130 → PDM30 in the cab by the 61-pin at the driver-side fuse-box hole (`mounts.yaml`, M130 and PDM30, status
  open). So the module goes under the dash within 500 mm of that trunk, on its own rigid bracket: not on the M130's
  rubber-isolated plate (`mounts.yaml` M130 "rubber isolators").
- **Heat.** The module is rated −25 to +70 °C (W12). The cab's parked summer temperature under the dash is not measured.
  Keep it low and out of the sun.
- **Lever arms** (rear-axle centre to the module, and to the antenna) are tape measurements, cm (needs: the mock-up or the
  twin).

### 1.5 How pitch and roll reach the driver

Through the DISP option (a CAN display stub; wired dash or wireless bridge is the owner's choice):
- **Wired MoTeC dash:** a C125-class dash reads non-MoTeC devices through a custom comms template (L3 p.20, p.36) and
  shows pitch, roll, heading and GPS speed on a page. It has 2 CAN buses (L3 p.59), so it can sit on the M1 trunk.
- **Wireless:** the bridge on the DISP stub carries the CANmod.gps frames to a phone or tablet app.
- **No DISP:** a mechanical dash clinometer answers "angle position" with no wiring: Rugged Ridge 13309.01, US $63.13 new
  on 2026-09-29 (W30, a reseller listing; the maker's page was not fetched). The illuminated 13309.02 would need a lamp
  feed. For GPS speed, heading and altitude on the existing cluster, the Dakota GPS-50-2 (W23).

### 1.6 Pick: CANmod.gps (option NAV)

One 0.6 W box answers both asks, GPS and pitch/roll, on the CAN trunk the truck already has: no M130 pin, no PDM output,
no firewall crossing, 4 wires (two of them the CAN stub). Every display path can read it, and so can a logger that sends data to Nuke.
- The GPS-L10 is MoTeC's own and logs in the M130, but only with the paid Level 2 licence, only on a rev Q or later M130,
  it takes B11 (which wheel-speed's WSS-F2 candidate also wants, with B10: the last two spare UDIGs), it has no attitude,
  and its 5 V comes off an M130 sensor rail (W20). The spare rail A09 (SEN_5V0_B)
  carries pedal track 2 alone; a fault on a roof-run GPS lead on either rail pulls that rail down (registry m130_pinout;
  state §1 row 46). That rail question is Dave's.
- The Dakota GPS-50-2 puts speed, heading and altitude on the VHX but gives no angle and doesn't reach the MoTeC system.

## 2. Communications

### 2.1 Starlink Mini, facts

| item | value | source |
|---|---|---|
| size | 298.5 × 259 × 38.5 mm (11.75 × 10.2 × 1.45 in) | W1 |
| weight | 1.10 kg; 1.16 kg with kickstand; 1.53 kg with kickstand and 15 m cable | W1 |
| antenna | electronic phased array, 110° field of view, "software assisted manual orienting" | W1 |
| environment | IP67 Type 4 with the DC cable and the Starlink Plug installed; −30 to +50 °C; operational in 96 kph+ (60 mph+) wind; snow melt to 25 mm/h | W1 |
| power | "Average: 25-40W" (W1); "Average: 20-40W, Idle: 15W", AC-input figures including router, supply and cables (W4) | W1, W4 |
| DC input | "12-48V 60W" (W1, W3); "Starlink only guarantees performance with the included Starlink power supply and cable" (W3) | W1, W3 |
| DC plug | sealed, ribbed barrel on the Starlink cable: 5.5 mm barrel, 2.5 mm bore, 34.45 mm long, 13.3 mm body (W1 p.7). The drawing's polarity mark doesn't show which pole is the centre: confirm on the part | W1 |
| USB-C | "100W, 20V/5A Minimum (with Starlink USB-C to Barrel Jack Cable Accessory)" (W1); "will not work with USB PD ratings of 65W or lower" (W5) | W1, W5 |
| vehicle power | Mini Car Adapter: "can be used with any standard automotive 12-24V auxiliary power outlet", kit = adapter + Mini USB-C Cable (W9); the 5 m cable's barrel end is IP67 at the Mini, "The USB-C end ... should not be exposed to outdoor environments"; a red light means the Car Adapter is too hot (W7) | W7, W9 |
| PoE | "Power over Ethernet is not supported on Starlink Mini" | W6 |
| Wi-Fi | built in: 802.11a/b/g/n/ac (Wi-Fi 5), dual band 3 × 3 MU-MIMO, WPA2, up to 112 m², up to 128 devices | W1 |
| Ethernet | one latching LAN port behind the Starlink Plug; the 15 m Mini Starlink Cable is sold separately; "no longer rated IP67 with a standard RJ45 cable" | W1, W8, W9 |
| kit | Mini, kickstand, Pipe Adapter and Flat Mount, 15 m DC cable, power supply (100–240 V, IP66), Starlink Plug | W1, W2 |
| mounts | Mini Mobility Mount: "waterproof seal ... when permanently mounting to wood, fiberglass, metal, and plastic", stainless fasteners, 9° angle; Roof Rack Mount (bars 12–48 mm thick, 88 mm wide max, not round bars); Flat Mount: 6 mm (1/4 in) bolts, 6.5 mm (9/32 in) holes | W9, W8 |
| moving vehicles | "Ensure that the mount is installed firmly on a structurally sound, horizontal surface"; "Tethering should be used in all cases" | W8 |
| in motion | "In-motion use is supported with Roam service plans in select areas"; Roam 100GB $55/mo, 300GB $80/mo, Unlimited $175/mo (starting prices, 2026-09-29) | W10 |

Price of the Mini kit and its accessories: not fetched (unknown).

### 2.2 Where it mounts

- **Recommended: the steel half-cab roof** (§1.3), on the Mini Mobility Mount (metal-rated, sealed) or the kit's Flat Mount,
  tethered (W8, W9). It never crosses the top's disconnect, and it stays put when the top comes off.
- **Alternative: the removable top.** The Mobility Mount is rated for fiberglass (W9), but the top is a removable panel and
  Starlink asks for a structurally sound surface (W8). Its power would cross the top disconnect (§3.4). Option COM-TOP.
- **Heat.** Starlink rates the Mini to +50 °C (W1). top-design's research cites a 47.6 °C Las Vegas July maximum (NASA POWER
  2001–2020 climatology; `research/2026-09-30_fiberglass-top-disconnect-solar-lighting.md`). The Mini runs close to its limit on the hottest days; how it behaves above 50 °C is not published.
- **Footprint.** The roof also carries the dome lamp inside and, in top-design's plan, the clearance lamps on its front
  edge. The roof's flat size is not measured (needs: tape item T-15, geometry lane).

### 2.3 How to power it

| | how | wiring | notes |
|---|---|---|---|
| **A (pick)** | Starlink Mini Car Adapter in a dedicated sealed 12 V socket; the Mini USB-C Cable (5 m) up the pillar to the dish | a socket on the COMMS output (§3.1) | Starlink's own vehicle path, "designed to power your Starlink Mini on-the-go via USB-C" from a 12–24 V outlet (W9); on USB-C the Mini needs a PD source rated 100 W, 20 V/5 A (W5), so it runs off the adapter's PD output, not straight off the battery. The adapter's minimum input and its loss are not published. Socket = the registry's Blue Sea 1011 (15 A max, IP45 with the cap closed, twist-locks with the plug: W31) |
| B | the same adapter in the existing dash outlet (OUTLET-12V, PDM30 OUT8) | none | works today; on with the key only (OUT8 is ignition RUN in the registry); the outlet is then taken |
| C | hard-wire 12 V to the Mini's barrel (cut or third-party cable) | a pair to the dish | inside the 12–48 V rating, but a 12 V battery sits at the bottom of it, and Starlink guarantees only its own supply and cable (W3). Not picked |

### 2.4 Router

| | Peplink MAX BR1 Pro 5G | Teltonika RUTX50 | none (the Mini's own Wi-Fi) |
|---|---|---|---|
| power | DC 10–30 V; 8 W nominal, 19 W max; ignition sensing yes; 4-pin Molex Micro-Fit (W25) | measured 4.73 W idle, 16.21 W max (1.351 A) at 12 V; also measured at 9 V and 24 V (W28); input range not on the pages fetched (**unknown**) | — |
| radios | 5G + LTE, Wi-Fi 6, GPS (W24, W25) | 5G, dual SIM, 2.4/5 GHz Wi-Fi (W29) | Wi-Fi 5 (W1) |
| ports | WAN convertible to LAN (W25) | 5 × RJ45; 1 digital input + 1 digital output on the 4-pin power connector (W29) | one LAN port (W1) |
| environment | −40 to +65 °C, indoor metal case; 146.8 × 129 × 29.3 mm (HW1–2), 1.5 lb (W25) | not fetched | −30 to +50 °C (W1) |
| antennas in the box | 4 × LTE/5G, 2 × Wi-Fi, 1 × GPS (W24) | not fetched | — |
| price | not published on the page (unknown) | not fetched | — |

- **What a router adds:** cellular where the dish can't see sky; one truck network that stays up with the dish off (the
  wireless display, a logger and phones join it); Starlink in over Ethernet (the Mini Starlink Cable into the router's WAN).
  A cellular plan is a second subscription: the owner's call.
- **Pick: Peplink MAX BR1 Pro 5G** for its 10–30 V vehicle input, ignition sensing and −40 to 65 °C rating (W25). The RUTX50
  draws less (W28) and is the alternative. The Mini's Wi-Fi alone is enough if cellular and a dish-off network aren't
  wanted.

### 2.5 Antennas and coax

- **Router, on the roof:** Peplink Mobility 42G, 7-in-1 (4 × LTE/5G 600–6000 MHz, 2 × Wi-Fi, 1 × GPS). Cellular and Wi-Fi
  leads are CFD-200 (5.0 mm), the GPS lead RG-174 (2.7 mm); SMA male (cellular, GPS), RP-SMA male (Wi-Fi); 2 m (-6) or
  4.8 m (-16) leads; 43 mm (1-11/16 in) mounting hole, panel up to 15 mm; 208 mm across, 58 mm tall; IP68; −40 to +80 °C;
  "Ground plane: Not required"; the included plastic bracket is not for wind loads (W27). The black 2 m part is
  ANT-MB-42G-S-B-6 (W24, W27). Or keep the router's stick antennas inside the cab first (they come in the box: W24).
- **CANmod.gps:** its own u-blox antenna, SMA plug, 3 m lead, magnetic base (W11).
- **GPS-L10:** antenna built in; its lead is the DTM cable (W20).
- **Starlink:** no coax. The Mini USB-C Cable (5 m, power) and, with a router, the Mini Starlink Cable (15 m, Ethernet) (W9).
- **Route:** roof → sealed roof entry → headliner cavity (`objectTraits.ts` Exterior_Roof, channel_along) → A- or B-pillar
  trim → under the dash. Pillar choice and lengths: mock-up. Leftover coax is coiled, not cut (factory-terminated leads).

### 2.6 Bridging the MoTeC data to a phone, tablet or Nuke

The router is the network, not the bridge: a router does not read CAN. The MoTeC data reaches a phone or tablet through the
DISP wireless bridge on its CAN stub, which joins the router's Wi-Fi. To reach Nuke, the proven pattern is a CAN logger
with Wi-Fi upload: CSS's CANedge2 takes the CANmod.gps as an add-on and pushes its log files to your own server "when the
vehicle is in range of a WiFi access point" (W11). The router supplies that access point. Nuke would take each uploaded
file as observations with the logger as their source. The M130's own log downloads over its Ethernet port with M1 Tune.
Whether M1 Tune works through a router's network is **unknown**; MoTeC documents a direct crossover cable (state §3 row 0k).

## 3. Power and wiring

### 3.1 The COMMS output

- **Load.** Starlink at its input rating, 60 W / 12 V = 5.0 A (W1, W3), plus the router at 19 W max / 12 V = 1.6 A (W25):
  6.6 A. The Car Adapter's own loss is not published (unknown), so the 5.0 A is at the Mini's rating, not measured at the
  socket.
- **Limit.** 1.25 × 6.6 A = 8.25 A, so 9 A in the PDM's 1 A steps (ch.17 §17.1; L4 p.27 [24]: a 20 A output can be set
  up to 25 A, an 8 A output up to 10 A). Starlink alone: 1.25 × 5.0 = 6.25, so 7 A.
- **Wire.** COMMS wants a **20 A output**. MoTeC's wire table puts 20–16 AWG on 20 A outputs and 24–20 AWG on 8 A outputs
  (L4 p.51 [48]). On a 20 A output, the two pins take 2 × 16 AWG pigtails into SPL-COMMS, the registry's pattern for paired
  20 A outputs. The branches are 18 AWG M22759/32 (ch.16 §1.5): 11 A at 80 °C, 0.85 × 11 = 9.35 A, at least the 9 A limit.
  On an 8 A output, MoTeC's 20 AWG lead allows only 0.85 × 8 = 6.8 A, under even the 7 A Starlink-alone setting. That
  would be a deliberate exception: an 18 AWG lead on the SSC-N contact (16–24 AWG, `catalog/parts.yaml`), as the registry
  already does for #71 on OUT29, plus a Superseal seal check (top-design's note, 2026-09-29).
- **Drop.** On the Starlink path at 5.0 A: paired 16 AWG pigtails, then 4 ft of feed and 3 ft of ground in 18 AWG
  (6.23 Ω/1000 ft, ch.16 §1.8). That's 0.23 V, 1.6 %, under the 3 % ceiling (ch.16 §2.4). Lengths are estimates.
- **Which output.** None is free on the PDM30. The base ledger has OUT3 and OUT4 (20 A) and OUT21 (8 A) spare, and they're
  taken as follows: PW takes OUT3/OUT4; PL and top-design's TOP-LIGHT both name OUT21 (PL needs 12 A and a 20 A output
  anyway: capacity ledger `setting_conflicts`). options-rd shares OUT23/25/27/28/15/11/13. So COMMS takes OUT3 if PW is
  not fitted (OUT3 is a 20 A output), and COM and COM-TOP carry `conflicts_with: [PW]` with a CONFLICT line saying so.
  If PW is fitted, COMMS waits for more cab outputs: the PDM15 moved to the cab (`mounts.yaml`, state row
  0ag(b)) or a second body PDM. Until then, option B (the dash outlet).
- **Switching.** On with ignition RUN (PDM30 DIG1), held on after key-off by a latch, and off below a battery-voltage
  threshold (L4 p.4 [1] low-battery logic). The latch is a CANKEY button (top-design's CAN keypad candidate) or, without a
  keypad, a PDM off-delay. PDM30 DIG8 and DIG16 are already wanted by AS and LO4. Key-off running needs one of the PDM's
  four stay-alive outputs (L4 p.27 [24]). The threshold and delay are the owner's or Dave's to set, not picked here.
- **Which battery.** PDM outputs run off the running (Odyssey) side; the YellowTop feeds only the amplifier (`endpoints.yaml`
  ACC-BATT). Camp use off the YellowTop cannot be PDM-switched, so it's a separate version (COM-ACC): a 10 A fuse within
  7 in of the source (ch.17 §17.2; 1.25 × 6.6 = 8.25 → 10 A; 16 AWG is 12.5 A on the ProWire 35 °C-rise chart, 0.85 × 12.5 =
  10.6 A, ch.16 §2.3) and a sealed switch. It breaks the ch.17 §17.8.5 partition on purpose (no PDM is fed from that battery) and has no
  low-voltage cutoff. With the YellowTop in the engine bay, its feed has to reach the cab by the amplifier's route
  (frame rail → floor CableClam, AMP-PASS) or tap the AMP-BLOCK. Tapping the block puts comms on the amplifier's MIDI 60 A,
  which was sized for the amplifier alone (JL, `endpoints.yaml` ACC-BATT), so the amplifier's peak draw has to be checked
  first (unknown).

### 3.2 Per device

| device | supply | output and switching | DC-DC / USB-C | protection | wire (ch.16 §1.5) | cables and route |
|---|---|---|---|---|---|---|
| CANmod.gps | 5.0–26 V, 0.6 W (W12): 0.05 A at 12 V | taps PDM30 OUT29 (the ignition RUN group: #71 Dakota VHX, GSS_PWR; top-design's CANKEY also taps it). Not shared with a motor or solenoid (W14 supply quality) | none | the PDM output; OUT29's limit is still OPEN (VHX and GSS-3000 currents unpublished) | power + ground 20 AWG M22759/32; CAN stub 22 AWG M22759/16 twisted, 500 mm max (L4 p.52), ground carried with the pair (W13, W14) | DB9: 9 supply, 3 GND, 7 CAN H, 2 CAN L (W13); internal 120 Ω termination defaults ON: switch it OFF on a stub (W15); antenna SMA 3 m to the roof |
| Starlink Mini | 60 W max, 25–40 W typical (W1) | the COMMS output (§3.1), a 20 A output | the Starlink Mini Car Adapter (12–24 V outlet in, W9); the Mini needs a 100 W, 20 V/5 A USB-C source (W5) | the PDM output (9 A with the router, 7 A alone) | 2 × 16 AWG pigtails, then 18 AWG M22759/32 to the socket | Mini USB-C Cable 5 m, roof → pillar → socket; the USB-C end stays inside (W7) |
| Peplink MAX BR1 Pro 5G | 10–30 V, 19 W max (W25) | the COMMS output, same group | none | the PDM output | 18 AWG M22759/32 (it shares the 9 A group) | 4-pin Micro-Fit (W25; its pin order not fetched: unknown); Mobility 42G CFD-200/RG-174 leads down the pillar (W27); Mini Starlink Cable 15 m to its WAN (W9) |
| GPS-L10 (alt.) | 4.0–6.0 V, 38 mA (W20) | M130 5 V sensor supply, on with the M130 | none | the M130's supply | 22 AWG M22759/16 | DTM 4-pin, mating #68054: 1 Bat−, 2 TX → M130 B11, 3 not connected, 4 5 V (W20). Where pin 1 lands is Dave's call: the manual says "Battery Negative on the logging device", and M1 sensor 0 V pins must carry no current paths (L2 p.14) |

### 3.3 CAN details for the NAV module

- **Bit rate.** "All devices on the CAN bus must be set to the same speed" (L4 p.24 [21]); the PDM runs at 250 kbps,
  500 kbps or 1 Mbps (L4 p.33 [30]); the LTC ships at 1 Mbit/s (registry, LTC manual p.8); the CANmod.gps list has 250k,
  500k and 1M (W12). The trunk's chosen bit rate is not recorded (unknown; needs: the M1 and PDM configs).
- **IDs.** The CANmod.gps defaults are very low IDs (attitude default "01": W17), which would win arbitration over MoTeC's
  own frames. Give it a free block once the M1 bus ID map exists (unknown: M130 GPR transmit IDs, PDM30/PDM15 and LTCD
  bases).
- **Load.** CSS warns the raw IMU output "generates a lot of data"; turn it off unless a display uses it (W16). The fused
  1 Hz frames are small.
- **Setup.** Dynamic model Automotive, sensor fusion on, IMU mount alignment, lever arms from the rear-axle centre (W18, W19).

### 3.4 What crosses the top disconnect

- **Recommended set: nothing.** The dish and every antenna are on the steel half-cab roof (§1.3, §2.2).
- **If the dish goes on the top (COM-TOP):** a 12 V socket inside the top at the rear pillar, fed through TOP-DISC on 4
  cavities, a paralleled pair of #20 per pole. It stays on the PDM output, no fuse: 7 A alone or 9 A with the router on the
  same output, and never above 11 A, because the pole's weak link is the 2 × 20 AWG tails at 0.85 × 14 A = 11.9 A
  (top-design's check; ProWire chart 20 AWG 7 A, ch.16 §2.3). One M81824/1-3 (16–12 AWG) cannot step 12 AWG straight to
  2 × 20 AWG, so each side steps through a 16 AWG stub (/1-3 then /1-2). The loop is 0.35 V (2.5 %) at 5.0 A with 12 AWG
  in the body, 14 AWG in the top and a 12 AWG return to the rear bus. top-design has reserved exactly those 4 spares ("4 of the spares for a
  top-mounted Starlink DC pair", TOP-DISC `top_cavities`, #420). At 5.0 A per pole that is 2.5 A per
  #20 contact, under the 7.5 A MILNEC test rating top-design cites. The USB-C cable and the Ethernet cable are one-piece
  and can't cross a connector, so on the top the router would reach the Mini over Wi-Fi (the Mini has Wi-Fi: W1).
  Numbers sent to top-design by message, 2026-09-29; their TOP-DISC entry already records the steel half-cab roof and the
  4-cavity reserve.

## 4. Recommended set

| code | what | why |
|---|---|---|
| **NAV** | CSS CANmod.gps on the M1 CAN trunk, under the dash, rigid and flat; its GNSS antenna on the steel half-cab roof | GPS and pitch/roll in one 0.6 W box; no M130 pin, no PDM output; readable by any display, logger or Nuke |
| **COM** | Starlink Mini on the steel half-cab roof (Mobility Mount, tethered), powered by Starlink's Car Adapter from its own sealed socket on a COMMS output (RUN + latch + low-voltage cutoff) | Starlink's own vehicle power path (USB-C PD); off the top's disconnect; the PDM watches the current and protects the running battery |
| **RTR** | Peplink MAX BR1 Pro 5G on the same COMMS output, Mobility 42G on the roof or its stick antennas in the cab, Starlink in by Ethernet | one truck network that stays up with the dish off; cellular where the sky is blocked; vehicle-grade 10–30 V input |
| **COM-DASH** (interim) | the Car Adapter in the existing dash outlet until a COMMS output exists | works today with no wiring |

Toggleable alternatives: NAV-L10 (GPS-L10 into the M130), NAV-DAK (GPS-50-2 on the VHX), ATT-CLINO (mechanical
clinometer), COM-ACC (camp power from the YellowTop), COM-TOP (dish on the removable top), RTR-T (Teltonika RUTX50).

## 5. Open items

**Only Skylar can answer:**
1. Camp use: should Starlink and Wi-Fi run with the engine off? If yes, off the running battery through the PDM (with a
   low-voltage cutoff), or off the YellowTop, and does the YellowTop stay in the engine bay or move behind the seat?
2. Subscriptions: in-motion Starlink needs a Roam plan ($55 / $80 / $175 a month on 2026-09-29, W10). Add a cellular plan?
3. May the steel half-cab roof be drilled (the dish mount, one 43 mm antenna hole, a cable gland), or should the dish go on
   the removable top?
4. The display (DISP): a wired MoTeC dash or a wireless tablet decides how pitch and roll are shown. With neither, is the
   stick-on clinometer enough?

**Dave or MoTeC:** can M1 GPR receive a third-party CAN frame (the CANmod.gps) or only its own GPS inputs (GPS-L10, STC)?
Is the new M130 rev Q or later? Where would the GPS-L10's 0 V and 5 V land? What are the trunk's bit rate and ID map?
Which of the four stay-alive outputs are already spoken for?

**Bench or mock-up:** the roof's flat size (T-15); the pillar route and every length (all estimates); the lever arms from
the rear-axle centre; the COMMS draw measured at the socket; the Mini's Wi-Fi strength inside the cab; the cab temperature
under the dash in summer.

## 6. Substrate inconsistencies found (not fixed here)

1. **April candidate row `dash-cabin-W090`** (`k5_registry.json` candidates) runs "GPS_Antenna → COAX M130_GPS_IN" on SMA
   RG174. The M130 has no antenna or GPS pin (L1 pp.4–5); a MoTeC GPS reaches it as RS232 on UDIG6/7 (W20). The row should
   be retired or rewritten (lead's call).
2. **CAN shielding.** Canon ch.16 §7.1 lists CAN among the shielded circuits; the CAN-BUS endpoint and the registry run the
   trunk as twisted 22 AWG M22759/16, per MoTeC ("twisted 22# Tefzel is usually OK", L4 p.52). The NAV stub follows the
   trunk.
3. **CANmod.gps supply range.** CSS's connector page says pin 9 is "Supply (5-24 V)" (W13); its spec page says 5.0–26 V
   and footnotes the reverse protection "Up to 24 V" (W12). A 12 V truck is inside both.
