# Nuke — X Content for Investor Traction

Live stats as of 2026-02-26:
- 1.25M vehicles tracked
- 33M vehicle images indexed
- 11.6M auction comments processed
- 513K AI valuation estimates (6.3% median error)
- 127K vehicles with full sentiment AI analysis
- 508K identities across the ecosystem
- 3,987 organizations (dealers, auction houses, shops)
- 388 edge functions (microservices)
- $4.8B annual collector vehicle transaction market

---

## SERIES 1 — The Market Framing
*Goal: establish the problem/opportunity. Hook investors and car people.*

---

### Post 1A — The Gap

> There are 43 million collector and store-of-value vehicles in the US.
>
> Combined they represent over $1 trillion in asset value.
>
> There is no system of record for any of them.
>
> Not one. Every title, auction result, forum post, service record, and bid history lives in siloed, disconnected databases — or nowhere at all.
>
> Real estate has MLS. Public equities have Bloomberg. Collector vehicles have... Excel and vibes.
>
> We're fixing that.

---

### Post 1B — The Contrast (short)

> Real estate: MLS, Zillow, clean comps, mortgage market, REIT structures.
>
> Public equities: Bloomberg terminal, SEC filings, 200 years of price history.
>
> Collector vehicles ($1T asset class): spreadsheets and auction house PDFs.
>
> The data layer doesn't exist yet. That's the opportunity.

---

### Post 1C — The Provenance Problem

> A 1973 Porsche 911 RS sells for $1.2M at auction.
>
> A nearly identical 1973 911 RS — same spec, same color — sells for $650K three months later.
>
> Why? Provenance. Race history. Previous owners. A forum thread from 2009 where an expert flagged a replacement door.
>
> That data exists. It's scattered across 40 different sources.
>
> We built the pipeline to collect it, structure it, and score it.
>
> Nuke is provenance infrastructure.

---

## SERIES 2 — The Data (Specific, Verifiable)
*Goal: prove the thesis with real numbers. Technical investors and car people both respond to this.*

---

### Post 2A — The Core Stat

> We analyzed community sentiment on 127,000 collector vehicle auction listings.
>
> Then we matched sentiment scores to sale prices.
>
> The result:
>
> Very negative sentiment → median sale $13,250
> Negative → $15,911
> Neutral → $16,500
> Positive → $20,000
> Very positive → $25,000
>
> Vehicles with strong community approval sell for nearly 2x the price of negatively-perceived vehicles.
>
> This correlation doesn't exist in any other dataset. We built it.

---

### Post 2B — Scale

> What Nuke has indexed as of today:
>
> 1,253,307 vehicles
> 32,939,500 vehicle images
> 11,649,195 auction comments
> 513,483 AI valuation estimates
> 127,052 full sentiment analyses
> 508,557 identities across the ecosystem
> 3,987 registered businesses
>
> One founder. Zero outside engineering headcount.
>
> The pipeline runs itself.

---

### Post 2C — The Velocity Story

> Dec 2025: 9,697 vehicles added to Nuke.
>
> Jan 2026: 196,417.
>
> Feb 1-8: 561,994.
>
> That's not a team scaling up. That's an autonomous pipeline hitting its stride.
>
> We built the extraction architecture in Dec. By Feb it was running at 20x the January rate with no additional infrastructure spend.
>
> Autonomous data acquisition is the moat.

---

## SERIES 3 — The Tech (Build-in-Public)
*Goal: attract developer credibility and technical investors. Show this is real.*

---

### Post 3A — YONO

> We index 33 million vehicle images.
>
> Running them through cloud vision APIs (GPT-4V, Claude) at $0.001–0.004/image = $33,000–$130,000. Per pass. For one analysis type.
>
> So we built our own.
>
> YONO (You Only Nuke Once) — EfficientNet-B0 backbone trained on our own labeled vehicle data. Purpose-built for condition grading, panel analysis, and spec identification.
>
> Inference: 4ms/image. Cost: $0.
>
> The cloud bill for 33M images: $0.
>
> That's the difference between a feature and a moat.

---

### Post 3B — The Architecture

> Nuke runs on 388 edge functions.
>
> Each one does one thing: extract a listing, decode a VIN, analyze an image, score sentiment, route a queue item.
>
> No monolith. No single point of failure. Each function deploys independently, fails independently, scales independently.
>
> When BaT blocks a scraper, the function retries with a different approach. When a new auction platform launches, we add one function.
>
> The pipeline is the product.

---

### Post 3C — The Observation System

> Every data point in Nuke is an immutable observation.
>
> Source. Timestamp. Confidence score (0.0–1.0). Full provenance chain.
>
> When a forum post from 2018 says a car had accident damage, and a 2024 auction listing contradicts it, we don't pick one. We store both, weighted by source trust, timestamped, linked.
>
> When three independent sources confirm the same fact, confidence compounds.
>
> Data never overwrites. It only supersedes, with full audit trail.
>
> This is how financial data works. No one applied it to vehicles before.

---

### Post 3D — Ralph Wiggum (the autonomous coordinator)

> Our extraction pipeline is coordinated by an AI we call Ralph Wiggum.
>
> Ralph monitors queue health, detects failing domains, triages errors, and decides what to extract next — continuously, 24/7.
>
> He's not perfect. But he doesn't take vacation either.
>
> The name is intentional. He says things that shouldn't make sense and somehow they do.

---

## SERIES 4 — The Business Model
*Goal: investors need to see how money gets made.*

---

### Post 4A — We Earn When the Ecosystem Earns

> Nuke doesn't compete with Hagerty, BaT, or the auction houses.
>
> We integrate with all of them.
>
> Hagerty needs better valuation data → we license it.
> BaT needs qualified leads → we send them, on commission.
> Dealers need inventory intelligence → API subscription.
> Lenders need collateral values → data licensing.
>
> Every transaction in the collector car market is a Nuke event.
>
> We earn when the ecosystem earns.

---

### Post 4B — The Raise

> Nuke is raising $2M on a post-money SAFE at an $18M valuation cap.
>
> What that funds:
> → Co-founder/CTO search (40%)
> → Infrastructure scaling (20%)
> → Regulatory & legal for the derivative market (15%)
> → Revenue launch (15%)
> → Operations (10%)
>
> The platform is built and running. This round is about distribution and legal structure.
>
> Clean cap table. 100% founder. $0 debt. No prior rounds.
>
> DM if you're interested. nuke.ag/offering for the full data room.

---

## SERIES 5 — The Solo Founder Angle
*Goal: authenticity + credibility. Technical founders building in public attract early believers.*

---

### Post 5A — One Person

> I built Nuke alone.
>
> 388 edge functions. A 300+ table database. A proprietary ML model. An autonomous extraction pipeline. A TypeScript SDK. An investor data room with live stats.
>
> I'm not saying this to flex. I'm saying it because the architecture had to be right from day one — there was no team to absorb a bad design decision.
>
> When you have to maintain everything yourself, you build systems that run themselves.
>
> That's the product.

---

### Post 5B — Why Vehicles

> I've always believed collector vehicles are underrated as an asset class.
>
> Tangible. Scarce. Emotionally resonant. Globally traded. $1T in the US alone.
>
> But the data infrastructure is 30 years behind equities and real estate.
>
> That gap felt like a product to me. So I built it.

---

## THREADS — Long-Form

### Thread: The Sentiment Study (data-forward, shareable)

> 1/ We ran AI sentiment analysis on 127,000 collector vehicle auction listings and matched scores to final sale prices.
>
> Here's what we found — and why it matters for anyone buying or selling a collector car.
>
> 🧵
>
> 2/ The data: 127K vehicles, sourced primarily from Bring a Trailer — the largest enthusiast auction platform in the US, with community comment threads on every listing.
>
> We classified each comment as positive, negative, or neutral. We scored each listing 0.0–1.0.
>
> 3/ The result by sentiment bucket:
>
> Very negative (<0.2) → median sale $13,250
> Negative (0.2–0.4) → $15,911
> Neutral (0.4–0.6) → $16,500
> Positive (0.6–0.8) → $20,000
> Very positive (0.8+) → $25,000
>
> 4/ That's not a small delta. A car that the community loves sells for nearly 2x a car they're skeptical of — even controlling for make and model.
>
> The community knows things the listing doesn't say. Accident history. Questionable restorations. Provenance gaps.
>
> 5/ This intelligence doesn't exist in any pricing guide. Hagerty doesn't have it. NADA doesn't have it. Black Book doesn't have it.
>
> It exists in comment threads, forum posts, and auction bid patterns — unstructured, scattered, unindexed.
>
> 6/ We built the pipeline to collect it, structure it, and score it at scale.
>
> 1.25M vehicles. 33M images. 11.6M comments. 513K valuation estimates.
>
> This is what a data layer for the collector vehicle market looks like.
>
> nuke.ag

---

### Thread: YONO (technical, build-in-public)

> 1/ We have 33 million vehicle images.
>
> I needed to classify all of them for condition, panel damage, spec indicators, and angle.
>
> Here's how I built a local ML model to do it for $0/image.
>
> 🧵
>
> 2/ The naive approach: send every image to GPT-4V or Claude Vision.
>
> Cost at $0.001/image: $33,000 per pass.
> Cost at $0.004/image: $130,000 per pass.
> And we'd want to run multiple analysis types.
>
> That math doesn't work for a pipeline. Ever.
>
> 3/ So we built YONO — You Only Nuke Once.
>
> EfficientNet-B0 backbone (33M params, small enough to run on CPU).
> 5 structured training phases on labeled vehicle data.
> Purpose-built for: condition grading, panel analysis, spec identification, image angle.
>
> 4/ Training data: our own labeled vehicle images, plus augmentation.
> Inference: 4ms/image on CPU.
> Cost per image: $0.
> Accuracy on held-out test set: improving with each phase.
>
> 5/ YONO is exported to ONNX — runs anywhere. No GPU required. No cloud dependency.
>
> FastAPI sidecar next, then edge function integration, then the SDK method: nuke.vision.analyze(photoUrl)
>
> 6/ The goal: every vehicle on Nuke gets vision analysis. Condition score. Panel-by-panel damage map. Spec identification from photos alone.
>
> That's a data layer no one else has.
>
> That's what we're building.

---

## POSTING CADENCE SUGGESTION

Week 1: Post 1A, Post 2B, Post 3A (YONO)
Week 2: Thread: Sentiment Study, Post 5A (solo founder), Post 4A
Week 3: Post 3C (observation system), Post 2C (velocity), Post 1C (provenance)
Week 4: Post 3D (Ralph), Thread: YONO, Post 4B (the raise)

**General rules:**
- Post between 8-10am PT or 12-2pm PT for automotive/tech audience
- Reply to collector car accounts and automotive investors — don't just broadcast
- Tag relevant accounts when appropriate: @BringATrailer, @HagertyMedia, @CarsAndBids
- Repost from @nuke_ag personal account to amplify
- Every post that references data should link to nuke.ag or nuke.ag/offering

---

*Updated: 2026-02-26*
