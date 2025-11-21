# Reference Library - Source of Truth for Accuracy

## Core Principle

**The reference library is not just documentation storage - it's the canonical source that validates and informs the entire UI.**

### What This Means

When you upload factory documentation:
- **1973 Chevrolet Trucks brochure** → Proves what emblems were used in 1973
- **RPO code list** → Proves what options existed
- **Paint code chart** → Proves what colors were available
- **Spec sheet** → Proves horsepower, weight, dimensions

The system then uses this to:
- ✅ Show correct 1973 Chevrolet bowtie (not 1985 version)
- ✅ Validate user-entered data against factory specs
- ✅ Suggest accurate defaults
- ✅ Display period-correct badges and emblems
- ✅ Prevent inaccurate information

---

## Expanded Database Schema

```sql
-- ============================================
-- REFERENCE LIBRARIES (Source of Truth)
-- ============================================

ALTER TABLE reference_libraries ADD COLUMN IF NOT EXISTS metadata JSONB;

-- Metadata stores extracted facts from documents:
{
  "emblems": {
    "bowtie_variant": "1973_gold_classic",
    "gmc_shield_variant": "1973_red_chrome",
    "placement": ["grille", "tailgate", "hubcaps"]
  },
  "available_colors": [
    {"code": "70", "name": "Cardinal Red"},
    {"code": "67", "name": "Nevada Gold"}
  ],
  "available_trims": ["Custom", "Cheyenne", "Silverado"],
  "available_engines": [
    {"code": "L05", "name": "5.7L V8", "hp": 165}
  ],
  "factory_specs": {
    "wheelbase": 106.5,
    "length": 184.8,
    "curb_weight": 4400
  }
}
```

### How Metadata Gets Populated

1. **You upload 1973 brochure** → System OCRs/extracts specs
2. **Admin verifies** → Marks as verified source
3. **System uses it** → When user adds 1973 K5, suggests these specs
4. **UI reflects it** → Shows correct emblem, validates entries

---

## Emblem Accuracy System

### Database Structure

```sql
-- Add emblem tracking to library metadata
CREATE TABLE IF NOT EXISTS reference_emblems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- WHAT
  make TEXT NOT NULL,
  emblem_type TEXT NOT NULL,  -- 'bowtie', 'shield', 'badge'
  variant_name TEXT,           -- '1973_classic_gold', '1985_modern_chrome'
  
  -- WHEN (year range this emblem was used)
  year_start INTEGER NOT NULL,
  year_end INTEGER,
  
  -- WHERE (placement on vehicle)
  placements TEXT[],           -- ['grille', 'tailgate', 'hubcaps', 'steering_wheel']
  
  -- FILE
  svg_url TEXT,
  png_url TEXT,
  source_document_id UUID REFERENCES library_documents(id),  -- Proof from brochure
  
  -- VERIFICATION
  is_verified BOOLEAN DEFAULT FALSE,
  verified_by UUID REFERENCES auth.users(id),
  
  -- USAGE
  usage_count INTEGER DEFAULT 0,  -- How many vehicles display this
  preference_score INTEGER DEFAULT 0,  -- User preference voting
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Link emblems to specific years/models
CREATE TABLE IF NOT EXISTS vehicle_emblems (
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  emblem_id UUID REFERENCES reference_emblems(id) ON DELETE CASCADE,
  
  placement TEXT,              -- Where on this vehicle
  is_primary BOOLEAN DEFAULT FALSE,  -- Main emblem to show in profile
  
  PRIMARY KEY (vehicle_id, emblem_id, placement)
);
```

### Example: 1973 vs 1985 Chevrolet Bowtie

**Your brochure proves**:
```
1973 Chevrolet used:
- Gold bowtie (specific shade)
- Grille placement: centered
- Tailgate: "CHEVROLET" text + bowtie
- Hubcaps: small bowtie
```

**System stores**:
```sql
INSERT INTO reference_emblems (
  make, emblem_type, variant_name,
  year_start, year_end,
  placements,
  source_document_id,  -- Links to your uploaded brochure as proof
  is_verified
) VALUES (
  'Chevrolet',
  'bowtie',
  '1973_classic_gold',
  1973,
  1980,
  ARRAY['grille', 'tailgate', 'hubcaps'],
  '[your-brochure-doc-id]',
  true
);
```

**UI automatically uses it**:
- 1973 K5 Blazer → Shows 1973 gold bowtie
- 1985 K5 Blazer → Shows different 1985 bowtie variant
- Validation popup → Shows correct era emblem
- Profile header → Period-correct badge

---

## Accuracy Validation Flow

### 1. User Enters Data
```
User creating 1973 K5 Blazer:
- Enters "440 HP" for horsepower
```

### 2. System Checks Reference Library
```sql
-- Check if 440 HP is valid for 1973 K5
SELECT factory_specs->'available_engines' 
FROM reference_libraries
WHERE year = 1973 AND series = 'K5';

-- Returns: Max factory HP was 255 (L05 5.7L V8)
```

### 3. System Warns User
```
⚠️ Factory max: 255 HP
You entered: 440 HP

This indicates:
✓ Modified engine (LS swap likely)
✓ Mark vehicle as "is_modified"

Reference: 1973 Chevrolet Trucks Brochure (page 12)
Contributed by: skylar williams
```

### 4. Builds Accuracy Score
```
Vehicle Accuracy Rating: 85%

Verified against:
✓ 1973 Brochure (factory specs)
✓ RPO Code List (option codes)
✓ Owner's Manual (dimensions)
⚠️ Modified engine noted
```

---

## UI Integration Examples

### Example 1: Profile Header Emblem

```tsx
// Get correct emblem for vehicle's year
const getVehicleEmblem = (year: number, make: string) => {
  // Query reference_emblems table
  const emblem = await supabase
    .from('reference_emblems')
    .select('svg_url')
    .eq('make', make)
    .gte('year_start', year)
    .lte('year_end', year)
    .eq('is_primary', true)
    .single();
    
  return emblem?.svg_url || '/emblems/generic.svg';
};

// 1973 Chevy → Gets 1973_classic_gold bowtie
// 1985 Chevy → Gets 1985_modern_chrome bowtie
// Period-correct every time
```

### Example 2: Validation Popup

```tsx
<ValidationPopup>
  {/* Show emblem from reference library */}
  <img src={getEmblemForYear(vehicle.year, vehicle.make)} />
  
  {/* Show proof from reference docs */}
  <DocumentPreview 
    source="1973 Chevrolet Trucks Brochure"
    page={12}
    contributor="skylar williams"
  />
  
  {/* Link to full document */}
  <a href="/library/1973-chevrolet-k5">
    View factory documentation →
  </a>
</ValidationPopup>
```

### Example 3: Spec Suggestions

```tsx
// When user adds 1973 K5 Blazer
<SpecSuggestions>
  Factory specs from reference library:
  
  Engine: 5.7L V8 (L05) - 165 HP
  Source: 1973 Brochure, page 12
  
  Weight: 4,400 lbs
  Source: 1973 Spec Sheet
  
  Colors available:
  - Cardinal Red (70)
  - Nevada Gold (67)
  - Antique White (11)
  Source: 1973 Paint Code Chart
  
  [Apply All] [Pick & Choose]
</SpecSuggestions>
```

---

## Contributor Reputation System

### Shops Build Expertise Vibe

```
Viva! Las Vegas Autos
├─ Contributed 23 documents
├─ Specializes in: K5 Blazers, Square Body
├─ Documents:
│  ├─ K5 Service Bulletins (8)
│  ├─ Wiring Diagrams (5)
│  └─ Common Issues Guide (1)
└─ Used by 156 vehicles

This creates "vibe" - shows they're K5 specialists
```

### Users Build Credibility

```
skylar williams
├─ Contributed 12 documents
├─ Expertise: 1973-1980 GM Trucks
├─ Documents:
│  ├─ 1973 Brochure (verified)
│  ├─ RPO Code List (verified)
│  └─ Paint Charts (verified)
└─ 234 vehicles use their docs

"Verified Contributor" badge in profile
```

---

## Data Flow

```
┌──────────────────────┐
│ Factory Document     │
│ (Your 1973 Brochure) │
└──────────┬───────────┘
           │ uploaded by you
           ▼
┌──────────────────────┐
│ Reference Library    │
│ 1973 Chevrolet K5    │
│                      │
│ Metadata extracted:  │
│ - Emblems used       │
│ - Colors available   │
│ - Engine options     │
│ - Factory specs      │
└──────────┬───────────┘
           │ auto-links to
           ▼
┌──────────────────────┐     ┌──────────────────────┐
│ Vehicle Profile      │     │ UI Components        │
│ 1977 K5 Blazer       │────▶│ - Show 1973 emblem   │
│                      │     │ - Validate specs     │
│ Displays:            │     │ - Suggest colors     │
│ ✓ Correct emblem     │     │ - Verify options     │
│ ✓ Period badges      │     └──────────────────────┘
│ ✓ Accurate specs     │
│                      │
│ Attribution:         │
│ "Reference docs by   │
│  skylar williams"    │
└──────────────────────┘
```

---

## Implementation Priority

### Phase 1: Core Upload (Now)
- ✅ Tables created
- ✅ Storage bucket ready
- ⏳ Simple upload UI

### Phase 2: Metadata Extraction (Next)
- OCR documents
- Extract specs, emblems, colors
- Store in library metadata
- Feed into UI validation

### Phase 3: UI Integration (Then)
- Show docs in vehicle profile
- Period-correct emblems
- Spec validation
- Contributor attribution

---

## Your Role

**As curator of accuracy**:
- Upload factory docs (brochures, manuals, charts)
- System extracts truth from them
- Truth flows into every matching vehicle
- UI displays period-correct information
- Community benefits, you get credit

**Like Wikipedia for classic vehicles** - except backed by actual factory documentation you provide.

Ready to build the upload UI so you can drop your files? 📚✨
