# Data Quality Algorithms

## Overview

Nuke implements sophisticated algorithms to ensure data integrity, accuracy, and provenance tracking. Every data point in the system carries metadata about its source, confidence level, and verification history.

## Confidence Scoring Algorithm

### Base Confidence by Source Type

```typescript
const SOURCE_WEIGHTS = {
  title_document: 1.00,      // Legal proof of ownership
  professional_cert: 0.95,   // ASE/manufacturer certified
  expert_consensus: 0.85,    // Multiple verified experts agree
  user_claim: 0.75,          // Single user contribution
  ai_detection: 0.30         // Base AI confidence (boosted by context)
}
```

### Cross-Validation Boost

When multiple independent sources provide matching data:

```typescript
confidence_boost = min(0.20, detection_count * 0.05)
final_confidence = base_confidence + confidence_boost
validation_status = confidence >= 0.80 ? 'cross_validated' : 'single_source'
```

**Example:**
- Engine detected in 4 photos from same session
- Base confidence: 74%, 76%, 81%, 84%
- Cross-validation boost: 4 × 5% = 20%
- Final confidence: 94%, 96%, 99%, 99%
- Status: `cross_validated`

## Computer Vision Confidence Boosting

### Context-Aware Adjustments

AI detections receive confidence boosts based on context:

```typescript
const DETECTION_BOOSTS = {
  // Critical components - higher threshold
  engine: 0.30,
  transmission: 0.30,
  rust: 0.25,
  
  // Structural components
  frame: 0.20,
  suspension: 0.15,
  
  // Common parts - lower boost
  wheel: 0.10,
  tire: 0.05,
  generic_car: 0.05
}
```

### Photo Session Clustering

Images from the same work session receive higher cross-validation weight:

```typescript
function clusterPhotoSession(images) {
  return images.filter(img => 
    Math.abs(img.timestamp - reference_time) < 3600 && // Within 1 hour
    img.location_distance < 100                         // Within 100m
  )
}
```

## Consensus Algorithm

### Multi-Contributor Validation

When multiple users provide data for the same field:

```typescript
function calculateConsensus(contributions) {
  const grouped = groupByValue(contributions)
  const majority = findMajority(grouped)
  
  if (majority.count >= 3 && majority.ratio >= 0.66) {
    return {
      value: majority.value,
      confidence: 0.85 + (majority.count * 0.03), // Max 0.95
      validation_type: 'consensus'
    }
  }
  
  return {
    value: highest_confidence.value,
    confidence: highest_confidence.score,
    validation_type: 'single_source'
  }
}
```

## Data Quality Score

### Overall Vehicle Data Quality

Letter grade (A+ through F) based on:

```typescript
function calculateDataQuality(vehicle) {
  const weights = {
    source_diversity: 0.30,    // Multiple independent sources
    field_coverage: 0.25,      // % of fields populated
    verification_depth: 0.25,  // Cross-validated vs single-source
    temporal_consistency: 0.20 // Timeline makes sense
  }
  
  const score = 
    (sourceDiversity * weights.source_diversity) +
    (fieldCoverage * weights.field_coverage) +
    (verificationDepth * weights.verification_depth) +
    (temporalConsistency * weights.temporal_consistency)
    
  return assignLetterGrade(score)
}
```

**Letter Grade Mapping:**
- A+ : 97-100% (Title + Professional + Multi-user verification)
- A  : 93-96%  (Title + Professional verification)
- A- : 90-92%  (Title + Some professional data)
- B+ : 87-89%  (Professional verification, no title)
- B  : 83-86%  (Multiple users, good consensus)
- B- : 80-82%  (Some verification, decent coverage)
- C+ : 75-79%  (Mostly single-source, reasonable coverage)
- C  : 70-74%  (Limited verification)
- D  : 60-69%  (Minimal data, low confidence)
- F  : <60%    (Insufficient data quality)

## Temporal Consistency Validation

### Timeline Event Validation

Events are checked for logical consistency:

```typescript
function validateTimelineConsistency(events) {
  const violations = []
  
  // Check: Vehicle can't be sold before purchase
  if (sale_date < purchase_date) {
    violations.push('temporal_violation')
  }
  
  // Check: Modifications require parts
  const mod = events.find(e => e.type === 'modification')
  if (mod && !hasMatchingReceipts(mod.date, 30)) {
    violations.push('missing_evidence')
  }
  
  // Check: Photos should match timeline claims
  if (claimed_restoration && !hasProgressPhotos()) {
    violations.push('unsupported_claim')
  }
  
  return {
    is_consistent: violations.length === 0,
    violations
  }
}
```

## Price Intelligence Algorithm

### Multi-Factor Valuation

```typescript
function calculatePrice(vehicle) {
  const weights = {
    market_data: 0.40,        // Recent comparable sales
    ai_analysis: 0.30,        // Condition and modifications
    modifications: 0.20,      // Parts and labor invested
    condition: 0.10           // Current state assessment
  }
  
  const market_base = getComparableSales(vehicle)
  const ai_adjustment = analyzeCondition(vehicle)
  const mod_value = calculateModificationValue(vehicle)
  const condition_factor = assessCondition(vehicle)
  
  return (
    (market_base * weights.market_data) +
    (ai_adjustment * weights.ai_analysis) +
    (mod_value * weights.modifications) +
    (condition_factor * weights.condition)
  )
}
```

### Modification Value Assessment

Not all modifications add value:

```typescript
function calculateModificationValue(mods) {
  return mods.reduce((total, mod) => {
    const value_retention = {
      oem_plus: 0.70,           // OEM+ parts retain 70% of cost
      performance: 0.50,        // Performance mods 50%
      aesthetic: 0.30,          // Visual mods 30%
      custom: 0.20,             // Custom work 20%
      reversible: multiplier    // Reversible = higher retention
    }
    
    return total + (mod.cost * value_retention[mod.category])
  }, 0)
}
```

## Real-Time Data Quality Monitoring

### Live Quality Metrics

```typescript
interface DataQualityMetrics {
  overall_score: number;           // 0-100
  source_breakdown: {
    title: number;
    professional: number;
    human: number;
    ai: number;
  };
  verification_status: {
    cross_validated: number;
    single_source: number;
    unverified: number;
  };
  improvement_suggestions: string[];
}
```

### Improvement Recommendations

System actively suggests quality improvements:

```typescript
function suggestImprovements(vehicle) {
  const suggestions = []
  
  if (!hasTitleDocumentation(vehicle)) {
    suggestions.push({
      priority: 'high',
      action: 'Upload title document',
      impact: '+15% confidence'
    })
  }
  
  if (ai_only_fields.length > 5) {
    suggestions.push({
      priority: 'medium',
      action: 'Verify AI-detected data',
      impact: '+10% confidence per field'
    })
  }
  
  if (!hasProgressPhotos(vehicle)) {
    suggestions.push({
      priority: 'low',
      action: 'Add timeline photos',
      impact: 'Better verification'
    })
  }
  
  return suggestions
}
```

## Implementation Notes

All algorithms are:
- **Deterministic**: Same inputs always produce same outputs
- **Auditable**: Every calculation is logged
- **Tuneable**: Weights and thresholds are configuration
- **Explainable**: Users see why confidence scores are what they are

---

**These algorithms ensure data quality is maintained at scale while remaining transparent to users.**

