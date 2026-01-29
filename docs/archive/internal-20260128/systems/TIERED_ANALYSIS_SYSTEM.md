# Tiered Image Analysis System

## Overview

A progressive analysis system that starts with accurate subject/angle identification (Tier 1) and progressively adds detail through higher tiers. Each tier builds on the previous, ensuring cost efficiency while maintaining accuracy.

---

## Tier 1: Subject & Angle Classification (CRITICAL FOUNDATION)

**Purpose:** Accurately identify WHAT the image shows and FROM WHAT ANGLE

**Model:** GPT-4o-mini (fast, cheap)  
**Cost:** ~$0.0001 per image  
**Speed:** Fast (can batch 100+ images)  
**Priority:** HIGHEST - This must be accurate before any other analysis

### Tier 1 Responsibilities

**MUST DO:**
1. **Subject Identification**
   - What is the primary subject? (door panel, engine bay, dashboard, etc.)
   - Is this interior or exterior? (CRITICAL - no mistakes allowed)
   - Is this a full vehicle view or a detail/close-up?

2. **Angle Classification**
   - Specific angle from taxonomy (e.g., `interior_door_driver`, not just "interior")
   - Driver vs passenger side when applicable
   - View perspective (front, rear, side, top, etc.)

3. **Category Assignment**
   - Primary category: `exterior`, `interior`, `engine_bay`, `undercarriage`, `document`, `detail`
   - Must be accurate - this gates all future analysis

4. **Image Quality Assessment**
   - Resolution estimate (low/medium/high)
   - Focus quality (blurry/clear)
   - Lighting assessment
   - Suitability for further analysis (yes/no)

5. **Major Component Detection**
   - Top-level components only (door, hood, fender, wheel, dashboard, seat)
   - NOT detailed parts (that's Tier 3+)

### Tier 1 Output Schema

```json
{
  "tier_1_analysis": {
    "category": "interior|exterior|engine_bay|undercarriage|document|detail",
    "angle": "interior_door_driver|front_quarter_driver|engine_bay_full|...",
    "subject": "door_panel|dashboard|engine|frame|...",
    "is_full_vehicle": false,
    "is_interior": true,
    "is_exterior": false,
    "image_quality": {
      "overall_score": 7,
      "focus": "clear|slightly_blurry|blurry",
      "lighting": "good|fair|poor",
      "estimated_resolution": "low|medium|high",
      "sufficient_for_detail": true,
      "suitable_for_expert": false
    },
    "condition_glance": "good|fair|poor|damaged",
    "components_visible": ["door", "window", "armrest"]
  }
}
```

### Tier 1 Guardrails

**CRITICAL RULES:**
- ❌ NEVER classify interior door panels as "exterior"
- ❌ NEVER use generic "detail" when a specific angle exists
- ❌ NEVER default to "exterior" for close-ups
- ✅ ALWAYS specify driver/passenger when applicable
- ✅ ALWAYS distinguish interior vs exterior correctly
- ✅ ALWAYS use specific angle taxonomy when possible

**Interior Detection Must Check:**
- Door panels, door handles, armrests
- Upholstery, fabric, leather, vinyl
- Window controls, door cards
- Interior materials (not exterior paint/metal)

**Exterior Detection Must Check:**
- Full vehicle visible in frame
- Exterior paint, body panels
- Clear evidence of outdoor/garage environment
- NOT just "vehicle" label from Rekognition

---

## Tier 2: Component Identification

**Purpose:** Identify specific parts and components visible in the image

**Model:** GPT-4o-mini with context  
**Cost:** ~$0.005 per image  
**Speed:** Moderate (batch 20 images)  
**Prerequisites:** Tier 1 must be complete and accurate

### Tier 2 Responsibilities

1. **Specific Part Identification**
   - Detailed parts (alternator, carburetor, brake caliper, etc.)
   - Part numbers if visible
   - Brands if visible

2. **Damage Assessment**
   - Type of damage (rust, dent, scratch, etc.)
   - Severity and location
   - Impact on condition

3. **Modification Detection**
   - Aftermarket parts
   - Custom modifications
   - Non-stock components

4. **Sheet Metal Analysis**
   - Straightness
   - Gaps and alignment
   - Panel condition

### Tier 2 Output Schema

```json
{
  "tier_2_analysis": {
    "components": [
      {
        "name": "alternator",
        "type": "engine_component",
        "brand": "Delco",
        "part_number": "12345678",
        "condition": "good",
        "is_aftermarket": false,
        "confidence": 0.95
      }
    ],
    "damage_assessment": {
      "has_damage": true,
      "damage_types": ["rust", "scratch"],
      "severity": "moderate",
      "locations": ["door_panel", "lower_edge"]
    },
    "modifications": {
      "detected": false,
      "items": []
    }
  }
}
```

---

## Tier 3: Deep Component Analysis

**Purpose:** Extract detailed information about every visible component

**Model:** GPT-4o with full context  
**Cost:** ~$0.02 per image  
**Speed:** Slow (3 images per batch)  
**Prerequisites:** Tier 1 + Tier 2 complete, high-resolution image

### Tier 3 Responsibilities

**For Interior Door Panels:**
- Door handle (type, condition, material)
- Armrest (material, condition, color)
- Window controls (buttons, switches, condition)
- Speaker covers (material, condition, size)
- Upper plastic trim (condition, color, texture)
- Lower panel material (fabric, vinyl, leather)
- Door pull strap/handle
- Lock mechanism visibility
- Any switches or controls
- VIN sticker location (if visible)
- Overall panel condition assessment

**For Other Areas:**
- Engine bay: Every component, wiring, hoses, connections
- Exterior: Paint quality, panel gaps, trim details
- Dashboard: Every gauge, switch, control, material
- Undercarriage: Frame condition, suspension details, exhaust routing

### Tier 3 Output Schema

```json
{
  "tier_3_analysis": {
    "detailed_components": [
      {
        "component_name": "door_handle",
        "location": "interior_door_driver",
        "type": "pull_handle",
        "material": "chrome_plated_plastic",
        "condition": "good",
        "color": "chrome",
        "visible_features": ["textured_grip", "mounting_bolts"],
        "condition_notes": "Minor wear on grip surface",
        "confidence": 0.98
      },
      {
        "component_name": "armrest",
        "location": "interior_door_driver",
        "type": "integrated_armrest",
        "material": "vinyl",
        "condition": "fair",
        "color": "black",
        "visible_features": ["stitching", "wear_patterns"],
        "condition_notes": "Some cracking on surface, stitching intact",
        "confidence": 0.95
      },
      {
        "component_name": "window_controls",
        "location": "interior_door_driver",
        "type": "power_window_switches",
        "material": "plastic",
        "condition": "good",
        "button_count": 4,
        "visible_features": ["master_switch", "individual_window_switches"],
        "condition_notes": "All switches appear functional, no visible damage",
        "confidence": 0.92
      },
      {
        "component_name": "speaker_cover",
        "location": "interior_door_driver",
        "type": "fabric_grille",
        "material": "fabric_over_metal",
        "condition": "good",
        "size": "6x9_inch",
        "visible_features": ["perforated_pattern", "fabric_texture"],
        "condition_notes": "Clean, no tears or stains",
        "confidence": 0.90
      },
      {
        "component_name": "upper_plastic_trim",
        "location": "interior_door_driver",
        "type": "door_panel_upper",
        "material": "injected_molded_plastic",
        "condition": "good",
        "color": "black",
        "texture": "smooth",
        "visible_features": ["molding_lines", "mounting_points"],
        "condition_notes": "No cracks or warping visible",
        "confidence": 0.93
      }
    ],
    "overall_assessment": {
      "panel_condition": "good",
      "completeness": "all_components_visible",
      "restoration_needed": false,
      "value_impact": "neutral"
    }
  }
}
```

---

## Tier 4: Expert Contextual Analysis

**Purpose:** Expert-level analysis with full vehicle context and reference documentation

**Model:** GPT-4o with full context + reference docs  
**Cost:** ~$0.05 per image  
**Speed:** Very slow (1 image at a time)  
**Prerequisites:** All previous tiers, high-resolution, reference docs available

### Tier 4 Responsibilities

1. **Reference Validation**
   - Cross-reference with factory manuals
   - Verify part numbers against documentation
   - Identify deviations from stock

2. **Expert Assessment**
   - Paint quality (factory vs repaint)
   - Condition relative to age
   - Value-impacting factors
   - Authenticity verification

3. **Contextual Insights**
   - How this relates to vehicle history
   - Maintenance recommendations
   - Restoration priorities
   - Market value impact

---

## Processing Flow

```
Image Upload
    ↓
Tier 1: Subject & Angle (ALL images)
    ├─ Accurate category (interior/exterior/etc)
    ├─ Specific angle (interior_door_driver/etc)
    ├─ Quality assessment
    └─ Major components only
    ↓
    [Quality Gate: sufficient_for_detail?]
    ↓
Tier 2: Component Identification (~55% of images)
    ├─ Specific parts
    ├─ Damage assessment
    └─ Modification detection
    ↓
    [Quality Gate: suitable_for_expert?]
    ↓
Tier 3: Deep Component Analysis (~18% of images)
    ├─ Every visible component detailed
    ├─ Materials, conditions, features
    └─ Comprehensive inventory
    ↓
    [Context Gate: reference docs available?]
    ↓
Tier 4: Expert Contextual Analysis (~5% of images)
    ├─ Reference validation
    ├─ Expert assessment
    └─ Value impact analysis
```

---

## Current Implementation Status

### ✅ Tier 1 (analyze-image)
- **Status:** Implemented but needs refinement
- **Issues:** 
  - Context detection sometimes misclassifies interior doors as exterior
  - Angle detection not specific enough
  - Needs better interior detection logic
- **Fixes Applied:**
  - Improved `determineAppraiserContext()` to detect door interiors
  - Enhanced angle detection for interior doors
  - Better fallback logic

### ✅ Tier 2 (analyze-image-tier2)
- **Status:** Implemented
- **Location:** `supabase/functions/analyze-image-tier2/index.ts`
- **Features:** Component identification with reference context

### ⚠️ Tier 3 (analyze-image-contextual)
- **Status:** Partially implemented
- **Location:** `supabase/functions/analyze-image-contextual/index.ts`
- **Needs:** Deep component extraction for interior door panels
- **Gap:** Not extracting detailed components like door handles, armrests, buttons, speaker covers, upper plastic

### ❌ Tier 4
- **Status:** Not yet implemented
- **Needs:** Expert analysis with full reference documentation

---

## Development Priorities

### Immediate (Tier 1 Fixes)
1. ✅ Fix interior door misclassification (DONE)
2. ✅ Improve angle detection specificity (DONE)
3. ⏳ Add validation checks to prevent exterior/interior confusion
4. ⏳ Improve confidence scoring for angle detection

### Short-term (Tier 3 Enhancement)
1. Create detailed component extraction for interior door panels
2. Extract: door handle, armrest, buttons, speaker covers, upper plastic
3. Add material and condition assessment for each component
4. Structure output for easy querying

### Medium-term (Tier 4)
1. Implement reference document cross-referencing
2. Add expert assessment logic
3. Create value impact analysis
4. Build contextual insights engine

---

## Cost Optimization

**Current Approach (All GPT-4o):**
- 2,741 images × $0.02 = $54.82

**Tiered Approach:**
- Tier 1: 2,741 images × $0.0001 = $0.27
- Tier 2: 1,500 images × $0.005 = $7.50
- Tier 3: 500 images × $0.02 = $10.00
- Tier 4: 100 images × $0.05 = $5.00
- **Total: $22.77 (58% savings)**

---

## Key Principles

1. **Tier 1 is Foundation:** Must be accurate before any other analysis
2. **Progressive Detail:** Each tier adds more detail, never replaces previous
3. **Quality Gates:** Only process higher tiers when quality/context supports it
4. **Cost Efficiency:** Use cheapest model that can answer the question accurately
5. **Context Matters:** Higher tiers benefit from vehicle history and reference docs

---

## Next Steps

1. ✅ Fix Tier 1 interior door classification
2. ⏳ Test Tier 1 accuracy on sample images
3. ⏳ Enhance Tier 3 for deep component extraction
4. ⏳ Create Tier 4 expert analysis
5. ⏳ Build monitoring dashboard for tier accuracy

