# 1973 GMC K5 sweep — observation findings

**Vehicle:** 1973 GMC K5 Jimmy, VIN `TKY183F505217`, vehicle_id `5b4e6bcd-7f31-410a-876a-cb2947d954f5`, owned, $4,000 purchase price, currently registered as red.

**Sample size:** 19 photos uploaded 2025-11-01 between 19:54:27 and 19:55:29 UTC (a ~62-second burst — same upload session).

## Headline finding: at least two trucks in this set

This sweep is NOT all the 1973 K5. There are **two distinct squarebody-era GMC Jimmys** mixed into the same upload session:

| Group | Count | What it is | Telltale |
|---|---|---|---|
| **A — 1973 GMC K5 Jimmy (the target vehicle)** | 5 photos | The actual VIN `TKY183F505217` — matte/dusty black with white removable hardtop | 1973-only chrome egg-crate grille with **round dual headlights**, factory chrome front bumper, GMC front badge, lifted on aluminum 5-spoke wheels with M/T tires |
| **B — Late squarebody Jimmy (NOT the target — different chassis)** | 10 photos | Dark blue with mid-restoration paint stripping, AZ plate **B6A 7WP**, factory roof rack with light bar mount | **Single rectangular headlights** with egg-crate grille → 1981-1987 body style. Cannot be a 1973. Has GMC tailgate plate. Heavy red/orange paint history under blue. |
| **C — Travel/route shots (acquisition trip context)** | 4 photos | Driving views from a modern white SUV during the K5 acquisition trip | Modern dash/wipers; Jerome AZ welcome sign, Cornish Pasty Co. (Jerome), Ghost City Inn (Jerome), Verde Valley overlook, desert interstate |

The B-group is a **wrong-attribution risk**. It needs to be forked off to its own vehicle record per `feedback_wrong_attribution_forks_not_hides.md`. It is most likely a separate truck that shares the same shop with the 1973 K5 — could be a different vehicle in Skylar's collection or a customer/peer's truck. **Don't merge it into the K5 timeline.**

## Group A: 1973 GMC K5 work timeline (5 photos)

1. **014 (`54f5a51b…`)** — Acquisition photo. K5 sits on a dual-axle aluminum equipment trailer in evening light, pine tree behind, dusty/dirty. Complete and original-looking. Black body, white top, chrome bumpers/grille intact. Missing front skid pan.
2. **015 (`5321b80e…`)** — Acquisition selfie. Man in red hat driving white tow SUV with the K5 visible on trailer behind. Desert sky.
3. **013 (`80084de9…`)** — Interstate driving view from tow vehicle's interior; desert mesas. Likely en route.
4. **000 (`7fcdb521…`)** — K5 inside shop bay, lift in background, American flag on wall. Hood and door show primer/spray-pattern from in-progress bodywork. Same complete chrome and 1973 grille.
5. **012 (`a15ce9e4…`)** — **Engine bay shot.** Small-block Chevy V8 (almost certainly the 350 ci era engine), aluminum 4-barrel intake (visually Edelbrock Performer family), 4-barrel carb (visually Edelbrock 1406/1407 family), blue silicone plug wires, chrome air cleaner base, factory-orange hood hinges, dirty firewall, brake booster intact. Engine bay is unrestored/as-acquired — not a fresh build.

**Inferred work stage for the K5:** recently acquired (load + drive home), in shop, **bodywork beginning** (hood/door spray-pattern visible) but engine bay untouched. No fresh paint, no full disassembly.

## Group B: Late blue squarebody Jimmy (10 photos — not the 1973 K5)

This vehicle is in deep paint-stripping/bodywork:
- Whole-body paint strip exposing dark blue → red/orange → white primer → bare metal stratigraphy
- Headlight bezel removed on driver side (empty bucket)
- Rust-through hole at bottom of driver rear quarter
- Top removed in at least one photo
- Cargo area stripped (rear seat out, trim panel loose on bed floor)
- Wheels & lift kit match the 1973 K5 visually (white steel wheels with M/T tires) → shop may be running matching rolling stock or these photos are from the same shop

**License plate B6A 7WP (Arizona)** is the strongest fingerprint — query Nuke DB for any vehicle with this plate; if none, this is a candidate to fork into a new vehicle record per the wrong-attribution-forks rule.

## Group C: Travel/route context (4 photos)

All Jerome, AZ area, evening light, October-ish (Halloween decor on Ghost City Inn). These are the **acquisition trip** photos — Skylar (or whoever) drove out to fetch the K5 and stopped in Jerome on the way. They cluster in time with the K5-on-trailer shots, so the K5 was acquired during this trip.

## No receipts, no part numbers, no vendor names in any photo

Nothing in this sweep contains:
- Receipts or invoices
- VIN tags or door jamb stickers (not photographed)
- Part packaging
- Vendor names other than the visual brand guess of Edelbrock on the carb/intake

## Recommended next actions (not done here)

1. **Fork Group B.** Create a ghost/stub vehicle for the late-blue squarebody and relink those 10 observations there. Look up AZ plate B6A 7WP.
2. **Tag Group C** as `media`/`travel_context` linked to the K5 acquisition trip — provenance for purchase event.
3. **Confirm K5 color in DB.** The DB says "Red" but every photo here shows **black exterior with white top**. Either DB is wrong or the truck was repainted before/after these photos. Worth a substrate correction with an observed-at stamp.
4. **Engine bay is the only mechanical data point.** Worth a separate observation: small-block 350 with Edelbrock-style 4bbl carb on aluminum intake, blue plug wires, factory brake booster. Stage: untouched/as-acquired.
