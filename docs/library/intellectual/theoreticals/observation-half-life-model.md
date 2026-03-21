# Observation Half-Life Model: Data as Testimony with Temporal Decay

**Status**: Theoretical -- the observation system exists but treats all observations as equally current
**Author**: Nuke Research
**Date**: 2026-03-20
**Dependencies**: Observation system (partially deployed), source trust hierarchy
**Domain**: Universal (automotive, art, publishing, all future verticals)

---

## Abstract

Every observation in the Nuke graph is testimony. It is a claim made by a source at a specific moment about something in the world. Like all testimony, it begins to age the moment it is given. Some testimony ages slowly: a VIN stamped into a firewall is as true in 2026 as it was in 1970. Other testimony ages rapidly: a seller's claim that a vehicle "runs great" begins decaying the moment the ad is posted.

This paper formalizes the observation half-life model: the mathematical framework for computing how much an observation's relevance has decayed since it was recorded. It defines half-lives by observation category, the decay function itself, the interaction between half-life and source trust, the rules for resolving conflicting observations from different time periods, and the edge cases where the model breaks down.

The fundamental claim: treating all data as equally current is a category error. A condition report from 2019 is not the same data as a condition report from 2025. The half-life model encodes this temporal dimension into every computation that depends on observation data -- signal calculation, valuation, entity resolution, and display priority.

---

## Part I: The Decay Function

### 1.1 Core Definition

The current relevance of an observation is modeled as exponential decay from the moment it was recorded.

```
Relevance(observation, t) = exp(-lambda * (t - t_obs))
```

Where:
- **t** is the current time
- **t_obs** is the timestamp of the observation
- **lambda** = ln(2) / half_life, the decay constant

At t = t_obs (the moment the observation is recorded), relevance = 1.0.
At t = t_obs + half_life, relevance = 0.50.
At t = t_obs + 2 * half_life, relevance = 0.25.
At t = t_obs + 10 * half_life, relevance = 0.001 (effectively zero).

### 1.2 Why Exponential?

Three decay models were considered:

**Linear decay**: Relevance decreases at a constant rate and reaches zero at some fixed time.
```
R(t) = max(0, 1 - (t - t_obs) / lifetime)
```
Problem: the observation abruptly becomes zero at the lifetime boundary. A condition report from 2022 is partially relevant in 2025 but has zero relevance in 2026? The cliff is unrealistic. Observations fade; they don't vanish.

**Step function**: Relevance is 1.0 until the expiry date, then 0.0.
```
R(t) = 1 if (t - t_obs) < lifetime, else 0
```
Problem: same cliff problem, worse. A mileage reading from one day before expiry is fully relevant; one day after is irrelevant. This is obviously wrong.

**Exponential decay**: Relevance decreases proportionally to current relevance. The rate of fading slows as the observation becomes less relevant.
```
R(t) = exp(-lambda * (t - t_obs))
```
This is the correct model because:
- It matches the physical intuition. An observation that was somewhat stale yesterday is slightly more stale today, not dramatically more stale.
- It never reaches exactly zero. Old observations retain a trace of relevance, which is correct: a 1970 condition assessment of a 1970 vehicle is nearly irrelevant for current condition, but not entirely irrelevant (it establishes baseline factory delivery condition).
- It is the standard model for decay processes in physics, pharmacology, and information retrieval. The mathematics are well-understood.
- It has a single parameter (half-life) that maps directly to domain intuition. "How long until this information is half as useful?" is a question domain experts can answer.

### 1.3 The Effective Zero Threshold

Although exponential decay never reaches zero, for computational purposes an observation is treated as effectively decayed when its relevance drops below a threshold epsilon:

```
epsilon = 0.01 (1% of original relevance)
```

The time to reach effective zero:

```
t_eff_zero = t_obs + half_life * log2(1 / epsilon) = t_obs + half_life * 6.64
```

For a condition report with half_life = 2 years, effective zero is reached at approximately 13.3 years. Beyond that, the observation is excluded from active computations (though retained in the database for historical record).

---

## Part II: Category Half-Lives

### 2.1 The Half-Life Table

Half-lives are assigned by observation category. The category is a property of the observation kind, not the source. A VIN from a high-trust source and a VIN from a low-trust source both have infinite half-life. Source trust affects the observation's initial weight, not its decay rate.

**Identity and Registration**

| Category | Half-Life | Rationale |
|----------|-----------|-----------|
| VIN / serial number | Infinite | Identity does not decay. The VIN stamped in 1970 is as valid in 2070. |
| Catalogue raisonne number | Infinite | Definitive catalog entry. Permanent. |
| Accession number (museum) | Infinite | Institutional registration. Permanent while the institution exists. |
| Title / registration | 50 years | Legal documents decay only through legal processes (title transfer, deregistration). |
| Build sheet / factory record | Infinite | Factory specification at the moment of production. Never changes. What was built was built. |
| Certificate of authenticity | 20 years | Can be revoked or superseded. Long half-life but not infinite. |
| Artist attribution | 30 years | Attributions can be revised by scholarship. Long half-life reflects academic consensus stability. |

**Condition and Physical State**

| Category | Half-Life | Rationale |
|----------|-----------|-----------|
| Professional condition report | 2-3 years | Physical condition changes through use, environment, and aging. |
| Conservation report (art) | 3-5 years | Art changes more slowly than vehicles in controlled environments. |
| Concours judging result | 3 years | Condition was assessed competitively. Valid for several years. |
| Owner condition claim | 1 year | Biased source, no verification. Decays fast. |
| Photo-based AI assessment | 1 year | Only captures visible surface condition. Limited depth. |
| Mileage reading | 1 year | Mileage increases continuously. A reading is accurate at the moment taken. |

**Market and Financial**

| Category | Half-Life | Rationale |
|----------|-----------|-----------|
| Auction result (sale price) | 3 years | Market comparables. New sales supersede old ones. |
| Auction result (estimate) | 1 year | Estimates are forward-looking and quickly obsoleted by actual sales. |
| Appraisal | 1 year | Formal valuations are point-in-time assessments. |
| Insurance valuation | 2 years | Insurance values are updated periodically. |
| Listing price (asking) | 3 months | Asking prices are marketing, not market. They decay very rapidly. |
| Marketplace listing | 3 months | The listing itself is transient. |
| Bid data | 2 years | Bid activity reveals demand at a moment. Less stable than sale prices. |

**Provenance and Custody**

| Category | Half-Life | Rationale |
|----------|-----------|-----------|
| Ownership (documented transfer) | 30 years | Ownership is a fact until disproven. Long half-life. |
| Ownership (claimed, undocumented) | 5 years | Undocumented claims degrade. |
| Exhibition inclusion | 10 years | The fact that a work was in a show is permanent, but its relevance to current signal fades. |
| Publication reference | 10 years | Published citations endure but become less relevant as new literature emerges. |
| Gallery representation | 5 years | Representation changes. Current representation matters more. |
| Restoration / conservation event | 10 years | The work was done. The relevance of that work to current condition slowly fades. |

**Descriptive and Narrative**

| Category | Half-Life | Rationale |
|----------|-----------|-----------|
| Seller description (auction/listing) | 2 years | Seller descriptions are marketing tied to a moment. |
| Editorial feature / review | 5 years | Published assessments retain relevance but fade. |
| Forum / community post | 1 year | Informal observations. Rapidly obsoleted. |
| Social media post | 90 days | Ephemeral by design and practice. |
| Comment / bid analysis | 2 years | Sentiment data tied to a specific auction event. |
| Video / media documentation | 5 years | Visual documentation retains longer relevance than text descriptions. |

### 2.2 Half-Life Modifiers

The base half-life is modified by two factors:

**Environmental modifier**: Assets in controlled environments (museum storage, climate-controlled garages) have condition observations that decay more slowly than assets in uncontrolled environments.

```
half_life_effective = half_life_base * environment_modifier
```

| Environment | Modifier | Rationale |
|-------------|----------|-----------|
| Museum / institutional storage | 1.5 | Controlled temperature, humidity, security. Condition changes slowly. |
| Climate-controlled private storage | 1.3 | Good conditions but less consistent than museum. |
| Standard garage / indoor | 1.0 | Baseline. |
| Outdoor / uncovered | 0.5 | Accelerated deterioration. Condition changes rapidly. |
| Unknown | 0.8 | Conservative default assumption. |

**Documentation quality modifier**: Well-documented observations (photos, structured reports, multiple data points) decay more slowly than poorly-documented ones because they can be re-evaluated.

```
half_life_effective = half_life_base * documentation_modifier
```

| Documentation Quality | Modifier | Rationale |
|----------------------|----------|-----------|
| Full structured report with photos | 1.3 | Can be re-assessed from the documentation. |
| Structured report without photos | 1.1 | Some re-assessment possible. |
| Unstructured text description | 1.0 | Baseline. |
| Single data point (number only) | 0.9 | No context for re-assessment. |
| Verbal / hearsay | 0.7 | Cannot be verified from the observation itself. |

---

## Part III: Conflicting Observations

### 3.1 The Conflict Problem

When multiple observations claim different values for the same property of the same entity, the system must resolve the conflict. A vehicle's color is claimed as "red" by one source and "maroon" by another. The mileage is reported as 47,000 by the seller and 52,000 by an inspection report. The condition is rated 8/10 by the owner and 6/10 by a professional inspector.

The half-life model provides the temporal dimension for conflict resolution. Combined with source trust, it produces a formal resolution algorithm.

### 3.2 Observation Effective Weight

Each observation's effective weight at time t is the product of its source trust and its temporal relevance:

```
W_eff(observation, t) = T(source) * Relevance(observation, t) * Confidence(observation)
```

Where:
- **T(source)** is the source trust score (see Signal Calculation paper)
- **Relevance** is the half-life decay value
- **Confidence** is the extraction confidence (how confident the system is that it correctly extracted the value from the raw source)

### 3.3 Resolution Rules

When multiple observations claim different values for the same field:

**Rule 1: Highest effective weight wins as the "current" value.**

```
current_value = value(argmax over observations of W_eff(observation, t))
```

The observation with the highest combination of source trust, recency, and extraction confidence becomes the displayed current value. All other observations are retained as historical claims.

**Rule 2: All observations are stored. None are deleted.**

Resolution is a display-time computation, not a data mutation. The "losing" observation remains in the database. If circumstances change (the winning source is later found to be unreliable, or a newer observation arrives), the resolution changes automatically.

**Rule 3: Human input at confidence 1.0 overrides all automated values.**

When a user manually corrects a field (e.g., types in the correct mileage), this observation has confidence 1.0 and source trust 1.0 (for the user's own assets; 0.60 for claims about others' assets). It immediately becomes the current value unless a higher-trust source disagrees.

**Rule 4: Discrepancy severity drives visibility.**

The system computes discrepancy severity for conflicting observations:

```
Discrepancy(obs_a, obs_b) = abs(W_eff(obs_a, t) - W_eff(obs_b, t)) * value_difference(obs_a, obs_b)
```

High-severity discrepancies (both observations have substantial effective weight and the values differ significantly) are surfaced to the user as flags. Low-severity discrepancies (one observation has decayed to near-zero relevance) are resolved silently.

### 3.4 Worked Example: Mileage Conflict

**Observation A**: Seller listing on BaT, 2024-03-15. Claims 47,200 miles. Source trust 0.90 (BaT listing). Extraction confidence 0.95. Category: mileage reading, half-life 1 year.

**Observation B**: Professional PPI report, 2025-09-20. Records 52,847 miles. Source trust 0.85 (PPI). Extraction confidence 0.98. Category: mileage reading, half-life 1 year.

**Resolution at 2026-03-20:**

Observation A: age = 2.01 years. Relevance = exp(-0.693 * 2.01) = 0.248. W_eff = 0.90 * 0.248 * 0.95 = 0.212.

Observation B: age = 0.50 years. Relevance = exp(-0.693 * 0.50) = 0.707. W_eff = 0.85 * 0.707 * 0.98 = 0.589.

**Current value**: 52,847 miles (Observation B wins). The 2024 listing mileage has decayed to less than half the weight of the 2025 PPI report.

Note that this is the correct result. Mileage increases over time. The more recent reading is naturally more current. The half-life model handles this automatically without needing mileage-specific logic: newer mileage readings always win because the older ones have decayed.

The discrepancy severity is low because Observation A has decayed to 0.212 weight, and the direction of the difference (higher mileage in newer reading) is expected. No flag is raised.

Now consider the reverse: if the PPI report showed 43,000 miles (lower than the earlier listing), that would be a high-severity anomaly. The mileage cannot decrease. The discrepancy would be flagged for investigation: odometer rollback, data entry error, or confusion between two vehicles.

### 3.5 Worked Example: Condition Conflict

**Observation A**: Owner self-assessment, 2025-06-01. Claims condition 85/100. Source trust 0.50 (owner). Category: condition, half-life 1 year.

**Observation B**: Professional inspection, 2024-01-15. Reports condition 72/100. Source trust 0.85 (PPI). Category: condition, half-life 2 years.

**Resolution at 2026-03-20:**

Observation A: age = 0.80 years. Relevance = exp(-0.693 * 0.80) = 0.574. W_eff = 0.50 * 0.574 * 0.80 = 0.230.

Observation B: age = 2.18 years. Relevance = exp(-0.347 * 2.18) = 0.469. W_eff = 0.85 * 0.469 * 0.95 = 0.379.

**Current value**: 72/100 (Observation B wins). Even though the professional inspection is older, its higher source trust and longer half-life (professional condition reports decay at half-life = 2 years, owner claims at 1 year) keep it above the owner's self-assessment.

Discrepancy severity is moderate: both observations have meaningful weight (0.230 vs 0.379), and the value difference is 13 points. This would be flagged to the user: "The owner claims condition 85/100, but the most recent professional inspection scored 72/100. The professional assessment carries higher weight."

In 6 more months (September 2026), Observation B will have decayed further:
- W_eff(B) = 0.85 * exp(-0.347 * 2.80) * 0.95 = 0.85 * 0.378 * 0.95 = 0.305
- W_eff(A) = 0.50 * exp(-0.693 * 1.30) * 0.80 = 0.50 * 0.406 * 0.80 = 0.162

Observation B still wins, but the gap is narrowing. By late 2027 (Observation B age ~3.8 years, approaching two half-lives), the owner's claim could surpass it if nothing else arrives. This is the system's way of saying: "You need a new professional inspection. The last one is going stale."

---

## Part IV: Compound Observations and Derived Data

### 4.1 The Derivation Chain

Some data in the system is derived from observations rather than directly observed. The Nuke Estimate is derived from comp sales, condition assessments, and provenance data. The condition grade is derived from component assessments. The signal score is derived from activity observations.

Derived data inherits the half-life of its least-durable input.

### 4.2 Minimum-Half-Life Rule

```
half_life(derived_value) = min(half_life(input_1), half_life(input_2), ..., half_life(input_n))
```

The Nuke Estimate depends on auction comps (half-life 3 years), condition assessments (half-life 2 years), and market trajectory (half-life 1 year). The estimate's effective half-life is 1 year -- the trajectory component ages out fastest and must be refreshed.

This rule ensures that derived values are never treated as more current than their weakest input. A valuation computed from 5-year-old condition data and fresh comps is stale, even though the comps are fresh. The condition data has decayed past its half-life, and the valuation inherits that staleness.

### 4.3 Staleness Indicators

Every derived value displays its "freshness" to the user:

| Freshness | Criteria | Display |
|-----------|----------|---------|
| Fresh | All inputs within 0.5 half-lives | No indicator (default state) |
| Aging | At least one input between 0.5 and 1.0 half-lives | Subtle indicator (muted text, timestamp) |
| Stale | At least one input between 1.0 and 2.0 half-lives | Visible warning (the data is old) |
| Expired | At least one input beyond 2.0 half-lives | Strong warning (this value should not be relied upon without refresh) |

The coaching system (from the Auction Readiness architecture) uses staleness indicators to generate action items: "Your condition report is stale. Schedule a professional inspection to refresh the Nuke Estimate."

---

## Part V: Special Cases

### 5.1 Infinite Half-Life Observations

Certain observations never decay:

- **VIN**: Stamped at the factory. True forever. An incorrect VIN is a data error, not a decay.
- **Build sheet specification**: What the factory installed. The specification never changes, even if the current state diverges (engine swap, repaint).
- **Catalogue raisonne number**: The definitive reference assigns a number. It does not expire.
- **Date of creation**: The year an artwork was executed or a vehicle was manufactured. Permanent.

Infinite-half-life observations form the identity skeleton of the entity. They are the fixed points around which all other observations orbit. Even when every other observation has decayed to negligible relevance, the identity skeleton remains.

### 5.2 Negative Events and Decay

When an observation records a negative event (authentication revoked, gallery drops artist, title branded as salvage), the decay model applies the same way. A 10-year-old authentication revocation is less relevant than a recent one, but it never reaches zero. The scar remains in the record.

However, negative events interact with subsequent positive events. If authentication was revoked in 2010 and then re-authenticated in 2015, the revocation observation still exists but is superseded by the re-authentication. The conflict resolution rules (Section 3.3) handle this: the re-authentication has higher recency and thus higher effective weight.

### 5.3 Observations About the Past

Some observations are recorded now but describe a past state. A 2026 memoir reveals that a painting was owned by a specific collector in 1982. The observation timestamp is 2026, but the content timestamp is 1982.

The model distinguishes between:
- **observation_date**: When the claim was made (2026)
- **content_date**: What time period the claim describes (1982)
- **source_date**: When the source itself was created (the memoir's publication date)

For decay purposes, the relevant timestamp depends on the question being asked:

- For provenance queries ("who owned this in 1982?"): The observation is maximally relevant because it directly answers the question. No decay applies to the content.
- For current-state queries ("what is the current condition?"): An observation describing 1982 condition has decayed based on content_date, not observation_date. The fact that someone reported it in 2026 does not make the 1982 condition report current.
- For trust queries ("how reliable is this claim?"): The observation_date matters because the source's track record is evaluated at the time the claim was made.

```
Relevance_content(observation, t_query) = exp(-lambda * (t_query - content_date))
Relevance_trust(observation, t) = exp(-lambda_trust * (t - observation_date))
```

For provenance: use Relevance_trust (the claim itself is recent and reliable).
For current state: use Relevance_content (the described state is old).

### 5.4 Batch-Created Observations

When a large extraction produces hundreds of observations simultaneously (scraping an auction catalog, processing a magazine issue), all observations share the same observation_date. The half-life model treats them identically in terms of temporal decay.

However, the content they describe may span decades. An auction catalog from a 2025 sale may include provenance entries dating to the 1890s. Each provenance entry has its own content_date, and the decay model applies to the content_date for current-state queries.

### 5.5 The Never-Observed Problem

What about properties that have never been observed? The absence of an observation is itself information.

For condition: if a vehicle has no condition observations, the system cannot infer condition. The condition field is null, and any computation that depends on condition uses a wide uncertainty band.

For provenance: gaps in the provenance chain are explicitly modeled (see Valuation Methodology, Section IV). The gap itself is an observation ("no documented owner for the period 1983-1995").

For identity: if a VIN has never been decoded, the system has less confidence in make/model claims from other sources. The absence of the VIN observation reduces confidence in derived data.

The general principle: absence of observation = increased uncertainty, not zero value. The system does not assume the worst case; it widens the error bars.

---

## Part VI: Category-Specific Decay Behavior

### 6.1 Condition Decay Patterns

Condition observations decay at different rates depending on the asset type and the condition dimension:

**Mechanical condition** (vehicles): Half-life 1-2 years. Engines develop issues, transmissions wear, seals fail. Mechanical state changes with use and time.

**Structural condition** (vehicles): Half-life 3-5 years. Frame rust progresses slowly. Structural damage from collision is sudden but then stable.

**Cosmetic condition** (vehicles and art): Half-life 2-3 years. Paint oxidizes, interiors fade, surfaces accumulate wear. Art surfaces yellow, crack, or develop foxing.

**Patina** (both domains): Infinite half-life in one direction. Patina accumulates monotonically. An observation that records patina level at time T is a lower bound on patina at time T+n. Patina does not decrease (except through restoration, which is itself an observation).

### 6.2 Market Data Decay Patterns

**Auction results**: Half-life 3 years. Market conditions shift. What sold for $100K in 2023 may sell for $130K or $70K in 2026, depending on market trajectory. But the 2023 result remains a valid data point -- it just weighs less in the comp engine.

**Asking prices**: Half-life 3 months. Asking prices are aspirational, not market. A listing from 6 months ago that never sold is weak evidence of value. A listing from 2 years ago is nearly irrelevant.

**Appraisals**: Half-life 1 year. Professional appraisals are point-in-time assessments. The market moves, the condition changes, the appraiser's opinion becomes stale. Insurance companies require annual or biennial re-appraisals for this reason.

**Bid data**: Half-life 2 years. Bid activity during an auction reveals demand at that moment. A vehicle that attracted 47 bids in 2024 had strong demand in 2024. Whether that demand persists is unknown.

### 6.3 Descriptive Data Decay Patterns

**Seller descriptions**: Half-life 2 years. Seller descriptions are testimony optimized for the sale event. They are accurate-ish at the time of listing and progressively less reliable afterward. "Runs and drives excellent" was the seller's opinion at listing time. Two years later, the statement is half as relevant.

**Editorial features**: Half-life 5 years. A magazine profile or review is a curated assessment. It ages more slowly than a seller description because it was produced by a professional writer/editor with editorial standards. But it still ages as the subject changes and new information emerges.

**Comment analysis**: Half-life 2 years. Community comments on an auction capture the collective wisdom at the moment of the auction. That wisdom ages as new information arrives, as the commenters' assumptions prove correct or incorrect, and as market conditions shift.

---

## Part VII: The Refresh Model

### 7.1 When to Refresh

The half-life model implies a natural refresh schedule for every observation category. When an observation's relevance drops below a threshold, the system should seek a fresh observation.

```
Refresh_needed(category) = (most_recent_relevance < refresh_threshold)
```

Where refresh_threshold varies by how critical the category is to current computations:

| Criticality | Refresh Threshold | Meaning |
|-------------|-------------------|---------|
| Critical (condition for valuation) | 0.60 | Refresh when relevance drops below 60% |
| Important (market data for comps) | 0.40 | Refresh when relevance drops below 40% |
| Supplementary (descriptions, listings) | 0.20 | Refresh when relevance drops below 20% |
| Archival (identity, provenance) | Never | Infinite half-life. No refresh needed. |

### 7.2 Passive Refresh

The extraction pipeline naturally refreshes observations when it encounters updated data. A vehicle that appears on BaT generates fresh observations that supersede old ones. A museum database re-scrape produces updated condition and location data.

Passive refresh requires no explicit scheduling. It happens as a byproduct of the system's ongoing extraction activity. The half-life model ensures that the freshest observations naturally dominate.

### 7.3 Active Refresh (Coaching)

When passive refresh is insufficient -- no new data has arrived for a critical category -- the system generates coaching prompts:

- "Your condition assessment is 2.5 years old (70% decayed). Consider scheduling a professional inspection."
- "The last comp for this vehicle type sold 14 months ago. Market estimate confidence is declining."
- "No photographs of the interior have been submitted in 3 years. Interior condition data is stale."

These coaching prompts are generated by the Auction Readiness Score system and delivered through the user's profile. They are not push notifications. They appear when the user views their asset and sees the staleness indicators (Section 4.3).

### 7.4 Refresh Priority

When resources are limited (scraping budget, API calls, agent time), which observations should be refreshed first?

```
Refresh_priority(observation) = Criticality(category) * (1 - Relevance(observation, t))
                                * DependentValueCount(observation)
```

Where DependentValueCount is the number of derived values (estimates, scores, grades) that depend on this observation. An observation that feeds the Nuke Estimate for a high-value asset has more refresh priority than one that feeds a supplementary display field for a low-activity entity.

---

## Part VIII: Interaction with Source Trust

### 8.1 The Trust-Decay Matrix

Source trust and temporal decay are independent dimensions that combine multiplicatively. This creates four quadrants:

| | High Recency | Low Recency |
|---|---|---|
| **High Trust** | Strong current signal. Gold standard data. | Historical anchor. Important for provenance but fading for current state. |
| **Low Trust** | Noise. Recent but unreliable. | Noise AND stale. Effectively zero contribution. |

The quadrants clarify priorities:
- **Seek high-trust, high-recency observations.** This is the gold standard.
- **Retain high-trust, low-recency observations** as provenance anchors.
- **Accept low-trust, high-recency observations** as supplementary signal, but never let them override high-trust data.
- **Ignore low-trust, low-recency observations** in active computations. Retain in database for historical record.

### 8.2 The Override Problem

Can a new low-trust observation override an old high-trust observation?

Consider: A professional inspection (trust 0.85) from 3 years ago reports mileage as 47,000. An owner self-report (trust 0.50) from today claims mileage is 47,200.

With half-life = 1 year for mileage:
- PPI: W_eff = 0.85 * exp(-0.693 * 3) * 0.95 = 0.85 * 0.125 * 0.95 = 0.101
- Owner: W_eff = 0.50 * 1.0 * 0.80 = 0.400

The owner claim wins because the PPI has decayed beyond 3 half-lives. Is this correct?

For mileage: Yes. Mileage increases over time. The 3-year-old reading is necessarily outdated. The owner's current reading, even at lower trust, is more useful because it is current.

For condition: Debatable. A professional assessed condition as 72 three years ago. The owner claims 85 today. Should the owner's claim win?

The model says yes, but with a discrepancy flag. The effective weights favor the owner's current claim (0.400 vs 0.101), but the system flags the 13-point discrepancy. The user sees: "Owner claims condition 85. Last professional inspection (2023) scored 72. Consider refreshing the professional assessment."

This is the correct behavior. The system does not suppress the owner's claim -- it surfaces it as the current best data while flagging that a professional refresh would increase confidence.

### 8.3 The Trust Floor

To prevent very low-trust observations from accumulating enough volume to override higher-trust data, the system applies a trust floor:

```
If T(source) < 0.30 AND no corroborating observation from T >= 0.50:
    The observation is stored but excluded from conflict resolution.
```

Anonymous claims (trust 0.20) cannot override any other observation regardless of recency. They can only contribute to the current value if they are the only observation for a given field, and even then, they are flagged as low-confidence.

---

## Part IX: Implementation Considerations

### 9.1 When to Apply Decay

Decay is computed at read time, not write time. Observations are stored with their original trust and timestamp. The relevance computation happens when the data is queried.

This means:
- No cron job required to "age" observations
- The same observation data can be evaluated at different points in time (historical analysis, what-if scenarios)
- Changing a half-life parameter retroactively changes all relevance computations without touching the stored data

### 9.2 Indexing for Decay-Aware Queries

Queries that filter by effective weight require special indexing. A query like "give me all observations for this vehicle where effective weight > 0.30" cannot use a simple index because effective weight is a function of time.

Instead, pre-compute the "expiry date" at which an observation's effective weight drops below common thresholds:

```
expiry_0.50 = t_obs + half_life * ln(2 * T(source) * Confidence) / ln(2)
expiry_0.30 = t_obs + half_life * ln(T(source) * Confidence / 0.30) / ln(2)
expiry_0.10 = t_obs + half_life * ln(T(source) * Confidence / 0.10) / ln(2)
```

These expiry dates are stored as indexed columns, allowing queries like:

```
WHERE expiry_0.30 > NOW()
```

This efficiently filters out decayed observations without computing the exponential function for every row.

### 9.3 Display Conventions

When displaying data to users, the system does not show raw relevance numbers. Instead, it uses visual conventions:

- **Full opacity**: Observation within 0.5 half-lives. Fresh data.
- **Reduced opacity**: Observation between 0.5 and 1.5 half-lives. Aging but still relevant.
- **Low opacity with timestamp**: Observation between 1.5 and 3 half-lives. Old data, show when it was recorded.
- **Hidden by default**: Observation beyond 3 half-lives. Available on click but not shown in default view.

This visual language teaches users to recognize data freshness without requiring them to understand the mathematics.

---

## Part X: Open Questions

### 10.1 Asymmetric Decay

The current model assumes symmetric decay: a condition report decays at the same rate whether the asset has been used heavily or stored in a museum. In reality, condition decays faster for actively-used assets. Should the decay rate incorporate a usage factor?

```
lambda_effective = lambda_base * (1 + usage_rate * usage_sensitivity)
```

Question: How to measure usage rate when usage itself is an observation that decays?

### 10.2 Corroboration Reset

When a second independent source corroborates an observation (two different inspectors report the same mileage), should the original observation's effective half-life be extended?

The argument for: corroboration increases confidence, and higher-confidence observations should be treated as more durable.

The argument against: the physical reality described by the observation still changes at the same rate regardless of how many sources confirmed it. Mileage from 3 years ago is 3 years old whether one source or five sources confirmed it.

Current model: No corroboration reset. Corroboration increases confidence but does not change half-life. Open to revision.

### 10.3 Category Boundary Cases

Some observations straddle categories. A "barn find" description contains both a condition assessment (implying long dormancy, potential issues) and a provenance claim (stored in a barn for X years). Which half-life applies?

Current approach: decompose compound observations into atomic claims during extraction. The condition claim gets condition half-life. The provenance claim gets provenance half-life. The extraction pipeline is responsible for the decomposition.

Question: Is atomic decomposition always possible? Are there observations whose meaning is irreducibly compound?

### 10.4 Cultural Decay

Some observations decay differently in different cultural contexts. A review in Artforum carries persistent weight in the New York art world but may be less relevant in the Asian market. A BaT auction result is highly relevant to the North American collector car market but less relevant to European markets with different buyer pools.

Question: Should decay rates be context-dependent? If so, does every query need to specify its cultural/geographic context?

### 10.5 The Archive Paradox

Archival sources (historical photographs, period documents, vintage advertisements) describe the past but are discovered in the present. A photograph from 1965 discovered in 2026 is simultaneously brand new (as an observation) and very old (as content). The current model handles this through the observation_date / content_date distinction (Section 5.3), but the trust computation is ambiguous.

Question: Should newly-discovered historical evidence receive a "discovery bonus" that recognizes the value of bringing previously-unknown information into the graph?

---

*This paper defines the mathematical framework for temporal decay of observations. It is the foundation layer for signal calculation, valuation, and conflict resolution. The half-life parameters are initial estimates based on domain intuition and should be empirically calibrated as the system accumulates validation data (observations confirmed or contradicted by subsequent higher-trust observations).*

*Companion papers: Signal Calculation (uses decay for signal weighting), Valuation Methodology (uses decay for comp recency), Entity Resolution Theory (uses decay for match confidence over time).*
