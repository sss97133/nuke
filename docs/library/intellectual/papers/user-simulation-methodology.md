# PAPER: Digital Twins of Market Participants — Methodology for Persona Simulation from Behavioral Trace

**Author:** Nuke Platform Research
**Date:** 2026-03-27
**Status:** Living Document
**References:** Papers: applied-ontology-vehicle-domain.md, novel-ontological-contributions.md, trust-scoring-methodology.md; Contemplations: testimony-and-half-lives.md, assets-accumulate-data.md

---

## Abstract

We present a methodology for constructing behavioral simulations of individual market participants from their observable trace — comment history, bidding behavior, transaction records, and taste patterns accumulated over years of activity on auction platforms. Unlike conventional user profiling (which summarizes preferences for recommendation) or personality detection (which maps text to trait labels), our approach treats a person the same way the Nuke platform treats a vehicle: as an immutable identity that accumulates observations over time, where current behavioral state is *computed* from the full observation stack, not stored as a static profile.

The methodology addresses three challenges unique to the collector vehicle domain: (1) expertise is *episodic and accumulative*, not trait-stable — a Mustang specialist may flip to trucks, a paint expert may shift to mechanical; (2) the same person operates across measurement paradigms (SAE versus metric, American versus European, concours versus restomod) with equal fluency; and (3) behavioral fidelity requires capturing the *edges* of a person's distribution — their sarcasm, their formulaic openings, their exclamation habits — not just their central tendency.

We describe a four-layer analysis instrument, a stratified sampling strategy that preserves expertise phase transitions, an era detection algorithm that identifies the palimpsest layers of a person's evolving interests, and a validation framework grounded in distributional fidelity metrics. Empirical results from five power users (15,000+ comments each) demonstrate that stylometric fingerprints are stable across eras while topic preferences shift — yielding the core finding: **style is identity, topic is era**.

---

## I. Introduction: From Vehicle Digital Twin to Person Digital Twin

### I.A The Ontological Extension

The Nuke platform's vehicle ontology rests on a principle established in "Applied Ontology in the Collector Vehicle Domain" (2026): **the database does not describe the vehicle; the database IS the vehicle**. Every assertion about a vehicle — its color, its mileage, its provenance — is testimony from a source, at a time, with a trust weight. The vehicle's current state is computed from the convergence (or divergence) of these observations.

We propose extending this principle to market participants. A person's behavioral profile is not a fixed description — it is the accumulation of every comment they wrote, every bid they placed, every vehicle they sold, every question they asked. Their "current state" — expertise level, taste preferences, epistemic style, community role — is computed from this observation stack, not stored as a snapshot.

This extension is not merely analogical. The same epistemological framework applies:

| Principle | Vehicle | Person |
|-----------|---------|--------|
| Identity is immutable | VIN stamped at manufacture | Username registered at first activity |
| Observations accumulate | Paint events, service records, ownership changes | Comments, bids, sales, expertise demonstrations |
| Current state is computed | Weighted composite of all observations | Aggregated behavioral profile from full history |
| Testimony has half-lives | Paint condition claim decays in 2 years | Expertise assessment decays if not reinforced |
| Disagreement is data | Two inspectors disagree on matching numbers | Same person is snarky on one thread, helpful on another |
| Source trust is earned | Factory records > forum claims | Verified expertise > casual opinion |

### I.B The 500K Vision

Bring a Trailer's comment corpus contains 520,751 unique usernames. Of these, 19,276 have 100+ comments — sufficient signal for behavioral profiling. 1,003 have 1,000+ comments — a novel's worth of text per person. 63 have 5,000+ comments — enough for a documentary.

Each of these participants carries a latent model: a way of seeing vehicles, a price sensitivity curve, a set of expertise domains, a writing voice, a community role. The vision is not to fine-tune 500,000 models in the machine learning sense, but to *compile behavioral profiles* that any LLM can inhabit via a structured system prompt — a persona specification grounded entirely in observed behavior, not imagined narrative.

### I.C What This Paper Covers

- Section II: The epistemological framework — what we can and cannot know about a person from their text
- Section III: The four-layer analysis instrument — from raw text to behavioral profile
- Section IV: Era detection and the palimpsest model — expertise phase transitions
- Section V: Empirical results — five users, five distinct fingerprints
- Section VI: Validation framework — how to measure simulation fidelity
- Section VII: Temporal dynamics — drift, decay, and staleness
- Section VIII: Ethical considerations and limitations

---

## II. Epistemological Framework: What Text Reveals

### II.A The Ceiling of Personality Detection

A substantial body of work has established that personality traits can be detected from text — and that this detection has hard limits.

Schwartz et al. (2013) analyzed 700 million words from 75,000 Facebook users using an open-vocabulary approach, demonstrating that language features predict Big Five personality traits. Park et al. (2015), using 66,732 Facebook users, achieved correlations between predicted and self-reported personality of r = .31 (Agreeableness) to r = .41 (Openness). The Azucar et al. (2018) meta-analysis confirmed these ranges across studies.

These correlations explain roughly 9–16% of variance. This is the empirical ceiling: text-based personality detection is useful for population-level tendencies but insufficient for individual prediction. We treat personality dimensions as *probabilistic tendencies* in our profiles, not deterministic labels.

### II.B What IS Stable: The Stylometric Fingerprint

Mosteller and Wallace (1964) demonstrated that function word frequencies — articles, prepositions, pronouns — are diagnostic of authorship because they are produced largely unconsciously and are independent of topic. Pennebaker and King (1999) extended this, showing that linguistic style (measured via word choice patterns) is a reliable individual difference correlated with personality across independent samples.

Yule (1944) introduced the K characteristic for measuring vocabulary richness in a length-independent manner. Stamatatos (2009) surveyed modern stylometric methods, confirming that character-level and function-word features outperform content-based features for authorship attribution.

Our Layer 0 instrument (Section III) is built on these foundations: sentence length distribution, vocabulary richness (Yule's K, type-token ratio, hapax legomena ratio), function word frequency profiles, and punctuation patterns. These features are:

1. **Topic-independent** — stable whether the user is discussing Porsches or trucks
2. **Unconscious** — produced without deliberate choice
3. **Measurable at zero cost** — pure computation on existing text, no API calls
4. **Comparable across eras** — the same features measured in 2017 and 2024

### II.C What IS Diagnostic: Epistemic Stance

Hyland (1998, 2005) established a framework for analyzing epistemic markers in academic discourse: *hedging* (markers of uncertainty: "might," "could," "arguably") and *boosting* (markers of certainty: "clearly," "obviously," "definitely"). The ratio of hedging to boosting reveals epistemic orientation:

- **High hedge/boost ratio** (>1.0): The writer acknowledges uncertainty, qualifies claims, operates with epistemic care. In our domain, this correlates with genuine expertise — experts know what they don't know.
- **Low hedge/boost ratio** (<0.8): The writer states with confidence, uses declarative language, makes unhedged claims. In our domain, this correlates with either deep specialized knowledge (certainty from experience) or overconfidence (certainty from ignorance).

The diagnostic power comes from combining hedge/boost ratio with domain vocabulary density: a writer who hedges AND uses technical vocabulary is genuinely expert. A writer who boosts without technical vocabulary is performing confidence. This interaction effect is more informative than either signal alone.

### II.D The Automotive Domain Anomaly

Standard psycholinguistic profiling assumes trait stability — extraversion measured this year predicts extraversion next year. The collector vehicle domain violates this assumption in a specific way:

**Expertise is episodic and accumulative.** A user may specialize in Mustangs for five years, accumulating deep knowledge of Boss 302 production numbers, Cleveland versus Windsor blocks, and Marti reports — then flip to trucks, where the relevant knowledge is transfer cases, axle ratios, and frame conditions. The Mustang knowledge doesn't disappear; it becomes *latent*. The person's expertise is not a single vector but a *palimpsest* of layered specializations.

**The measurement paradigm shifts.** The same user may be equally fluent in SAE and metric specifications, American and European marque conventions, concours judging standards and restomod philosophy. These are not merely different topics — they are different epistemological frameworks applied to the same physical domain. A user who writes expertly about both a 1969 Camaro Z/28 and a 1973 Porsche 911 Carrera RS is operating across two complete vocabularies, two sets of community norms, two valuation frameworks.

This means any sampling strategy that randomly selects comments risks missing entire expertise domains. Our stratified sampler (Section III) addresses this by sampling across both time periods and vehicle categories.

---

## III. The Four-Layer Analysis Instrument

We decompose the analysis of a user's comment history into four layers of increasing cost and decreasing coverage:

```
Layer 0: STRUCTURAL     — pure math, no dictionaries     — every comment
Layer 1: LEXICAL         — dictionary-based lookup        — every comment
Layer 2: PRAGMATIC       — pattern matching               — every comment
Layer 3: AI-DERIVED      — LLM extraction                 — sampled (50 per user)
───────────────────────────────────────────────────────────────────────────
         AGGREGATOR      — per-user profile compiler       — runs after all layers
         VALIDATOR       — fidelity measurement            — holdout set
```

### III.A Layer 0: Structural Fingerprint

Layer 0 computes features that require no dictionaries, no API calls, and no domain knowledge. These are pure statistical properties of the text.

**Sentence-level features:**
- Mean sentence length (words per sentence)
- Sentence length standard deviation (rhythm variability)
- Sentence count per comment

**Word-level features:**
- Mean word length (character count)
- Type-token ratio (vocabulary diversity)
- Hapax legomena ratio (words appearing exactly once / unique words)
- Yule's K characteristic (vocabulary richness, length-independent)

**Function word profile:**
- Normalized frequencies (per 1,000 words) for the 100 most common English function words
- Top-20 function words with frequencies constitute the *fingerprint*

**Punctuation signature:**
- Rates per sentence: commas, exclamations, questions, dashes, ellipses, parentheses, @mentions

**Structural patterns:**
- Opening pattern classification: @mention, greeting, exclamation, self-reference, demonstrative, question, negation, numeric, continuation
- Self-reference rate (I/me/my per 1,000 words)
- Other-reference rate (you/your per 1,000 words)

These features are computed per-comment and aggregated per-user. The aggregation includes distributional statistics (mean, standard deviation, percentiles) rather than simple averages, preserving information about behavioral range.

### III.B Layer 1: Lexical Analysis

Layer 1 applies calibrated dictionaries to classify word usage. The existing `analyze-comments-fast` infrastructure provides:

**Sentiment dictionaries:** 50+ positive terms (weight 0.5–2.0), 30+ negative terms (weight -0.5 to -2.0), with negation detection (3-word window) and intensifier amplification (1.5× multiplier).

**Condition vocabulary:** 60+ patterns across positive condition, negative condition, modification, and restoration quality categories.

**Technical vocabulary density:** 60+ automotive domain terms spanning engine, transmission, suspension, body, and collector-specific vocabulary.

**Epistemic markers** (added by this methodology):
- 30 hedging markers (Hyland 1998): "might," "could," "probably," "suggest," "appear"
- 20 boosting markers: "clearly," "obviously," "definitely," "guarantee," "prove"
- Hedge/boost ratio as an expertise calibration signal

### III.C Layer 2: Pragmatic Analysis

Layer 2 detects discourse-level patterns — how the person structures their participation in conversation:

**Comment role classification:** seller_response, observation, bid, question, answer, expert_opinion (from existing `auction_comments.comment_type`)

**Claim density scoring:** The `commentRefinery.ts` infrastructure applies 18 regex patterns across 5 claim categories (specifications, condition, provenance, market signals, library knowledge) to score each comment's information density (0–1 scale).

**Engagement patterns:** @mention frequency, question-asking rate, advice-giving patterns, disagreement markers, humor markers.

**Social reference density:** Names, shops, events, locations — indicators of network embeddedness.

### III.D Layer 3: AI-Derived Extraction

Layer 3 uses LLM extraction on a strategically sampled subset of comments. The existing `comment_persona_signals` schema provides 40+ per-comment signals:

**Tone (5 dimensions, 0–1):** helpful, technical, friendly, confident, snarky

**Expertise (4 signals):** level (novice/enthusiast/expert/professional), areas (text array), shows_specific_knowledge, cites_sources

**Intent (4 signals):** primary intent, is_serious_buyer, is_tire_kicker, is_seller_shill

**Engagement (6 signals):** asks_questions, answers_questions, gives_advice, makes_jokes, critiques_others, supports_others

**Trust (3 signals):** makes_claims, claims_verifiable, admits_uncertainty

Per Park et al. (2015), personality detection accuracy plateaus after approximately 500 text samples. For a user with 15,000 comments, we extract Layer 3 signals on 50 strategically sampled comments:
- 10 highest-engagement comments (most representative of their public persona)
- 10 seller responses (if any — reveals their commercial voice)
- 10 longest substantive comments (deepest expertise demonstration)
- 10 random from the most recent 2 years (current state)
- 10 random from their full history (baseline)

### III.E The Stratified Sampler

Standard random sampling risks missing entire expertise domains — the Mustang era, the truck phase, the brief Alfa Romeo flirtation. Our sampler stratifies by both vehicle category (make) and time:

1. Group all comments by make
2. Allocate proportionally (make with 40% of comments gets 40% of sample budget) with a minimum of 3 per make
3. Within each make allocation: take 20% from earliest comments, 20% from latest, and the remainder from a random middle selection
4. Up to 20 unmapped comments (no vehicle linkage) included

This ensures that a user who commented on Porsches from 2016–2020 and trucks from 2020–2024 gets representation from both eras, even if the truck era is numerically smaller.

---

## IV. Era Detection and the Palimpsest Model

### IV.A What Is an Era?

An *era* is a sustained period during which a user's dominant vehicle category is stable. The boundary between eras represents a *phase transition* in interest — not a gradual drift but a shift in primary focus.

We detect eras by:
1. Dividing the user's comment timeline into calendar quarters
2. Computing the dominant make (by comment count) per quarter
3. Identifying boundaries where the dominant make shifts for 2+ consecutive quarters (filtering single-quarter noise)
4. Attaching comments to their era by date range

### IV.B The Palimpsest Interpretation

The palimpsest lifecycle model, introduced in "Novel Ontological Contributions" (2026), describes how physical assets pass through states where previous layers remain legible beneath current ones. We apply the same concept to expertise:

- A user's Mustang era (2015–2020) is not erased by their truck era (2020–2024)
- The Mustang knowledge is *latent* — available if provoked, but not the current focus
- The stylometric fingerprint (Layer 0) remains stable across eras
- The domain vocabulary (Layer 1) shifts with era transitions
- The epistemic stance may shift (more hedging in unfamiliar territory, more boosting in areas of deep experience)

This produces a multi-era profile:
```
User "1600veloce":
  Era 1: 2016-Q3 → 2020-Q4 (BMW)     — 3,764 comments
  Era 2: 2021-Q1 → 2021-Q1 (Chevrolet) — 330 comments
  Era 3: 2021-Q2 → 2022-Q1 (Porsche)  — 1,773 comments
  Era 4: 2022-Q2 → 2022-Q3 (BMW)      — 1,028 comments
  Era 5: 2022-Q4 → 2026-Q1 (Porsche)  — 6,826 comments
```

The oscillation between BMW and Porsche is itself informative — this user has deep expertise in both European marques and periodically returns to each. A simulation of 1600veloce should be capable of operating in either domain.

### IV.C Empirical Observation: Style Is Identity, Topic Is Era

Our empirical results (Section V) demonstrate a striking pattern: Layer 0 features (stylometric fingerprint) are stable across eras, while Layer 1 features (domain vocabulary) shift with era transitions.

DENWERKS writes with high exclamation rates (0.64/sentence) and high self-reference (33.1/1K words) whether discussing Fords, Nissans, Chevrolets, or Volvos. Their *voice* is constant; their *subject* changes.

This decoupling is methodologically important: it means the stylometric fingerprint can serve as a *stable identity marker* while the domain expertise profile captures *what they currently know*. The simulation must model both: inhabit the stable voice while drawing on the era-appropriate expertise.

---

## V. Empirical Results

We analyzed five power users from the BaT comment corpus using the Layer 0 instrument:

### V.A Writing Signatures

| Feature | 911r | 1600veloce | VivaLasVegas | Wob | DENWERKS |
|---------|------|-----------|-------------|-----|---------|
| Sentence length (μ) | 12.3 | 11.1 | 14.7 | 12.6 | 17.0 |
| Comment length (median) | 17 | 30 | 39 | 28 | 29 |
| Comment length (p90) | 60 | 178 | 384 | 225 | 148 |
| Yule's K | 88 | 81 | 74 | 81 | 76 |
| Self-reference (/1K) | 16.4 | 18.3 | 30.8 | 18.7 | 33.1 |
| Exclamation rate | 0.18 | 0.09 | 0.07 | 0.28 | 0.64 |
| Hedge/Boost ratio | 0.87 | 1.14 | 0.86 | 0.86 | 0.73 |
| Eras detected | 2 | 5 | 16 | 9 | 11 |

### V.B Persona Interpretations

**911r:** Terse, confident Porsche specialist. Shortest median comments (17 words). Low self-reference. Near-unity hedge/boost ratio — states without equivocating. Two eras (brief Alfa Romeo, then permanent Porsche). 40% of all interactions are Porsche.

**1600veloce:** The essayist. When they go long, they write 178+ words (p90). Highest hedge/boost ratio (1.14) — genuine epistemic care, qualifies claims. Five eras oscillating BMW ↔ Porsche ↔ Chevrolet. Broad European luxury taste.

**VivaLasVegasAutos:** The storytelling dealer. Highest self-reference (30.8/1K) — constantly narrates from personal experience. p90 comment length of 384 — writes at essay scale. 16 eras across Ford, Chevy, GMC, Porsche, Bentley, Jaguar, Toyota — the generalist. 97% seller responses.

**Wob:** The excitable polymath. Highest question rate (0.08), high exclamation (0.28). Nine eras showing genuine exploration across VW, Porsche, Acura, BMW, Land Rover, Mercedes. Keeps returning to Porsche.

**DENWERKS:** The enthusiast personality. Highest exclamation rate (0.64/sentence), highest comma rate (1.79/sentence), highest self-reference (33.1/1K). Writes with run-on energy. Lowest @mention rate (24%) — broadcasts rather than replying. 11 eras across Ford, Nissan, Chevy, Dodge, Volvo.

### V.C Discriminative Power

Each user is distinguishable on multiple independent dimensions. The function word fingerprints alone show clear separation: 911r's top function word is "the" at 61.8/1K, while DENWERKS's "the" is only 42.5/1K — DENWERKS instead leads with "I" at 27.4/1K. These are not subtle differences; they are the textual equivalent of different handwriting.

---

## VI. Validation Framework

### VI.A The Fidelity Stack

Following Hullman et al. (2025) and the DPRF framework (Yao et al., 2025), we propose a layered validation approach:

| Layer | Metric | What It Measures | When to Use |
|-------|--------|-----------------|-------------|
| **Baseline** | Gode-Sunder ZI test | Does the market function with random agents? | Architecture validation |
| **Distributional** | Jensen-Shannon divergence | Do response distributions match the real user? | Population-level fidelity |
| **Decision** | Precision@K, nDCG | Would the twin bid on the same vehicles? | Preference prediction |
| **Linguistic** | BERTScore, style classifier | Does the twin talk like the person? | Voice fidelity |
| **Temporal** | ADWIN, EWMA drift detection | Is the model still fresh? | Staleness monitoring |
| **Calibration** | Prediction-Powered Inference | Can we correct for systematic LLM bias? | Statistical rigor |
| **Grounding** | Evidence trace (PersonaCite) | Is every simulated claim traceable? | Epistemological hygiene |

### VI.B The Holdout Protocol

For users with 5,000+ comments, we reserve 20% as a holdout test set. The validation procedure:

1. Present the simulation with the same vehicle context (make, model, year, price, condition signals) as a holdout comment
2. Ask: would this user comment? What type of comment? What approximate length? What sentiment?
3. Compare the simulation's response distribution against the actual held-out behavior
4. Measure Jensen-Shannon divergence between predicted and actual response distributions
5. Measure BERTScore between generated and actual comment text (semantic similarity, not exact match)

### VI.C The Homogeneity Threat

The most critical validation concern is *homogeneity bias* (arxiv 2501.19337): LLMs compress the tails of opinion distributions, producing agents that are more moderate and more alike than real populations. DENWERKS's 0.64 exclamation rate, VivaLasVegas's 384-word p90 comments, 911r's $950,000 bids — these are the *edges* that make the simulation valuable. If the LLM flattens them all to "helpful car enthusiast," the simulation is worthless.

Measuring and counteracting this compression is a primary validation objective. Entropy of generated response distributions should match entropy of observed response distributions.

---

## VII. Temporal Dynamics

### VII.A Half-Lives for Person Observations

Following the half-life framework established for vehicle observations:

| Observation Type | Half-Life | Rationale |
|-----------------|-----------|-----------|
| Identity (username) | ∞ | Permanent |
| Stylometric fingerprint | 5+ years | Unconscious, slow-changing |
| Domain expertise | 2–3 years | Decays without reinforcement |
| Taste preferences | 1–2 years | Subject to era transitions |
| Epistemic stance | 3–5 years | Relatively stable personality trait |
| Community role | 1–3 years | Can shift (buyer → seller → commentator) |
| Price sensitivity | 6 months | Market conditions change |
| Specific vehicle knowledge | 1 year | Relevant only while engaged with that vehicle |

### VII.B Drift Detection

Following the concept drift taxonomy from ACM TORS (2025):

- **Sudden drift:** A user wins a major auction and becomes a seller. Their comment type distribution shifts from observation/question to seller_response overnight.
- **Gradual drift:** A user's make preferences slowly shift from American to European over 3 years.
- **Incremental drift:** A user's comment length steadily increases as they gain expertise and confidence.
- **Recurring drift:** A user returns to a previously dominant make after an exploration period (1600veloce's BMW ↔ Porsche oscillation).

The era detection algorithm (Section IV) captures sudden and recurring drift. Gradual and incremental drift require sliding window comparison of Layer 0/1 features across time.

### VII.C When a Profile Goes Stale

A profile's *staleness* is the time elapsed since the user's last observed activity. We propose:
- 0–3 months: Fresh. Use current profile.
- 3–12 months: Aging. Apply mild decay to taste preferences.
- 1–3 years: Stale. Expertise domains may have shifted. Flag for re-evaluation.
- 3+ years: Archaeological. The profile describes who they *were*, not who they are. Useful for historical simulation but not current prediction.

---

## VIII. Ethical Considerations

### VIII.A Public Data, Private Persons

All data used in this methodology is publicly posted auction commentary — voluntarily contributed to a public forum. However, aggregating public data into a behavioral profile creates emergent privacy concerns that individual comments do not.

**Principle:** Simulation profiles should never be used to impersonate a real person in contexts where the audience would believe they are interacting with the actual individual. The simulation is a *model*, not a *mask*.

### VIII.B Right to Erasure

The EU AI Act (effective August 2026) and GDPR's right to erasure create obligations. Following the analysis in "Algorithms That Forget" (Computer Law & Security Review, 2023):

- Profiles stored as structured data (not model weights) are straightforward to delete
- The SISA (Sharded, Isolated, Sliced, Aggregated) architecture applies: each user's profile is an independent record, deletable without affecting other profiles
- If a user requests removal, their profile, all derived features, and all era records must be purged

### VIII.C The Deepfake Boundary

The EU AI Act Article 50 requires transparency when AI-generated content simulates real persons. Any output from a user simulation must be clearly labeled as AI-generated and attributed to the methodology, not the original person.

### VIII.D Consent Framework

We distinguish three tiers:
1. **Public aggregate statistics** (comment counts, make distributions): No individual consent required for public forum data.
2. **Individual behavioral profiles** (stylometric fingerprints, expertise maps): Acceptable for internal analytics; external use requires consideration of reasonable expectations.
3. **Persona simulation** (generating text "as" a user): Requires clear labeling and should not be deployed in contexts where real-person impersonation could occur.

---

## IX. Future Work

### IX.A Scaling to 19,000 Users

The Layer 0 instrument runs at zero API cost. Batch processing the 19,276 users with 100+ comments is a computational task, not a cost constraint. The resulting stylometric profile database becomes a queryable "personality space" — find users similar to a given user, identify clusters of expertise, detect anomalous accounts.

### IX.B Cross-Platform Identity

The external_identities infrastructure already supports multi-platform user resolution. A user who comments on BaT, posts on Rennlist, and sells on eBay is the same person across three observation streams. Cross-platform behavioral profiles would be substantially richer than single-platform profiles.

### IX.C Market Simulation

With 1,000+ individually-profiled agents, we can simulate auction dynamics: present a hypothetical vehicle and predict which agents would comment, bid, and at what prices. Following the Santa Fe Artificial Stock Market (Palmer et al., 1994) and ABIDES-Economist (JPMorgan, 2024), heterogeneous agents with diverse profiles produce emergent market behavior that homogeneous agents cannot.

The validation test: simulate a completed auction and compare the predicted comment distribution, bid curve, and final price against actual outcomes.

### IX.D The PersonaCite Pattern

Following PersonaCite (arxiv 2601.22288), every simulated response should trace back to actual evidence: "This user would likely comment on this vehicle because their taste fingerprint shows 38% Porsche affinity, and their epistemic stance (hedge/boost 0.87) suggests they would state their opinion directly." Provenance is not optional — it is the epistemological floor.

---

## X. References

### Psycholinguistics & Personality Detection
- Pennebaker, J.W. & King, L.A. (1999). "Linguistic Styles: Language Use as an Individual Difference." *Journal of Personality and Social Psychology*, 77(6), 1296–1312.
- Tausczik, Y.R. & Pennebaker, J.W. (2010). "The Psychological Meaning of Words: LIWC and Computerized Text Analysis Methods." *Journal of Language and Social Psychology*, 29, 24–54.
- Schwartz, H.A. et al. (2013). "Personality, Gender, and Age in the Language of Social Media: The Open-Vocabulary Approach." *PLOS ONE*, 8(9), e73791.
- Park, G. et al. (2015). "Automatic Personality Assessment Through Social Media Language." *Journal of Personality and Social Psychology*, 108(6), 934–952.
- Azucar, D. et al. (2018). "Predicting the Big 5 Personality Traits from Digital Footprints on Social Media: A Meta-Analysis." *Personality and Individual Differences*, 124, 150–159.

### Stylometry & Authorship
- Yule, G.U. (1944). *The Statistical Study of Literary Vocabulary.* Cambridge University Press.
- Mosteller, F. & Wallace, D.L. (1964). *Inference and Disputed Authorship: The Federalist.* Addison-Wesley.
- Stamatatos, E. (2009). "A Survey of Modern Authorship Attribution Methods." *JASIST*, 60(3), 538–556.
- Koppel, M. et al. (2009). "Computational Methods in Authorship Attribution." *JASIST*, 60(1), 9–26.

### Expertise & Epistemic Analysis
- Hyland, K. (1998). *Hedging in Scientific Research Articles.* John Benjamins.
- Hyland, K. (2005). *Metadiscourse: Exploring Interaction in Writing.* Continuum.

### User Modeling & Temporal Dynamics
- Koren, Y. (2009). "Collaborative Filtering with Temporal Dynamics." *KDD '09*, ACM.
- "Modelling Concept Drift in Dynamic Data Streams for Recommender Systems." *ACM TORS* (2025).

### LLM Persona & Simulation
- Yao, B. et al. (2025). "DPRF: Dynamic Persona Refinement Framework." arXiv:2510.14205.
- "PersonaCite: VoC-Grounded Interviewable Agentic Synthetic AI Personas." arXiv:2601.22288.
- "PersonalLLM: Tailoring LLMs to Individual Preferences." ICLR 2025.
- Hullman et al. (2025). "Validating LLM Simulations as Behavioral Evidence." arXiv:2602.15785.
- "Homogeneity Bias as Differential Sampling Uncertainty." arXiv:2501.19337.

### Agent-Based Market Simulation
- Palmer, R.G. et al. (1994). "Artificial Economic Life: A Simple Model of a Stock Market." *Physica D*, 75, 264–274.
- Gode, D. & Sunder, S. (1993). "Allocative Efficiency of Markets with Zero-Intelligence Traders." *Journal of Political Economy*, 101(1), 119–137.
- "ABIDES-Economist: Agent-Based Simulation of Economic Systems with Learning Agents." arXiv:2402.09563 (2024).
- Hommes, C. & LeBaron, B., eds. (2018). *Handbook of Computational Economics Vol. 4: Heterogeneous Agent Modeling.* Elsevier.

### Digital Twins & Ethics
- Feng et al. (2024). "Building a Human Digital Twin (HDTwin) Using LLMs for Cognitive Diagnosis." *JMIR Formative Research*.
- "Digital Twins: Potentials, Ethical Issues, and Limitations." arXiv:2208.04289 (2022).
- "Algorithms That Forget: Machine Unlearning and the Right to Erasure." *Computer Law & Security Review* (2023).
- EU AI Act, Article 50: Transparency Obligations (2024).

### Internal References
- "Applied Ontology in the Collector Vehicle Domain." Nuke Platform Research (2026).
- "Novel Ontological Contributions of the Nuke Knowledge Graph." Nuke Platform Research (2026).
- "Assets Accumulate Data." Nuke Contemplations (2026).
- "Testimony and Half-Lives." Nuke Contemplations (2026).
