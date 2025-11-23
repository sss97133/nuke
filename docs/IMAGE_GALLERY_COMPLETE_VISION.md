# Image Gallery - Complete Vision

## Tier 1: IMMEDIATE NEEDS (Build Now)

### Basic Date Grouping
**Problem:** Oct 16 | Oct 16 | Oct 16 (repeated dates on every thumbnail)  
**Solution:** Group by date with headers

```
JANUARY 19, 2024 • 1 photo
[photo - PRIMARY]

JANUARY 9, 2024 • 2 photos
[photo] [photo]

JANUARY 6, 2024 • 6 photos
[photo] [photo] [photo] [photo] [photo] [photo]
```

**Implementation:** SimpleImageViewer pattern (already works)

### Upload Feedback
**Problem:** "Left in the dark" - no confirmation after upload  
**Solution:** Show success message, photo count, which date they went to

## Tier 2: BEST LIGHT PRESENTATION (Next Priority)

### Hero Shot Selection
For **selling/listing mode**, show vehicle in best light:

**Layout:**
1. **Lead shot** (largest) - Best front quarter angle
2. **Exterior walkthrough** - Systematic angles (front → sides → rear)
3. **Interior main views** - Dashboard, seats, cabin
4. **Engine bay** - Full view, details
5. **Undercarriage** - Main structural views

**Classification needed:**
- `front_quarter_driver` (essential hero shot #1)
- `front_quarter_passenger` (essential hero shot #2)
- `side_driver`, `side_passenger`
- `rear_quarter_driver`, `rear_quarter_passenger`
- etc.

**Current status:**
- Tables exist: `ai_angle_classifications_audit`, `image_coverage_angles`
- Scripts exist: `ai-tag-image-angles` edge function
- Only 19% of images classified (527/2,736)
- **Your C20: 0/9 images classified**

## Tier 3: PHOTO FORENSICS (Advanced - Future)

### Seller Psychology Detection

**What photos reveal beyond the vehicle:**

#### Coverage Analysis
- **Complete walkaround** = Confident, honest seller
- **Missing angles** = Hiding damage (what's NOT shown?)
- **Strategic gaps** = Intentional deception

#### Quality Signals
- **Professional lighting** = Dealer/serious seller
- **Consistent angles** = Methodical, trustworthy
- **Random snapshots** = Amateur/desperate
- **Glamour shots only** = Flipper hiding issues

#### Damage Visibility
- **Shows rust/damage clearly** = Honest disclosure
- **Hides problem areas** = Deceptive
- **Close-ups of repairs** = Transparent about work done
- **No undercarriage** = Hiding structural issues

#### Device IMEI Analysis
- **Unknown professional camera** (Canon EOS) = Dealer photographer
- **iPhone same owner** = Personal documentation
- **Multiple unknown devices** = Multiple sellers/flippers (red flag)
- **Ghost user pattern** = Consignment/dealer inventory

### AI Prompts for Forensics

**Prompt 1: Coverage Completeness**
```
Analyze these photos for what's MISSING:
- Vehicle: 1976 Chevrolet C20
- Photos provided: [list]
- Essential angles present: front_quarter_driver, side_passenger
- Essential angles MISSING: rear_quarter_driver, undercarriage, engine_bay

QUESTION: What is the seller AVOIDING showing you?
ANSWER: Missing undercarriage and rear angles suggest structural rust or frame damage being hidden. Missing engine bay suggests mechanical issues.
CONFIDENCE: 75% - Pattern consistent with deceptive flipper behavior.
```

**Prompt 2: Photography Quality**
```
Analyze photography quality to infer seller profile:
- Lighting: [Consistent | Mixed | Poor]
- Framing: [Professional | Decent | Amateur]
- Angles: [Complete system | Partial | Random]
- Focus quality: [Sharp throughout | Some blurry | Mostly blurry]

SELLER PROFILE: Professional dealer - Methodical photography, complete angles, studio lighting
INTENT: Serious sale with honest disclosure
CONFIDENCE: 90%
```

**Prompt 3: Damage Disclosure**
```
Review how damage is presented:
- Rust visible: [Yes | No | Unclear]
- Damage shown in close-up: [Yes | No]
- Problem areas avoided: [List]

HONESTY SCORE: 85/100
- Shows surface rust clearly
- Documents dents honestly
- Missing undercarriage (moderate concern)
```

## Implementation Priority

### NOW (Tier 1):
1. ✅ **Date grouping** in gallery
2. ✅ **Upload confirmation** feedback
3. ✅ **Auto-group photos** into timeline events

### SOON (Tier 2):
1. ⏳ **Run AI angle classification** on upload
2. ⏳ **Hero shot detection** and hierarchy display
3. ⏳ **"Best light" presentation mode** for listings

### FUTURE (Tier 3):
1. ⏳ **Photo forensics** - detect deception
2. ⏳ **Seller psychology** scoring
3. ⏳ **Coverage gap analysis** - what's hidden?
4. ⏳ **Trust score** based on photography patterns

## Current C20 Status

**Photos:** 9 images from January 2024
- All UNCLASSIFIED (no angle data)
- Grouped into 3 timeline events by date
- Need AI analysis to understand what they show

**Next action:** Should I run AI classification on these 9 photos NOW to demonstrate the system?

