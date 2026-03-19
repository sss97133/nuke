# Evidence Chain Mathematics

## Why This Beats Star Ratings — Proof

### The Fundamental Problem with Ratings

A 5-star rating system stores **1 scalar per review**. Given n reviews:

```
score_stars = Σ(ratings) / n
```

This collapses all information about quality into a single number. It cannot answer:
- "Can this shop rebuild a 4L80E?" (capability-specific)
- "Have they done it recently?" (recency)
- "Can they prove it?" (evidence)
- "Am I ready to take on this job?" (gap analysis)
- "What would it take to get ready?" (actionable path)

### Evidence Chain Confidence — The Equations

#### Equation 1: Actor Capability Confidence

For an actor `a` performing capability `c` at complexity tier `t`:

```
confidence(a, c, t) = evidence_weight(a,c,t) × compliance_rate(a,c,t) × recency(a,c,t) × corroboration(a,c,t)
```

Where:

```
evidence_weight(a,c,t) = min(1.0, evidence_count(a,c,t) / saturation_threshold(c,t))

  evidence_count = SELECT COUNT(*)
                   FROM component_events ce
                   JOIN work_order_line_items woli ON woli.component_event_id = ce.id
                   WHERE ce.actor_id = a
                     AND woli.task_type ∈ capability_task_map(c)
                     AND complexity(woli) >= t

  saturation_threshold(c,t) = {
    basic:        3 documented jobs
    intermediate: 8 documented jobs
    advanced:    20 documented jobs
    expert:      50 documented jobs
    master:     100 documented jobs
  }
```

```
compliance_rate(a,c,t) = AVG over jobs of:
  CASE
    WHEN spec_target IS NULL THEN 0.7  -- no spec to measure against, neutral
    WHEN |spec_achieved - spec_target| <= tolerance(c) THEN 1.0  -- met spec
    ELSE max(0, 1.0 - |deviation| / spec_target)  -- proportional penalty
  END

  Example: bore target 4.030", tolerance ±0.001"
    achieved 4.0305" → |deviation| = 0.0005 → within tolerance → 1.0
    achieved 4.0325" → |deviation| = 0.0015 → exceeds by 0.0005 → 1.0 - 0.0005/4.030 = 0.9999
    achieved 4.040"  → |deviation| = 0.010  → 1.0 - 0.010/4.030 = 0.9975
```

```
recency(a,c,t) = e^(-λ × days_since_last_demonstrated)

  λ = 0.001 (half-life ≈ 693 days ≈ 1.9 years)

  Today:     1.000
  6 months:  0.835
  1 year:    0.694
  2 years:   0.483
  5 years:   0.161
  10 years:  0.026
```

```
corroboration(a,c,t) = distinct_evidence_types / max_evidence_types

  evidence types: {photo, measurement, receipt, invoice, witness, inspection_report,
                   customer_testimony, dyno_sheet, alignment_printout, paint_meter_reading}

  max_evidence_types = 5 (diminishing returns above 5 independent sources)

  Example: bore job with photo + micrometer reading + invoice = 3/5 = 0.60
  Example: full engine build with dyno sheet + photos + receipts + inspection + testimony = 5/5 = 1.0
```

#### Equation 2: Organization Capability Confidence

```
confidence(org, c, t) =
  MAX over active_members(org) of: confidence(actor, c, t)
  × workforce_depth(org, c, t)
  × equipment_factor(org, c)
  × continuity_factor(org)
```

```
workforce_depth(org, c, t) = min(1.0, capable_members(org,c,t) / required_headcount(c,t))

  capable_members = COUNT(actors WHERE org_membership.active
                          AND confidence(actor, c, t) >= 0.5)

  required_headcount = {
    basic tasks: 1
    intermediate: 1
    advanced: 1
    expert: 2 (need backup/QC)
    master: 2
  }
```

```
equipment_factor(org, c) =
  COUNT(required_tools(c) ∩ org_tools) / COUNT(required_tools(c))

  Example: CNC machining requires {cnc_mill, precision_measurement, honing_machine}
  Shop has {cnc_mill, precision_measurement} → 2/3 = 0.667
```

```
continuity_factor(org) = min(1.0, years_documented_history / 5)

  New shop (0 years): 0.0
  1 year history: 0.2
  3 years: 0.6
  5+ years: 1.0
```

#### Equation 3: Readiness Assessment ("Am I Ready?")

```
readiness(entity, job) = MIN over required_capabilities(job) of:
  confidence(entity, capability, required_tier)

gap(entity, job) = [
  {
    capability: c,
    required_tier: t,
    current_confidence: confidence(entity, c, t),
    shortfall: max(0, threshold - confidence(entity, c, t)),
    remediation: suggest_remediation(entity, c, t)
  }
  FOR c, t IN required_capabilities(job)
  WHERE confidence(entity, c, t) < threshold
]
```

```
threshold = 0.6 (default — adjustable by risk tolerance)

suggest_remediation(entity, c, t):
  IF evidence_count < saturation_threshold / 2:
    → "Need more documented jobs at this tier"
  IF compliance_rate < 0.8:
    → "Spec compliance needs improvement — consider training/mentorship"
  IF recency > 2 years:
    → "Capability stale — do a warmup job before committing"
  IF corroboration < 0.4:
    → "Need better documentation of existing work"
  IF equipment_factor < 0.8:
    → "Missing tools: " + list(required_tools - current_tools)
```

#### Equation 4: Job ROI Projection

```
projected_roi(actor, job) =
  (projected_revenue(job) - projected_cost(job)) / projected_cost(job)

projected_revenue(job) = quoted_price

projected_cost(job) =
  labor_cost(actor, job) + parts_cost(job) + overhead_cost(actor, job)

labor_cost = estimated_hours(job, actor) × hourly_rate(actor)

estimated_hours(job, actor) =
  base_hours(job_type, complexity)
  × efficiency_factor(actor, job_type)
  × risk_factor(readiness(actor, job))

efficiency_factor(actor, job_type) =
  AVG(actual_hours / estimated_hours)
  FROM past work_orders WHERE actor_id = actor AND job_type matches
  DEFAULT 1.0 if no history

risk_factor(readiness) = {
  readiness >= 0.9: 1.0   (on schedule)
  readiness >= 0.7: 1.15  (15% buffer for learning curve)
  readiness >= 0.5: 1.35  (35% buffer — likely delays)
  readiness <  0.5: 1.60  (60% buffer — high risk of overrun)
}

overhead_cost = daily_overhead_rate × estimated_days
daily_overhead_rate = (rent + utilities + insurance + tool_depreciation) / working_days_per_month
```

#### Equation 5: Vehicle Component Confidence

```
component_confidence(vehicle, component) =
  evidence_count(vehicle, component)
  × source_diversity(vehicle, component)
  × measurement_precision(vehicle, component)
  × temporal_consistency(vehicle, component)
```

```
source_diversity = COUNT(DISTINCT source_type) / max_source_types
  source_types: {description_claim, photo_visual, vin_decode, document_ocr,
                 expert_inspection, measurement, parts_receipt, forum_discussion}

measurement_precision = AVG(
  CASE evidence_type
    WHEN 'measurement' THEN 1.0     -- direct measurement (micrometer reading)
    WHEN 'document_ocr' THEN 0.9    -- OCR of build sheet/tag
    WHEN 'vin_decode' THEN 0.85     -- VIN-based inference
    WHEN 'expert_inspection' THEN 0.80
    WHEN 'photo_visual' THEN 0.70   -- visual identification from photo
    WHEN 'description_claim' THEN 0.50  -- seller's claim, no proof
    WHEN 'forum_discussion' THEN 0.40
  END
)

temporal_consistency =
  CASE
    WHEN all evidence agrees across time THEN 1.0
    WHEN recent evidence contradicts old THEN 0.5 (flag for investigation)
    WHEN evidence is from single point in time THEN 0.8
  END
```

### Information Theory Comparison

```
STAR RATING:
  information_content = log2(5) = 2.32 bits per review
  total_signal = 2.32 × n reviews

  100 reviews = 232 bits of information about an entity

EVIDENCE CHAIN (per documented job):
  capability_type: log2(70) = 6.13 bits
  complexity_tier: log2(5) = 2.32 bits
  spec_compliance: continuous 0-1 = ~10 bits at 0.001 resolution
  recency: continuous = ~10 bits
  corroboration: 5 binary signals = 5 bits
  actor identity: log2(n_actors) ≈ 15 bits
  component identity: log2(n_components) ≈ 12 bits

  Per job: ~60 bits of structured, verifiable information

  100 jobs = 6,000 bits of information about an entity

  RATIO: 6,000 / 232 = 25.8× more information per unit of input
```

**Evidence chains carry 26× more information than star ratings, and every bit is verifiable.**

### The Equations We Can Write Today

Given the current schema (actors, component_events, work_orders, work_order_line_items, actor_capabilities, org_capabilities, gap_analysis_results), these equations translate directly to SQL functions:

1. `calculate_actor_confidence(actor_id, capability, tier)` → NUMERIC
2. `calculate_org_confidence(org_id, capability, tier)` → NUMERIC
3. `assess_readiness(entity_type, entity_id, job_requirements JSONB)` → JSONB
4. `project_roi(actor_id, job_spec JSONB)` → JSONB
5. `calculate_component_confidence(vehicle_id, component_table)` → NUMERIC
6. `identify_gaps(entity_type, entity_id, target_tier)` → JSONB
7. `rank_actors_for_job(job_requirements JSONB, location, radius_miles)` → TABLE
8. `rank_orgs_for_job(job_requirements JSONB, location, radius_miles)` → TABLE

These are deterministic. No AI needed. Pure math on structured data.
