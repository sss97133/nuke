# The Supply Side

## Why Nothing Gets Built, and What the Alternator Proved

---

> "The system can tell you everything about what's on the truck. It can tell you nothing about what should be."
> — Session 2026-03-31, the alternator conversation

---

## Abstract

The Nuke knowledge graph models the vehicle with extraordinary depth — identity, provenance, condition, specification, market position. It is a comprehensive model of **what IS**. But it has no model of **what COULD BE**: what parts exist, who makes them, what they cost, whether they fit, and whether the vehicle needs them. This gap — the absent supply side of the graph — is why the system can diagnose a 63-amp alternator on a truck that draws 80 amps, but cannot tell you what to replace it with. This essay argues that the supply side is the missing half of the knowledge graph, that its absence is the reason "real product doesn't take hold," and that its architecture follows naturally from the patterns already established.

---

## I. The Alternator Proof

On March 31, 2026, the user asked: "find the best alternator for the 1983 GMC K2500."

What followed was a 20-minute research session across six web searches, four page fetches, and three specialist manufacturer websites. The process:

1. Identify the factory alternator (Delco 10SI, 63A)
2. Calculate the truck's electrical load (QTP cutouts, lights, fan — ~80A peak)
3. Discover that the factory unit can't sustain the truck's own accessories at idle
4. Research upgrade paths (12SI, CS130, CS144, AD244)
5. Find specialist manufacturers (Singer, Brand X, JS Alternators, Mechman, Powermaster)
6. Compare them on output, idle performance, build quality, warranty, price
7. Make a recommendation (CS130 140A from Powermaster for practical, Singer for premium)
8. Explain the value proposition so the customer can be sold

This research produced genuine value. It also took 20 minutes and cannot be reused. The next time someone asks about an alternator for any square body Chevy, the entire process repeats from scratch. The knowledge evaporated the moment the conversation ended.

The user's reaction was immediate: "this is where a reasonably competent UI would be incredible — we could complete the sell." And then: "for me that means we have the suppliers in our DB, we are scraping and parsing their data, so we can have quicker results."

This is the supply side. And its absence is the reason the system produces insights but not transactions.

---

## II. The Two Halves of a Knowledge Graph

### The Demand Side (What IS)

This is what Nuke already models:

```
VEHICLE ──> has factory spec (10SI alternator, 63A)
        ──> has installed components (QTP cutouts, electric fan)
        ──> has electrical load (computed: ~80A peak)
        ──> has gap (load > capacity = deficit)
```

The demand side answers: what does this specific vehicle, in its current configuration, need?

### The Supply Side (What COULD BE)

This is what Nuke does not model:

```
SUPPLIERS ──> sell parts (alternators, 94A-540A)
          ──> with fitment (year/make/model/engine)
          ──> at prices ($50-600)
          ──> with specs (idle output, warranty, build quality)
          ──> from sources (catalog vs. bespoke)
```

The supply side answers: what exists in the world that could satisfy this vehicle's need?

### The Resolution (What SHOULD BE)

The magic is in the join:

```
VEHICLE DEFICIT (alternator: 63A factory, 80A demand)
    × SUPPLY CATALOG (CS130 140A $250, Singer 200A $500, JS 250A $399)
    = RESOLUTION OPTIONS ranked by value, fit, and quality
```

This computation is trivial. The data model for it is simple. The reason it doesn't exist is not technical — it's that the supply side of the graph has never been populated.

---

## III. Why Nothing Takes Hold

The user observed: "we seem to be able to get things going but real product doesn't seem to take hold." This deserves a direct answer.

### The Pattern

A conversation produces insight. The insight is genuine. But it lives only in the conversation. No data is written. No structure is created. No computation becomes possible that wasn't possible before. The next conversation starts from zero.

This is the difference between **analysis** and **infrastructure**. Analysis answers one question once. Infrastructure answers a class of questions forever.

The alternator conversation was analysis. Twenty minutes of research to answer one question for one truck. The supply side of the knowledge graph would be infrastructure. A few hours of scraping and modeling to answer every parts question for every truck, permanently.

### Why It Keeps Happening

Three forces conspire:

1. **Conversations feel productive.** The alternator analysis WAS useful. It produced a recommendation. It informed a purchase decision. The user feels served. But nothing was built.

2. **Infrastructure feels abstract.** "Model the supply side of the knowledge graph" sounds like architecture astronautics. "What alternator should I buy" sounds like a real problem. The concrete question always wins attention over the structural solution.

3. **The gap between research and product is one step.** The research is already 90% of the work. Scraping JS Alternators' product page, parsing the fitment data, storing it in a table, connecting it to the vehicle spec — that's one session of work. But it never happens because the research already answered the immediate question, so there's no felt urgency to systematize it.

### The Remedy

The remedy is to recognize that **every research conversation is a failed product opportunity**. When a conversation produces insight through manual research, the question is not "did we get the answer?" but "will we have to do this again?" If the answer is yes — and for parts questions it is always yes — then the conversation was a prototype for a feature that should exist in the system.

The alternator conversation was a prototype for the supply side. The Granholm build tracking conversation was a prototype for the parts inventory layer. Every time an agent does manual research that could have been a query, the system has failed to capture knowledge that it demonstrated it could acquire.

---

## IV. The Supply Side is Testimony Too

The supply side is not a product catalog. It is testimony, subject to the same epistemological framework as every other data source in Nuke.

A manufacturer's listed price is **market testimony** with a half-life of weeks to months. Prices change, promotions come and go, products are discontinued.

A fitment claim ("fits 1969-1986 K2500 5.7L") is **specification testimony** from the manufacturer — relatively permanent but not infallible. Manufacturers sometimes list incorrect fitment. Forum threads are full of "it says it fits but the bolt pattern is wrong."

An amp rating ("250A peak") is **specification testimony** with no half-life if measured correctly, but the real-world output at idle (the number that actually matters) may differ from the rated peak by 40-50%. The gap between rated and realized is itself a category of knowledge worth modeling.

A product review ("DOA out of the box, second replacement also DOA") is **community testimony** — exactly analogous to auction comments. It carries the same trust dynamics: anonymous reviewers have low base trust, reviewers with verified purchases have higher trust, patterns across many reviews establish consensus.

The existing observation system, trust framework, and half-life model apply without modification. The supply side is not a new kind of data — it is an existing kind of data (testimony from sources with varying authority, at specific moments, subject to decay) applied to a new domain (what the market offers rather than what the vehicle is).

---

## V. The Shape of the Supply Side

### What It Is Not

It is not a parts store. Nuke does not sell parts. It does not take orders. It does not hold inventory. It is not competing with Summit Racing or Amazon.

It is not a price comparison engine. It does not aggregate prices across retailers for the cheapest deal on a specific SKU. That is a commodity service.

### What It Is

It is a **decoder ring for the parts market**, exactly as the reference library is a decoder ring for vehicle data. It answers: for this specific vehicle, in this specific configuration, with this specific gap — what exists, who makes it, is it any good, and what does it cost?

The decoder ring metaphor is precise. The reference library does not contain every fact about every vehicle. It contains the patterns and relationships that let the system interpret raw data. The supply side does not contain every part from every vendor. It contains the knowledge structure that lets the system match a vehicle's needs to the market's offerings.

### Supplier Types

The supply side must distinguish between two fundamentally different supplier types:

**Catalog suppliers** have inventoried products with SKUs, prices, and fitment data that can be scraped and stored. Summit Racing, JS Alternators, Amazon, DB Electrical. Their data is structured, scrapable, and updatable.

**Bespoke builders** do not have catalogs. They have capabilities. Singer Alternators doesn't list "Part #X for 1983 K2500" — Mike Singer answers the phone, asks about your setup, and builds one. Brand X offers custom billet colors and external regulators configured to your specs. Their "product" is a conversation followed by a custom build.

Both are valuable. Both belong in the supply side. But they are modeled differently:

- Catalog supplier → product rows with SKUs, prices, fitment, specs
- Bespoke builder → capability profile (output range, vehicle coverage, lead time, price range, specialty)

The computation adjusts accordingly. For catalog suppliers, the system can say "JS Alternators has a 250A unit for your truck at $399." For bespoke builders, the system says "Singer Alternators can build a custom 200-320A unit for ~$400-600, lead time 2-3 weeks, call Mike."

---

## VI. The Computation

The supply side enables a new computation on the vehicle profile: **gap diagnosis with resolution**.

```
FOR each component system (electrical, brakes, exhaust, suspension, cooling):
  1. COMPUTE current state from observations
     (factory spec + installed modifications + computed loads)
  2. COMPUTE adequacy
     (does current capacity meet current demand?)
  3. IF deficit:
     a. QUERY supply catalog WHERE fitment matches vehicle
     b. FILTER by output >= computed demand
     c. RANK by value (price / capability / warranty / builder reputation)
     d. PRESENT as resolution options on the vehicle profile
```

This is not AI. This is a database join with a sort. The intelligence is in the data model and the scraping — the computation itself is trivial.

### The UI Surface

The vehicle profile gains a new widget type: **the diagnostic panel**. It appears only when data supports it (progressive density). It shows:

- **Current state**: what's installed, its specs, its adequacy
- **Gap**: where current capacity falls short of demand (if anywhere)
- **Options**: ranked resolution choices with source, price, specs, warranty
- **Action**: one click to add the selected part to a work order line item

The diagnostic panel is the computation surface concept applied to the supply side. It computes in real time from the vehicle's current state (demand side) crossed with the parts catalog (supply side). No cache. No pre-computation. Just a function from graph state to rendered intelligence.

---

## VII. The Pattern Is Universal

The alternator is one instance. The pattern is universal across every component system:

| System | Factory Spec | Current Load | Gap? | Supply Side Needed |
|--------|-------------|-------------|------|-------------------|
| Electrical | 10SI 63A | 80A (cutouts + fan) | YES | Alternator catalog |
| Brakes | Drum rear | Disc conversion desired | YES | Brake kit catalog |
| Exhaust | Single exhaust | Custom dual 2.5" desired | MAYBE | Exhaust component catalog |
| Suspension | Stock springs | Bilstein 5100s installed | NO | (resolved) |
| Cooling | Stock radiator | Stock fans | UNKNOWN | Radiator/fan catalog |

For every row where the gap is YES or UNKNOWN, the supply side turns a diagnosis into a transaction. Without it, the diagnosis is a conversation. With it, the diagnosis is a product.

---

## VIII. The Lesson

The system has spent 141 days building a comprehensive model of what vehicles ARE. It has spent zero days building a model of what vehicles NEED or what the market OFFERS to satisfy those needs. This is why conversations produce insights but not products. The system can diagnose but cannot prescribe. It can identify gaps but cannot present resolutions.

The supply side is not a new feature. It is the completion of the knowledge graph. The vehicle has a demand side (what it is, what it needs) and a supply side (what exists to serve those needs). The system models the first with extraordinary depth. The second does not exist.

Building it is not hard. It is:
- A supplier registry (dozens of rows)
- A parts catalog (scraped from vendor websites, thousands of rows)
- A fitment mapping (connecting parts to vehicles, thousands of rows)
- A gap computation (a SQL join)
- A UI panel (a React component)

The hard part is not the engineering. The hard part is recognizing that every manual research conversation is evidence of a missing product feature, and then actually building the feature instead of just answering the question.

---

## IX. The Rule

> **Every time an agent manually researches something that could have been a query, the system has failed.** The research is a prototype. Build the product.

This is the supply side principle. It applies beyond parts:

- Manual research on comparable sales → the market intelligence layer should answer this
- Manual research on shop rates → the labor rate database should answer this
- Manual research on VIN decoding → the decoder ring should answer this
- Manual research on parts availability → the supply side should answer this

The system should get smarter with every conversation, not just serve one question and forget.

---

*This contemplation establishes the philosophical case for the supply side of the knowledge graph. The accompanying playbook (`docs/playbooks/SUPPLIER_INTELLIGENCE_PIPELINE.md`) provides the operational guide. The technical plan (`docs/library/technical/engineering-manual/11-supply-side.md`) provides the implementation specification.*
