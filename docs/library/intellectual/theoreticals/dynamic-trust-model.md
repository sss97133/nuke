# Dynamic Trust Model: Trust Is Earned, Measured, and Decays

**Status**: Theoretical — the static trust system exists; dynamic trust does not
**Date**: 2026-03-21
**Origin**: Founder insight on how quality compounds at every scale

---

## The Insight

> "B-J carries quality/confidence score — like oh they do really good reporting or they suck. Same goes down to individuals. Some hella hermit dude will be only using natural human verification methods. This is the system that values that guy."

Trust is not a label. Trust is a measurement. Every entity in the system — source, organization, individual observer, AI model, even the trust algorithm itself — produces claims that can be verified or falsified over time. The verification record IS the trust score.

---

## Part I: Who Gets a Trust Score

### Sources (observation_sources)
Barrett-Jackson, BaT, forums, Instagram. Currently: static `base_trust_score` assigned once.
**Should be**: rolling accuracy rate. If BaT listings consistently produce claims that are corroborated by inspections, BaT's trust goes up. If forum comments are frequently contradicted, forum trust goes down.

### Organizations
A restoration shop that produces vehicles with claims that hold up at auction gets higher trust on condition reports. A dealer who lists cars with inflated descriptions that get challenged in comments gets lower trust.

### Individual Observers
The hermit with 40 years of Porsche knowledge who calls engine codes from photos — if his claims are corroborated by VIN decode and build sheets, his trust climbs toward expert-tier. He doesn't need credentials. He needs a track record.

An AI model (Claude Haiku, Qwen 2.5) that extracts facts — if its extractions are consistently confirmed by other sources, its trust multiplier increases. If it hallucinates, it drops.

### The Trust Algorithm Itself
Meta-trust: does the trust scoring system produce good outcomes? If vehicles with high-trust composite scores sell at prices matching their estimated value range, the trust algorithm is calibrated. If they consistently sell above or below, the algorithm itself needs adjustment. This is self-referential quality measurement.

---

## Part II: The Feedback Loop

```
Observer makes claim
  → Claim enters observation system with observer's current trust weight
  → Over time, new evidence arrives (inspection, sale, other observers)
  → If claim is corroborated → observer trust increases
  → If claim is contradicted → observer trust decreases
  → Updated trust weight applies to ALL future claims from this observer
  → AND retroactively adjusts weight of past claims from this observer
```

### The Formula

```
trust_score(observer, t) = base_trust
  × (1 + 0.05 × corroboration_count − 0.10 × contradiction_count)
  × consistency_factor
```

Where:
- `corroboration_count` = number of this observer's claims corroborated by independent sources
- `contradiction_count` = number contradicted
- `consistency_factor` = standard deviation of accuracy across claim categories (lower = more consistent = higher trust)
- Clamped to [0.10, 0.99] — nobody gets absolute trust, nobody gets ignored entirely

### Why the Asymmetry

Contradictions weigh 2x more than corroborations (−0.10 vs +0.05). This is intentional:
- It's easy to make safe, obvious claims that get corroborated ("it's a V8")
- It's the wrong calls that reveal calibration
- One false "matching numbers" claim is more damaging than ten correct "color is red" claims
- The system should be skeptical by default, earning trust slowly

---

## Part III: Scale Independence

This model works at every scale:

**Individual level**: A single forum commenter builds trust claim by claim. After 50 corroborated claims, they carry weight comparable to a professional inspector.

**Organization level**: Barrett-Jackson as a source. Their catalog descriptions are claims. If their descriptions consistently match what the vehicle actually is (confirmed by post-sale inspections, owner reports), B-J trust climbs. If they frequently misdescribe vehicles, it drops. Then we can TELL them: "Your descriptions for pre-1970 muscle cars have a 23% contradiction rate on engine specifications. Here's what you're getting wrong."

**Platform level**: BaT as a platform. Trust computed from aggregate observer accuracy of its user base. If BaT commenters as a group are more accurate than forum commenters, BaT trust rises above forum trust — not because we assigned it, but because the data shows it.

**AI model level**: Claude Haiku vs Qwen 2.5. If Claude's extractions are corroborated at 85% and Qwen's at 72%, Claude gets a higher trust multiplier. This is empirical model evaluation — no benchmarks needed, just production corroboration tracking.

**Algorithm level**: Does the trust algorithm itself produce good outcomes? If vehicles with composite observation scores > 0.80 consistently sell within their value surface range, the algorithm is calibrated. If not, the algorithm parameters need adjustment. The algorithm earns trust the same way observers do — by being right.

---

## Part IV: The Course Correction Signal

> "B-J ok so they suck but let's alert them and help them course correct. Then they scale and boom they become gold star triple-S tier."

The trust score isn't just a number — it's a coaching signal. When an organization's trust drops:

1. **Identify the pattern**: which claim categories are failing? (engine specs? condition? provenance?)
2. **Generate actionable feedback**: "Your condition descriptions for 1960-1975 convertibles have a 34% contradiction rate. The most common error is claiming 'excellent chrome' when post-sale inspections find pitting."
3. **Provide the fix**: "Here are 12 specific listings where your chrome condition claims were contradicted. Review these to calibrate your grading."
4. **Track improvement**: if they fix it, trust climbs. If they don't, trust stays low. The system doesn't punish — it measures.

This is the product moat. No other platform tells auction houses where their descriptions are inaccurate. Nuke does, because Nuke has the multi-source corroboration data to measure it.

---

## Part V: The Hermit Advantage

> "Some hella hermit dude will be only using natural human verification methods. This is the system that values that guy."

The traditional automotive world trusts credentials: ASE certification, concours judge appointment, dealership affiliation. These are input-based trust signals — they measure preparation, not performance.

The dynamic trust model is output-based. It measures whether your claims hold up. A certified mechanic who consistently gets engine specs wrong has lower trust than an uncertified hobbyist who's always right. The system doesn't care about your resume. It cares about your track record.

This inverts the power dynamic. The 65-year-old guy who's been working on Chevelles since 1972, who "just knows" what's original and what's not — his claims get corroborated by build sheets and VIN decodes at 95%. His trust score climbs to 0.90. He doesn't need a credential. He needs to keep being right.

The institution that rubber-stamps condition reports without careful inspection — their claims get contradicted at 30%. Their trust drops to 0.55. They can fix it by doing better work, or they can stay at 0.55. Their choice.

---

## Part VI: Implementation Path

### Phase 1: Observer Tracking Table
```sql
CREATE TABLE observer_trust_scores (
  observer_id uuid PRIMARY KEY,           -- FK to external_identities or users
  observer_type text,                      -- 'individual', 'organization', 'ai_model', 'platform'
  base_trust numeric DEFAULT 0.50,         -- starting point
  current_trust numeric DEFAULT 0.50,      -- computed from track record
  corroboration_count int DEFAULT 0,
  contradiction_count int DEFAULT 0,
  total_claims int DEFAULT 0,
  accuracy_rate numeric,                   -- corroborations / total_evaluated
  last_evaluated_at timestamptz,
  trust_trend text,                        -- 'rising', 'stable', 'falling'
  category_accuracy jsonb,                 -- per-category breakdown
  created_at timestamptz DEFAULT now()
);
```

### Phase 2: Corroboration Tracking
Every time a claim is corroborated or contradicted, update the observer's score:
```sql
CREATE OR REPLACE FUNCTION update_observer_trust()
  RETURNS trigger AS $$
BEGIN
  -- When a new observation corroborates an existing one,
  -- update the original observer's trust score
  -- ...
END;
$$ LANGUAGE plpgsql;
```

### Phase 3: Trust-Weighted Queries
Replace static `base_trust_score` with `observer_trust_scores.current_trust` in the effective weight computation.

### Phase 4: Coaching Reports
Generate monthly reports per organization:
- Claims made, claims evaluated, accuracy rate
- Category breakdown (specs, condition, provenance)
- Trend (improving/declining)
- Specific contradictions with evidence

---

## Part VII: Measuring the Algorithm

> "Is our trust score algorithm any good or does it get things wrong — that's a measure on if it's heading toward deprecation or not."

The trust algorithm earns trust the same way observers do:

```
algorithm_accuracy = count(predictions within ±10% of actual sale price)
                   / count(predictions made)
```

If the trust-weighted composite consistently produces values that predict sale outcomes, the algorithm is well-calibrated. If not, it needs parameter tuning.

The specific parameters to monitor:
- **corroboration_boost** (currently +0.05): too high = credulous, too low = slow to learn
- **contradiction_penalty** (currently −0.10): too high = brittle, too low = forgiving of errors
- **decay_rate** per category: do the half-lives match reality? If 2-year-old condition reports are still accurate, the half-life should be longer
- **trust_floor** (0.10): should any observer's trust go to zero?

All of these are measurable from production data once sufficient corroboration volume accumulates (~10K+ evaluated claims).

---

*This paper extends the static trust model from the observation system into a dynamic, self-calibrating system. The philosophical claim: quality is not declared, it is accumulated. The practical claim: every entity in the system — from a forum commenter to Barrett-Jackson to the trust algorithm itself — should earn its trust through a verifiable track record.*
