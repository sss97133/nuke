# Positioning: one voice

How to say what Nuke is to someone with five minutes: a grant reviewer, an investor, a mechanic. The
[README](../README.md) is the description. This is how to speak it, the evidence a stranger can check, and the things
that lose the room. It supersedes the 2026-02-08 note "vertical data + applied AI" (removed in the same change) and
sits beside [`VISION.md`](VISION.md), which is direction rather than description.

Every number here carries its source, its date and its unit. The evidence block below is written from the live
database by the same daily job that measures the README, so it moves with the registry; the hand-written lines
around it cite documents and carry their dates.

## The sentence

Nuke is a data machine for physical assets. Every observation about an asset (a bid, a comment, a photo, a receipt, a
title transfer) is kept with its source, its clocks and its trust, and the system computes the asset's state, its
cohort baseline and its predictions from that log, point-in-time, so every number can be replayed and graded.
Vehicles are the first asset class.

Shorter: **an observational ledger for physical assets, with its predictions graded in the open.**

## Why a stranger bounces, and the fix

A reader without time prices the ratio of claim to checkable evidence. Until 2026-10-07 the repo carried three
one-liners from three eras: "make every collector vehicle liquid" with ETFs and vaults (`VISION.md`, 2026-02-05),
"vertical data + applied AI, bots that hire humans" (the removed note, 2026-02-08) and "a data machine" (README,
2026-10-06). The loudest was the least evidenced, so the honest reader discounted all of it. A model asked "is this
fundable" read the two words "vehicle data ledger" and answered from them.

The fix is not to the machine. It is one voice, and a description that carries a measured number wherever it goes.
Lead with the instrument and its grading table. The vision comes after, and only when asked.

## Against: the unverifiable number

Positioning is against something. The alternatives a buyer has today (a price guide, an aggregator's estimate, a
venue's own comps, a model asked "what is it worth") share one property: the number arrives with no error table.
None we have found publishes how often it was right, on how many lots, as of when. Nuke's position is the opposite:
every number with its source, its date, its unit and its denominator, and every prediction graded in a public
table. The stats in the substrate are the positioning; a reader takes them or leaves them. That is also why this
evidence should be generated rather than typed: the hand-written table of 2026-10-07 was wrong in its unit (rows for
lots) within an hour. Generating it on the daily `readme-stats.mjs` run is on the data-model lane's list; until then
the numbers below are hand-read and stamped.

## What is measured

Units are lots, not rows, and every rate names its denominator. Hand-read on prod 2026-10-07 03:30Z unless stated.

| Measure | Value | Source |
|---|---|---|
| Settled BaT lots held | 106,551 with a sale price, of 174,518 listings; 93,135 of the sold keyed to a vehicle; 1,216 settled since 2026-09-27 | `bat_listings` |
| Price predictions | 53,922 hourly rows, 46,093 keyed to their lot (`auction_event_id`, PR #774); lots predicted per model: v24 995, v30 980, v31 1,342 | `hammer_predictions`, 2026-10-07 09:00Z |
| Graded error, per lot (the last prediction before each lot's close: the scheduled close where live frames hold it, the final close otherwise; against `auction_events` outcomes) | 1,997 sold lots graded (ten at 03:30Z the same day). v31, live: 751 lots, median abs error 26.2%, bias +16.2%, 80% band holds the hammer on 591 (78.7%); v30: 489 lots, 30.7%, band 74.6%; v24: 747 lots, 24.3%, bias −13.2%, 50% band holds 25.8%; v13: 10 lots, 12.0% | `prediction_accuracy` (lots as the unit since PR #774), 2026-10-07 09:00Z |
| Prediction to outcome key | 46,093 of 53,922 rows keyed to their lot by `auction_event_id` and graded against `auction_events` outcomes, not through the vehicle key (which landed on 6 settled listings) | PR #774, walk finished 2026-10-07 08:51Z |
| Stack registry | 64 stacks; 5 at or above 0.9 coverage; mean 0.12; order book SA v2 at 0.50 (8 of 16 needs present, 2 partial, 6 missing) | `v_stacks`, 03:11Z |
| Buyer concentration (V012 discovery) | 68,957 distinct BaT buyers; top 1% took 14% of lots; 39 won 50 or more | `vein_ledger` |
| Corpus (planner estimates) | 20.0M auction comments, 4.27M bids, 11.2M observations (03:49Z); 52.1M images, 0.5% vision-analyzed; 11% of comments sentiment-scored (README, 2026-10-06) | README daily measurements |

Results that live in documents rather than on prod, with their dates:

| Result | Number | Source |
|---|---|---|
| Band tag backtest, 24 h before close | 69,295 sold BaT lots 2024-09-01..2026-09-27, each priced from earlier sales only: cold 11.3%, in line 40.9%, hot 86.8% finished above their band middle (48 h: 13.2 / 40.3 / 82.9%). Run in a local DuckDB archive of 2026-09-29, not on prod | `docs/ledger/2026-09-30_bat-data-coverage-audit.md` §5 |
| Soft-close extension | 322 of 400 settled BaT lots extended past the scheduled close (80%) | `docs/ledger/theory/data-machine-cases.md` §4 |
| Hypothesized cause of price error | condition and configuration live in images and comments, not fields; from a handful of graded cases, not a measured decomposition | `docs/features/ask-nuke/THEORY.md` (2026-07-09) |

What the numbers said on 2026-10-07 03:30Z: the predictor had written predictions for 4,612 lots (model v24,
since 2026-02-19) and 2,314 more (v31, live since 2026-09-27), and had been graded on ten, because its vehicle keys
land on six settled listings (`bat_listings` holds 106,551 sale prices, 93,135 of them keyed to a vehicle). The
grading machinery exists; the outcome join is the gap, and it is a key repair on data already held, not new data.
The evidence is a small fraction of the pool (0.5% of images analyzed, 11% of comments scored, ten of thousands of
predictions graded), and the pool is a fraction of the market. Both fractions were the honest headline that morning. At 08:51Z the same day the join landed (PR #774): every
prediction keyed to its lot and graded against the lot's outcome, 1,997 sold lots graded. Objective 0 is met at
n ≥ 1,000; the bar is now the live model's 26.2% median per-lot error with an 80% interval that holds the hammer
78.7% of the time.

Row counts are cost, not results. Lead with the graded error and the coverage; mention the rows as the size of the
testbed.

## The research question

For a funder who funds R&D, the question is one sentence with a grading rule:

> Can point-in-time state, estimated from heterogeneous untrusted observations (images, comments, receipts, bids) that
> each keep their source, clock and relation to the asset, predict an asset's clearing price with a graded per-lot
> error, and keep correcting that prediction inside the two-minute closing window as bids, comments and, later,
> other signals arrive?

The unproven parts, each a Phase I objective:

0. **The outcome join.** Done 2026-10-07 08:51Z (PR #774): every prediction keyed to its lot and graded against the
   lot's outcome at the last prediction before each lot's close (the scheduled close where live frames hold it, 282
   of model 31's lots; the final close otherwise, 469); 1,997 sold lots graded, up from ten that morning. The bar: the
   live model's median absolute error of 26.2% per lot, with an 80% interval that holds the hammer 78.7% of the time
   (751 lots): calibrated, and wide.
1. **Condition and configuration from images and text**, at the accuracy the error demands. Today 0.5% of images are
   vision-analyzed; condition blindness is the hypothesized cause of the error seen so far.
2. **Relation-weighted claim credibility.** A statement about an asset weighted by who made it, their relation to the
   asset at the time, and how their earlier claims resolved. Designed (`data-machine-cases.md` §13.3); no measured
   instance yet.
3. **Leakage-free replay at scale.** A feature at moment *t* uses only what was known before *t*, over 19.9M comments
   and 4.27M bids. Most market-data products violate this; the architecture here is built around it.
4. **The nowcast.** A prediction row per lot per minute through the closing chain, graded against the outcome, with
   the update rule as the fold (stacks SA and S24). The live pull visits six lots a minute with one slot held for
   closing lots, so a lot in its final chain is observed about once a minute; whether the fold recomputes at that
   cadence is a feasibility question, not a feature.

Grading: median absolute % error per lot (the last prediction before close, and at fixed horizons) against the
cohort baseline, on a held-out final month, in `prediction_accuracy` by price tier. The bar is objective 0's result: 26.2% median
per-lot error and a 78.7% interval hold on 751 lots. Generality: any asset class whose record is fragmented public observation (equipment,
aircraft, property, art). Vehicles are the testbed because they are the largest public corpus with timed bids.

## Models: sensor, not source

The owner's claim, in substance (2026-10-07): a language model cannot create factual documentation. It generates
opinions; opinions influence actions; actions get documented and become history. That is a different path from
observation, and it is why markets that settle on a timed outcome (an auction, a sale, a bet) stay outside a
model's reach: the final two minutes of bids are observations that do not exist until they happen. Nobody is
building the substrate for that; this is it.

The form that survives a referee (`docs/content/thesis-aperture-of-llm-control.md`; `data-machine-cases.md` §13.4,
§13.8):

- A model emits priors. It cannot emit an observation. An auction close is an observation.
- A model trained on today's web has leakage by construction. It cannot say what was known two hours before a close.
- Its place in the machine is as an observer: it turns a comment into an attributed claim, a photo into a condition
  observation, and the output lands as a row with provenance. It is never the source of a number.
- The calculations and the retained, replayable log are what the model cannot produce.

A model is a sensor. The ledger is the instrument.

## The two-minute window

BaT's soft close moves the close to the last bid + 2 minutes, and 80% of settled lots extend. The decision moment is
that chain. Everything the system knows about a lot must therefore be folded before the chain starts, which is why
the architecture is a fold over a log rather than a query at decision time. Speed is a property of the layers, not of
a model. The order-book stack's six missing substrates (comment stance dimension, order-book fold per lot per minute,
cohort demand curve by minutes to close, residual snapshots, outcome ledger) are the near-term work plan.

## The physical shape comes after the instrument

Live-streamed garage sessions, the accounting layer and passive capture are all sources into the same substrates, not
separate products:

- A garage session is the richest observation available: a camera on the work, the receipt, the person doing it, all
  clocked.
- Accounting is money as one more observation layer on the same entities (investment, maintenance, repair as evidenced
  interventions; `data-machine-cases.md` §9).
- Passive capture is the vision gate and the photo sync.

To a funder these are the market and the company sections. Lead with the instrument; the garage is where it gets its
best data.

## How to say it

**To a reviewer.** "An observational ledger for physical assets. Every fact keeps its source and its clocks, state is
computed from the log point-in-time, and predictions are graded against outcomes in a public table. Our live price model
is graded on 751 sold lots: median error 26.2% per lot, and its 80% interval holds the hammer 78.7% of the time, so
it is calibrated but wide. Phase I asks whether provenance-weighted extraction from photos and comments narrows it,
measured the same way."

**To an investor.** "Auctions settle in a two-minute window and the crowd prices on what is written in the listing.
We fold everything known about the asset before the window opens, with a grading table that says how often we are
right. Collector vehicles are the testbed: 157K settled BaT lots, 20M comments, 4M bids. The ledger generalizes to any
asset with a fragmented public record."

**To a mechanic.** "It's the record. Every job, every part, every photo, every dollar on the truck, with who did it and
when, and the market for that truck next to it."

## What loses the room

- ETFs, derivatives, vaults, "undercut BaT". Direction, not evidence. Keep it in `VISION.md`.
- "LLMs cannot exist in the same reality." Say sensor and instrument.
- Row counts as the lead. 52M images is a cost. The result is 0.5% analyzed and a 26.2% median error on 751 graded lots.
- A graded number without its unit. 399 rows of seven lots re-scored hourly is seven lots.
- "AI-powered", "platform", "disrupt", "Bloomberg for cars".
- A person's money, vehicle or contact details. The repo is public; refer to records by id.
- A number without its source, date and denominator.

## NSF SBIR/STTR Project Pitch, shaped

Program facts, read 2026-10-07: reauthorized 2026-04-13 through 2031 (S. 3971); NSF relaunched under solicitation
NSF 26-510; Phase I about $305K; the Project Pitch is the screen, four sections, one pending pitch per company.
Character limits are from [seedfund.nsf.gov/project-pitch](https://seedfund.nsf.gov/project-pitch/).

| Section | Limit | What goes in, from this doc |
|---|---|---|
| 1. Technology innovation | 3,500 chars | The sentence; the nine layers in two lines; the model as sensor; origin: a mechanic's own records and the gap between what a listing says and what the work shows |
| 2. Technical objectives and challenges | 3,500 chars | The research question; objectives 0 to 4; the grading rule, with objective 0 (the outcome join at n ≥ 1,000 lots) as the first milestone; the testbed size; why this is R&D (the outcome is unknown and the grading table proves it) |
| 3. Market opportunity | 1,750 chars | Who decides in the two-minute window (bidders, dealers, flippers), who needs the record (owners, lenders, insurers); the settled-lot volume as the market's size; later asset classes |
| 4. Company and team | 1,750 chars | Founder-mechanic who builds and sells vehicles, user #1 and today the research partner; pre-launch; the corpus already built; a university partner satisfies STTR's research-institution requirement and the owner has candidates, with museums as letters of support |

### Path and clock

Read 2026-10-07 from the [solicitation](https://www.nsf.gov/funding/opportunities/small-business-innovation-research-small-business-technology/nsf26-510/solicitation)
and [seedfund.nsf.gov/apply](https://seedfund.nsf.gov/apply/get-started/).

- **Eligibility.** Under 500 employees, US-located, at least 50% owned by US citizens or permanent residents, not
  majority-owned by venture, private-equity or hedge funds; all funded work in the US. The PI is employed by the
  company (the solicitation: at least 51% at award and through the award; the get-started page: at least 20 hours a
  week), needs no degree, and commits at least 173 hours to the project per six months.
- **Tracks.** SBIR: the company alone. STTR: a subaward to a not-for-profit research institution with a co-PI from
  it; the PI still at the company. Team size is not the question: the median NSF Phase I awardee has three employees at award and a
  fifth have one or none (SBIR.gov bulk data, 2015 to 2023). STTR adds a partner's co-PI; SBIR stands on the
  founder's record and letters of support.
- **Amounts.** Phase I up to $305,000 for 6 to 18 months. Phase II up to $1,250,000 for 24 months. Fast-Track up to
  $1,555,555 (Phase I $400,000, then Phase II $1,155,000) for teams past the proof stage. Strategic Breakthrough
  awards up to $30M for proven Phase II awardees (secondary source). No equity taken.
- **Steps and limits.** The Project Pitch can go in any time (the window reopened 2026-06-02): four sections, one
  pending at a time, at most two per company per twelve months and three ever for the same technology; NSF answers
  in about one to two months. On an invitation, the full proposal is due at the next window: 2026-11-04,
  2027-03-04, 2027-07-07, then the first Wednesday of November, first Thursday of March and first Wednesday of July
  each year. One proposal per organization per window. A funding decision takes roughly six months from
  submission. Historically about 16% of Phase I proposals were funded (about 338 of 2,112 a year over 2008 to
  2017; National Academies, SSTI); the pitch-to-invitation rate is not published.
- **Registrations, free, start now.** SAM.gov (up to three weeks), the SBA company registry (the SBC ID),
  Research.gov (up to 48 hours). All three are needed before a proposal can be submitted; the pitch needs none. No
  SAM.gov, SBA-registry or SBIR mail under the owner's primary address as of 2026-10-07, and a login.gov reset in
  October 2024 found no account there: treat the company as not registered.
- **The clock from 2026-10-07.** A pitch in by the end of October is answered by December. The 2026-11-04 window is
  out of reach in practice, so the proposal is written December to February for 2027-03-04, the decision follows
  around September 2027, and the first dollar arrives in the fall of 2027: about eleven months. The pitch is the
  only step that costs nothing.
- **The trunk dependency, landed.** 2026-10-07 08:51Z (PR #774): 1,997 sold lots graded by lot. Section 2 carries the
  number.

### What winners look like

Two public sources, pulled 2026-10-07. **The whole resource**: SBIR.gov's bulk award file
(`data.www.sbir.gov/awarddatapublic/award_data.csv`, refreshed monthly; 207,731 awards across 12 agencies, 41
columns including employee count at award, PI, STTR research institution and abstract), of which 14,796 are NSF:
9,959 SBIR Phase I, 1,279 STTR Phase I, 3,558 Phase II, award years through 2023. **The latest two years**: the NSF
awards API (`api.nsf.gov/services/v1/awards.json`), which carries 2024 and 2025.

- **Team.** NSF Phase I awardees are tiny companies. Median 3 employees at award; 61% have three or fewer and 18%
  have one or none (2015 to 2019, n=1,534 with a count). 2020 to 2023: median 3, 65% three or fewer, 21% one or
  none (n=779). STTR awardees are no larger (median 3, 69% three or fewer). Solo is the norm, not the gap.
- **Repeat and conversion.** 2,927 Phase I awards since 2015 went to 2,802 firms; 96% hold exactly one. 32% of
  those firms later hold an NSF Phase II.
- **Track.** STTR is 19% of Phase I since 2015 (560 of 2,927), naming 252 distinct research institutions (Purdue
  15, Arizona State 10, Wisconsin-Madison 8). The Nevada System of Higher Education (Reno) appears once. The track
  is a function of one edge: a research-institution partner with a co-PI, or none.
- **Geography.** Since 2015: CA 637, MA 248, NY 207, TX 158, CO 111; Nevada 3 of 2,927, one since 2020 (Las Vegas,
  2023). FY2025 by the API: CA 27, MA 18, NY 11; Nevada 1. Scarce, not disqualified; the program says it wants all
  50 states.
- **Topic.** By title and abstract since 2015 (n=2,927, word-boundary matches): AI or machine learning 495;
  software 479; database or data platform 93; marketplace or auction 46; blockchain 37; provenance or ledger 24;
  valuation, pricing or appraisal 11; used or collector car market 0. NSF's own topic codes for 2020-plus Phase I
  (n=1,381): BT 130, BM 125, ET 119, MD 103, DH 94, AI 79, PT 72, CT 69, EN 66, M 61, R 61, SP 50, IT 45; AI, IT
  and DL together are 150 (11%). The nearest neighbours are protocols and tools, not markets: scalable auctions for
  decentralized marketplaces (MD, 2023), a product-experience protocol and marketplace (VA, one employee, 2020),
  water markets on a distributed ledger (UT, 2022), demand simulation for transportation modes (GA, 2023), a
  public-health data API (NY, one employee, 2021). NSF funded the method inside the tool, never the market. The
  pitch is therefore the estimator and its grading rule; the ledger is the testbed and the moat, told second.
- **Money.** Phase I median $274,883 in 2023, before the raise to $305,000; FY2025 by the API, median $305K. 2020
  to 2023 Phase I: 17.5% women-owned, 12.1% HUBZone, 15.6% socially and economically disadvantaged.
- **FY2025 by the API** (start dates 2024-10-01 to 2025-09-30): 146 Phase I (107 SBIR, 39 STTR), 108 Phase II, 10
  Fast-Track; a thin year that ended in the authority lapse, against a 2008 to 2023 run of 240 to 459 Phase I a
  year. Historical rate about 16% of proposals (National Academies; SSTI); the pitch-to-invitation rate is
  unpublished.
- **What this is for.** Winners-only data gives the shape of winners, not the odds. These rows are the first
  baseline of an opportunity stack (`data-machine-cases.md` §13.9 and §13.9.1): a funding program as a cohort of
  awards with outcomes, Nuke's fit as keyed claims against the program's criteria, and a score that says how far
  the company is from the opportunity and which keys are missing. Both pulls are reproducible from the URLs above.

### The pitch, drafted (owner review; nothing is submitted by an agent)

Drafted 2026-10-07 from this document. Character counts are measured on the text below, against the limits on the
Project Pitch form. Two blanks in square brackets wait on the owner: the legal entity and its state, and the track line. The
graded-lot count landed 2026-10-07 08:51Z and is filled.

**1. The Technology Innovation** (2,410 of 3,500 characters)

Nuke is an observational ledger for physical assets, with its predictions graded in the open. Every observation about an asset (a bid, a comment, a photograph, a receipt, a title transfer) is kept as an append-only row with its source, its event time, its ingest time and its trust. The asset's state, its cohort baseline and its predicted clearing price are computed from that log point-in-time, so any number the system shows can be replayed from only what was known at the moment it was made, and graded against the outcome when it arrives.

The innovation is the estimator built on that ledger: a provenance-weighted, point-in-time price estimator for assets whose public record is fragmented across untrusted observations. Three parts are unproven. (1) Condition and configuration extraction from images and free text at the accuracy a price requires. The facts that move a collector-vehicle price (body configuration, documented work, condition) live in photographs and comment threads, not in listing fields, and our own calibration table shows a comparables-only model failing by tens of percent for that reason. (2) Relation-weighted claim credibility: a statement about an asset weighted by who made it, their relation to the asset at that time (seller, prior owner, bidder, bystander), and how their earlier claims resolved. Designed, never measured. (3) Leakage-free replay at scale: a feature computed for moment t may use only events known before t, over tens of millions of comments and millions of bids. Most market-data products violate this; the architecture is built around it.

Language and vision models have a defined role: they are sensors, never sources. A model turns a comment into an attributed claim or a photograph into a condition observation, and its output lands as a row with provenance. It never produces the number. A model trained on today's web cannot say what was known two hours before an auction closed; the ledger can.

Origin: the founder is a mechanic who builds and sells vehicles and kept his own records this way. The testbed is the largest public corpus of timed asset auctions: about 157,000 settled Bring a Trailer lots, 20 million timestamped comments and 4.3 million bids, where every late bid extends the close, so the decision window is two minutes. The method is asset-agnostic: equipment, aircraft, property and art have the same fragmented public record.

**2. The Technical Objectives and Challenges** (2,762 of 3,500 characters)

The research question: can point-in-time state, estimated from heterogeneous untrusted observations that each keep their source, clock and relation to the asset, predict an asset's clearing price with a graded per-lot error, and keep correcting that prediction inside the two-minute closing window as bids and comments arrive?

Phase I objectives, each graded in the same public table.

0. The outcome join. Grade every prediction the system has made against the recorded hammer, per lot, point-in-time, at n ≥ 1,000 lots. Done 2026-10-07: 1,997 sold lots graded at the last prediction before each lot's close (the scheduled close where live frames hold it, the final close otherwise); the live model's median absolute error is 26.2% per lot and its 80% interval holds the hammer 78.7% of the time (751 lots), close to nominal. That is the bar.
1. Condition and configuration from images and text. Vision and text extraction producing attributed condition observations. Success: a measured reduction in median absolute per-lot error against the objective-0 baseline, on a held-out final month, by price tier.
2. Relation-weighted credibility. Weight each claim by the claimant's relation to the asset and their record on earlier claims. Success: lift on the outcome (above or below the cohort median at close) with an 80% interval excluding 1, on held-out lots.
3. Leakage-free replay at scale. A replay engine that recomputes every feature for every past moment from prior events only, over 20 million comments. Success: a passing leakage audit and a per-horizon error curve at 120, 48, 24, 12, 6 and 2 hours before close.
4. The nowcast. A prediction row per lot per minute through the closing chain, updated as each bid and comment lands. Success: calibration at each minute, and a measured recompute latency inside the two-minute extension.

Why this is R&D: the outcome is unknown. Our calibration record exists and is honest. A comparables-only predictor runs live; graded on 751 sold lots, its median error is 26.2% and its interval is calibrated but wide, with condition blindness the hypothesized cause. Whether provenance-weighted extraction closes that gap, and whether a fold over the log can recompute fast enough inside a soft-close window, are open questions with a yes-or-no answer that costs money to obtain. One baseline is already measured point-in-time: a three-class price tag computed 24 hours before close on 69,295 settled lots, each priced only from earlier sales, finished above its band middle 86.8% of the time when tagged hot and 11.3% when tagged cold.

Risks: sparse or biased outcomes (reserves not met), adversarial sellers, and image volume (52 million images, 0.5% analyzed) that forces selective rather than exhaustive vision.

**3. The Market Opportunity** (1,024 of 1,750 characters)

Near-term customers decide under time pressure with an unverifiable number. Online collector-vehicle auctions settle in a two-minute soft-close window; dealers, flippers and serious private buyers bid against a crowd that prices on what the listing says, with price guides and aggregators that publish no error table. The first product is the graded estimate and its evidence for a live lot, sold to professional buyers and sellers who transact repeatedly: about 157,000 settled lots on one venue alone, with buyer concentration (the top 1% of 68,957 buyers took 14% of lots) that identifies the paying segment. The second is the asset record itself, for owners, lenders and insurers who need provenance for a specific physical asset. The method generalizes to any asset class with a fragmented public record (equipment, aircraft, property, art), each with its own timed venues. The company's position is the opposite of the incumbents': every number with its source, date and denominator, every prediction graded in public.

**4. The Company and Team** (921 of 1,750 characters)

Nuke is a pre-launch small business [legal entity and state of registration] founded by a mechanic who builds and sells vehicles and is the system's first user. The founder is the principal investigator and leads the technical work; the company's engineering is run with AI coding agents under a public repository and a written engineering law. The data machine already exists in production: an append-only observation log of 11 million rows, 20 million auction comments keyed to 650,000 identities, a registry of 64 measured analytical stacks, and a self-describing schema. What does not yet exist is the graded estimator this proposal funds. [Track line. SBIR: the company alone, with letters of support from named institutions. STTR: named research institution as partner and its named co-PI.] Phase I funds the founder's time, compute and image analysis, and a part-time researcher for the extraction and replay work.

