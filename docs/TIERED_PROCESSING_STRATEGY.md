# Tiered Image Processing Strategy

## Cost Optimization Through Intelligent Routing

**Goal:** Process thousands of images efficiently by using the cheapest model that can answer each question accurately.

---

## Three-Tier System

```
┌─────────────────────────────────────────────────────────────────┐
│                    IMAGE PROCESSING TIERS                        │
└─────────────────────────────────────────────────────────────────┘

TIER 1: ORGANIZATION & BASIC CLASSIFICATION
────────────────────────────────────────────────────────────────
Model: GPT-4o-mini (or free alternatives)
Cost: ~$0.0001 per image (100x cheaper!)
Speed: Fast (can batch 100+ at once)

Tasks:
✓ Image angle detection (front, rear, side, 3/4, etc.)
✓ Basic categorization (exterior, interior, engine, undercarriage)
✓ Image quality assessment (resolution, blur, lighting)
✓ Major component identification (door, hood, fender, wheel)
✓ Color detection
✓ Basic condition (clean/dirty/damaged)

Questions:
- "What angle is this photo taken from?"
- "Is this exterior, interior, or engine bay?"
- "What major body panels are visible?"
- "Is image quality sufficient for detailed analysis?"

TIER 2: SPECIFIC PART IDENTIFICATION
────────────────────────────────────────────────────────────────
Model: GPT-4o-mini with context
Cost: ~$0.005 per image (20x cheaper than GPT-4o)
Speed: Moderate (batch 20 at once)

Tasks:
✓ Specific part identification (alternator, carburetor, etc.)
✓ Sheet metal vs structural differentiation
✓ Modification detection (obvious aftermarket)
✓ Damage assessment (dents, rust spots)
✓ Missing parts identification
✓ Brand/model of visible parts

Questions:
- "Identify specific parts: [list of possibilities]"
- "Which body panels show damage?"
- "Are any parts obviously aftermarket?"
- "What mechanical components are visible?"

TIER 3: EXPERT ANALYSIS
────────────────────────────────────────────────────────────────
Model: GPT-4o with full context
Cost: ~$0.02 per image (full price)
Speed: Slow (3-5 at once)

Tasks:
✓ Paint quality assessment (requires high-res)
✓ Engine bay condition (expert knowledge)
✓ Interior condition rating (leather vs vinyl, etc.)
✓ Modification validation (matches documentation)
✓ Value-impacting assessments
✓ Authenticity verification

Requirements:
- High resolution image (>2MP)
- Good lighting
- Clear focus
- Context-heavy questions

Questions:
- "Assess paint quality and signs of repaint"
- "Rate engine bay condition with specifics"
- "Does this match factory configuration?"
- "What are value-impacting factors?"
```

---

## Image Quality Filter

```
STEP 0: PRE-PROCESSING (Free - No LLM)
──────────────────────────────────────────────────────────────

Check image metadata:
┌──────────────────────────────────────────────────────────┐
│ Resolution Check                                         │
│ ────────────────────────────────────────────────────────│
│ < 0.5 MP  → SKIP (too low quality)                      │
│ 0.5-2 MP  → TIER 1 only (basic organization)            │
│ 2-5 MP    → TIER 1 + TIER 2 (detailed parts)            │
│ > 5 MP    → ALL TIERS (can assess paint quality)        │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│ EXIF Analysis (Free)                                     │
│ ────────────────────────────────────────────────────────│
│ • Camera type (phone vs DSLR)                           │
│ • ISO (high ISO = grainy, skip paint analysis)          │
│ • Lighting conditions                                    │
│ • Focus score (if available)                            │
└──────────────────────────────────────────────────────────┘

Route to appropriate tier based on:
- Resolution
- Image quality
- What can be accurately assessed
```

---

## Cost Comparison

### Processing 2,741 images:

**Current (All GPT-4o):**
```
2,741 images × $0.02 = $54.82
```

**Tiered Approach:**
```
TIER 1: 2,741 images × $0.0001 = $0.27 (organization)
TIER 2: 1,500 images × $0.005  = $7.50 (good quality, specific parts)
TIER 3: 500 images  × $0.02    = $10.00 (high quality, complex analysis)
                                 ─────
                         TOTAL: $17.77

SAVINGS: $37.05 (67% cheaper!)
```

---

## Tier 1 Questions (Cheap & Fast)

### Basic Organization
```json
{
  "task": "basic_classification",
  "model": "gpt-4o-mini",
  "cost_per_image": 0.0001,
  
  "questions": [
    {
      "q": "What angle is this photo taken from?",
      "options": [
        "front_3quarter", "front_center", "front_angle",
        "rear_3quarter", "rear_center", "rear_angle",
        "driver_side", "passenger_side",
        "overhead", "undercarriage",
        "interior_front", "interior_rear",
        "engine_bay", "trunk",
        "detail_shot", "work_in_progress"
      ],
      "justification": "Simple visual classification, no expertise needed"
    },
    {
      "q": "What major category is this?",
      "options": [
        "exterior_body", "interior", "engine_mechanical",
        "undercarriage", "wheels_tires", "trunk_storage",
        "documentation", "work_progress"
      ],
      "justification": "High-level categorization"
    },
    {
      "q": "What major body panels or components are visible?",
      "options": [
        "hood", "door_driver", "door_passenger", "fender_front",
        "fender_rear", "bumper_front", "bumper_rear", "roof",
        "bed_truck", "tailgate", "windshield", "window"
      ],
      "justification": "Obvious large parts, easy to identify"
    },
    {
      "q": "Image quality assessment",
      "metrics": {
        "sufficient_for_detail": "boolean",
        "lighting": ["good", "adequate", "poor"],
        "focus": ["sharp", "acceptable", "blurry"],
        "estimated_resolution": ["low", "medium", "high"]
      },
      "justification": "Determines if Tier 2/3 analysis is worthwhile"
    },
    {
      "q": "Overall condition at glance",
      "options": [
        "excellent_clean", "good_maintained", "average_wear",
        "poor_neglected", "damaged", "under_restoration"
      ],
      "justification": "Quick visual assessment, no expertise needed"
    }
  ]
}
```

### Tier 1 Output Format
```json
{
  "tier": 1,
  "model_used": "gpt-4o-mini",
  "cost": 0.0001,
  "processing_time_ms": 234,
  
  "basic_classification": {
    "angle": "front_3quarter",
    "category": "exterior_body",
    "components_visible": ["hood", "fender_front", "door_driver"],
    "condition_glance": "good_maintained"
  },
  
  "image_quality": {
    "sufficient_for_detail": true,
    "lighting": "good",
    "focus": "sharp",
    "estimated_resolution": "high",
    "recommend_tier_2": true,
    "recommend_tier_3": true
  },
  
  "database_updates": {
    "vehicle_images": {
      "category": "exterior_body",
      "angle": "front_3quarter",
      "image_quality_score": 8
    }
  }
}
```

---

## Tier 2 Questions (Moderate Cost)

### Specific Part Identification
```json
{
  "task": "detailed_identification",
  "model": "gpt-4o-mini",
  "cost_per_image": 0.005,
  "requires": "tier_1_completed AND image_quality.sufficient_for_detail == true",
  
  "questions": [
    {
      "q": "Identify all specific parts visible",
      "context": "Vehicle: {year} {make} {model}",
      "expected_parts": ["based on angle and category from Tier 1"],
      "output": {
        "part_name": "string",
        "condition": ["factory", "aftermarket", "damaged", "missing"],
        "visible_brands": "array",
        "part_numbers_visible": "array"
      }
    },
    {
      "q": "Sheet metal vs structural components",
      "parts_list": ["from Tier 1 components_visible"],
      "classify_each": {
        "type": ["body_panel", "structural", "mechanical", "trim"],
        "material": ["steel", "aluminum", "plastic", "fiberglass"],
        "condition": ["good", "damaged", "rusted", "replaced"]
      }
    },
    {
      "q": "Damage assessment",
      "if": "tier_1.condition_glance includes 'damaged'",
      "identify": {
        "damage_type": ["dent", "rust", "scratch", "crack", "missing"],
        "severity": ["minor", "moderate", "severe"],
        "location": ["specific part"],
        "repair_cost_estimate": "range"
      }
    },
    {
      "q": "Modification detection",
      "compare_to": "factory specs for {year} {make} {model}",
      "identify": {
        "aftermarket_parts": "array",
        "visual_modifications": "array",
        "confidence": "0-100"
      }
    }
  ]
}
```

---

## Tier 3 Questions (Expert Analysis)

### High-Resolution Required
```json
{
  "task": "expert_assessment",
  "model": "gpt-4o",
  "cost_per_image": 0.02,
  "requires": [
    "tier_1_completed",
    "tier_2_completed",
    "image_quality.estimated_resolution == 'high'",
    "image_quality.focus == 'sharp'",
    "complex_analysis_needed"
  ],
  
  "questions": [
    {
      "q": "Paint quality assessment",
      "requires": "resolution > 5MP AND category == exterior_body",
      "analyze": {
        "paint_type": ["factory", "quality_repaint", "poor_repaint"],
        "orange_peel": "severity",
        "overspray": "locations",
        "color_match": "panels",
        "clear_coat_condition": "rating",
        "signs_of_body_work": "array"
      },
      "justification": "Requires high-res to see paint texture"
    },
    {
      "q": "Engine bay expert assessment",
      "requires": "category == engine_mechanical",
      "context": "Full vehicle context including SPID, mods, receipts",
      "analyze": {
        "matches_factory": "boolean with specifics",
        "modification_quality": "professional/amateur",
        "maintenance_indicators": "array",
        "concerns": "array",
        "value_impact": "positive/neutral/negative"
      },
      "justification": "Requires expertise and context"
    },
    {
      "q": "Interior condition expert rating",
      "requires": "category == interior",
      "analyze": {
        "material_types": "identified (leather vs vinyl etc)",
        "wear_pattern": "analysis for age",
        "restoration_needed": "specific items",
        "authenticity": "factory vs custom",
        "value_assessment": "impact"
      },
      "justification": "Material identification requires experience"
    }
  ]
}
```

---

## Routing Logic

```javascript
function routeImage(image, tier1Result) {
  const routing = {
    processedTiers: [1],
    nextTier: null,
    skipReasons: [],
    estimatedTotalCost: 0.0001 // Tier 1 already done
  };
  
  // Check if Tier 2 is worthwhile
  if (tier1Result.image_quality.sufficient_for_detail) {
    if (needsSpecificPartIdentification(tier1Result)) {
      routing.nextTier = 2;
      routing.estimatedTotalCost += 0.005;
    }
  } else {
    routing.skipReasons.push('Image quality insufficient for detailed analysis');
  }
  
  // Check if Tier 3 is worthwhile
  if (routing.nextTier === 2) {
    if (requiresExpertAnalysis(tier1Result) && 
        tier1Result.image_quality.estimated_resolution === 'high') {
      routing.processedTiers.push(3);
      routing.estimatedTotalCost += 0.02;
    } else if (tier1Result.image_quality.estimated_resolution !== 'high') {
      routing.skipReasons.push('Resolution insufficient for expert paint/detail analysis');
    }
  }
  
  return routing;
}

function needsSpecificPartIdentification(tier1) {
  // Route to Tier 2 if:
  return (
    tier1.category === 'engine_mechanical' || // Always need part IDs
    tier1.category === 'undercarriage' ||     // Suspension parts
    tier1.components_visible.length > 0 ||    // Has identifiable parts
    tier1.condition_glance === 'damaged'      // Need damage assessment
  );
}

function requiresExpertAnalysis(tier1) {
  // Route to Tier 3 only if:
  return (
    tier1.category === 'exterior_body' && needsPaintAnalysis() ||
    tier1.category === 'interior' && needsMaterialIdentification() ||
    tier1.category === 'engine_mechanical' && hasComplexContext() ||
    needsValueAssessment()
  );
}
```

---

## Batch Processing Strategy

```
┌─────────────────────────────────────────────────────────────┐
│           MULTI-TIER BATCH PROCESSING                       │
└─────────────────────────────────────────────────────────────┘

PHASE 1: TIER 1 - MASS ORGANIZATION (Fast & Cheap)
───────────────────────────────────────────────────────────────
Process: 100 images at a time
Model: gpt-4o-mini
Time: ~30 seconds per 100 images
Cost: $0.01 per 100 images

All 2,741 images → $0.27 total → ~15 minutes

Result: Every image organized, categorized, quality-rated

PHASE 2: TIER 2 - SELECTIVE DETAIL (Filtered)
───────────────────────────────────────────────────────────────
Filter: Only images with sufficient_for_detail = true
Estimate: ~55% of images (1,500 images)

Process: 20 images at a time  
Model: gpt-4o-mini with context
Time: ~45 seconds per 20 images
Cost: $0.10 per 20 images

1,500 images → $7.50 total → ~1 hour

Result: Specific parts identified, damage assessed

PHASE 3: TIER 3 - EXPERT ANALYSIS (Highly Selective)
───────────────────────────────────────────────────────────────
Filter: Only high-res + complex analysis needed
Estimate: ~18% of images (500 images)

Process: 5 images at a time
Model: GPT-4o with full context
Time: ~8 seconds per 5 images  
Cost: $0.10 per 5 images

500 images → $10.00 total → ~15 minutes

Result: Expert assessments, paint quality, value impacts

TOTAL TIME: ~1.5 hours
TOTAL COST: $17.77
vs Current: ~2 hours / $54.82
SAVINGS: 67% cost, 25% time
```

---

## Database Schema Updates

### New Fields for Tiered Processing

```sql
-- Add to vehicle_images table
ALTER TABLE vehicle_images ADD COLUMN IF NOT EXISTS tier_1_analysis JSONB;
ALTER TABLE vehicle_images ADD COLUMN IF NOT EXISTS tier_2_analysis JSONB;
ALTER TABLE vehicle_images ADD COLUMN IF NOT EXISTS tier_3_analysis JSONB;
ALTER TABLE vehicle_images ADD COLUMN IF NOT EXISTS processing_tier_reached INTEGER;
ALTER TABLE vehicle_images ADD COLUMN IF NOT EXISTS skip_reasons TEXT[];
ALTER TABLE vehicle_images ADD COLUMN IF NOT EXISTS total_processing_cost NUMERIC(10,4);

-- Image quality scoring
ALTER TABLE vehicle_images ADD COLUMN IF NOT EXISTS image_quality_score INTEGER; -- 1-10
ALTER TABLE vehicle_images ADD COLUMN IF NOT EXISTS estimated_resolution TEXT; -- low/medium/high
ALTER TABLE vehicle_images ADD COLUMN IF NOT EXISTS suitable_for_expert_analysis BOOLEAN;
```

---

## Free/Ultra-Cheap Alternatives

### Tier 1 Could Use:
```
1. GPT-4o-mini (current plan)
   Cost: ~$0.0001 per image
   Quality: Good enough for organization

2. Claude 3 Haiku
   Cost: ~$0.00008 per image
   Quality: Excellent for classification

3. Gemini 1.5 Flash
   Cost: Free tier available!
   Quality: Good for basic tasks
   
4. LLaVA (Open source, self-hosted)
   Cost: $0 (just compute)
   Quality: Decent for angles/categories
```

### Recommendation:
- Start with gpt-4o-mini ($0.0001)
- If processing millions, consider Gemini Flash (free tier)
- For ultimate scale, self-host LLaVA

---

## Implementation Priority

1. ✅ **Tier 1 Processor** (organization, angles, quality check)
   - Process ALL images fast and cheap
   - Build foundation for routing

2. ✅ **Tier 2 Processor** (specific parts, damage)
   - Process filtered set (good quality only)
   - 55% of images

3. ✅ **Tier 3 Processor** (expert analysis)
   - Process highly selective set (high-res only)
   - 18% of images

4. **Adaptive Routing**
   - Learn which images benefit from Tier 3
   - Optimize cost/value ratio over time

---

## Success Metrics

```
Tier 1 Success:
✓ 100% of images organized
✓ Angles identified
✓ Categories assigned
✓ Quality rated

Tier 2 Success:  
✓ 90%+ part identification accuracy
✓ Damage correctly assessed
✓ Modifications flagged

Tier 3 Success:
✓ Paint quality ratings match expert
✓ Value assessments accurate
✓ Context-aware insights generated

Cost Efficiency:
✓ 67% cost reduction vs all-GPT-4o
✓ 90% of value delivered by Tier 1+2
✓ Tier 3 only for high-value assessments
```

This tiered system processes thousands of images efficiently while reserving expensive models for complex analysis!

