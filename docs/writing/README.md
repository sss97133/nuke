# Analysis Index: 13,758 Prompts × 2,045 Commits × 141 Days

> 23 documents across 3 layers. Start with COMPLETE_AUDIT.md for the synthesis, or dive into any layer.

---

## Layer 1: Statistical Foundation

Raw pattern detection — sessions, temporal rhythms, category flows, fix cycles, git correlation.

| Document | Size | What It Answers |
|----------|------|----------------|
| [DEEP_ANALYSIS.md](DEEP_ANALYSIS.md) | 7.5 KB | **Executive summary of the 10 statistical analyses.** Top 10 findings, session profile, tool comparison. |
| [sessions.md](sessions.md) | 2.4 KB | How prompts cluster into 541 work sessions (45-min gap threshold). Marathon sessions, session duration distribution. |
| [temporal.md](temporal.md) | 4.9 KB | When you work — hour × day-of-week heatmaps, circadian patterns, category by time-of-day. |
| [transitions.md](transitions.md) | 3.9 KB | What follows what — Markov chain of category transitions within sessions. Top 30 transitions, 3-step chains. |
| [fix_cycles.md](fix_cycles.md) | 1.1 KB | How long bugs take to fix — 73% resolve in 1-2 prompts, infra bugs are the longest (49 prompt max). |
| [git_correlation.md](git_correlation.md) | 4.0 KB | Prompts ↔ commits mapping. 6.6 prompts per commit, 51% of sessions produce zero code output. |
| [sophistication.md](sophistication.md) | 0.7 KB | Prompt evolution — length, structure, code-paste rate over time. Structured prompts: 0.9% → 39%. |
| [emotional_arc.md](emotional_arc.md) | 2.5 KB | Frustration mapping — 17.3% of prompts contain frustration. Uniform across sessions (no exhaustion curve). |
| [focus.md](focus.md) | 1.6 KB | Context switching — 92% thrashing, 0.6% flow. Focus score = 1 - (transitions / prompts). |
| [feature_lifecycle.md](feature_lifecycle.md) | 6.5 KB | Rising/steady/declining/dead categories month by month. Identifies what's growing and what's dying. |
| [dependency_graph.md](dependency_graph.md) | 4.6 KB | Category co-occurrence (PMI scoring). Mental coupling clusters — which topics are thought about together. |

---

## Layer 2: Conceptual Framework

Interpretive analysis — what the patterns mean, mapped onto Deleuzian concepts and product strategy.

| Document | Size | What It Answers |
|----------|------|----------------|
| [JEWELS.md](JEWELS.md) | 7.2 KB | **The 8 load-bearing ideas** that frequency analysis misses. Low-frequency, high-importance concepts that define the product's future. |
| [RHIZOME.md](RHIZOME.md) | 11.6 KB | **11 conceptual machines** (eye, mouth, brain, skeleton, skin, gut, voice, hands, memory, nose, wallet). Assemblages, PMI connections, Body without Organs. |
| [ECOSYSTEM.md](ECOSYSTEM.md) | 10.8 KB | **Arborescent + strata + lines of flight.** What's the trunk, what's bedrock, what's erupting. Smooth→striated trajectory. |

---

## Layer 3: Narrative Depth

The story told through the prompts — entities, metaphors, vocabulary, concept biographies, dead features, decisions, session types.

| Document | Size | What It Answers |
|----------|------|----------------|
| [NARRATIVE_ARC.md](NARRATIVE_ARC.md) | 24.5 KB | **The 20-week story** week by week. 6 eras, phase transitions, marathon days, representative quotes. |
| [ENTITIES.md](ENTITIES.md) | 21.9 KB | **Every named entity** — 25 platforms, 258 vehicles, 30 tools, 42 locations, people & organizations. |
| [METAPHORS.md](METAPHORS.md) | 34.1 KB | **The analogy atlas** — 35 reference products, body/organ metaphors, pipeline evolution, the design vocabulary. |
| [VOCABULARY_EVOLUTION.md](VOCABULARY_EVOLUTION.md) | 12.2 KB | **How language changed** — term introductions, replacement chains (scrape→extract→ingest→observe), formality arc, voice-to-text detection. |
| [CONCEPT_GENEALOGY.md](CONCEPT_GENEALOGY.md) | 54.8 KB | **Biography of the 8 jewels** — birth, dormancy, re-introduction, episode timeline, cross-pollination, unbuilt core. |
| [DEAD_FEATURES.md](DEAD_FEATURES.md) | 20.2 KB | **Archaeology of 9 abandoned ideas** — betting, trading, vault, shipping, investor portal, etc. Enthusiasm arcs, warning signs, recurrence risk. |
| [DECISION_ARCHAEOLOGY.md](DECISION_ARCHAEOLOGY.md) | 19.6 KB | **The forks in the road** — 10 biggest decisions, 5 unmade decisions, reversal patterns, decision velocity. |
| [SESSION_ARCHETYPES.md](SESSION_ARCHETYPES.md) | 9.5 KB | **8 types of work session** — Abandoned, Quick Fix, Debug Spiral, Deep Build, Triage, Design, Exploration, Standard Work. |

---

## Synthesis

| Document | Size | What It Answers |
|----------|------|----------------|
| [COMPLETE_AUDIT.md](COMPLETE_AUDIT.md) | 20.4 KB | **The final reckoning.** What exists, what's missing, what to build next, what to stop, architecture and process recommendations, the 5 prompts that ARE the spec. |

---

## Reading Order

**If you have 5 minutes:** Read COMPLETE_AUDIT.md.

**If you have 30 minutes:** Read COMPLETE_AUDIT.md → JEWELS.md → ECOSYSTEM.md.

**If you have 2 hours:** Read COMPLETE_AUDIT.md → JEWELS.md → RHIZOME.md → ECOSYSTEM.md → CONCEPT_GENEALOGY.md → NARRATIVE_ARC.md.

**If you want to understand a specific topic:**
- *What should we build next?* → COMPLETE_AUDIT.md §IV-V
- *What was the user trying to say?* → JEWELS.md + METAPHORS.md
- *How does the system connect?* → RHIZOME.md + ECOSYSTEM.md
- *What happened when?* → NARRATIVE_ARC.md
- *What failed and why?* → DEAD_FEATURES.md + DECISION_ARCHAEOLOGY.md
- *How does the user work?* → SESSION_ARCHETYPES.md + emotional_arc.md + focus.md

---

*23 documents. 284 KB. 13,758 prompts distilled into actionable knowledge.*
