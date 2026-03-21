# THEORETICALS

> Unsolved problems with proposed approaches. Mathematical models. Algorithmic designs. Things we know we need but haven't built yet.

These are not feature specs. They are intellectual frameworks -- the theory that precedes and governs the engineering. Each paper defines a problem space formally, proposes mathematical models, explores edge cases, and identifies the open questions that remain even after the model is defined.

The relationship between a theoretical and the code that implements it is the same relationship between a physics paper and the bridge built from its equations. The paper defines what must be true. The code makes it so.

---

## Table of Contents

### 1. [Signal Calculation](signal-calculation.md)

The theory of computing actor signal from weighted observations. How to quantify the activity, trajectory, and profile of any actor in the graph -- artist, collector, gallery, dealer, builder, driver. The formula: signal = SUM(observation_weight x source_trust x recency_decay x anomaly_factor). Each term defined mathematically. Recency decay functions. Anomaly detection. Profile matching. Trajectory computation.

**Status**: Theoretical. No implementation exists.
**Dependencies**: Observation system (partially deployed), source trust hierarchy (defined in encyclopedia), recency decay model (defined in observation-half-life-model.md)
**Pages**: ~25

### 2. [Valuation Methodology](valuation-methodology.md)

The Nuke Estimate theory. How to compute asset value from comparable sales, condition assessment, provenance strength, market trajectory, rarity, and institutional validation. The comp engine. Confidence scoring. The relationship between provenance completeness and value confidence.

**Status**: Theoretical. Comps and price history tables exist in the database. No standalone valuation algorithm ships.
**Dependencies**: Signal calculation (for market trajectory), observation half-life (for recency weighting of comps), entity resolution (for comp matching)
**Pages**: ~30

### 3. [Observation Half-Life Model](observation-half-life-model.md)

The theory that data is testimony with half-lives. Every observation decays at a rate determined by its category, source, and the nature of what it claims. A VIN is forever. A condition report has a half-life of 2-3 years. A seller's mileage claim begins decaying the moment it is spoken.

**Status**: Theoretical. The observation system exists but treats all observations as equally current.
**Dependencies**: Observation system (partially deployed), source trust hierarchy (defined)
**Pages**: ~20

### 4. [Entity Resolution Theory](entity-resolution-theory.md)

The theory of matching observations to entities without universal identifiers. For vehicles, VIN provides a golden key. For art, there is no universal identifier. The resolution algorithm: input hints, scoring matrix, confidence threshold, match/candidate/new. Image perceptual hashing. Metadata intersection scoring. The asymmetric cost of false positives versus false negatives.

**Status**: Partially implemented. VIN matching works. URL matching works. Fuzzy matching at 60% threshold causes data corruption. The theory defines why 0.80 is the correct auto-match threshold.
**Dependencies**: Observation system, image pipeline (for perceptual hashing)
**Pages**: ~25

### 5. [Organic Connection Theory](organic-connection-theory.md)

The theory of how to connect actors in the graph without becoming a recommendation algorithm. What "organic" means technically. The difference between signal-based discovery and feed-based recommendation. How the graph enables natural discovery without optimizing for engagement. The dinner table problem.

**Status**: Theoretical. No connection or discovery system exists.
**Dependencies**: Signal calculation, the full knowledge graph
**Pages**: ~20

---

## Reading Order

For a reader encountering these for the first time:

1. **Observation Half-Life Model** -- establishes the foundational concept that data decays, which every other model depends on
2. **Entity Resolution Theory** -- defines how observations attach to entities, the prerequisite for computing anything about those entities
3. **Signal Calculation** -- builds on observations and entity resolution to compute the aggregate signal of an actor
4. **Valuation Methodology** -- uses signal, observations, and entity resolution to compute asset value
5. **Organic Connection Theory** -- uses signal profiles to enable discovery without algorithmic recommendation

Each paper is self-contained but references the others. The dependency graph flows upward through this reading order.

---

## Conventions

**Mathematical notation**: Standard mathematical notation using plaintext where possible. Summation as SUM(), product as PROD(), functions as f(x). LaTeX-style notation in comments where precision demands it.

**Examples**: Every theoretical includes concrete worked examples from both the automotive and art domains. The models are domain-agnostic; the examples prove it.

**Open questions**: Each paper ends with a section of questions the theory raises but does not answer. These are the research frontier.

**Relationship to code**: These papers do not contain code. They contain the mathematical and algorithmic definitions that code would implement. Where an interface or data structure is referenced, it uses the schema defined in the encyclopedia, not a programming language.

---

*Theoreticals target: 200+ pages. Current: ~120 pages across 5 papers.*
*Updated: 2026-03-20*
