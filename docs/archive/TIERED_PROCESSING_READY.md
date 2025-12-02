# Tiered Processing System - READY ✅

## The Smart Way to Process Thousands of Images

Instead of using expensive GPT-4o for everything, route images to appropriate models:

### Three Tiers

**Tier 1: Organization ($0.0001/image)**
- Angle detection (front, rear, side, 3/4)
- Category (exterior, interior, engine, undercarriage)
- Image quality assessment
- Major components (door, hood, fender)
- Basic condition
→ Process ALL 2,741 images = $0.27

**Tier 2: Specific Parts ($0.005/image)**  
- Detailed part identification
- Sheet metal vs structural
- Damage assessment
- Modification detection
→ Process ~1,500 good quality images = $7.50

**Tier 3: Expert Analysis ($0.02/image)**
- Paint quality (needs high-res)
- Engine bay expertise
- Interior materials
- Value assessments
→ Process ~500 high-res images = $10.00

**TOTAL: $17.77 (vs $54.82 for all GPT-4o)**
**SAVINGS: 67%**

## How It Works

```
Image → Check resolution → Route to tier

Low res (< 2MP)    → Tier 1 only (organize)
Medium (2-5 MP)    → Tier 1 + Tier 2 (parts)
High (> 5 MP)      → All tiers (expert)
```

## Run It

```bash
cd /Users/skylar/nuke
node scripts/tiered-batch-processor.js
```

## Output

```
PHASE 1: TIER 1 - BASIC ORGANIZATION
────────────────────────────────────
2,741 images × $0.0001 = $0.27

PHASE 2: TIER 2 - SPECIFIC PARTS  
────────────────────────────────────
1,500 images × $0.005 = $7.50

PHASE 3: TIER 3 - EXPERT ANALYSIS
────────────────────────────────────
500 images × $0.02 = $10.00

TOTAL: $17.77
SAVINGS: $37.05 (67%)
TIME: ~1.5 hours
```

## What You Get

After Tier 1:
✓ Every image organized by angle
✓ Categories assigned
✓ Quality rated
✓ Major components identified

After Tier 2:
✓ Specific parts cataloged
✓ Damage documented
✓ Modifications detected
✓ Sheet metal analyzed

After Tier 3:
✓ Paint quality assessed
✓ Expert condition ratings
✓ Value-impacting factors
✓ Authenticity verified

This is the smart way to scale!
