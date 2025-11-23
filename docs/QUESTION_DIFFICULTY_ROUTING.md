# Question Difficulty-Based Routing System

## Core Insight

**Route by what you're asking, not just image quality.**

Some questions are objectively easier than others:
- "What angle is this photo?" → Dead simple (cheap model)
- "What color is the vehicle?" → Easy (cheap model)
- "Is this paint original factory GM?" → Expert knowledge required (expensive model)
- "Does this meet NCRS judging standards?" → Requires professional expertise (expensive model)

---

## Professional Appraisal Standards

### NCRS (National Corvette Restorers Society) Judging System

The gold standard for Corvette appraisal uses a **point deduction system**:

```
NCRS FLIGHT JUDGING CATEGORIES:

1. EXTERIOR (300 points possible)
   ├─ Body Panel Fit & Alignment (50 pts)
   ├─ Paint Finish & Quality (75 pts)
   ├─ Chrome & Trim (50 pts)
   ├─ Glass & Seals (40 pts)
   ├─ Lights & Lenses (35 pts)
   └─ Correctness (50 pts)

2. INTERIOR (200 points possible)
   ├─ Seats & Upholstery (60 pts)
   ├─ Dash & Instruments (50 pts)
   ├─ Carpet & Mats (30 pts)
   ├─ Door Panels (30 pts)
   └─ Correctness (30 pts)

3. CHASSIS (300 points possible)
   ├─ Frame & Suspension (80 pts)
   ├─ Brakes (50 pts)
   ├─ Exhaust System (40 pts)
   ├─ Fuel System (40 pts)
   ├─ Steering (40 pts)
   └─ Correctness (50 pts)

4. ENGINE (200 points possible)
   ├─ Block & Heads (60 pts)
   ├─ Components (60 pts)
   ├─ Accessories (40 pts)
   └─ Correctness (40 pts)

TOTAL: 1,000 points
Deductions for: Incorrect parts, damage, poor finish, non-original
```

### Question Difficulty Mapping

```
┌─────────────────────────────────────────────────────────────────┐
│              QUESTION DIFFICULTY HIERARCHY                       │
└─────────────────────────────────────────────────────────────────┘

LEVEL 1: TRIVIAL (Free or near-free models)
─────────────────────────────────────────────────────────────────
Database Tables: EASY TO FILL
- vehicle_images.angle
- vehicle_images.category  
- vehicle_images.primary_color
- vehicle_images.weather_condition
- vehicle_images.time_of_day

Questions:
✓ "What angle is this photo taken from?"
✓ "Is this exterior, interior, or engine bay?"
✓ "What is the primary color visible?"
✓ "Is this photo taken indoors or outdoors?"

Model: gpt-4o-mini (or even free models)
Cost: $0.0001 per image
Accuracy: 95%+
Why cheap: Binary/multiple-choice, no expertise needed


LEVEL 2: SIMPLE (Cheap models)
─────────────────────────────────────────────────────────────────
Database Tables: MODERATE TO FILL
- image_tags (basic)
- vehicle_images.components_visible
- vehicle_images.basic_condition
- timeline_events.work_type_detected

Questions:
✓ "What major body panels are visible?" (hood, door, fender)
✓ "What is the general condition?" (excellent/good/fair/poor)
✓ "Is this a work-in-progress photo?"
✓ "What type of work is being performed?" (brake work, engine work)

Model: gpt-4o-mini
Cost: $0.0002 per image
Accuracy: 90%+
Why cheap: Obvious visual identification, minimal context needed


LEVEL 3: MODERATE (Mid-tier models)
─────────────────────────────────────────────────────────────────
Database Tables: REQUIRES SOME EXPERTISE
- part_identifications (specific parts)
- vehicle_modifications (aftermarket detection)
- damage_assessments
- work_validation (receipt matching)

Questions:
✓ "What specific engine component is this?" (alternator, carburetor)
✓ "Is this part factory or aftermarket?"
✓ "What type of damage is visible?" (dent, rust, crack)
✓ "Does this match the receipt for [specific part]?"

Model: gpt-4o-mini with context
Cost: $0.005 per image
Accuracy: 85%+
Why moderate: Needs part knowledge, but common parts are well-known


LEVEL 4: DIFFICULT (Expert models)
─────────────────────────────────────────────────────────────────
Database Tables: HARD TO FILL ACCURATELY
- paint_quality_assessment
- factory_correctness_validation
- ncrs_judging_deductions
- authenticity_scores
- value_impacting_assessments

Questions:
✗ "Is this paint original factory or repaint?" (requires experience)
✗ "Does this engine match factory specifications for [year/model]?"
✗ "Are these correct bolts for this application?"
✗ "Would NCRS judges deduct points for this?"
✗ "Is this stamping consistent with factory production?"

Model: gpt-4o with full context
Cost: $0.02 per image
Accuracy: 75%+ (still needs human verification)
Why expensive: Requires expertise, context, reference materials


LEVEL 5: EXPERT/HUMAN REQUIRED (Flag for manual review)
─────────────────────────────────────────────────────────────────
Database Tables: IMPOSSIBLE WITHOUT EXPERTISE
- ncrs_judging_scores (actual point deductions)
- authenticity_certifications
- professional_appraisal_values
- fraud_detection_flags

Questions:
✗ "Assign NCRS deduction points for panel gaps"
✗ "Is this a numbers-matching original?"
✗ "What is market value based on condition?"
✗ "Is this a reproduction or original part?"

Model: NONE - Flag for human expert
Cost: Human labor
Accuracy: 95%+ (with qualified expert)
Why human: Liability, expertise requirements, tactile inspection needed
```

---

## Database-Driven Routing

### Easy Tables → Cheap Models

```sql
-- These tables are EASY to populate
CREATE TABLE image_basic_classification (
  image_id UUID PRIMARY KEY,
  angle TEXT,                    -- TRIVIAL: 16 options, visual
  category TEXT,                 -- TRIVIAL: 8 options, obvious
  primary_color TEXT,            -- TRIVIAL: color detection
  lighting_quality TEXT,         -- SIMPLE: good/adequate/poor
  is_indoor BOOLEAN,             -- TRIVIAL: yes/no
  major_components TEXT[],       -- SIMPLE: hood, door, fender, wheel
  condition_glance TEXT,         -- SIMPLE: 5-point scale
  
  -- All above questions cost ~$0.0001 per image
  processing_cost NUMERIC DEFAULT 0.0001
);

-- Route these questions to: GPT-4o-mini or free models
```

### Moderate Tables → Mid-Tier Models

```sql
-- These tables need SOME expertise
CREATE TABLE part_identifications (
  id UUID PRIMARY KEY,
  image_id UUID,
  part_name TEXT,                -- MODERATE: needs part knowledge
  part_type TEXT,                -- MODERATE: classify type
  is_aftermarket BOOLEAN,        -- MODERATE: factory vs aftermarket
  brand TEXT,                    -- MODERATE: logo recognition
  part_number TEXT,              -- MODERATE: OCR + validation
  condition_rating TEXT,         -- MODERATE: assess wear
  
  -- Questions need context but not deep expertise
  processing_cost NUMERIC DEFAULT 0.005
);

-- Route these to: GPT-4o-mini with vehicle context
```

### Hard Tables → Expert Models

```sql
-- These tables are HARD to fill accurately
CREATE TABLE factory_correctness_assessment (
  id UUID PRIMARY KEY,
  image_id UUID,
  component_name TEXT,
  is_factory_correct BOOLEAN,   -- HARD: requires factory specs
  ncrs_acceptable BOOLEAN,       -- HARD: requires NCRS knowledge
  correctness_notes TEXT,        -- HARD: specific deviations
  deduction_points INTEGER,      -- EXPERT: actual judging points
  reference_source TEXT,         -- What manual/book validates this
  confidence_score INTEGER,      -- How certain is the assessment
  
  -- Requires factory documentation + expertise
  processing_cost NUMERIC DEFAULT 0.02
);

-- Route these to: GPT-4o with full context + factory docs
```

---

## NCRS-Inspired Questionnaire Structure

### Level 4 (Expert) Example: Paint Assessment

```json
{
  "category": "Paint Quality Assessment",
  "difficulty": "EXPERT",
  "model": "gpt-4o",
  "cost": 0.02,
  "requires_context": [
    "vehicle.year",
    "vehicle.make", 
    "vehicle.model",
    "factory_paint_code",
    "build_sheet_color",
    "ncrs_judging_guide"
  ],
  
  "questions": {
    "paint_originality": {
      "difficulty": "EXPERT",
      "question": "Based on NCRS judging standards, assess paint originality:",
      "sub_questions": [
        "Is orange peel consistent with factory 1967 Corvette application?",
        "Does overspray pattern match factory masking?",
        "Are body seams painted in factory style?",
        "Is paint thickness consistent with single-stage acrylic lacquer?",
        "Are there signs of color sanding or buffing in original locations?"
      ],
      "reference_required": "NCRS Judging Guide 4th Edition, Paint Section",
      "ncrs_deductions": {
        "repaint_entire_car": -50,
        "poor_paint_quality": -25,
        "incorrect_paint_type": -15,
        "overspray_errors": -10
      }
    },
    
    "panel_alignment": {
      "difficulty": "MODERATE",
      "question": "Assess body panel gaps per NCRS standards:",
      "measurements": [
        "Hood to fender gap (acceptable: 3/16\" ± 1/16\")",
        "Door to fender gap (acceptable: 3/16\" ± 1/16\")",
        "Door to quarter panel (acceptable: 3/16\" ± 1/16\")"
      ],
      "ncrs_deductions": {
        "gaps_over_1/4_inch": -5,
        "uneven_gaps": -3,
        "misaligned_panels": -10
      }
    }
  },
  
  "outputs_to_tables": [
    "paint_quality_assessment",
    "ncrs_judging_deductions",
    "factory_correctness_assessment"
  ]
}
```

### Level 2 (Simple) Example: Basic Organization

```json
{
  "category": "Basic Classification",
  "difficulty": "SIMPLE",
  "model": "gpt-4o-mini",
  "cost": 0.0001,
  "requires_context": [],
  
  "questions": {
    "angle_detection": {
      "difficulty": "TRIVIAL",
      "question": "What angle is this photo?",
      "options": [
        "front_3quarter", "front_center", "rear_3quarter", "rear_center",
        "driver_side", "passenger_side", "overhead", "undercarriage",
        "interior_front", "interior_rear", "engine_bay", "trunk"
      ]
    },
    
    "major_components": {
      "difficulty": "SIMPLE",
      "question": "What major body panels are visible?",
      "options": [
        "hood", "door_driver", "door_passenger", "fender_front_driver",
        "fender_front_passenger", "fender_rear_driver", "fender_rear_passenger",
        "bumper_front", "bumper_rear", "roof", "trunk_lid", "bed", "tailgate"
      ]
    }
  },
  
  "outputs_to_tables": [
    "vehicle_images.angle",
    "vehicle_images.category",
    "vehicle_images.components_visible"
  ]
}
```

---

## Routing Decision Tree

```
Question arrives
  ↓
Check: What database table needs filling?
  ↓
┌─────────────────────────────────────────────────────────────┐
│ Table Classification                                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ EASY TABLE (angle, category, color)                        │
│ ├─ Objective, visual, no expertise                         │
│ └─> Route to: FREE or $0.0001 model                        │
│                                                             │
│ MODERATE TABLE (parts, damage, work type)                  │
│ ├─ Requires part knowledge, but common                     │
│ └─> Route to: $0.0001-0.005 model with context             │
│                                                             │
│ HARD TABLE (factory correctness, authenticity)             │
│ ├─ Requires factory docs, expertise, reference books       │
│ └─> Route to: $0.02 expert model with full context         │
│                                                             │
│ EXPERT TABLE (NCRS judging, professional appraisal)        │
│ ├─ Liability, requires certified expert                    │
│ └─> Route to: HUMAN REVIEW (flag for manual inspection)    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Professional Standards Integration

### NCRS Judging Guide (Corvette Standard)

```
Reference Materials to Digitize:

1. NCRS Judging Guide (4th Edition)
   - Paint section (factory specs, deduction rules)
   - Interior section (material specs, correctness)
   - Engine section (casting numbers, date codes)
   - Chassis section (fastener types, finishes)

2. Factory Assembly Manuals
   - Build sequence
   - Part installation procedures
   - Factory finishes and colors

3. GM Parts Books
   - Part numbers by year
   - Supersession information
   - Factory accessories

4. Corvette Black Book (Price Guide)
   - Condition multipliers
   - Option values
   - Market trends
```

### Structured Judging Criteria

```sql
-- Create table for NCRS-style judging criteria
CREATE TABLE ncrs_judging_criteria (
  id UUID PRIMARY KEY,
  category TEXT,              -- exterior, interior, chassis, engine
  section TEXT,               -- paint, panel_fit, chrome, etc
  criterion TEXT,             -- specific thing being judged
  factory_spec TEXT,          -- what is factory correct
  tolerance TEXT,             -- acceptable variation
  deduction_minor INTEGER,    -- points for minor deviation
  deduction_major INTEGER,    -- points for major deviation
  reference_source TEXT,      -- which manual/book
  page_number TEXT,           -- specific page reference
  applies_to_years INTEGER[], -- which model years
  applies_to_models TEXT[]    -- which models
);

-- Example data
INSERT INTO ncrs_judging_criteria VALUES (
  uuid_generate_v4(),
  'exterior',
  'paint',
  'hood_to_fender_gap',
  '3/16 inch',
  '±1/16 inch',
  -3,
  -10,
  'NCRS Judging Guide 4th Edition',
  'page 47',
  ARRAY[1963, 1964, 1965, 1966, 1967],
  ARRAY['Corvette Sting Ray']
);
```

---

## Revised Processing Tiers

### Tier 1: Trivial Questions ($0.0001)
**Database Tables:**
- `vehicle_images.angle`
- `vehicle_images.category`
- `vehicle_images.primary_color`
- `vehicle_images.basic_condition`

**Questions:** Binary, multiple choice, visually obvious  
**Model:** gpt-4o-mini or free alternatives  
**Batch Size:** 100 images at once  
**All 2,741 images:** $0.27

### Tier 2: Simple Questions ($0.0002-0.001)
**Database Tables:**
- `image_tags` (basic parts)
- `vehicle_images.components_visible`
- `timeline_events.work_type`

**Questions:** Requires basic car knowledge  
**Model:** gpt-4o-mini  
**Batch Size:** 50 images  
**~2,000 images:** $0.40-2.00

### Tier 3: Moderate Questions ($0.005)
**Database Tables:**
- `part_identifications`
- `vehicle_modifications`
- `damage_assessments`
- `work_validation`

**Questions:** Specific parts, aftermarket detection  
**Model:** gpt-4o-mini with context  
**Batch Size:** 10 images  
**~1,500 images:** $7.50

### Tier 4: Expert Questions ($0.02)
**Database Tables:**
- `factory_correctness_assessment`
- `paint_quality_assessment`
- `ncrs_judging_deductions`
- `authenticity_scores`

**Questions:** Requires factory specs, NCRS standards  
**Model:** gpt-4o with full context + reference docs  
**Batch Size:** 3 images  
**~500 images:** $10.00

### Tier 5: Human Expert (Flag)
**Database Tables:**
- `ncrs_judging_scores` (final scores)
- `professional_appraisal_values`
- `authenticity_certifications`

**Questions:** Liability, requires certification  
**Model:** Human expert  
**Process:** Flag for manual review

---

## Implementation Strategy

1. **Digitize Professional Standards**
   - Scan NCRS Judging Guide
   - OCR and structure into database
   - Create lookup tables for correctness criteria

2. **Map Questions to Difficulty**
   - Catalog every database table by fill difficulty
   - Route easy tables to cheap models
   - Reserve expensive models for expert questions

3. **Progressive Enhancement**
   - Start with Tier 1+2 (99% of images, $2.67 total)
   - Add Tier 3 for specific vehicles (modified, damaged)
   - Use Tier 4 only for high-value assessments
   - Flag Tier 5 questions for human experts

4. **Validate Against Standards**
   - Test expert model answers against NCRS guides
   - Measure accuracy vs professional judges
   - Adjust confidence thresholds

---

## Cost Optimization

### Current Approach:
```
All images with GPT-4o = $54.82
```

### Resolution-Based Approach:
```
Tier 1+2+3 = $17.77 (67% savings)
```

### Question Difficulty Approach:
```
Tier 1 (trivial):  2,741 × $0.0001 = $0.27   (ALL images)
Tier 2 (simple):   2,000 × $0.001  = $2.00   (most images)
Tier 3 (moderate): 1,000 × $0.005  = $5.00   (decent images)
Tier 4 (expert):     200 × $0.02   = $4.00   (complex only)
                                    ────────
                              TOTAL: $11.27

SAVINGS: $43.55 (79% cheaper!)
```

**Better targeting = Better cost efficiency!**

This approach routes based on what you're asking, not just image quality. NCRS-style standards ensure professional-grade assessments where it matters.

