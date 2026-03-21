# Dead Features Autopsy

## An Analysis of Abandoned Ideas in Platform Construction

---

## Abstract

During the March 2026 platform triage of the Nuke provenance engine, nine features were identified as dead and deleted. This study examines the life cycle of each dead feature — its birth, peak, and death — through the lens of 558 prompts and 90 commits that were invested in features that produced no lasting value. We identify four diagnostic warning signs that predict feature death: prompt volume without commits, rising frustration rates, repeated re-explanation, and commit activity cessation preceding prompt cessation. We calculate the opportunity cost of dead features (equivalent to 16 YONO-scale features) and propose a framework for identifying zombie features before they consume resources. This analysis is intended as a reference for future vertical expansion, where the same patterns of speculative feature proliferation could recur.

---

## I. Introduction

### The Triage Context

On March 7-8, 2026, the Nuke platform underwent a comprehensive triage. The platform had accumulated:

- 464 live edge functions (target: 50)
- 171 GB database (156 GB post-triage)
- 131 active cron jobs (112 post-triage)
- Estimated $5,600/month infrastructure burn

The triage deleted 259 archived edge functions, killed 9 features, reduced cron jobs by 19, and achieved an estimated $1,500-3,000/month burn reduction.

### Scope of This Study

This study focuses on the 9 dead features: their origins, their arcs, their warning signs, and their costs. It is a post-mortem on ideas that were explored but should not have been, or that were explored beyond their useful life.

### Methodology

Each dead feature was analyzed through:
1. **Prompt archaeology**: Identifying the first mention, peak mention month, and last mention
2. **Commit correlation**: Matching commits to features through keyword and temporal correlation
3. **Frustration measurement**: Computing frustration rates within feature-related prompts
4. **Prompt-to-commit ratio**: Measuring the conversion of discussion into code
5. **Post-triage recurrence**: Tracking mentions after the deletion date

---

## II. The Nine Dead Features

### Summary Table

| Feature | Born | Died | Prompts | Commits | P:C Ratio | Frustration | Lifespan |
|---------|------|------|---------|---------|-----------|-------------|----------|
| Betting / Prediction Markets | Oct 25 | Mar 09 | 61 | 23 | 2.7:1 | 8% | 125d |
| Trading / Exchange | Oct 21 | Mar 09 | 112 | 20 | 5.6:1 | 17% | 136d |
| Vault / Concierge / Villa | Jan 26 | Mar 08 | 56 | 3 | 18.7:1 | 5% | 33d |
| Shipping Logistics | Oct 27 | Mar 08 | 28 | 27 | 1.0:1 | 11% | 130d |
| Investor Portal | Oct 21 | Mar 10 | 151 | 23 | 6.6:1 | 8% | 135d |
| Twitter/Social Integration | Nov 02 | Feb 26 | 26 | 0 | Inf | 12% | 115d |
| Mobile-First Approach | Nov 05 | Mar 06 | 8 | 0 | Inf | 25% | 120d |
| Browser Extension | Oct 25 | Mar 05 | 24 | 0 | Inf | 4% | 131d |
| Telegram Bot | Jan 31 | Feb 27 | 92 | 5 | 18.4:1 | 3% | 27d |

### Total Investment

- **Total prompts on dead features**: 558 (4.1% of corpus)
- **Total commits referencing dead features**: 90
- **Average dead feature lifespan**: 106 days
- **Features killed by triage deletion**: 5 of 9
- **Features that were never built (0 commits)**: 3 of 9

---

## III. Individual Autopsies

### 1. Betting / Prediction Markets

**Birth**: October 25, 2025 — "A note, Kalshi is 'a marketplace for event contracts' — what are we?"

**Arc**: Slow start (3 prompts in October), steady discussion through January (18 prompts), spike in February (31 prompts) focused on predicting auction outcomes using SQL analysis of historical data, then killed in triage.

**What it was**: A system for users to wager on auction outcomes — whether a vehicle would sell, exceed its estimate, reach a specific price. Inspired by Kalshi's event contract model.

**Why it died**: The feature required financial infrastructure (escrow, settlement, compliance) that was orthogonal to the core data platform. The 23 commits were primarily database schema work and edge functions that never reached a usable state. The core insight — using historical data to predict auction outcomes — survived as the valuation engine. The wagering layer did not.

**Warning signs**: The concept required financial regulatory compliance that was never seriously investigated. The 2.7:1 prompt-to-commit ratio was the healthiest of any dead feature, suggesting genuine attempt at implementation — but the implementation was in the wrong domain (financial services rather than data intelligence).

### 2. Trading / Exchange

**Birth**: October 21, 2025 — "I want stock trading — that's insane but it's just another section."

**Arc**: The longest-lived dead feature at 136 days. High frustration rate (17%) — the highest of any dead feature. Only 20 commits for 112 prompts, indicating that most energy was conceptual rather than productive.

**What it was**: A marketplace for trading fractional interests in vehicles or vehicle baskets (ETFs of vehicles by category — trucks, Porsches, pre-war cars). Users would buy and sell positions, with prices driven by the underlying vehicle values.

**Why it died**: The concept conflated two different things: (1) a data system that tracks vehicle values, and (2) a financial exchange that trades instruments based on those values. The first is the core platform. The second requires financial licensing, regulatory compliance, clearing infrastructure, and market-making capability — none of which the team had or was building toward.

**Warning signs**: The 17% frustration rate was the highest of any dead feature, suggesting the concept caused persistent friction. The talk-to-code ratio of 5.6:1 was poor. Post-triage, the concept recurred 9 times (HIGH zombie risk), often under the guise of "Market Exchange page overhaul."

### 3. Vault / Concierge / Villa

**Birth**: January 26, 2026 — Discussion of luxury-branded alternatives for the platform name.

**Arc**: The shortest-lived dead feature at 33 days. Conceptual only — 56 prompts produced only 3 commits. Born as a naming/branding exercise that briefly evolved into a feature concept (secure digital storage for high-value vehicle documents), then died without implementation.

**What it was**: Variously described as a secure document vault, a luxury concierge service for collectors, and a branded experience layer. The concept never stabilized into a single clear definition.

**Warning signs**: The 18.7:1 prompt-to-commit ratio was among the worst. The feature had three different names (Vault, Concierge, Villa) in its 33-day life, indicating conceptual instability. The low frustration rate (5%) suggests it was enjoyable to discuss but not practically grounded.

### 4. Shipping Logistics

**Birth**: October 27, 2025 — "Need to automate shipping @api-docs.centraldispatch.com"

**Arc**: A practical feature that almost survived triage. The 1.0:1 prompt-to-commit ratio was the healthiest of any dead feature — nearly every discussion produced code. The 27 commits included actual API integration work with Central Dispatch.

**What it was**: A logistics layer for arranging vehicle transport — quoting, booking, and tracking shipments through transport carriers. This is a real need for vehicle dealers and collectors.

**Why it died**: The feature was real and practical, but it was a distraction from the core mission. Vehicle shipping is a solved problem (multiple existing services handle it). Building a shipping layer consumed engineering resources that should have been directed at the unsolved problems: extraction, intelligence, and valuation.

**Warning signs**: Unlike other dead features, this one had good prompt-to-commit conversion. Its warning sign was strategic, not tactical: it was solving someone else's problem rather than the platform's unique problem.

### 5. Investor Portal

**Birth**: October 21, 2025 — "I wanna stake money on vehicles... the value of the money I stake to increase/decrease."

**Arc**: The most resource-intensive dead feature: 151 prompts (27.1% of all dead-feature prompts), 23 commits, 135-day lifespan. The concept evolved from staking/investment to a fundraising dashboard to a general data quality reporting tool.

**What it was**: A dashboard for potential investors showing platform metrics, vehicle data quality scores, extraction coverage, and financial projections. The intent was to use the platform's data capabilities to attract investment capital.

**Why it died**: The portal was a fundraising tool, not a product feature. It consumed engineering resources to build something that would be shown to potential investors rather than to users. The 6.6:1 prompt-to-commit ratio was poor, and the concept mutated repeatedly (from staking to dashboards to data quality reports), suggesting it never found a stable form.

**Warning signs**: The post-triage recurrence of 16 mentions (highest of any dead feature) marks this as a HIGH zombie risk. The urge to build investor-facing tools resurfaces under stress — it is a distraction signal that correlates with anxiety about the project's viability rather than with strategic clarity about the product.

### 6. Twitter/Social Integration

**Birth**: November 2, 2025 — Discussion of social media presence and content distribution.

**Arc**: 26 prompts across 3 months with zero commits. The purest example of a feature that existed entirely in conversation and never materialized as code.

**What it was**: Integration with Twitter/X for posting vehicle data, responding to automotive content, and building audience through social media engagement.

**Why it died**: The concept was never technically scoped. It remained at the level of aspiration ("we should be on Twitter responding to car posts") without ever progressing to specification or implementation.

**Warning signs**: The 26:0 prompt-to-commit ratio (infinity) is the clearest warning sign. A feature discussed 26 times without a single line of code is a feature that will never be built in its current form. The 12% frustration rate suggests the concept caused friction when discussed.

### 7. Mobile-First Approach

**Birth**: November 5, 2025 — Discussion of mobile-optimized interfaces for on-location vehicle inspection.

**Arc**: Only 8 prompts across 4 months, but with the highest frustration rate of any dead feature (25%). Zero commits.

**What it was**: A mobile-optimized interface for field use — inspecting vehicles at shows, auctions, and in the field using a phone.

**Why it died**: The 25% frustration rate tells the story. Every time the concept was discussed, it produced frustration — likely because the gap between the aspiration (a polished mobile experience) and the reality (a desktop-first platform with complex data displays) was too large to bridge incrementally.

**Warning signs**: Extremely high frustration rate. Zero commits despite repeated discussion. The concept required a fundamental architectural choice (mobile-first vs. desktop-first) that was never explicitly made.

### 8. Browser Extension

**Birth**: October 25, 2025 — Discussion of a chrome extension for capturing vehicle data while browsing listings.

**Arc**: 24 prompts across 5 months, zero commits. The longest-lived feature that never produced a single line of code.

**What it was**: A browser extension that would detect vehicle listings on any website and offer to import the data into Nuke.

**Why it died**: The concept was technically feasible but strategically unnecessary. The extraction pipeline (archiveFetch + platform-specific extractors) already captures data from websites without requiring user action. The browser extension would have been a manual trigger for an automated process.

**Warning signs**: 24 prompts, 0 commits, across 5 months. The repeated discussion without any implementation attempt indicates a concept that is attractive to discuss but has no clear implementation path.

### 9. Telegram Bot

**Birth**: January 31, 2026 — "Test telegram"

**Arc**: A brief, intense life: 92 prompts in 27 days, with 81 of those prompts in February alone. 5 commits, mostly configuration and API integration. The fastest rise and fall of any feature in the corpus.

**What it was**: A Telegram bot that would accept vehicle URLs or photos and return extracted data, valuations, and condition assessments.

**Why it died**: The Telegram bot was a delivery mechanism — a way to access the platform's capabilities through a messaging interface. It was killed in triage not because the concept was wrong but because the underlying capabilities (extraction, valuation, condition assessment) were not yet reliable enough to expose through a real-time chat interface. The bot would have been making promises the platform could not keep.

**Warning signs**: The 18.4:1 prompt-to-commit ratio was very poor. The feature was killed cleanly in triage without prior decline signals — it was a victim of strategic prioritization rather than organic death.

---

## IV. Diagnostic Framework: Four Warning Signs

Analysis of the nine dead features reveals four patterns that predict feature death:

### Warning Sign 1: Prompts Without Commits (P:C Ratio > 10:1)

Features with high prompt-to-commit ratios are features being discussed but not built. The threshold of 10:1 flagged 4 of 9 dead features in advance of their death:

| Feature | P:C Ratio | Outcome |
|---------|-----------|---------|
| Twitter/Social | Inf (26:0) | Dead — never built |
| Browser Extension | Inf (24:0) | Dead — never built |
| Mobile-First | Inf (8:0) | Dead — never built |
| Vault/Concierge | 18.7:1 | Dead — barely built |
| Telegram Bot | 18.4:1 | Dead — briefly operational |

**Diagnostic rule**: Any feature with a P:C ratio exceeding 10:1 after 30 days of discussion should be flagged for review. If the ratio does not improve within 14 days of flagging, the feature should be killed or consciously deferred.

### Warning Sign 2: Rising Frustration (> 15%)

Features with above-average frustration rates are features that cause pain when worked on. This usually indicates a conceptual mismatch — the feature does not fit the platform's architecture or the team's capabilities:

| Feature | Frustration | Outcome |
|---------|-------------|---------|
| Mobile-First | 25% | Dead — never built |
| Trading/Exchange | 17% | Dead — barely built |
| Twitter/Social | 12% | Dead — never built |
| Shipping | 11% | Dead — built but strategic misfit |

**Diagnostic rule**: Any feature with a frustration rate exceeding 15% should be examined for architectural mismatch. The frustration is likely caused by the feature's requirements conflicting with the platform's existing structure.

### Warning Sign 3: Re-Explanation

Features that must be repeatedly explained from scratch — where the concept does not persist between sessions — are features that have not been internalized by the development process:

| Feature | Months Discussed | Commits | Re-explanation Pattern |
|---------|-----------------|---------|----------------------|
| Twitter/Social | 3 months | 0 | Reintroduced from scratch 3 times |
| Browser Extension | 5 months | 0 | Reintroduced from scratch 4 times |
| Mobile-First | 4 months | 0 | Reintroduced from scratch 3 times |

**Diagnostic rule**: Any feature that is reintroduced from scratch (rather than continued from a previous session) more than twice should be flagged. If the concept cannot persist in the development process's working memory, it likely cannot persist in the codebase.

### Warning Sign 4: Commit Cessation Before Prompt Cessation

When commits stop but prompts continue, the feature has become conceptually interesting but practically stalled:

| Feature | Last Commit | Prompts After | Days of Talk-Only |
|---------|------------|---------------|-------------------|
| Vault/Concierge | Feb 18 | 3 more | 18 days |
| Investor Portal | Feb 26 | 29 more | 12 days |
| Telegram Bot | Feb 15 | 11 more | 12 days |

**Diagnostic rule**: Any feature where commits have ceased for 14+ days while prompts continue should be flagged. The feature has transitioned from active development to passive discussion — a zombie state that consumes attention without producing output.

---

## V. The Cost of Dead Features

### Direct Cost: 558 Prompts

558 prompts (4.1% of the 13,758 total) were invested in features that produced no lasting value. At an average of 6.7 prompts per commit, this represents approximately 83 commits worth of productive capacity redirected to dead ends.

### Opportunity Cost: 16 YONO-Scale Features

The YONO vision model — the platform's most accelerating concept (760x) — was built with approximately 33 prompts of focused effort. The condition spectrometer was built with approximately 19 prompts. Using these as benchmarks, the 558 prompts consumed by dead features represent the equivalent of:

- 16.9 YONO-scale features (558 / 33)
- 29.4 condition-spectrometer-scale features (558 / 19)

The dead features did not just waste prompts. They consumed the cognitive bandwidth that could have deepened the core platform's most valuable capabilities.

### Cognitive Cost: Decision Fatigue

Beyond the measurable prompt cost, dead features impose a cognitive tax on every session. The founder must remember which features are alive, which are dead, which are zombie, and which are merely sleeping. Each dead feature that recurs in thought or conversation consumes attention that could be directed at the living features.

The post-triage recurrence data quantifies this tax:

| Feature | Post-Triage Mentions | Cognitive Tax Level |
|---------|---------------------|-------------------|
| Investor Portal | 16 | HIGH — active distraction |
| Trading/Exchange | 9 | HIGH — active distraction |
| Betting | 5 | MEDIUM — occasional nostalgia |
| Vault/Concierge | 2 | LOW — reference only |
| Shipping | 1 | LOW — reference only |
| Twitter, Mobile, Browser, Telegram | 0 | NONE — cleanly killed |

---

## VI. Patterns of Death

### The Enthusiasm Curve

All 9 dead features share a common enthusiasm curve: low initial mention, gradual increase, peak in February 2026 (the month of maximum overall intensity), then decline or deletion. February's intensity amplified everything — dead features alongside living ones. The triage followed the intensity, not coincidentally: the February burn revealed the cost of maintaining all features at once.

### Arborescent vs. Rhizomatic Features

Dead features share a structural characteristic: they are arborescent (tree-like) rather than rhizomatic (network-like). They connect to the main platform at a single point — a database table, a UI page, an edge function — rather than weaving through the entire system.

Living features (extraction, observation, valuation, design system) are rhizomatic: they connect to multiple machines and are deeply intertwined with other features. Cutting them would require cutting dozens of connections. Dead features (betting, trading, vault) could be deleted by removing a few tables and functions with no ripple effects. Their surgical removability was itself a sign of their peripheral status.

**Diagnostic principle**: Features that can be cleanly deleted are features that were never deeply integrated. Deep integration is both a sign of importance and a defense against premature deletion.

### The Concept-Code Gap

Three features (Twitter, Mobile, Browser Extension) produced zero commits across their entire lifespans. They existed purely as concepts — discussed, imagined, occasionally specified, but never translated into running code.

The concept-code gap is the most reliable predictor of feature death. A concept that generates discussion but not code is a concept that has not found its implementation path. This may be because the concept is technically infeasible, because it requires capabilities the team does not have, or because it is strategically attractive but practically unnecessary.

---

## VII. Lessons for Vertical Expansion

Nuke is expanding from vehicles to art. The dead feature analysis provides specific warnings for this expansion:

### Lesson 1: Resist Platform Envy

Betting and trading were inspired by Kalshi and Robinhood — platforms in fundamentally different domains (financial services) with fundamentally different regulatory requirements. The inspiration was valid (what if we applied financial instrument thinking to physical assets?) but the implementation was a trap (building a financial exchange when you are building a data platform).

**For art**: Resist the urge to build art marketplace features inspired by Artsy, 1stDibs, or Saatchi Art. Nuke is a provenance engine, not a marketplace. The data should power marketplaces; the platform should not become one.

### Lesson 2: Kill Features That Cannot Find Code

Three dead features produced zero commits across months of discussion. The concept-code gap should trigger a 30-day kill rule: if a feature has been discussed for 30 days without producing a commit, it should be explicitly killed or deferred.

**For art**: When concepts like "artist onboarding" or "gallery submission workflow" are discussed, they should be held to the same standard — if 30 days pass without code, the concept needs to be re-examined or killed.

### Lesson 3: Watch the P:C Ratio

The prompt-to-commit ratio is the most actionable diagnostic metric. Features with healthy P:C ratios (Shipping at 1.0:1, Betting at 2.7:1) were at least partially built. Features with pathological P:C ratios (Vault at 18.7:1, Telegram at 18.4:1) were discussed far more than they were implemented.

**For art**: Monitor the P:C ratio for every new feature from day one. If the ratio exceeds 10:1, the feature is in danger.

### Lesson 4: Dead Features Recur

The investor portal was mentioned 16 times after being explicitly killed. The trading/exchange concept recurred 9 times. Dead features do not die cleanly — they return as zombies, wearing new names and slightly different descriptions but carrying the same fundamental misfit with the platform's architecture.

**For art**: Expect zombie features. When they appear, reference this autopsy. The feature was killed for a reason. The reason has not changed.

---

## VIII. Conclusions

The nine dead features consumed 558 prompts, 90 commits, and an average of 106 days each. Their total cost — measured in cognitive bandwidth, engineering hours, and opportunity cost — is equivalent to approximately 16 YONO-scale features. This is the tax on conceptual exploration: the cost of discovering what not to build.

The tax is not entirely waste. The betting concept seeded the valuation engine. The trading concept clarified the difference between data intelligence and financial services. The mobile-first discussion informed responsive design decisions. Each dead feature contributed something to the platform's understanding of itself — but the contributions were not worth their cost in most cases.

The four warning signs (P:C ratio > 10:1, frustration > 15%, re-explanation, commit cessation) are diagnostic tools that can reduce the cost of future dead features by identifying them earlier in their life cycle. The 30-day kill rule for features without commits is the strongest single intervention.

The deepest lesson is structural: features that are rhizomatic (deeply integrated, multiply connected) survive triage. Features that are arborescent (singly connected, cleanly removable) die in it. When evaluating a proposed feature, ask not "is this a good idea?" but "how many machines does this activate?" Features that activate only one machine are candidates for death. Features that activate five or more machines are probably essential.

---

*This study is based on analysis of 558 dead-feature prompts within a corpus of 13,758 total prompts, 90 dead-feature commits within a corpus of 2,045 total commits, spanning October 21, 2025 to March 10, 2026. Post-triage recurrence data extends to March 20, 2026. Source data: DEAD_FEATURES.md, COMPLETE_AUDIT.md, all-categorized-v3.json.*
