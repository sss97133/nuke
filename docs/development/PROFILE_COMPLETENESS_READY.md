# Profile Completeness Metric - READY ✅

## What It Does

Calculates how complete each vehicle profile is by checking data in ALL database tables.

## Scoring System (100 points total)

### Critical Data (40 points)
- vehicles_basic: 10 pts (year, make, model, VIN)
- vehicle_spid_data: 10 pts (factory specs)
- vehicle_images: 10 pts (10+ photos = full points)
- timeline_events: 10 pts (20+ events = full points)

### Important Data (30 points)
- receipts: 10 pts (10+ receipts = full points)
- reference_documents: 10 pts (manuals, brochures)
- image_tags: 5 pts (50+ tags = full points)
- vehicle_modifications: 5 pts (documented mods)

### Valuable Data (20 points)
- maintenance_records: 5 pts
- part_identifications: 5 pts (20+ identified)
- title_documents: 5 pts
- vehicle_validations: 5 pts

### Optional Data (10 points)
- certifications: 3 pts (NCRS, etc.)
- market_listings: 2 pts
- vehicle_awards: 2 pts
- expert_assessments: 3 pts

## Tiers

**80-100: COMPLETE** - Ready for professional appraisal
**60-79: EXCELLENT** - High confidence AI analysis
**40-59: GOOD** - Most questions answerable
**20-39: FAIR** - Basic analysis possible
**0-19: MINIMAL** - Need more documentation

## Usage

### In Code:
```typescript
import ProfileCompletenessCard from '../components/ProfileCompletenessCard';

// Add to vehicle profile page:
<ProfileCompletenessCard vehicleId={vehicleId} />
```

### Via API:
```typescript
const { data } = await supabase.functions.invoke('calculate-profile-completeness', {
  body: { vehicle_id: vehicleId }
});

console.log('Score:', data.completeness_score);
console.log('Tier:', data.tier);
console.log('Top priority:', data.priorities[0].action);
```

### In Dashboard:
```sql
-- See completeness across all vehicles
SELECT 
  v.id,
  v.year || ' ' || v.make || ' ' || v.model as vehicle,
  (
    -- Calculate inline score
    CASE WHEN v.year IS NOT NULL AND v.make IS NOT NULL 
         AND v.model IS NOT NULL AND v.vin IS NOT NULL 
         THEN 10 ELSE 0 END +
    CASE WHEN EXISTS(SELECT 1 FROM vehicle_spid_data WHERE vehicle_id = v.id) 
         THEN 10 ELSE 0 END +
    -- ... etc
  ) as completeness_score
FROM vehicles v
ORDER BY completeness_score DESC;
```

## What It Shows

Example output:
```json
{
  "vehicle_id": "abc123",
  "completeness_score": 67.5,
  "tier": "excellent",
  "tier_description": "Well-documented - high confidence analysis possible",
  
  "breakdown": {
    "vehicles_basic": { "score": 10, "maxScore": 10, "present": 4, "total": 4, "percent": 100 },
    "vehicle_spid_data": { "score": 10, "maxScore": 10, "present": 1, "total": 1, "percent": 100 },
    "vehicle_images": { "score": 8.5, "maxScore": 10, "present": 17, "total": 10, "percent": 100 },
    "receipts": { "score": 6, "maxScore": 10, "present": 6, "total": 10, "percent": 60 }
    // ... etc
  },
  
  "priorities": [
    {
      "table": "receipts",
      "value": 4.0,
      "action": "Upload 4 more receipts for complete documentation",
      "impact": "Validates modifications and work history"
    },
    {
      "table": "reference_documents",
      "value": 10.0,
      "action": "Upload factory manual or brochure",
      "impact": "Enables correctness verification"
    }
  ],
  
  "context_implications": {
    "image_processing_cost": "low",
    "confidence_level": "high",
    "ready_for_professional_appraisal": false
  }
}
```

## How It Drives Better Processing

**Score < 30 (Poor Context):**
- Image processing costs $0.02/image
- Low confidence answers
- Expensive model needed to identify gaps

**Score 30-60 (Good Context):**
- Image processing costs $0.005/image
- Medium confidence
- Can use cheap models with guidance

**Score 60+ (Rich Context):**
- Image processing costs $0.0001/image (200x cheaper!)
- High confidence
- Cheap models just confirm what's known

## Add to Dashboard

I created the component. Just add to any vehicle page:

```typescript
<ProfileCompletenessCard vehicleId={vehicle.id} />
```

It shows:
- Score with tier badge
- Progress bar
- Processing cost implications
- Top 3 priorities to improve
- Detailed breakdown (expandable)

**This metric drives users to add documentation, which makes processing cheaper!**
