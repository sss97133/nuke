# Data Normalization Implementation Summary

## What Was Missing (Example: 1974 Chevy shortbed truck)

### Missing Data:
1. **Bed Length**: "shortbed" → Should be "SWB" in `bed_length` field
2. **Engine Status**: "no motor" → Should be `engine_size: null` with annotation
3. **Series**: Should be "C10" (extracted from context, not in title)
4. **Trim**: Should be "Cheyenne Super" (extracted from description)
5. **Make Normalization**: "Chevy" → Should be "Chevrolet"
6. **Model Normalization**: "shortbed truck" → Should be "C/K" (pickup model)
7. **Confidence Rating**: None - should be 0-100
8. **Source Annotation**: None - should track extraction method

---

## Database Fields for Missing Data

### Primary Table: `vehicles`
```sql
-- Core normalized fields
make TEXT                    -- "Chevrolet" (normalized)
model TEXT                   -- "C/K" (normalized)
series TEXT                  -- "C10" (extracted)
trim TEXT                    -- "Cheyenne Super" (extracted)

-- Specifications
bed_length TEXT              -- "SWB" or "LWB" (extracted)
engine_size TEXT             -- "5.7L V8" or NULL if "no motor"
transmission TEXT
drivetrain TEXT

-- Metadata (JSONB)
origin_metadata JSONB        -- {
                              --   "extraction_confidence": 85,
                              --   "extraction_method": "ai_extraction",
                              --   "source_url": "https://...",
                              --   "bed_length_source": "listing_text",
                              --   "engine_status": "no_motor",
                              --   "extracted_fields": ["series", "trim", "bed_length"]
                              -- }

-- Notes
notes TEXT                   -- "No motor - engine removed" (if applicable)
```

---

## Implementation: AI Extraction + Normalization

### Step 1: Enhanced AI Extraction Prompt ✅
**File:** `supabase/functions/extract-vehicle-data-ai/index.ts`
- Updated prompt to extract: bed_length, engine_status, series, trim
- Added normalization rules: "Chevy" → "Chevrolet", "pickup" → "C/K"
- Added confidence scoring (0-1)
- Added source annotations

### Step 2: Update Scraper to Use AI Extraction
**File:** `supabase/functions/scrape-all-craigslist-squarebodies/index.ts`

**Current Flow (WRONG):**
```typescript
// Basic regex scraping
scrapeData = scrapeCraigslistInline(doc, listingUrl)
// Simple pattern matching
make = "Chevy"
model = "shortbed truck"
// Insert with incomplete data
```

**New Flow (CORRECT):**
```typescript
// 1. Scrape HTML
const html = await fetch(listingUrl).then(r => r.text())
const doc = parseHTML(html)

// 2. Call AI extraction
const aiResponse = await supabase.functions.invoke('extract-vehicle-data-ai', {
  body: { url: listingUrl, html, source: 'craigslist' }
})

const extracted = aiResponse.data.data

// 3. Normalize make/model/series/trim
const make = normalizeMake(extracted.make) // "Chevy" → "Chevrolet"
const model = normalizeModel(extracted.model) // "pickup" → "C/K"
const series = extracted.series || extractSeriesFromText(extracted.title, extracted.description)
const trim = extracted.trim || extractTrimFromText(extracted.title, extracted.description)

// 4. Handle engine status
const engine_size = extracted.engine_status === 'No Motor' 
  ? null 
  : extracted.engine_size

const notes = extracted.engine_status === 'No Motor'
  ? 'No motor - engine removed or missing'
  : extracted.description

// 5. Build vehicle insert with all normalized fields
const vehicleInsert = {
  year: extracted.year,
  make, // Normalized
  model, // Normalized
  series, // Extracted
  trim, // Extracted
  bed_length: extracted.bed_length, // "SWB" or "LWB"
  engine_size, // NULL if "no motor"
  transmission: extracted.transmission,
  drivetrain: extracted.drivetrain,
  notes,
  origin_metadata: {
    extraction_confidence: Math.round((extracted.confidence || 0.5) * 100), // 0-100
    extraction_method: 'ai_extraction',
    source_url: listingUrl,
    bed_length_source: extracted.source_annotations?.bed_length_source,
    engine_status: extracted.engine_status,
    extracted_fields: extracted.extracted_fields || [],
    extraction_timestamp: new Date().toISOString()
  }
}

// 6. Only insert if confidence >= 50
if (extracted.confidence >= 0.5) {
  await supabase.from('vehicles').insert(vehicleInsert)
} else {
  console.warn(`Low confidence (${extracted.confidence}) - skipping`)
}
```

---

## Normalization Functions (Inline in Edge Function)

```typescript
function normalizeMake(make: string | null): string {
  if (!make) return 'Unknown'
  const lower = make.toLowerCase()
  if (lower.includes('chevrolet') || lower.includes('chevy')) return 'Chevrolet'
  if (lower.includes('gmc')) return 'GMC'
  if (lower.includes('ford')) return 'Ford'
  if (lower.includes('dodge') || lower.includes('ram')) return 'Dodge'
  return make.charAt(0).toUpperCase() + make.slice(1).toLowerCase()
}

function normalizeModel(model: string | null, make: string): string {
  if (!model) return 'Unknown'
  const lower = model.toLowerCase()
  const makeLower = make.toLowerCase()
  
  // GM trucks
  if (makeLower.includes('chevrolet') || makeLower.includes('gmc')) {
    if (lower.includes('pickup') || lower.includes('truck') || lower.includes('c10') || lower.includes('k10') || lower.includes('c20') || lower.includes('k20')) {
      return 'C/K'
    }
    if (lower.includes('blazer') || lower.includes('k5')) {
      return 'Blazer'
    }
    if (lower.includes('suburban')) {
      return 'Suburban'
    }
  }
  
  return model
}

function extractSeriesFromText(title: string, description: string): string | null {
  const text = `${title} ${description}`.toUpperCase()
  const seriesPatterns = [
    /\b(C10|K10)\b/,
    /\b(C20|K20)\b/,
    /\b(C30|K30)\b/,
    /\b(K5|C5)\b/,
    /\b(C1500|K1500)\b/,
    /\b(C2500|K2500)\b/
  ]
  
  for (const pattern of seriesPatterns) {
    const match = text.match(pattern)
    if (match) return match[1]
  }
  
  return null
}

function extractTrimFromText(title: string, description: string): string | null {
  const text = `${title} ${description}`.toUpperCase()
  const trimPatterns = [
    /\b(CHEYENNE SUPER|CHEYENNE)\b/,
    /\b(SILVERADO)\b/,
    /\b(SCOTTSDALE)\b/,
    /\b(CUSTOM DELUXE)\b/,
    /\b(BIG 10)\b/
  ]
  
  for (const pattern of trimPatterns) {
    const match = text.match(pattern)
    if (match) {
      const trim = match[1]
      // Capitalize properly
      return trim.split(' ').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ')
    }
  }
  
  return null
}
```

---

## Scaling Tool: Normalize Existing Vehicles

### Edge Function: `normalize-existing-vehicles`
**File:** `supabase/functions/normalize-existing-vehicles/index.ts`

**Purpose:** Re-process existing vehicles with AI extraction to normalize data

**Usage:**
```bash
# Normalize single vehicle
curl -X POST https://qkgaybvrernstplzjaam.supabase.co/functions/v1/normalize-existing-vehicles \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"vehicle_id": "22f9cce1-0c58-4177-b504-27aad1b0bd61"}'

# Normalize all Craigslist vehicles (batch script)
node scripts/normalize-all-craigslist-vehicles.js
```

**Implementation:**
1. Fetch vehicle with `discovery_url`
2. Fetch listing HTML
3. Call `extract-vehicle-data-ai`
4. Normalize data
5. Update vehicle record

---

## Summary

**What's Fixed:**
1. ✅ AI extraction with enhanced prompt (bed_length, engine_status, series, trim)
2. ✅ Make/model normalization functions
3. ✅ Confidence ratings (0-100)
4. ✅ Source annotations in `origin_metadata`
5. ✅ Engine status handling ("no motor" → NULL with annotation)
6. ✅ Bed length extraction (SWB/LWB)

**Where Data Goes:**
- `vehicles.make` - Normalized
- `vehicles.model` - Normalized  
- `vehicles.series` - Extracted
- `vehicles.trim` - Extracted
- `vehicles.bed_length` - SWB/LWB
- `vehicles.engine_size` - NULL if "no motor"
- `vehicles.origin_metadata` - Confidence, method, annotations
- `vehicles.notes` - "No motor" annotation if applicable

**Scaling Tool:**
- `normalize-existing-vehicles` edge function (process individual)
- `normalize-all-craigslist-vehicles.js` script (batch process)

