# Photo Forensics - Advanced AI Training Criteria

## Level 1: Technical Quality Detection

### Perspective Distortion
**Issue:** Ground angle makes nose "dip"
```
AI Prompt:
"Analyze vehicle stance and ground plane. Does the front end appear to dip or slope unnaturally due to camera angle? Rate: None | Slight | Moderate | Severe"

Disqualifying factors:
- Front dips more than 3° from level
- Suggests amateur photographer or rushed shot
- Not suitable for lead/hero image
```

### Compositional Weight
**Issue:** Frame/object in background adds "heaviness"
```
AI Prompt:
"Identify background elements that add visual weight or distraction. Heavy structural elements (frames, poles, buildings) competing with subject?"

Scoring:
- Clean background = +20 priority
- Minimal distraction = +10
- Heavy elements in frame = -15
- Elements balanced with subject = neutral
```

### Crop Tightness
**Issue:** "Image was too tightly cropped in camera"
```
AI Prompt:
"Measure breathing room around vehicle. Is there adequate negative space (10-15% margin on all sides)? Or is vehicle cramped in frame?"

Categories:
- Spacious (15%+ margin) = Lead-worthy
- Adequate (10-15% margin) = Acceptable
- Tight (5-10% margin) = Needs AI expansion
- Cramped (<5% margin) = Disqualified for hero use
```

## Level 2: Compositional Critique

### The "Viva Rhombus" Example
**Opportunity:** Branding element (Viva Las Vegas sign) in background  
**Flaw:** Perspective distortion + tight crop + heavy frame

**AI Decision Tree:**
```
IF branding_opportunity_detected AND technical_flaws_present THEN
  - Flag for AI correction (crop expansion, perspective fix)
  - Original = Documentation shot
  - AI-corrected version = Potential lead
  - Let user choose: Authentic vs Corrected
ELSE IF technical_flaws_only THEN
  - Bury in gallery (not lead-worthy)
```

## Level 3: Photographer Psychology

### What Photos Reveal About Photographer

**Professional indicators:**
- Level horizon consistently
- Adequate breathing room
- Systematic angle coverage
- Consistent lighting
- Wide angle lens for exteriors
→ **Trustworthy seller**

**Amateur indicators:**
- Tilted horizons
- Tight crops
- Random angles, no system
- Harsh shadows/poor lighting
→ **Honest but unsophisticated**

**Rushed/Deceptive indicators:**
- Strategic angles only (hiding damage)
- Inconsistent lighting (hiding with shadows)
- Missing essential angles
- Overly artistic/glamour shots (distraction)
→ **RED FLAG - investigate what's hidden**

### The Viva Photos Analysis

**Image 1 (Front Quarter High):**
- Clean composition
- Level horizon
- Good breathing room
- Professional lighting
- Systematic coverage
→ **Lead-worthy, professional photographer**

**Image 2 (Passenger Quarter with Rhombus):**
- Branding opportunity (Viva sign)
- BUT: Nose dip (amateur mistake or rushed)
- Heavy frame background (compositional flaw)
- Tight crop (no breathing room)
→ **Not lead-worthy without AI correction**

## Level 4: AI Enhancement Opportunities

### Auto-Correction Pipeline

**For Image 2 (Rhombus shot):**

1. **Perspective Correction**
   ```
   - Detect ground plane angle
   - Level vehicle to horizontal
   - Correct nose dip
   ```

2. **Background Expansion (Generative AI)**
   ```
   - Extend concrete ground 10% on all sides
   - Match lighting/texture from existing area
   - Add breathing room without changing vehicle
   ```

3. **Background Weight Reduction**
   ```
   - Subtle blur/desaturate heavy frame element
   - OR: AI removal if user prefers
   - Keep Viva rhombus (branding value)
   ```

4. **Result:**
   ```
   Original = Documentation (what was really there)
   AI-Enhanced = Lead pool candidate (branding + corrected composition)
   User chooses which to display
   ```

## Training Data Structure

### Image Critique Schema
```sql
CREATE TABLE image_critiques (
  id UUID PRIMARY KEY,
  image_id UUID REFERENCES vehicle_images(id),
  
  -- Technical scores
  perspective_distortion_score INT, -- 0-100 (0=severe, 100=perfect)
  crop_tightness_score INT,
  compositional_balance_score INT,
  lighting_quality_score INT,
  
  -- Detected issues
  has_nose_dip BOOLEAN,
  has_horizon_tilt BOOLEAN,
  has_heavy_background BOOLEAN,
  needs_breathing_room BOOLEAN,
  
  -- Opportunities
  has_branding_element BOOLEAN,
  branding_description TEXT,
  ai_enhancement_recommended BOOLEAN,
  enhancement_actions TEXT[], -- ['perspective_correct', 'expand_background', 'blur_frame']
  
  -- Overall assessment
  lead_pool_worthy BOOLEAN,
  lead_pool_rank INT, -- 1-10 (1=best lead candidate)
  disqualifying_factors TEXT[],
  enhancement_potential_score INT, -- Can AI fix it?
  
  -- Metadata
  analyzed_by TEXT, -- 'gpt-4-vision' or 'claude-3.5-sonnet'
  confidence NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Training Prompt Template
```
You are a professional automotive photographer critiquing this vehicle photo.

VEHICLE: {year} {make} {model}
IMAGE_URL: {url}

Analyze for:
1. PERSPECTIVE: Is the ground level? Does the vehicle appear to dip or tilt?
2. COMPOSITION: Adequate breathing room? Distracting background elements?
3. BACKGROUND: Clean or heavy/cluttered? Any branding opportunities?
4. CROP: Too tight or spacious?
5. LIGHTING: Quality and consistency?

Rate each 0-100 and explain WHY this would/wouldn't work as a lead image.

If fixable with AI (perspective correction, background expansion), explain what needs fixing.

If it has unique value (branding element, special angle), note that even if technically flawed.

Return detailed critique with scores and recommendations.
```

## Implementation Priority

**Tier 1 (Now):**
- ✅ Quality-based sorting (best first)
- ⏳ Multiple images flagged as "lead pool worthy"

**Tier 2 (Soon):**
- Run AI critique on all images
- Build lead pool (top 3-5 images)
- Context-aware selection

**Tier 3 (Advanced):**
- AI enhancement pipeline
- User preference overrides
- Seller psychology scoring

**Ready to run AI critique on your C20 photos to demonstrate this?**

