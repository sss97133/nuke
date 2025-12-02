# AI Prompt Engineering Ladder - Architecture & ERD

## Core Concept: Cascading Intelligence

Each tier of AI analysis **builds on the previous tier's output**, creating increasingly sophisticated understanding.

```
Tier 1: Raw Image Analysis (GPT-4 Vision)
    ↓ (feeds into)
Tier 2: Context Understanding (combines with vehicle data)
    ↓ (feeds into)
Tier 3: Event Inference (what happened?)
    ↓ (feeds into)
Tier 4: Psychology & Forensics (who/why?)
```

---

## Database Schema - ERD

### Core Tables

```sql
-- 1. Raw image storage (already exists)
vehicle_images {
  id UUID PK
  vehicle_id UUID FK
  image_url TEXT
  taken_at TIMESTAMP
  exif_data JSONB
  -- ...existing fields
}

-- 2. Tier 1: Basic AI Vision Analysis
ai_image_analysis {
  id UUID PK
  image_id UUID FK → vehicle_images(id)
  analyzed_at TIMESTAMP
  
  -- What AI sees (raw vision output)
  objects_detected JSONB  -- ["truck", "grille", "wheels", "rust", "concrete"]
  scene_description TEXT   -- "A GMC truck on concrete with severe rust"
  dominant_colors JSONB    -- ["blue", "rust brown", "white"]
  image_quality_score INT  -- 0-100
  
  -- Technical metrics
  is_blurry BOOLEAN
  has_good_lighting BOOLEAN
  horizon_tilt_degrees NUMERIC
  crop_breathing_room_percent INT
  
  -- Composition
  subject_framing TEXT  -- "centered" | "rule_of_thirds" | "off_center"
  background_type TEXT  -- "clean" | "cluttered" | "industrial"
  
  -- Raw response
  raw_gpt_response JSONB
  model_used TEXT  -- "gpt-4-vision-preview"
  tokens_used INT
  cost_usd NUMERIC
}

-- 3. Tier 2: Angle Classification (builds on Tier 1)
ai_angle_classifications {
  id UUID PK
  image_id UUID FK
  tier1_analysis_id UUID FK → ai_image_analysis(id)  -- DEPENDS ON TIER 1
  
  -- What angle is this?
  angle_family TEXT  -- "exterior" | "interior" | "engine_bay" | "undercarriage"
  primary_label TEXT  -- "front_quarter_driver" | "dashboard" | "engine_full"
  view_axis TEXT     -- "front_left" | "straight_front" | "side"
  elevation TEXT     -- "high" | "mid" | "low"
  distance TEXT      -- "wide" | "medium" | "close"
  
  -- Quality as this angle type
  angle_quality_score INT  -- How good is this as a "front_quarter" shot?
  is_hero_shot BOOLEAN
  is_lead_pool_worthy BOOLEAN
  
  -- Issues specific to angle
  perspective_distortion TEXT  -- "nose_dip" | "fish_eye" | "none"
  technical_flaws TEXT[]       -- ["tight_crop", "heavy_background"]
  
  confidence NUMERIC
  needs_human_review BOOLEAN
}

-- 4. Tier 3: Content Detection (builds on Tier 1 + 2)
ai_content_detection {
  id UUID PK
  image_id UUID FK
  tier1_analysis_id UUID FK  -- Uses basic objects detected
  
  -- What's IN the photo?
  parts_visible JSONB  -- [{"name": "brake_caliper", "confidence": 0.9}]
  damage_detected JSONB  -- [{"type": "rust", "severity": "moderate", "location": "rocker_panel"}]
  tools_visible JSONB  -- [{"name": "impact_wrench", "brand": "snap_on"}]
  
  -- Special detections
  has_speedsheet BOOLEAN
  speedsheet_data JSONB  -- Extracted values if visible
  has_vin_visible BOOLEAN
  vin_extracted TEXT
  has_license_plate BOOLEAN
  plate_number TEXT
  
  -- Work indicators
  work_type_inferred TEXT  -- "body_repair" | "paint_prep" | "inspection"
  repair_stage TEXT  -- "before" | "in_progress" | "after"
}

-- 5. Tier 4: Event Analysis (combines Tier 1-3 + timeline context)
ai_event_analysis {
  id UUID PK
  timeline_event_id UUID FK → timeline_events(id)
  
  -- Input: ALL photos from this date + their Tier 1-3 analysis
  photo_ids UUID[]
  photo_count INT
  
  -- Event understanding
  event_type_inferred TEXT  -- "initial_inspection" | "delivery" | "site_visit"
  event_confidence INT
  
  -- Participant detection
  photographer_type TEXT  -- "professional" | "amateur" | "owner" | "unknown"
  photographer_intent TEXT  -- "honest_documentation" | "marketing" | "deceptive"
  
  -- What happened analysis
  activity_description TEXT  -- "Professional pre-purchase inspection showing vehicle condition"
  key_findings TEXT[]  -- ["Severe rust documented", "Speedsheet visible", "Complete coverage"]
  
  -- Device/IMEI context
  device_fingerprint TEXT
  is_known_device BOOLEAN
  ghost_user_id UUID FK  -- If unknown device
  
  -- Forensics
  honesty_score INT  -- 0-100 (based on coverage, damage disclosure)
  coverage_completeness INT  -- 0-100 (% of essential angles present)
  missing_angles TEXT[]  -- What's NOT shown (red flags)
  
  raw_llm_response JSONB
  model_used TEXT
  analyzed_at TIMESTAMP
}

-- 6. Tier 5: Seller Psychology (builds on Tier 4)
ai_seller_psychology {
  id UUID PK
  vehicle_id UUID FK
  
  -- Aggregate ALL photos analysis for this vehicle
  total_photos INT
  photo_date_span_days INT
  unique_devices INT
  
  -- Coverage analysis
  essential_angles_present INT  -- Out of required angles
  essential_angles_missing TEXT[]
  coverage_score INT  -- 0-100
  
  -- Pattern detection
  seller_profile TEXT  -- "professional_dealer" | "honest_amateur" | "flipper" | "deceptive"
  confidence_level TEXT  -- "high" | "medium" | "low"
  
  -- Red flags
  strategic_gaps BOOLEAN  -- Missing undercarriage, rear, engine bay?
  glamour_only BOOLEAN    -- Only beauty shots, no reality?
  damage_hidden BOOLEAN   -- Visible damage strategically avoided?
  inconsistent_quality BOOLEAN  -- Some pro, some amateur (multiple sellers?)
  
  -- Trust indicators
  honesty_score INT  -- 0-100
  transparency_score INT
  trust_recommendation TEXT  -- "HIGH TRUST" | "MODERATE" | "PROCEED WITH CAUTION"
  
  -- Supporting evidence
  reasoning TEXT  -- Why this profile/score?
  key_observations TEXT[]
  
  analyzed_at TIMESTAMP
}
```

---

## Prompt Engineering Flow

### TIER 1: Individual Image Analysis (Foundation)

**Input:** Single image URL  
**Model:** GPT-4 Vision  
**Context:** NONE (blind analysis)

```javascript
const tier1Prompt = `
Analyze this automotive photo. Describe:
1. What you see (vehicle type, components visible, damage, background)
2. Photo quality (focus, lighting, composition)
3. Technical metrics (horizon level, framing, breathing room)
4. Any text/documents visible (speedsheet, VIN, signs)

Return structured JSON.
`;
```

**Output → Stored in:** `ai_image_analysis`

---

### TIER 2: Angle Classification (Builds on Tier 1)

**Input:** 
- Image URL
- Tier 1 analysis output
- Vehicle type (truck vs sedan changes what angles matter)

**Model:** GPT-4 Vision + Tier 1 context  
**Context:** "You already know this shows a truck on concrete..."

```javascript
const tier2Prompt = `
PREVIOUS ANALYSIS: ${tier1.scene_description}
DETECTED OBJECTS: ${tier1.objects_detected}

Given this is a ${vehicle.year} ${vehicle.make} ${vehicle.model} truck, classify:

1. Angle Type: front_quarter_driver | front_quarter_passenger | side | rear | etc.
2. Quality as THIS angle: Rate 0-100
3. Hero shot potential: Yes/No + why
4. Technical flaws: Perspective distortion? Tight crop? Heavy background?
5. Lead pool worthy: Yes/No (can this be a primary image for listings?)

Consider: Ground angle, breathing room, background weight, composition.
`;
```

**Output → Stored in:** `ai_angle_classifications`

---

### TIER 3: Content Extraction (Builds on Tier 1)

**Input:**
- Image URL
- Tier 1 objects detected
- Vehicle context

**Model:** GPT-4 Vision focused on DETAILS  
**Context:** "You know there's a truck and rust..."

```javascript
const tier3Prompt = `
KNOWN OBJECTS: ${tier1.objects_detected}
VEHICLE: ${vehicle.year} ${vehicle.make} ${vehicle.model}

Deep scan for:
1. Specific parts visible (brake calipers, axles, suspension components)
2. Damage assessment (rust location, severity, type)
3. Tools in frame (impact wrench, jack stands, etc.)
4. Documents (speedsheet, inspection forms, VIN tags)
5. Work stage (before repair, during, after, or no work)

Extract ALL visible text and measure all visible damage precisely.
`;
```

**Output → Stored in:** `ai_content_detection`

---

### TIER 4: Event Synthesis (Combines multiple images + context)

**Input:**
- ALL photos from same DATE
- ALL Tier 1-3 analyses for those photos
- Vehicle data
- Timeline context

**Model:** GPT-4 or Claude (reasoning model)  
**Context:** Full context of vehicle + all photo analyses

```javascript
const tier4Prompt = `
VEHICLE: ${vehicle.year} ${vehicle.make} ${vehicle.model}
DATE: ${eventDate}
PHOTO COUNT: ${photos.length}

ANALYZED PHOTOS:
${photos.map(p => `
  - Photo ${p.id}:
    * Angle: ${p.tier2.primary_label}
    * Objects: ${p.tier1.objects_detected}
    * Content: ${p.tier3.parts_visible}, ${p.tier3.damage_detected}
    * Quality: ${p.tier2.angle_quality_score}/100
`).join('\n')}

DEVICE INFO: ${deviceFingerprint}
KNOWN DEVICE: ${isKnownDevice ? 'Yes (owner)' : 'No (unknown photographer)'}

Based on this photo set, determine:

1. EVENT TYPE: What activity does this document?
   - initial_inspection (first look at vehicle)
   - site_visit (owner checking on vehicle)
   - delivery (vehicle arriving)
   - work_session (repair/maintenance happening)
   - listing_photos (professional marketing shoot)

2. PARTICIPANTS: Who was involved?
   - Photographer (known user vs ghost user)
   - Associate ghost user with seller if unknown

3. WHAT HAPPENED: Generate event title and description

4. KEY FINDINGS: Speedsheet? Damage? Work performed?

Return event analysis with confidence scores.
`;
```

**Output → Stored in:** `ai_event_analysis`  
**Side effect:** Updates `timeline_events` with AI-generated title/description

---

### TIER 5: Forensic Analysis (Aggregates ALL photos for vehicle)

**Input:**
- ALL photos for vehicle across ALL dates
- ALL Tier 4 event analyses
- Photo coverage map

**Model:** Claude 3.5 Sonnet (best reasoning)  
**Context:** Complete vehicle photo history

```javascript
const tier5Prompt = `
VEHICLE: ${vehicle.year} ${vehicle.make} ${vehicle.model}
TOTAL PHOTOS: ${allPhotos.length} across ${eventCount} events
TIME SPAN: ${dateRange}

PHOTO EVENTS ANALYZED:
${events.map(e => `
  ${e.date}: ${e.photo_count} photos
  - Event type: ${e.tier4.event_type_inferred}
  - Photographer: ${e.tier4.photographer_type}
  - Coverage: ${e.tier4.angles_present.join(', ')}
`).join('\n')}

COVERAGE ANALYSIS:
Essential angles present: ${essentialAnglesPresent.length}/20
Missing angles: ${missingAngles.join(', ')}

Analyze the SELLER'S BEHAVIOR:

1. COVERAGE COMPLETENESS: Did they show everything or hide things?
2. PHOTOGRAPHY QUALITY: Professional, amateur, or rushed?
3. DAMAGE DISCLOSURE: Honest about issues or deceptive?
4. PHOTOGRAPHER PATTERN: Single source or multiple (red flag)?
5. TIMELINE COHERENCE: Photos match claimed history?

FORENSIC QUESTIONS:
- What angles are strategically MISSING?
- Does photo quality suggest honest seller or flipper?
- Are damage areas well-documented or avoided?
- Multiple unknown devices = multiple sellers/flippers?

Return:
- Seller profile (professional/honest/flipper/deceptive)
- Honesty score (0-100)
- Trust recommendation
- Red flags and reasoning
`;
```

**Output → Stored in:** `ai_seller_psychology`

---

## Data Flow Diagram

```
┌─────────────────┐
│ USER UPLOADS    │
│ 9 photos        │
└────────┬────────┘
         │
         ↓
┌─────────────────────────────────────┐
│ TIER 1: Per-Image Analysis          │
│ (Parallel - 9 simultaneous calls)   │
├─────────────────────────────────────┤
│ Photo 1 → GPT-4 Vision → objects,   │
│           quality, composition       │
│ Photo 2 → GPT-4 Vision → ...        │
│ ...                                  │
│ Photo 9 → GPT-4 Vision → ...        │
│                                      │
│ OUTPUT: 9 rows in ai_image_analysis │
└────────┬────────────────────────────┘
         │
         ↓
┌─────────────────────────────────────┐
│ TIER 2: Angle Classification        │
│ (Uses Tier 1 + vehicle type)        │
├─────────────────────────────────────┤
│ For each photo:                     │
│   Input: Tier 1 objects + vehicle   │
│   Classify: front_quarter? side?    │
│   Score: Quality as this angle      │
│                                      │
│ OUTPUT: 9 rows in ai_angle_class    │
└────────┬────────────────────────────┘
         │
         ↓
┌─────────────────────────────────────┐
│ TIER 3: Content Extraction          │
│ (Uses Tier 1 objects for focus)    │
├─────────────────────────────────────┤
│ For each photo:                     │
│   Input: Tier 1 objects list        │
│   Deep scan: Specific parts, damage │
│   Extract: Speedsheet, VIN, text    │
│                                      │
│ OUTPUT: 9 rows in ai_content_detect │
└────────┬────────────────────────────┘
         │
         ↓
┌─────────────────────────────────────┐
│ GROUP BY DATE                       │
│ (Group 9 photos → 3 date groups)    │
├─────────────────────────────────────┤
│ Jan 6: 6 photos                     │
│ Jan 9: 2 photos                     │
│ Jan 19: 1 photo                     │
└────────┬────────────────────────────┘
         │
         ↓
┌─────────────────────────────────────┐
│ TIER 4: Event Synthesis             │
│ (Per date group - 3 calls)          │
├─────────────────────────────────────┤
│ Jan 6 Group:                        │
│   Input: 6 photos + all their       │
│          Tier 1-3 analyses          │
│   Infer: Unknown photographer =     │
│          initial inspection         │
│   Device: Unknown IMEI = ghost user │
│                                      │
│ OUTPUT: 3 rows in ai_event_analysis │
└────────┬────────────────────────────┘
         │
         ↓
┌─────────────────────────────────────┐
│ TIER 5: Forensic Aggregate          │
│ (Once per vehicle - 1 call)         │
├─────────────────────────────────────┤
│ Input: ALL 3 events + analyses      │
│ Analyze: Coverage gaps, patterns    │
│ Infer: Seller psychology            │
│ Score: Honesty, trust               │
│                                      │
│ OUTPUT: 1 row in ai_seller_psych    │
└─────────────────────────────────────┘
```

---

## Dependency Chain

```
vehicle_images (raw data)
    ↓
ai_image_analysis (Tier 1 - what do you see?)
    ↓
    ├→ ai_angle_classifications (Tier 2 - what angle?)
    └→ ai_content_detection (Tier 3 - what's in it?)
         ↓
         ai_event_analysis (Tier 4 - what happened? - GROUP BY DATE)
              ↓
              ai_seller_psychology (Tier 5 - who/why? - AGGREGATE)
```

**Each tier CANNOT run until previous tier completes.**

---

## Trigger Points

### When to run each tier?

**TIER 1-3: During Upload (Real-time)**
```javascript
// imageUploadService.ts - after image saved
await analyzeImageTier1(imageId, imageUrl);
await analyzeImageTier2(imageId, vehicleType);
await analyzeImageTier3(imageId);
```

**TIER 4: After photos grouped by date**
```sql
-- Trigger when timeline event created/updated
CREATE TRIGGER analyze_event_photos
AFTER INSERT OR UPDATE ON timeline_events
WHEN metadata->>'needs_ai_analysis' = 'true'
EXECUTE FUNCTION run_tier4_event_analysis();
```

**TIER 5: On demand or nightly batch**
```javascript
// Run when user views vehicle profile
// OR: Nightly cron for all vehicles with new photos
await analyzeVehicleForensics(vehicleId);
```

---

## Cost Management

**Per 9-photo upload:**
- Tier 1: 9 × $0.01 = $0.09
- Tier 2: 9 × $0.005 = $0.045 (simpler prompt)
- Tier 3: 9 × $0.01 = $0.09
- Tier 4: 3 × $0.02 = $0.06 (3 date groups)
- Tier 5: 1 × $0.03 = $0.03

**Total: ~$0.315 per vehicle photo set**

**Optimization:**
- Tier 1-3: Real-time (user waits ~10 seconds)
- Tier 4: Background job (within 1 minute)
- Tier 5: Lazy load (only when forensics viewed)

---

## API Response Caching

```sql
-- Cache AI responses to avoid re-analysis
CREATE TABLE ai_analysis_cache (
  id UUID PK,
  image_id UUID,
  tier INT,  -- 1-5
  prompt_hash TEXT,  -- Hash of prompt used
  response JSONB,
  created_at TIMESTAMP,
  is_stale BOOLEAN DEFAULT FALSE,
  
  UNIQUE(image_id, tier, prompt_hash)
);
```

**Cache invalidation:**
- Image edited/re-uploaded → Mark stale
- Vehicle data changed → Mark Tier 2+ stale
- Prompt updated → New hash, fresh analysis

---

## Implementation Questions

**Q1: Run all tiers on upload or lazy load?**
- Tier 1-3: Upload time (10 sec wait)
- Tier 4: Background (1 min delay)
- Tier 5: On-demand (when forensics tab opened)

**Q2: Re-analyze if prompts improve?**
- Version prompts
- Allow re-analysis with better prompts
- Keep history of analyses

**Q3: Human review workflow?**
- Flag low-confidence results
- Allow manual override
- Train AI from corrections

**Ready to build this tier-by-tier or need more spec clarification?**

