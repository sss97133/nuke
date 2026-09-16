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

---

## Scholarly Foundations

The claims advanced across these theoreticals are not invented in isolation; each rests on a body of peer-reviewed and canonical work, all web-verified against primary sources below.

- **Label as projection of measurement / deferred binding of meaning** → The section treats every datum as testimony -- a (claim, source, time, trust) tuple -- and the README separates "what must be true" from the code that projects it. Stevens grounds why a label (nominal scale) is just one permissible projection of an underlying measurement: scale type dictates which transformations and statistics are legitimate, so collapsing evidence into a fixed category prematurely is a category error. [stevens1946scales]

- **Don't bake human-engineered categorization into the schema; prefer learned, general representations** → The whole posture -- evidence-first, project labels at render, never hard-code taxonomy -- is the engineering analogue of the Bitter Lesson (general, scalable methods beat hand-crafted human knowledge over time) and of Representation Learning (success hinges on the representation; good representations disentangle latent factors rather than committing to brittle hand-built features and labels). [sutton2019bitterlesson] [bengio2013representation]

- **Observation half-life: testimony with exponential temporal decay** → `observation-half-life-model.md` models current relevance as Relevance = exp(-lambda*(t - t_obs)) with lambda = ln2/half_life, choosing exponential over linear or step decay and feeding this recency weight into signal, valuation, and entity resolution. This mirrors the recency/time-decay weighting standard in information retrieval and the exponential-decay processes that measurement-era and physical sciences formalize. [stevens1946scales]

- **Auction price formation: hammer price set by the second-highest valuation** → `auction-price-formation-theory.md` cites Vickrey's 1961 insight that P_final ~ V2 (the second-highest bidder's exit), arguing that 4-5 informed bidders suffice because the expected k-th highest order statistic converges rapidly and audience size is noise. Vickrey is the canonical source for the second-price / English-auction equivalence and the V2-sets-price result. [vickrey1961auctions]

- **Dynamic trust under asymmetric information** → `dynamic-trust-model.md` ("the verification record IS the trust score") and valuation's provenance-confidence coupling address the lemons problem directly: buyers cannot observe the quality of a unique used vehicle or artwork, so sellers' claims decay and must be corroborated. Akerlof is the foundational treatment of quality uncertainty and signalling in used-asset markets. [akerlof1970lemons]

- **Reputation as a computed, self-reinforcing (eigenvector) trust score** → `dynamic-trust-model.md` proposes that every observer -- source, org, individual, even the trust algorithm itself -- earns a rolling trust score from corroboration versus contradiction, applied retroactively, with "meta-trust" as self-referential calibration. EigenTrust is the canonical algorithm for computing global, transitively-aggregated trust from a network of pairwise verification history. [kamvar2003eigentrust]

- **Valuation as hedonic decomposition of a differentiated good** → `valuation-methodology.md` computes the Nuke Estimate as a base comparable value adjusted by condition, provenance, trajectory, rarity, and institutional-validation multipliers -- treating each collector asset as a bundle of priced characteristics. Rosen is the canonical theory that the price of a differentiated good decomposes into the implicit prices of its characteristics. [rosen1974hedonic]

- **Repeat-sales as the strongest comp; recency- and gap-time-weighted comps** → `valuation-methodology.md` gives an asset's own prior sales a 3x weight ("the asset's own history is the strongest comp") and weights comps by recency. Case & Shiller is the canonical repeat-sales index methodology, including the result that price-difference variance grows with the time between sales -- directly supporting recency-decayed comp weighting. [caseshiller1989repeatsales]

- **Entity resolution under cost asymmetry** → `entity-resolution-theory.md` derives the auto-match threshold from a decision-theoretic cost analysis (C_FP/C_FN ~ 20-50:1, optimum ~0.97 relaxed to a practical 0.80) using pHash + Hamming distance for visual matching. The asymmetric-cost framing is classic Bayesian decision theory; the threshold and pHash claims are internally derived engineering, while the asymmetric-information lineage on the trust dimension is covered by Akerlof. [akerlof1970lemons]

### Bibliography

1. **[stevens1946scales]** S. S. Stevens (1946). *On the Theory of Scales of Measurement*. Science, vol. 103, no. 2684, pp. 677-680. https://www.science.org/doi/10.1126/science.103.2684.677
2. **[sutton2019bitterlesson]** Richard S. Sutton (2019). *The Bitter Lesson*. incompleteideas.net (essay, March 13, 2019). http://www.incompleteideas.net/IncIdeas/BitterLesson.html
3. **[bengio2013representation]** Yoshua Bengio, Aaron Courville, Pascal Vincent (2013). *Representation Learning: A Review and New Perspectives*. IEEE Transactions on Pattern Analysis and Machine Intelligence, vol. 35, no. 8, pp. 1798-1828. https://arxiv.org/abs/1206.5538
4. **[vickrey1961auctions]** William Vickrey (1961). *Counterspeculation, Auctions, and Competitive Sealed Tenders*. The Journal of Finance, vol. 16, no. 1, pp. 8-37. https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1540-6261.1961.tb02789.x
5. **[akerlof1970lemons]** George A. Akerlof (1970). *The Market for "Lemons": Quality Uncertainty and the Market Mechanism*. The Quarterly Journal of Economics, vol. 84, no. 3, pp. 488-500. https://academic.oup.com/qje/article-abstract/84/3/488/1896241
6. **[kamvar2003eigentrust]** Sepandar D. Kamvar, Mario T. Schlosser, Hector Garcia-Molina (2003). *The EigenTrust Algorithm for Reputation Management in P2P Networks*. Proceedings of the 12th International Conference on World Wide Web (WWW '03), pp. 640-651. https://dl.acm.org/doi/10.1145/775152.775242
7. **[rosen1974hedonic]** Sherwin Rosen (1974). *Hedonic Prices and Implicit Markets: Product Differentiation in Pure Competition*. Journal of Political Economy, vol. 82, no. 1, pp. 34-55. https://www.journals.uchicago.edu/doi/10.1086/260169
8. **[caseshiller1989repeatsales]** Karl E. Case, Robert J. Shiller (1989). *The Efficiency of the Market for Single-Family Homes*. The American Economic Review, vol. 79, no. 1, pp. 125-137. https://www.jstor.org/stable/1804778

*Verification note: all 8 citations confirmed real against primary sources (Science/PubMed/ADS, IEEE/arXiv, Wiley/RePEc, OUP/JSTOR, ACM DL/DBLP, JPE/RePEc, AER/RePEc, and Sutton's canonical self-published essay). No citations were excluded -- every entry in the supplied verdict set carried is_real=true, so there are no is_real=false works to flag for future agents.*
