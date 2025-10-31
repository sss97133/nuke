# 🧠 INTELLIGENT PARTS RECOGNITION SYSTEM

**Vision:** Pre-populate entire catalog → AI knows vehicle dimensions → Click anywhere → Instant part match

---

## 🎯 **YOUR APPROACH (CORRECT):**

### **Problem with Current System:**
❌ User clicks → sees "no tags"  
❌ User has to manually add part info  
❌ Requires knowing part numbers  
❌ Slow, manual, doesn't scale  

### **Your Solution:**
✅ Pre-populate **ALL possible parts** for 1973-1987 Chevy/GMC  
✅ Train AI to understand **vehicle dimensions**  
✅ Click anywhere → AI matches part based on:
  - Vehicle: 1983 GMC C1500
  - Location: (x:50%, y:85%) = bumper area
  - Dimensional knowledge: "Bumpers are always at bottom-front"
  - Part catalog: "1973-87 GMC C1500 Front Bumper = Part# 15643917"

✅ **Instant match** - no manual work

---

## 📚 **STEP 1: BUILD COMPLETE CATALOG**

### **Scrape ALL LMC Truck Categories:**

Not just 7 dashboard categories - **EVERYTHING:**

```typescript
const ALL_LMC_CATEGORIES = [
  // EXTERIOR
  'bumpers/front-bumpers',
  'bumpers/rear-bumpers',
  'grilles',
  'headlights',
  'taillights',
  'fenders',
  'hoods',
  'doors',
  'bed-sides',
  'tailgates',
  'running-boards',
  'mirrors',
  'trim',
  'emblems',
  'weatherstripping',
  
  // INTERIOR
  'dash-components',
  'instrument-clusters',
  'steering-wheels',
  'seats',
  'door-panels',
  'carpet',
  'headliners',
  'console',
  
  // ENGINE
  'engine-blocks',
  'cylinder-heads',
  'carburetors',
  'fuel-pumps',
  'water-pumps',
  'alternators',
  'starters',
  'ignition',
  'belts-hoses',
  
  // DRIVETRAIN
  'transmissions',
  'transfer-cases',
  'axles',
  'driveshafts',
  'u-joints',
  
  // SUSPENSION
  'springs',
  'shocks',
  'control-arms',
  'ball-joints',
  'tie-rods',
  
  // BRAKES
  'brake-pads',
  'rotors',
  'calipers',
  'master-cylinders',
  'brake-lines',
  
  // ELECTRICAL
  'wiring-harnesses',
  'switches',
  'gauges',
  'lights',
  'batteries',
  
  // CHASSIS
  'frame-components',
  'crossmembers',
  'mounts',
  
  // WHEELS/TIRES
  'wheels',
  'tires',
  'hubcaps',
  'lug-nuts'
];

// For EACH category, scrape:
// - Part name
// - OEM part number
// - Fits years (1973-1987)
// - Fits models (C10, C1500, K10, K1500, Blazer, etc.)
// - Price
// - In stock
// - Description
// - Install notes
// - Image URL

// Result: 5,000-10,000 parts in catalog
```

---

## 🗺️ **STEP 2: DIMENSIONAL VEHICLE MAPPING**

### **Create Spatial Part Maps for Each Vehicle:**

```sql
CREATE TABLE vehicle_part_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Vehicle identification
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  year_start INTEGER,
  year_end INTEGER,
  body_style TEXT, -- 'pickup', 'blazer', 'suburban'
  
  -- Part identification
  part_category TEXT NOT NULL, -- 'bumper', 'headlight', 'grille'
  part_name TEXT NOT NULL,
  oem_part_number TEXT,
  
  -- Spatial location (% on standard vehicle photo views)
  view_angle TEXT NOT NULL, -- 'front', 'side', 'rear', 'interior_dash', etc.
  x_position_min DECIMAL(5,2), -- e.g. 45.00 = 45%
  x_position_max DECIMAL(5,2), -- e.g. 55.00 = 55%
  y_position_min DECIMAL(5,2),
  y_position_max DECIMAL(5,2),
  
  -- Dimensional context
  relative_to TEXT, -- 'grille', 'hood', 'wheel_well'
  position_notes TEXT, -- 'center-bottom', 'driver-side-top'
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Example data:
INSERT INTO vehicle_part_locations (make, model, year_start, year_end, body_style, part_category, part_name, oem_part_number, view_angle, x_position_min, x_position_max, y_position_min, y_position_max, relative_to) VALUES
('GMC', 'C1500', 1973, 1987, 'pickup', 'bumper', 'Front Bumper Assembly', '15643917', 'front', 35, 65, 80, 95, 'bottom'),
('GMC', 'C1500', 1973, 1987, 'pickup', 'headlight', 'Headlight Assembly - Driver', 'GM-HL-8387-L', 'front', 15, 30, 55, 70, 'grille'),
('GMC', 'C1500', 1973, 1987, 'pickup', 'headlight', 'Headlight Assembly - Passenger', 'GM-HL-8387-R', 'front', 70, 85, 55, 70, 'grille'),
('GMC', 'C1500', 1973, 1987, 'pickup', 'grille', 'Chrome Grille', 'GMC-GR-73', 'front', 40, 60, 60, 75, 'center');
```

---

## 🤖 **STEP 3: INTELLIGENT MATCHING ALGORITHM**

### **When User Clicks on Image:**

```typescript
async function intelligentPartMatch(
  clickX: number,  // 50% (center)
  clickY: number,  // 85% (bottom)
  vehicle: { make: 'GMC', model: 'C1500', year: 1983 },
  imageAnalysis: { view_angle: 'front' }
) {
  // 1. Query spatial map for this vehicle
  const matches = await supabase
    .from('vehicle_part_locations')
    .select('*, part_catalog(*)')
    .eq('make', vehicle.make)
    .eq('model', vehicle.model)
    .lte('year_start', vehicle.year)
    .gte('year_end', vehicle.year)
    .eq('view_angle', imageAnalysis.view_angle)
    .filter('x_position_min', 'lte', clickX)
    .filter('x_position_max', 'gte', clickX)
    .filter('y_position_min', 'lte', clickY)
    .filter('y_position_max', 'gte', clickY);
  
  if (matches.length > 0) {
    // Found exact spatial match!
    return matches[0]; // Front Bumper Assembly
  }
  
  // 2. Fallback: Use AI vision to identify
  const aiResult = await analyzeImageRegion(image, clickX, clickY);
  
  // 3. Match AI result against catalog
  const catalogMatch = await findBestCatalogMatch(
    aiResult.detected_part,
    vehicle
  );
  
  return catalogMatch;
}
```

---

## 📖 **STEP 4: LMC CATALOG AS "GUIDRAIL"**

You mentioned the PDF catalog. Let me:

1. **Scrape LMC site** (accessible via HTTP)
2. **Parse all categories** (50+ categories × 100 parts = 5,000+ parts)
3. **Extract:**
   - Part names
   - Part numbers
   - Fitment (year/make/model)
   - Descriptions
   - Prices
   - Images

4. **Store in `part_catalog`** table

5. **Create dimensional map** for common parts:
   - Bumpers always at y: 80-95% (bottom)
   - Headlights always at y: 55-70%, x: 15-30% (left) or 70-85% (right)
   - Grilles always at center (x: 40-60%, y: 60-75%)
   - Wheels at y: 70-90%, x: 10-25% (driver) or 75-90% (passenger)

---

## 🧠 **STEP 5: AI TRAINING / DIMENSIONAL VISION**

### **Enhanced AI Analysis Prompt:**

```typescript
const enhancedPrompt = `
You are analyzing a ${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.body_style}.

VEHICLE DIMENSIONAL KNOWLEDGE:
- Front bumper: Located at bottom-front, spans 35-65% width
- Grille: Center-front, 40-60% width, 60-75% height
- Headlights: Paired, 15-30% (L) and 70-85% (R) width, 55-70% height
- Hood: Top-center, 30-70% width, 20-50% height
- Fenders: Left/right sides, flare at wheel wells
- Wheels: Bottom corners, 10-25% (L) and 75-90% (R) width

USER CLICKED at (x: ${clickX}%, y: ${clickY}%).

Based on:
1. Click location
2. Vehicle dimensional template
3. Visual analysis of region

Identify the EXACT part with OEM part number.

Return JSON:
{
  "part_name": "Front Bumper Assembly",
  "oem_part_number": "15643917",
  "confidence": 0.95,
  "reasoning": "Click at y:85% on front view = bumper region. 1973-87 GMC C1500 bumper = GM part 15643917"
}
`;
```

---

## 📋 **IMPLEMENTATION PLAN:**

### **Phase 1: Complete Catalog (Do Now)**
```bash
# 1. Enhanced scraper - ALL categories
supabase functions deploy scrape-lmc-complete

# 2. Run scraper
curl -X POST ".../scrape-lmc-complete" \
  -d '{"scrapeAll": true}'

# 3. Result: 5,000-10,000 parts in catalog

# 4. Verify
SELECT COUNT(*) FROM part_catalog;
-- Expected: 5000+
```

### **Phase 2: Dimensional Mapping**
```sql
-- Seed standard part locations for 1973-87 GMC C1500
INSERT INTO vehicle_part_locations ... (100+ common parts)

-- Create lookup function
CREATE FUNCTION find_part_at_location(
  p_make TEXT,
  p_model TEXT, 
  p_year INTEGER,
  p_view TEXT,
  p_x DECIMAL,
  p_y DECIMAL
) RETURNS TABLE (part_name TEXT, oem_part_number TEXT, ...);
```

### **Phase 3: Smart Click Handler**
```typescript
// In ImageLightbox
const handleImageClick = async (x, y) => {
  // 1. Try dimensional match first (instant)
  const spatialMatch = await findPartAtLocation(vehicle, viewAngle, x, y);
  
  if (spatialMatch) {
    // Instant match! Show popup with suppliers
    openSpatialPopup(spatialMatch);
    return;
  }
  
  // 2. Fallback: AI vision
  const aiMatch = await analyzeRegion(imageUrl, x, y, vehicle);
  
  // 3. Match against catalog
  const catalogPart = await searchCatalog(aiMatch.part_name, vehicle);
  
  openSpatialPopup(catalogPart);
};
```

---

## 🚀 **LET ME BUILD THIS NOW:**

Since I can't read the PDF (Chrome extension URL), let me:

1. **Scrape the entire LMC site** (all categories)
2. **Build dimensional maps** for 1973-87 GM trucks
3. **Deploy smart matching**
4. **Test: Click bumper → Instant "Front Bumper $67.50"**

Want me to:
- [A] Build complete LMC scraper (all 50+ categories)
- [B] Create dimensional vehicle maps
- [C] Integrate smart matching into lightbox
- [D] All of the above

I'll start with **[D] All of the above** to give you the intelligent system you're describing!

