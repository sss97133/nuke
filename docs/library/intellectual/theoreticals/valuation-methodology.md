# Valuation Methodology: The Nuke Estimate

**Status**: Theoretical -- comps and price history tables exist, no standalone valuation algorithm ships
**Author**: Nuke Research
**Date**: 2026-03-20
**Dependencies**: Signal calculation, observation half-life model, entity resolution
**Domain**: Universal (automotive, art, publishing, all future verticals)

---

## Abstract

The Nuke Estimate is a computed value for any physical asset in the provenance graph. It is the Zestimate for collector vehicles, artworks, and every future vertical. Unlike Zestimate, which operates in a market with universal standards (square footage, bedrooms, school district), the Nuke Estimate operates in markets where every asset is unique, condition is subjective, provenance is decisive, and comparable sales require sophisticated matching.

This paper defines the valuation model: how to identify comparable sales, how to weight them by relevance, how to incorporate condition assessment, provenance strength, market trajectory, rarity, and institutional validation. It defines the confidence scoring system that tells users how much to trust the estimate. And it defines the feedback loop that improves the model as new market data arrives.

The fundamental claim: a sufficiently dense provenance graph with time-weighted observations, source-cited condition assessments, and robust comp matching produces valuations that converge on market reality -- and in some cases, identify market inefficiencies where assets are undervalued relative to their data profile.

---

## Part I: The Valuation Formula

### 1.1 Core Definition

The Nuke Estimate for an asset at time t is:

```
NE(asset, t) = CompBase(asset, t) * ConditionMultiplier(asset, t)
               * ProvenanceMultiplier(asset, t) * TrajectoryMultiplier(asset, t)
               * RarityMultiplier(asset, t) * InstitutionalMultiplier(asset, t)
```

Each multiplier adjusts the base comparable value up or down. The result is a dollar value (or equivalent in any currency, converted at the observation date's exchange rate).

### 1.2 Confidence Score

Every Nuke Estimate carries a confidence score:

```
Confidence(asset, t) = f(comp_count, comp_recency, comp_similarity,
                          condition_recency, provenance_completeness,
                          observation_density)
```

Confidence ranges from 0.0 to 1.0:

| Range | Label | Meaning |
|-------|-------|---------|
| 0.90 - 1.00 | Very High | Dense comps, recent condition report, complete provenance, high observation count. The estimate is likely within 10% of market. |
| 0.70 - 0.89 | High | Good comps, reasonable condition data, mostly complete provenance. The estimate is likely within 20% of market. |
| 0.50 - 0.69 | Moderate | Some comps available but imperfect matches. Condition data may be stale. Provenance has gaps. The estimate defines a range. |
| 0.30 - 0.49 | Low | Few comps, poor condition data, incomplete provenance. The estimate is speculative and should be treated as directional only. |
| 0.00 - 0.29 | Insufficient | Not enough data to produce a meaningful estimate. The system returns a range wider than 50% of the midpoint. |

When confidence is below 0.30, the Nuke Estimate is not displayed as a single number. It is displayed as a wide range with an explicit disclaimer. Showing a precise number with insufficient data would be worse than showing no number at all.

### 1.3 Output Format

The Nuke Estimate is not a single number. It is a structure:

```
NukeEstimate {
    midpoint: number,              // The single "headline" value
    low: number,                   // Conservative estimate (10th percentile)
    high: number,                  // Aggressive estimate (90th percentile)
    confidence: number,            // 0-1
    confidence_label: string,      // "Very High" / "High" / "Moderate" / "Low" / "Insufficient"
    comp_count: number,            // How many comps were used
    primary_drivers: string[],     // Top 3 factors driving the estimate
    last_updated: timestamp,       // When this estimate was computed
    observation_count: number,     // Total observations feeding this estimate
    citations: Citation[]          // Every data point that contributed, with source
}
```

---

## Part II: Comparable Sales Engine -- CompBase

### 2.1 The Comp Problem

Comparable sales are the foundation of any asset valuation. For real estate, comps are straightforward: similar homes in similar locations sold recently. For collector assets, comps are hard:

- Every asset is unique. No two 1967 Shelby GT500s are identical once you account for build options, restoration quality, ownership history, and current condition.
- The market is thin. Some models or artists may have only 1-2 sales per year.
- Sales happen on different platforms with different buyer pools, fee structures, and selection biases.
- Condition varies enormously and is not standardized.
- Provenance creates price premiums that are hard to quantify.

### 2.2 Comp Selection

The comp engine starts with the universe of all known sales and narrows through a sequence of filters.

**Stage 1: Identity Match**

For vehicles: same make, same model, same generation/body style, same engine family. Not same VIN (that would be a repeat sale of the same asset, which is handled separately).

For artworks: same artist, same medium, same approximate size range (within 25% of both dimensions), same approximate date range (within the same period/decade).

Stage 1 produces the **broad comp set**. This may contain hundreds of results for common vehicles (Porsche 911) or dozens for rare ones (Shelby Daytona Coupe).

**Stage 2: Similarity Scoring**

Each comp in the broad set receives a similarity score relative to the target asset:

```
Similarity(comp, target) = SUM over features of:
    [ w_f * match_score(comp.f, target.f) ]
```

Where features and weights depend on the domain.

**Vehicle features and weights:**

| Feature | Weight (w_f) | Match Score Logic |
|---------|-------------|-------------------|
| Year | 0.15 | 1.0 if exact, 0.8 if +/-1 year, 0.5 if +/-2, 0.2 if +/-5, 0 beyond |
| Model variant / trim | 0.15 | 1.0 if exact, 0.6 if same model different trim, 0.3 if related model |
| Engine | 0.12 | 1.0 if exact, 0.7 if same displacement different config, 0.4 if same family |
| Transmission | 0.08 | 1.0 if exact, 0.5 if same type (auto/manual) |
| Mileage bracket | 0.10 | 1.0 if same bracket (0-25K, 25-50K, 50-100K, 100K+), 0.5 if adjacent |
| Body style | 0.08 | 1.0 if exact, 0.5 if same chassis different body |
| Condition grade | 0.15 | 1.0 - abs(comp_grade - target_grade) / 100 |
| Build type | 0.10 | 1.0 if both numbers matching, both restored, both modified, etc. 0.5 if adjacent |
| Color (when rare/significant) | 0.03 | 1.0 if exact, 0.7 if same family, 0.5 otherwise |
| Provenance significance | 0.04 | Qualitative: celebrity owned, racing history, first owner, etc. |

**Art features and weights:**

| Feature | Weight (w_f) | Match Score Logic |
|---------|-------------|-------------------|
| Artist | 0.25 | 1.0 if same artist (required for primary comps) |
| Medium | 0.15 | 1.0 if exact, 0.7 if same family (e.g., oil vs. acrylic), 0.3 if different |
| Size (area) | 0.12 | 1.0 if within 10%, 0.7 if within 25%, 0.4 if within 50% |
| Date executed | 0.10 | 1.0 if same year, 0.8 if within 2 years, 0.5 if same decade |
| Period | 0.10 | 1.0 if same artistic period, 0.5 if adjacent period |
| Subject matter | 0.08 | Semantic similarity of subject classification |
| Condition | 0.10 | 1.0 - abs(comp_grade - target_grade) / 100 |
| Edition type | 0.05 | 1.0 if both unique, both from same edition size, etc. |
| Provenance significance | 0.05 | Celebrity collection, museum deaccession, etc. |

**Stage 3: Recency Weighting**

Comps that sold recently are more relevant than comps from years ago. The recency weight follows the observation half-life model with a sale-specific decay:

```
RecencyWeight(comp) = exp(-ln(2) * age_years / half_life_sale)
```

Where half_life_sale = 3 years for most categories, 2 years for rapidly moving markets (contemporary art, modern muscle cars), and 5 years for stable markets (blue-chip old masters, pre-war classics).

**Stage 4: Platform Weighting**

Sales from different platforms have different selection biases. BaT attracts a specific buyer demographic. Christie's attracts another. The platform weight adjusts for known biases:

```
PlatformWeight(comp) = platform_calibration(comp.platform)
```

Platform calibrations are derived empirically from assets that have sold on multiple platforms. If the same car sells for $80K on BaT and $95K at RM Sotheby's, the platform calibration for BaT-to-RM is 0.84 (or equivalently, RM-to-BaT is 1.19). These calibrations are maintained per asset category because platform biases differ by market segment.

### 2.3 Comp Aggregation

The comp base value is the weighted median of comp prices, where each comp's weight is:

```
CompWeight(comp) = Similarity(comp, target) * RecencyWeight(comp) * PlatformWeight(comp)
```

The weighted median is preferred over the weighted mean because it is robust to outlier sales. A single anomalous result (estate liquidation at far below market, or heated bidding war at far above) does not distort the estimate.

```
CompBase(asset, t) = weighted_median(comp_prices, comp_weights)
```

The low estimate uses the weighted 25th percentile. The high estimate uses the weighted 75th percentile.

### 2.4 Repeat Sales Analysis

When the same asset has sold multiple times, the repeat sales data is extremely valuable:

- It provides a direct price trajectory for this specific asset.
- The delta between sales, adjusted for time, reveals the asset's individual appreciation rate.
- Condition changes between sales (documented by different condition reports) create a natural experiment for the condition multiplier.

When repeat sales exist, they receive a 3x weight multiplier in the comp aggregation. The asset's own history is the strongest comp.

### 2.5 Thin Market Handling

When the comp set contains fewer than 3 results after Stage 2 filtering, the comp engine expands the search:

1. **Relax variant matching**: Accept a broader range of trims, engine variants, or artistic periods.
2. **Extend the time window**: Accept older sales (up to 10 years with heavy decay weighting).
3. **Broaden the category**: For vehicles, include the entire model range. For art, include artists in the same movement, of similar career stage, showing at similar institutions.

Each relaxation is annotated in the estimate's citations so the user understands why the comp set includes what it does.

If after all relaxation fewer than 3 comps exist, the confidence score drops below 0.30 and the estimate is flagged as "Insufficient."

### 2.6 Worked Example: Vehicle Comp Selection

**Target**: 1972 Chevrolet Blazer K5, CST package, 350/TH350, 4WD, restored, 47,000 miles, condition grade 82/100.

**Broad comp set (Stage 1)**: All Chevrolet Blazer K5 sales, 1969-1975. Returns 47 results.

**Top 5 after similarity scoring (Stage 2)**:

| Comp | Year | Engine | Condition | Sim Score | Sale Price | Sale Date | RecencyWt | FinalWt |
|------|------|--------|-----------|-----------|-----------|-----------|-----------|---------|
| A | 1972 | 350 | 85 | 0.94 | $78,000 | 2025-09 | 0.89 | 0.84 |
| B | 1971 | 350 | 78 | 0.88 | $65,000 | 2026-01 | 0.97 | 0.85 |
| C | 1972 | 350 | 90 | 0.86 | $92,000 | 2025-04 | 0.82 | 0.71 |
| D | 1973 | 350 | 80 | 0.82 | $71,000 | 2025-11 | 0.93 | 0.76 |
| E | 1970 | 350 | 75 | 0.78 | $58,000 | 2024-06 | 0.71 | 0.55 |

**CompBase** (weighted median): approximately $73,000.
**Low** (weighted 25th percentile): approximately $63,000.
**High** (weighted 75th percentile): approximately $84,000.

---

## Part III: Condition Multiplier

### 3.1 The Condition Problem

Condition is the single largest driver of price variance within a comp set. Two identical vehicles -- same year, make, model, options -- can sell for 3x different prices based on condition alone. The proven correlation in BaT data: excellent condition vehicles sell for +142% relative to fair condition; concours-quality restoration adds +103%.

### 3.2 Condition Grade Sources

Condition data comes from observations with different trust levels:

| Source | Trust | Half-Life | Notes |
|--------|-------|-----------|-------|
| Professional inspection (PPI) | 0.85 | 2 years | Gold standard. Trained inspector, structured report. |
| Concours judging | 0.90 | 3 years | Competitive evaluation by experts. Inherently comparative. |
| Auction house condition report | 0.85 | 2 years | Pre-sale assessment by specialist. May have seller bias. |
| Owner self-assessment | 0.50 | 1 year | Inherently biased toward overstatement. |
| Photo-based AI assessment | 0.60 | 1 year | Dependent on photo quality and coverage. Improving. |
| Community/forum assessment | 0.40 | 1 year | Informal, unstructured, but often knowledgeable. |
| Conservation report (art) | 0.90 | 3 years | Professional conservator, structured. |

### 3.3 Condition Grade Computation

The condition grade is not directly provided by most sources. It must be computed from raw observations using a rubric:

**Vehicle condition rubric (0-100)**:

| Component | Weight | Assessment Dimensions |
|-----------|--------|----------------------|
| Body/exterior | 0.25 | Paint quality, panel fit, rust, dents, trim condition |
| Mechanical | 0.25 | Engine, transmission, drivetrain, suspension, brakes, steering |
| Interior | 0.15 | Seats, dash, carpet, headliner, gauges, controls |
| Chassis/structure | 0.15 | Frame, subframes, floors, rockers, structural integrity |
| Electrical | 0.10 | Wiring, lighting, gauges, accessories, harness condition |
| Documentation | 0.10 | Service records, build sheet, title history, receipts |

Each component is scored 0-100 and weighted. The aggregate is the condition grade.

**Art condition rubric (0-100)**:

| Component | Weight | Assessment Dimensions |
|-----------|--------|----------------------|
| Surface/media | 0.30 | Paint stability, cracking, flaking, yellowing, fading |
| Support | 0.25 | Canvas tension, panel warping, paper foxing, tears |
| Structure | 0.15 | Stretcher condition, frame integrity, mounting |
| Previous interventions | 0.15 | Quality of prior restoration, extent of inpainting |
| Documentation | 0.15 | Condition report history, conservation records, x-ray/UV |

### 3.4 The Condition Multiplier Function

The condition multiplier converts a grade difference between the target asset and the comp base into a price adjustment:

```
ConditionMultiplier(asset) = exp(gamma * (condition_grade(asset) - condition_norm) / 100)
```

Where:
- **condition_grade(asset)** is the current condition grade of the target asset
- **condition_norm** is the average condition grade of the comp set (weighted by comp weight)
- **gamma** is the condition sensitivity parameter

Gamma varies by market segment:

| Segment | gamma | Rationale |
|---------|-------|-----------|
| Concours / museum quality | 2.5 | At the top end, small condition differences drive large price differences |
| Collector grade | 1.8 | Standard collector market sensitivity |
| Enthusiast / driver grade | 1.2 | Buyers prioritize usability over perfection |
| Project / barn find | 0.6 | Condition matters less because the buyer plans to rebuild |

With gamma = 1.8 (collector grade):
- Asset at grade 90, comp norm at 75: Multiplier = exp(1.8 * 15 / 100) = exp(0.27) = 1.31 (+31%)
- Asset at grade 60, comp norm at 75: Multiplier = exp(1.8 * -15 / 100) = exp(-0.27) = 0.76 (-24%)
- Asset at grade 75, comp norm at 75: Multiplier = 1.0 (no adjustment)

### 3.5 Condition Uncertainty

When condition data is stale (beyond its half-life) or absent, the condition multiplier introduces uncertainty rather than a point estimate:

```
ConditionMultiplier_uncertain(asset) = {
    low: exp(gamma * (estimated_grade - 15 - condition_norm) / 100),
    mid: exp(gamma * (estimated_grade - condition_norm) / 100),
    high: exp(gamma * (estimated_grade + 10 - condition_norm) / 100)
}
```

The asymmetric uncertainty (+10/-15) reflects the empirical observation that condition is more likely to be overstated than understated. Sellers rarely claim their asset is in worse condition than it actually is.

---

## Part IV: Provenance Multiplier

### 4.1 Provenance and Value

Provenance is the chain of custody that establishes an asset's history, authenticity, and cultural significance. Complete provenance increases value. Incomplete provenance reduces confidence and depresses the estimate.

The provenance multiplier has three components:

```
ProvenanceMultiplier(asset) = CompletenessAdjustment(asset)
                             * NotabilityPremium(asset)
                             * AuthenticationBonus(asset)
```

### 4.2 Completeness Adjustment

Provenance completeness measures what fraction of the asset's life is documented.

```
Completeness(asset) = documented_years / total_years_since_creation
```

For a 1970 vehicle in 2026: total years = 56. If the provenance chain covers 40 of those years (current owner back to factory documentation with one 16-year gap): completeness = 40/56 = 0.71.

The completeness adjustment:

```
CompletenessAdjustment(asset) = 0.85 + 0.15 * Completeness(asset)
```

This means:
- 100% complete provenance: multiplier = 1.0 (no discount)
- 50% complete: multiplier = 0.925 (-7.5%)
- 0% complete (no provenance at all): multiplier = 0.85 (-15%)

The maximum provenance discount is 15%. Even an asset with zero provenance is not worthless -- it simply trades at a discount to comparable assets with full documentation. The object itself has value; provenance adds confidence.

### 4.3 Notability Premium

Certain provenance chains contain notable owners, events, or institutions that create a premium independent of condition or comps.

| Provenance Feature | Premium | Notes |
|-------------------|---------|-------|
| Celebrity previous owner | 1.05 - 1.30 | Highly variable. Steve McQueen provenance on a car can add 30%. A minor celebrity adds 5%. |
| Racing history (documented) | 1.10 - 1.50 | A car that raced at Le Mans is fundamentally different from a road car. |
| Museum collection | 1.10 - 1.25 | Previous inclusion in a museum collection validates significance. |
| Original owner / barn find | 1.05 - 1.20 | "Time capsule" premium for unmodified, single-owner assets. |
| Significant exhibition history (art) | 1.05 - 1.30 | An artwork shown at a Venice Biennale, Whitney Biennial, or Documenta. |
| Published in catalogue raisonne | 1.05 - 1.10 | Definitively catalogued. Authentication settled. |
| Matching numbers (vehicle) | 1.15 - 1.60 | All drivetrain components original to the VIN. The biggest single provenance premium in automotive. Proven at +60% in BaT data. |

Notability premiums do not stack multiplicatively without limit. The maximum combined notability premium is capped at 2.0x (doubling the base). Beyond that, the asset is in rarefied territory where comps are so few that the Nuke Estimate should report "Insufficient" rather than attempt precision.

### 4.4 Authentication Bonus

For domains where authentication is critical (art), the authentication status directly impacts the estimate:

| Status | Multiplier |
|--------|-----------|
| Authenticated by catalogue raisonne committee | 1.0 (baseline) |
| Authenticated by recognized expert | 0.95 |
| Attributed (not fully authenticated) | 0.70 |
| Authentication disputed | 0.40 |
| Authentication denied | 0.10 (effectively eliminates value as the attributed work) |

For vehicles, authentication maps to matching-numbers status, VIN verification, and build sheet confirmation. A vehicle with a confirmed build sheet and matching numbers is the automotive equivalent of a catalogue raisonne-authenticated artwork.

### 4.5 Provenance Gap Penalties

Specific provenance gaps carry specific penalties:

| Gap Type | Penalty | Rationale |
|----------|---------|-----------|
| 1933-1945 gap (art, European origin) | 0.85 | Holocaust-era gap. Potential restitution claim. |
| Extended freeport period (>10 years) | 0.95 | Off-market storage raises questions. |
| Rapid transfers (>3 owners in 2 years) | 0.90 | Potential laundering or undisclosed problems. |
| Title issues (salvage, reconstructed) | 0.60 - 0.80 | For vehicles. Depends on severity and documentation of repair. |

---

## Part V: Trajectory Multiplier

### 5.1 Market Trajectory

The trajectory multiplier adjusts the estimate based on the direction of the market for this type of asset. It does not predict the future -- it adjusts the present estimate to account for observable momentum.

The trajectory is computed from the comp set itself:

```
MarketTrajectory(asset) = regression_slope(comp_prices, comp_dates) / CompBase(asset, t)
```

This is the annualized rate of price change across the comp set, normalized by the current comp base.

### 5.2 Trajectory Multiplier Function

```
TrajectoryMultiplier(asset) = 1.0 + delta * tanh(MarketTrajectory(asset) * k)
```

Where:
- **delta** = maximum trajectory adjustment (default 0.20, meaning trajectory can adjust the estimate by at most +/-20%)
- **k** = sensitivity (default 3.0)
- **tanh** provides natural bounding: large trajectory values asymptotically approach the delta limit

With these defaults:
- Market rising at 10%/year: multiplier = 1.0 + 0.20 * tanh(0.10 * 3) = 1.0 + 0.20 * 0.29 = 1.058 (+5.8%)
- Market rising at 30%/year: multiplier = 1.0 + 0.20 * tanh(0.30 * 3) = 1.0 + 0.20 * 0.72 = 1.144 (+14.4%)
- Market declining at 15%/year: multiplier = 1.0 + 0.20 * tanh(-0.15 * 3) = 1.0 - 0.20 * 0.42 = 0.916 (-8.4%)

The tanh bounding prevents extrapolation in parabolic markets. A market rising at 100%/year does not produce a 100% trajectory multiplier; it produces approximately +19.6%.

### 5.3 Actor Trajectory Interaction

When the asset is by a specific creator (artist, builder), the creator's signal trajectory (from the Signal Calculation model) provides additional trajectory information:

```
CreatorTrajectoryBonus(asset) = 1.0 + epsilon * Trajectory_smooth(creator)
```

Where epsilon = 0.10 (creator trajectory can add at most +/-10% on top of market trajectory).

An artist whose signal is accelerating -- new museum shows, rising auction results, major gallery representation -- has a trajectory bonus. An artist who is fading -- gallery dropped, no recent shows, declining auction frequency -- has a trajectory penalty.

The total trajectory multiplier is:

```
TrajectoryMultiplier_total = TrajectoryMultiplier * CreatorTrajectoryBonus
```

---

## Part VI: Rarity Multiplier

### 6.1 Definition

Rarity quantifies how few comparable assets exist. A unique asset commands a premium. A mass-produced asset does not.

```
RarityMultiplier(asset) = 1.0 + rho * log10(total_known_population / (surviving_count + 1))
```

Where:
- **total_known_population** is the number originally produced (for vehicles) or in the edition (for art)
- **surviving_count** is the number currently known to exist in the system
- **rho** = rarity sensitivity (default 0.15)

Examples:
- Vehicle: 2,500 produced, 312 known surviving: Multiplier = 1.0 + 0.15 * log10(2500/313) = 1.0 + 0.15 * 0.90 = 1.135 (+13.5%)
- Vehicle: 150,000 produced, 8,400 surviving: Multiplier = 1.0 + 0.15 * log10(150000/8401) = 1.0 + 0.15 * 1.25 = 1.188 (+18.8%)
- Art: Unique work (edition of 1): Multiplier = 1.0 + 0.15 * log10(1/1) = 1.0 (no adjustment -- uniqueness is already priced into comps for unique works)
- Art: Edition of 25, 18 known in system: Multiplier = 1.0 + 0.15 * log10(25/19) = 1.0 + 0.15 * 0.12 = 1.018 (+1.8%)

### 6.2 Rarity Data Sources

Population data comes from:
- **Manufacturer records**: Production numbers, build sheets, SPID databases
- **Registry data**: Marque registries (e.g., Shelby American Automobile Club registry)
- **Catalogue raisonne**: For art, the definitive listing of all known works
- **Nuke observation density**: The count of distinct examples observed across all sources

When production numbers are unknown (common for pre-war vehicles, many artworks), the system uses observation density as a proxy. If only 3 examples of a model have ever appeared across all auction and listing platforms in the system, that is evidence of rarity regardless of the unknown production total.

### 6.3 Rarity Interaction with Market Thickness

Rarity and market thickness are related but distinct. A rare asset has few production siblings. A thin market has few sales. They usually correlate but can diverge: a rare vehicle might sell frequently if it is desirable (Ferrari 250 GTO -- only 36 made, but each sale is a global event with extensive documentation). A common vehicle might sell infrequently if demand is low (a 1982 Chevrolet Citation -- millions made, nobody wants one).

When the comp set is thin (fewer than 5 comps) AND the asset is rare (rarity multiplier > 1.10), the system acknowledges that precision is limited. Confidence is penalized:

```
Confidence_penalty_thin_rare = -0.15
```

This produces wider ranges on the estimate, communicating that the valuation is directional rather than precise.

---

## Part VII: Institutional Multiplier

### 7.1 Definition

Institutional validation occurs when an asset or its creator receives recognition from high-tier institutions. This is distinct from provenance (which is about custody) and from signal (which is about the actor). The institutional multiplier captures the value premium from the institution's endorsement.

```
InstitutionalMultiplier(asset) = 1.0 + mu * InstitutionalDensity(asset)
```

Where:
- **mu** = institutional sensitivity (default 0.10)
- **InstitutionalDensity** = the trust-weighted count of institutional observations

### 7.2 Computing Institutional Density

```
InstitutionalDensity(asset) = SUM over institutional_observations of:
    [ T(source) * D(t, t_obs, category) ]
    / normalization_factor(asset_type)
```

Institutional observations include:
- Museum acquisition (permanent collection)
- Major exhibition inclusion
- Catalogue raisonne listing
- Award/prize
- Official registry certification

The normalization factor ensures that institutional density is comparable across asset types. A vehicle with one Pebble Beach class win and an artwork with one MoMA acquisition should produce similar institutional multipliers.

### 7.3 Institutional Multiplier Bounds

The institutional multiplier is bounded at [1.0, 1.50]. Maximum +50% from institutional validation alone. Assets with zero institutional observations receive a multiplier of 1.0 (no penalty for being undiscovered; the absence of institutional validation is the default state).

---

## Part VIII: The Confidence Model

### 8.1 Confidence Components

Confidence is not a single factor. It is a composite of six independent dimensions:

```
Confidence(asset, t) = PROD over d in dimensions of:
    [ confidence_dimension(d) ^ weight(d) ]
```

| Dimension | Weight | Range | What It Measures |
|-----------|--------|-------|-----------------|
| Comp count | 0.25 | 0-1 | How many relevant comps exist |
| Comp recency | 0.20 | 0-1 | How recent the comps are |
| Comp similarity | 0.15 | 0-1 | How close the best comps match |
| Condition data quality | 0.15 | 0-1 | How recent and well-sourced the condition assessment is |
| Provenance completeness | 0.10 | 0-1 | How complete the ownership chain is |
| Observation density | 0.15 | 0-1 | Total number of observations on the asset |

### 8.2 Dimension Scoring

**Comp count confidence:**
```
f_comp_count(n) = 1 - exp(-n / 5)
```
- 0 comps: 0.0
- 1 comp: 0.18
- 3 comps: 0.45
- 5 comps: 0.63
- 10 comps: 0.86
- 20+ comps: ~1.0

**Comp recency confidence:**
```
f_comp_recency(newest_age_days) = exp(-newest_age_days / 365)
```
- Comp from today: 1.0
- Comp from 6 months ago: 0.61
- Comp from 1 year ago: 0.37
- Comp from 2 years ago: 0.14

**Comp similarity confidence:**
```
f_comp_similarity = max(similarity scores in final comp set)
```
Directly uses the best similarity score from Stage 2 of comp selection.

**Condition data quality:**
```
f_condition = max_trust(condition_observations) * recency_factor(newest_condition_obs)
```
Where recency_factor = exp(-age_days / (half_life_condition * 365))

**Provenance completeness:**
```
f_provenance = Completeness(asset)  // documented_years / total_years
```

**Observation density:**
```
f_observation_density = 1 - exp(-observation_count / 50)
```
- 0 observations: 0.0
- 10 observations: 0.18
- 25 observations: 0.39
- 50 observations: 0.63
- 100+ observations: ~0.86

### 8.3 Confidence and the Range

The width of the estimate range is inversely proportional to confidence:

```
range_width_pct = 0.10 + 0.90 * (1 - Confidence)
```

- Confidence 0.95: range is approximately +/-10% of midpoint
- Confidence 0.70: range is approximately +/-37%
- Confidence 0.50: range is approximately +/-55%
- Confidence 0.30: range is approximately +/-73%

Below confidence 0.30, the range exceeds +/-73%, and the estimate is no longer useful as a point estimate. The system displays it as "Estimated range: $X - $Y" without a midpoint.

---

## Part IX: Feedback Loop and Model Improvement

### 9.1 The Natural Experiment

Every time an asset sells after receiving a Nuke Estimate, the sale price is a natural experiment testing the model's accuracy.

```
error = (sale_price - NE_midpoint) / NE_midpoint
```

This error, accumulated across hundreds or thousands of sales, provides the training signal for model improvement.

### 9.2 Parameter Calibration

All parameters in the model (gamma, delta, rho, mu, epsilon, kind weights, feature weights) can be optimized against realized sale prices:

```
minimize SUM over realized_sales of:
    [ (sale_price - NE(asset, sale_date)) ^ 2 * sale_weight ]
```

Where sale_weight emphasizes high-confidence estimates (there is no point optimizing against estimates that had insufficient data).

This is a standard regression problem solvable with gradient descent on the parameter vector. It runs periodically (monthly or quarterly) as new sale data accumulates.

### 9.3 Drift Detection

The model monitors for systematic bias:

- **Overvaluation bias**: If the median error is consistently positive (Nuke estimates higher than realized prices), the model is systematically overvaluing. This triggers a global downward recalibration.
- **Undervaluation bias**: The opposite. Triggers upward recalibration.
- **Segment drift**: If the error distribution differs by market segment (e.g., the model overvalues muscle cars but undervalues European sports cars), segment-specific calibration adjustments are applied.

### 9.4 The Virtuous Cycle

As the observation density grows and the feedback loop refines the parameters, the Nuke Estimate becomes more accurate, which builds user trust, which encourages users to contribute more observations (owner condition reports, restoration documentation), which further improves the estimate.

At critical mass, the Nuke Estimate becomes the reference price. Sellers cite it in listings. Buyers use it to evaluate asking prices. Insurance companies reference it for coverage. This is the Zestimate flywheel applied to collector assets.

---

## Part X: Worked Example -- Full Valuation

### 10.1 Target Asset

**1970 Plymouth 'Cuda 440 Six-Pack, numbers matching, Vitamin C Orange, black interior, 4-speed, 72,000 miles, condition grade 78/100, owned by current owner since 2008, purchased at Mecum for $88,000 in 2008.**

### 10.2 Comp Selection

Broad comp set: All Plymouth Barracuda / 'Cuda sales, 1969-1971. Returns 83 results.

After similarity scoring, top 5 comps:

| # | Description | Sim | Price | Date | Wt |
|---|------------|-----|-------|------|----|
| 1 | 1970 'Cuda 440 Six-Pack, matching, restored, 4-speed | 0.92 | $135,000 | 2025-08 | 0.82 |
| 2 | 1970 'Cuda 440, matching, older restoration, auto | 0.84 | $98,000 | 2025-12 | 0.80 |
| 3 | 1971 'Cuda 440 Six-Pack, rebuilt engine (not matching) | 0.78 | $85,000 | 2025-05 | 0.62 |
| 4 | 1970 'Cuda 440, matching, driver quality, 4-speed | 0.88 | $115,000 | 2024-11 | 0.70 |
| 5 | 1970 Barracuda 340, matching, restored | 0.65 | $68,000 | 2026-01 | 0.58 |

**CompBase**: Weighted median = $108,000
**Low**: $89,000
**High**: $128,000

### 10.3 Multipliers

**Condition**: Grade 78 vs comp norm 82. ConditionMultiplier = exp(1.8 * (78-82)/100) = exp(-0.072) = 0.931

**Provenance**: Owned since 2008 (18 years documented of 56 total). Completeness = 18/56 = 0.32. But the 2008 Mecum sale provides a documented transaction, and VIN decodes to factory. Estimated total coverage with factory and Mecum records: 20/56 = 0.36. CompletenessAdjustment = 0.85 + 0.15 * 0.36 = 0.904. Matching numbers premium: 1.45. No other notable provenance features. AuthenticationBonus = 1.0 (VIN confirmed). ProvenanceMultiplier = 0.904 * 1.45 * 1.0 = 1.311.

**Trajectory**: E-body Mopar market rising at approximately 8%/year over the comp set. TrajectoryMultiplier = 1.0 + 0.20 * tanh(0.08 * 3) = 1.047.

**Rarity**: 1970 'Cuda 440 Six-Pack production was approximately 2,000 units. Known surviving in system: 127. RarityMultiplier = 1.0 + 0.15 * log10(2000/128) = 1.0 + 0.15 * 1.19 = 1.179.

**Institutional**: No concours awards, no museum inclusion, no published references. InstitutionalMultiplier = 1.0.

### 10.4 Final Estimate

```
NE_mid = $108,000 * 0.931 * 1.311 * 1.047 * 1.179 * 1.0 = $162,700

NE_low = $89,000 * (multipliers with conservative condition, no matching premium) ≈ $105,000
NE_high = $128,000 * (multipliers with generous condition, full premiums) ≈ $225,000
```

**Confidence**: Comp count (5 comps, f=0.63), comp recency (newest 3 months, f=0.92), comp similarity (best 0.92), condition (grade from owner at trust 0.50, age 6 months, f=0.35), provenance completeness (0.36), observation density (38 observations, f=0.53).

Confidence = 0.63^0.25 * 0.92^0.20 * 0.92^0.15 * 0.35^0.15 * 0.36^0.10 * 0.53^0.15 = 0.89 * 0.98 * 0.99 * 0.85 * 0.90 * 0.91 = 0.61

**Confidence: 0.61 (Moderate)**

Primary drivers: Matching numbers provenance (+31%), rarity premium (+18%), below-norm condition (-7%).

The moderate confidence is driven by the condition assessment being owner-reported (low trust) and provenance being only 36% documented. A professional inspection and a documented provenance chain back to the factory would push confidence to High.

---

## Part XI: Open Questions

### 11.1 Emotional Premium

Some assets command premiums that no model can explain from fundamentals: the car that was in a famous movie, the painting that was the backdrop of a presidential portrait, the magazine cover that defined an era. These are emotional premiums that are real but not decomposable into the multiplier framework.

Question: Should emotional premium be a separate multiplier? If so, how is it quantified? Or is it simply captured in the comp data (the movie car sold for $X, which is the market's implicit emotional premium)?

### 11.2 Market Manipulation Detection

Some markets (particularly art) are susceptible to price manipulation through coordinated buying, consignment fraud, and third-party guarantees. The comp engine treats all sales as genuine market events. Should the model detect and discount suspicious sales?

Question: What statistical signatures distinguish genuine market activity from manipulation? Can the anomaly detection from signal calculation be applied to individual sale events rather than actor patterns?

### 11.3 Cross-Domain Valuation

When an asset spans domains (a vehicle that appeared in a film, an artwork that is also a vehicle, a magazine issue featuring a specific car), how should the valuation incorporate cross-domain signal?

Question: Is there a formal framework for cross-domain value attribution? Does a painting by a racing driver who crashed at Le Mans carry a premium from both the art and automotive domains?

### 11.4 Insurance vs. Market Value

Insurance replacement value and market value are different numbers. Insurance value represents the cost to replace with an equivalent; market value represents what a willing buyer would pay. The Nuke Estimate currently targets market value. Should it also compute insurance value?

Question: Is insurance value simply CompBase (without multipliers) plus a replacement cost premium? Or does it require a fundamentally different model?

### 11.5 Value at Future Dates

Users will inevitably ask: "What will my car be worth in 5 years?" The Nuke Estimate explicitly does not predict future values. Trajectory captures current momentum but is not a forecast.

Question: Should the system offer scenario analysis? "If the market continues at current trajectory and condition remains stable, the estimate in 3 years would be approximately $X." This is not a prediction -- it is a conditional projection. Is the distinction clear enough to be useful without being misleading?

### 11.6 The Zero-Comp Problem

For truly unique assets (one-of-one custom builds, unique artworks with no comparable sales by the same artist), the comp engine fails entirely. The estimate must fall back to:
- Component valuation (sum of parts and labor)
- Creator signal as value proxy (an artist with high signal produces works that are likely to sell if offered)
- Insured value as a floor

Question: Is there a formal methodology for valuing assets with zero comps? Or is "Insufficient data" the honest answer?

---

*This paper defines the mathematical framework for the Nuke Estimate. All parameters are initial values subject to empirical calibration as the feedback loop accumulates realized sale data. The model is domain-agnostic: the same formula applies to vehicles, artworks, and any future vertical with the appropriate feature set and parameter calibration.*

*Companion papers: Signal Calculation (trajectory and creator signal), Observation Half-Life Model (recency weighting), Entity Resolution Theory (comp matching relies on correct entity resolution).*
