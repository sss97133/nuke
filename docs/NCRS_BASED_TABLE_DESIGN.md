# NCRS-Based Professional Table Design

## Based on ACTUAL Professional Standards

### NCRS (National Corvette Restorers Society) Judging System

**Total Points:** 1,000 (deductions from perfect score)

**Four Major Categories:**
1. Exterior: 300 points
2. Interior: 200 points  
3. Chassis: 300 points
4. Engine: 200 points

---

## NCRS Exterior Category (300 points)

### Subcategories with Point Allocations:

```
Body Panel Fit & Alignment:     50 points
Paint Finish & Quality:         75 points
Chrome & Bright Trim:           50 points
Glass & Weather Seals:          40 points
Lights & Lenses:                35 points
Exterior Correctness:           50 points
```

### Our Table Structure (Based on NCRS):

```sql
CREATE TABLE ncrs_exterior_assessment (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID REFERENCES vehicles(id),
  assessment_date TIMESTAMPTZ DEFAULT NOW(),
  
  -- NCRS Category: Body Panel Fit & Alignment (50 pts)
  panel_fit_score INTEGER, -- Deductions from 50
  panel_fit_deductions JSONB,
  /* Structure:
  {
    "hood_to_fender_gap": {
      "spec": "3/16 inch ± 1/16",
      "actual": "1/4 inch",
      "deduction": 5,
      "notes": "Gap slightly wide on driver side",
      "image_id": "uuid"
    },
    "door_gaps": { ... },
    "panel_alignment": { ... }
  }
  */
  
  -- NCRS Category: Paint Finish & Quality (75 pts)
  paint_score INTEGER, -- Deductions from 75
  paint_deductions JSONB,
  /* Structure:
  {
    "originality": {
      "is_factory": false,
      "deduction": 50,
      "evidence": "Overspray in jams",
      "image_id": "uuid"
    },
    "orange_peel": {
      "severity": "moderate",
      "deduction": 10,
      "location": "hood, roof"
    },
    "color_match": {
      "panels_match": false,
      "deduction": 15,
      "notes": "Fender color slightly off"
    }
  }
  */
  
  -- NCRS Category: Chrome & Bright Trim (50 pts)
  chrome_score INTEGER,
  chrome_deductions JSONB,
  
  -- NCRS Category: Glass & Seals (40 pts)
  glass_score INTEGER,
  glass_deductions JSONB,
  
  -- NCRS Category: Lights (35 pts)
  lights_score INTEGER,
  lights_deductions JSONB,
  
  -- NCRS Category: Correctness (50 pts)
  correctness_score INTEGER,
  correctness_deductions JSONB,
  /* Structure:
  {
    "incorrect_parts": [
      {
        "part": "front bumper",
        "spec": "1967 Corvette chrome bumper",
        "actual": "Aftermarket fiberglass",
        "deduction": 25,
        "reference": "NCRS Judging Guide p.47"
      }
    ],
    "missing_parts": [ ... ],
    "wrong_finishes": [ ... ]
  }
  */
  
  -- Totals
  total_deductions INTEGER,
  final_score INTEGER, -- 300 - total_deductions
  
  -- Images used for assessment
  images_assessed UUID[],
  image_quality_sufficient BOOLEAN,
  
  -- Assessor
  assessed_by_model TEXT,
  requires_human_verification BOOLEAN DEFAULT true,
  human_verified BOOLEAN DEFAULT false,
  verified_by UUID REFERENCES profiles(id),
  verified_at TIMESTAMPTZ
);
```

---

## NCRS Interior Category (200 points)

```sql
CREATE TABLE ncrs_interior_assessment (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID REFERENCES vehicles(id),
  assessment_date TIMESTAMPTZ DEFAULT NOW(),
  
  -- NCRS Category: Seats & Upholstery (60 pts)
  seats_score INTEGER,
  seats_deductions JSONB,
  /* {
    "material_correctness": {
      "spec": "Factory leather",
      "actual": "Vinyl recovering",
      "deduction": 30,
      "reference": "Build sheet shows RPO code for leather"
    },
    "condition": {
      "tears": true,
      "deduction": 15,
      "location": "driver_seat_bolster"
    },
    "stitching_pattern": {
      "correct": false,
      "deduction": 5
    }
  }
  */
  
  -- NCRS Category: Dash & Instruments (50 pts)
  dash_score INTEGER,
  dash_deductions JSONB,
  
  -- NCRS Category: Carpet & Mats (30 pts)
  carpet_score INTEGER,
  carpet_deductions JSONB,
  
  -- NCRS Category: Door Panels (30 pts)
  door_panels_score INTEGER,
  door_panels_deductions JSONB,
  
  -- NCRS Category: Correctness (30 pts)
  correctness_score INTEGER,
  correctness_deductions JSONB,
  
  -- Totals
  total_deductions INTEGER,
  final_score INTEGER, -- 200 - total_deductions
  
  images_assessed UUID[],
  assessed_by_model TEXT,
  requires_human_verification BOOLEAN DEFAULT true
);
```

---

## NCRS Chassis Category (300 points)

```sql
CREATE TABLE ncrs_chassis_assessment (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID REFERENCES vehicles(id),
  assessment_date TIMESTAMPTZ DEFAULT NOW(),
  
  -- NCRS Category: Frame & Suspension (80 pts)
  frame_score INTEGER,
  frame_deductions JSONB,
  
  -- NCRS Category: Brakes (50 pts)
  brakes_score INTEGER,
  brakes_deductions JSONB,
  
  -- NCRS Category: Exhaust System (40 pts)
  exhaust_score INTEGER,
  exhaust_deductions JSONB,
  
  -- NCRS Category: Fuel System (40 pts)
  fuel_score INTEGER,
  fuel_deductions JSONB,
  
  -- NCRS Category: Steering (40 pts)
  steering_score INTEGER,
  steering_deductions JSONB,
  
  -- NCRS Category: Correctness (50 pts)
  correctness_score INTEGER,
  correctness_deductions JSONB,
  
  total_deductions INTEGER,
  final_score INTEGER, -- 300 - total_deductions
  
  images_assessed UUID[],
  assessed_by_model TEXT,
  requires_human_verification BOOLEAN DEFAULT true
);
```

---

## NCRS Engine Category (200 points)

```sql
CREATE TABLE ncrs_engine_assessment (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID REFERENCES vehicles(id),
  assessment_date TIMESTAMPTZ DEFAULT NOW(),
  
  -- NCRS Category: Block & Heads (60 pts)
  block_score INTEGER,
  block_deductions JSONB,
  /* {
    "casting_numbers": {
      "spec": "3970010 (correct for 1969 350ci)",
      "visible": true,
      "correct": true,
      "deduction": 0,
      "reference": "Casting number guide",
      "image_id": "uuid"
    },
    "date_codes": {
      "spec": "Within 6 months of build date",
      "actual": "2 months before",
      "correct": true,
      "deduction": 0
    },
    "finish": {
      "spec": "Chevrolet Orange",
      "actual": "Chevrolet Orange",
      "correct": true,
      "deduction": 0
    }
  }
  */
  
  -- NCRS Category: Components (60 pts)
  components_score INTEGER,
  components_deductions JSONB,
  /* {
    "carburetor": {
      "spec": "Rochester Quadrajet #7029203",
      "actual": "Holley 4-barrel (incorrect)",
      "deduction": 20,
      "part_type": "major_component"
    },
    "distributor": { ... },
    "intake_manifold": { ... },
    "air_cleaner": { ... }
  }
  */
  
  -- NCRS Category: Accessories (40 pts)
  accessories_score INTEGER,
  accessories_deductions JSONB,
  
  -- NCRS Category: Correctness (40 pts)
  correctness_score INTEGER,
  correctness_deductions JSONB,
  /* {
    "decals": {
      "correct": false,
      "deduction": 5,
      "notes": "Missing emissions decal"
    },
    "hoses": {
      "correct_type": true,
      "correct_clamps": false,
      "deduction": 3
    },
    "wiring": { ... }
  }
  */
  
  total_deductions INTEGER,
  final_score INTEGER, -- 200 - total_deductions
  
  images_assessed UUID[],
  assessed_by_model TEXT,
  requires_human_verification BOOLEAN DEFAULT true
);
```

---

## NCRS Deduction Rules Reference Table

```sql
CREATE TABLE ncrs_deduction_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Classification
  category TEXT NOT NULL, -- 'exterior', 'interior', 'chassis', 'engine'
  subcategory TEXT NOT NULL, -- 'paint', 'panel_fit', 'block_heads', etc.
  
  -- Rule definition
  rule_name TEXT NOT NULL,
  rule_description TEXT,
  
  -- Specifications
  factory_specification TEXT,
  tolerance TEXT,
  measurement_method TEXT,
  
  -- Deductions
  deduction_points_minor INTEGER,
  deduction_points_major INTEGER,
  deduction_points_severe INTEGER,
  
  -- Reference
  reference_source TEXT, -- 'NCRS Judging Guide 4th Ed'
  reference_page TEXT,
  reference_section TEXT,
  
  -- Applicability
  applies_to_years INTEGER[],
  applies_to_models TEXT[],
  applies_to_body_styles TEXT[],
  
  -- Examples
  example_violations JSONB,
  example_images TEXT[], -- URLs to reference images
  
  -- AI assistance
  can_ai_detect BOOLEAN, -- Can vision model detect this?
  requires_measurement BOOLEAN, -- Needs physical measurement?
  requires_expertise BOOLEAN, -- Needs human expert?
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ncrs_rules_category ON ncrs_deduction_rules(category, subcategory);
CREATE INDEX idx_ncrs_rules_years ON ncrs_deduction_rules USING GIN (applies_to_years);
```

---

## Professional Pre-Purchase Inspection (PPI) Standards

### Standard PPI Categories (Universal for All Vehicles):

```sql
CREATE TABLE ppi_assessment (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID REFERENCES vehicles(id),
  assessment_date TIMESTAMPTZ DEFAULT NOW(),
  
  -- EXTERIOR (Visual Inspection)
  exterior_condition_grade TEXT, -- 'Excellent', 'Good', 'Fair', 'Poor'
  paint_condition JSONB,
  /* {
    "finish_quality": "good",
    "defects": ["minor_scratches", "door_ding_passenger"],
    "repaint_evidence": false,
    "fade_level": "none"
  }
  */
  body_panel_condition JSONB,
  glass_condition JSONB,
  trim_condition JSONB,
  
  -- INTERIOR
  interior_condition_grade TEXT,
  seat_condition JSONB,
  dash_condition JSONB,
  carpet_headliner_condition JSONB,
  controls_switches_condition JSONB,
  odor_issues TEXT[],
  
  -- MECHANICAL (Visual Only from Images)
  engine_bay_condition_grade TEXT,
  visible_leaks JSONB,
  /* {
    "oil_leak": { "severity": "minor", "location": "valve_cover" },
    "coolant_leak": { "severity": "none" }
  }
  */
  belt_hose_condition TEXT,
  fluid_levels_visible TEXT,
  
  -- UNDERCARRIAGE (If visible)
  undercarriage_condition_grade TEXT,
  rust_assessment JSONB,
  /* {
    "frame": "surface_rust",
    "floor_pans": "none",
    "rockers": "moderate",
    "suspension_components": "good"
  }
  */
  suspension_visible_condition TEXT,
  exhaust_condition TEXT,
  
  -- WHEELS & TIRES
  tire_condition JSONB,
  /* {
    "front_left": { "tread_depth": "6/32", "condition": "good" },
    "front_right": { "tread_depth": "5/32", "condition": "fair" },
    ...
  }
  */
  wheel_condition JSONB,
  brake_visible_condition TEXT,
  
  -- OVERALL ASSESSMENT
  overall_grade TEXT, -- 'Excellent', 'Very Good', 'Good', 'Fair', 'Poor'
  market_value_indicator TEXT, -- 'Above Market', 'At Market', 'Below Market'
  recommended_immediate_repairs TEXT[],
  estimated_repair_costs NUMERIC,
  
  -- Quality flags
  images_sufficient BOOLEAN,
  areas_not_assessed TEXT[], -- What couldn't be seen in photos
  requires_in_person_inspection BOOLEAN,
  
  assessed_by_model TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## What We Actually Need to Digitize

### 1. NCRS Judging Guide (THE SOURCE)

Must scan and OCR:
- **NCRS Judging Guide 4th Edition**
- Every deduction rule
- Every specification
- Every tolerance
- Every reference photo

Store in:
```sql
CREATE TABLE ncrs_judging_standards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- From the actual book
  category TEXT, -- exterior, interior, chassis, engine
  subcategory TEXT,
  item_being_judged TEXT,
  
  -- Factory spec from book
  factory_specification TEXT,
  year_introduced INTEGER,
  year_discontinued INTEGER,
  
  -- Tolerance from book
  acceptable_tolerance TEXT,
  measurement_method TEXT,
  
  -- Deduction from book (exact)
  deduction_minor INTEGER,
  deduction_major INTEGER,
  notes TEXT,
  
  -- Reference (exact page)
  ncrs_guide_edition TEXT, -- '4th Edition'
  page_number INTEGER,
  section_number TEXT,
  
  -- Photo reference from book
  reference_photo_url TEXT,
  
  -- Applicability (from book)
  applies_to_years INTEGER[],
  applies_to_models TEXT[],
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 2. Factory Service Manuals

```sql
CREATE TABLE factory_specifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Source identification
  manual_type TEXT, -- 'service_manual', 'assembly_manual', 'parts_catalog'
  manufacturer TEXT, -- 'GM', 'Chevrolet', etc.
  year INTEGER,
  model TEXT,
  
  -- Specification
  component_name TEXT,
  specification_type TEXT, -- 'part_number', 'torque', 'gap', 'color', 'finish'
  specification_value TEXT,
  tolerance TEXT,
  
  -- Reference
  manual_title TEXT,
  page_number TEXT,
  section TEXT,
  figure_number TEXT,
  
  -- Digital reference
  scanned_page_url TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 3. Professional Condition Grading Standards

```sql
CREATE TABLE condition_grading_standards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Which standard
  standard_name TEXT, -- 'NCRS', 'Hagerty', 'Classic Car Club', 'PPI Standard'
  grade_level TEXT, -- 'Excellent', 'Good', 'Fair', 'Poor' or numeric
  
  -- Criteria (from actual books/standards)
  category TEXT, -- 'paint', 'interior', 'mechanical'
  criteria_description TEXT,
  specific_requirements TEXT[],
  disqualifying_factors TEXT[],
  
  -- Examples (from books)
  example_description TEXT,
  example_image_url TEXT,
  
  -- Reference
  source_document TEXT,
  page_number TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Detection Phases REVISED (Based on Standards)

### Phase 1: Visual Cataloging (Trivial)
- Angles ✓
- Categories
- Components visible
**Tables:** Just vehicle_images fields

### Phase 2: Condition Grading (Per PPI Standards)
- Overall condition grades
- Component-by-component assessment
**Tables:** `ppi_assessment` (based on real PPI checklists)

### Phase 3: NCRS Scoring (Expert - Requires Manuals)
- Category-by-category NCRS assessment
- Actual point deductions per NCRS rules
**Tables:** 4 NCRS tables (exterior, interior, chassis, engine)

### Phase 4: Modifications vs Factory (Requires SPID + Manuals)
- Compare visible to factory specs
- Document deviations
**Tables:** `factory_correctness_assessments`

### Phase 5: Parts Identification (With Factory Catalogs)
- Match visible parts to factory part numbers
- Identify aftermarket vs OEM
**Tables:** `part_identifications` (with factory part # validation)

---

## What We Need to DO FIRST

### 1. Digitize Professional Standards

**Scan and structure:**
- NCRS Judging Guide (all deduction rules)
- Factory service manuals (specifications)
- PPI standard checklists
- Condition grading guides

### 2. Build Reference Tables

Populate:
- `ncrs_judging_standards` - Every rule from the book
- `factory_specifications` - Every spec from manuals
- `condition_grading_standards` - Industry standard criteria

### 3. THEN Run AI Detection

With standards loaded, AI can:
- Reference actual specs
- Apply real deduction rules
- Grade using professional criteria
- Not just guess!

---

## Immediate Action Plan

**Option A: Do it Right (Recommended)**
1. Get NCRS Judging Guide PDF
2. OCR and structure all deduction rules
3. Build reference tables
4. THEN run expert detection with real standards

**Option B: Hybrid Approach**
1. Finish basic detection now (angles, categories)
2. PAUSE before expert analysis
3. Digitize standards
4. Resume with real criteria

**Option C: Generic First, Refine Later**
1. Use generic assessments now
2. Flag for human review
3. Build standards in parallel
4. Reprocess with standards later

Which approach? I recommend A or B - do it right based on actual professional books, not AI guessing.

