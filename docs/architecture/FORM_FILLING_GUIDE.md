# Form Filling Guide — Progressive Schema Resolution

## For Humans and Agents

This document explains how to fill the digital twin schema efficiently and correctly.
The schema has ~950 tables and ~5,000+ columns. No agent should ever load all of them at once.

---

## The Progressive Disclosure Pattern

The schema is a TREE, not a flat list. Each layer unlocks the next.

```
LAYER 0: TRIGGER (what initiated this?)
  ↓ unlocks
LAYER 1: IDENTITY (year, make, model, VIN)
  ↓ unlocks (via code library + VIN decode)
LAYER 2: FACTORY SPECIFICATION (what should this vehicle be?)
  ↓ unlocks (comparison: spec vs observed)
LAYER 3: CURRENT STATE (what is it now?)
  ↓ unlocks (delta: factory vs current = modification/condition story)
LAYER 4: EVIDENCE & PROVENANCE (how do we know?)
  ↓ unlocks (corroboration: multiple sources agree/conflict)
LAYER 5: MARKET & VALUATION (what's it worth and why?)
```

### Why This Matters for Token Efficiency

An LLM loading all 5,000 columns at once:
- Burns ~15,000 tokens just on schema
- Has no context for what's relevant
- Will hallucinate values for fields it can't determine
- May timeout or error before completing

An LLM loading Layer 1 first (15 columns):
- Burns ~200 tokens on schema
- Fills identity fields from any source
- Output triggers Layer 2 lookup (factory spec for THIS vehicle)
- Layer 2 schema is now TARGETED: only tables relevant to this year/make/model

---

## Layer 0: Trigger Sources

Every form-filling session starts from a trigger. The trigger determines which layers can be filled and from what evidence.

| Trigger | Available Evidence | Fillable Layers |
|---------|-------------------|-----------------|
| BaT listing URL | description, photos, comments, bids, sale result | 1, 2 (partial), 3 (partial), 4, 5 |
| Photo album | images only | 1 (if identifiable), 3 (visual condition) |
| VIN | VIN decode data | 1, 2 (factory spec lookup) |
| Parts receipt/email | part numbers, costs, dates, sellers | 3 (specific components), 4 (provenance) |
| Text thread | context, decisions, timeline | 4 (timeline, actor relationships) |
| Work order / invoice | scope, labor, parts, actor, org | 3, 4 (full provenance chain) |
| In-person inspection | measurements, photos, observations | 2 (verify spec), 3 (full condition) |
| Document scan (build sheet, fender tag) | factory codes | 2 (definitive factory spec) |

### Agent Instruction: Identify Your Trigger First

```
BEFORE loading any schema tables:
1. What is the source material? (URL, photos, VIN, document, etc.)
2. What entity does it relate to? (vehicle, actor, org)
3. What layers can this source fill?
4. Load ONLY the schema for those layers.
```

---

## Layer 1: Identity Resolution

### Schema to Load (15 columns)
```sql
-- Only these columns matter at Layer 1
vehicles: id, year, make, model, trim, vin, body_style, doors
```

### Filling Rules
- `year`: 4-digit integer, 1885-current+2
- `make`: Must match canonical make list (SELECT DISTINCT make FROM vehicles WHERE status='active')
- `model`: Free text but should NOT contain auction metadata ("for sale", "bring a trailer")
- `vin`: If present, validate format. Pre-1981: variable length. 1981+: exactly 17 characters, check digit (position 9)
- `trim`: Short identifier, NOT the full listing title

### What Layer 1 Unlocks
Once year/make/model are known:
```sql
-- Load relevant RPO codes for Layer 2
SELECT * FROM vintage_rpo_codes
WHERE manufacturer = make_to_manufacturer(make)
  AND first_year <= year AND last_year >= year;

-- Load relevant validation rules
SELECT * FROM code_validation_rules
WHERE manufacturer = make_to_manufacturer(make)
  AND (year_start IS NULL OR year_start <= year)
  AND (year_end IS NULL OR year_end >= year);
```

---

## Layer 2: Factory Specification

### What to Load
ONLY the subsystem tables relevant to the source material. Do NOT load all 120 component tables.

```
IF source mentions engine → load engine_blocks, engine_heads, engine_camshafts, etc.
IF source mentions transmission → load transmission_cases, transmission_gears, etc.
IF source is a full listing → load the "surface" table for each subsystem (1 per system)
IF source is VIN decode → load identity + factory spec lookup only
```

### Surface Tables (one per subsystem, ~20 total)
These are the "summary" tables that capture the main component identity:
```
engine_blocks           -- which engine (casting, displacement, hp)
transmission_cases      -- which transmission (type, speeds, model)
transfer_cases          -- which transfer case (if 4WD)
rear_axles             -- which rear end (ratio, type)
front_axles            -- which front axle
steering_gearboxes     -- steering type
brake_systems          -- brake type
fuel_tanks             -- fuel capacity
radiators              -- cooling type
exhaust_pipes          -- exhaust config
hvac_system            -- climate type
body_structure         -- frame type
paint_systems          -- color
seats                  -- seat type
wiring_harness         -- electrical generation
wheels                 -- wheel spec
```

### Filling Rules for Layer 2
- ALWAYS check the code library first: `SELECT * FROM vintage_rpo_codes WHERE ...`
- If a code is found, use its specs (displacement, hp, torque) — don't guess
- If VIN is decoded, factory spec FROM VIN takes precedence over description claims
- Set `is_original = TRUE` for factory spec entries
- Set `provenance = 'original'` for factory components

---

## Layer 3: Current State

### When to Fill
Only after Layer 2 exists. Layer 3 records DELTA from factory spec.

### Filling Rules
- If a component matches factory spec → `is_original = TRUE`, `condition_grade` reflects current condition
- If a component differs from factory spec → `is_original = FALSE`, new row in the component table
- The original component row stays (with condition_grade = 'removed' or 'replaced')
- Modifications are documented via component_events (event_type = 'modified' or 'replaced')

### Condition Grading Scale
```
excellent  — museum quality, show-ready, like new
good       — well-maintained, fully functional, minor wear appropriate to age
fair       — functional but showing age, cosmetic issues, needs attention soon
poor       — functional but degraded, requires repair/restoration
failed     — non-functional, broken, seized, rusted through
unknown    — cannot be determined from available evidence
```

### Provenance Scale
```
original       — factory-installed, matching to this vehicle
nos            — new old stock, correct part, never installed
reproduction   — newly manufactured copy of original part
aftermarket    — third-party part, not OEM design
unknown        — cannot be determined
```

---

## Layer 4: Evidence & Provenance

### Every Claim Must Cite
When filling ANY field, the agent should also create a field_evidence row:
```sql
INSERT INTO field_evidence (
  vehicle_id, field_name, proposed_value,
  source_type, source_confidence, extraction_context
)
```

### Source Type → Confidence Mapping
```
vin_decode:           95
factory_document:     93  (build sheet, window sticker)
professional_inspect: 90
measurement:          90  (micrometer, bore gauge, paint meter)
parts_receipt:        85
owner_testimony:      75
auction_listing:      70
photo_visual:         65
ai_extraction:        60
forum_discussion:     45
```

### Evidence Sufficiency Rules
```
MINIMUM for a fact:     1 source at confidence >= 70
CONFIRMED fact:         2+ independent sources agreeing
HIGH CONFIDENCE fact:   3+ sources, at least one measurement/document
VERIFIED fact:          measurement + document + visual all agree
DISPUTED fact:          2+ sources with conflicting values → flag for investigation
```

---

## Layer 5: Market & Valuation

Only fillable after Layers 1-3 are populated. Depends on comparables from the database.

---

## Error Handling — What To Do When You Can't Fill a Field

### For Agents
```
IF field cannot be determined from source material:
  → SKIP the field (leave NULL)
  → Do NOT guess or hallucinate
  → Do NOT set a default value unless schema specifies one

IF field value is ambiguous (source says "big block" but doesn't specify which):
  → Fill with the most general correct value ("V8")
  → Set source_confidence LOW (40-50)
  → Add extraction_context explaining the ambiguity

IF field value conflicts with another field:
  → Fill BOTH values in separate field_evidence rows
  → Set status = 'disputed'
  → The validation pipeline will catch this

IF you run out of context/tokens:
  → STOP and save progress
  → Record which layers are complete and which are partial
  → The next agent picks up from where you stopped
```

### For Humans
```
IF you don't know a value:
  → Leave it blank. A blank field is infinitely better than a wrong value.
  → The gap is itself useful information (shows what needs investigation)

IF you're not sure:
  → Fill it and mark confidence LOW
  → Add a note in condition_notes or provenance_detail explaining uncertainty

IF you have photos but no measurements:
  → Fill what you can see visually (condition_grade, is_original)
  → Leave precision fields blank (bore_mm, spec measurements)
  → Link the photos as evidence
```

---

## Multi-Source Input Pattern

Real-world data comes from multiple simultaneous sources. Example: Skylar working on Dave's 1983 K20.

### Sources Available
1. **Phone photos** — workstation shots, exhaust fabrication progress
2. **Text thread with Dave** — context, decisions, timeline
3. **Email receipts** — parts ordered (pipe, bends, clamps, gaskets)
4. **Prior listing photos** — vehicle's pre-work condition
5. **BaT auction data** — if sold on BaT, full description + comments + price

### Processing Order
```
1. IDENTITY: Which vehicle? → match to existing vehicle record by VIN or year/make/model
2. ACTORS: Who's involved? → create/link actor records (Skylar, Dave)
3. WORK ORDER: What's the scope? → create work_order linking vehicle + actor + org
4. PER-SOURCE EXTRACTION:
   a. Photos → condition_grade updates, evidence rows with photo_ids
   b. Texts → timeline events, decision context, actor communications
   c. Emails → parts provenance (part_number, supplier, cost, date)
   d. Listing → pre-existing vehicle data, factory spec baseline
5. COMPONENT EVENTS: Each task becomes a component_event
6. LINE ITEMS: Each component_event links to work_order_line_items
7. VALIDATION: Run rules against filled data
8. CAPABILITY UPDATE: Actor/org capabilities refresh from new evidence
```

---

## Token Budget Guidelines for Agents

| Operation | Estimated Tokens | Max Tables to Load |
|-----------|-----------------|-------------------|
| Layer 1 identity fill | 500 input, 200 output | 1 table (vehicles) |
| Layer 2 surface spec | 3,000 input, 1,000 output | ~20 surface tables |
| Layer 2 deep spec (one system) | 2,000 input, 1,500 output | 5-8 tables for one subsystem |
| Layer 3 condition assessment | 2,000 input, 1,000 output | Relevant component tables only |
| Layer 4 evidence creation | 1,000 input, 500 output | field_evidence + component_events |
| Full vehicle from BaT listing | 8,000 input, 5,000 output | Surface tables + evidence |
| Full vehicle deep resolution | 25,000 input, 15,000 output | Multiple passes, not single shot |

### Rule: Never exceed 30,000 tokens per fill session
If the job requires more, SPLIT into subsystem-specific passes:
- Pass 1: Identity + Engine
- Pass 2: Drivetrain + Chassis
- Pass 3: Body + Interior
- Pass 4: Evidence consolidation + Validation
