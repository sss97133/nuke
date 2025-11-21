# Craigslist Listing Data Breakdown

**URL:** https://lasvegas.craigslist.org/cto/d/pahrump-gmc-squarebody-short-bed/7893296003.html

---

## Available Data from Listing

### Structured Attributes (Easy to Extract):
```
condition: fair
cylinders: 8 cylinders
fuel: gas
odometer: 99,999
title status: clean
transmission: manual
drive: 4x4 (inferred from "4X4" in description)
```

### Title:
```
GMC Squarebody short bed - $8,500
```

### Price:
```
$8,500
```

### Description (Rich Data):
```
81 GMC SIERRA K1500
4X4
350 V8
4speed
Runs great
Good interior
Some rust driver side cab corner bellow door hinge and some on bottom of doors. Not Barrett Jackson
Truck was painted a few years back by previous owner.
Not an A/C truck
Low ballers welcome. I am motivated.
Open to possible trades for Wrangler or Harley-Davidson. But cash is King
```

### What Can Be Extracted from Description:
- **Year:** 1981 (from "81 GMC")
- **Make:** GMC
- **Model:** SIERRA K1500 or "Squarebody" (common name)
- **Trim:** K1500 (4x4 1/2-ton)
- **Engine:** 350 V8 (5.7L)
- **Transmission:** 4-speed manual
- **Drivetrain:** 4X4
- **Condition Notes:** 
  - Runs great
  - Good interior
  - Rust on driver cab corner below door hinge
  - Rust on bottom of doors
  - Painted a few years ago
  - No A/C
- **Seller Motivation:** Motivated (willing to negotiate)
- **Trade Interests:** Wrangler or Harley-Davidson

### Images:
```
14 images available
```

---

## Field Mapping for Vehicle Form

### Direct Mapping (from structured attributes):
```typescript
year: 1981
make: "GMC"
model: "Sierra K1500"  // or "Squarebody Short Bed"
trim: "K1500"
engine_size: "350 V8" or "5.7L V8"
displacement: 5.7
cylinders: 8
transmission: "4-Speed Manual"
drivetrain: "4X4" or "4WD"
fuel_type: "gas" or "gasoline"
mileage: 99999  // Note: rolled over, actual unknown
condition: "fair"
title_status: "clean"
asking_price: 8500
color: null  // Not specified
body_style: "pickup" or "short bed"
location: "Pahrump" // From URL
```

### Derived Fields (from description analysis):
```typescript
has_ac: false  // "Not an A/C truck"
paint_condition: "repainted_recently"  // "painted a few years back"
known_issues: [
  "rust_driver_cab_corner",
  "rust_door_bottoms",
  "odometer_rolled_over"
]
seller_notes: "runs great, good interior, motivated seller"
trade_interests: ["Wrangler", "Harley-Davidson"]
```

### Notes Field (Comprehensive Archive):
```
Source: Craigslist
Posted: 2025-11-03
Location: Pahrump, NV
Asking: $8,500

SELLER DESCRIPTION:
81 GMC SIERRA K1500
4X4
350 V8
4speed
Runs great
Good interior
Some rust driver side cab corner bellow door hinge and some on bottom of doors.
Truck was painted a few years back by previous owner.
Not an A/C truck
Low ballers welcome. I am motivated.
Open to possible trades for Wrangler or Harley-Davidson. But cash is King

CONDITION NOTES:
- Odometer rolled over (actual mileage unknown)
- Runs great
- Good interior
- Rust: driver cab corner, door bottoms
- Recently painted
- No A/C

IMAGES: 14 photos
```

---

## Fields Currently Missing from Scraper

### Need to Add:
1. **Trim extraction** (K1500, K20, C10, etc.)
2. **A/C status** (has_ac: boolean)
3. **Known issues** array
4. **Seller motivation** (motivated, firm, no lowballers)
5. **Trade interests**
6. **Paint history** (original, repainted, when)
7. **Post date** (when listing was created)
8. **Last updated** date
9. **Displacement calculation** (350 = 5.7L)

---

## Complete Extraction Goal

**From this listing, populate:**
```
✅ year: 1981
✅ make: GMC
✅ model: Sierra K1500
✅ trim: K1500
✅ engine_size: 5.7L V8
✅ displacement: 5.7
✅ cylinders: 8
✅ transmission: 4-Speed Manual
✅ drivetrain: 4WD
✅ fuel_type: gasoline
✅ mileage: 99999
✅ condition: fair
✅ title_status: clean
✅ asking_price: 8500
✅ body_style: pickup
✅ location: Pahrump
✅ description: [full seller text]
✅ notes: [comprehensive archive]
✅ images: [14 photos]
✅ has_ac: false
✅ known_issues: ["rust_driver_cab", "rust_doors", "odometer_rolled"]
```

**Total:** 20+ fields from one URL!

