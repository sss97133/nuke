# 13,758 Prompts: An Empirical Analysis of AI-Assisted Platform Construction

---

## Abstract

This study presents a comprehensive analysis of 13,758 prompts issued during the construction of a provenance engine for physical-world assets over 141 calendar days (October 21, 2025 to March 10, 2026). The prompts, issued by a single founder working with AI coding assistants (Claude Code and Cursor), produced 2,045 commits across 541 sessions totaling approximately 965 hours of active work. We analyze the corpus across multiple dimensions: temporal distribution, session archetypes, frustration patterns, machine activation (using a Deleuzian framework of 11 functional machines), metaphor evolution, desire clustering, and vocabulary sophistication. Key findings include: (1) 92% of sessions exhibit cross-domain switching that appears as "thrashing" but is structurally consistent with rhizomatic architecture; (2) frustration correlates with domain rather than fatigue, suggesting systemic rather than ergonomic causes; (3) only 5 of 13,758 prompts activate all 11 functional machines simultaneously, and these 5 constitute the effective product specification; (4) the vocabulary evolved from informal commands to structured specifications, with structured prompts rising from 0.9% to 39% over the study period.

---

## I. Introduction

### Context

The subject system — Nuke — is a provenance engine that builds knowledge graphs from traces left by physical assets (vehicles, artworks, magazine issues) as they move through networks of people and organizations. It was built primarily through human-AI pair programming: a founder issuing prompts to AI coding assistants, which generate code, diagnose bugs, perform research, and execute deployments.

### Research Questions

1. What patterns characterize the construction process of a complex software platform through human-AI collaboration?
2. How does the founder's communication style, vocabulary, and strategic focus evolve over time?
3. What is the relationship between prompt characteristics and productive output (commits)?
4. What structural patterns emerge from cross-domain prompt analysis?

### Data Sources

| Source | Volume | Coverage |
|--------|--------|----------|
| Prompt corpus | 13,758 prompts | Full prompt text with timestamps and source tool |
| Git log | 2,045 commits | Commit messages with timestamps |
| Session index | 541 sessions | Inferred from 45-minute activity gaps |
| Tool metadata | 4 tools | Claude Code, Cursor, Cursor CLI, Perplexity |

---

## II. Methodology

### Session Segmentation

Sessions were defined by a 45-minute gap threshold: any pause in prompt activity exceeding 45 minutes was treated as a session boundary. This threshold was selected based on analysis of the inter-prompt interval distribution, which showed a bimodal pattern with peaks at 2-5 minutes (within-session) and 2-8 hours (between-session), with a clear valley at approximately 45 minutes.

### Category Assignment

Each prompt was assigned to one or more categories from a taxonomy developed iteratively during analysis. The taxonomy comprises 42 categories organized into 10 super-categories: data, infra, ui, meta, ops, personal, social, vision, yono, and vehicles. A prompt may belong to multiple categories.

### Machine Mapping

Following Deleuze and Guattari's concept of machines as functional assemblages, each prompt was mapped to one or more of 11 machines based on keyword and context analysis: the_skin (UI), the_skeleton (infrastructure), the_mouth (ingestion), the_brain (intelligence), the_wallet (valuation), the_eye (vision), the_gut (processing), the_nose (discovery), the_hands (curation), the_memory (provenance), the_voice (output/API).

### Frustration Detection

Frustration was detected through a combination of: profanity, negative sentiment expressions ("shit," "broken," "not working"), repeated prompts addressing the same issue, and explicit statements of frustration. The frustration classifier was validated against a manually-labeled sample of 200 prompts with 87% agreement.

### Focus Scoring

Focus scores were computed as the Herfindahl-Hirschman Index of category distribution within each session. A session where 100% of prompts fall in one category has a focus score of 1.0. A session evenly distributed across 10 categories has a focus score of 0.1. Sessions with focus scores below 0.4 were classified as "thrashing."

---

## III. Corpus Overview

### Temporal Distribution

| Month | Prompts | % of Total | Commits | Prompt:Commit Ratio |
|-------|---------|-----------|---------|-------------------|
| Oct 2025 | 352 | 2.6% | 355 | 1.0:1 |
| Nov 2025 | 2,044 | 14.9% | 191 | 10.7:1 |
| Dec 2025 | 2,866 | 20.8% | 522 | 5.5:1 |
| Jan 2026 | 1,692 | 12.3% | 216 | 7.8:1 |
| Feb 2026 | 5,228 | 38.0% | 639 | 8.2:1 |
| Mar 2026 | 1,392 | 10.1% | 122 | 11.4:1 |

February 2026 alone accounts for 38% of all prompts and 31.2% of all commits — the peak intensity month. The prompt-to-commit ratio increased steadily from 1.0:1 (October) to 11.4:1 (March), reflecting a shift from code-producing prompts to research and analysis prompts.

### Tool Distribution

| Tool | Prompts | % |
|------|---------|---|
| Claude Code | 7,151 | 52.0% |
| Cursor | 6,514 | 47.3% |
| Cursor CLI | 77 | 0.6% |
| Perplexity | 16 | 0.1% |

The tool transition from Cursor to Claude Code occurred in January 2026 and is visible as a step change in prompt characteristics (see Section VII).

### Category Distribution (Top 20)

| Category | Prompts | % |
|----------|---------|---|
| data/extraction | 2,318 | 16.8% |
| ops/debug | 2,228 | 16.2% |
| infra/database | 2,169 | 15.8% |
| meta/learning | 2,109 | 15.3% |
| ui/general | 1,730 | 12.6% |
| ui/vehicle-profile | 1,694 | 12.3% |
| infra/edge-fn | 1,292 | 9.4% |
| ui/search | 1,285 | 9.3% |
| yono/images | 1,189 | 8.6% |
| meta/codebase | 1,181 | 8.6% |
| meta/next | 1,149 | 8.4% |
| pasted/code | 1,099 | 8.0% |
| data/ingestion | 1,057 | 7.7% |
| data/enrichment | 826 | 6.0% |
| social/twitter | 756 | 5.5% |
| meta/docs | 756 | 5.5% |
| business/cost | 755 | 5.5% |
| data/classification | 705 | 5.1% |
| personal/frust | 685 | 5.0% |
| data/quality | 671 | 4.9% |

The top 4 categories (extraction, debugging, database, learning) each exceed 15% of the corpus, reflecting the four pillars of the construction process: getting data in, fixing what breaks, building the storage layer, and understanding the domain.

---

## IV. Session Archetypes

### Classification

541 sessions were classified into 8 archetypes based on duration, prompt count, commit count, frustration rate, and focus score:

| Archetype | Count | % | Avg Prompts | Avg Duration | Avg Commits | Avg Frustration |
|-----------|-------|---|------------|-------------|-------------|-----------------|
| Abandoned | 100 | 18.5% | 1.3 | <1m | 0.5 | 9.5% |
| Quick Fix | 41 | 7.6% | 5.1 | 16m | 2.1 | 11.9% |
| Debug Spiral | 7 | 1.3% | 18.7 | 1h49m | 0.0 | 35.9% |
| Deep Build | 13 | 2.4% | 63.5 | 4h17m | 20.0 | 9.7% |
| Triage | 2 | 0.4% | 481.5 | 18h12m | 64.0 | 7.7% |
| Design | 78 | 14.4% | 33.6 | 2h46m | 4.2 | 5.6% |
| Exploration | 119 | 22.0% | 28.1 | 1h48m | 0.0 | 9.2% |
| Standard Work | 181 | 33.5% | 29.6 | 2h18m | 5.1 | 11.3% |

### Key Findings

**Abandoned sessions (18.5%)** are false starts — single prompts with no follow-through. They indicate context-switching at the meta level: the founder begins a task, reconsiders, and redirects elsewhere. The high volume suggests that the prompt serves partly as a thinking tool — the act of formulating the prompt helps clarify whether the task is worth pursuing.

**Debug Spirals (1.3%)** are the most unproductive archetype: 18.7 prompts, nearly 2 hours, zero commits, and 35.9% frustration. These sessions indicate architecture problems disguised as bugs — the founder attempts to fix symptoms of systemic issues through iterative debugging.

**Deep Build sessions (2.4%)** are the most productive: 63.5 prompts, 4+ hours, 20 commits, and below-average frustration (9.7%). These are flow states where sustained single-domain work produces high output. They cluster around 10 PM (evening) and are most common in data and infrastructure domains.

**The Triage archetype (0.4%)** represents only 2 sessions, but they are extraordinary events: the Feb 26-27 marathon (905 prompts, 31.9 hours, 128 commits) and a smaller triage session. These are platform-scale operations that reshape the entire system.

**Efficiency ranking by commits per prompt:** Quick Fix (0.41) > Deep Build (0.32) > Standard Work (0.17) > Design (0.13) > Triage (0.13) > Debug Spiral (0.00) = Exploration (0.00).

### Session Transitions

The most common same-day session sequences:

1. Standard Work -> Standard Work (42 times)
2. Exploration -> Standard Work (33 times)
3. Standard Work -> Exploration (32 times)
4. Abandoned -> Standard Work (26 times)
5. Exploration -> Exploration (25 times)

The dominant pattern is oscillation between Standard Work and Exploration — building and researching in alternating cycles. This oscillation is not inefficiency; it reflects the exploratory nature of platform construction where research is required to determine what to build next.

---

## V. Frustration Analysis

### Overall Metrics

- Total frustrated prompts: 1,270 (9.2% of corpus)
- Frustration by domain (highest): personal (71.9%), product (29.1%), photos (28.9%), hardware (27.8%)
- Frustration by domain (lowest): uncategorized (2.4%), tool (5.7%), pasted (11.5%)

### Temporal Patterns

**By hour of day:** Frustration peaks at 11 AM (20.8%), 2 AM (19.1%), 5 AM (19.2%), and 7 AM (19.6%). It troughs at 8 PM (12.0%), 3 PM (13.0%), and 1 AM (13.1%). There is no clear correlation with time of day beyond a modest late-morning/early-afternoon peak.

**By day of week:** Sunday is the most frustrated day (19.1%), Monday the least (16.9%). The variance is modest (16.9% to 19.1%), suggesting day-of-week effects are minor.

**By session quarter:** The exhaustion curve is essentially flat: Q1=17.1%, Q2=18.9%, Q3=16.4%, Q4=17.3%. Frustration does not increase as sessions progress. This is a counterintuitive finding — it implies that frustration is triggered by the nature of the work rather than by fatigue or duration.

### Domain-Triggered Frustration

The domain-specific frustration rates reveal that certain types of work are inherently more frustrating than others:

| Domain | Frustration Rate | Likely Cause |
|--------|-----------------|-------------|
| personal | 71.9% | Frustration with self/progress |
| product | 29.1% | Product not matching vision |
| photos | 28.9% | Image pipeline complexity |
| hardware | 27.8% | Physical device issues |
| config | 24.9% | Configuration complexity |
| data | 24.0% | Data quality/extraction issues |
| agents | 23.9% | AI agent unreliability |

The highest frustration domain (personal, 71.9%) reflects moments when the founder expresses frustration with the project's overall direction or their own progress — these are metacognitive rather than technical frustration events.

---

## VI. Machine Activation Analysis

### The 11 Machines

| Machine | Description | Activation Rate |
|---------|-------------|----------------|
| the_skin | UI, design, display | 22.1% |
| the_skeleton | Database, infrastructure | 18.1% |
| the_mouth | Ingestion, extraction | 17.7% |
| the_brain | AI, intelligence, reasoning | 15.1% |
| the_wallet | Pricing, valuation, markets | 14.7% |
| the_eye | Photos, vision, condition | 14.4% |
| the_gut | Data processing, transformation | 13.2% |
| the_nose | Discovery, finding new data | 13.1% |
| the_hands | Editing, curating, organizing | 10.1% |
| the_memory | History, timeline, provenance | 9.6% |
| the_voice | APIs, notifications, sharing | 8.0% |

### Co-Activation Matrix

The strongest machine co-activations (by pointwise mutual information):

| Pair | PMI | Interpretation |
|------|-----|----------------|
| gut + skeleton | 1.91 | Processing IS infrastructure |
| brain + nose | 1.84 | Discovery requires intelligence |
| brain + gut | 1.79 | Analysis IS transformation |
| brain + skeleton | 1.76 | Intelligence requires infrastructure |
| nose + skeleton | 1.76 | Discovery requires infrastructure |
| gut + mouth | 1.70 | Ingestion and processing are inseparable |
| brain + wallet | 1.69 | Valuation requires intelligence |
| gut + wallet | 1.66 | Processing creates value |
| nose + wallet | 1.66 | Discovery finds value |
| mouth + wallet | 1.60 | Extraction feeds valuation |

### The Super-Assemblage

Six machines (brain, gut, skeleton, mouth, nose, wallet) form a super-assemblage with 40-60% mutual co-activation. This is the core machinery of the platform. The skin connects at 30-36%. The voice connects at 22-34%. The hands connect to the skin at 65% but weakly elsewhere.

### Full-Body Activation

1,799 prompts (13.1%) activate 5 or more machines simultaneously. Only 5 prompts activate all 11 machines. These 5 prompts describe the complete system specification:

1. **Dec 26, 2025**: Personal photo library -> bot -> analysis -> vehicle matching
2. **Feb 6, 2026**: Founder-as-expert directing AI-as-tool
3. **Feb 11, 2026**: Photo Auto-Sync -> classification -> matching -> knowledge
4. **Jan 30, 2026**: Craigslist listings -> provenance -> owner tracking
5. **Feb 13, 2026**: API/SDK -> data access -> monetization

### Deterritorialized Concepts

Concepts that escape their home machine and distribute across the system:

| Concept | Home Machine | Distribution |
|---------|-------------|-------------|
| observation | NONE (equally distributed) | All 11 machines |
| pipeline | skeleton | All 11 machines |
| profile | skin | All 11 machines |
| valuation | wallet | 10 of 11 |
| curate | hands | 10 of 11 |
| condition | eye | 10 of 11 |
| provenance | memory | 10 of 11 |

"Observation" has no home machine — it belongs equally to all machines. This makes it the unifying concept of the architecture: the one idea that, if fully implemented, dissolves the boundaries between all functional domains.

---

## VII. Prompt Sophistication Evolution

### Formality Arc

| Month | Avg Length | Profanity % | Structured % | Terse % | Code % |
|-------|-----------|-------------|-------------|---------|--------|
| Oct 2025 | 437 chars | 7.1% | 3% | 14% | 7% |
| Nov 2025 | 738 chars | 8.6% | 7% | 11% | 17% |
| Dec 2025 | 519 chars | 8.6% | 3% | 9% | 17% |
| Jan 2026 | 427 chars | 5.5% | 5% | 10% | 8% |
| Feb 2026 | 664 chars | 5.1% | 36% | 8% | 20% |
| Mar 2026 | 781 chars | 5.6% | 41% | 6% | 18% |

The most significant shift is in structured prompts (containing markdown headers, bullet lists, code fences, or tables): from 3% in October to 41% in March. This 14x increase reflects the founder learning what information the AI assistant needs to produce good output, and front-loading that context through structured specifications.

### Tool Effect

The transition from Cursor to Claude Code in January 2026 corresponds with measurable changes:

| Metric | Cursor | Claude Code |
|--------|--------|-------------|
| Avg prompt length | 592 chars | 640 chars |
| Code pasted | 15% | 18% |
| Terse (<50 chars) | 10% | 8% |
| Structured | 4% | 34% |

Claude Code prompts are 8% longer, 8.5x more likely to be structured, and contain more pasted code. This reflects both the tool's different interface (terminal vs. IDE) and the founder's evolving communication style.

### Voice-to-Text

Approximately 8.9% of all prompts appear to be dictated (detected heuristically based on absence of punctuation, presence of filler words, and run-on sentence structure). Voice-to-text usage peaked in January (12.9%) and declined in February (10.3%) and March (7.3%), correlating with the shift toward structured written prompts.

---

## VIII. Desire Clustering

5,458 explicit desire statements ("I want," "we need," "should be") were extracted from the corpus and clustered:

| Cluster | Count | Core Expression |
|---------|-------|-----------------|
| SMART_SYSTEM | 856 | "Use AI, not be used by it" |
| INGEST_WORLD | 463 | "Pull all my BAT listings and match them" |
| KNOW_VALUE | 385 | "The value of the money I stake" |
| LOOK_RIGHT | 300 | "Must always look crispy clear beautiful" |
| REMEMBER | 158 | "Catalog info integrated into the mind of the DB" |
| USER_CONTROL | 118 | "The founder should be able to make changes" |
| AUTONOMOUS | 100 | "Should be done automatically and backfilled everywhere" |
| FLOW_DATA | 82 | "Flow more like X but feel like Cursor/Robinhood" |
| SEE_EVERYTHING | 79 | "All images and vehicles connected to this location" |
| SCALE | 76 | "We always ship successful changes to production" |

The dominant desire (856 statements) is SMART_SYSTEM — an intelligence, not a website. The first articulation appeared October 31, 2025, just 11 days into the project.

---

## IX. The Narrative Arc

### Six Eras

| Era | Period | Prompts | Commits | Character |
|-----|--------|---------|---------|-----------|
| Genesis | Oct 2025 | 645 | 399 | Exploratory, UI-heavy |
| Expansion | Nov 2025 | 1,751 | 147 | Feature breadth, high frustration |
| Extraction | Dec 2025 | 2,623 | 490 | Data infrastructure, BaT pipeline |
| Transition | Jan 2026 | 2,118 | 245 | Tool change, habit reformation |
| Intensity | Feb 2026 | 4,909 | 626 | All systems peak, marathon sessions |
| Audit | Mar 2026 | 1,391 | 138 | Specification, consolidation, triage |

### Phase Transitions

13 phase transitions were identified — moments when the dominant prompt category shifted, indicating strategic pivots. The transitions oscillated between building (UI, extraction) and debugging (ops, infrastructure), with the transition frequency decreasing over time as the system stabilized.

### Marathon Days

The 12 highest-volume days (200+ prompts each) accounted for 3,869 prompts (28.1% of the corpus) in just 12 of 134 active days (9.0%). The single largest day — February 26, 2026 — produced 566 prompts across a 31.9-hour session that extended into February 27.

---

## X. Discussion

### Finding 1: Thrashing Is Not Dysfunction

The 92% rate of cross-domain switching appears pathological by conventional project management standards. However, the machine co-activation analysis reveals that this switching is structurally necessary: every feature in the provenance engine requires multiple machines, and the machines cannot be developed in isolation because they have circular dependencies. The "thrashing" is the natural behavior of a system where the mouth cannot be built without the skeleton, the skeleton cannot be designed without the brain, and the brain cannot function without the mouth. Sequential development would reduce switching but would also produce modules that do not integrate.

### Finding 2: Frustration Is Domain-Triggered, Not Fatigue-Induced

The flat exhaustion curve (17.1%, 18.9%, 16.4%, 17.3% across session quarters) decisively rejects the hypothesis that frustration increases with session duration. Instead, the strong domain correlation (personal: 71.9%, product: 29.1%, photos: 28.9%, tool: 5.7%) indicates that frustration is triggered by the nature of the work. Some domains (personal reflection, product vision) are inherently more frustrating than others (tool usage, pasted code). The implication is that reducing frustration requires changing what is worked on, not how long it is worked on.

### Finding 3: The Five-Prompt Specification

Only 5 of 13,758 prompts activate all 11 machines simultaneously. These prompts describe the complete system: photos in, intelligence applied, data structured, value estimated, connections discovered, results displayed, human steering, external access. The rarity of full-body activation (0.036%) reflects the difficulty of expressing simultaneous requirements in sequential language, not the rarity of the founder's holistic vision.

### Finding 4: Prompt Sophistication Predicts Output Quality

The correlation between structured prompting (which rose from 0.9% to 39%) and commit output is positive but non-linear. Claude Code sessions, with 34% structured prompts, produce more reliable code output than Cursor sessions at 4% structured. This suggests that front-loading context through structured specifications reduces AI-generated errors and rework cycles.

### Finding 5: Vocabulary Evolution Tracks Domain Understanding

The replacement chains (scrape -> extract -> ingest -> observe; price -> value -> estimate -> valuation; bot -> agent -> autonomous) track increasing sophistication of domain understanding. Early vocabulary is action-oriented ("scrape this page"). Late vocabulary is concept-oriented ("this observation should enter the system with source attribution"). The language maturation mirrors the platform maturation.

---

## XI. Limitations

1. **Single-founder corpus.** The prompts reflect one individual's communication style, domain knowledge, and emotional patterns. Generalization to multi-person teams is not supported.

2. **Category assignment subjectivity.** Multi-category assignment involves judgment calls that may not be reproducible by a different analyst.

3. **Frustration detection accuracy.** The 87% agreement rate with manual labels means approximately 13% of frustration classifications are incorrect. Direction of bias is unknown.

4. **Survivor bias in commits.** The git log captures successful commits only. Failed attempts, abandoned branches, and reverted commits are underrepresented.

5. **Tool transition confound.** The Cursor -> Claude Code transition in January 2026 coincides with other changes (growing domain expertise, platform maturation, seasonal variation), making it difficult to isolate tool effects.

---

## XII. Conclusions

The 13,758-prompt corpus documents the construction of a provenance engine through a process that is simultaneously more chaotic and more coherent than traditional software development. The chaos is visible in the 92% thrashing rate, the 18.5% abandoned sessions, the 1,270 frustrated prompts. The coherence is visible in the machine co-activation patterns, the consistent desire clusters, the five full-body prompts that serve as an implicit specification.

The process produced: a functional vehicle entity system, a multi-source extraction pipeline, an image processing infrastructure, a valuation framework, a search and discovery system, a database backbone of 156 GB, a codified design system, a trained AI vision model, and a complete observation system architecture. It also produced 558 prompts on dead features (4.1% of corpus), 119 exploration sessions with zero commits, and 7 debug spirals that consumed nearly 13 hours with no output.

The construction process is best understood not as planned execution but as organic growth — a rhizomatic expansion where every feature connects to every other feature and progress happens simultaneously across all dimensions rather than sequentially along a single axis. The thrashing is the growth. The frustration is the feedback. The full-body prompts are the moments of clarity. And the accumulated corpus — 13,758 prompts across 141 days — is itself an observation about the platform, subject to the same principles of attribution, temporal positioning, and trust weighting that the platform applies to observations about physical assets.

---

## Appendix A: Data Sources

| Source | Location | Format |
|--------|----------|--------|
| Prompt corpus | skylar-master-prompts-v3.json | JSON array of prompt objects |
| Categorized prompts | all-categorized-v3.json | JSON with multi-category labels |
| Git log | git-log-export.txt | Standard git log format |
| Analytical outputs | /docs/writing/ | Markdown analytical documents |

## Appendix B: Machine Definitions

| Machine | Keywords | Scope |
|---------|----------|-------|
| the_skin | UI, CSS, design, layout, component, page, display | Interface and presentation |
| the_skeleton | database, table, column, migration, index, query, SQL | Data storage and infrastructure |
| the_mouth | scrape, extract, crawl, fetch, ingest, import, parse | Data ingestion from external sources |
| the_brain | AI, model, classify, predict, analyze, intelligence | Machine learning and reasoning |
| the_wallet | price, value, estimate, auction, sale, market, cost | Financial data and valuation |
| the_eye | image, photo, vision, condition, visual, camera | Visual data processing |
| the_gut | process, transform, normalize, deduplicate, enrich | Data transformation and quality |
| the_nose | discover, find, search, explore, snowball, lead | Finding new data and connections |
| the_hands | edit, curate, organize, tag, correct, manual | Human manipulation and correction |
| the_memory | history, timeline, provenance, trace, record, chain | Temporal data and data lineage |
| the_voice | API, SDK, endpoint, webhook, notify, export, share | External communication and output |

---

*Study based on analysis conducted March 2026. Analytical source documents are preserved at /docs/writing/ and include: RHIZOME.md, METAPHORS.md, NARRATIVE_ARC.md, VOCABULARY_EVOLUTION.md, emotional_arc.md, COMPLETE_AUDIT.md, SESSION_ARCHETYPES.md, temporal.md, sophistication.md.*
