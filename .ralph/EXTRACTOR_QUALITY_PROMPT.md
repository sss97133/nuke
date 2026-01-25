# Ralph Wiggum - Extractor Quality Agent

## MISSION
Build extractors that match BaT quality. Never run incomplete extractors at scale.

## THE GOLD STANDARD: bat-simple-extract

After studying `supabase/functions/bat-simple-extract/index.ts`, here's what "complete extraction" means:

### Core Fields (REQUIRED)
```typescript
{
  title: string;          // Parsed from H1, cleaned
  year: number;           // From title
  make: string;           // From title
  model: string;          // From title
  vin: string | null;     // 17-char modern OR chassis for pre-1981
  location: string;       // Where the vehicle is
}
```

### Specs (SHOULD HAVE)
```typescript
{
  mileage: number | null;         // From description text
  exterior_color: string | null;  // "finished in X"
  interior_color: string | null;  // "X leather interior"
  transmission: string | null;    // "4-Speed Manual", "PDK"
  drivetrain: string | null;      // RWD, AWD, 4WD, FWD
  engine: string | null;          // "3.8L flat-six"
  body_style: string | null;      // Coupe, Sedan, Convertible
}
```

### Auction/Listing Data (REQUIRED FOR AUCTIONS)
```typescript
{
  seller_username: string | null;
  buyer_username: string | null;   // If sold
  sale_price: number | null;       // Final sale
  high_bid: number | null;         // Current/ending bid
  bid_count: number;
  comment_count: number;
  view_count: number;
  lot_number: string | null;
  reserve_status: 'no_reserve' | 'reserve_met' | 'reserve_not_met';
  auction_end_date: string;
}
```

### Rich Data (DIFFERENTIATORS)
```typescript
{
  description: string;     // Full listing text
  image_urls: string[];    // ALL gallery images (15-30 typical)
  comments: Comment[];     // Bids, questions, seller responses
}
```

### Database Integration (CRITICAL)
1. **vehicles** table - Core record
2. **vehicle_images** table - ALL images, not just primary
3. **external_listings** table - Platform-specific metadata
4. **timeline_events** table - Listed, Sold events
5. **organization_vehicles** table - Link to auction house org

---

## QUALITY CHECKLIST FOR NEW EXTRACTORS

Before running ANY extractor at scale, verify:

### Level 1: Basic Extraction
- [ ] Can fetch pages (handle rate limits, Cloudflare)
- [ ] Extracts title correctly
- [ ] Parses year/make/model from title
- [ ] Gets at least one image

### Level 2: Core Data
- [ ] VIN extraction (if available on source)
- [ ] Price extraction (asking OR sale)
- [ ] Mileage extraction
- [ ] Location extraction

### Level 3: Rich Data
- [ ] Full description text
- [ ] ALL gallery images (not just hero)
- [ ] Seller info (if available)
- [ ] Any specs: color, transmission, engine

### Level 4: Database Integration
- [ ] Saves to vehicles correctly
- [ ] Saves ALL images to vehicle_images
- [ ] Creates external_listings record (for trackable sources)
- [ ] No duplicate records created

### Level 5: Validation
- [ ] Sample 5 URLs manually - compare extraction vs source
- [ ] Image count matches source gallery
- [ ] Prices parse correctly (no $1 bugs, no missing commas)
- [ ] VINs validate (17 chars, correct checksum)

---

## WORKFLOW

### Phase 1: Understand the Source
Before writing ANY code:
1. Visit 5 listings manually
2. Document what data is available
3. Note: Is VIN shown? Where? How many images? Specs format?
4. Identify: Lazy loading? JavaScript required? API available?

### Phase 2: Build Extraction Logic
1. Start with title parsing (year/make/model)
2. Add price extraction
3. Add image extraction (get ALL)
4. Add VIN extraction (if available)
5. Add specs one by one

### Phase 3: Test Thoroughly
1. Test on 5 diverse vehicles (different makes, price ranges)
2. Compare extracted data vs manual inspection
3. Calculate field coverage: what % have VIN? Mileage? Etc.
4. Only proceed if >80% match on available fields

### Phase 4: Database Integration
1. Map extracted fields to vehicles schema
2. Save images to vehicle_images (ALL of them)
3. Test: query DB after extraction, verify data landed

### Phase 5: Scale Carefully
1. Run batch of 20
2. Sample 3 random results, validate manually
3. If good, increase to 100
4. Continue monitoring with periodic samples

---

## CLOUDFLARE HANDLING

Current safe approach: **Playwright**

```javascript
// Playwright bypass pattern (works for most sites)
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
});
const page = await context.newPage();
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(3000);  // Let JS render
```

If Playwright fails, investigate:
1. Does the site require login?
2. Is there aggressive bot detection?
3. Can we use Firecrawl (budget permitting)?
4. Is there a public API we missed?

---

## BACKFILL TRACKING

When extraction is incomplete, track what's missing:

```sql
-- Find vehicles missing images
SELECT id, discovery_source, created_at
FROM vehicles v
WHERE NOT EXISTS (SELECT 1 FROM vehicle_images WHERE vehicle_id = v.id)
  AND v.status = 'active';

-- Find vehicles missing VIN (where VIN should exist)
SELECT id, discovery_source, year, make
FROM vehicles
WHERE vin IS NULL
  AND year >= 1981  -- VINs mandatory after 1981
  AND status = 'active';

-- Find vehicles missing price
SELECT id, discovery_source
FROM vehicles
WHERE sale_price IS NULL AND asking_price IS NULL AND high_bid IS NULL
  AND status = 'active';
```

---

## OUTPUT FORMAT

When reporting extraction quality:

```
---QUALITY_REPORT---
SOURCE: [site name]
SAMPLE_SIZE: [N]

FIELD COVERAGE:
  title: 100%
  year: 100%
  make: 95%
  model: 95%
  vin: 72% (pre-1981 vehicles don't have modern VINs)
  price: 100%
  mileage: 88%
  images_avg: 18.3 per vehicle

VS BAT BASELINE:
  Core fields: 95% match
  Specs: 78% match
  Images: 92% match

VERDICT: [READY | NEEDS WORK | BLOCKED]
ISSUES: [list any problems]
---END_QUALITY_REPORT---
```

---

## RULES

1. **Never run incomplete extractors at scale** - Creates backfill debt
2. **Images are non-negotiable** - A vehicle without images is useless
3. **Test before trust** - Always sample and validate
4. **Playwright first** - Safer than direct fetch for CF sites
5. **Track what's missing** - Know your backfill needs
6. **BaT is the benchmark** - Compare everything to it
