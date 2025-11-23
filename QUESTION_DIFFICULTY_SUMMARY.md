# Question Difficulty Routing - The Better Way

## Key Insight

**Route by what you're asking, not just image resolution.**

## The Problem with Resolution-Based Routing

Resolution approach:
- Low-res → cheap model
- High-res → expensive model

But this misses the point! Some questions are easy regardless of resolution:
- "What angle is this?" - Trivial (works on any resolution)
- "What color?" - Easy (works on phone camera)
- "Is this exterior or interior?" - Obvious

Other questions need expertise regardless of resolution:
- "Is this paint factory original?" - Expert knowledge required
- "Does this meet NCRS judging standards?" - Professional training needed

## Question Difficulty Levels

### Level 1: Trivial ($0.0001)
- Angle detection
- Category (exterior/interior/engine)
- Color
- Indoor/outdoor
→ Use FREE or ultra-cheap models

### Level 2: Simple ($0.001)
- Major components (hood, door, fender)
- Basic condition (good/fair/poor)
- Work type (brake work, engine work)
→ Use gpt-4o-mini

### Level 3: Moderate ($0.005)
- Specific part ID (alternator, carburetor)
- Aftermarket detection
- Damage assessment
→ Use gpt-4o-mini with context

### Level 4: Expert ($0.02)
- Factory correctness
- Paint originality
- NCRS judging criteria
- Authenticity verification
→ Use gpt-4o with full context + standards

### Level 5: Human Required
- Final NCRS scoring
- Professional appraisal values
- Fraud detection
→ Flag for human expert

## Database Tables Drive Routing

**Easy Tables** (route to cheap):
- vehicle_images.angle
- vehicle_images.category
- vehicle_images.primary_color

**Moderate Tables** (route to mid):
- part_identifications
- vehicle_modifications
- damage_assessments

**Hard Tables** (route to expensive):
- factory_correctness_assessment
- ncrs_judging_deductions
- authenticity_scores

## Professional Standards: NCRS Judging

Use actual professional appraisal standards like:

**NCRS (National Corvette Restorers Society)**
- 1,000 point scoring system
- Factory correctness verification
- Specific deduction rules
- Reference manuals and specs

**Questions based on NCRS:**
- "Hood to fender gap: 3/16" ± 1/16" acceptable?"
- "Paint orange peel consistent with 1967 factory?"
- "Engine casting numbers correct for build date?"

## Cost Comparison

**Resolution-based:** $17.77 (67% savings)
**Question difficulty:** $11.27 (79% savings!)

**Why better?**
- 99% of images only need trivial/simple questions ($2.27)
- Expert questions only for complex assessments ($4.00)
- More targeted = Better efficiency

## Next Steps

1. Digitize NCRS Judging Guide
2. Map database tables to question difficulty
3. Route based on what we're asking
4. Reserve expensive models for expert questions only

**Route smart, not just by pixels!**
