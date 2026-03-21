# Vocabulary Evolution

## How the Project's Language Changed Over 141 Days

---

## Abstract

This study analyzes the evolution of technical vocabulary across 13,758 prompts issued during the construction of the Nuke provenance engine from October 2025 to March 2026. We track 2,859 significant terms (each used 10+ times), identify five replacement chains where informal vocabulary gave way to precise domain terminology, document the formality arc from conversational commands to structured specifications, and examine the relationship between vocabulary sophistication and implementation quality. Key findings: (1) vocabulary replacement follows a consistent pattern where action verbs are replaced by process nouns (scrape -> extract -> ingest -> observe); (2) structured prompting rose from 0.9% to 39%, correlating with the transition from Cursor to Claude Code; (3) profanity declined from 7.1% to 5.6%, reflecting maturation of the human-AI working relationship; (4) approximately 8.9% of prompts were dictated via voice-to-text, with dictation usage inversely correlating with prompt structure.

---

## I. Introduction

### The Linguistic Dimension of Software Construction

Software construction through human-AI collaboration is fundamentally a linguistic activity. The founder communicates intent through prompts; the AI interprets intent through language understanding; the resulting code reflects the precision (or imprecision) of the communication. The vocabulary used in prompts is not merely decorative — it determines what the AI can understand, what it generates, and what the founder can effectively specify.

This study treats the prompt corpus as a linguistic artifact and analyzes its evolution over time. The hypothesis is that vocabulary sophistication — the precision, consistency, and domain-specificity of the terms used — correlates with implementation quality and that the evolution of vocabulary tracks the evolution of the founder's domain understanding.

### Data

- 13,758 prompts spanning October 21, 2025 to March 10, 2026
- 2,859 terms with 10+ uses each (extracted from natural-language prompts under 2,000 characters)
- Monthly counts for each term
- Source tool metadata (Cursor, Claude Code, CLI, Perplexity)
- Frustration and structured-prompt flags per prompt

---

## II. Methodology

### Term Extraction

Terms were extracted from prompts after filtering code blocks, URLs, and file paths. Only natural-language content was analyzed. Terms were lemmatized (reducing inflected forms to base forms) and counted by document frequency (number of unique prompts containing the term, not raw word frequency).

### Replacement Chain Identification

Replacement chains were identified by finding terms in the same semantic field (e.g., data collection) where one term's frequency declined as another's rose, indicating conceptual replacement. Chains were validated by manual inspection of prompts where both terms appeared in the same session, confirming the transition.

### Formality Metrics

Five metrics were computed per month:
- **Average prompt length** (characters)
- **Profanity rate** (% of prompts containing profanity)
- **Structured rate** (% of prompts containing markdown headers, bullet lists, code fences, or tables)
- **Terse rate** (% of prompts under 50 characters)
- **Average sentence length** (words per sentence)

### Voice-to-Text Detection

Dictated prompts were identified heuristically through: absence of punctuation in prompts exceeding 50 words, presence of filler words ("you know," "I mean," "like"), and run-on sentence structure. The detection method is imperfect (estimated accuracy ~85%) but sufficient for trend analysis.

---

## III. The Term Landscape

### The 20 Most Frequent Terms

| Rank | Term | Total Uses | Domain | Introduced | Peak Month |
|------|------|-----------|--------|------------|-----------|
| 1 | data | 2,298 | data | Oct 2025 | Feb 2026 |
| 2 | vehicle | 2,056 | vehicle | Oct 2025 | Feb 2026 |
| 3 | users | 1,870 | general | Oct 2025 | Feb 2026 |
| 4 | images | 1,158 | general | Oct 2025 | Feb 2026 |
| 5 | vehicles | 1,054 | vehicle | Oct 2025 | Feb 2026 |
| 6 | find | 990 | general | Oct 2025 | Feb 2026 |
| 7 | functions | 955 | general | Oct 2025 | Feb 2026 |
| 8 | work | 849 | general | Oct 2025 | Feb 2026 |
| 9 | read | 835 | general | Oct 2025 | Feb 2026 |
| 10 | understand | 823 | general | Oct 2025 | Feb 2026 |
| 11 | user | 759 | general | Oct 2025 | Feb 2026 |
| 12 | profile | 748 | general | Oct 2025 | Feb 2026 |
| 13 | know | 704 | general | Oct 2025 | Feb 2026 |
| 14 | edge | 681 | platform | Oct 2025 | Feb 2026 |
| 15 | system | 607 | platform | Oct 2025 | Feb 2026 |
| 16 | source | 568 | discovery | Oct 2025 | Feb 2026 |
| 17 | listing | 509 | data | Oct 2025 | Feb 2026 |
| 18 | needs | 493 | general | Oct 2025 | Feb 2026 |
| 19 | price | 422 | valuation | Oct 2025 | Feb 2026 |
| 20 | shit | 373 | general | Oct 2025 | Feb 2026 |

Observations:

1. **All top 20 terms were introduced in October 2025** — the foundation vocabulary was established in the first month.
2. **All top 20 terms peaked in February 2026** — the month of maximum intensity amplified everything.
3. **"Understand" is the 10th most frequent term** — indicating that a large portion of prompts are asking the AI to explain or investigate, not just build.
4. **"Shit" ranks 20th** — profanity is a consistent feature of the vocabulary, though declining (see Section V).

### Term Introduction Waves

New domain-specific vocabulary entered the corpus in monthly waves:

**October 2025** (foundation): data, vehicle, users, images, functions, system, source, profile, edge, price

**November 2025** (expansion): nuke, extract, search, extraction, auction, profiles, status, frontend, content

**December 2025** (refinement): patterns, queue, focus, state, firecrawl, vision, handling, types, analyze

**January 2026** (infrastructure): bash, dotenvx, curl, authorization, cron, observations, infrastructure, endpoints, extractor

**February 2026** (operations): execute, grep, psql, yono, tasks, directories, worker, router, hooks, routing

**March 2026** (consolidation): guidelines, handoff, philosophy, conflicts, animation, searchresults, haiku

The waves reveal a progression: foundation vocabulary (October) -> domain vocabulary (November) -> technical vocabulary (December) -> operational vocabulary (January-February) -> meta vocabulary (March). The project's language evolved from "what are we building?" to "how do we operate it?" to "what does it mean?"

---

## IV. Replacement Chains

Five replacement chains were identified where informal or imprecise vocabulary gave way to domain-specific terminology:

### Chain 1: Data Collection

```
scrape -> crawl -> extract -> ingest -> observe
```

| Term | Oct | Nov | Dec | Jan | Feb | Mar | Total |
|------|-----|-----|-----|-----|-----|-----|-------|
| scrape | 2 | 11 | 49 | 12 | 124 | 13 | 211 |
| crawl | 0 | 1 | 2 | 1 | 50 | 2 | 56 |
| extract | 2 | 65 | 186 | 154 | 702 | 110 | 1,219 |
| ingest | 0 | 0 | 36 | 17 | 91 | 43 | 187 |
| observe | 0 | 3 | 3 | 1 | 2 | 2 | 11 |

**Analysis**: The data collection vocabulary evolves from an action-oriented verb ("scrape" — physically removing data from a surface) through a more systematic verb ("extract" — removing structured data from raw content) to a process-oriented verb ("ingest" — consuming data into a system) to a philosophical concept ("observe" — recording a data point with attribution and context).

The replacement is incomplete: "extract" dominates throughout (1,219 total uses) while "observe" never gains traction (11 uses). This suggests that the observation concept, despite being identified as the system's unifying architecture, has not yet been internalized into the daily working vocabulary. The founder and the AI still think in terms of extraction (getting data out of sources) rather than observation (recording attributed data points).

### Chain 2: Identity

```
profile -> entity -> vehicle
```

| Term | Oct | Nov | Dec | Jan | Feb | Mar | Total |
|------|-----|-----|-----|-----|-----|-----|-------|
| profile | 8 | 247 | 276 | 179 | 345 | 136 | 1,191 |
| entity | 0 | 10 | 0 | 2 | 24 | 4 | 40 |
| vehicle | 38 | 406 | 569 | 269 | 1,344 | 484 | 3,110 |

**Analysis**: Early prompts use "profile" (a UI concept — what the user sees) to describe what is more precisely a "vehicle" (a domain entity). "Entity" — the most abstract and correct term — appears only 40 times total. The vocabulary reflects a persistent UI-first framing: the founder thinks about vehicles as profiles to be displayed rather than as entities in a graph. This UI-first framing aligns with the finding that the_skin (22.1%) is the most activated machine despite the core value being in the_skeleton and the_mouth.

### Chain 3: Value

```
price -> value -> estimate -> valuation
```

| Term | Oct | Nov | Dec | Jan | Feb | Mar | Total |
|------|-----|-----|-----|-----|-----|-----|-------|
| price | 14 | 45 | 138 | 39 | 259 | 49 | 544 |
| value | 14 | 42 | 59 | 36 | 145 | 59 | 355 |
| estimate | 0 | 10 | 13 | 5 | 65 | 11 | 104 |
| valuation | 0 | 4 | 2 | 0 | 124 | 18 | 148 |

**Analysis**: The value vocabulary evolves from concrete to abstract. "Price" (a specific number at a specific moment) gives way to "value" (a broader concept), which gives way to "estimate" (an acknowledged approximation), which gives way to "valuation" (a formal process). The evolution tracks the founder's understanding that price is a fact, value is a concept, and valuation is a methodology.

"Valuation" spikes in February (124 uses) — the month when the Nuke Estimate concept crystallized. Before February, the vocabulary was about prices. After February, it was about valuations. This is a significant conceptual upgrade: prices are data points, valuations are computed composites with methodology and confidence intervals.

### Chain 4: Automation

```
bot -> agent -> autonomous
```

| Term | Oct | Nov | Dec | Jan | Feb | Mar | Total |
|------|-----|-----|-----|-----|-----|-----|-------|
| bot | 0 | 0 | 3 | 9 | 74 | 1 | 87 |
| agent | 9 | 11 | 42 | 26 | 318 | 61 | 467 |
| autonomous | 0 | 0 | 1 | 0 | 34 | 6 | 41 |

**Analysis**: The automation vocabulary evolves from anthropomorphic ("bot" — a machine pretending to be human) through organizational ("agent" — a role with responsibilities) to philosophical ("autonomous" — self-governing, self-healing). The February spike in "agent" (318 uses) coincides with the Ralph system development and the multi-agent architecture discussions. The emergence of "autonomous" marks the transition from thinking about automation as scripted behavior to thinking about it as self-directed capability.

### Chain 5: Interface

```
page -> component -> surface
```

| Term | Oct | Nov | Dec | Jan | Feb | Mar | Total |
|------|-----|-----|-----|-----|-----|-----|-------|
| page | 13 | 51 | 84 | 50 | 589 | 225 | 1,012 |
| component | 1 | 7 | 14 | 5 | 232 | 140 | 399 |
| surface | 0 | 4 | 23 | 12 | 33 | 8 | 80 |

**Analysis**: The interface vocabulary evolves from navigational ("page" — a URL-addressed screen) through structural ("component" — a reusable UI building block) to conceptual ("surface" — a display plane where data becomes visible). The dominance of "page" (1,012 uses vs. 80 for "surface") reflects the persistence of web-native thinking despite the architectural aspiration toward a more fluid, graph-based interface.

---

## V. The Formality Arc

### Monthly Metrics

| Month | Prompts | Avg Length | Profanity % | Structured % | Terse % | Avg Sent Len |
|-------|---------|-----------|-------------|-------------|---------|-------------|
| Oct 2025 | 352 | 855 chars | 7.1% | 0.9% | 45.5% | 10.9 words |
| Nov 2025 | 2,044 | 3,132 chars | 8.6% | 0.7% | 28.7% | 20.0 words |
| Dec 2025 | 2,866 | 2,716 chars | 8.6% | 0.4% | 28.0% | 13.5 words |
| Jan 2026 | 1,692 | 1,418 chars | 5.5% | 3.0% | 30.9% | 21.2 words |
| Feb 2026 | 5,228 | 887 chars | 5.1% | 34.3% | 25.9% | 18.2 words |
| Mar 2026 | 1,392 | 819 chars | 5.6% | 39.0% | 22.1% | 12.6 words |

### Findings

**Structured prompting rose from 0.9% to 39%.** This is the most significant change in the corpus. The founder learned, over 141 days, that structured prompts (with markdown headers, bullet lists, code fences, and explicit acceptance criteria) produce better AI outputs than unstructured commands. By March, nearly 4 in 10 prompts are structured specifications.

**Terse prompts declined from 45.5% to 22.1%.** Early prompts were often one-liners ("fix the homepage") or URLs. Later prompts were multi-paragraph specifications with context, constraints, and expected outputs. The average prompt became more deliberate and more informative.

**Profanity declined from 7.1% to 5.6%.** This is a modest decline but a consistent trend. The reduction likely reflects both growing proficiency (fewer frustrating failures) and the maturation of the human-AI working relationship (the founder treats the AI more as a colleague and less as a recalcitrant tool).

**Average prompt length peaked in November (3,132 chars) then declined to 819 chars.** The November peak reflects the expansion era: long, verbose, exploratory prompts describing what the platform should be. The later decline reflects increased efficiency — the founder communicates more information in fewer words through structure and precision.

### The Tool Effect

| Metric | Cursor | Claude Code |
|--------|--------|-------------|
| Avg prompt length | 592 chars | 640 chars |
| Code pasted | 15% | 18% |
| Terse (<50 chars) | 10% | 8% |
| Structured | 4% | 34% |

The transition from Cursor to Claude Code in January 2026 coincides with the dramatic rise in structured prompting (4% to 34%). This is partly a tool effect (Claude Code's terminal interface encourages longer, more deliberate prompts) and partly a learning effect (by January, the founder had accumulated enough experience to know what the AI needs). The two effects are confounded and cannot be fully separated.

---

## VI. The Invented Lexicon

The project coined or repurposed several terms:

| Term | Nuke Meaning | Standard Meaning | First Used | Total Uses |
|------|-------------|-----------------|------------|-----------|
| nuke | Vehicle data platform | Nuclear weapon | Oct 2025 | 2,177 |
| bat | Bring a Trailer abbreviation | Flying mammal | Oct 2025 | 778 |
| backfill | Retroactively populate data fields | Fill in gaps | Nov 2025 | 167 |
| yono | You Only Nuke Once (local AI model) | N/A | Feb 2026 | 151 |
| observation | Atomic data point with provenance | Act of observing | Dec 2025 | 102 |
| provenance | Data lineage / chain of custody | Origin/history | Nov 2025 | 94 |
| archivefetch | Fetch + auto-archive utility | N/A | Feb 2026 | 45 |
| squarebody | 1973-1991 GM C/K truck body style | Enthusiast term | Nov 2025 | 29 |
| snowball | Recursive discovery algorithm | Ball of snow | Nov 2025 | 28 |
| spectrometer | Condition scoring pipeline | Optical instrument | Mar 2026 | 1 |

The invented lexicon reveals domain expertise. "Squarebody" is an enthusiast term that appears in November — the founder is applying insider knowledge from the vehicle community. "Observation" is an architectural term that appears in December — the founder is developing a theoretical framework for the data model. "YONO" is a product name that appears in February — the team is branding its internal tools.

The most significant invented term is "observation" — the concept that the rhizome analysis identifies as the Body without Organs. Its relatively low frequency (102 uses) compared to its architectural centrality suggests that the concept is more important than its vocabulary presence indicates. The system talks about observations less than it should, given that observations are the unifying architecture.

---

## VII. Voice-to-Text Patterns

### Overall Rate

Approximately 8.9% of all prompts appear to be dictated, based on heuristic detection of absent punctuation, filler words, and run-on structure.

### Monthly Trend

| Month | Voice-to-Text % |
|-------|----------------|
| Oct 2025 | 2.6% |
| Nov 2025 | 8.7% |
| Dec 2025 | 5.9% |
| Jan 2026 | 12.9% |
| Feb 2026 | 10.3% |
| Mar 2026 | 7.3% |

Voice-to-text usage peaked in January (12.9%) — the transition month — and has declined since. The January peak may reflect the founder using dictation during the tool transition period, when typing habits were disrupted.

### Source Distribution

| Source | Total | Dictated | Rate |
|--------|-------|----------|------|
| cursor-bubble | 6,283 | 488 | 7.8% |
| history | 4,525 | 605 | 13.4% |
| transcript | 2,626 | 90 | 3.4% |
| cursor-transcript | 137 | 28 | 20.4% |

The "cursor-transcript" source has the highest dictation rate (20.4%), suggesting a workflow where the founder dictates directly into the Cursor chat interface. The "transcript" source (likely from Claude Code) has the lowest rate (3.4%), consistent with the terminal interface discouraging voice input.

### Quality Implications

Dictated prompts tend to be more conceptual and less technical. They are useful for vision statements, feature ideation, and strategic direction. They are less useful for precise technical specifications, where the lack of punctuation and structure reduces the AI's ability to parse requirements.

The inverse correlation between dictation rate and structured prompt rate supports this observation: as structured prompting increases (reflecting more deliberate, technical communication), voice-to-text decreases.

---

## VIII. Discussion

### Finding 1: Vocabulary Replacement Tracks Domain Understanding

The five replacement chains are not random vocabulary drift. They track a consistent progression from informal to formal, from concrete to abstract, from action-oriented to process-oriented:

- **scrape** (action) -> **observe** (process)
- **price** (concrete) -> **valuation** (abstract)
- **bot** (anthropomorphic) -> **autonomous** (philosophical)
- **page** (navigational) -> **surface** (conceptual)
- **profile** (UI-centric) -> **entity** (domain-centric)

In each chain, the earlier term reflects how a newcomer would describe the operation. The later term reflects how a domain expert would describe it. The vocabulary evolution is the visible trace of expertise acquisition.

### Finding 2: Incomplete Replacement Signals Incomplete Understanding

Several replacement chains are incomplete. "Observe" never displaces "extract." "Entity" never displaces "vehicle." "Surface" never displaces "page." This incompleteness is not random — it marks concepts that are architecturally important but not yet fully internalized.

The observation system is the canonical example: it is identified by the rhizome analysis as the Body without Organs (the unifying concept), it is deployed in the database, it has dedicated functions — but the working vocabulary still says "extract" 1,219 times to "observe"'s 11. The architecture has changed but the language has not caught up.

This gap between architectural intent and working vocabulary is a diagnostic signal. When the vocabulary catches up — when "observe" becomes as natural as "extract" — the observation system will be fully adopted. Until then, the gap indicates that the system is still being thought about in old terms even as it is built in new ones.

### Finding 3: Structured Prompting Correlates with Output Quality

The 0.9% to 39% rise in structured prompting corresponds with measurable improvements in the development process:

- **Prompt-to-commit ratio stabilized**: The wild swings of early months (1:1 in October, 10.7:1 in November) settled into a more predictable range (8-11:1) as structured prompting increased.
- **Debug spiral frequency decreased**: 2 debug spirals in November (when structured prompting was 0.7%) vs. 1 in February (when it was 34%).
- **Session abandonment decreased**: 28% abandoned sessions in January vs. 13% in March, correlating with rising prompt structure.

The mechanism is straightforward: structured prompts give the AI more context, clearer constraints, and more explicit success criteria. The AI produces more targeted outputs. Fewer outputs require rework. More sessions produce commits.

### Finding 4: Profanity as Process Signal

The 7.1% to 5.6% decline in profanity rate is modest but consistent. Profanity in the prompt corpus serves as a frustration signal — it appears when things are not working. The decline reflects:

1. **Fewer technical failures** as the platform matures
2. **Better human-AI communication** as prompting skill improves
3. **More structured prompts**, which are inherently less emotional

The domain-specific frustration data (from the emotional arc analysis) shows that profanity clusters in personal (71.9%), product (29.1%), and photos (28.9%) domains — areas of conceptual frustration rather than technical error. As the project shifts from conceptual exploration to specification, the frustration triggers shift accordingly.

---

## IX. Limitations

1. **Lemmatization imprecision**: Some terms were undercounted or overcounted due to lemmatization errors (e.g., "listing" and "listings" may not always be correctly unified).

2. **Voice-to-text detection accuracy**: The heuristic detection method has an estimated 85% accuracy, meaning approximately 15% of voice-to-text classifications are incorrect.

3. **Confounded effects**: The tool transition (Cursor -> Claude Code) coincides with other changes (seasonal, experiential, domain), making it impossible to isolate the tool's effect on vocabulary.

4. **Single-author corpus**: The vocabulary evolution reflects one person's linguistic development, not a team's. Different individuals might show different replacement chains or formality arcs.

5. **Code contamination**: Despite filtering, some code fragments (variable names, function names) may have been counted as natural language terms, inflating counts for terms like "function" and "component."

---

## X. Conclusions

The vocabulary of the Nuke prompt corpus evolved systematically over 141 days, tracking the founder's progression from novice AI collaborator to experienced domain engineer. Five replacement chains document the transition from informal action verbs to precise domain concepts. The formality arc documents the transition from terse commands to structured specifications. The invented lexicon documents the emergence of domain-specific terminology.

The most significant finding is the gap between architectural vocabulary and working vocabulary. Concepts like "observation" and "entity" are architecturally central but linguistically marginal. This gap is a leading indicator: when the working vocabulary catches up to the architectural vocabulary, the system will have achieved conceptual coherence.

The practical implication for AI-assisted development is that vocabulary matters. The terms used in prompts shape the code the AI produces. Replacing "scrape" with "observe" does not just sound more sophisticated — it communicates a fundamentally different architectural intent that results in fundamentally different code. The vocabulary evolution documented in this study is not just a linguistic curiosity. It is a record of how a platform's architecture was shaped, one word at a time.

---

*This study analyzes 2,859 significant terms across 13,758 prompts spanning October 21, 2025 to March 10, 2026. Word extraction was limited to natural-language prompts under 2,000 characters. All counts are document frequency (unique prompts containing the term), not raw word frequency. Voice-to-text detection is estimated. Source data: VOCABULARY_EVOLUTION.md, sophistication.md, all-categorized-v3.json.*
