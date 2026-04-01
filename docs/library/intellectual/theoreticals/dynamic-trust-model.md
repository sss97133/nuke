# Dynamic Trust Model: Trust Is Earned, Measured, and Decays

**Status**: Theoretical — the static trust system exists; dynamic trust does not
**Date**: 2026-03-21, extended 2026-03-29
**Origin**: Founder insight on how quality compounds at every scale
**Companion**: papers/trust-scoring-methodology.md (the static system this extends)

---

## The Insight

> "B-J carries quality/confidence score — like oh they do really good reporting or they suck. Same goes down to individuals. Some hella hermit dude will be only using natural human verification methods. This is the system that values that guy."

Trust is not a label. Trust is a measurement. Every entity in the system — source, organization, individual observer, AI model, even the trust algorithm itself — produces claims that can be verified or falsified over time. The verification record IS the trust score.

---

## Part I: Who Gets a Trust Score

### Sources (observation_sources)
Barrett-Jackson, BaT, forums, Instagram. Currently: static `base_trust_score` assigned once. **160 sources** across 12 categories with scores ranging from 0.10 (OldCars.com) to 1.00 (iMessage, iPhoto). See trust-scoring-methodology.md for the full production table.

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

## Part VI: What Exists Today That Enables This

Before the implementation path, it is worth taking stock of what the static system has already built that the dynamic model can consume. This is not a greenfield project — significant infrastructure exists.

### Infrastructure Inventory (as of 2026-03-29)

| Component | Status | Scale | Relevance |
|-----------|--------|-------|-----------|
| `observation_sources` | Production | 160 sources, 12 categories | The entity that would gain dynamic trust scores |
| `vehicle_observations` | Production | 5.7M rows | Every row is a claim with `confidence_score`, `observed_at`, `source_id` |
| `field_evidence` | Production | 3.29M rows, 370K vehicles, 265 fields | Per-field provenance — the corroboration detection surface |
| `confidence_factors` (jsonb) | Production | On every observation | Audit trail of how trust was computed — essential for debugging dynamic adjustments |
| `bat_user_profiles` | Production | 520K usernames, 1K+ with stylometric profiles | Individual observer fingerprinting (see user-simulation methodology) |
| `comment_persona_signals` | Production | 2,787 rows, 40 traits | Per-commenter expertise signals — the raw material for individual trust |
| `author_personas` | Production | Linked to comment analysis | Commenter identity resolution across platforms |
| `auction_comments` | Production | 11.5M+ comments | The largest corpus of individual claims — each is a testable assertion |

### What's Missing for Dynamic Trust

1. **Corroboration detection.** No function currently compares observations from different sources on the same vehicle to detect agreement or disagreement. The data is there (5.7M observations, many vehicles have 3-10 sources), but the comparison engine does not exist.

2. **Observer identity resolution.** A BaT commenter named "porsche993guy" who also posts on Rennlist as "993enthusiast" — the system does not know these are the same person. `bat_user_profiles` tracks BaT identities; `author_personas` tracks comment authors; but no cross-platform identity graph links them.

3. **Per-claim attribution.** A description contains 15 claims (year, make, model, engine, transmission, color, mileage, condition of 8 components). The trust model scores the observation as a whole. Dynamic trust requires scoring each claim individually so that when a claim is contradicted, we can attribute the failure to the specific claim type, not the whole source.

4. **Retroactive adjustment.** When an observer's trust changes, all their past observations should be re-weighted. With 5.7M observations, this is a batch job that needs careful scheduling.

### The Corroboration Opportunity

The system already has multi-source coverage for many vehicles. A vehicle sold on BaT (description + 200 comments), previously listed on Craigslist, with VIN decoded by NHTSA, and photos analyzed by the vision pipeline — that is 4+ independent sources producing claims about the same entity. The overlap between these sources IS the corroboration dataset. It just needs to be compared systematically.

Rough scale estimate: 370K vehicles have field_evidence. If 10% have 3+ sources with overlapping field coverage, that is 37K vehicles with corroboration potential — more than enough to bootstrap dynamic trust.

---

## Part VI-B: Implementation Path

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

---

## Appendix: Distance from Theory to Production

| Dynamic Trust Feature | Static System Equivalent | Gap | Effort |
|----------------------|-------------------------|-----|--------|
| Per-source rolling accuracy | `base_trust_score` (static) | Need corroboration engine | Medium — compare overlapping field_evidence rows |
| Per-observer trust | None | Need observer identity + claim tracking | Large — requires cross-platform identity resolution |
| AI model trust tracking | `agent_tier` field on observations | Need per-model accuracy tracking | Small — observations already tag the model |
| Retroactive adjustment | None | Need batch re-scoring job | Medium — update `confidence_score` on past observations |
| Course correction reports | None | Need per-org claim accuracy aggregation | Medium — aggregate from corroboration results |
| Meta-trust (algorithm calibration) | None | Need sale-price-vs-prediction tracking | Large — requires valuation pipeline maturity |

The static system processes 5.7M observations with source-level trust. The dynamic system would process the same data with entity-level trust that evolves from corroboration evidence. The data volume is sufficient. The infrastructure (sources, observations, field_evidence, personas) is in place. The missing piece is the corroboration detection engine that compares claims across sources and attributes accuracy to specific observers.
