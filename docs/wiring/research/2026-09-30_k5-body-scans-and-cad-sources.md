# K5 body: existing 3D scans and CAD, local scanning, and who to ask (2026-09-30)

Owner, 2026-09-29: "the blender file for the blazer is not perfectly accurate ... really nice and accurate on the
outside ... not perfect especially when you start trying to line up the factory curves of the internal firewall
... the rear double wall" and "if our blocker starts being that we need a 3-D scan of a Chevy blazer ... we kinda
need to find somebody on the Internet partner or ... service".

This is a research note. Nothing was bought, no account was made, nothing was sent. Web pages were read on
2026-09-29, one request at a time per host; prices are as shown that day and go stale fast (supply-side rule).

## 1. The answer

- **Nobody sells or shares a scan of the square-body cab interior, firewall, floor or rear body that we could
  find.** The only square-body scan for sale is a door panel. The 3D-asset stores sell exterior art models like
  the TurboSquid body we already have. The one GM-truck body scan in a scan store is a 1967-72 C10.
- **So the scan has to be of this truck.** That's also the only scan that shows its own changes: the iBooster
  on the driver firewall, the holes the swap made, whatever is behind the gold panel. Two ways to do it
  locally: rent a metrology scanner in Las Vegas and scan it ourselves, or hire a mobile scanning service.
  Neither publishes a price, so the first step is two quote requests (drafts in section 4).
- **The only priced scanning service is the SEMA Garage in Diamond Bar, CA: $160/hr for non-members** (FARO Edge
  ScanArm), and the truck has to go there.
- **The tape list covers every harness decision that's waiting.** `calc-data/cad/tape_list.yaml` has 15 items.
  Items T-01 to T-04 unblock the 61-pin plate, the boots and the M130 spot now. A scan improves the twin as a
  whole, but no decision waits on it.

## 2. Options, ranked for this build

What counts: it has to cover the **inner firewall, floor and rear double wall**, since the outside is already
good. The accuracy has to beat the tape list's tolerances (0.5 mm for the plate, 3-5 mm for clearances and
calibration, 25 mm for lengths). We have to own the data or be licensed to use it. After that, cost and lead
time.

| Rank | Option | Covers | Accuracy claimed | Format | License | Price (read 2026-09-29) | Lead time | URL |
|---|---|---|---|---|---|---|---|---|
| 1 | **Rent a Creaform HandySCAN BLACK Elite** from Las Vegas 3D Scanning; we scan the firewall (both faces), dash panel, floor and rear body ourselves | Whatever we point it at | "0.025 mm (0.0009 in)" accuracy; "0.020 + 0.040 mm/m" volumetric; "ISO/IEC 17025: 2017 accredited laboratory" | VXelements on a supplied laptop (mesh, STL) | Ours | Not published (rental inquiry form) | Not published | lasvegas3dscanning.com |
| 2 | **Hire an on-site scan**: Tangent Solutions (Costa Mesa, CA; mobile service to Las Vegas; says it scans "cars, car interiors, car parts") | Whatever we specify | "resolutions of up to 0.02mm" (blue-light laser) | OBJ, STL; STEP, IGES, XT on request | Ours (commissioned work; confirm in the quote) | Not published (quote) | "as little time as one business day" to schedule; scan "within a few hours" | usetangent.com/3d-mobile-laser-scanning-las-vegas/ and usetangent.com/phone-number/las-vegas/ |
| 3 | **Ask OER (Classic Industries) for the firewall's 3D data.** They sell a stamped reproduction "1973-91 Chevy GMC; Pickup, Blazer, Jimmy, Suburban; Firewall Panel; with AC", #154908. Fallback: buy the panel and scan it loose on a bench with option 1 | Firewall only, as reproduced (not the floor or rear) | Not stated | Whatever they hold (ask) | Theirs; ask for use rights or an NDA | Data: ask. Panel: **$479.99** | Unknown | oerparts.com (Body Panels > Firewall > Firewall Full) |
| 4 | **SEMA Garage scanning**, Diamond Bar, CA; "We can scan vehicles or parts" | Whatever the arm reaches (strong on the firewall and engine bay) | Not stated (FARO Edge ScanArm) | Not stated | Ours (paid service; confirm) | **Non-member $160/hr** (SEMA member $120/hr; $85/hr with Tech Transfer) | Not stated | semagarage.com/services/scanning |
| 5 | SCANM2, New York with a Nevada team; "in-studio and on-location 3D scanning services throughout the region" including Las Vegas | Whatever we specify; vehicles not in its list | Not stated | E57/RCP/LAS point clouds; STEP, DWG, SolidWorks | Ours (confirm) | Not published | Not stated | scanm2.com/landings/3d-scanning-for-reverse-engineering-in-nevada/ |
| 6 | MYND Workshop, New York, with a Las Vegas hub covering Boulder City; LiDAR and photogrammetry; has BMW and Audi vehicle scans in its portfolio | Whatever we specify | Not stated | OBJ, FBX, STL, PLY, IGES, STEP | Ours (confirm) | Not published | Not stated | myndworkshop.com/scan-meshing-3d-modeling-services/las-vegas-nv |
| 7 | Buy a Revopoint MetroX and scan it ourselves | Whatever we point it at; markers needed on large objects | "0.03 mm" accuracy; "0.03 mm + 0.1 mm x L" volumetric, about 0.2 mm across a 1.7 m firewall | STL/OBJ (Revo Scan) | Ours | **~$1,100-1,250** (3dtechvalley review, 2026-03-21) | Shipping | revopoint3d.com/products/3d-laser-scanner-metrox |
| 8 | Photogrammetry from our own photos (Apple Object Capture on the Mac, or a phone LiDAR app), scaled and checked with tape-list numbers | Whatever we photograph | Not published; check it against T-12 and T-13 | USDZ/OBJ | Ours | $0 | Same day | — |

Ranks 1 and 2 are the real choice. It comes down to whose hours: renting uses Skylar's or Dave's day, hiring
doesn't. Get both quotes; take the cheaper one that can do it within two weeks.

**Also found, not useful for this build:**

| Source | What it is | Why not | Price (read 2026-09-29) | URL |
|---|---|---|---|---|
| TurboSquid #1764639 (in the twin) and similar (TurboSquid 1341258 '92-94 K5, 3DModels.org "Chevrolet Blazer (K5) 1991", Sketchfab models) | Polygon art models | Exterior only; the interior is modelled by eye | — | turbosquid.com, 3dmodels.org, sketchfab.com |
| Etsy "73-87 C10 Door Panel 3D Scan File" | A real scan, OBJ over 1 GB | Door panel only | Unknown (Etsy returns 403 to our fetch) | etsy.com/listing/4534118052 |
| Bremar Automotion 3D Scan Store | Scan store; "67-72 SB C10 Truck Body" scan; takes scan requests | No 1973-91 GM truck body. **Its "GM LS3 Engine (engine only)" STL scan (A$49) could help the twin lane's engine** (it has Holden mounts, manifolds and stock accessories, not the Holley Mid-Mount) | LS3 scan A$49 | bremar3dscanstore.com |
| Off_White Suspension "73-87 C10 Complete Chassis Airbag 3D Model" | STEP, DXF and PDF of their own C10 airbag chassis | An engineered 2WD C10 chassis, not the K5 frame, and single-user licensed. Mitchell and GM already cover the K5 frame | $799.00 | offwhitesuspension.com/product/73-87-c10-complete-chassis-3d-model |
| Rust Belt OffRoad, Canfield OH | New reproduction 1973-87 cab, "Original Firewall with A/C" option, built to order | A cab, not data. Their build jig carries the cab datums, so a follow-up question could be worth asking | $12,999.00 | rustbeltoffroad.com/products/1973-1987-square-body-cab |
| Roadster Shop 1973-91 Blazer chassis | Aftermarket chassis with CNC-located factory body and core-support mounts | Would give body-mount coordinates if they shared them; no CAD offered publicly | — | roadstershop.com/chassis-and-suspension/vehicles/1973-91-blazer-4x4/ |
| Smooth firewall panels (LS Fab, Hutch's Welding, Restomod Air, Hart Fab, A2 Metal Fab, Eckler's) | Laser-cut flat panels | Smooth, not the factory stampings | — | (vendor pages) |
| SEMA Tech Transfer 3D scan library | Scan library for members | 31 vehicles as of SEMA News, January 2021; the classics named are a '69 Mustang and a '68 Bronco; no square body named | Membership | sema.org/news-media/magazine/2021/01/sema-garage-gets-updated-scanning-capabilities |
| PrintAWorld "Las Vegas" page | New York shop's SEO page | Not local | "Starting at $150" | prtwd.com/3d-scanning-service-las-vegas/ |
| Hypercad Technologies "Las Vegas" page | The page is now a gambling site | Dead lead | — | — |

**Searched, found nothing:** "square body 3D scan" / "C10 firewall CAD DXF STEP" / "K5 Blazer 3D scan" on the
open web; GrabCAD (403 to our fetch); the 73-87chevytrucks.com forum thread "Anyone seen 3D/CAD models of
squarebodies?" (2015; certificate error, not read); the Sketchfab "Accurate Car Reference Scans" collection
(24 scans; the only GM truck is a 1986-90 S-15 Jimmy, no full-size).

## 3. What a scan has to capture (so the quote is specific)

1. The dash panel (firewall), engine face and cab face, edge to edge. It has to take in the fuse-box opening,
   the four factory grommets, the iBooster mount, the heater and A/C openings, and the cowl plenum underside.
2. The floor pan from the dash panel to the rear seat riser: the tunnel, the seat mounts, the body-mount
   areas from underneath.
3. The rear body inside: both inner quarter panels (the "rear double wall"), the wheelhouses, the tail-lamp
   pockets from the inside and through the lamp openings, and the tailgate opening.
4. Five to ten tape-list points visible in the scan (T-02, T-06, T-08, T-12), so the scan registers to the
   frame and the Mitchell numbers. `calc-data/cad/check_dimensions.py --points` gives the Mitchell frame
   points in 3D.

Deliverable: full-resolution STL (or OBJ) per area, plus the raw scan project, in millimetres.

## 4. Outreach drafts (for Skylar to send; nothing has been sent)

Fill in your contact line. They're deliberately short.

**Draft 1: Las Vegas 3D Scanning (rental quote)** -- through the rental inquiry form on lasvegas3dscanning.com

> Subject: HandySCAN BLACK Elite rental, 1-2 days, Boulder City
>
> Hi, I'd like a quote to rent the HandySCAN BLACK Elite with the VXelements laptop for 1-2 days. I'm scanning
> the firewall, floor and rear body inside of a 1977 Chevy K5 Blazer in my shop in Boulder City, to build a
> wiring harness model. Could you tell me the daily and weekend rate, the deposit and insurance you need, whether
> positioning targets come with it or how many I should buy, and whether you'd do a short walkthrough at pickup?
> If you also scan as a service, what would you charge to do it yourselves?
> Thanks, Skylar Williams, NUKE LTD, [phone / email]

**Draft 2: Tangent Solutions (on-site scan quote)** -- through the contact form on usetangent.com

> Subject: Quote: on-site scan of a 1977 Blazer's firewall, floor and rear body (Boulder City, NV)
>
> Hi, I need a quote for an on-site scan in Boulder City, NV of a 1977 Chevy K5 Blazer that's mid-build. I need
> the inside, not the outside: the firewall (engine side and cab side), the floor pan, and the rear body interior
> (inner quarter panels, wheelhouses, tail-lamp pockets, tailgate opening). Deliverables would be full-resolution
> STL in millimetres per area and the raw scan project. I own the resulting data. Please include the accuracy
> you'd hold over a 1.7 m panel, your travel charge from Costa Mesa, how long on site, and your lead time.
> Thanks, Skylar Williams, NUKE LTD, [phone / email]

**Draft 3: OER / Classic Industries (firewall CAD)** -- through classicindustries.com customer service

> Subject: 3D data or drawing for OER firewall #154908 (1973-91 C/K, with A/C)
>
> Hi, I'm wiring a 1977 K5 Blazer and building the harness in CAD first. Your stamped firewall #154908 is the
> part I'd model. Would OER share the 3D data (STEP or STL) for it, or a dimensioned drawing? It's for my own
> build's wiring layout, and I'm happy to sign an NDA and not redistribute it. If you can't share the file, the
> panel's overall size and the position and size of the fuse-block opening would still help.
> Thanks, Skylar Williams, NUKE LTD, [phone / email]

## 5. OPEN

- No price for ranks 1, 2, 5 or 6 until the quotes come back.
- Whether option 3's reproduction firewall matches the factory stamping. If OER sends data, compare it to a
  scan of this truck before relying on it.
- The removable top has no published dimensions (tape list T-15, asked by the top-design lane).
