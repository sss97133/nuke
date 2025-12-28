# Vehicle Ingestion Errors - Documentation

## Critical Errors Found in Recent Listings

### 1. MODEL FIELD CONTAINS EXTRA TEXT
**Issue**: Model field includes pricing, dealer info, financing text, and other metadata instead of just the model name.

**Examples**:
- `"Prelude classic - $29,995 (1990HondaPrelude)"` → Should be: `"Prelude"`
- `"4Runner SR5 4x4 - $14,995 (BUY HERE PAY HERE & CREDIT UNION FINANCE CALL 928-750-2502)"` → Should be: `"4Runner SR5 4x4"`
- `"Expedition MAX Limited SKU:JR1004 SUV - $36,980 (Henderson, NV)"` → Should be: `"Expedition MAX Limited"`
- `"1500 4WD Crew Cab 140.5\" Big Horn (Get Financed Now!)"` → Should be: `"1500 4WD Crew Cab 140.5\" Big Horn"`
- `"1500 Classic 4x4 4WD Truck Dodge SLT Crew Cab 5.5 ft. SB Pick (Gage Auto Sales)"` → Should be: `"1500 Classic SLT Crew Cab"`

**Root Cause**: Title parsing is extracting the entire title string instead of cleaning it.

**Fix Required**: 
- Remove pricing patterns: `- $X,XXX`, `$X,XXX`, `(Est. payment OAC†)`
- Remove dealer info: `(Dealer Name)`, `(Location)`, `(Call XXX)`
- Remove financing text: `(BUY HERE PAY HERE...)`, `(Get Financed Now!)`
- Remove SKU/stock numbers: `SKU:XXX`, `Stock #:XXX`
- Remove platform text: `on BaT Auctions - ending...`, `| Bring a Trailer`

---

### 2. MISSING PRICES
**Issue**: Many vehicles have `asking_price: null` when prices are clearly visible in titles/descriptions.

**Examples**:
- `"1500 4WD Crew Cab 140.5\" Big Horn (Get Financed Now!)"` - Price in description: `$12,995`
- `"1500 Classic 4x4 4WD Truck Dodge SLT Crew Cab 5.5 ft. SB Pick"` - Price likely in description
- `"F150 SUPERCREW - $0.00"` - Should extract from title

**Root Cause**: Price extraction regex not matching all formats, or extraction happening before title cleaning.

**Fix Required**:
- Extract prices from titles: `$X,XXX`, `$X,XXX.XX`, `$X,XXX.00`
- Extract from descriptions: Look for "Price:", "Asking:", "$X,XXX"
- Handle edge cases: `$0.00` (likely means "call for price"), `$270` (monthly payment, not vehicle price)

---

### 3. BaT PARSING ERRORS
**Issue**: Bring a Trailer listings have incorrect make/model extraction.

**Examples**:
- Make: `"10k-mile"` → Should extract actual make from URL/title
- Make: `"18k-mile"` → Should extract actual make from URL/title  
- Make: `"20-years-owned"` → Should extract actual make from URL/title
- Model: `"on BaT Auctions - ending December 12 (Lot #223,173) | Bring a Trailer"` → Should extract actual model

**Root Cause**: BaT title parsing is extracting mileage/ownership descriptors as make, and including BaT platform text in model.

**Fix Required**:
- Parse from URL first (most reliable): `/listing/YEAR-MAKE-MODEL-ID/`
- Clean title: Remove mileage descriptors (`10k-mile`, `18k-mile`, `47k-mile`)
- Remove ownership descriptors (`20-years-owned`)
- Remove BaT platform text from model field
- Use known makes list to validate extracted make

---

### 4. INVALID MAKE VALUES
**Issue**: Make field contains descriptors, adjectives, or other non-make text.

**Examples**:
- `"Used"` → Should extract actual make
- `"Restored"` → Should extract actual make
- `"Beautiful"` → Should extract actual make
- `"Collector's"` → Should extract actual make
- `"Silver"` → Should extract actual make (this is a color, not make)

**Root Cause**: Title parsing is not validating against known makes list, or extracting wrong word from title.

**Fix Required**:
- Validate make against known makes list
- Reject descriptors: "Used", "Restored", "Beautiful", "Collector's", "Classic", "Featured"
- Reject colors: "Silver", "Black", "White", "Red", etc.
- Reject adjectives: "Clean", "Mint", "Excellent", etc.

---

### 5. PRICE PARSING ERRORS
**Issue**: Extracting monthly payment amounts instead of vehicle prices.

**Examples**:
- `$270` (Est. payment OAC†) → This is monthly payment, not vehicle price
- `$305` (Est. payment OAC†) → This is monthly payment, not vehicle price
- `$407` (Est. payment OAC†) → This is monthly payment, not vehicle price

**Root Cause**: Price extraction is not checking context (monthly payment vs. vehicle price).

**Fix Required**:
- Check for payment indicators: "Est. payment", "Monthly payment", "OAC†"
- Prefer larger prices (vehicle prices are typically $5,000+)
- Extract from structured fields first (Price:, Asking:)
- Ignore prices < $1,000 unless explicitly marked as vehicle price

---

### 6. CRAIGSLIST TITLE PARSING
**Issue**: Craigslist titles often have format: `"YEAR MAKE MODEL - $PRICE (Dealer Info)"`

**Examples**:
- `"1990 Honda Prelude classic -- $29,995"` → Model should be `"Prelude"` not `"Prelude classic"`
- `"2013 Toyota 4Runner SR5 4x4 – Rugged, Reliable"` → Model should be `"4Runner SR5 4x4"`

**Root Cause**: Not properly splitting title into components, or including trim/descriptors in model.

**Fix Required**:
- Parse pattern: `YEAR MAKE MODEL [TRIM] - $PRICE [DEALER INFO]`
- Remove common descriptors: "classic", "vintage", "restored", "clean"
- Extract trim separately if possible
- Clean model: Remove pricing, dealer info, financing text

---

## Priority Fixes

1. **HIGH**: Fix model field cleaning (remove pricing, dealer info, financing text)
2. **HIGH**: Fix BaT parsing (use URL parsing, remove platform text)
3. **MEDIUM**: Fix price extraction (handle monthly payments, extract from descriptions)
4. **MEDIUM**: Add make validation (reject descriptors, colors, adjectives)
5. **LOW**: Improve Craigslist title parsing (better trim extraction)

---

## Files to Update

1. `supabase/functions/process-import-queue/index.ts` - Main ingestion function
2. `supabase/functions/extract-vehicle-data-ai/index.ts` - AI extraction function
3. `supabase/functions/simple-scraper/index.ts` - Basic scraping function
4. `supabase/functions/ai-proofread-pending/index.ts` - AI proofreading function

