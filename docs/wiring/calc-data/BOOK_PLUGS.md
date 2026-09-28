# Plug write-ups

5 of 14 engine plugs are solved to the last field: Coolant temp sensor; Oil pressure sensor; 61-pin firewall plug, engine side; PDM30 laptop port; M130 laptop port. The other 9 have one or two items left, stamped in their sections. Every 22 AWG run is M22759/16, 20 AWG and up M22759/32, and the crank, cam and knock runs are two-conductor shielded cable (M27500). Cut lengths, twist and sleeve grouping are LATER: they come off the formboard.

## How each plug type is built

| Plug type | Contact or terminal | Crimp tool and setting |
|---|---|---|
| M130 and PDM30 plugs (Superseal 1.0) | SSC-N | AFM8 crimp frame + K1S positioner, selector 24→5, 22→6, 20→7, 18→8, 16→8 |
| 61-pin firewall plug | M39029/56-351 socket (cab side), M39029/58-363 pin (engine side) | AFM8 crimp frame + K43 positioner, selector 24→4, 22→5, 20→6 |
| GT150 plugs: coolant temp, oil PSI | 12191818, 15366021 | GT150 hand crimper |
| Metri-Pack 150 plugs: crank, cam, MAP, knock | 12110847, 15324976 | Metri-Pack 150/280 sealed crimp tool |
| Injector plugs (EV1) | 68102 | the crimper the terminal bag names — LATER |
| Throttle-body plug (ICT WCTHB50) | the terminals in the kit | the crimper the terminal bag names — LATER |
| Coil plugs (ProWire kit terminals) | the terminals in the kit | the crimper the terminal bag names — LATER |
| Splices at the M130 and PDM30 pins, the pedal pigtail and the isolator leads | D-609-03 (26-20 AWG), D-609-04 (20-16 AWG), D-609-05 (16-12 AWG) | MiniSeal splice crimper |
| PDM30 laptop port (5-pin XLR) | NC5FD-L-1 | solder cups — soldering iron |

Pull-test every crimp: 22 AWG ≥ 8 lbf, 20 ≥ 13, 18 ≥ 20, 16 ≥ 30. The 61-pin contacts are stricter: 22 AWG ≥ 13 lbf, 20 ≥ 21. Strip so the conductor shows in the inspection hole; measure the barrel on the first contact of every type at the bench (no saved source gives the depth). Read the K43's selector settings off its data plate when it arrives.

From: 61-pin cavity map (June 10 build sheet) · IPC/WHMA-A-620 pull-test values · MoTeC PDM + C125 manuals (22 AWG wire is M22759/16-22) · ProWire SSC-N tooling chart · MoTeC M130 datasheet · [Checkline pull-test sheet](https://www.checkline.com/res/products/126677/wire_pull_test_standards.pdf) · [DMC tooling for M39029/56-351](https://dmctools.com/m39029/contact/196)

## Tools

| Tool | For | Stamp |
|---|---|---|
| Ideal Stripmaster 45-1987 (Tefzel blades) + wire stop L-5270 | every plug type | BUY NOW — [ProWire](https://www.prowireusa.com/p-2025-ideal-stripmater-tefzel-stripper-26-16-ga.html), $313.54 |
| DMC AFM8 crimp frame (M22520/2-01) | M130 and PDM30 plugs, 61-pin firewall plug | BUY NOW — chosen: eBay listing 336813500716, $50.00 |
| DMC K1S positioner for the AFM8 (M22520/2-02) | M130 and PDM30 plugs | BUY NOW — [ProWire](https://www.prowireusa.com/p-1384-k1s-postioner.html), $126.36 |
| DMC K43 positioner for the AFM8 (M22520/2-10) | 61-pin firewall plug | BUY NOW — chosen: eBay listing 178217121942, $30.00 |
| Insertion/removal tool, size 20, MIL-C-38999 (M81969/14-10) | 61-pin firewall plug | BUY NOW — in the ProWire cart |
| RT125 epoxy dispenser + mixers | 61-pin firewall plug | BUY NOW — in the ProWire cart |
| Delphi/Aptiv GT150 hand crimper (15359996) | GT150 plugs | BUY NOW — [ProWire](https://www.prowireusa.com/p-1233-delphi-gt150-hand-crimp-tool.html), $156.49 |
| Metri-Pack 150/280 sealed crimp tool (12155975) | Metri-Pack 150 plugs | BUY NOW — [ProWire](https://www.prowireusa.com/p-2104-metri-pack-150-280-sealed-crimp-tool.html), $110.40 |
| Ideal Stripmaster 45-1611 (Tefzel blades) + wire stop L-5270 | Splices at the M130 and PDM30 pins, the pedal pigtail and the isolator leads | BUY NOW — [ProWire](https://www.prowireusa.com/p-2026-ideal-stripmater-tefzel-stripper-14-10-ga.html), $313.54 |
| MiniSeal splice crimper (ProWire 3137CT = Raychem AD-1377) | Splices at the M130 and PDM30 pins, the pedal pigtail and the isolator leads | BUY NOW — [ProWire](https://www.prowireusa.com/3137ct.html), $158.40 |
| Pull gauge / spring scale, ≥ 50 lbf | every plug type | YOUR PICK — do you own one? If not, I add one to the order |
| Heat gun with reflector attachments | 61-pin firewall plug, Splices at the M130 and PDM30 pins, the pedal pigtail and the isolator leads, PDM30 laptop port | YOUR PICK — do you own one? If not, I add one to the order |
| Inch-pound torque wrench | 61-pin firewall plug | YOUR PICK — do you own one? If not, I add one to the order |
| Soldering iron + solder | PDM30 laptop port | YOUR PICK — do you own one? If not, I add one to the order |
| Multimeter | Continuity on every wire | YOUR PICK — do you own one? If not, I add one to the order |
| Flush cutter, 12–26 AWG | cutting wire | YOUR PICK — do you own one? If not, I add one to the order |
| Open-barrel crimper for TE Junior Power Timer 2.8 mm terminals (EV1) | Injector plugs | LATER — the terminal part number on the kit bag names it |
| TE AMP hand crimper for the Gen V throttle-body terminals | Throttle-body plug | LATER — the terminal part number on the kit bag names it |

## Throttle body (GM 12699160, Gen V SENT) · 3 items open

Kit: WCTHB50 ×1: **BUY NOW**, to add to the ICT Billet order

| Wire | Size, colour | Throttle-body pin | 61-pin | Other end |
|---|---|---|---|---|
| throttle motor + | 20 AWG white/brown | 1 | B | M130 A18 |
| throttle motor − | 20 AWG white/red | 2 | C | M130 A01 |
| TPS signal (SENT) | 22 AWG green/brown, doubled over at the terminal | 3 | FF | M130 B09 |
| TPS 0 V | 22 AWG brown, doubled over at the terminal | 4 | f | M130 B16 (spliced) |
| TPS 5 V | 22 AWG orange, doubled over at the terminal | 5 | e | M130 A02 (spliced) |

**LATER** — pin order: cite a GM end view of 12699160 before terminating (review A2; state row 29 and 0s: the order is borrowed from other GM SENT bodies)

**LATER** — bench check before crimping: this throttle body's pin order is borrowed from other GM SENT throttle bodies (no saved source names 12699160); meter it — the two motor pins are the pair with a low resistance between them

**LATER** — TE AMP hand crimper for the Gen V throttle-body terminals: the terminal part number in the kit names it

From: [MaxxECU GM SENT throttle-body pinout](https://www.maxxecu.com/webhelp/wirings-e-throttle_bodies.html) · [ICT Billet WCTHB50](https://www.ictbillet.com/products/lt-gen-v-throttle-body-connector-component-kit) · Dave's M130 sheet

## Coil 1 (coils 2–8 the same) · 1 item open

The others: coil 2 — M130 A06, 61-pin N · coil 3 — M130 A03, 61-pin P · coil 4 — M130 A07, 61-pin R · coil 5 — M130 A04, 61-pin S · coil 6 — M130 A08, 61-pin T · coil 7 — M130 A05, 61-pin U · coil 8 — M130 A12, 61-pin V.

Kit: COIL-CONN-LS2/7 ×1: **BUY NOW**, in the ProWire cart

| Wire | Size, colour | Coil pin | 61-pin | Other end |
|---|---|---|---|---|
| coil 1 chassis ground | 18 AWG black | a | — | head ring terminal, chassis ground |
| coil 1 signal ground | 18 AWG brown/black | b | — | head ring terminal, signal ground |
| coil 1 trigger | 22 AWG white, doubled over at the terminal | c | M | M130 A13 |
| coil 1 +12 V | 18 AWG red | d | — | coil +12 V splice |

**LATER** — the terminal part number on the kit bag names the crimper

From: Dave's M130 sheet · ProWire LS coil plug kit page

## Injector 1 (injectors 2–8 the same) · 1 item open

The others: injector 2 — M130 A20, 61-pin E · injector 3 — M130 A21, 61-pin F · injector 4 — M130 A22, 61-pin G · injector 5 — M130 A27, 61-pin H · injector 6 — M130 A28, 61-pin J · injector 7 — M130 A29, 61-pin K · injector 8 — M130 A30, 61-pin L.

Kit: 8CYLK-90 (one kit covers 8): **BUY NOW**, in the ProWire cart

| Wire | Size, colour | Injector pin | 61-pin | Other end |
|---|---|---|---|---|
| injector 1 driver | 22 AWG white, doubled over at the terminal | 1 | D | M130 A19 |
| injector 1 +12 V | 20 AWG red | 2 | — | injector +12 V splice |

**LATER** — open-barrel crimper for TE Junior Power Timer 2.8 mm terminals (EV1): the terminal part number in the kit names it

From: [Siemens Deka FI114961](https://siemensdeka.com/product/60lbh-siemens-deka-high-impedance-long-style-with-ev1-connector-fi114961-60mm/) · ProWire 8-injector EV1 kit page

## Crank sensor · 1 item open

Kit: LS-CRANK-CONN-KIT ×1: **BUY NOW**, in the ProWire cart, 1 more to add

| Wire | Size, colour | Sensor pin | 61-pin | Other end |
|---|---|---|---|---|
| crank signal | 22 AWG shielded cable | 1 | x | M130 B01 |
| crank 0 V | 22 AWG shielded cable | 2 | JJ | M130 B15 (spliced) |
| crank 6.3 V | 22 AWG white/orange | 3 | NN | M130 B19 (spliced) |

**LATER** — bench check: if 22 AWG slides loose in the white seal (15324976, 1.3–2.1 mm), use the blue 15324974 (1.0–1.9 mm) — its fit with terminal 12110847 is not confirmed yet

From: Dave's M130 sheet · ProWire LS crank/MAP plug kit page

## Cam sensor · 1 item open

Kit: LS-CAM-CONN-KIT ×1: **BUY NOW**, in the ProWire cart

| Wire | Size, colour | Sensor pin | 61-pin | Other end |
|---|---|---|---|---|
| cam 6.3 V | 22 AWG white/orange | 1 | Z | M130 B19 (spliced) |
| cam 0 V | 22 AWG shielded cable | 2 | HH | M130 B15 (spliced) |
| cam signal | 22 AWG shielded cable | 3 | v | M130 B02 |

**LATER** — bench check: if 22 AWG slides loose in the white seal (15324976, 1.3–2.1 mm), use the blue 15324974 (1.0–1.9 mm) — its fit with terminal 12110847 is not confirmed yet

From: Dave's M130 sheet · ProWire LS cam plug kit page

## Knock sensor 1 (knock 2 the same) · 2 items open

The others: knock sensor 2 — M130 B13, 61-pin BB.

Kit: 68201 ×1: **BUY NOW**, in the ProWire cart

| Wire | Size, colour | Sensor pin | 61-pin | Other end |
|---|---|---|---|---|
| knock 1 signal | 22 AWG shielded cable | 1 | AA | M130 B07 |
| knock 1 0 V | 22 AWG shielded cable | 2 | LL | M130 B16 (spliced) |

**LATER** — the kit bag shows whether its terminals are Metri-Pack or GT150; both 22 AWG sets are on the list

**LATER** — bench check: if 22 AWG slides loose in the white seal (15324976, 1.3–2.1 mm), use the blue 15324974 (1.0–1.9 mm) — its fit with terminal 12110847 is not confirmed yet

From: Dave's M130 sheet · ProWire LS knock plug kit page

## MAP sensor (GM Gen IV 1-bar) · 2 items open

Kit: LS-CRANK-CONN-KIT ×1: **BUY NOW**, in the ProWire cart, 1 more to add

| Wire | Size, colour | Sensor pin | 61-pin | Other end |
|---|---|---|---|---|
| MAP 0 V | 22 AWG brown | 1 | q | M130 B16 (spliced) |
| MAP signal | 22 AWG green/red | 2 | CC | M130 A15 |
| MAP 5 V | 22 AWG orange | 3 | r | M130 A02 (spliced) |

**YOUR PICK** — the MAP sensor itself: a GM Gen IV 1-bar MAP (the plug above fits it)

**LATER** — bench check: if 22 AWG slides loose in the white seal (15324976, 1.3–2.1 mm), use the blue 15324974 (1.0–1.9 mm) — its fit with terminal 12110847 is not confirmed yet

From: Dave's M130 sheet · ProWire LS crank/MAP plug kit page

## Coolant temp sensor (for the M130) · solved

Kit: GT150-WTR-TEMP-KIT ×1: **BUY NOW**, in the ProWire cart

| Wire | Size, colour | Sensor pin | 61-pin | Other end |
|---|---|---|---|---|
| coolant temp 0 V | 22 AWG brown/black | 1 | Y | M130 B16 (spliced) |
| coolant temp signal | 22 AWG yellow/red | 2 | w | M130 B04 |

From: Dave's M130 sheet · ProWire GT150 coolant-temp kit page

## Oil pressure sensor (for the M130) · solved

Kit: ICT-GEN4-OILP ×1: **BUY NOW**, on the ICT Billet link

| Wire | Size, colour | Sensor pin | 61-pin | Other end |
|---|---|---|---|---|
| oil PSI 0 V | 22 AWG brown/black | 1 | n | M130 B16 (spliced) |
| oil PSI 5 V | 22 AWG orange | 2 | m | M130 A02 (spliced) |
| oil PSI signal | 22 AWG green | 3 | DD | M130 A25 |

From: Dave's M130 sheet · your Sep 25 orders

## Gas pedal (GM Gen III truck pedal, 9-way plug, bought 2025-04-02) · 2 items open

Kit: WPAPP30 ×1: **BUY NOW**, to add to the ICT Billet order

| Wire | Size, colour | Pedal pin | 61-pin | Other end |
|---|---|---|---|---|
| pedal track 1 5 V | 22 AWG orange | G | — | M130 A02 (spliced) |
| pedal track 1 signal | 22 AWG green/violet | F | — | M130 B21 (spliced) |
| pedal track 1 0 V | 22 AWG brown | E | — | M130 B16 (spliced) |
| pedal track 2 0 V | 22 AWG white/blue | D | — | M130 B15 (spliced) |
| pedal track 2 signal | 22 AWG green/gray | C | — | M130 B22 |
| pedal track 2 5 V | 22 AWG orange/black | B | — | M130 A09 |

**LATER** — before crimping, meter the pedal: G–E and B–D read a fixed resistance, F–E and C–D change as the pedal moves (the pin map is from a web source, not a GM manual)

**LATER** — cavity letters: read the WPAPP30 plug — the plug moulds 9 cavities, 6 wired (B–G); no saved source names the 3 unused ones (the third sensor's), and whether the pigtail carries 9 leads or 6 is not on the ICT page (review C24)

From: [ICT Billet WCTHB50](https://www.ictbillet.com/products/lt-gen-v-throttle-body-connector-component-kit)

## 61-pin firewall plug, engine side · solved

Kit: D38999/26WJ61PN ×1: **BUY NOW**, on the eBay list (surplus listing chosen) · M85049/69-25N ×1: **BUY NOW**, in the DigiKey cart · 202K163-25-0 ×1: **BUY NOW**, in the ProWire cart · ADHESIVES-KIT (one kit covers 2): **BUY NOW**, in the ProWire cart

| Cavity | Wire | Size, colour | Cab end |
|---|---|---|---|
| A | Dakota coolant sender | 22 AWG yellow/blue | DAK-CTS (SEN-04-5 lead 1) |
| B | throttle motor + | 20 AWG white/brown | M130 A18 |
| C | throttle motor − | 20 AWG white/red | M130 A01 |
| D | injector 1 driver | 22 AWG white | M130 A19 |
| E | injector 2 driver | 22 AWG white | M130 A20 |
| F | injector 3 driver | 22 AWG white | M130 A21 |
| G | injector 4 driver | 22 AWG white | M130 A22 |
| H | injector 5 driver | 22 AWG white | M130 A27 |
| J | injector 6 driver | 22 AWG white | M130 A28 |
| K | injector 7 driver | 22 AWG white | M130 A29 |
| L | injector 8 driver | 22 AWG white | M130 A30 |
| M | coil 1 trigger | 22 AWG white | M130 A13 |
| N | coil 2 trigger | 22 AWG white | M130 A06 |
| P | coil 3 trigger | 22 AWG white | M130 A03 |
| R | coil 4 trigger | 22 AWG white | M130 A07 |
| S | coil 5 trigger | 22 AWG white | M130 A04 |
| T | coil 6 trigger | 22 AWG white | M130 A08 |
| U | coil 7 trigger | 22 AWG white | M130 A05 |
| V | coil 8 trigger | 22 AWG white | M130 A12 |
| W | oil temp 0 V | 22 AWG brown | M130 B16 |
| X | Dakota coolant sender return | 22 AWG  | DAKOTA-VHX (WTR -) |
| Y | coolant temp 0 V | 22 AWG brown/black | M130 B16 |
| Z | cam 6.3 V | 22 AWG white/orange | M130 B19 |
| a | Dakota oil sender 0 V | 22 AWG  | DAKOTA-VHX (OIL -) |
| b | cam shield drain | 22 AWG white/blue | M130 B15 |
| c | fan speed PWM | 20 AWG  | M130 A34 |
| e | TPS 5 V | 22 AWG orange | M130 A02 |
| f | TPS 0 V | 22 AWG brown | M130 B16 |
| g | fuel PSI 0 V | 22 AWG brown/black | M130 B16 |
| h | fuel PSI 5 V | 22 AWG orange | M130 A02 |
| i | Dakota oil sender 5 V | 22 AWG  | DAKOTA-VHX (OIL +) |
| j | CAN Lo: body PDM30 to engine PDM15, through the 61-pin | 22 AWG green | PDM30 CANLO |
| k | Dakota oil sender | 22 AWG green/white | DAK-OILP (SEN-03-8 white, signal) |
| m | oil PSI 5 V | 22 AWG orange | M130 A02 |
| n | oil PSI 0 V | 22 AWG brown/black | M130 B16 |
| p | knock 2 shield drain | 22 AWG brown/black | M130 B16 |
| q | MAP 0 V | 22 AWG brown | M130 B16 |
| r | MAP 5 V | 22 AWG orange | M130 A02 |
| s | inlet air temp 0 V | 22 AWG brown | M130 B16 |
| v | cam signal | 22 AWG shielded cable | M130 B02 |
| w | coolant temp signal | 22 AWG yellow/red | M130 B04 |
| x | crank signal | 22 AWG shielded cable | M130 B01 |
| y | fuel PSI signal | 22 AWG green/orange | M130 A16 |
| z | inlet air temp signal | 22 AWG yellow/brown | M130 B03 |
| AA | knock 1 signal | 22 AWG shielded cable | M130 B07 |
| BB | knock 2 signal | 22 AWG shielded cable | M130 B13 |
| CC | MAP signal | 22 AWG green/red | M130 A15 |
| DD | oil PSI signal | 22 AWG green | M130 A25 |
| EE | oil temp signal | 22 AWG yellow/orange | M130 B05 |
| FF | TPS signal (SENT) | 22 AWG green/brown | M130 B09 |
| GG | CAN Hi: body PDM30 to engine PDM15, through the 61-pin | 22 AWG yellow | PDM30 CANHI |
| HH | cam 0 V | 22 AWG shielded cable | M130 B15 |
| JJ | crank 0 V | 22 AWG shielded cable | M130 B15 |
| KK | crank shield drain | 22 AWG white/blue | M130 B15 |
| LL | knock 1 0 V | 22 AWG shielded cable | M130 B16 |
| MM | knock 2 0 V | 22 AWG shielded cable | M130 B16 |
| NN | crank 6.3 V | 22 AWG white/orange | M130 B19 |
| PP | knock 1 shield drain | 22 AWG brown | M130 B16 |

From: your Sep 25 orders · ProWire RT125 epoxy page · Dave's M130 sheet · MoTeC PDM manual p.50 (CAN) · [kartek.com](https://www.kartek.com/mm5/graphics/00000002/spal-brushless-fans-engine-ecu-pwm-pulse-width-modulation-requirements.jpg,)

## CAN bus (M130 to PDM30) · 9 items open

Kit: CAN-TERM-100R ×2: **BUY NOW**, to add to the DigiKey cart

| Wire | Size, colour | From | To |
|---|---|---|---|
| CAN high (trunk) | 22 AWG  | M130 B17 | PDM30 B26 (CAN High) |
| CAN low (trunk) | 22 AWG  | M130 B18 | PDM30 B25 (CAN Low) |

The laptop-port branch off this trunk is under PDM30 laptop port.

**LATER** — CAN cavities GG and j are not adjacent on the 61-pin: choose an adjacent pair from the spares c, d, t, u or accept (the twisted pair splits across the insert; review A10). Cavity d is spare since the speed sender left the 61-pin (review A11)

**LATER** — UTC stub: splice the UTC pair onto the trunk within 500 mm of the M130 end, stub 500 mm max (p.49); the splice point is not placed yet

**LATER** — PDM30 and PDM15 stubs 500 mm max off the trunk (p.49): each PDM takes two wires per CAN pin (trunk in, trunk out) or a short stub — set at the formboard

**LATER** — LTCD lead length from the PDM15: not measured (it is the far trunk end, with its own 100R)

From: MoTeC PDM manual p.50 (CAN)

## PDM30 laptop port (5-pin XLR) · solved

Kit: NC5FD-L-1 ×1: **BUY NOW**, in the DigiKey cart

| Wire | Size, colour | From | To |
|---|---|---|---|
| laptop port CAN high | 22 AWG yellow | CAN-BUS (trunk CAN_HI splice) | PORT-UTC (XLR pin 5) |
| laptop port CAN low | 22 AWG green | CAN-BUS (trunk CAN_LO splice) | PORT-UTC (XLR pin 4) |
| laptop port 0 V | 22 AWG brown | PDM30 B22 | PORT-UTC (XLR pin 1) |

From: MoTeC PDM manual p.48

## M130 laptop port (RJ45) · solved

Kit: M-RJ45-CABLE ×1: **BUY NOW**, to add to the ProWire cart

| Wire | Size, colour | From | To |
|---|---|---|---|
| Ethernet TX+ | 24 AWG Cat5 pair | M130 B23 | PORT-ETH (socket pin 3) |
| Ethernet TX− | 24 AWG Cat5 pair | M130 B24 | PORT-ETH (socket pin 6) |
| Ethernet RX+ | 24 AWG Cat5 pair | M130 B25 | PORT-ETH (socket pin 1) |
| Ethernet RX− | 24 AWG Cat5 pair | M130 B26 | PORT-ETH (socket pin 2) |

From: MoTeC M1 Tune manual p.10 (Ethernet) · ProWire MoTeC RJ45 panel cable page
