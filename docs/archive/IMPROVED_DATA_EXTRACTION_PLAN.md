# Improved Data Extraction Plan - Normalized & Accurate

## Current Problem

**Example Vehicle:** https://n-zero.dev/vehicle/22f9cce1-0c58-4177-b504-27aad1b0bd61

**Current (WRONG) Data:**
- Model: "shortbed truck**"
- Make: "Chevy"
- Missing: Series (C10), Trim (Cheyenne Super), Bed Length (SWB), Engine Status ("no motor")

**Should Be:**
- Make: "Chevrolet" (normalized)
- Model: "C/K" (normalized)
- Series: "C10"
- Trim: "Cheyenne Super"
- Bed Length: "SWB" (Short Wheelbase)
- Engine Status: "No Motor" or `engine_size: null` with annotation
- Confidence: High/Medium/Low rating
- Source Annotation: "Extracted from Craigslist listing [URL]"

---

## Missing Data Fields

### 1. **Bed Length** (SWB/LWB)
- **Source:** Listing text ("shortbed", "longbed", "SWB", "LWB")
- **DB Field:** `bed_length` (TEXT) or `bed_length_inches` (NUMERIC)
- **Values:** "SWB", "LWB", "Short", "Long", or inches (e.g., 6.5, 8)

### 2. **Engine Status**
- **Source:** Listing text ("no motor", "no engine", "missing engine", "engine removed")
- **DB Field:** `engine_size` (TEXT) or `notes` (TEXT) with annotation
- **Values:** "No Motor", "Missing Engine", or actual engine size if present

### 3. **Series** (C10, K10, C20, etc.)
- **Source:** Title/description ("C10", "K10", "K5", etc.)
- **DB Field:** `series` (TEXT)
- **Extraction:** Use `VehicleDataExtractionService.extractVehicleFields()`

### 4. **Trim** (Cheyenne, Silverado, etc.)
- **Source:** Title/description ("Cheyenne Super", "Silverado", "Scottsdale")
- **DB Field:** `trim` (TEXT)
- **Extraction:** Use `VehicleDataExtractionService.extractVehicleFields()`

### 5. **Confidence Rating**
- **Source:** Extraction quality assessment
- **DB Field:** `extraction_confidence` (INTEGER 0-100) or `origin_metadata.extraction_confidence`
- **Values:** 0-100 (0=low, 50=medium, 80+=high)

### 6. **Source Annotation**
- **Source:** Listing URL and extraction method
- **DB Field:** `origin_metadata.extraction_method`, `origin_metadata.source_url`
- **Values:** "ai_extraction", "pattern_match", "manual_review"

---

## Database Schema Locations

### Primary Table: `vehicles`
```sql
-- Core fields
year INTEGER
make TEXT                    -- Normalized: "Chevrolet" not "Chevy"
model TEXT                   -- Normalized: "C/K" not "pickup"
series TEXT                  -- "C10", "K10", "K5"
trim TEXT                    -- "Cheyenne Super", "Silverado"

-- Specifications
bed_length TEXT              -- "SWB", "LWB", "Short", "Long"
engine_size TEXT             -- "5.7L V8" or "No Motor" or NULL
transmission TEXT
drivetrain TEXT

-- Metadata
origin_metadata JSONB        -- {
                              --   "extraction_confidence": 85,
                              --   "extraction_method": "ai_extraction",
                              --   "source_url": "https://...",
                              --   "bed_length_source": "listing_text",
                              --   "engine_status": "no_motor",
                              --   "extracted_fields": ["series", "trim", "bed_length"]
                              -- }
notes TEXT                   -- Free-form notes including "no motor" if applicable
```

### Supporting Tables:
- `oem_vehicle_specs.bed_length_inches` - Factory specs
- `vehicle_spid_data.bed_length` - From SPID sheet if available

---

## Solution: AI-Powered Extraction with Normalization

### Step 1: Use `extract-vehicle-data-ai` Edge Function

**File:** `supabase/functions/extract-vehicle-data-ai/index.ts`

**Enhanced Prompt:**
```typescript
const prompt = `
Extract vehicle data from this Craigslist listing with maximum accuracy.

CRITICAL REQUIREMENTS:
1. Normalize make: "Chevy" → "Chevrolet", "GMC" → "GMC"
2. Extract series: Look for C10, K10, C20, K20, K5, C5, etc.
3. Extract trim: Look for Cheyenne, Silverado, Scottsdale, Custom Deluxe, etc.
4. Detect bed length: "shortbed", "SWB", "short bed" → "SWB"; "longbed", "LWB", "long bed" → "LWB"
5. Detect engine status: "no motor", "no engine", "missing engine" → "No Motor"
6. Assign confidence: 0-100 based on data clarity

Return JSON:
{
  "year": 1974,
  "make": "Chevrolet",
  "model": "C/K",
  "series": "C10",
  "trim": "Cheyenne Super",
  "bed_length": "SWB",
  "engine_size": null,
  "engine_status": "No Motor",
  "transmission": "...",
  "drivetrain": "...",
  "confidence": 85,
  "extracted_fields": ["series", "trim", "bed_length", "engine_status"],
  "source_annotations": {
    "bed_length_source": "listing_text",
    "engine_status_source": "listing_text",
    "trim_source": "title"
  }
}
`
```

### Step 2: Integrate into Scraper

**File:** `supabase/functions/scrape-all-craigslist-squarebodies/index.ts`

**Changes:**
1. Call `extract-vehicle-data-ai` for each listing (instead of basic regex)
2. Use `VehicleDataExtractionService` for normalization
3. Store confidence and source annotations in `origin_metadata`
4. Only insert if confidence > 50 (or flag low-confidence for review)

---

## Implementation Code

### Updated Scraper Logic

```typescript
// In scrape-all-craigslist-squarebodies/index.ts

// After scraping HTML, call AI extraction
const aiExtractionResponse = await supabase.functions.invoke('extract-vehicle-data-ai', {
  body: {
    url: listingUrl,
    html: htmlContent,
    textContent: textContent,
    source: 'craigslist'
  }
})

if (aiExtractionResponse.data?.success) {
  const extracted = aiExtractionResponse.data.data
  
  // Use VehicleDataExtractionService for normalization
  const normalized = VehicleDataExtractionService.extractVehicleFields(
    extracted.make,
    extracted.model,
    extracted.listing_title || data.title,
    extracted.description,
    extracted.year
  )
  
  // Build vehicle insert with all fields
  const vehicleInsert = {
    year: extracted.year,
    make: normalized.make, // Normalized
    model: normalized.model, // Normalized
    series: normalized.series || extracted.series,
    trim: normalized.trim || extracted.trim,
    bed_length: extracted.bed_length, // SWB/LWB
    engine_size: extracted.engine_status === 'No Motor' ? null : extracted.engine_size,
    transmission: extracted.transmission,
    drivetrain: extracted.drivetrain,
    notes: extracted.engine_status === 'No Motor' 
      ? 'No motor - engine removed or missing' 
      : extracted.description,
    origin_metadata: {
      extraction_confidence: extracted.confidence || 50,
      extraction_method: 'ai_extraction',
      source_url: listingUrl,
      bed_length_source: extracted.source_annotations?.bed_length_source,
      engine_status: extracted.engine_status,
      extracted_fields: extracted.extracted_fields || [],
      extraction_timestamp: new Date().toISOString()
    }
  }
  
  // Only insert if confidence is acceptable
  if (extracted.confidence >= 50) {
    // Insert vehicle...
  } else {
    // Flag for manual review or skip
    console.warn(`Low confidence (${extracted.confidence}) - skipping or flagging for review`)
  }
}
```

---

## Scaling Tool

### Edge Function: `normalize-existing-vehicles`

**Purpose:** Backfill normalization for existing vehicles

**File:** `supabase/functions/normalize-existing-vehicles/index.ts`

```typescript
serve(async (req) => {
  const { vehicle_id, force_reprocess } = await req.json()
  
  // Get vehicle with discovery_url
  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('id, year, make, model, discovery_url, origin_metadata')
    .eq('id', vehicle_id)
    .single()
  
  if (!vehicle.discovery_url) {
    return new Response(JSON.stringify({ error: 'No discovery URL' }), { status: 400 })
  }
  
  // Fetch listing HTML
  const listingResponse = await fetch(vehicle.discovery_url)
  const html = await listingResponse.text()
  
  // Call AI extraction
  const aiResponse = await supabase.functions.invoke('extract-vehicle-data-ai', {
    body: { url: vehicle.discovery_url, html, source: 'craigslist' }
  })
  
  // Normalize and update
  const extracted = aiResponse.data.data
  const normalized = VehicleDataExtractionService.extractVehicleFields(...)
  
  // Update vehicle with normalized data
  await supabase
    .from('vehicles')
    .update({
      make: normalized.make,
      model: normalized.model,
      series: normalized.series || extracted.series,
      trim: normalized.trim || extracted.trim,
      bed_length: extracted.bed_length,
      engine_size: extracted.engine_status === 'No Motor' ? null : extracted.engine_size,
      origin_metadata: {
        ...vehicle.origin_metadata,
        extraction_confidence: extracted.confidence,
        extraction_method: 'ai_extraction',
        normalized_at: new Date().toISOString()
      }
    })
    .eq('id', vehicle_id)
  
  return new Response(JSON.stringify({ success: true, normalized }))
})
```

### Batch Processing Script

**File:** `scripts/normalize-all-craigslist-vehicles.js`

```javascript
// Process all Craigslist vehicles in batches
const vehicles = await supabase
  .from('vehicles')
  .select('id')
  .eq('discovery_source', 'craigslist_scrape')
  .limit(100)

for (const vehicle of vehicles) {
  await supabase.functions.invoke('normalize-existing-vehicles', {
    body: { vehicle_id: vehicle.id }
  })
  await sleep(1000) // Rate limiting
}
```

---

## Summary

**What Was Missing:**
1. ✅ Bed Length (SWB/LWB) - Now extracted
2. ✅ Engine Status ("no motor") - Now detected
3. ✅ Series (C10, K10) - Now extracted via AI + normalization
4. ✅ Trim (Cheyenne Super) - Now extracted via AI + normalization
5. ✅ Confidence Rating - Now included (0-100)
6. ✅ Source Annotation - Now in `origin_metadata`

**Where Data Goes:**
- `vehicles.make` - Normalized make
- `vehicles.model` - Normalized model
- `vehicles.series` - Extracted series (C10, K10, etc.)
- `vehicles.trim` - Extracted trim (Cheyenne, Silverado, etc.)
- `vehicles.bed_length` - SWB/LWB
- `vehicles.engine_size` - Engine or null if "no motor"
- `vehicles.origin_metadata` - Confidence, method, source annotations

**Scaling Tool:**
- Edge function: `normalize-existing-vehicles` (process individual vehicles)
- Batch script: `normalize-all-craigslist-vehicles.js` (process all)

