# A Thousand Prompts: Rhizomatic Analysis of 13,758 Prompts

> *"A rhizome has no beginning or end; it is always in the middle, between things, interbeing, intermezzo."*
> — Deleuze & Guattari, *A Thousand Plateaus*

The frequency analysis told us what got discussed most. This tells us what the system *wants to become*.

---

## The 11 Machines

Instead of categories, we map the prompts onto **machines** — Deleuzian assemblages where heterogeneous elements work together. Every prompt activates one or more machines:

| Machine | What it does | Prompts active | % of total |
|---------|-------------|----------------|-----------|
| **the_skin** | Surface — UI, design, display | 3,041 | 22.1% |
| **the_skeleton** | Bones — database, infra, plumbing | 2,488 | 18.1% |
| **the_mouth** | Ingestion — scraping, extracting, consuming | 2,436 | 17.7% |
| **the_brain** | Intelligence — AI, models, reasoning | 2,078 | 15.1% |
| **the_wallet** | Value — pricing, economics, markets | 2,016 | 14.7% |
| **the_eye** | Vision — photos, recognition, condition | 1,978 | 14.4% |
| **the_gut** | Digestion — transforming raw data into knowledge | 1,816 | 13.2% |
| **the_nose** | Discovery — finding new data, opportunities | 1,798 | 13.1% |
| **the_hands** | Manipulation — editing, curating, organizing | 1,393 | 10.1% |
| **the_memory** | Persistence — history, timeline, provenance | 1,320 | 9.6% |
| **the_voice** | Output — APIs, notifications, sharing | 1,098 | 8.0% |

**The skin (UI) leads in raw activation, but the skeleton (infrastructure) and mouth (ingestion) are what actually connect to everything else.** The voice (output/API) is the most underserved — only 8% of prompts, despite being how the product reaches the world.

---

## The Strongest Assemblages

Which machines fire together? The top connections (by PMI — pointwise mutual information — which measures *surprising* co-occurrence, not just raw count):

| Assemblage | Count | PMI | What it means |
|-----------|-------|-----|---------------|
| gut × skeleton | 1,234 | 1.91 | **Data processing IS infrastructure** — you can't separate transformation from storage |
| brain × nose | 970 | 1.84 | **Discovery requires intelligence** — finding data and understanding data are the same act |
| brain × gut | 951 | 1.79 | **Thinking IS digesting** — AI analysis and data transformation are one machine |
| brain × skeleton | 1,269 | 1.76 | **Intelligence needs bones** — every AI feature needs database/infra support |
| nose × skeleton | 1,098 | 1.76 | **Discovery needs infrastructure** — crawling/finding requires queue/storage |
| brain × wallet | 980 | 1.69 | **Valuation requires intelligence** — pricing is an AI problem |
| gut × mouth | 1,045 | 1.70 | **Ingestion and digestion are inseparable** — extract AND transform in one motion |
| gut × wallet | 843 | 1.66 | **Processing creates value** — raw data becomes money through transformation |
| nose × wallet | 832 | 1.66 | **Discovery finds money** — finding vehicles IS finding value |
| mouth × wallet | 1,085 | 1.60 | **Eating feeds the wallet** — every extraction ultimately serves valuation |

**The pattern:** Brain, gut, skeleton, mouth, nose, and wallet form a **super-assemblage** — they're all connected to each other at 40-60% co-occurrence. This is the body of the product. The skin (UI) connects to them at only 30-36%. The voice (API/output) connects at 22-34%.

This means: **the product's nervous system is extraction→processing→intelligence→valuation→discovery, and the UI is a membrane stretched over it.** The API barely exists yet.

---

## The Rhizome Map (Connection Strength)

What % of Machine A's prompts also activate Machine B:

```
            brain   eye   gut  hands memory mouth  nose  skel  skin voice wallet
brain         -    39%   46%   30%   32%   50%   47%   61%   48%   27%   47%
eye          41%    -    38%   31%   33%   38%   37%   43%   55%   22%   37%
gut          52%   41%    -    35%   34%   58%   46%   68%   53%   29%   46%
hands        45%   44%   45%    -    37%   46%   34%   48%   65%   26%   44%
memory       50%   49%   47%   39%    -    53%   40%   55%   60%   34%   50%
mouth        42%   31%   43%   27%   29%    -    40%   51%   50%   26%   45%
nose         54%   40%   46%   26%   30%   54%    -    61%   59%   32%   46%
skeleton     51%   34%   50%   27%   29%   50%   44%    -    44%   28%   41%
skin         33%   36%   31%   30%   26%   40%   35%   36%    -    22%   39%
voice        51%   41%   48%   33%   41%   58%   52%   64%   60%    -    50%
wallet       49%   36%   42%   31%   33%   54%   41%   51%   59%   27%    -
```

**Read this as:** When the gut activates, the skeleton co-activates 68% of the time. When the voice activates, the skeleton co-activates 64% of the time. The skeleton is the most *connected* machine — everything routes through infrastructure.

**The loneliest machines:**
- **the_voice** (output/API): Only 8% of prompts. Co-activated at 22-34% from most machines. The product barely speaks.
- **the_hands** (curation): Only 10%. Connected to skin (65%) but weak everywhere else. The user interface for human-in-the-loop barely exists.

---

## Deterritorialization — Concepts That Escape Their Home

Some concepts start in one machine but spread everywhere. These are the most *rhizomatic* ideas:

| Concept | Home territory | Where it travels | Meaning |
|---------|---------------|------------------|---------|
| **pipeline** | skeleton (305) | brain(233), gut(215), nose(212), mouth(203), eye(191)... | Pipeline isn't just infra — it's the organizing concept for everything |
| **observation** | gut (187) | skeleton(185), brain(142), mouth(139), nose(136), eye(129)... | The observation model touches every machine equally — it's the BwO |
| **profile** | skin (918) | eye(560), mouth(518), wallet(451), skeleton(414)... | "Profile" means something different in every context — it's overloaded |
| **valuation** | wallet (240) | brain(219), skeleton(205), gut(150), skin(148), mouth(148)... | Price estimation requires intelligence, infrastructure, and processing |
| **curate** | hands (136) | skin(121), eye(111), wallet(102), mouth(100), brain(94)... | Curation connects to everything — the human touch point |
| **condition** | eye (157) | brain(142), skeleton(130), wallet(127), skin(124), gut(123)... | Condition assessment is simultaneously visual, intelligent, financial, structural |
| **provenance** | memory (85) | skin(78), gut(76), mouth(75), wallet(74), brain(60)... | Where data came from matters to every part of the system |

**"Observation" is the Body without Organs.** It has no single home. It belongs equally to ingestion, processing, infrastructure, intelligence, and vision. This is the concept that, if fully realized, dissolves the boundaries between all the machines. It IS the rhizome.

---

## The Body Without Organs — Moments of Full Activation

**1,799 prompts** activate 5+ machines simultaneously. These are the moments where the whole system is present at once — no separation between seeing, eating, thinking, remembering, valuing. These are the product's most complete expressions:

> *"When a user has their images on their computer we basically need to give them some version of a bot like Claude Code who asks permission to access their photos and then we run analysis"*
> — Dec 26, 2025 (11 machines)

> *"I am actually the expert you're just a super intelligent fucking God level amazing computer genius but I have a vision but more importantly I know how to..."*
> — Feb 6, 2026 (11 machines)

> *"Design a comprehensive Photo Auto-Sync system... watches a user's Apple Photos library, automatically ingests new photos, classifies them, matches to vehicles..."*
> — Feb 11, 2026 (11 machines)

> *"Import ~400+ saved Craigslist listings with historian credits and unverified owner tracking"*
> — Jan 30, 2026 (11 machines)

> *"API Endpoints, SDK Publishing, Documentation... 938K vehicles, 507K valuations, 11M+ auction comments, and 30M+ images — but most of this data is locked behind internal functions"*
> — Feb 13, 2026 (11 machines)

These 5 prompts are the product spec. Not the 13,758 — these 5.

---

## The 5,458 Desires — What the System Wants to Become

Every "I want", "we need", "should be" statement extracted and clustered:

| Desire Cluster | Count | Core Expression |
|---------------|-------|-----------------|
| **SMART_SYSTEM** | 856 | "use ai not be used by it" (Oct 31, 2025) |
| **INGEST_WORLD** | 463 | "smart enough to pull all my bat listings and match them" (Nov 2) |
| **KNOW_VALUE** | 385 | "the value of the money I stake to increase/decrease" (Oct 21) |
| **LOOK_RIGHT** | 300 | "must always look crispy clear beautiful" (Oct 28) |
| **REMEMBER** | 158 | "catalog info integrated into the mind of the db" (Oct 25) |
| **USER_CONTROL** | 118 | "the founder should be able to make changes" (Jan 26) |
| **AUTONOMOUS** | 100 | "should be done automatically and should be backfilled everywhere" (Nov 1) |
| **FLOW_DATA** | 82 | "flow more like X but feel like Cursor/Robinhood but for cars" (Nov 5) |
| **SEE_EVERYTHING** | 79 | "all images and vehicles connected to this location to propagate" (Nov 2) |
| **SCALE** | 76 | "we always ship successful changes to production" (Oct 28) |

The #1 desire (856 statements) is a **SMART_SYSTEM** — not a website, not a database, not a scraper. An *intelligence*. The first articulation: "use AI, not be used by it." That's October 31, 2025 — 11 days in.

---

## Intensities — Where Energy Concentrates Over Time

All machines intensify in February 2026 (the month with 5,237 prompts). But the *relative* intensities reveal the arc:

- **Oct-Nov**: skin (UI) dominates — building the surface
- **Dec**: mouth (ingestion) rises — extraction becomes the focus
- **Jan**: relative quiet — a plateau (in the Deleuzian sense: a sustained intensity, not a peak)
- **Feb**: ALL machines hit maximum simultaneously — this is the deterritorialization event, where the boundaries between machines dissolved and everything happened at once
- **Mar**: intensity sustains but shifts toward brain (intelligence) and gut (processing) — the system is trying to think

---

## What This Means

The frequency analysis said "you're thrashing." The rhizome says **you're building a body.**

The 11 machines aren't categories you switch between — they're organs that need to work simultaneously. The 92% "thrashing" score from the focus analysis isn't dysfunction — it's the natural behavior of a system where every feature requires every machine.

The concepts that escape their territory — observation, pipeline, condition, valuation — are the connective tissue. They're the fasciae between organs. And "observation" is the one concept that lives everywhere equally. It's the closest thing to a unifying architecture.

**The product isn't 11 machines. It's one body:**

```
Photos (eye) → Ingest (mouth) → Process (gut) → Store (skeleton) →
Think (brain) → Discover more (nose) → Remember (memory) →
Value (wallet) → Show (skin) → Speak (voice) → Let humans touch (hands)
```

Every prompt that activates 5+ machines is trying to say this whole sentence at once.

**The voice (API/SDK) and hands (curation) are the most underdeveloped organs.** The body can see, eat, digest, think, discover, remember, and value — but it can barely speak to the outside world, and humans can barely touch it to correct it.

That's the dinner that never gets served.
