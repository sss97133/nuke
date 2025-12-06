# Complete Parts Inventory Requirement for Restoration Scoring

## 🎯 The Core Challenge

**To calculate an accurate restoration score (0-100), we need:**

1. **Complete parts inventory** - Every single part that can exist on the vehicle
2. **Part identification** - Ability to identify each part in images
3. **Condition assessment** - Score each part's condition (0-100)
4. **Aggregation** - Combine all part scores into overall restoration score

---

## 📊 Current State vs. What's Needed

### What We Have Now

**`component_definitions` Table:**
- ✅ 12 basic components seeded (grille, bumper, fender, etc.)
- ✅ Structure ready for ~200-300 components
- ⚠️ **Missing:** Most components not yet defined

**`catalog_parts` Table:**
- ✅ 4,951 replacement parts indexed
- ✅ Prices, part numbers, fitment data
- ⚠️ **Limitation:** These are parts you can BUY, not necessarily what's ON the vehicle

**`component_assembly_map` Table:**
- ✅ Defines assemblies (door, front_clip, engine)
- ✅ Lists sub-components (door = shell + hinges + glass + regulator + trim + handle + lock + weatherstrip)
- ✅ Ready to map complete assemblies

**Image Analysis:**
- ✅ Can identify components in images
- ✅ Can assess condition
- ⚠️ **Limitation:** Can only identify what it knows exists

---

## 🔍 The Problem

### Example: 1973 Chevy C10

**What we need to know:**
- Every body panel (hood, fenders, doors, bed, tailgate, etc.)
- Every piece of trim (moldings, emblems, badges, chrome)
- Every mechanical component (engine, transmission, suspension, brakes, etc.)
- Every electrical component (lights, switches, wiring)
- Every interior component (seats, dash, carpet, headliner, etc.)
- Every glass component (windshield, windows, mirrors)
- Every fastener, bracket, and hardware piece

**Total parts on a vehicle:** ~500-1,000+ individual parts

**Current coverage:**
- `component_definitions`: 12 parts defined
- `catalog_parts`: 4,951 replacement parts (but not a complete inventory)

**Gap:** We don't have a complete parts list for any vehicle type.

---

## 💡 The Solution: Build Complete Parts Inventory

### Step 1: Extract from Service Manuals

**Service manuals contain:**
- Parts lists with part numbers
- Exploded diagrams showing all components
- Assembly procedures listing every part

**What to extract:**
```sql
-- From service manual indexing, extract:
- Part name
- Part number (OEM)
- Location/assembly
- Quantity required
- Year applicability
```

**Example from 1973 Service Manual:**
```
Front Bumper Assembly:
  - Bumper (main) - Part # 3947941
  - Bumper guards (2) - Part # 3947942
  - Bumper brackets (2) - Part # 3947943
  - Bumper bolts (8) - Part # 3947944
  - License plate bracket - Part # 3947945
```

### Step 2: Extract from Parts Catalogs

**Parts catalogs contain:**
- Complete parts listings
- Exploded diagrams
- Part numbers and descriptions

**What to extract:**
```sql
-- From parts catalog indexing, extract:
- Every part number
- Part name/description
- Assembly relationships
- Year/model applicability
```

### Step 3: Build Component Definitions

**For each part, create a `component_definitions` entry:**

```sql
INSERT INTO component_definitions (
  make, model_family, year_range_start, year_range_end,
  component_category, component_name, component_subcategory,
  visual_identifiers, distinguishing_features,
  oem_part_numbers, common_aftermarket_brands
) VALUES (
  'Chevrolet', 'C/K', 1973, 1987,
  'body', 'front_bumper', 'front_end',
  '{"location": "front", "material": "chrome", "shape": "horizontal bar"}',
  ARRAY['chrome finish', 'rubber strip optional', 'bumper guards optional'],
  ARRAY['3947941'], -- OEM part number
  ARRAY['LMC Truck', 'Brothers', 'Goodmark']
);
```

**Target:** ~200-300 components per vehicle type

---

## 🔄 The Complete Flow

### Phase 1: Build Inventory

```
1. Index service manuals
   ↓
2. Extract parts lists from manuals
   ↓
3. Extract parts from catalogs
   ↓
4. Create component_definitions for each part
   ↓
5. Link parts to assemblies (component_assembly_map)
```

### Phase 2: Identify Parts in Images

```
1. User uploads image
   ↓
2. AI Vision identifies visible parts
   ↓
3. Match to component_definitions
   ↓
4. Store in component_identifications
```

### Phase 3: Assess Condition

```
1. For each identified part:
   ↓
2. AI analyzes condition:
   - Paint/Finish: 0-25 points
   - Structure: 0-25 points
   - Rust: 0-25 points
   - Completeness: 0-25 points
   ↓
3. Store condition score per part
```

### Phase 4: Calculate Overall Score

```
1. Get all parts for vehicle type
   ↓
2. For each part:
   - If identified in images: use assessed score
   - If not visible: mark as "unknown" (don't penalize)
   - If missing: score = 0
   ↓
3. Aggregate scores:
   - Average of all visible parts
   - Weight by importance (critical parts weighted higher)
   - Generate overall restoration score (0-100)
```

---

## 📋 Implementation Plan

### Step 1: Extract Parts from Indexed Manuals

**Create edge function:** `extract-parts-from-manuals`

```typescript
// For each indexed service manual:
1. Query document_chunks where document_type = 'service_manual'
2. Find chunks with content_type = 'parts_list' or 'exploded_diagram'
3. Extract part names, numbers, assemblies
4. Create component_definitions entries
```

### Step 2: Extract Parts from Catalogs

**Enhance:** `index-reference-document` function

```typescript
// When mode = 'extract_parts':
1. Extract all parts from catalog pages
2. For each part, check if component_definition exists
3. If not, create new component_definition
4. Link to catalog_parts for pricing
```

### Step 3: Build Assembly Maps

**Use:** `component_assembly_map` table

```sql
-- Example: Door Assembly
INSERT INTO component_assembly_map (
  assembly_name, assembly_category, sub_components
) VALUES (
  'door',
  'body',
  '[
    {"name": "door_shell", "required": true},
    {"name": "door_hinges", "required": true, "quantity": 2},
    {"name": "door_glass", "required": true},
    {"name": "window_regulator", "required": true},
    {"name": "door_handle", "required": true},
    {"name": "door_lock", "required": true},
    {"name": "door_trim_panel", "required": false},
    {"name": "door_weatherstrip", "required": true},
    {"name": "door_speaker", "required": false}
  ]'::JSONB
);
```

### Step 4: Part Identification in Images

**Enhance:** `analyze-image-tier2` function

```typescript
// When analyzing images:
1. Get component_definitions for vehicle type
2. For each visible part in image:
   - Match to component_definition
   - Assess condition
   - Store in component_identifications
```

### Step 5: Condition Assessment

**Create edge function:** `assess-part-condition`

```typescript
// For each identified part:
1. Analyze image for part condition
2. Score each factor:
   - Paint: 0-25
   - Structure: 0-25
   - Rust: 0-25
   - Completeness: 0-25
3. Store in component_identifications with condition_score
```

### Step 6: Restoration Score Calculation

**Create edge function:** `calculate-restoration-score`

```typescript
// For a vehicle:
1. Get all component_definitions for vehicle type
2. Get all component_identifications for vehicle
3. For each component:
   - If identified: use assessed score
   - If not visible: mark as unknown (don't count)
   - If missing: score = 0
4. Calculate weighted average:
   - Critical parts (engine, frame): weight = 2.0
   - Important parts (body panels): weight = 1.5
   - Standard parts: weight = 1.0
   - Cosmetic parts: weight = 0.5
5. Return overall score (0-100)
```

---

## 📊 Data Structure

### Complete Parts Inventory

```typescript
interface CompletePartsInventory {
  vehicle_type: {
    year: number;
    make: string;
    model: string;
  };
  
  parts: {
    [category: string]: {
      [part_name: string]: {
        oem_part_number: string;
        description: string;
        location: string;
        assembly: string;
        required: boolean;
        quantity: number;
        importance_weight: number; // 0.5-2.0
        visual_identifiers: JSONB;
      }
    }
  };
  
  assemblies: {
    [assembly_name: string]: {
      sub_components: string[];
      required_parts: string[];
      optional_parts: string[];
    }
  };
}
```

### Part Condition Assessment

```typescript
interface PartCondition {
  part_name: string;
  component_definition_id: string;
  
  scores: {
    paint_score: number;        // 0-25
    structure_score: number;    // 0-25
    rust_score: number;         // 0-25
    completeness_score: number; // 0-25
  };
  
  total_score: number;          // 0-100
  condition_label: string;      // 'excellent', 'good', 'fair', 'poor', 'needs_replacement'
  
  evidence: {
    image_ids: string[];
    visible_features: string[];
    issues: string[];
  };
  
  status: 'identified' | 'not_visible' | 'missing';
}
```

### Overall Restoration Score

```typescript
interface RestorationScore {
  vehicle_id: string;
  overall_score: number;        // 0-100
  
  component_scores: PartCondition[];
  
  coverage: {
    total_parts: number;
    identified_parts: number;
    visible_parts: number;
    missing_parts: number;
    unknown_parts: number;
  };
  
  breakdown: {
    by_category: {
      [category: string]: {
        average_score: number;
        part_count: number;
      }
    };
    by_assembly: {
      [assembly: string]: {
        average_score: number;
        completeness: number; // 0-100
      }
    };
  };
  
  guidance: {
    level: 'maintenance' | 'detailing' | 'restoration' | 'replacement';
    recommendations: string[];
    estimated_cost: number;
    estimated_hours: number;
  };
}
```

---

## 🎯 Priority Order

### Phase 1: Build Foundation (Current)
- ✅ Component definitions structure
- ✅ Assembly maps structure
- ✅ Image analysis pipeline
- ⏳ Extract parts from service manuals
- ⏳ Extract parts from catalogs

### Phase 2: Complete Inventory (Next)
- Build complete parts list for 1973-1987 C/K trucks
- Create component_definitions for all parts
- Link parts to assemblies
- Verify completeness

### Phase 3: Identification (Then)
- Enhance image analysis to identify all parts
- Store identifications in component_identifications
- Track which parts are visible vs missing

### Phase 4: Condition Assessment (Finally)
- Assess condition for each identified part
- Calculate part-level scores
- Aggregate into overall restoration score

---

## 📈 Example: Complete Door Assessment

**Parts in door assembly:**
1. Door shell
2. Door hinges (2)
3. Door glass
4. Window regulator
5. Door handle
6. Door lock
7. Door trim panel
8. Door weatherstrip
9. Door speaker (optional)

**Assessment:**
- Door shell: 85/100 (good paint, minor dents)
- Door hinges: 60/100 (worn, needs replacement)
- Door glass: 90/100 (excellent)
- Window regulator: 70/100 (works but worn)
- Door handle: 80/100 (good condition)
- Door lock: 75/100 (functional)
- Door trim panel: 50/100 (faded, cracked)
- Door weatherstrip: 40/100 (dry, cracked)
- Door speaker: Missing (0/100)

**Door assembly score:**
- Average: (85 + 60 + 90 + 70 + 80 + 75 + 50 + 40 + 0) / 9 = 61/100
- Weighted (required parts): ~65/100

**Guidance:** "Door needs restoration - hinges, trim panel, and weatherstrip need replacement"

---

## 🔗 Integration Points

### With Indexing System
- Service manuals → Extract parts lists
- Parts catalogs → Extract all parts
- Material catalogs → Find materials for each part

### With Image Analysis
- Identify parts in images
- Assess condition
- Track completeness

### With Restoration Guidance
- Calculate scores
- Generate recommendations
- Estimate costs and time

---

## 🎬 The Complete Vision

**When a user uploads images of a vehicle:**

1. **System identifies all visible parts** (using component_definitions)
2. **Assesses condition of each part** (paint, structure, rust, completeness)
3. **Marks parts as present, missing, or unknown**
4. **Calculates part-level scores** (0-100 each)
5. **Aggregates into overall restoration score** (weighted average)
6. **Generates guidance** based on score and missing parts
7. **Recommends parts, materials, tools** from indexed catalogs
8. **Estimates cost and time** for restoration

**Result:** Complete restoration assessment with actionable guidance.

---

**The key insight: We need to build the complete parts inventory FIRST, then we can assess condition and calculate accurate restoration scores.**

