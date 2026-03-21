# Signal Calculation: A Theory of Actor Quantification in Provenance Graphs

**Status**: Theoretical -- no implementation exists
**Author**: Nuke Research
**Date**: 2026-03-20
**Dependencies**: Observation system, source trust hierarchy, observation half-life model
**Domain**: Universal (automotive, art, publishing, all future verticals)

---

## Abstract

Every actor in the Nuke graph -- artist, collector, gallery, dealer, builder, driver, curator, handler, magazine, auction house -- generates signal through their actions. Signal is not reputation. Reputation is a social construct that can be manufactured. Signal is a mathematical quantity computed from the weighted sum of an actor's observable traces in the provenance graph.

This paper defines the signal computation model: the formula, each of its terms, the decay functions that govern temporal relevance, the anomaly detection layer that identifies unusual patterns, and the trajectory analysis that reveals whether an actor's signal is rising, falling, or plateauing. It then defines how signal profiles enable discovery without algorithmic recommendation -- how two actors whose signal profiles are complementary can find each other through the graph rather than through a feed.

The fundamental claim: at sufficient graph density, signal computation replaces human intuition about "who matters" with auditable, source-cited, time-weighted mathematical proof of activity, consistency, and trajectory.

---

## Part I: The Signal Formula

### 1.1 Core Definition

Signal is computed per actor, per time window, as a scalar value representing the weighted sum of observable activity.

```
S(actor, t, w) = SUM over i in O(actor, t, w) of:
    [ V(o_i) * T(s_i) * D(t, t_i, c_i) * A(o_i, actor) ]
```

Where:

- **S(actor, t, w)** is the signal score for a given actor at time t over window w
- **O(actor, t, w)** is the set of all observations linked to the actor within the time window [t-w, t]
- **V(o_i)** is the observation value weight -- the intrinsic importance of what was observed
- **T(s_i)** is the source trust score -- how trustworthy is the source of observation o_i
- **D(t, t_i, c_i)** is the temporal decay function -- how much has observation o_i decayed since its timestamp t_i, given its category c_i
- **A(o_i, actor)** is the anomaly factor -- how unusual is observation o_i relative to the actor's historical pattern

Each term is defined formally in the sections that follow.

### 1.2 Units and Scale

Signal is dimensionless. It has no inherent unit. Its meaning derives entirely from comparison -- an actor's signal relative to other actors in the same domain, or the same actor's signal over different time periods.

However, signal values cluster by domain and actor type. An active New York gallery has signal in a fundamentally different range than an individual collector. Comparisons are only meaningful within the same actor type and domain segment.

To enable cross-type comparison when necessary (e.g., ranking all actors connected to a specific asset), signal is normalized:

```
S_norm(actor, t, w) = S(actor, t, w) / S_max(type, domain, t, w)
```

Where S_max is the maximum signal observed for any actor of the same type in the same domain over the same window. This produces values in [0, 1] where 1.0 means "most active actor of this type in this domain right now."

Normalization is always context-dependent. A gallery with S_norm = 0.85 in the contemporary art domain might have S_norm = 0.02 if compared against automotive dealers. The normalization window defines the competitive set.

### 1.3 Time Windows

Signal is not a single number. It is a function of time. Every signal computation requires an explicit time window:

- **Trailing 90 days**: Current activity. The "what are they doing right now" signal.
- **Trailing 365 days**: Annual activity. The "are they consistently active" signal.
- **Trailing 3 years**: Medium-term trajectory. The "are they rising or declining" signal.
- **All-time**: Cumulative. The "total historical footprint" signal. Never decays to zero because some observations (institutional holdings, catalogue raisonne entries) have infinite half-lives.

Trajectory is computed as the derivative of signal over consecutive windows. See Part IV.

---

## Part II: Observation Value Weight -- V(o)

### 2.1 Definition

Not all observations are created equal. A museum acquiring an artwork is a higher-value observation than the artist posting a studio photo on Instagram. The observation value weight V(o) quantifies this difference.

V(o) is determined by two properties of the observation:

1. **The kind of observation** (what was observed)
2. **The magnitude of the observation** (how significant is this instance)

```
V(o) = K(kind) * M(o)
```

### 2.2 Kind Weights -- K(kind)

Kind weights are fixed per observation category. They reflect the structural importance of different types of activity in the provenance graph.

**For Artists / Builders / Creators:**

| Observation Kind | K(kind) | Rationale |
|-----------------|---------|-----------|
| Museum acquisition (permanent collection) | 10.0 | The highest validation in art. The institution commits capital and reputational stake. Equivalent to a vehicle entering a museum collection (Petersen, Revs Institute). |
| Biennale / major institutional exhibition | 8.0 | Curated selection at the highest level. Equivalent to a concours invitation (Pebble Beach, Amelia Island). |
| Solo exhibition at established gallery | 6.0 | A gallery stakes its program on the artist. Equivalent to a featured builder at SEMA or a shop profiled in a major publication. |
| Group exhibition at established gallery | 4.0 | Included but not featured. Signal of relevance to the gallery's program. |
| Auction result (sold) | 5.0 | Market validation. Price discovery. Equivalent across automotive and art domains. |
| Auction result (bought in / unsold) | 2.0 | Still generates signal -- the work was submitted and estimated. Non-sale is data. |
| Art fair presentation | 3.0 | Gallery chose to show this work at commercial venue. Equivalent to a vehicle appearing at a major car show. |
| Publication feature (editorial) | 4.0 | Magazine, journal, or book feature. Curated inclusion. See source trust for weighting by publication tier. |
| Publication mention (caption, listing) | 1.5 | Named but not featured. Still a trace. |
| Award / prize | 7.0 | Competitive selection by jury. Turner Prize, Hugo Boss Prize, etc. Equivalent to concours awards. |
| Catalogue raisonne inclusion | 3.0 | The definitive record acknowledges the work exists. Baseline validation. |
| Gallery representation (new) | 5.0 | A gallery commits to representing the artist. Major career event. Equivalent to a shop taking on a long-term restoration client. |
| Gallery representation (ended) | -2.0 | Negative signal. A gallery dropped the artist. Equivalent to a shop declining further work. |
| Certificate of authenticity issued | 2.0 | Authentication body confirms. Equivalent to matching-numbers verification for vehicles. |
| Certificate revoked | -5.0 | Strong negative signal. Authentication withdrawn. |

**For Collectors / Owners:**

| Observation Kind | K(kind) | Rationale |
|-----------------|---------|-----------|
| Acquisition at auction (public) | 5.0 | Public purchase. Identity may be known or anonymous. |
| Acquisition (private sale) | 4.0 | Less transparent but still documented. |
| Consignment to auction | 3.0 | Decision to sell through a public market. |
| Loan to museum exhibition | 6.0 | Collector lends to institution -- validation of the collection's quality and the collector's network. |
| Donation to museum | 8.0 | Permanent transfer. Highest-value collector action. Equivalent to donating a vehicle to a museum. |
| Insurance appraisal | 2.0 | Routine but generates a value data point. |
| Appeared at art fair as buyer | 2.0 | Presence signal. The collector is active and shopping. |
| Listed asset for sale | 1.0 | Disposition signal. Low weight because listing does not mean selling. |

**For Organizations (Galleries, Auction Houses, Museums, Shops):**

| Observation Kind | K(kind) | Rationale |
|-----------------|---------|-----------|
| Exhibition opened | 4.0 | Programming activity. Core function of the organization. |
| Auction conducted | 4.0 | Market event hosted. |
| New artist/client representation | 3.0 | Growth signal. Organization expanding its roster. |
| Staff hire (senior) | 3.0 | Director, curator, senior specialist. Organizational investment. |
| Staff departure (senior) | -2.0 | Negative signal. Institutional knowledge loss. |
| Publication produced | 2.0 | Catalog, monograph, magazine issue. Investment in documentation. |
| Asset sold through organization | 3.0 | Revenue event. Transaction completed. |
| New location opened | 4.0 | Expansion. Physical investment in new market. |
| Location closed | -3.0 | Contraction signal. |

### 2.3 Magnitude Multiplier -- M(o)

Within a kind, individual observations vary in magnitude. M(o) scales K(kind) based on the specific details of the observation.

For auction results, magnitude is price-based:

```
M(o) = log10(price_usd + 1) / log10(median_category_price + 1)
```

This produces:
- A $10,000 sale in a category where median is $50,000: M = log10(10001) / log10(50001) = 4.0 / 4.7 = 0.85
- A $500,000 sale in the same category: M = log10(500001) / log10(50001) = 5.7 / 4.7 = 1.21
- A $5,000,000 sale: M = 6.7 / 4.7 = 1.43

The logarithmic scaling prevents outlier prices from dominating signal. A $50M sale is not 5000x more signal than a $10K sale. It is approximately 1.7x more signal.

For exhibitions, magnitude is institution-weighted:

```
M(o) = S_norm(institution, t, 365)
```

A solo show at a gallery with high signal is worth more than a solo show at a gallery with low signal. The institution's own signal becomes the magnitude multiplier for observations it generates.

For publications, magnitude considers the publication's tier and the prominence of the mention:

```
M(o) = publication_tier_weight * prominence_factor
```

Where prominence_factor is:
- Cover feature: 3.0
- Multi-page editorial: 2.0
- Single page feature: 1.5
- Mention in list or review: 1.0
- Caption only: 0.5

For observations without a natural magnitude dimension (e.g., a gallery representation event), M(o) = 1.0.

---

## Part III: Source Trust -- T(s)

### 3.1 Definition

Source trust is defined in the observation source hierarchy (see Encyclopedia, Section 6). Each observation enters the system from a source with a base trust score.

T(s) is not identical to the base trust score. It is the base score modified by the source's track record within Nuke:

```
T(s) = base_trust(s) * accuracy_modifier(s) * freshness_modifier(s)
```

### 3.2 Base Trust Scores

These are defined canonically in the encyclopedia and reproduced here for completeness of the signal model.

**Art domain:**

| Source Type | Base Trust | Examples |
|------------|-----------|----------|
| Museum collection database | 0.95 | MoMA, Met, Tate, Pompidou |
| Catalogue raisonne | 0.95 | Published definitive catalogs |
| Auction house | 0.90 | Christie's, Sotheby's, Phillips |
| Art price database | 0.85 | Artnet, Artsy, MutualArt |
| Gallery (primary source) | 0.80 | Perrotin, Gagosian, Pace |
| Magazine/publication | 0.75 | Artforum, Frieze, System |
| Art fair | 0.70 | Art Basel, Frieze fair, FIAC |
| University/institution | 0.65 | MFA programs, faculty pages |
| Artist self-publication | 0.60 | Artist website, portfolio |
| Social media | 0.40 | Instagram, personal sites |
| Anonymous/unverified | 0.20 | Forum posts, tips |

**Automotive domain:**

| Source Type | Base Trust | Examples |
|------------|-----------|----------|
| Official registry/manufacturer | 0.95 | VIN decode, build sheet, window sticker |
| Curated auction | 0.90 | BaT, RM Sotheby's, Gooding |
| Professional inspection | 0.85 | PPI reports, concours judging |
| Volume auction | 0.75 | Mecum, Barrett-Jackson |
| Dealer listing | 0.70 | Hemmings, Hagerty, PCarMarket |
| Owner self-report | 0.60 | Direct owner input |
| Marketplace | 0.50 | eBay, Craigslist, FB Marketplace |
| Forum/community | 0.45 | Rennlist, TheSamba, Pelican Parts |
| Social media | 0.35 | Instagram, YouTube, Facebook groups |
| Anonymous/unverified | 0.20 | Unattributed claims |

### 3.3 Accuracy Modifier

Over time, the system learns which sources produce accurate data and which produce noise. The accuracy modifier adjusts base trust based on empirical verification.

```
accuracy_modifier(s) = 1.0 + alpha * (verified_rate(s) - expected_rate(s))
```

Where:
- **verified_rate(s)** = proportion of observations from source s that have been corroborated by a higher-trust source
- **expected_rate(s)** = the average verified rate for all sources at the same base trust tier
- **alpha** = learning rate parameter (initially 0.1, slowly increasing as sample sizes grow)

A source that consistently provides data later confirmed by higher-trust sources sees its effective trust rise. A source whose claims are frequently contradicted sees its trust decline. The modifier is bounded: accuracy_modifier in [0.5, 1.5]. No source can gain or lose more than 50% of its base trust through the accuracy modifier alone.

### 3.4 Freshness Modifier

Sources that are actively maintained and regularly updated are more trustworthy than stale sources.

```
freshness_modifier(s) = min(1.0, 0.7 + 0.3 * (1 / (1 + days_since_last_observation(s) / 90)))
```

A source that produced an observation within the last day: freshness = 1.0.
A source that last produced an observation 90 days ago: freshness = 0.85.
A source that last produced an observation 365 days ago: freshness = 0.77.

The freshness modifier never drops below 0.70. A museum database that hasn't been scraped in a year is still more trustworthy than a social media post from yesterday. Freshness modulates trust; it doesn't replace it.

---

## Part IV: Temporal Decay -- D(t, t_i, c_i)

### 4.1 Definition

Observations decay in relevance over time. The decay rate depends on the category of the observation. This is defined formally in the companion paper "Observation Half-Life Model." Here we summarize the interface to the signal computation.

```
D(t, t_i, c_i) = exp(-lambda(c_i) * (t - t_i))
```

Where:
- **t** is the current time
- **t_i** is the observation timestamp
- **lambda(c_i)** = ln(2) / half_life(c_i), the decay constant for category c_i

### 4.2 Category Half-Lives (Summary)

| Category | Half-Life | lambda | Rationale |
|----------|-----------|--------|-----------|
| Identity (VIN, catalogue raisonne number) | Infinite | 0 | Never decays. Identity is permanent. |
| Museum acquisition | 20 years | 0.0347 | Permanent collection entries are nearly permanent signal. |
| Auction result | 3 years | 0.231 | Market relevance fades as new comps emerge. |
| Exhibition | 2 years | 0.347 | Shows generate attention that fades. |
| Condition report | 2 years | 0.347 | Physical state changes. |
| Gallery representation | 5 years | 0.139 | Relationships endure but relevance to current signal fades. |
| Publication feature | 5 years | 0.139 | Published works remain relevant longer than exhibitions. |
| Appraisal / valuation | 1 year | 0.693 | Market values shift annually. |
| Social media post | 90 days | 2.81 | Ephemeral by nature. |
| Owner claim (unverified) | 6 months | 1.39 | Decays rapidly without corroboration. |
| Marketplace listing | 3 months | 2.77 | Listings are transient commercial events. |

### 4.3 Interaction with Source Trust

Decay and trust interact multiplicatively. A high-trust observation with a long half-life dominates signal for years. A low-trust observation with a short half-life contributes briefly and fades. This is by design: the system naturally emphasizes durable, well-sourced data over ephemeral noise.

Example: A museum acquisition (K=10.0, T=0.95, half-life=20 years) contributes meaningful signal decades after the event. An Instagram post (K=1.0, T=0.40, half-life=90 days) contributes almost nothing after six months and is functionally zero after a year.

---

## Part V: Anomaly Factor -- A(o, actor)

### 5.1 Definition

The anomaly factor rewards observations that represent unusual or unexpected activity for a given actor. It amplifies signal from events that break the pattern.

```
A(o, actor) = 1.0 + beta * surprise(o, actor)
```

Where:
- **beta** = anomaly sensitivity parameter (default 0.3)
- **surprise(o, actor)** = how unexpected this observation is given the actor's historical pattern

### 5.2 Computing Surprise

Surprise is computed by comparing the observation against the actor's historical distribution of observations by kind.

```
surprise(o, actor) = max(0, (1 - P(kind(o) | actor_history)))
```

Where P(kind | actor_history) is the empirical probability of observing this kind of event from this actor, based on their historical observation distribution.

An artist who has 200 gallery exhibitions and suddenly appears at an auction for the first time: P(auction | history) is near zero, so surprise is near 1.0, and the anomaly factor amplifies this observation.

A gallery that opens 3 exhibitions per year and opens another: P(exhibition | history) is high, so surprise is near 0, and the anomaly factor is approximately 1.0. Normal activity gets no anomaly boost.

### 5.3 Anomaly Types

Different types of anomalies carry different interpretive weight:

**Domain-crossing anomaly**: An actor primarily active in one domain appears in another. An automotive collector buys an artwork at Christie's. A gallery starts representing an artist who makes vehicle-based installations. These cross-domain appearances have high surprise and high signal value because they reveal hidden connections in the graph.

**Tier-jumping anomaly**: An actor previously active only at lower tiers appears at a higher tier. An artist shown only in small galleries suddenly appears in a museum exhibition. A car previously sold only on Craigslist appears at RM Sotheby's. The tier jump is a signal event.

**Frequency anomaly**: An actor who was dormant becomes suddenly active, or vice versa. A collector who hasn't been seen at auction in 5 years buys three lots in one evening. A gallery that has been representing an artist for 15 years suddenly drops them. Frequency changes are signal.

**Geographic anomaly**: An actor who operates in one region appears in another. A New York gallery opens in Paris. A Midwest restoration shop's work appears at a California concours. Geographic expansion is a signal event.

### 5.4 Anomaly Bounds

The anomaly factor is bounded: A(o, actor) is in [1.0, 2.0]. No single observation can more than double its contribution through anomaly alone. This prevents rare events from disproportionately distorting the signal.

For new actors (fewer than 10 observations), the anomaly factor is fixed at 1.0. There is insufficient history to compute surprise. As the actor accumulates observations, the anomaly factor activates.

---

## Part VI: Signal Profiles and Profile Matching

### 6.1 Signal Profile Definition

A signal profile is not a single number. It is a multi-dimensional vector describing the shape of an actor's signal across observation kinds and domains.

```
Profile(actor, t, w) = {
    kind_distribution: { exhibition: 0.35, auction: 0.25, publication: 0.20, ... },
    domain_distribution: { art: 0.80, automotive: 0.15, publishing: 0.05 },
    tier_distribution: { tier_1: 0.10, tier_2: 0.30, tier_3: 0.40, tier_4: 0.20 },
    geographic_distribution: { north_america: 0.60, europe: 0.30, asia: 0.10 },
    temporal_pattern: { frequency: 12.5/year, consistency: 0.78, trend: +0.15 },
    anomaly_rate: 0.08,
    total_signal: 847.3,
    signal_rank_percentile: 0.92
}
```

### 6.2 Kind Distribution

The kind distribution reveals what an actor does. An artist whose kind distribution is dominated by exhibitions is a showing artist. One dominated by auction results is a market artist. One dominated by publications is an academic or critically-engaged artist. One with significant representation events is a career-building artist.

For vehicle actors: a builder whose distribution is dominated by restoration-completion observations is productive. One dominated by acquisition observations is accumulating. One with concours observations is competing.

### 6.3 Tier Distribution

The tier distribution reveals at what level the actor operates. An actor concentrated in tiers 1-2 operates at the highest institutional level. An actor concentrated in tiers 7-8 operates in the informal market. An actor spread across tiers is broad-based.

The tier distribution is not a quality judgment. An artist who operates entirely through Instagram (tier 10) but has high signal there is not "worse" than a museum-collected artist. They operate in a different market. The tier distribution describes the market, not the merit.

### 6.4 Profile Matching -- Complementary Signal

Two actors whose signal profiles are complementary -- not similar, complementary -- represent potential organic connections.

The complement of a profile is the inverse of its kind and tier distributions. A collector who buys heavily at tier-2 auctions is complementary to an artist who shows heavily at tier-2 galleries (the gallery-to-auction pathway). A magazine that covers emerging artists (tier 6-8) is complementary to a gallery looking for emerging talent (tier 4-5 acquisition pattern).

Complementary signal is defined as:

```
C(actor_a, actor_b) = SUM over dimensions of:
    [ w_dim * cosine_distance(profile_a[dim], complement(profile_b[dim])) ]
```

Where cosine_distance measures the angle between the profile vector and the complement vector. High complementary score means: what actor A is looking for (inferred from their exploration patterns) matches what actor B is producing (inferred from their activity patterns).

### 6.5 Profile Matching vs. Recommendation

This computation is available for query but is never used to generate recommendations. The distinction is architectural and absolute:

- **Query**: A gallery director opens Nuke, searches for "artists producing consistent work in oil on canvas, active in Northeast US, showing at tier 5-7, with rising trajectory." The system returns actors matching this signal profile. The gallery director chose to search. The system answered.

- **Recommendation**: The system sends a push notification: "Based on your activity, you might be interested in this artist." The system chose to interrupt. The actor did not ask.

Nuke performs queries. It does not generate recommendations. The signal profile exists to make queries powerful. It does not exist to power a feed. See the companion paper "Organic Connection Theory" for the full philosophical and technical treatment of this distinction.

---

## Part VII: Trajectory Computation

### 7.1 Definition

Trajectory is the derivative of signal over time. It answers: is this actor's signal rising, falling, or flat?

```
Trajectory(actor, t) = (S(actor, t, w_short) - S(actor, t - w_short, w_short)) / S(actor, t - w_short, w_short)
```

Where w_short is typically 90 days. This computes the percentage change in signal between the most recent 90-day window and the preceding 90-day window.

### 7.2 Trajectory Categories

| Trajectory Value | Category | Interpretation |
|-----------------|----------|----------------|
| > +0.50 | Accelerating | Signal more than doubled. Rapid rise in activity or tier. |
| +0.15 to +0.50 | Rising | Healthy growth. More activity, higher tiers, new domains. |
| -0.15 to +0.15 | Stable | Consistent activity. Neither growing nor declining. |
| -0.50 to -0.15 | Declining | Reduced activity. Fewer observations, lower tiers. |
| < -0.50 | Fading | Signal more than halved. May indicate retirement, withdrawal, or crisis. |

### 7.3 Trajectory Smoothing

Raw trajectory is noisy. A single large observation (a major auction result) can spike the trajectory and then collapse it. To produce meaningful trajectory readings, the system applies exponential moving average smoothing:

```
Trajectory_smooth(actor, t) = alpha * Trajectory(actor, t) + (1 - alpha) * Trajectory_smooth(actor, t - dt)
```

Where alpha = 0.3, giving a smoothing window of approximately 3 measurement periods (9 months at quarterly measurement).

### 7.4 Trajectory as Predictive Signal

Trajectory is the most predictive component of signal for valuation purposes. An artist with rising trajectory commands higher prices at auction than their current signal level would predict, because the market prices in expected future activity. A vehicle builder with rising trajectory gets commissions faster and at higher rates.

The Nuke Estimate incorporates trajectory as a multiplier on the base valuation. See the companion paper "Valuation Methodology" for the full treatment.

---

## Part VIII: Worked Examples

### 8.1 Example: Emerging Artist

**Actor**: Young painter, MFA graduate, 2 years post-school.
**Observations in trailing 365 days**:
- 3 group exhibitions at established galleries (K=4.0 each, T=0.80, age=2,6,10 months)
- 1 solo exhibition at mid-tier gallery (K=6.0, T=0.80, age=4 months)
- 1 art fair presentation (K=3.0, T=0.70, age=8 months)
- 2 magazine mentions (K=1.5 each, T=0.75, age=3,9 months)
- 15 Instagram posts (K=0.5 each, T=0.40, age=scattered 1-12 months)
- 1 auction result, $12,000 (K=5.0, M=log10(12001)/log10(50001)=0.87, T=0.90, age=5 months)

**Signal computation** (simplified, decay at 365-day window):

| Observation | V(o) | T(s) | D | A | Contribution |
|------------|------|------|---|---|-------------|
| Group show 1 (2mo) | 4.0 | 0.80 | 0.95 | 1.0 | 3.04 |
| Group show 2 (6mo) | 4.0 | 0.80 | 0.79 | 1.0 | 2.53 |
| Group show 3 (10mo) | 4.0 | 0.80 | 0.66 | 1.0 | 2.11 |
| Solo show (4mo) | 6.0 | 0.80 | 0.87 | 1.15 | 4.80 |
| Art fair (8mo) | 3.0 | 0.70 | 0.72 | 1.10 | 1.66 |
| Magazine 1 (3mo) | 1.5 | 0.75 | 0.91 | 1.05 | 1.08 |
| Magazine 2 (9mo) | 1.5 | 0.75 | 0.69 | 1.05 | 0.82 |
| Instagram (avg 6mo) | 7.5 total | 0.40 | 0.03 avg | 1.0 | 0.09 |
| Auction (5mo) | 4.35 | 0.90 | 0.83 | 1.25 | 4.06 |
| **Total** | | | | | **20.19** |

Notes on anomaly factors: The solo show gets A=1.15 because the artist has a relatively thin exhibition history and a solo is less frequent than groups. The auction result gets A=1.25 because it is the artist's first auction appearance -- high surprise. Instagram posts contribute almost nothing because of low trust weight and rapid decay.

**Profile shape**: Kind distribution: exhibitions dominant (60%), auction emerging (20%), publications minor (10%), social media negligible (0.5%). Tier distribution: concentrated at tier 4-5. Geographic: single region. Trajectory: rising (first auction appearance, increasing exhibition frequency).

This artist would be findable by a query like: "emerging painters, tier 4-5, rising trajectory, recent first auction result under $25K, active in [region]."

### 8.2 Example: Established Restoration Shop

**Actor**: Automotive restoration shop, 15 years in business.
**Observations in trailing 365 days**:
- 6 restoration completions documented (K=4.0 each, T=0.85 from owner documentation, various ages)
- 2 vehicles they restored sold at BaT (K=5.0 each, M=log10(85001)/log10(50001)=1.05 and M=log10(45001)/log10(50001)=0.99, T=0.90)
- 1 Hemmings feature article (K=4.0, T=0.75)
- 1 concours class win for a vehicle they restored (K=7.0, T=0.85)
- 12 vehicles currently in progress (K=1.0 each, T=0.60 from owner self-report)
- 4 forum posts by clients praising their work (K=1.0 each, T=0.45)

**Total signal**: approximately 65.8 (the exact computation follows the formula above).

**Profile shape**: Kind distribution: restorations dominant (40%), auction results (20%), competition results (10%), publications (8%), active projects (15%). Tier distribution: spread across tiers 2-5. Geographic: single region with national reach via auction results.

**Trajectory**: Stable. Consistent output year over year. The concours win is an anomaly (A=1.2) because it is the shop's first competitive result, but it does not change the overall trend.

### 8.3 Example: Gallery with Sudden Decline

**Actor**: Mid-tier gallery, previously active, now contracting.

**Trailing 90-day signal**: 12.3
**Previous 90-day signal**: 38.7
**Trajectory**: -0.68 (Fading)

The graph tells the story: three staff departures in the last quarter (K=-2.0 each), one artist dropped from the roster (K=-2.0), zero new exhibitions opened (where the historical rate was 4 per quarter), and two artists they represented appeared at other galleries (anomaly signal on those artists, negative implication for this gallery).

A collector monitoring this gallery through the graph would see the trajectory shift before any public announcement. The data reveals institutional health before the press release.

---

## Part IX: Computational Considerations

### 9.1 When to Compute

Signal is not computed in real time. It is materialized periodically and cached.

**Computation schedule**:
- Trailing 90-day signal: recomputed daily for actors with new observations in the last 7 days
- Trailing 365-day signal: recomputed weekly for all actors with at least one observation in the trailing year
- Trailing 3-year signal: recomputed monthly for all actors
- All-time signal: recomputed monthly for all actors
- Trajectory: recomputed weekly from the cached signal values

### 9.2 Storage

Signal is stored as materialized rows:

```
actor_signal (
    actor_id,
    actor_type,
    domain,
    window,
    signal_value,
    signal_rank_percentile,
    trajectory,
    trajectory_category,
    profile_json,
    computed_at
)
```

Historical signal values are retained for trend analysis. One row per actor per window per computation date.

### 9.3 Scale

At current scale (141K vehicles, unknown number of art entities in future), the computation is trivial. At target scale (millions of assets, hundreds of thousands of actors), the computation requires:

- Observation count per actor per window: bounded by the observation table size
- Profile computation: O(n) per actor where n is observation count in window
- Trajectory: O(1) per actor (comparison of two cached values)
- Ranking: O(n log n) per actor type per domain where n is actor count

The bottleneck is the initial observation aggregation. Partitioning the observation table by time window and indexing by actor_id makes this manageable at any realistic scale.

---

## Part X: Open Questions

### 10.1 Weight Calibration

The kind weights K(kind) are defined by domain intuition. They have not been empirically calibrated. An empirical approach would examine which observation kinds are most predictive of future signal changes: if museum acquisitions predict rising trajectory more strongly than exhibitions, the weight should be higher.

Question: Can we derive K(kind) from historical data rather than defining it by fiat?

### 10.2 Cross-Domain Signal Normalization

When an actor operates across domains (a collector who owns vehicles and artworks), their signal is currently computed independently per domain. Should cross-domain activity amplify signal? Is a collector with high signal in both automotive and art more interesting than one with the same total signal concentrated in a single domain?

Question: Is there a meaningful way to compute "portfolio diversity" as a signal dimension?

### 10.3 Network Effects

The current model computes signal per actor independently. It does not account for network effects: an actor connected to many high-signal actors may have higher signal than their individual observations would suggest.

Question: Should signal propagate through graph edges? If so, at what rate and with what decay? This risks creating circular amplification (two actors inflating each other's signal by being connected).

### 10.4 Negative Signal

The current model handles negative observations (gallery drops artist: K=-2.0) but does not have a concept of negative signal as a distinct dimension. An actor who generates controversy (authentication disputes, legal proceedings, price manipulation allegations) has a different signal profile than one who is simply inactive.

Question: Should negative signal be tracked as a separate dimension rather than being subtracted from positive signal?

### 10.5 Privacy and Anonymity

Some actors are deliberately anonymous (private collectors who buy through advisors, artists who work under pseudonyms). The signal model computes on observable traces, but deliberate anonymity produces artificially low signal.

Question: How should the system handle actors who are known to be significant but whose observations are masked by anonymity? Should there be a "known unknown" category?

### 10.6 Cold Start

New actors have zero signal. The anomaly factor is disabled. Their signal profile is empty. How long does it take for signal to become meaningful?

With current kind weights and source trust: a single museum exhibition generates approximately 8.0 signal. A single auction result generates 3-5 signal. The minimum signal for a meaningful profile (enough to compute a stable kind distribution) requires approximately 10-15 observations across at least 3 kinds.

Question: For a new actor, what is the minimum observation set needed to produce a reliable signal profile? Can we define a "signal confidence" that indicates when the profile is trustworthy?

---

*This paper defines the mathematical framework for signal computation. It does not prescribe implementation. The formulas, weights, and parameters are starting points that should be calibrated against empirical data as the system accumulates observations at scale.*

*Companion papers: Observation Half-Life Model (decay functions), Valuation Methodology (signal as valuation input), Organic Connection Theory (signal profiles as discovery enabler), Entity Resolution Theory (how observations link to actors).*
