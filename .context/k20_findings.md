# 1973 K20 Photo Sweep Findings

**Vehicle ID:** `ef844607-46fc-40a5-a27b-ad245ffe5ef5`
**VIN:** CKY243Z178481
**DB description:** 1973 Chevrolet K20, 3/4-ton 4WD pickup
**Photos reviewed:** 52
**Real K20 photos:** 42
**Wrong-attribution photos:** 10

## Headline finding: body style mismatch

**The vehicle in 42 of the 52 photos is a Suburban (4-door, long roof, no separate bed), not a pickup.**

The "K20" chassis designation can apply to either a pickup OR a Suburban in 1973-74 Chevrolet nomenclature (it's the 3/4-ton 4WD designation, agnostic to body style). The DB summary says "3/4-ton 4WD pickup" which is at least partially wrong — body style should be **Suburban**.

Evidence from photos 026, 048, 052 (clean side profiles in daylight):
- 4-door body (front door + rear door visible on each side)
- Roof extends uninterrupted from front clip to rear cargo doors
- 3 glass panes on each side (front door, rear door, fixed quarter)
- Rear cargo doors instead of a tailgate
- "Cheyenne" trim badge on front fender
- "350" badge in grille (350ci small block)

This is consistent with a **1973-74 Chevrolet K20 Suburban** with the Cheyenne trim package.

## Vehicle identity (confirmed)

- **Body:** Chevrolet Suburban (1973-74 front clip — single round headlights, dual horizontal chrome grille bars)
- **Trim:** Cheyenne (per fender badge)
- **Engine:** 350ci (per grille badge)
- **Drivetrain:** 4WD (visible solid front axle, lifted stance, all-terrain tires)
- **Plates spotted:**
  - **NV plate `870-UJ`** (rear plate on multiple photos)
  - **AZ-style plate `87U8UE`** (front plate on photos 000, 048) — vehicle has been registered in both AZ and NV
- **Paint:** Originally dark burgundy/maroon, severely oxidized to faded pink on horizontal surfaces (roof, hood, upper body); lower body still shows darker original burgundy
- **Condition:** Rolling but disassembled (rear axle/wheel off in multiple photos), bumpers intact, glass intact, body straight, no visible major collision damage
- **Visible wear:** Heavy oxidation, missing/temp wheels, jackstands

## Work-event timeline (from manifest dates)

### 2025-11-01 (early supabase uploads, photos 000-012)
- **Acquisition/sighting in commercial parking lot** next to "AIR CONDITIONING" shop. AZ plate on front. Rear axle/wheel pulled, jackstands deployed, spare on ground. Mountain backdrop suggests Las Vegas / North Las Vegas / Henderson area.
- **Loaded onto U-Haul auto-transport trailer** (tandem axle, trailer plate `AT 7056M`)
- Towed behind a **white late-90s GMT400 Chevrolet Suburban tow rig**
- **Transit through Mesquite NV** (street signs "Mesquite Blvd" + "Riverside" visible at intersection — gas-station stop) — Mesquite is the AZ/NV border crossing point
- **Arrived at destination shop** with commercial bay door `882`, white commercial building with maroon stripe — Skylar in frame
- **Skylar appears as the destination handler** (photos 011, 032, 040)

### 2026-03-20 (iphoto batch, photos 013-032)
- **Mostly RE-PHOTOGRAPHS of the same Nov 2025 transport event** (same trailer, same locations, same vehicle position). These look like iphoto photos that may have been re-imported later, or a second arrival event using the same trailer.
- **Plus 4 photos of a different gold pickup** (013, 014, 016, 017) and 1 ranch property scene (015, 018) — these were misattributed.

### 2026-04-11 (ssd-blast batch, photos 033-052)
- **Mix of: K20 Suburban transport photos (a second copy / different render of same scenes)** + **ranch property scenes featuring OTHER vehicles** (037, 038) + **the gold pickup again** (033, 034, 035) + **a yard scene with jumper cables on an unrelated late-70s squarebody** (036)
- The "ssd-blast" path naming suggests these were extracted from a hard drive backup of older photos.

## Vendors / receipts / part numbers

**None visible.** No receipts, no invoices, no work orders, no part numbers in any photo. The only commercial branding is:
- **U-Haul** (auto-transport trailer used for the move)
- **"AIR CONDITIONING ... FIXED FAST"** (HVAC shop in the background — not vehicle-related)
- **"Banks"** sticker on the white Suburban tow rig (Banks Power performance brand — on the tow rig, not the K20)

No NAPA, no O'Reilly, no LMC, no Classic Industries, no Holley, no parts/build evidence. This is **all transport and condition documentation** — no restoration receipts.

## Wrong-attribution photos (10 of 52) — fork to ghost vehicles

| # | Filename | What's actually in frame |
|---|---|---|
| 013 | IMG_3585 | Gold/cream two-tone squarebody **pickup** (single cab + bed), Cheyenne/Super Cheyenne badge |
| 014 | IMG_3584 | Same gold pickup, side view with door open |
| 015 | IMG_3429 | Red dump truck + white tow rig at ranch property — no K20 |
| 016 | IMG_3583 | Night yard scene with late-70s squarebody (hood up, jumpers) + gold pickup midground — no K20 |
| 017 | IMG_3586 | Gold pickup with amber roof clearance lights + blue squarebody alongside — no K20 |
| 018 | IMG_3428 | Red dump truck + trailer at ranch — no K20 |
| 033 | (hash) | Same gold pickup as 013, night transport shot |
| 034 | (hash) | Same gold pickup as 017, with amber roof lights |
| 035 | (hash) | Same gold pickup as 014, door open showing beige interior |
| 036 | (hash) | Yard scene with 1979-80 C/K (single round headlights) and gold pickup background — no K20 |
| 037 | (hash) | Ranch property: red+white squarebody pickup with hood up + brown+white flatbed dually — no K20 |
| 038 | (hash) | Same ranch property scene — no K20 |

Counting: 10 photos are wrong-attrib for the K20 (some have OTHER vehicles in frame instead).

### The "gold pickup" deserves its own vehicle record
Photos 013, 014, 017, 033, 034, 035 (6 photos) show the same gold/cream two-tone squarebody pickup. It has:
- Single cab + separate bed (longbed based on proportions)
- Gold body with white lower body insert (1973-77 two-tone style)
- "Cheyenne" or "Super Cheyenne" fender badge
- Custom amber roof clearance/cab lights (set of 5 across the cab roof)
- Lifted, all-terrain tires, 4WD
- On a different trailer (silver/orange "SpeedLoader" branding, not U-Haul)

This is a **separate Chevrolet squarebody pickup** that Skylar (or someone) was moving on a different day with a different trailer. Should be forked to its own vehicle record per `wrong_attribution_forks_not_hides` rule.

### The "ranch property" scenes (015, 018, 037, 038)
These show what appears to be Skylar's (or seller's) rural property in mountain country (snow-capped peaks in background — could be Colorado, Utah, or northern NV/eastern CA). Other vehicles visible: red dump truck, red+white squarebody pickup, brown+white flatbed dually, late-70s C/K. These are PROPERTY/INVENTORY photos, not K20 photos.

## Locations identified

1. **Origin / commercial parking lot** — AZ plate on vehicle, mountain backdrop, "AIR CONDITIONING" shop — likely AZ or NV
2. **Mesquite NV** (Mesquite Blvd & Riverside intersection) — gas station fuel stop during transport
3. **Destination shop** — commercial bay '882', white building with maroon stripe — likely Skylar's shop or contractor's shop in Las Vegas area
4. **Classic car lot at night** — red Mopar B-body + red roadster in background — could be storage lot or detail shop
5. **Ranch/storage property** — mountain backdrop, metal carport, gravel — NOT in AZ desert; mountains suggest CO/UT/NV high country (does NOT belong to this vehicle)

## Recommendations for DB

1. **Update `body_style`** (or equivalent field) from "pickup" to "Suburban" — visual evidence is unambiguous
2. **Add aliases**:
   - NV plate `870-UJ`
   - AZ-style plate `87U8UE`
3. **Add vendor observation**: U-Haul auto-transport trailer (plate `AT 7056M`) used for transport ~Nov 2025
4. **Add transport event** dated ~2025-10/11: transported via U-Haul trailer from AZ (or northern NV) through Mesquite NV to Skylar's shop in Las Vegas area
5. **Fork 10 photos** to ghost vehicles per `wrong_attribution_forks_not_hides`:
   - 6 photos (013, 014, 017, 033, 034, 035) → new ghost vehicle "Gold two-tone Chevrolet squarebody pickup (Cheyenne, ~1973-77)"
   - 4 photos (015, 016, 018, 036, 037, 038) → property/scene context (not vehicle-attributable, or attributable to other vehicles Skylar may own)
6. **Add condition observation**: paint heavily oxidized, body straight, glass intact, $400 acquisition cost consistent with the visible state

## What's NOT visible (gaps)

- No VIN plate photographed
- No interior shots
- No engine bay (hood always closed or only partially open)
- No undercarriage / frame
- No build sheet / tag / cowl
- No receipts or paperwork
- No "before" photos at seller location (only post-acquisition transport)
- No mileage indicator (no odometer shot)
- No interior condition documentation
