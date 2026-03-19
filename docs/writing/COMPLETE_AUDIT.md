# The Complete Audit: 141 Days of Building Nuke

> *13,758 prompts. 2,045 commits. 541 sessions. ~965 active hours. One vehicle intelligence platform.*

---

## I. Executive Summary

**What is Nuke?** An autonomous vehicle intelligence platform that ingests data from dozens of sources (auctions, marketplaces, photos, forums), processes it through AI, and produces structured knowledge: valuations, condition scores, provenance records, and discovery leads.

**Timespan:** 2025-10-21 to 2026-03-10 (141 calendar days, 134 active days)

**What was built in 141 days:**
- [X] Core vehicle entity system (5,400 prompts -- the trunk)
- [X] AI intelligence pipeline (2,490 prompts)
- [X] Multi-source extraction (BaT, C&B, Craigslist, FB Marketplace, Hagerty, etc.)
- [X] Image processing infrastructure (1,422 prompts)
- [X] Valuation/pricing system (800 prompts)
- [X] Search and discovery (2,200 prompts)
- [X] Database/infrastructure backbone (4,296 prompts)
- [X] Timeline/provenance tracking (25 prompts, most stable concept)
- [X] Design system (documented, enforced)
- [X] YONO local AI model (trained, exported, not integrated)
- [X] Condition spectrometer (all 5 phases complete)
- [X] Observation system schema (deployed, not fully adopted)

**What was NOT built:**
- [ ] End-to-end photo pipeline (300K photos -> analysis -> curation)
- [ ] Autonomous extraction loop (partial -- Ralph exists but not self-healing)
- [ ] Nuke Estimate (standalone valuation model)
- [ ] Developer SDK/API portal (published but no portal)
- [ ] Labor estimation system
- [ ] Human curation interface (the_hands)

**The headline numbers:**
| Metric | Value |
|--------|-------|
| Total prompts | 13,758 |
| Total commits | 2,045 |
| Prompts per commit | 6.7 |
| Sessions (45-min gap) | 541 |
| Active work hours | ~965 |
| Active days | 134 of 141 |
| Median session | 9 prompts, 53 min |
| Prompts on dead features | 161 (1.2%) |
| Flow state sessions | 2 (0.6%) |
| Thrashing sessions (focus<0.4) | 331 (92%) |
| Frustrated prompts | 1,270 (9.2%) |
| Structured prompts (overall) | 16.9% |
| Structured prompts (Oct) | 0.9% |
| Structured prompts (Mar) | 37.9% |
| Most stable concept | Timeline (CV 0.57) |
| Fastest accelerating | YONO (760x) |

---

## II. The Corpus

### By Tool
| Tool | Prompts | % |
|------|---------|---|
| claude-code | 7,151 | 52.0% |
| cursor | 6,514 | 47.3% |
| cursor-cli | 77 | 0.6% |
| perplexity-web | 16 | 0.1% |


### By Month
| Month | Prompts | % of Total | Commits |
|-------|---------|-----------|---------|
| 2025-10 | 352 | 2.6% | 355 |
| 2025-11 | 2,044 | 14.9% | 191 |
| 2025-12 | 2,866 | 20.8% | 522 |
| 2026-01 | 1,692 | 12.3% | 216 |
| 2026-02 | 5,228 | 38.0% | 639 |
| 2026-03 | 1,392 | 10.1% | 122 |


February alone accounts for 38.0% of all prompts and 31.2% of all commits -- the peak intensity month.

### Top 20 Categories
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


---

## III. The Product As It Exists

### Core Entity System
The vehicle table is the gravitational center: 2,318 extraction prompts, 1,057 ingestion prompts, 671 quality prompts. Vehicles have year/make/model/VIN/price with multi-source provenance. The entity system handles deduplication across auction houses, marketplaces, and owner submissions. Status lifecycle: discovered -> active -> sold/archived/deleted.

### Extraction Pipeline
Dedicated extractors exist for Bring a Trailer, Cars & Bids, Hagerty, PCarMarket, Craigslist, and Facebook Marketplace. The universal pattern is URL -> archiveFetch -> structured extraction -> import_queue -> vehicle entity. 2,318 prompts touched extraction. Facebook Marketplace scraping uses logged-out GraphQL (doc_id 33269364996041474) across 55 US metros with no tokens required.

### Image Infrastructure
1,422 prompts on image work. The platform stores 30M+ image references across vehicle_images. Processing pipeline: upload -> optimization -> AI analysis (pending/processing/completed/failed/skipped). The iPhoto intake system syncs from Apple Photos via CLI. YONO EfficientNet model is trained and ONNX-exported but not wired into the processing pipeline.

### Valuation System
800 prompts on pricing and valuation. Comparable sales exist across platforms. The "Nuke Estimate" concept -- a Zestimate for collector vehicles -- has 2,194 prompts making it the most-discussed jewel, with 284 related commits. Comp engine pieces exist but no standalone valuation model produces a single number yet.

### Search & Discovery
1,285 search prompts, 528 feed prompts, 387 map prompts. Universal search handles vehicles, organizations, users, and tags with thumbnails. Discovery snowball recursively finds new vehicles from existing data. The map interface visualizes geographic distribution of inventory.

### Database Backbone
2,169 database prompts -- the stickiest domain (self-transition rate of 384, highest of any category). 1,013 tables (483 empty post-triage). 171 GB peak reduced to 156 GB after triage. Pipeline registry tracks 63 column-level ownership entries. Statement timeout enforced at 120s. Batched migration principle enforced after a full API outage on Feb 27.

### Design System
633 design prompts. Codified in unified-design-system.css: Arial only, Courier New for data, zero border-radius, zero shadows, 2px solid borders, ALL CAPS labels at 8-9px, 180ms transitions. Racing accents (Gulf, Martini, JPS, BRG, Papaya) as easter eggs. Documented and enforced by CLAUDE.md rules.

---

## IV. The Product As It Was Imagined (Gap Analysis)

The 8 load-bearing ideas ("jewels") represent what the prompts repeatedly ask for versus what was actually shipped.

| Jewel | Prompts (kw) | Commits (kw) | Imagined | Built | Gap |
|-------|-------------|--------------|----------|-------|-----|
| YONO (Local AI) | 192 | 12 | $0/image inference at 4ms, local model replacing cloud AI | EfficientNet trained, ONNX exported, YONOClassifier working | Not connected to any pipeline; 34M images still unprocessed |
| Photo Sync | 125 | 17 | Auto-watch Apple Photos, classify, match to vehicles | iphoto-intake.mjs (CLI), 419 photos uploaded for one truck | No watcher, no auto-analysis, no continuous sync |
| Condition Scoring | 17 | 0 | 0-100 spectral score from photos, multipass pipeline | Full taxonomy (69 descriptors), 9 CLI commands, 7 endpoints | Has never run on actual vehicle data at scale |
| Autonomous Loop | 179 | 12 | Self-healing extraction that grows the dataset | Ralph coordinator live, 131->112 crons, discovery snowball | Not self-healing; requires manual intervention for errors |
| Nuke Estimate | 111 | 1 | "Zestimate for cars" -- single authoritative valuation | Comp data across platforms, valuation edge function | No standalone model producing a confidence-scored number |
| Observation System | 138 | 21 | Universal provenance -- everything is an observation | Schema deployed, ingestion endpoint, source registry | Not fully adopted; legacy tables still primary pathway |
| SDK/API | 372 | 16 | @nuke1/sdk for external developers, documentation portal | Package published on npm, basic endpoints | No developer portal, no docs site, no auth for external use |
| Labor Estimation | 62 | 5 | Shop rate x hours = restoration cost estimates | Discussed extensively (162 prompts per JEWELS.md) | Most discussed-but-unbuilt concept; zero working code |

---

## V. What to Build Next (Evidence-Based Priority)

Ordered by: (acceleration x jewel importance x implementation readiness)

### Priority 1: Wire YONO Into the Pipeline
**Evidence:** 760x acceleration (fastest of any concept), 192 keyword-matched prompts, working model exists. The gap is integration, not development.
**Effort:** Medium -- model exists, need to connect to image processing pipeline's ai_processing_status flow.
**Impact:** $0 inference on 34M images. The entire economics of the platform depend on this.

### Priority 2: End-to-End Photo Pipeline
**Evidence:** Re-introduced 3 times across 5 months. User's number-one expressed desire is 300K photo organization from personal library. iPhoto intake works for CLI.
**Effort:** Medium -- iphoto-intake.mjs works, need filesystem watcher + YONO integration on ingest.
**Impact:** Personal photo collections become structured vehicle knowledge automatically.

### Priority 3: Observation System Full Adoption
**Evidence:** 8.3x acceleration. Identified as the "Body without Organs" -- the unifying architecture that dissolves boundaries between data sources.
**Effort:** High -- requires migrating existing data flows from legacy tables to vehicle_observations.
**Impact:** Eliminates the "which table does this go in?" problem. Makes every extractor write through one path.

### Priority 4: Nuke Estimate (Standalone Valuation)
**Evidence:** 111 keyword-matched prompts (most-discussed jewel by the JEWELS analysis: 2,194 prompts, 284 commits). Comp data exists across platforms.
**Effort:** High -- needs comp engine, confidence scoring, outlier detection, temporal decay.
**Impact:** The product's primary consumer-facing output -- "What is this car worth?"

### Priority 5: Developer SDK/API Portal
**Evidence:** 4.0x acceleration, @nuke1/sdk already published on npm. 372 keyword-matched prompts.
**Effort:** Medium -- SDK exists, need documentation site, developer portal, API key management.
**Impact:** The product speaks to the outside world. Revenue path.

---

## VI. What to Stop Doing

### Dead Features (confirmed killed Mar 7-8, 2026)
Nine features were deleted during the platform triage:
- **Betting/wagering** on auction outcomes
- **Trading/exchange** (vehicle swap marketplace)
- **Vault** (NFT-style vehicle ownership tokens)
- **Concierge/villa** (luxury services)
- **Shipping** (transport logistics)
- **Investor portal** (fundraising dashboard)
- **bat-extract** and 3 other duplicate extractors
- **Archived directories** (259 dead edge functions)

Cost: 161 prompts (1.2% of corpus), ~90 commits, $1,500-3,000/month burn reduction.

### Zombie Features (killed but keep coming back)
- **Investor Portal**: 16 post-triage mentions (HIGH recurrence risk). The urge to build fundraising tools resurfaces under stress. Treat every mention as a distraction signal.

### Process Waste
- **51% of sessions produce 0 commits.** Half of all AI time generates no trackable code output.
- **Debug Spirals** (1.3% of sessions): 35.9% frustration rate, 0 commits. These are architecture problems disguised as bugs.
- **Abandoned sessions** (18.5%): <5 min, 1-3 prompts, immediate context switch. These are false starts.
- **Stalled days**: 10 of 12 occurred during the Cursor era (before Jan 2026). Claude Code converts prompts to commits more reliably.

---

## VII. Architecture Recommendations

### From the Rhizome Analysis
1. **Observation is the unifying pattern.** The rhizome analysis found 11 conceptual "machines" (mouth, gut, skin, skeleton, brain, eye, wallet, nose, memory, voice, hands). Observation belongs to all 11 equally. Full adoption resolves the fragmentation across 1,013 tables.
2. **The Voice is starving.** API/SDK activates only 8% of the machine network but is accelerating at 4.0x. The product can see, eat, think, and value -- but barely speaks to the outside world.
3. **The Hands barely exist.** Human curation UI is the least developed machine. The user repeatedly describes wanting to "help curate it when it gets confused" -- a human-in-the-loop that doesn't exist.
4. **gut x skeleton is the strongest assemblage** (PMI 1.91). Data extraction and entity structure are deeply coupled. Changes to one always require changes to the other.

### From the Ecosystem Analysis
1. **Nothing is naturally decelerating.** Every concept is accelerating in prompt frequency. Conscious pruning (the triage) was the only deceleration mechanism. More pruning will be needed.
2. **The smooth-to-striated shift is real.** Exploratory prompting was dominant early; by March 2026, 34% of prompts are still exploratory but specification-quality prompts are rising. The product is maturing but isn't done being designed.
3. **Lines of flight point to:** YONO -> Observation -> Autonomous -> Condition -> SDK. That's the order of desire, measured by acceleration rates.

### From Decision Archaeology
1. **Decisions are implicit, not explicit.** Only 10 explicit architectural commitments were found vs 317 deliberation sequences. Most "decisions" happen by accumulation of code, not by declaration.
2. **5 unmade decisions** block progress: pricing model, mobile strategy, SDK architecture, authentication model, hosting architecture. These need to be made explicitly.
3. **Supabase commitment** is the most consequential decision made: 1,822 prompts reference Supabase after the commitment. Lock-in is total.

---

## VIII. Process Recommendations

### From Session Analysis
1. **Deep Build sessions (2.4% of all sessions) produce 20 commits each.** They are 10x more productive than average. Create more by blocking 4+ hour uninterrupted periods.
2. **Late-night sessions correlate with Debug Spirals.** Deep builds cluster around 10PM; debug spirals cluster at 4AM. Hard stop at midnight.
3. **Quick Fix sessions (7.6%) are the most efficient** at 0.41 commits/prompt. Short, focused, high output. When possible, batch small fixes into dedicated sessions.
4. **Standard Work (33.5%) is the workhorse**: reliable, moderate output. Exploration (22%) is necessary but produces fewer commits.

### From Prompt Evolution
1. **Structured prompting works.** 0.9% structured in Oct -> 37.9% structured in Mar. Claude Code sessions produce structured prompts at 34% vs Cursor at 4%. Longer, more detailed prompts convert to commits more reliably.
2. **~8.9% of prompts are voice-dictated.** Useful for vision and planning but produces lower-quality technical specifications. Use dictation for ideation, typing for implementation.
3. **Key vocabulary replacements track maturity:** scrape -> extract -> ingest -> observe. The language evolved from "getting data" to "recording observations with provenance."

### From Frustration Patterns
1. **Frustration is triggered by the work, not by fatigue.** Rate is uniform across session quarters (Q1=17.1%, Q2=18.9%, Q3=16.4%, Q4=17.3%). No exhaustion curve.
2. **Sundays are the angriest day** (19.1% frustration). Consider using weekends for exploration and planning, not debugging.
3. **infra/database is the stickiest domain.** Self-transition rate of 384. When you enter database work, you stay. Plan database sessions as dedicated blocks with clear exit criteria.

---

## IX. The 5 Prompts That ARE the Spec

From the rhizome analysis -- these 5 prompts activate all 11 conceptual machines simultaneously. They are the most complete expressions of what Nuke wants to become:

1. **Dec 26, 2025:** "When a user has their images on their computer we basically need to give them some version of a bot like Claude Code who asks permission to access their photos and then we run analysis"
   *Activates: mouth (ingest), eye (vision), brain (AI), hands (curation), memory (provenance)*

2. **Feb 6, 2026:** "I am actually the expert you're just a super intelligent fucking God level amazing computer genius but I have a vision but more importantly I know how to..."
   *Activates: identity (who builds this), voice (product direction), hands (human steering)*

3. **Feb 11, 2026:** "Design a comprehensive Photo Auto-Sync system... watches a user's Apple Photos library, automatically ingests new photos, classifies them, matches to vehicles..."
   *Activates: mouth (ingest), gut (extraction), eye (classification), brain (matching), skeleton (entity linking)*

4. **Jan 30, 2026:** "Import ~400+ saved Craigslist listings with historian credits and unverified owner tracking"
   *Activates: mouth (ingest), gut (extraction), nose (discovery), memory (provenance), wallet (valuation context)*

5. **Feb 13, 2026:** "API Endpoints, SDK Publishing, Documentation... 938K vehicles, 507K valuations, 11M+ auction comments, and 30M+ images -- but most of this data is locked behind internal functions"
   *Activates: voice (API), skin (presentation), wallet (monetization), skeleton (schema), brain (intelligence layer)*

**If you read nothing else, read these 5 prompts.** They describe the complete system: photos in, intelligence applied, data structured, value estimated, API out, human steering.

---

## X. The Trajectory

### By Era

**Oct-Nov 2025: Building the Surface** (2,396 prompts, 546 commits)
UI-heavy, exploratory, mobile-first fantasy. Cursor-era prompting: short, terse, high-frequency. Many features started, few finished. Betting, trading, vault all born and eventually killed here.

**Dec 2025: Feeding the Mouth** (2,866 prompts, 522 commits)
BaT extraction pipeline becomes the core workflow. Data infrastructure solidifies. The platform shifts from "what should this look like" to "how do we get data in." Comment extraction, image processing, entity deduplication all accelerate.

**Jan 2026: The Quiet Transition** (1,692 prompts, 216 commits)
Cursor -> Claude Code migration. Habits break and reform. Prompt length increases. Structured specifications replace terse commands. The tool change forces a workflow change.

**Feb 2026: Everything at Once** (5,228 prompts, 639 commits)
38.0% of all prompts in one month. Every system at peak intensity. The Feb 26-27 marathon: 905 prompts, 31.9 hours straight, 128 commits. YONO trained. Condition spectrometer built. Facebook Marketplace cracked. Platform triage initiated.

**Mar 2026: The Audit** (1,392 prompts, 122 commits)
Stepping back. Specifications over features. Dead feature deletion. 464 -> 440 edge functions. 171 GB -> 156 GB database. 131 -> 112 crons. This document.

### The Numbers Tell the Story

| Era | Prompts | Commits | Ratio | Character |
|-----|---------|---------|-------|-----------|
| Oct-Nov | 2,396 | 546 | 4.4 | Exploratory, UI-heavy |
| Dec | 2,866 | 522 | 5.5 | Data infrastructure |
| Jan | 1,692 | 216 | 7.8 | Tool transition |
| Feb | 5,228 | 639 | 8.2 | Peak intensity |
| Mar | 1,392 | 122 | 11.4 | Consolidation |

---

## XI. What Comes Next

The analysis points clearly to a build sequence, ordered not by what was most-discussed but by what is most-accelerating, most-desired, and most-ready-to-ship:

**1. YONO -> Pipeline** (integration, not development)
**2. Photo Pipeline** (watcher + YONO on ingest)
**3. Observation Adoption** (migrate legacy flows)
**4. Nuke Estimate** (comp engine + confidence scoring)
**5. SDK/API Portal** (documentation + developer experience)

The system has built its skeleton (entity model), skin (UI), mouth (extraction), gut (processing), brain (AI), eye (vision), wallet (valuation), nose (discovery), and memory (provenance). What it needs now is its **voice** (SDK/API) and its **hands** (human curation). And underneath it all, the **observation model** that dissolves the boundaries between every organ.

The Feb 26-27 marathon was the system's most intense moment: 905 prompts, 31.9 hours, 128 commits. It was infrastructure work -- the least glamorous, most necessary kind. The product's trajectory since then has been consolidation: killing dead features, writing specifications, reducing burn. That trajectory is correct. The next phase is integration: connecting the pieces that already exist.

---

*Generated 2026-03-10 09:57 from 13,758 prompts x 2,045 commits x 141 days x 541 sessions.*
*Synthesizes findings from: DEEP_ANALYSIS, JEWELS, RHIZOME, ECOSYSTEM, DEAD_FEATURES, SESSION_ARCHETYPES, DECISION_ARCHAEOLOGY, VOCABULARY_EVOLUTION, NARRATIVE_ARC, ENTITIES, METAPHORS, CONCEPT_GENEALOGY.*
*Source corpus: skylar-master-prompts-v3.json, all-categorized-v3.json, git-log-export.txt.*
