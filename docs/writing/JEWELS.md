# The Jewels: What the Prompts Actually Ask For (That Never Gets Built)

> Frequency analysis tells you what you *talked about*. This tells you what you *meant*.

## The Core Thesis (extracted from 801 vision prompts)

You keep describing the same system from different angles:

1. **Photos are the primary input.** Not URLs, not forms, not APIs. Photos from your phone, your disk, your library. The system should ingest photos and figure everything out from there.
2. **The system should run itself.** You mention autonomous/self-running in 660 prompts across all 6 months. This isn't a feature request — it's the product identity.
3. **Everything is an observation with provenance.** Data comes from dozens of sources at different trust levels. The system records where everything came from and lets quality emerge from volume.
4. **Valuation is the output.** The "Nuke Estimate" — a Zestimate for collector vehicles. Every pipeline, every extraction, every image analysis ultimately feeds a price.
5. **Scale is existential.** "18 million images", "1 billion images in the first year", "millions of data points." The architecture must handle this or it's dead.

## The 8 Jewels (low-frequency, high-importance concepts)

These appear in far fewer prompts than "CSS bugs" or "extraction errors," but they're the load-bearing ideas:

### 1. LOCAL AI MODEL (YONO) — 33 mentions, but the entire product depends on it
- First mentioned Nov 4, 2025: "fine tune"
- Named Feb 1, 2026: "So how do we make a new version called Yono you only nuke one"
- The math: 34M images × $0.001/image via cloud = $34,000. Local model = $0.
- **Status**: EfficientNet trained, ONNX exported, classifier working. But not integrated into any pipeline.
- **The jewel**: This is the only way the economics work at scale.

### 2. PHOTO SYNC / FULL DISK ACCESS — 57 mentions across 5 months
- First mentioned Oct 24, 2025 (iPhoto)
- Re-introduced 3 times (Nov, Feb, Mar) — keeps getting re-explained because it never ships
- **The vision** (Dec 26): "When a user has their images on their computer we basically need to give them some version of a bot like Claude Code who asks permissions to access their photos and then we run analysis"
- **What exists**: `iphoto-intake.mjs` script (manual CLI), 419 photos uploaded for K10 truck
- **What doesn't exist**: Watching, auto-sync, running analysis on ingest

### 3. CONDITION SCORING / SPECTROMETER — 19 mentions, 3 months, re-introduced twice
- The idea: 0-100 condition score from photos, not from human assessment
- "Damage is an ADJECTIVE, not an event. Condition is SPECTRAL, not binary."
- **What exists**: Full taxonomy (69 descriptors), scoring pipeline, 9 CLI commands
- **What doesn't exist**: Actually running it on the 34M images

### 4. AUTONOMOUS EXTRACTION LOOP — 19 mentions, 4 months
- Nov 2025: "where's the self healing cuz this was a BAT url created profile but its mostly empty"
- Dec 2025: "how can I make it autonomous to go and audit everything"
- Feb 2026: "I wanna see how big Facebook marketplace I wanna figure out..."
- **The pattern**: You keep asking the system to find data on its own, discover gaps, fill them
- **What exists**: Discovery snowball, Ralph coordinator, 131 cron jobs
- **What doesn't exist**: A coherent loop that actually grows the dataset without intervention

### 5. NUKE ESTIMATE (Zestimate for Cars) — 45 mentions across 5 months, never dropped
- Nov 2025: "in order to ensure the final number is accurate all of those tables need their own code"
- Jan 2026: Built valuation edge function
- Feb 2026: Detailed pricing model design prompt (score=4 vision prompt)
- **What exists**: `nuke_estimate` column, valuation functions, price history tables
- **What doesn't exist**: An actual algorithm that produces a trustworthy number

### 6. OBSERVATION SYSTEM / SOURCE-AGNOSTIC — 258 mentions, 5 months
- First articulated Nov 14: "all fields, where did the images and docs come from? we record provenance then we can process and generate knowledge"
- **What exists**: `observation_sources`, `vehicle_observations`, `ingest-observation` function
- **What doesn't exist**: All extractors actually writing through it. Most still write directly to legacy tables.

### 7. DEVELOPER API / SDK — 207 mentions, all 6 months, never dropped
- Oct 2025: "users don't need to see the code, they just need to provide the input"
- Mar 2026: "I need to understand the FULL capability surface so we can build a compelling developer page"
- **What exists**: Supabase REST, some edge functions
- **What doesn't exist**: `@nuke1/sdk`, API keys, rate limiting, documentation, a developer portal

### 8. LABOR ESTIMATION ("Photos Are The Time Clock") — 23 mentions, 5 months
- The insight: restoration shop photos contain time data. Photo timestamps + before/after detection = labor hours
- Feb 28: Detailed implementation plan written
- **What exists**: `detect-before-after` archived, no active function
- **What doesn't exist**: Any working implementation

## The Struggle Prompts: What You Can't Articulate Yet

131 prompts where you're reaching for technical concepts with informal language:

- **"Vehicle becomes its own server/Discord chat"** = event-sourced entity with a feed
- **"The two need to communicate but at the end of the day the images need local processing and local intelligence"** = hybrid cloud/edge architecture
- **"Organizations as assets like vehicles are assets"** = unified entity model with investment tracking
- **"Not sure how to build that but like when I put in Paint the paint shop should come up"** = semantic search / knowledge graph
- **"Every image represents something and the only mistakes we were making was that the import was an event when that is a redundancy"** = observations vs events distinction

## The Recurring Dream: Ideas That Keep Getting Re-Explained

| Concept | Mentions | Months | Times Re-Introduced |
|---------|----------|--------|-------------------|
| Developer API | 207 | 6 | 0 (never drops) |
| Nuke Estimate | 45 | 5 | 0 (never drops) |
| Dealer Scan / OCR | 33 | 3 | 1 |
| Photo Sync | 25 | 3 | 1 |
| Labor Estimation | 23 | 5 | 1 |
| Autonomous Loop | 19 | 4 | 1 |
| Condition Scoring | 19 | 3 | 1 |

The ones with re-introductions are the most telling: you had to explain them from scratch again because no working version survived from the previous attempt.

## What the Frequency Analysis Missed

The top-discussed categories (data/extraction, ops/debug, infra/database) represent **maintenance pain**, not product vision. They're loud because they break constantly. The jewels are quiet because:

1. They require technical knowledge you're still developing (ML training, edge inference, autonomous systems)
2. They work or they don't — there's no halfway state to debug in 15 prompts
3. They connect multiple domains (which is why 92% of sessions are "thrashing" — the real work IS cross-domain)

The irony: the "thrashing" sessions that score 0.0 on focus might actually be the most architecturally important, because the jewels live at the intersection of image analysis + database + extraction + local AI.
