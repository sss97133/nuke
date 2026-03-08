# YC S26 Application Draft - Nuke

**Deadline: February 9, 2026 at 8pm PT**
Fill in items marked [FILL] with your personal details.

---

## SECTION 1: COMPANY

**Company name:** Nuke

**Company URL:** [FILL - your live URL if you have one]

**Describe what your company does in 50 characters or less:**
Bots that hire humans to fix vehicles.

**What is your company going to make?**
Nuke is a data layer that enables bots to hire humans to fix vehicles. We've built 181 extraction tools that structure scattered vehicle data from auctions, forums, and social media into actionable intelligence -- 758K vehicles, 627K data points. On top of that data layer, our algorithms identify what work needs to be done on a vehicle, calculate the cost vs. ROI of doing it, and match to vetted tradespeople based on their tracked work history and reliability scores. The bot finds the opportunity, prices the job, and hires the human. The human does what only humans can do -- the physical work. Our only bottleneck is workspace. The data layer generalizes to any hands-on trade where AI can identify the opportunity but needs a human to execute it.

**Demo URL:** [FILL - link to live product or Loom recording]

**Where do you live now, and where would the company be based after YC?**
[FILL] / San Francisco

**Company category:** B2B SaaS / Data Infrastructure

**What tech stack are you using, or planning to use? Include AI models and AI coding tools.**

**Frontend:** React + TypeScript, Vite, Tailwind CSS, Headless UI, Radix. Deployed on Vercel.

**Backend:** Elixir/Phoenix API server. 181 Deno/TypeScript edge functions on Supabase for extraction, ingestion, and data processing.

**Database:** Supabase (PostgreSQL), 300+ tables. Row-level security, real-time subscriptions, pgvector for embeddings.

**Extraction & scraping:** Firecrawl (JS-rendered scraping), Playwright (browser automation for sources that require interaction), custom proxy rotation. Each of the 181 edge functions is a purpose-built extraction tool hand-tuned to a specific source.

**AI models (in the pipeline, not the product):**
- Claude (Anthropic) -- entity extraction, sentiment analysis, field discovery from unstructured text. Used via API in edge functions.
- OpenAI GPT-4o -- comment analysis, observation discovery, structured data extraction from messy source content.
- AI is a tool in our extraction pipeline. We use it where parsing rules break down -- e.g., extracting that a forum comment contains an ownership transfer vs. a mechanical observation. Every AI call has a hand-built prompt shaped to the specific source and data type.

**AI coding tools:**
- Claude Code (Anthropic CLI) -- primary development tool. Used extensively for building extractors, debugging pipelines, and iterating on edge functions. Multiple concurrent Claude Code sessions coordinating via shared state files.
- This product was built fighting AI, not by handing it the wheel. Claude Code is a powerful tool but every extractor required manual iteration, testing against real data, and domain-specific tuning that no AI produces correctly on the first pass.

**Infrastructure:** Supabase (hosting, auth, storage, edge functions), Vercel (frontend), Telegram Bot API (user intake and notifications), Stripe (payments), dotenvx (encrypted secrets management).

---

## SECTION 2: FOUNDERS

**1-minute YouTube video:** [FILL - unlisted YouTube link. Record if you haven't. Tips below.]

**Something impressive each founder has built or achieved:**
[FILL - THIS IS THE MOST IMPORTANT QUESTION. Examples of strong answers:]
- Built 181 purpose-built extraction tools that process 10+ auction platforms, forums, and marketplaces -- each one hand-tuned to handle how messy real-world vehicle data actually looks. Processed 758K vehicles.
- [Add personal achievements - hackathon wins, previous companies, technical feats]

**Who writes code?**
[FILL - e.g., "I (solo founder) write all the code. The platform has 181 edge functions -- each a purpose-built extraction tool I shaped to handle a specific source's quirks -- plus an Elixir/Phoenix backend and a React frontend. AI is a tool in the pipeline, not a magic button. Every extractor required understanding how each platform structures its data and iterating until the output was actually reliable."]

**How long have the founders known one another?**
[FILL - if solo, skip. If co-founders, describe.]

**Are you looking for a cofounder?**
[FILL]

---

## SECTION 3: PROGRESS

**How far along are you?**
Live product with real data. We've built 181 purpose-built extraction tools that pull structured data from 10+ sources including Bring a Trailer (132K listings), Cars & Bids, RM Sotheby's, Hagerty, Mecum, Gooding, and PCarMarket. Every source is different -- different HTML, different data shapes, different edge cases. Each extractor was meticulously built and iterated on to handle the messy reality. We've aggregated 758,738 vehicle profiles, analyzed 127,150 vehicles for sentiment and provenance signals, resolved 491,278 unique external identities (buyers, sellers, commenters) across platforms, and identified 2,295 businesses (shops, dealers, restorers).

**How long have each of you been working on this? How much of that has been full-time?**
[FILL - e.g., "12 months, full-time for the last 6 months"]

**How many active users or customers do you have?**
Pre-launch for end users. The platform currently has 5 internal users. We're focused on building comprehensive data coverage before opening to the market -- the dataset is the moat.

**Revenue (last 6 months):**
[FILL - if pre-revenue, say $0 for each month and explain in the next field]

**Anything else about revenue or growth?**
Our growth metric is data coverage, not revenue yet. In the last 3 months we've gone from 18K to 758K vehicles indexed -- 42x growth. We've extracted 627K structured observations and built AI analysis for 127K vehicles. Revenue will come from: (1) premium vehicle reports for buyers/insurers, (2) SaaS for shops and builders, (3) data licensing to auction houses and insurance companies. We're building the dataset that makes all of these possible.

---

## SECTION 4: IDEA

**Why did you pick this idea to work on?**
[FILL first sentence about personal connection -- do you collect cars? work in the industry? had a bad buying experience?]

Social media restructured how people buy and sell cars. Bring a Trailer turned auction comments into the most trusted source of vehicle knowledge. Car Instagram turned build progress into marketing. YouTube turned garage reviews into due diligence. But all of this knowledge is trapped -- unstructured, unsearchable, siloed per platform. A single BaT listing can have 300 comments containing ownership history, mechanical issues, and price context that no database captures. The $30B collector car market runs on social knowledge with zero data infrastructure underneath it. We're building that layer.

**What's new about what you're making?**
Everyone else in this space is building tools for humans to use. We're building a system where the bot is the decision-maker. The data layer (181 hand-built extraction tools, 758K vehicles, cross-platform entity resolution) gives the bot enough intelligence to identify opportunities -- which vehicles are undervalued, what work would increase their value, and what it would cost. The algorithms vet both the job (cost vs. ROI) and the worker (reliability scores from tracked history). Then the bot hires the human and manages the job.

The closest comparison is Uber, but the bot is the rider. The AI identifies the demand, prices the work, and selects the worker. The human provides the skilled labor. The only thing we can't automate is the physical workspace and the hands that do the work -- and that's the point. We're not replacing tradespeople. We're giving them a bot that finds them profitable work.

**Who are your competitors?**
- **Carfax/AutoCheck**: Mass-market VIN reports. Don't cover collector car specifics (auction history, community knowledge, provenance details). We're complementary, not competitive.
- **Classic.com**: Auction result aggregator. Shows prices but doesn't extract the rich data inside listings (comments, condition details, ownership history).
- **Hagerty Valuation Tools**: Insurance-focused valuations. Good for ballpark pricing, but no per-vehicle provenance.
- **Manual research**: The real competitor. Dealers and serious buyers spend hours per vehicle searching forums and auction archives. We replace that with structured data.

What we understand that they don't: social media already replaced traditional data sources for collector cars. Nobody checks Carfax for a 1973 911 -- they read the BaT comments. The data layer shifted to social platforms, but nobody built the infrastructure to make that data structured, searchable, and trustworthy. We did.

**How do or will you make money?**
The system identifies undervalued vehicles, calculates the ROI of specific repairs/restoration work, and hires vetted tradespeople to do the job. We take a margin on the work and on the resulting value increase.

1. **Job margin**: Bot identifies a vehicle where $3K in mechanical work creates $12K in value. We hire the tradesperson, manage the job, and take a cut of the spread.
2. **Tradesperson marketplace**: Vetted workers matched to jobs based on reliability scores built from their tracked history. We charge placement fees and ongoing platform fees.
3. **Data licensing/reports**: The structured data layer underneath (758K vehicles, cost/ROI models, tradesperson reliability scores) is valuable to insurers, auction houses, and lenders.

TAM: $30B collector car market as beachhead. The broader opportunity is every hands-on trade where AI can identify the economic opportunity but needs a human to execute. Auto repair, restoration, custom builds -- and eventually beyond vehicles.

**How do users find your product?**
[FILL - your current plan. Suggested answers:]
- SEO: Vehicle-specific pages rank for "[year] [make] [model] for sale" and VIN searches
- Auction community: Share insights from our data on BaT, Rennlist, and other forums
- Shop partnerships: Onboard restoration shops who bring their clients
- Word of mouth: Collector car community is tight-knit

---

## SECTION 5: EQUITY / LEGAL / FINANCIALS

**Have you formed a legal entity?**
[FILL]

**Equity breakdown:**
[FILL]

**Have you taken any investment?**
[FILL]

**How much do you spend per month?**
[FILL - include hosting (Supabase, Vercel), API costs (OpenAI, Firecrawl, Claude), domains, etc.]

**How much money in the bank?**
[FILL]

**Runway:**
[FILL]

---

## SECTION 6: WILDCARDS

**Other ideas you considered:**
- Fractional ownership marketplace for collector cars (decided data infrastructure is the prerequisite layer -- you need structured data before you can financialize anything)
- Expanding the same data layer to other niche hands-on professions: watches, boats, motorcycles, vintage audio, custom fabrication -- any field where expertise lives in forums and social media, not databases
- AI-powered vehicle valuation tool (building this on top of the data layer)

**Anything else we should know?**
The data layer (181 purpose-built extraction tools, 300+ database tables, cross-platform entity resolution) is what makes the bot smart enough to hire humans. Every extractor was a fight -- each source structures data differently, breaks in different ways, and has edge cases that only show up at scale. On top of that, we've built cost/ROI algorithms that vet jobs and reliability scoring that vets workers. The moat is three layers deep: the data (hard to replicate), the algorithms (trained on real job outcomes), and the vetted worker network (trust built over time). Our only bottleneck is physical workspace -- and that's a solvable problem.

**Tell us about the time you most successfully hacked some (non-computer) system to your advantage:**
[FILL - personal story. YC loves resourcefulness and unconventional thinking. Think about a time you found a clever shortcut or exploited a loophole.]

**Tell us something surprising or amusing that one of you has discovered:**
[FILL - could be from the data itself, e.g.:]
Suggested: "While building our extraction pipeline, we discovered that Bring a Trailer auction comments contain more reliable vehicle history than any official database. A single listing can have 200+ comments from previous owners, mechanics, and marque experts, essentially crowdsourcing provenance verification. The most valuable car data in the world is buried in comment sections."

---

## VIDEO TIPS (if you still need to record)

The 1-minute video statistically increases your interview chances. Keep it simple:

1. **0-10s**: "I'm [name], founder of Nuke. We're building the data layer for niche hands-on professions, starting with collector vehicles."
2. **10-30s**: "These industries run on knowledge trapped in social media and word of mouth. The people who have it -- mechanics, builders, collectors -- aren't going to fill out forms. And the platforms that host it don't structure it."
3. **30-50s**: "So we built the simplest possible data pipeline. Submit text -- a description, a link, a note -- and our system does all the sorting. On the backend, 181 hand-built extraction tools pull from 10+ platforms. We've processed 758K vehicles. This generalizes to any niche profession where knowledge lives in community, not databases."
4. **50-60s**: "Vehicles are our beachhead -- $30B market, zero data infrastructure. We're applying to YC to scale this."

Record on your phone, upload as unlisted to YouTube. Don't overthink production quality -- YC cares about clarity and conviction, not polish.
