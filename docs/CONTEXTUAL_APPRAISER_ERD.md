# Contextual Appraiser System - ERD & Architecture

## Core Principle

**Every vehicle is unique. Every image tells a specific story. Questions must be precise.**

We're building a **Digital Appraiser Brain** that:
1. Knows what vehicle it's looking at (year/make/model/specs)
2. Knows what work has been done (receipts, timeline)
3. Knows what documentation exists (manuals, brochures, order books)
4. Asks ONLY relevant questions that help fill database tables or justify new ones

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CONTEXTUAL APPRAISER BRAIN                      │
│                                                                         │
│  Input: Image + Vehicle ID                                             │
│  Output: Structured Data → Database Tables                             │
│  Process: Context Assembly → Question Generation → LLM Analysis        │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Data Sources ERD

### Primary Entity: Vehicle
```
┌─────────────────────────────────────────────────────────┐
│ VEHICLES                                                │
├─────────────────────────────────────────────────────────┤
│ • id (PK)                                               │
│ • year ──────────────────────┐                         │
│ • make ──────────────────────┤ CORE IDENTIFIERS        │
│ • model ─────────────────────┤ (Question Foundation)   │
│ • trim ──────────────────────┘                         │
│ • engine                                                │
│ • transmission                                          │
│ • mileage                                               │
│ • vin                                                   │
│ • known_issues [] ───── Used to ask targeted questions │
│ • owner_id (FK)                                         │
└─────────────────────────────────────────────────────────┘
                    │
                    │ ONE-TO-MANY
                    ↓
```

### Context Sources (Enrich Questions)

```
┌──────────────────────────────┐  ┌──────────────────────────────┐
│ TIMELINE_EVENTS              │  │ RECEIPTS                     │
├──────────────────────────────┤  ├──────────────────────────────┤
│ • vehicle_id (FK)            │  │ • vehicle_id (FK)            │
│ • event_type                 │  │ • vendor_name                │
│ • event_date                 │  │ • purchase_date              │
│ • description                │  │ • items []                   │
│ • parts_involved []          │  │   - description              │
│ • labor_hours                │  │   - part_number              │
│ • cost                       │  │   - quantity                 │
│                              │  │ • total_amount               │
│ USE: "Recent work done?"     │  │                              │
│      "Known modifications?"  │  │ USE: "Do visible parts       │
│      "Maintenance history?"  │  │       match receipts?"       │
└──────────────────────────────┘  └──────────────────────────────┘

┌──────────────────────────────┐  ┌──────────────────────────────┐
│ VEHICLE_SPID_DATA            │  │ REFERENCE_DOCUMENTS          │
├──────────────────────────────┤  ├──────────────────────────────┤
│ • vehicle_id (FK)            │  │ • id (PK)                    │
│ • vin                        │  │ • vehicle_id (FK)            │
│ • build_date                 │  │ • doc_type                   │
│ • rpo_codes []               │  │   - brochure                 │
│ • engine_code                │  │   - dealer_order_book        │
│ • transmission_code          │  │   - service_manual           │
│ • factory_options []         │  │   - rebuild_manual           │
│                              │  │ • content (extracted text)   │
│ USE: "Factory specs match?"  │  │ • pages_data []              │
│      "RPO codes visible?"    │  │                              │
│      "Original equipment?"   │  │ USE: "Match documented       │
└──────────────────────────────┘  │       specs?"                │
                                   │      "Verify part numbers?" │
                                   └──────────────────────────────┘

┌──────────────────────────────┐
│ VEHICLE_IMAGES               │
├──────────────────────────────┤
│ • vehicle_id (FK)            │
│ • category (determines Q's)  │
│ • ai_scan_metadata           │
│   - previous_analysis        │
│   - rekognition_labels       │
│ • taken_at (timeline context)│
│                              │
│ USE: "What changed since     │
│       last analysis?"        │
│      "Timeline progression?" │
└──────────────────────────────┘
```

---

## Context Assembly Process

```
STEP 1: LOAD VEHICLE CONTEXT
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  Vehicle ID → Query ALL Related Data                           │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  1. Basic Info (year/make/model/engine/trim)            │  │
│  │  2. Owner Info (location affects rust questions)        │  │
│  │  3. SPID Data (factory specs for comparison)            │  │
│  │  4. Timeline Events (last 50, prioritize recent)        │  │
│  │  5. Receipts (last 50, extract parts list)              │  │
│  │  6. Reference Docs (manuals, brochures for this model)  │  │
│  │  7. Known Modifications (from timeline analysis)        │  │
│  │  8. Known Issues (from vehicle record)                  │  │
│  │  9. Recent Work (last 6 months for validation)          │  │
│  │  10. Previous Image Analyses (for progression)          │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Result: VEHICLE_CONTEXT object (loaded ONCE per vehicle)      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Question Generation Logic

### Level 1: Vehicle-Wide Context (Loaded Once)

```
┌─────────────────────────────────────────────────────────────────────┐
│ VEHICLE PREAMBLE (Applies to ALL images for this vehicle)          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  "You are analyzing a 1985 Chevrolet K5 Blazer [trim] with         │
│   [engine] engine and [transmission] transmission."                │
│                                                                     │
│  IF known_modifications.length > 0:                                │
│    "Known modifications: [list top 5]"                             │
│                                                                     │
│  IF recent_work.length > 0:                                        │
│    "Recent work completed: [list last 3]"                          │
│                                                                     │
│  IF owner.location:                                                │
│    "Vehicle located in [location] (affects rust/climate)"          │
│                                                                     │
│  IF spid_data.rpo_codes:                                           │
│    "Factory options: [RPO codes]"                                  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Level 2: Image-Specific Context

```
STEP 2A: DETERMINE IMAGE TYPE (Rekognition + Labels)
┌───────────────────────────────────────────────────────────┐
│                                                           │
│  Rekognition Labels → Image Type Classification          │
│                                                           │
│  Labels: [engine, motor, radiator]                       │
│    → IMAGE_TYPE: "engine_bay"                            │
│                                                           │
│  Labels: [seat, dashboard, steering]                     │
│    → IMAGE_TYPE: "interior"                              │
│                                                           │
│  Labels: [undercarriage, suspension, frame]              │
│    → IMAGE_TYPE: "undercarriage"                         │
│                                                           │
│  Labels: [tool, wrench, parts]                           │
│    → IMAGE_TYPE: "work_in_progress"                      │
│                                                           │
│  Labels: [document, paper, text]                         │
│    → IMAGE_TYPE: "documentation"                         │
│                                                           │
└───────────────────────────────────────────────────────────┘

STEP 2B: GENERATE TYPE-SPECIFIC QUESTIONS
```

---

## Questionnaire Templates (Context-Aware)

### Example 1: Engine Bay Questionnaire

```
┌─────────────────────────────────────────────────────────────────────┐
│ ENGINE BAY ANALYSIS - 1985 Chevrolet K5 Blazer                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│ CONTEXT CHECKS:                                                     │
│                                                                     │
│ ✓ Has known engine modifications: ["Edelbrock intake", "Headers"]  │
│ ✓ Recent work: "Timing chain replaced - 2 months ago"              │
│ ✓ Factory engine: L31 350ci V8 (from SPID)                         │
│                                                                     │
│ GENERATED QUESTIONS (Context-Aware):                                │
│                                                                     │
│ 1. visible_modifications:                                           │
│    "List visible engine modifications. We know this has:            │
│     - Edelbrock intake manifold                                    │
│     - Aftermarket headers                                          │
│    Can you confirm these and identify any others?"                 │
│    [Instead of: "Does engine appear stock?"]                       │
│                                                                     │
│ 2. recent_work_validation:                                          │
│    "Owner reports timing chain replacement 2 months ago.           │
│     Any signs of recent work on timing cover area?                 │
│     (fresh gaskets, clean surfaces, new bolts)"                    │
│    [Validates receipts against visual evidence]                    │
│                                                                     │
│ 3. cleanliness:                                                     │
│    "Rate engine bay cleanliness for a 40-year-old truck           │
│     (pristine/clean/average/dirty/neglected)"                      │
│    [Age-appropriate assessment]                                    │
│                                                                     │
│ 4. wiring_condition:                                                │
│    "Factory L31 350ci typically has [specific wiring layout].      │
│     Describe any deviations or modifications."                     │
│    [Uses factory specs from manuals]                               │
│                                                                     │
│ 5. part_verification:                                               │
│    "Recent receipts show:                                          │
│     - AC Delco timing chain (#12345678)                            │
│     - Fel-Pro timing cover gasket                                  │
│    Can you see evidence of these specific parts?"                  │
│    [Links receipts to visual confirmation]                         │
│                                                                     │
│ DATABASE TARGETS:                                                   │
│ → timeline_events (validate work_performed)                         │
│ → vehicle_modifications (catalog aftermarket parts)                 │
│ → maintenance_items (condition checks)                              │
│ → part_identifications (visible part numbers)                       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Example 2: Work-In-Progress Questionnaire

```
┌─────────────────────────────────────────────────────────────────────┐
│ WORK IN PROGRESS - 1985 Chevrolet K5 Blazer                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│ CONTEXT CHECKS:                                                     │
│                                                                     │
│ ✓ Recent timeline event: "Brake system overhaul - ongoing"         │
│ ✓ Recent receipt: AutoZone - brake pads, rotors, calipers          │
│ ✓ Image taken: 2 days after receipt date                           │
│                                                                     │
│ GENERATED QUESTIONS (Context-Aware):                                │
│                                                                     │
│ 1. work_validation:                                                 │
│    "This appears to be brake work. Timeline shows ongoing          │
│     brake system overhaul. Can you confirm:                        │
│     - Is this front or rear brake work?                            │
│     - Do parts visible match receipt: [AutoZone brake kit]?"       │
│    [Validates timeline + receipts]                                 │
│                                                                     │
│ 2. parts_identification:                                            │
│    "Receipt lists:                                                 │
│     - Wagner ThermoQuiet brake pads                                │
│     - Duralast rotors                                              │
│     - Loaded calipers                                              │
│    Can you identify which of these are visible in image?"          │
│    [Cross-reference receipts with visual]                          │
│                                                                     │
│ 3. work_quality_assessment:                                         │
│    "Based on tools and setup visible:                              │
│     - Professional shop or DIY?                                    │
│     - Proper torque tools present?                                 │
│     - Safety stands/proper lift?"                                  │
│    [Quality assessment for database]                               │
│                                                                     │
│ 4. progress_estimation:                                             │
│    "For complete brake overhaul on 1985 K5:                        │
│     - What stage is this work at?                                  │
│     - What are next steps?                                         │
│     - Estimated completion time?"                                  │
│    [Timeline progression tracking]                                 │
│                                                                     │
│ DATABASE TARGETS:                                                   │
│ → timeline_events.progress_photos []                                │
│ → work_sessions (link images to work events)                        │
│ → parts_used (validate receipt items)                               │
│ → labor_tracking (estimate hours)                                   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow: Image → Analysis → Database

```
┌─────────────────────────────────────────────────────────────────────┐
│                    CONTEXTUAL ANALYSIS PIPELINE                      │
└─────────────────────────────────────────────────────────────────────┘

INPUT: Image + Vehicle ID
  │
  ↓
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 1: LOAD VEHICLE CONTEXT (Cached per vehicle)                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Query in parallel:                                                 │
│  ├─ vehicles table (basic info)                                    │
│  ├─ profiles table (owner context)                                 │
│  ├─ vehicle_spid_data (factory specs)                              │
│  ├─ timeline_events (work history)                                 │
│  ├─ receipts (parts purchased)                                     │
│  ├─ reference_documents (manuals, brochures)                       │
│  └─ vehicle_images (previous analyses)                             │
│                                                                     │
│  Build: VehicleContext object                                      │
│  Cache: For all images from this vehicle (token efficiency)        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
  │
  ↓
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 2: CLASSIFY IMAGE                                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Run: AWS Rekognition DetectLabels                                 │
│  Identify: Image type from labels                                  │
│  Result: "engine_bay" | "interior" | "undercarriage" | etc.       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
  │
  ↓
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 3: GENERATE CONTEXTUAL QUESTIONNAIRE                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  function createContextualQuestionnaire(                            │
│    context: VehicleContext,                                        │
│    imageType: string,                                              │
│    rekognitionData: any                                            │
│  ): string                                                          │
│                                                                     │
│  1. Build vehicle preamble:                                        │
│     "Analyzing [year make model] with [specs]..."                  │
│                                                                     │
│  2. Add known context:                                             │
│     IF modifications exist → mention them                          │
│     IF recent work → mention it                                    │
│     IF receipts match date → ask validation questions              │
│                                                                     │
│  3. Select questionnaire template:                                 │
│     switch (imageType) {                                           │
│       case 'engine_bay':                                           │
│         return createEngineBayQuestionnaire(context)               │
│       case 'interior':                                             │
│         return createInteriorQuestionnaire(context)                │
│       // ... etc                                                   │
│     }                                                               │
│                                                                     │
│  4. Inject context-specific questions:                             │
│     - Reference factory specs from SPID                            │
│     - Reference recent work from timeline                          │
│     - Reference parts from receipts                                │
│     - Reference documented mods                                    │
│                                                                     │
│  Result: Precise, targeted questionnaire (saves tokens!)           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
  │
  ↓
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 4: RUN LLM ANALYSIS (GPT-4o with context)                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  System Prompt:                                                    │
│  "You are an expert appraiser with deep knowledge of               │
│   [year make model] vehicles. Provide precise, factual             │
│   assessments based on what you see."                              │
│                                                                     │
│  User Prompt:                                                      │
│  [Vehicle Preamble]                                                │
│  [Contextual Questionnaire]                                        │
│  [Image with high detail]                                          │
│                                                                     │
│  Model: gpt-4o (vision + context understanding)                    │
│  Max Tokens: 1500                                                  │
│  Format: JSON object (structured response)                         │
│                                                                     │
│  Result: Structured analysis answering specific questions          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
  │
  ↓
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 5: EXTRACT INSIGHTS                                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Analyze LLM response for:                                         │
│                                                                     │
│  1. Maintenance Needed                                             │
│     - Fluid leaks detected                                         │
│     - Worn tires                                                   │
│     - Rust concerns                                                │
│                                                                     │
│  2. Modifications Detected                                         │
│     - Aftermarket parts identified                                 │
│     - Cross-reference with known mods                              │
│     - New discoveries                                              │
│                                                                     │
│  3. Condition Concerns                                             │
│     - Age-inappropriate wear                                       │
│     - Damage or deterioration                                      │
│     - Safety issues                                                │
│                                                                     │
│  4. Positive Indicators                                            │
│     - Well-maintained                                              │
│     - Recent maintenance evident                                   │
│     - Quality workmanship                                          │
│                                                                     │
│  5. Work Validation                                                │
│     - Visual confirmation of receipts                              │
│     - Timeline event validation                                    │
│     - Part number matches                                          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
  │
  ↓
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 6: POPULATE DATABASE TABLES                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Update: vehicle_images.ai_scan_metadata                           │
│  {                                                                  │
│    rekognition: { ... },                                           │
│    contextual_analysis: { ... },  ← LLM structured response        │
│    insights: { ... },              ← Extracted insights            │
│    context_used: {                                                 │
│      year, make, model,                                            │
│      work_history_count,                                           │
│      receipts_count,                                               │
│      known_mods_count                                              │
│    },                                                               │
│    questionnaire_type: "engine_bay",                               │
│    scanned_at: timestamp                                           │
│  }                                                                  │
│                                                                     │
│  Insert: image_tags                                                │
│  - Rekognition labels (high confidence)                            │
│  - Contextual tags (from analysis)                                 │
│  - Modification tags (cross-referenced)                            │
│  - Condition tags (age-appropriate)                                │
│                                                                     │
│  Potential New Tables (justified by analysis):                     │
│  - vehicle_modifications (if new mods detected)                    │
│  - maintenance_alerts (if issues found)                            │
│  - work_validation (receipt → visual confirmation)                 │
│  - part_identifications (visible part numbers)                     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
  │
  ↓
OUTPUT: Enriched database + Actionable insights
```

---

## Feedback Loop: New Documentation → Better Questions

```
┌─────────────────────────────────────────────────────────────────────┐
│           CONTINUOUS CONTEXT ENRICHMENT CYCLE                       │
└─────────────────────────────────────────────────────────────────────┘

SCENARIO: New receipt added after initial image processing

1. INITIAL ANALYSIS (No Receipt)
   ┌──────────────────────────────────────────────────┐
   │ Question: "What work is being performed?"        │
   │ Answer: "Appears to be brake work"               │
   │                                                  │
   │ Result: Generic identification                   │
   └──────────────────────────────────────────────────┘

2. RECEIPT ADDED
   ┌──────────────────────────────────────────────────┐
   │ New Data: AutoZone receipt                       │
   │ - Wagner ThermoQuiet pads                        │
   │ - Duralast rotors                                │
   │ - Loaded calipers                                │
   │ Date: Matches image timeline                     │
   └──────────────────────────────────────────────────┘

3. TRIGGER: Reprocess with new context
   ```bash
   node scripts/contextual-batch-processor.js \
     --reprocess \
     --vehicle=<id>
   ```

4. REANALYSIS (With Receipt)
   ┌──────────────────────────────────────────────────┐
   │ Question: "Receipt shows Wagner ThermoQuiet      │
   │ brake pads purchased. Can you identify these     │
   │ specific parts in the image?"                    │
   │                                                  │
   │ Answer: "Yes, Wagner ThermoQuiet box visible     │
   │ in background, Duralast rotor packaging on       │
   │ workbench"                                       │
   │                                                  │
   │ Result: VALIDATED receipt → Confidence +100%    │
   └──────────────────────────────────────────────────┘

5. DATABASE UPDATE
   ┌──────────────────────────────────────────────────┐
   │ timeline_events:                                 │
   │   validated: true ✓                              │
   │   visual_confirmation: image_id                  │
   │                                                  │
   │ receipts:                                        │
   │   verified_in_images: [image_id]                │
   │                                                  │
   │ vehicle:                                         │
   │   authenticity_score: +10 points                │
   └──────────────────────────────────────────────────┘

KEY INSIGHT: More documentation = More precise questions = Better data
```

---

## Question Generation Decision Tree

```
                        ┌─────────────────┐
                        │  Load Vehicle   │
                        │    Context      │
                        └────────┬────────┘
                                 │
                                 ↓
                    ┌────────────────────────┐
                    │  Has Factory Specs?    │
                    │  (SPID, Manual)        │
                    └────┬──────────────┬────┘
                         │              │
                    YES  │              │  NO
                         ↓              ↓
              ┌──────────────────┐  ┌──────────────────┐
              │ Ask: "Matches    │  │ Ask: "What can   │
              │ factory spec     │  │ you identify     │
              │ [specific]?"     │  │ about this?"     │
              └──────────────────┘  └──────────────────┘
                         │
                         ↓
                    ┌────────────────────────┐
                    │  Has Known Mods?       │
                    └────┬──────────────┬────┘
                         │              │
                    YES  │              │  NO
                         ↓              ↓
              ┌──────────────────┐  ┌──────────────────┐
              │ Ask: "Can you    │  │ Ask: "Appears    │
              │ confirm [mod]    │  │ stock?"          │
              │ and find others?"│  │                  │
              └──────────────────┘  └──────────────────┘
                         │
                         ↓
                    ┌────────────────────────┐
                    │  Has Recent Work?      │
                    └────┬──────────────┬────┘
                         │              │
                    YES  │              │  NO
                         ↓              ↓
              ┌──────────────────┐  ┌──────────────────┐
              │ Ask: "Evidence   │  │ Skip validation  │
              │ of [work done]   │  │ questions        │
              │ visible?"        │  │                  │
              └──────────────────┘  └──────────────────┘
                         │
                         ↓
                    ┌────────────────────────┐
                    │  Has Receipts?         │
                    │  (matching date)       │
                    └────┬──────────────┬────┘
                         │              │
                    YES  │              │  NO
                         ↓              ↓
              ┌──────────────────┐  ┌──────────────────┐
              │ Ask: "Can you    │  │ Ask: "What       │
              │ identify parts   │  │ parts are        │
              │ from receipt:    │  │ visible?"        │
              │ [list]?"         │  │                  │
              └──────────────────┘  └──────────────────┘
                         │
                         ↓
                    ┌────────────────────────┐
                    │  Has Reference Docs?   │
                    │  (Manual for this      │
                    │   year/model)          │
                    └────┬──────────────┬────┘
                         │              │
                    YES  │              │  NO
                         ↓              ↓
              ┌──────────────────┐  ┌──────────────────┐
              │ Ask: "Page 47    │  │ Ask generic      │
              │ shows [config].  │  │ questions        │
              │ Match?"          │  │                  │
              └──────────────────┘  └──────────────────┘
                         │
                         ↓
                ┌────────────────────┐
                │   FINAL TARGETED   │
                │   QUESTIONNAIRE    │
                └────────────────────┘
```

---

## Database Tables Enriched by Analysis

### Existing Tables (Filled)

```
┌─────────────────────────────────────────────────────────────────────┐
│ VEHICLE_IMAGES                                                      │
├─────────────────────────────────────────────────────────────────────┤
│ ai_scan_metadata: {                                                 │
│   rekognition: { labels, confidence, bounding_boxes },             │
│   contextual_analysis: {                                            │
│     visible_modifications: [],     ← From targeted questions       │
│     part_identifications: [],      ← Cross-referenced w/ receipts  │
│     condition_assessment: {},      ← Age-appropriate for vehicle   │
│     work_validation: {},           ← Confirms timeline events      │
│     maintenance_indicators: []     ← Justifies maintenance_alerts  │
│   },                                                                │
│   insights: {                                                       │
│     maintenance_needed: [],        ← Triggers work recommendations │
│     modifications_detected: [],    ← Updates vehicle_modifications │
│     condition_concerns: [],        ← Affects vehicle valuation     │
│     value_impacting_items: []      ← Price intelligence data       │
│   }                                                                 │
│ }                                                                   │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ IMAGE_TAGS                                                          │
├─────────────────────────────────────────────────────────────────────┤
│ • tag_name                ← From contextual analysis                │
│ • tag_type                ← Categorized by context                  │
│ • confidence              ← Higher with context                     │
│ • ai_detection_data       ← Includes source (context/rekognition)  │
│ • verified                ← Auto-verified if matches receipts       │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ TIMELINE_EVENTS                                                     │
├─────────────────────────────────────────────────────────────────────┤
│ • visual_confirmation     ← Image ID that validates this event      │
│ • validation_confidence   ← How certain we are (receipt + image)    │
│ • progress_photos         ← Images showing work progression         │
└─────────────────────────────────────────────────────────────────────┘
```

### New Tables Justified by Analysis

```
┌─────────────────────────────────────────────────────────────────────┐
│ VEHICLE_MODIFICATIONS (Discovered through contextual analysis)     │
├─────────────────────────────────────────────────────────────────────┤
│ • vehicle_id                                                        │
│ • modification_type        (engine, suspension, cosmetic, etc.)    │
│ • description              (from LLM analysis)                      │
│ • parts_involved           (identified visually + from receipts)   │
│ • installation_date        (from timeline if available)            │
│ • discovery_source         (image_id that detected it)             │
│ • verified_by_receipt      (receipt_id if matches)                 │
│                                                                     │
│ POPULATED BY: Contextual analysis detecting aftermarket parts      │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ WORK_VALIDATION (Receipt → Visual Confirmation)                    │
├─────────────────────────────────────────────────────────────────────┤
│ • receipt_id                                                        │
│ • image_id                                                          │
│ • parts_confirmed          (which parts from receipt are visible)  │
│ • confidence_score         (how certain the match is)              │
│ • validation_notes         (LLM observations)                       │
│ • creates_authenticity     (true/false - boosts vehicle trust)     │
│                                                                     │
│ POPULATED BY: LLM comparing receipt parts to image contents        │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ PART_IDENTIFICATIONS (Visible part numbers, brands)                │
├─────────────────────────────────────────────────────────────────────┤
│ • vehicle_id                                                        │
│ • image_id                                                          │
│ • part_type                (brake pad, rotor, spark plug, etc.)    │
│ • brand                    (Wagner, Edelbrock, etc.)               │
│ • part_number              (if visible in image)                    │
│ • location_in_vehicle      (front left, rear, engine bay, etc.)    │
│ • condition                (new, used, worn)                        │
│ • matches_receipt          (receipt_id if applicable)              │
│                                                                     │
│ POPULATED BY: LLM identifying visible part numbers and brands      │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ MAINTENANCE_ALERTS (Issues discovered in analysis)                 │
├─────────────────────────────────────────────────────────────────────┤
│ • vehicle_id                                                        │
│ • discovered_in_image                                               │
│ • alert_type               (fluid_leak, worn_tires, rust, etc.)    │
│ • severity                 (low, medium, high, critical)            │
│ • description              (specific findings from LLM)             │
│ • estimated_cost           (if known from similar repairs)          │
│ • addressed                (false until work done)                  │
│ • addressed_by_event       (timeline_event_id when fixed)          │
│                                                                     │
│ POPULATED BY: LLM identifying issues requiring attention           │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ CONDITION_PROGRESSION (Track changes over time)                    │
├─────────────────────────────────────────────────────────────────────┤
│ • vehicle_id                                                        │
│ • component_type           (paint, interior, engine, etc.)         │
│ • assessment_date                                                   │
│ • condition_rating         (1-10 scale)                             │
│ • image_id                 (source of assessment)                   │
│ • previous_rating          (from earlier image)                     │
│ • trend                    (improving, stable, declining)           │
│ • factors                  (what's causing changes)                 │
│                                                                     │
│ POPULATED BY: LLM comparing current vs previous analyses           │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Token Optimization Strategy

```
┌─────────────────────────────────────────────────────────────────────┐
│                   TOKEN EFFICIENCY TACTICS                          │
└─────────────────────────────────────────────────────────────────────┘

1. CONTEXT LOADED ONCE PER VEHICLE
   ───────────────────────────────────────────────────────────────────
   Instead of:
     Image 1: Load context (200 tokens)
     Image 2: Load context (200 tokens)
     Image 3: Load context (200 tokens)
     = 600 tokens for 3 images
   
   We do:
     Vehicle: Load context (200 tokens) - CACHED
     Image 1: Reference cached context
     Image 2: Reference cached context  
     Image 3: Reference cached context
     = 200 tokens for 3 images
   
   Savings: 66% on context loading!

2. SPECIFIC vs VAGUE QUESTIONS
   ───────────────────────────────────────────────────────────────────
   Vague (wastes tokens):
     "Describe everything you see in the engine bay"
     LLM Response: 800 tokens of generic observations
   
   Specific (efficient):
     "Do you see the Edelbrock intake listed in modifications?"
     LLM Response: "Yes, visible. Part #2701" = 20 tokens
   
   Savings: 97% on irrelevant details!

3. BINARY vs OPEN-ENDED WHEN POSSIBLE
   ───────────────────────────────────────────────────────────────────
   Open-ended:
     "What is the condition of the interior?"
     LLM: Long description (300 tokens)
   
   Binary with context:
     "Owner reports excellent interior. Confirm? (yes/no/concerns)"
     LLM: "Yes, confirmed" or "No, see seat tear" (10 tokens)
   
   Savings: 96% when context is strong!

4. REFERENCE DOCUMENTS BY ID
   ───────────────────────────────────────────────────────────────────
   Bad:
     "Check if this matches typical 1985 K5 Blazer configuration..."
     [Send entire manual page in prompt] = 2000 tokens
   
   Good:
     "Factory manual (stored) shows RPO codes: KC4, G80.
      Visible in image?"
     = 30 tokens
   
   Savings: 98% by pre-processing documents!
```

---

## Complete System Summary

```
┌─────────────────────────────────────────────────────────────────────┐
│              DIGITAL APPRAISER BRAIN - ARCHITECTURE                 │
└─────────────────────────────────────────────────────────────────────┘

PURPOSE:
  Transform images into structured database entries by asking
  precise, context-aware questions that extract maximum value
  while minimizing token usage.

INPUTS:
  1. Images (visual data)
  2. Vehicle specs (factory baseline)
  3. Work history (what's been done)
  4. Receipts (parts purchased)
  5. Documentation (manuals, brochures)
  6. Previous analyses (progression tracking)

PROCESS:
  1. Load vehicle context (ONCE per vehicle)
  2. Classify image type (Rekognition)
  3. Generate targeted questionnaire (context-aware)
  4. Run LLM analysis (GPT-4o with full context)
  5. Extract structured insights
  6. Populate database tables

OUTPUTS:
  1. Enriched vehicle_images records
  2. Validated timeline_events
  3. Verified receipts (visual confirmation)
  4. Discovered modifications
  5. Maintenance alerts
  6. Condition progression data
  7. Part identifications
  8. Actionable insights

KEY PRINCIPLES:
  ✓ Every vehicle is unique → Custom questions
  ✓ Context saves tokens → Load once, use many times
  ✓ Specific > Generic → Target known unknowns
  ✓ Validate receipts → Build authenticity
  ✓ Track changes → Progression over time
  ✓ Justify tables → Only create when needed
  ✓ Reprocess-capable → New docs = Better analysis

RESULT:
  A digital appraiser that "knows" each vehicle intimately
  and asks exactly the right questions to fill your database
  with high-quality, validated, actionable data.
```

---

## Next Steps: Implementation

1. **Deploy Contextual Analyzer** ✅ (Done)
2. **Run Batch Processor** (Ready)
   ```bash
   node scripts/contextual-batch-processor.js
   ```
3. **Monitor Results** (Track token usage, cost, insights generated)
4. **Add New Tables** (As justified by analysis findings)
5. **Iterate** (Refine questions based on results)
6. **Reprocess** (When new documentation added)

This is the complete ERD of your intelligent, context-aware image analysis system!

