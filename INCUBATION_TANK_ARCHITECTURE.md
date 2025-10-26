# 🧪 Incubation Tank Architecture - Real Data Only

**Metaphor:** Images are "film negatives" that get developed in a "chemical bath" (catalog + LLM)

---

## The Process

### 1. GUIDERAIL DATASET (Chemical Bath)
```
part_catalog table = Reference database of ALL GM truck parts
- Scraped from LMC Truck (50+ categories, 500-2000 parts)
- OEM part numbers
- Fits: year/make/model
- Real supplier pricing
- Installation specs
```

### 2. RAW IMAGE (Film Negative)
```
User uploads image → stored as-is
Status: "unexposed" (no tags yet)
```

### 3. INCUBATION PROCESS (Developing)
```
LLM (Claude Vision) + Catalog = Development Process

Steps:
1. LLM analyzes image → identifies visible parts
2. For each part: Search catalog by:
   - Visual description
   - Vehicle context (1983 GMC C1500)
   - Part system (brake, cooling, body, etc.)
3. Catalog returns matches with confidence scores
4. ONLY matches > 85% confidence get tagged
5. Tag inherits real supplier data from catalog
6. Green dot appears (shoppable)
```

### 4. DEVELOPED IMAGE (Tagged & Shoppable)
```
Image now has:
- Green dots on parts matched to catalog
- Real OEM part numbers
- Real supplier pricing
- Ready to shop
```

---

## Current Status

### ❌ Problem:
```sql
SELECT COUNT(*) FROM part_catalog;
-- Result: 0 (EMPTY!)
```

Without the catalog, there's no "chemical bath" to develop images with.

### ✅ Solution:

**Deploy scraper → populate catalog → re-enable intelligent tagging**

---

## Implementation Plan

### Phase 1: Populate Catalog (TODAY)
1. Deploy `scrape-lmc-complete` Edge Function
2. Run scraper for all 50+ categories
3. Populate `part_catalog` with 500-2000 real parts
4. Result: Chemical bath ready

### Phase 2: Incubation Pipeline
1. Create `incubate-image` Edge Function
2. Takes: image_id
3. Runs: LLM analysis + catalog matching
4. Creates: High-confidence tags only
5. Status: "developed" when complete

### Phase 3: Auto-Processing
1. On image upload → add to incubation queue
2. Background worker processes queue
3. Images gradually get "developed"
4. Green dots appear as matches are found

---

## Chemical Bath Metaphor

```
Raw Image (Film Negative)
    ↓
Immersed in Catalog (Chemical Bath)
    ↓
LLM Agitation (Development Process)
    ↓
Catalog Matches Revealed (Image Develops)
    ↓
Tagged & Shoppable (Developed Print)
```

**No catalog = no development = raw images forever**

---

**Next:** Deploy scraper and fill the tank!

