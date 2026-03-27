# Image Ownership Ontology

## The Problem

The current system assigns `vehicle_images.vehicle_id` at upload time based on the upload context (which vehicle profile the user was on). This conflates four independent relationships:

| Relationship | Question | Example |
|---|---|---|
| **Storage** | Where is the file? | `vehicle-photos/{uuid}/user_upload/IMG_9035.jpg` |
| **Attribution** | Who captured this? | Skylar's iPhone 15 Pro, Feb 14 2025 |
| **Subject** | What vehicle(s) are depicted? | 1983 GMC K2500 — or maybe the Blazer in the background |
| **Provenance** | Whose evidence is this? | Owner-captured build documentation |

When a user's photo library is bulk-imported, ALL photos go to a single vehicle_id. But a photo library contains:
- Photos of multiple vehicles
- Photos of tools and equipment (not vehicle-specific)
- Receipts and documents (may span multiple vehicles)
- Reference photos from other sources (BaT screenshots, forum posts)
- Photos of people, locations, events (not vehicle evidence at all)

Result: 11,138 images on K2500 with every metadata field null because assignment was assumed, not earned.

## The Correct Model

### Principle: Photos start unassigned. Assignment is earned through evidence.

```
vehicle_id = NULL until proven otherwise
```

### Four Separate Columns (not one)

```sql
-- WHO captured it
attributed_to_user_id UUID    -- user who took the photo (from EXIF device match)
attribution_method TEXT        -- 'exif_device_match', 'upload_claim', 'forwarded', 'scraped'
attribution_confidence NUMERIC -- 0-1

-- WHAT vehicle(s) are depicted
-- (this is the current vehicle_id, but now nullable and earned)
subject_vehicle_id UUID        -- primary vehicle depicted (nullable until classified)
subject_confidence NUMERIC     -- 0-1 how sure we are this is the right vehicle
subject_method TEXT             -- 'visual_match', 'exif_location', 'user_confirmed', 'upload_context'

-- Additional subjects (multi-vehicle photos)
-- Use a junction table: image_vehicle_subjects(image_id, vehicle_id, confidence, is_primary)

-- WHERE did the image come from
image_origin TEXT              -- 'user_library', 'listing_scrape', 'direct_upload', 'forwarded', 'screenshot'
original_owner TEXT            -- 'user', 'platform', 'third_party', 'unknown'
```

### Intake Pipeline

#### Phase 1: EXIF Processing (immediate, before any vehicle assignment)

Every photo gets EXIF extracted on ingest:
- **Device fingerprint** → match against user's known devices
- **Timestamp** → places photo on timeline (critical for build documentation)
- **GPS coordinates** → places photo in space (shop location, dealer lot, event)
- **Software/editing history** → detects screenshots vs original captures

If device matches user's known device → `attributed_to_user_id = user`, `attribution_method = 'exif_device_match'`

If no EXIF or unknown device → `attribution_method = 'unknown'`, flag for review

#### Phase 2: Visual Classification (what IS this photo?)

Before asking "which vehicle?", ask "what kind of thing?":

| Classification | Action |
|---|---|
| **Vehicle exterior** | Attempt visual match against user's fleet |
| **Vehicle interior** | Match by interior style/color to known vehicles |
| **Engine/mechanical** | Match by engine type, compare to known specs |
| **Document (receipt, title, invoice)** | OCR → extract structured data → link to vehicle(s) by content |
| **Part closeup** | Part number OCR → catalog lookup → link to vehicle by fitment |
| **Tool/workspace** | Tag as shop context, don't assign to vehicle |
| **Person** | Tag as actor, don't assign to vehicle |
| **Landscape/location** | Tag as location context |
| **Screenshot** | Detect source platform, mark as `original_owner = 'platform'` |
| **Multi-vehicle** | Create soft assignments to each detected vehicle |

#### Phase 3: Vehicle Assignment (earned, not assumed)

Assignment only happens when evidence supports it:

```
HIGH CONFIDENCE (auto-assign):
- Visual match + EXIF location at user's shop + timestamp matches work record
- User explicitly confirms "this is the K2500"
- Document content references specific VIN or vehicle

MEDIUM CONFIDENCE (suggest, await confirmation):
- Visual match only (right make/model but could be similar vehicle)
- EXIF location match but no visual confirmation
- Part fits multiple vehicles in user's fleet

LOW CONFIDENCE (don't assign):
- No visual match
- Screenshot from external source
- Generic shop/tool photo
```

### Receipt/Document Special Handling

A receipt is not a vehicle photo. It's a **document** that references **parts** that were used on **vehicle(s)**.

```
RECEIPT IMAGE
  └─ OCR extracts:
      ├─ LINE ITEM 1: Borla Muffler #40842 — $489.99
      │   ├─ part_number: 40842
      │   ├─ manufacturer: Borla
      │   ├─ price: $489.99
      │   ├─ catalog_link: rockauto.com/borla/40842
      │   ├─ buy_again_link: autozone.com/search?q=borla+40842
      │   └─ installed_on: [K2500] (from work record linking)
      │       └─ BUT: these Borlas were later moved to the Blazer
      │           └─ THEN: consumed on K2500 build for Granholm
      │
      ├─ LINE ITEM 2: 2.5" SS Tubing — $34.99
      │   ├─ specification: 2.5" 304 stainless steel
      │   ├─ consumed: yes (used in exhaust fab)
      │   └─ reorder_needed: yes (need more for Blazer now)
      │
      ├─ STORE: AutoZone #4521, Hwy 89, Bozeman MT
      │   └─ actor in system (store location)
      │
      ├─ DATE: Feb 12, 2025
      │   └─ places on timeline between Phase 4 and Phase 5
      │
      └─ TOTAL: $524.98
          └─ cross-reference with QuickBooks transaction
```

Every field on the receipt is a node in the graph. The part number links to a catalog. The store links to an actor. The date links to the timeline. The total links to accounting.

### Non-Owner Images

When a user collects images they didn't take (BaT listing photos, forum screenshots, reference images):

```
image_origin = 'listing_scrape' | 'screenshot' | 'forwarded'
original_owner = 'platform' | 'third_party'
attribution_confidence = 0 (we don't know who took it)
```

These images carry different evidential weight:
- Owner-captured photo of undercarriage: HIGH trust condition evidence
- BaT listing photo of same undercarriage: MEDIUM trust (seller-curated)
- Forum screenshot claiming rust: LOW trust (unverified claim)

The `original_owner` field feeds directly into the trust hierarchy:
```
owner_captured (trust: 85) > platform_listing (trust: 70) > forwarded (trust: 50) > screenshot (trust: 40)
```

### Migration Path

For the existing 11,138 K2500 images:

1. **Don't delete vehicle_id assignments** — they're low-confidence hints
2. **Add `subject_confidence = 0.3, subject_method = 'upload_context'`** to all existing rows
3. **Run EXIF extraction** on all 11K images → populate attribution fields
4. **Run visual classification** → identify vehicle/document/tool/etc
5. **Upgrade confidence** where visual + EXIF agree: `subject_confidence = 0.85`
6. **Nullify vehicle_id** where visual says "not this vehicle"
7. **Create multi-vehicle soft assignments** where multiple vehicles detected

### Schema Changes Required

```sql
-- New columns on vehicle_images
ALTER TABLE vehicle_images ADD COLUMN IF NOT EXISTS subject_confidence NUMERIC DEFAULT 0.3;
ALTER TABLE vehicle_images ADD COLUMN IF NOT EXISTS subject_method TEXT DEFAULT 'upload_context';
ALTER TABLE vehicle_images ADD COLUMN IF NOT EXISTS image_origin TEXT DEFAULT 'direct_upload';
ALTER TABLE vehicle_images ADD COLUMN IF NOT EXISTS original_owner TEXT DEFAULT 'user';
ALTER TABLE vehicle_images ADD COLUMN IF NOT EXISTS attribution_method TEXT;
ALTER TABLE vehicle_images ADD COLUMN IF NOT EXISTS attribution_confidence NUMERIC;

-- Junction table for multi-vehicle photos
CREATE TABLE IF NOT EXISTS image_vehicle_subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id UUID REFERENCES vehicle_images(id),
  vehicle_id UUID REFERENCES vehicles(id),
  confidence NUMERIC NOT NULL DEFAULT 0.5,
  is_primary BOOLEAN DEFAULT false,
  method TEXT, -- 'visual_match', 'exif_context', 'user_confirmed', 'content_reference'
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Receipt line items as structured data
CREATE TABLE IF NOT EXISTS document_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id UUID REFERENCES vehicle_images(id),
  line_number INTEGER,
  item_description TEXT,
  part_number TEXT,
  manufacturer TEXT,
  quantity NUMERIC DEFAULT 1,
  unit_price NUMERIC,
  total_price NUMERIC,
  -- Links
  vehicle_id UUID REFERENCES vehicles(id), -- which vehicle this part went on
  catalog_url TEXT,                         -- where to buy it
  work_order_id UUID,                       -- which work order consumed it
  -- State
  consumed BOOLEAN DEFAULT false,
  reorder_needed BOOLEAN DEFAULT false,
  extracted_at TIMESTAMPTZ DEFAULT now(),
  extraction_confidence NUMERIC
);
```

## The Leaf Node Principle

Every click terminates at one of:
1. **An image you can see** (the actual photo)
2. **A document you can read** (the actual receipt, with line items clickable)
3. **A part you can buy** (catalog link, price comparison, reorder)
4. **A listing you can visit** (the actual comp sale, the actual BaT auction)
5. **An actor you can contact** (the shop, the seller, the transporter)

Nothing terminates at text description alone. If we say "aftermarket wheels" — there must be a photo of the wheels, an identification of the wheels, and a link to buy the same wheels. If we can't provide the image or the link, we show what we DO have and mark what's missing.

The tree doesn't have dead ends. It has edges of known knowledge — and those edges are honest about what they don't know.
