# Detection Phases & Required Tables

## Progressive Detection Strategy

Each phase builds on the previous, filling specific database tables.

---

## PHASE 1: ANGLES (Current - Running Now ✓)

**Question:** "What angle is this photo from?"  
**Difficulty:** TRIVIAL  
**Cost:** $0.00008/image  
**Model:** Claude Haiku

### Table Updated:
```sql
vehicle_images.angle TEXT
-- Values: front_3quarter_driver, rear_center, engine_bay, etc.
```

**Metric:** 84 / 2,742 complete (3.1%)  
**Status:** RUNNING NOW ✓

---

## PHASE 2: CATEGORIES (Next - After Angles)

**Question:** "Is this exterior, interior, engine, or undercarriage?"  
**Difficulty:** TRIVIAL  
**Cost:** $0.00008/image  
**Model:** Claude Haiku

### Table Updated:
```sql
vehicle_images.category TEXT
-- Values: exterior_body, interior, engine_mechanical, undercarriage, etc.
```

**Benefit:** Enables filtering images by type  
**Dependency:** None (can run with angles)

---

## PHASE 3: MAJOR COMPONENTS (Simple Detection)

**Question:** "What major body panels/components are visible?"  
**Difficulty:** SIMPLE  
**Cost:** $0.0001/image  
**Model:** Claude Haiku

### Table Updated:
```sql
vehicle_images.components_visible TEXT[]
-- Values: ['hood', 'door_driver', 'fender_front', 'wheel']
```

**Benefit:** Quick visual inventory  
**Dependency:** Category helps target the question

---

## PHASE 4: SPECIFIC PARTS (Moderate - Needs Context)

**Question:** "What specific parts can you identify?"  
**Difficulty:** MODERATE  
**Cost:** $0.0005/image (with context)  
**Model:** Claude Haiku with vehicle context

### New Table Needed:
```sql
CREATE TABLE part_identifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  image_id UUID REFERENCES vehicle_images(id),
  vehicle_id UUID REFERENCES vehicles(id),
  
  -- Part details
  part_name TEXT NOT NULL,
  part_type TEXT, -- 'body_panel', 'mechanical', 'trim', 'structural'
  location TEXT,  -- 'front_driver', 'engine_bay', etc.
  
  -- Identification details
  brand TEXT,
  part_number TEXT,
  is_aftermarket BOOLEAN,
  is_oem BOOLEAN,
  
  -- Condition
  condition TEXT, -- 'excellent', 'good', 'fair', 'poor', 'damaged'
  
  -- Confidence
  confidence INTEGER,
  identified_by_model TEXT,
  validated_by_receipt UUID REFERENCES receipts(id),
  
  -- Provenance
  context_score INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_part_ids_vehicle ON part_identifications(vehicle_id);
CREATE INDEX idx_part_ids_image ON part_identifications(image_id);
```

**Benefit:** Build parts catalog per vehicle  
**Dependency:** Works better with SPID data + receipts

---

## PHASE 5: DAMAGE ASSESSMENT (Moderate)

**Question:** "What damage, wear, or issues are visible?"  
**Difficulty:** MODERATE  
**Cost:** $0.0005/image  
**Model:** Claude Haiku

### New Table Needed:
```sql
CREATE TABLE damage_assessments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  image_id UUID REFERENCES vehicle_images(id),
  vehicle_id UUID REFERENCES vehicles(id),
  
  -- Damage details
  damage_type TEXT NOT NULL, -- 'rust', 'dent', 'scratch', 'crack', 'missing'
  severity TEXT, -- 'minor', 'moderate', 'severe', 'structural'
  location TEXT, -- Specific part affected
  description TEXT,
  
  -- Repair estimation
  repair_difficulty TEXT, -- 'easy', 'moderate', 'difficult', 'professional_required'
  estimated_repair_cost_min NUMERIC,
  estimated_repair_cost_max NUMERIC,
  
  -- Impact
  affects_safety BOOLEAN,
  affects_value BOOLEAN,
  affects_drivability BOOLEAN,
  
  -- Detection
  confidence INTEGER,
  detected_by_model TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_damage_vehicle ON damage_assessments(vehicle_id);
CREATE INDEX idx_damage_severity ON damage_assessments(severity);
```

**Benefit:** Maintenance alerts, value impact, repair estimates  
**Dependency:** Works on any image

---

## PHASE 6: MODIFICATIONS (Moderate to Hard)

**Question:** "What aftermarket/custom modifications are visible?"  
**Difficulty:** MODERATE (easy) to HARD (factory correctness)  
**Cost:** $0.0005-0.02/image (depends on context)  
**Model:** Claude Haiku (with context) or GPT-4o (for correctness)

### New Table Needed:
```sql
CREATE TABLE vehicle_modifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID REFERENCES vehicles(id),
  discovered_in_image UUID REFERENCES vehicle_images(id),
  
  -- Modification details
  modification_type TEXT, -- 'engine', 'suspension', 'cosmetic', 'interior', 'exhaust'
  component_modified TEXT, -- 'intake manifold', 'suspension lift', etc.
  description TEXT,
  
  -- Part details (if identifiable)
  brand TEXT,
  part_number TEXT,
  parts_involved TEXT[],
  
  -- Installation
  installation_quality TEXT, -- 'professional', 'quality_diy', 'amateur', 'concerning'
  appears_reversible BOOLEAN,
  
  -- Validation
  confirmed_by_receipt UUID REFERENCES receipts(id),
  confirmed_by_timeline UUID REFERENCES timeline_events(id),
  user_confirmed BOOLEAN DEFAULT false,
  
  -- Impact
  affects_value_positively BOOLEAN,
  affects_warranty BOOLEAN,
  factory_correctness_compliant BOOLEAN, -- For NCRS judging
  
  -- Detection
  confidence INTEGER,
  detected_by_model TEXT,
  context_score INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_mods_vehicle ON vehicle_modifications(vehicle_id);
CREATE INDEX idx_mods_type ON vehicle_modifications(modification_type);
```

**Benefit:** Modification catalog, value impact, authenticity tracking  
**Dependency:** MUCH better with SPID data (know what's factory)

---

## PHASE 7: WORK VALIDATION (Moderate - Needs Receipts)

**Question:** "Does visible work match documented receipts/timeline?"  
**Difficulty:** MODERATE  
**Cost:** $0.0001/image (just confirmation with context!)  
**Model:** Claude Haiku with receipts

### New Table Needed:
```sql
CREATE TABLE work_validations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID REFERENCES vehicles(id),
  image_id UUID REFERENCES vehicle_images(id),
  
  -- What's being validated
  receipt_id UUID REFERENCES receipts(id),
  timeline_event_id UUID REFERENCES timeline_events(id),
  
  -- Validation results
  visual_confirmation BOOLEAN,
  confidence INTEGER,
  
  -- Details
  parts_confirmed TEXT[], -- Which parts from receipt are visible
  work_stage TEXT, -- 'not_started', 'in_progress', 'completed'
  quality_assessment TEXT,
  notes TEXT,
  
  -- This is GOLD for authenticity
  builds_authenticity BOOLEAN DEFAULT true,
  validated_by_model TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_work_val_vehicle ON work_validations(vehicle_id);
CREATE INDEX idx_work_val_receipt ON work_validations(receipt_id);
```

**Benefit:** HUGE - Validates receipts with photos (authenticity!)  
**Dependency:** REQUIRES receipts to validate

---

## PHASE 8: PAINT QUALITY (Hard - Needs High-Res)

**Question:** "Is paint factory original or repainted? Quality?"  
**Difficulty:** HARD  
**Cost:** $0.015/image  
**Model:** GPT-4o or Claude Opus

### New Table Needed:
```sql
CREATE TABLE paint_assessments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID REFERENCES vehicles(id),
  image_id UUID REFERENCES vehicle_images(id),
  
  -- Paint analysis
  paint_originality TEXT, -- 'factory_original', 'quality_repaint', 'poor_repaint', 'partial_repaint'
  panels_assessed TEXT[],
  
  -- Quality metrics
  orange_peel_level TEXT, -- 'none', 'slight', 'moderate', 'heavy'
  clear_coat_condition TEXT,
  color_match_quality TEXT, -- 'perfect', 'good', 'fair', 'poor'
  
  -- Issues
  overspray_detected BOOLEAN,
  overspray_locations TEXT[],
  signs_of_bodywork TEXT[],
  fade_severity TEXT,
  
  -- NCRS judging (for Corvettes, etc.)
  ncrs_acceptable BOOLEAN,
  ncrs_deduction_points INTEGER,
  
  -- Requirements met
  image_resolution_sufficient BOOLEAN,
  lighting_adequate BOOLEAN,
  focus_sharp BOOLEAN,
  
  confidence INTEGER,
  assessed_by_model TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_paint_vehicle ON paint_assessments(vehicle_id);
```

**Benefit:** Professional appraisal data, NCRS judging  
**Dependency:** REQUIRES high-res images (>5MP)

---

## PHASE 9: FACTORY CORRECTNESS (Expert - Needs Documentation)

**Question:** "Does this match factory specifications?"  
**Difficulty:** EXPERT  
**Cost:** $0.02/image  
**Model:** GPT-4o with factory manuals

### New Table Needed:
```sql
CREATE TABLE factory_correctness_assessments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID REFERENCES vehicles(id),
  image_id UUID REFERENCES vehicle_images(id),
  
  -- What's being assessed
  component_name TEXT NOT NULL,
  component_type TEXT, -- 'part', 'finish', 'assembly', 'marking'
  
  -- Factory specs (from documentation)
  factory_spec TEXT,
  reference_source TEXT, -- Which manual/document
  reference_page TEXT,
  
  -- Assessment
  is_factory_correct BOOLEAN,
  deviation_notes TEXT,
  
  -- NCRS judging
  ncrs_acceptable BOOLEAN,
  deduction_points INTEGER,
  deduction_reason TEXT,
  
  -- Verification
  confidence INTEGER,
  requires_human_verification BOOLEAN,
  assessed_by_model TEXT,
  
  -- Context used
  had_factory_manual BOOLEAN,
  had_spid_data BOOLEAN,
  had_build_sheet BOOLEAN,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_correctness_vehicle ON factory_correctness_assessments(vehicle_id);
CREATE INDEX idx_correctness_ncrs ON factory_correctness_assessments(ncrs_acceptable);
```

**Benefit:** NCRS judging, authenticity certification  
**Dependency:** REQUIRES factory manuals, SPID data, build sheets

---

## PHASE 10: MAINTENANCE ALERTS (Easy from Damage Data)

**Question:** "What maintenance is needed?"  
**Difficulty:** SIMPLE (derived from damage assessments)  
**Cost:** $0 (just queries existing data)

### New Table Needed:
```sql
CREATE TABLE maintenance_alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID REFERENCES vehicles(id),
  discovered_in_image UUID REFERENCES vehicle_images(id),
  based_on_damage UUID REFERENCES damage_assessments(id),
  
  -- Alert details
  alert_type TEXT, -- 'fluid_leak', 'worn_tires', 'rust', 'brake_wear'
  severity TEXT, -- 'low', 'medium', 'high', 'critical'
  description TEXT,
  
  -- Recommendation
  recommended_action TEXT,
  estimated_cost_min NUMERIC,
  estimated_cost_max NUMERIC,
  urgency TEXT, -- 'immediate', 'soon', 'monitor', 'optional'
  
  -- Tracking
  acknowledged BOOLEAN DEFAULT false,
  addressed BOOLEAN DEFAULT false,
  addressed_in_event UUID REFERENCES timeline_events(id),
  addressed_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_alerts_vehicle ON maintenance_alerts(vehicle_id);
CREATE INDEX idx_alerts_unaddressed ON maintenance_alerts(addressed) WHERE addressed = false;
```

**Benefit:** Proactive maintenance recommendations  
**Dependency:** Requires damage assessments (Phase 5)

---

## Recommended Execution Order

### Week 1: Foundation (Trivial Questions)
```
Day 1: ✓ Angles          → vehicle_images.angle
Day 2: □ Categories      → vehicle_images.category  
Day 3: □ Components      → vehicle_images.components_visible
```
**Cost:** ~$0.60 total  
**Tables Filled:** 3 fields in vehicle_images

### Week 2: Parts Catalog (With Context)
```
Day 4-5: □ Specific Parts → part_identifications table (NEW)
```
**Cost:** ~$1.40 (with good context)  
**Tables Filled:** +1 table (thousands of rows)

### Week 3: Condition Assessment
```
Day 6-7: □ Damage Assessment → damage_assessments table (NEW)
Day 8: □ Maintenance Alerts → maintenance_alerts table (NEW)
```
**Cost:** ~$2.50  
**Tables Filled:** +2 tables

### Week 4: Modifications & Validation
```
Day 9-10: □ Modifications → vehicle_modifications table (NEW)
Day 11: □ Work Validation → work_validations table (NEW)
```
**Cost:** ~$3.00  
**Tables Filled:** +2 tables  
**Value:** HIGH (authenticity validation!)

### Month 2: Expert Analysis (Selective)
```
Week 5: □ Paint Quality → paint_assessments table (NEW)
        Only high-res images (~500 images)
        
Week 6: □ Factory Correctness → factory_correctness_assessments (NEW)
        Only vehicles with documentation
```
**Cost:** ~$15.00  
**Tables Filled:** +2 tables  
**Value:** EXTREME (professional appraisal grade)

---

## Table Creation SQL

### Immediate (For Phases 4-6):

```sql
-- Phase 4: Parts
CREATE TABLE part_identifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  image_id UUID REFERENCES vehicle_images(id) ON DELETE CASCADE,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  part_name TEXT NOT NULL,
  part_type TEXT,
  brand TEXT,
  part_number TEXT,
  is_aftermarket BOOLEAN,
  condition TEXT,
  confidence INTEGER,
  identified_by_model TEXT,
  context_score INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 5: Damage
CREATE TABLE damage_assessments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  image_id UUID REFERENCES vehicle_images(id) ON DELETE CASCADE,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  damage_type TEXT NOT NULL,
  severity TEXT,
  location TEXT,
  description TEXT,
  affects_safety BOOLEAN,
  affects_value BOOLEAN,
  estimated_repair_cost_min NUMERIC,
  estimated_repair_cost_max NUMERIC,
  confidence INTEGER,
  detected_by_model TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 6: Modifications  
CREATE TABLE vehicle_modifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  discovered_in_image UUID REFERENCES vehicle_images(id),
  modification_type TEXT,
  description TEXT,
  brand TEXT,
  part_number TEXT,
  installation_quality TEXT,
  affects_value_positively BOOLEAN,
  confirmed_by_receipt UUID REFERENCES receipts(id),
  confidence INTEGER,
  detected_by_model TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 6b: Work Validation
CREATE TABLE work_validations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  image_id UUID REFERENCES vehicle_images(id),
  receipt_id UUID REFERENCES receipts(id),
  timeline_event_id UUID REFERENCES timeline_events(id),
  visual_confirmation BOOLEAN,
  parts_confirmed TEXT[],
  confidence INTEGER,
  builds_authenticity BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 10: Maintenance Alerts
CREATE TABLE maintenance_alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  discovered_in_image UUID REFERENCES vehicle_images(id),
  based_on_damage UUID REFERENCES damage_assessments(id),
  alert_type TEXT,
  severity TEXT,
  description TEXT,
  recommended_action TEXT,
  estimated_cost_min NUMERIC,
  estimated_cost_max NUMERIC,
  addressed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Cost & Value Analysis

### Total Cost to Fill All Tables:
```
Phase 1 (Angles):         2,742 × $0.00008 = $0.22   ✓ Running
Phase 2 (Categories):     2,742 × $0.00008 = $0.22
Phase 3 (Components):     2,742 × $0.0001  = $0.27
Phase 4 (Parts):          2,000 × $0.0005  = $1.00   (context-dependent)
Phase 5 (Damage):         2,742 × $0.0005  = $1.37
Phase 6 (Modifications):  1,500 × $0.001   = $1.50   (only modified vehicles)
Phase 6b (Work Validation): 500 × $0.0001  = $0.05   (only with receipts)
Phase 8 (Paint):            500 × $0.015   = $7.50   (high-res only)
Phase 9 (Correctness):      200 × $0.02    = $4.00   (with manuals only)
                                            ───────
                                    TOTAL: $16.13
```

**vs Original Plan:** $54.82 (all GPT-4o)  
**Savings:** $38.69 (71% cheaper!)

### Tables Created:
- ✅ vehicle_images (enhanced with 3 new fields)
- ✅ image_question_answers (provenance tracking)
- ✅ missing_context_reports (gap identification)
- ⏳ part_identifications (thousands of rows expected)
- ⏳ damage_assessments (hundreds of rows)
- ⏳ vehicle_modifications (moderate rows)
- ⏳ work_validations (high value!)
- ⏳ maintenance_alerts (actionable!)
- ⏳ paint_assessments (selective, expert)
- ⏳ factory_correctness_assessments (selective, expert)

**Total New Tables:** 9  
**Total New Data Points:** 20,000+ rows across all tables

---

## Value Delivered Per Phase

**Phases 1-3 (Foundation):** Basic organization, searchable  
**Phases 4-5 (Inventory):** Parts catalog, condition tracking  
**Phase 6 (Validation):** Receipt confirmation = AUTHENTICITY  
**Phases 8-9 (Expert):** Professional appraisal grade data  
**Phase 10 (Alerts):** Proactive maintenance = USER VALUE

---

## Immediate Next Steps

1. ✅ **Finish Phase 1** (Angles) - Running now, 84/2,742 done
2. **Create tables for Phases 4-6** - Run migration
3. **Start Phase 2** (Categories) - When angles done
4. **Progress through phases** - One per day/week

Want me to:
- A) Create the migration for all new tables now
- B) Wait until angles complete, then do Phase 2
- C) Both - create tables AND continue processing

Which approach?

