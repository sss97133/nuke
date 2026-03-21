# Testimony and Half-Lives

## The Epistemology of Data in the Nuke Provenance Engine

---

> "The only truth at the end of the day is the sale price."
> — Skylar, December 2025

---

## Abstract

Traditional databases treat all data as equally current. A record is either present or absent, true or false, valid or deleted. This binary epistemology is adequate for transactional systems — bank balances, inventory counts, user profiles — where the present state is the only state that matters. It is catastrophically inadequate for systems that model physical-world assets, where data is not fact but testimony: claims made by sources with varying reliability, at specific moments in time, which decay in value at rates determined by the nature of the claim and the authority of the claimant. This essay develops the concept of "testimony with half-lives" — the philosophical foundation for Nuke's approach to data — and explores its implications for database architecture, source weighting, and the nature of knowledge itself.

---

## I. The Problem with Data-as-Fact

Consider a simple claim: "This 1972 Chevrolet Blazer is in excellent condition."

In a traditional database, this claim is stored as a field value: `condition = 'excellent'`. It occupies a column. It has no timestamp beyond `updated_at`. It has no source attribution. It has no confidence interval. It has no expiration date.

What this representation conceals:

- **Who said it?** A seller listing the vehicle has a financial incentive to overstate condition. A concours judge has institutional credibility but may be rating against a specific standard. A prospective buyer has a financial incentive to understate condition. A forum member has no financial stake but may lack expertise. Each source transforms the meaning of "excellent."

- **When was it said?** A condition assessment from 2020 describes the vehicle as it existed in 2020. By 2026, six years of aging, possible use, possible storage, possible degradation have occurred. The assessment does not describe the vehicle now — it describes the vehicle then. But the database stores it as a current attribute.

- **On what basis?** A visual inspection from photographs captures surface condition but misses mechanical state. A physical inspection captures both but only the aspects the inspector chose to examine. A concours judging applies a formal rubric with specific deductions. A seller's claim may be based on nothing more than optimism. The epistemic basis of the claim determines its scope, but the database stores no scope.

- **How much of it is still true?** The exterior paint assessed as "excellent" in 2020 may still be excellent in 2026 if the vehicle was garaged. Or it may have faded, cracked, or been repainted. The engine assessed as "strong" may have sat without running for four years. The tires assessed as "good" are now six years older and may be dry-rotted regardless of tread depth. Different components of the same assessment decay at different rates.

The traditional database does not merely fail to capture these nuances. It actively conceals them by presenting all data in the same format — a field value in a column — regardless of its epistemic status. The condition assessment from a concours judge in 2020 looks identical to a seller's offhand remark in 2024. Both occupy the same column. Both are equally "current." Both are equally "true."

This is not a design flaw that can be fixed by adding metadata fields. It is a philosophical error at the foundation — a confusion between data and testimony.

---

## II. Data as Testimony

The distinction is not semantic. It is structural.

**Data** is a record of a state. It is produced by measurement, is deterministic, and is either accurate or erroneous. The temperature at noon is 72 degrees. The account balance is $4,200. The package was delivered at 3:47 PM. These are data points. They have no half-life. They do not decay. They are facts about moments.

**Testimony** is a claim by a source about a state. It is produced by observation (which is selective), interpretation (which is subjective), and communication (which is lossy). Testimony carries the biases, limitations, and temporal context of its source. It is not true or false — it is more or less reliable, more or less current, more or less complete.

Nearly everything in the physical-asset domain is testimony, not data. Consider what enters Nuke's system:

- **A BaT listing description** is seller testimony. The seller describes what they believe to be true about the vehicle, filtered through their knowledge, their incentives, and their communication ability.

- **An auction comment** is community testimony. A commenter claims to recognize the engine as matching numbers, or spots rust under the fender in photo 47, or declares the reserve too high. Each claim carries the commenter's expertise (or lack thereof) and agenda (or lack thereof).

- **A photograph** is mechanical testimony. The camera records what was in front of it, but it records what the photographer chose to show (framing), under conditions the photographer chose or tolerated (lighting), at a resolution that may or may not capture the relevant detail. A photograph of a "clean" engine bay may conceal an oil leak that would be visible from a different angle.

- **A VIN decode** is something closer to data — a factual record from the manufacturer about what the vehicle was when it left the factory. But even this carries caveats: the decode reveals the factory specification, not the current state. A VIN that decodes to "L48 350" does not mean the vehicle currently has an L48 350. The engine may have been swapped. The VIN decode is permanent testimony about factory intent, not current testimony about current state.

- **An auction result** is the closest thing to pure data in the asset domain — a price was reached, the hammer fell, the transaction occurred. But even the auction result is testimony of a kind: it testifies to what one buyer was willing to pay in one moment under specific conditions (auction house reputation, competing lots, economic environment, emotional state of the bidroom). It does not testify to "value" in any abstract sense. It testifies to "price at this moment under these conditions."

The system that treats all of these as equivalent records in a database commits epistemic violence. It strips the testimony of its source, its moment, its scope, and its limitations. It presents a seller's optimism and a concours judge's assessment in the same column. It presents a 2020 inspection and a 2026 listing in the same format. It makes all testimony equally current by making all testimony equally timeless.

---

## III. The Half-Life Concept

Radioactive decay provides the metaphor. A radioactive isotope has a half-life — the time after which half of its atoms have decayed. After one half-life, 50% remains. After two, 25%. After three, 12.5%. The decay is predictable in aggregate but random in particular — you cannot say which atom will decay, only that half of them will.

Testimony about physical assets decays analogously. The rate of decay depends on the nature of the claim:

### Permanent Testimony (No Decay)

Some claims never lose their informational value:

- **VIN stamped in metal.** The vehicle was built with this identity. This is permanent regardless of subsequent modifications.
- **Signature on a painting.** The artist signed it. This remains true regardless of what happens to the painting after.
- **Lot number in an auction.** The item was offered as lot 47 in the November 2008 sale. This is a historical fact.
- **A published catalogue raisonne entry.** The work was catalogued by the acknowledged authority. The entry persists in print.

Permanent testimony is characterized by physical inscription (stamps, engravings, signatures) or institutional publication (catalogs, certificates, auction records). Once created, it cannot be uncreated. Its informational value does not diminish because the claim it makes is about an immutable fact — identity, authorship, a specific historical event.

### Long Half-Life Testimony (Years to Decades)

Some claims remain informative for extended periods but gradually lose currency:

- **A professional inspection report.** A thorough mechanical inspection by a qualified shop has a half-life of 3-5 years for a vehicle in regular use, longer for a garaged vehicle, shorter for a driven one. The engine compression tested at 170 PSI per cylinder in 2020 is probably still close in 2023 if the vehicle has been maintained. By 2030 it is a historical footnote.

- **A condition assessment from a reputable source.** A concours judge's score from 2022 has a half-life of perhaps 5-7 years for a garaged show car. The overall structural integrity does not change rapidly. But specific elements — chrome, leather, rubber seals, paint — degrade at different rates depending on storage conditions.

- **An appraisal for insurance.** The value assessment reflects market conditions at the time of appraisal. These conditions shift: markets boom and crash, collector tastes evolve, comparable sales establish new ranges. A 5-year-old appraisal is evidence of historical value, not current value. But it is evidence — it establishes a data point in the price trajectory.

### Medium Half-Life Testimony (Months to Years)

Some claims become stale relatively quickly:

- **A seller's listing description.** The vehicle is described as it appeared when the listing was created. If the listing is six months old, the tires may be flatter, the battery may be dead, the mice may have moved in. Listing descriptions have a half-life of 3-6 months for items not in climate-controlled storage.

- **An auction estimate.** The house's pre-sale estimate reflects the specialist's assessment of the market at the time the catalog was prepared — typically 2-4 months before the sale. The market can move significantly in that window. Auction estimates have a half-life of roughly 6 months as market indicators.

- **Forum consensus on value.** A thread from last year declaring "K5 Blazers are overpriced" reflects community sentiment at that moment. Sentiment shifts. New comparables land. A celebrity purchase changes the narrative. Forum consensus has a half-life of 3-12 months depending on market volatility.

### Short Half-Life Testimony (Days to Weeks)

Some claims are practically ephemeral:

- **A Facebook Marketplace listing price.** This is what the seller is asking today. It may change tomorrow. It carries almost no information about actual value — it testifies to the seller's aspirations, nothing more. Half-life: 1-4 weeks.

- **Social media sentiment.** An Instagram post generating excitement about a car or artwork reflects a momentary convergence of attention. It has a half-life of days before the algorithm pushes something else into view.

- **A dealer's verbal estimate.** Spoken at a car show, a dinner, a phone call. Based on the dealer's current inventory needs, recent sales, and mood. Half-life: weeks at most.

---

## IV. The Architecture of Decay

How does a system model testimony with half-lives? Not by deleting old data — old data is the most valuable kind. The provenance chain IS the accumulation of historical testimony. A 1920 gallery invoice for a Picasso painting is more valuable today than it was in 1920, because it establishes a provenance link that authenticates the work across a century.

The system models decay through **confidence weighting that is a function of time, source authority, and claim category.**

### The Formula

For any observation (testimony), the system computes:

```
current_weight = base_trust_score * source_authority * recency_factor * corroboration_factor
```

Where:

- **base_trust_score** is the trust weight of the source type (tier 1 museum = 0.95, tier 10 anonymous = 0.20)
- **source_authority** is the specific source's track record within its type
- **recency_factor** is a decay function specific to the claim category:
  - Permanent claims: recency_factor = 1.0 (always)
  - Long half-life: recency_factor = 0.5^(years / half_life_years)
  - Medium half-life: recency_factor = 0.5^(months / half_life_months)
  - Short half-life: recency_factor = 0.5^(weeks / half_life_weeks)
- **corroboration_factor** increases the weight when multiple independent sources make the same claim

### What This Means Practically

A condition report from a respected shop (base_trust 0.85) issued 3 years ago (half-life 5 years, recency_factor = 0.66) carries a current weight of 0.56. This is significantly less than the same shop's report issued last month (recency_factor = 0.98, current weight = 0.83), but significantly more than a forum commenter's speculation (base_trust 0.45) from yesterday (recency_factor = 0.99, current weight = 0.45).

The math makes explicit what experts know intuitively: a good source's old testimony is worth more than a poor source's new testimony. The system does not chase recency at the expense of authority. It integrates both through a single framework.

### Corroboration and Contradiction

When multiple independent sources make the same claim, the claim's effective trust increases. Two independent auction results for similar vehicles at similar prices are stronger evidence of market value than either alone. A seller's claim of "matching numbers" corroborated by a PPI report is stronger than either claim in isolation.

When sources contradict, the system does not arbitrate. It presents both claims with their respective weights and flags the contradiction. A seller claiming "no rust" contradicted by a buyer's post-purchase inspection noting "extensive rocker rust" creates a tension that the system surfaces rather than resolves. The resolution requires human judgment — but the system ensures the human sees both sides.

---

## V. Categories of Testimony in the Asset Domain

### Identity Testimony

Claims about what the asset fundamentally is:

- **Year/Make/Model/VIN** (permanent, from factory records)
- **Artist/Title/Date/Medium** (permanent, from catalogue raisonne or artist records)
- **Edition number** (permanent, from publisher/foundry)
- **Serial number** (permanent, from manufacturer)

Identity testimony has no half-life. Once established by an authoritative source, it does not decay. But it can be contested — a VIN plate can be swapped, a painting can be misattributed, a serial number can be re-stamped. Contested identity is not decayed identity — it is contradicted identity, handled through the corroboration/contradiction mechanism.

### Specification Testimony

Claims about what the asset was supposed to be:

- **Build sheet** (permanent, from factory)
- **Window sticker/Monroney** (permanent, from factory)
- **Certificate of authenticity** (permanent, from issuing authority)
- **Factory specification records** (permanent, from manufacturer archives)

Specification testimony has no half-life but has a crucial limitation: it describes intent, not outcome. The build sheet says the car was supposed to have the L48 engine. Whether it actually received one (factory errors exist) and whether it still has one (modifications happen) are separate questions answered by separate testimony.

### State Testimony

Claims about what the asset currently is:

- **Professional inspection** (half-life: 3-5 years)
- **Owner's description** (half-life: 1-2 years)
- **Photo documentation** (half-life: 2-5 years depending on storage conditions)
- **Conservation report** (half-life: 5-10 years)

State testimony is the most perishable category because physical objects change. They rust, fade, crack, delaminate, sag, leak. The rate of change depends on the object, the environment, and the level of care. A garaged, climate-controlled vehicle degrades slowly. A field car degrades rapidly. The system must model not just the testimony but the likely degradation trajectory.

### Market Testimony

Claims about what the asset is worth:

- **Auction result** (half-life: 1-3 years depending on market volatility)
- **Insurance appraisal** (half-life: 2-3 years)
- **Dealer asking price** (half-life: 1-3 months)
- **Marketplace listing** (half-life: 1-4 weeks)
- **Forum opinion** (half-life: 3-12 months)

Market testimony is inherently unstable because markets are inherently unstable. A sale price from 2020 does not describe the 2026 market. But it is a data point in the trajectory — and trajectories, composed of many data points over many years, are themselves highly informative. The system values trajectory more than any single point.

### Provenance Testimony

Claims about who owned or handled the asset:

- **Auction lot records** (permanent, from auction house archives)
- **Gallery invoices** (permanent if documented, medium half-life if recalled from memory)
- **Exhibition catalogs** (permanent, published sources)
- **Customs records** (permanent, institutional sources)
- **Oral history** (medium half-life, dependent on memory of speaker)

Provenance testimony is unique in that its value often increases over time. A 1920 invoice is more valuable in 2026 than it was in 1925 — because the passage of time has made the provenance chain harder to reconstruct, and each surviving document becomes more precious.

---

## VI. The Philosophical Stakes

### Against Naive Realism

Traditional databases are naively realist: they assume data describes the world as it is. A record exists or it does not. A value is current or it is updated. The database is a mirror.

The testimony model is perspectival: it assumes data describes the world as it appeared to a particular observer at a particular moment through a particular lens. The database is not a mirror — it is a collection of testimonies from which the current state must be inferred.

This is not postmodern skepticism ("all data is subjective, nothing is knowable"). It is epistemological realism — a recognition that knowledge about physical objects is always mediated by observation, and observation is always conditioned by the observer's position, equipment, expertise, and incentives. The goal is not to abandon certainty but to model uncertainty explicitly.

### Against Recency Bias

Traditional databases privilege the most recent update. If a record is updated, the previous value is overwritten (or preserved in a changelog that is structurally subordinate to the current value). This creates a systematic bias toward new information over old.

In the asset domain, recency bias is dangerous. A seller's fresh listing description (short half-life, low authority) may overwrite a professional inspection from three years ago (medium half-life, high authority). The "current" state becomes the seller's optimistic narrative rather than the inspector's sober assessment. The system has been made worse by the update, not better.

The testimony model eliminates recency bias by refusing to overwrite. Every observation accumulates. The "current state" is not the most recent record — it is a weighted composite of all records, where weight is a function of source authority, recency, and corroboration. Old high-authority testimony can outweigh new low-authority testimony. The system privileges knowledge over novelty.

### Against Source Flattening

Traditional databases treat all updates as equivalent. A write is a write regardless of who authorized it or what it was based on. The database has no concept of source quality.

This is source flattening — the epistemic equivalent of saying that a Supreme Court ruling and a bar argument carry equal weight. In the asset domain, source flattening produces garbage: a forum commenter's guess about a car's value is stored in the same column as an auction result. Both are "data." Both are equally "current." Both are equally "true."

The testimony model refuses to flatten. Every observation carries its source, its trust weight, its temporal position, and its scope. The forum commenter's guess is preserved — it has value as community sentiment data — but it is not conflated with the auction result. The system knows what it knows and knows what it only thinks it knows.

---

## VII. Show Us Your Records

The founder's injunction — "show us your records; it will light the way" — is an epistemological statement disguised as a practical one.

"Show us your records" means: do not tell us what you believe. Show us what you have observed, when you observed it, and on what basis you formed your belief. Make your testimony auditable. Convert your "I just know" into "here is what I know, here is when I learned it, here is why I believe it."

"It will light the way" means: when testimony is structured, attributed, and temporally positioned, the picture that emerges is clearer than any individual claim. A hundred mediocre testimonies, each with known limitations, compose into a high-resolution picture — not because any single testimony is definitive but because their convergences and divergences create a reliability topology.

This is the promise of the provenance engine. Not that it knows the truth. Not that it replaces expertise. But that it makes knowledge visible, auditable, and portable. The expert who "just knows" can continue to just know — but now the basis of their knowing is legible to others, and the system can begin to learn from the patterns of their knowing.

The half-life model is what makes this possible. Without decay modeling, old testimony clutters the picture. Without source weighting, good testimony drowns in noise. Without corroboration scoring, isolated claims carry the same weight as convergent ones. The system that models testimony properly can, in time, develop something that resembles expertise — not through artificial intelligence but through the structured accumulation of human testimony at sufficient density and diversity.

A big enough database of testimony, properly modeled, does not just store knowledge. It becomes knowledge. That is the epistemological thesis at the heart of Nuke.

---

## VIII. Implications for Architecture

### Every Write Is an Observation

The system must not have "data entry" in the traditional sense. Every write to the database is an observation: a claim, by a source, at a time, with a confidence, about an aspect of an entity. This applies whether the source is a BaT extraction, a user's manual edit, an AI classification, or a manufacturer's VIN decode.

The distinction matters because it changes how writes are validated. A traditional database validates writes against schema constraints: is the value the right type? Is it within the allowed range? Does it satisfy the foreign key? These are necessary but insufficient. The observation model adds epistemic validation: what is the source? Is this source authorized to make this claim? What is the claim's expected half-life? Does it contradict existing high-weight testimony?

### No Overwriting

The system must never overwrite observations. It can add new observations that supersede old ones by virtue of higher weight (more recent, more authoritative, better corroborated). But the old observations remain. They are historical testimony. Their value may decay but they are not deleted.

This is not the same as an audit log. An audit log records what changed. The observation system records what was claimed. The audit log says "the condition field was updated from 'good' to 'excellent' on March 15 by user X." The observation system says "user X, who is a seller with trust weight 0.60, claimed on March 15 that the condition is excellent. This claim has a half-life of 1.5 years. A previous claim by inspector Y, trust weight 0.85, from January 2024, described the condition as 'good' with a half-life of 4 years. Current weighted composite: the condition is probably 'good to excellent' with moderate confidence."

### Computed Present State

The "current value" of any field is not stored — it is computed. The current condition of a vehicle is the weighted composite of all condition-related observations, with weights adjusted for source authority, recency, and corroboration. This computation happens at query time, not write time, so it always reflects the latest weighting parameters and the natural decay of old testimony.

This is computationally expensive. A vehicle with 500 observations requires evaluation of all relevant observations at query time. The mitigation is materialization: the system periodically recomputes and caches the weighted composite, invalidating the cache when new observations arrive. But the cache is always understood as a computation, not a record. The ground truth is the observation stream, not the materialized view.

### Trust Is Earned, Not Assigned

Source trust weights are not static assignments. They evolve based on track record. A source whose testimony is consistently corroborated by independent sources earns higher trust. A source whose testimony is consistently contradicted loses trust. The system learns who to believe by observing patterns of corroboration and contradiction over time.

This creates a meritocratic epistemology: sources that are right more often carry more weight. Not because of their declared authority but because of their observed reliability. A forum member who consistently identifies correct engine codes will, over time, earn trust weight comparable to a professional inspector — not by declaration but by accumulation of correct testimony.

---

## IX. Conclusion: Knowledge Decay as Knowledge Architecture

The half-life model is not a feature bolted onto a database. It is the database's epistemological foundation. It determines how data enters the system (as observations with attributed sources), how data is stored (immutably, with metadata), how data is queried (through weighted composition), and how data is presented (with confidence intervals, not as bare facts).

Traditional databases model the present. Nuke models knowledge — which is always partial, always perspectival, always decaying, and always accumulating. The system does not know what a vehicle is worth. It knows what various sources have testified about its value, it knows how reliable those sources tend to be, it knows how much time has passed since each testimony, and it computes a best estimate from the totality of available evidence.

This is not a limitation. This is the truth of the domain. Nobody knows what a vehicle is worth. Nobody knows the true condition of a painting. Nobody has complete provenance for any asset. All knowledge in the physical-asset domain is composed of testimonies with half-lives, and the system that acknowledges this is more honest — and ultimately more useful — than the system that pretends otherwise.

The sale price at the end of the day is the closest thing to truth in the asset domain. But even the sale price is testimony: it testifies to what one buyer paid in one moment under specific conditions. Its half-life as a market indicator is 1-3 years. Its half-life as a provenance event is permanent.

Show us your records. Every one of them testifies. And every testimony decays. The system that models both the testimony and the decay is the system that, in time, approaches something like knowledge.

---

*This contemplation establishes the epistemological foundation for Nuke's observation system. The specific half-life values cited are illustrative; the production system should derive them empirically from corroboration patterns in the accumulated data. The philosophical argument — that data about physical assets is testimony, not fact, and must be modeled as such — is the invariant that should survive any implementation revision.*
