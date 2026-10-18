# Lamp sockets, LED bulbs and a sealed harness end — 1977 K5 (research, 2026-09-28)

- **Ask (owner, 2026-09-28):** "lamp sockets will likely be replaced... led bulbs. need to match the sockets to the best
  lightbulb we choose... keep it simple. easiest is to find factory sockets and modify them for led... water proofing is
  important.. worst case we cut and pigtail... need the part numbers... look at the shape."
- **Scope:** every lamp endpoint in `calc-data/catalog/pin_tables/` whose device end is a factory socket or an unpicked lamp.
- **Change type:** research. No purchase and no messages were made. No registry or catalog file was edited.
- **Sources:** web pages are snapshotted to `reference_documents/web_snapshots/` through `fetch_sources.py` (Firecrawl).
  Product photos are in `reference_documents/product_images/` and listed in its `sources.json`. Both folders are gitignored.

## Strategy (one for the whole truck)

1. **Keep the factory housings and fit new GM-pattern twist-lock sockets. The housings need no modification.** The 1977
   manual says the sockets belong to the harness and twist out of the housings: "Rotate wiring harness sockets
   counterclockwise and remove housing" (tail, stop and backup, p.787). The front marker instruction reads "Twist wiring harness
   socket 90° counterclockwise and remove harness and bulb" (p.786). The park lamp instruction reads "rotating bulb socket
   counterclockwise" (p.786). A new socket twists into the same hole.
2. **The socket shape comes from the vendor photos.** The body is gray plastic and the bulb bayonet is inside it. Metal spring
   lugs on the rim lock into the housing slots, and a black rubber face gasket seals the socket to the housing. The leads leave
   the back of the body with no seal. See the photos `UP-111157_1157-socket.jpg` and `JLF-73-87-tail-socket.png`. The
   bayonet is BA15d on the 1157 and 1034 sockets (memotronics listing, AC Delco LS4).
3. **LED bulbs go in the new sockets.** All bulbs are from one maker: Diode Dynamics. It publishes measured lumens, uses
   constant-current drivers and nonpolar bases, and gives a 3-year warranty (its product pages). Philips (1157RULRX2) and
   Sylvania (1157RLED) publish no lumen figure on the pages on file.
   - The colour matches the lens: red behind red lenses, amber for the park/turn and front markers, white for backup,
     license and underhood.
   - Hyperflash and CANbus resistors do not apply. The PDM makes the flash and drives each filament circuit.
4. **Waterproofing happens at three places.** The socket's rubber face gasket seals to the housing, and the lens gasket seals
   the housing. The third place is the wire joint: **each new socket's short leads are crimped once, at the bench, into a
   sealed Deutsch DT plug.** The harness never ends in a 1960s socket and never gets cut at the truck. This is the owner's "cut
   and pigtail", done on the new socket's leads, not on the M22759 wire.
5. **One sealed connector family is used for every lamp: Deutsch DT.** It is already the body bulkhead and door family, so it
   uses the same size-16 contacts and the same crimper.
   - **Harness side:** DT06-2S or DT06-3S plug (sockets, female) with a W2S or W3S wedge, and contact 0462-201-16141.
   - **Lamp side:** DT04-2P or DT04-3P (pins) with a W2P or W3P wedge, and contact 0460-202-16141.
   - Both contacts are in `catalog/parts.yaml`, rated 20–16 AWG.
   - DT carries 13 A per size-16 contact, and its silicone seal closes on a 1.35–3.05 mm insulation OD (DT technical manual,
     farnell 628276).
   - Putting the sockets on the powered harness side keeps a live lead from exposing pins. That is shop practice, not a
     cited rule, so it is the builder's call. The door pass-throughs in the catalog put pins on the body side.

## Two harness facts that decide whether DT seals (read before cutting)

- **Wire gauge.** DT size-16 contacts take 20–16 AWG (catalog `0460-202-16141`; DT manual "DT: accepts AWG 20-14"). In
  `k5_registry.json`, twelve exterior lamp feeds are 22 AWG M22759/16: 81, 75, 89, 76, 77, 78, 92, 79, 90, 91, 93 and 74. The
  interior feeds 69 and 68 are also 22 AWG. They must go to 20 AWG at a DT plug, as row 0w already did for the front crossing
  lamp feeds. Every lamp ground and front feed is 20 AWG M22759/32.
- **Insulation OD.** The DT seal closes on 1.35–3.05 mm. M22759/32-20 is "≥ 1.27 mm" (canon ch.16, 2026-09-26 reversal
  note), which is at or under the DT seal minimum. M22759/16-20 is 1.47–1.57 mm (canon ch.16 §1.8), which is inside it.
  - Measure one /32-20 sample. If it is under 1.35 mm, run the lamp legs that end in a DT plug in /16-20 or 18 AWG.
  - The same check applies to the 20 AWG feeds through body bulkheads A and B, which are also DT.
  - **OPEN:** /32-20 measured OD.

## Per lamp

Bulb data comes from the 1977 Light Truck Service Manual p.838 (C-K). Socket numbers and lead colours come from the 1978
C-K wiring booklet ST-352-78 p.13–14.

| Lamp (endpoint) | (a) Factory bulb, socket, leads | (b) Housing socket: shape, removal | (c) LED pick | (d) Replacement socket, then sealed plug | (e) Housing mod · OPEN |
|---|---|---|---|---|---|
| Tail/stop/turn L, R (`Tail_Light_Left/Right`) | 1157 (3–32 CP); socket 8911029; 3 leads: 18 BRN-9 tail, 18 Y-18 (LH) / 18 DG-19 (RH) stop-turn, 18 B-150 ground | GM twist-lock, BA15d bayonet, rubber face gasket; twists out CCW, no tools (p.787) | Diode Dynamics 1157 XP80 **red**, DD0016S: 510 lm measured, 5.4 W, nonpolar | United Pacific **111157**, 3-wire 1157, "replaces OE 8914822, 8903202", "installs in OE light housings like the original", fits 73–91 C/K incl. Blazer (upcarparts). Alternative: JL Fabrication 3-wire socket (73–87 tail). Leads crimp into **DT04-3P** | None. OPEN: the booklet's 8911029 against the vendor cross numbers 8914822/8903202 (check one in hand); lead gauge not published (measure) |
| Backup L, R (`Backup_Light_Left/Right`) | 1156 (32 CP); socket 8911027 in the tail housing; 2 leads: 18 LG-24, 18 B-150B | Same twist-lock housing (p.787); BA15s | Diode Dynamics 1156 XPR **cool white 6000 K**, DD0369S: 830 lm, 4.3 W | 2-wire GM 1156 twist socket. **OPEN: repro part number.** The Classic Industries page refused the fetch, and the "GM 8909518" in a vendor search result is unverified for this housing. Leads crimp into **DT04-2P** | None. OPEN: socket part number |
| Park/turn LF, RF (`PARK-TURN-LF/RF`) | 1157NA amber ("1157 NA, 2.2–24 CP on C-K", p.838 note 6); socket 8911486 (1978). A 1982 forum post names 8917280 for the front socket; 3 leads: 18 BLK-150B, 18 BRN-9C, 18 LT BLU-14C | Twist-lock: "rotating bulb socket counterclockwise" (p.786, C-K parking lamp housing) | Diode Dynamics 1157 XP80 **amber**, DD0015S: 510 lm | JL Fabrication states its 3-wire socket fits "73-80 (round headlight) truck parking lights", and 1977 is a round-headlight year. A forum post says front and rear sockets are different parts (82 bumper lamp). Leads crimp into **DT04-3P** | None. OPEN: compare 8911486 against the tail socket in hand |
| Markers LF, RF (`MARKER-LF/RF`) | 168 (3 CP); socket 6294015; 2 leads: 20 BRN-9B, 20 LT BLU-14B (the factory lamp grounded through the turn filament; now to ground) | Wedge-bulb twist socket, removed "90° counterclockwise" (p.786) | Diode Dynamics 194 HP5 **amber**, DD0025S: 92 lm measured in white; the maker lists no figure for amber | GM 194/168 twist socket. The vendor states "push in/twist in lock design", "fits in a 0.525" hole", 194/168/T10 (269 Motorsports). USA1 Industries 21095 is a 73–87 marker socket with pigtail. Leads crimp into **DT04-2P** | None. OPEN: the listing names no GM number to tie it to 6294015 |
| Markers LR, RR (`MARKER-LR/RR`) | 168 in 6294015; feed + ground leads (booklet p.14) | Model 14 (Blazer) rear marker: "Remove lens to housing four screws. Replace bulb" (p.786) | Diode Dynamics 194 HP5 **red**, DD0030S | Same 194 socket; **DT04-2P** | None |
| License (`LICENSE-LAMP`) | 67 (4 CP), BA15s; one feed lead (connector 2977721); grounds through its housing | Small housing, BA15s | Diode Dynamics 1156 **HP11** (310 lm, DD category page). The DD 1156 cross-reference lists 67 | The factory lamp keeps its lead. The feed plus a new ground lead go to **DT04-2P**, the ground ringed to the lamp mount | OPEN: whether the LED body fits the lamp's glass envelope (measure) |
| Underhood (`UNDERHOOD-LAMP`) | 93 (15 CP), BA15s; factory lamp and switch assembly; one feed, grounds through its mount | Factory assembly | Diode Dynamics 1156 HP11 cool white. The DD 1156 cross-reference lists 93 | **DT04-2P** on the lamp lead plus a ground lead | OPEN: the assembly's own switch sits in series with the PDM feed; keep it or bypass it |
| Roof clearance L, C, R (`CLEARANCE-*`) | Factory roof lamps: 194 (2 CP) (p.838); the lamps are not picked | Depends on the lamp picked | Diode Dynamics 194 HP5 amber | **DT04-2P** at each lamp | OPEN: lamp pick |
| Third brake (`CHMSL`) | None in 1977 (not in p.838) | — | An LED lamp with its own leads (not picked) | **DT04-2P** | OPEN: lamp pick |
| Cargo (`CARGO-LAMP`) | C-K cab cargo lamp 1142 (21 CP), or cargo/dome 211-2 (p.838); which one fits the Blazer is not settled | — | Diode Dynamics 1157 XP80 lists 1142 in its cross-reference. A 1142 socket does not ground the shell, so a 1157-type LED may not light in it | **DT04-2P** | OPEN: lamp and socket |
| Dome (`DOME-LAMP`) | Utility (Blazer) dome 211-2 festoon (12 CP); terminals 2977080 (RPO C8B) | Festoon clips, inside the cab | Diode Dynamics 41 mm HP6 warm white, DD0354S: 130 lm | The factory terminals stay; no seal is needed in the dry cab. DT only if one family is wanted everywhere | OPEN: 211-2 clip length against 41 mm (measure) |
| Footwell, under-dash (`FOOTWELL-LAMPS`, `UNDERDASH-LAMPS`) | Not factory; not picked | — | An LED lamp with its own leads | In the dry cab: DT or the device's own leads | OPEN: lamp pick |

**Harness side carries:** a DT06-3S plug at the tail/stop/turn and park/turn lamps, and a DT06-2S plug at every other lamp.

## Not found (said plainly)

- **No sealed socket that twist-locks into these 1973–87 housings.** Truck-Lite's sockets 94938, 94937 and 94940 are twist
  sockets with a "Stripped End/Ring Terminal" (truck-lite.com sockets page). Grote 84-1067 is a flange-mount socket for a
  1-1/8" hole. Dorman's sealed GM pigtails are connectors, not bulb sockets. That is why the seal sits in the DT plug on the
  new socket's leads.
- **The factory housings' bayonet hole diameter is not measured.** Only the marker socket's 0.525" hole is published.
  CAD will come from 3D-scanning a housing, as the owner said.

## Files and photos saved

- **Snapshots:**
  - Sockets and forum: upcarparts 111157; jlfabrication 73-87 socket; memotronics AVC11475; gmsquarebody 14528.
  - Diode Dynamics: 1157 XP80 tail and turn; 1156 XPR; 194 HP5; 41 mm HP6.
  - Other bulbs: Sylvania 1157RLED; Philips 1157RULRX2.
  - Connectors: DT technical manual (farnell 628276); customconnectorkits DT06-3S, DT04-3P, DT06-2S.
  - Still in the fetch queue: DT04-2P, 269motorsports, usa1industries, truck-lite, ck5, Classic Industries, LMC, DD 1156 HP11,
    dynamicappearance.
- **Photos:**
  - DD0015_DD0016_1157-XP80.jpg
  - DD0369_1156-XPR.jpg
  - DD0025_DD0030_194-HP5.jpg
  - DD0354_41mm-HP6.jpg
  - UP-111157_1157-socket.jpg
  - JLF-73-87-tail-socket.png
