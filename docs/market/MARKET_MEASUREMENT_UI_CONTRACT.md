# Market analysis: product direction and reader contract — 2026-10-04

This supersedes the price-histogram-first presentation. The owner wants market movement made visible through measured commentary, bidding, sales, supply and attention. No hypothetical numbers, invented trend or quote wall. This is a design/reader request, not authorization for database writes or scoring/model spend.

## Historical asking evidence: US AutoTrader pilot

The owner authorized a bounded US-first intake on October 14, 2026. A printed ad is
an attributed asking-price observation, not a completed sale or a resolved physical car.
The profile `autotrader_us_historical_v1` uses the existing `autotrader` source and
`listing` kind through the service-only historical mode of `ingest-observation`.
It does not use generic year/make matching or attach a magazine page to one vehicle.

Preserve the original JPEG privately in `masters` under its SHA-256, with source URL,
dimensions and pixel coordinates. Unknown original retrieval time stays unknown.
Publication period, reading time, retention time and database ingest time are separate.
A month or printed multi-day interval must not become an invented exact listing day.
A forum-associated issue date remains an interpretation and does not qualify a price point.
Keep raw print readings, normalized values, uncertainties, method/version and per-field
checks together. AI rereads must not be labeled human verification; a second pass is
independent only when it read the source before seeing the first interpretation.

Capture, reading and withdrawal envelopes are append-only observations. Successors cite
the earlier reading, and documented issue-context corrections preserve the old context.
The writer and fold validate these JSON citations; a database-enforced lineage FK is
not implemented. Existing vehicle-owned supersession RPCs do not handle these NULL-vehicle
records and must not be bypassed with raw updates. Concurrent sibling readings withhold
the ad rather than winning by arrival time. Withdrawal cannot resurrect an older reading.

The operator reader reconciles every ID in a bounded private manifest before reporting
that batch as complete. It folds knowledge-time cutoffs using database ingest clocks,
retains all exclusions, and qualifies a point only with directly supported publication
period, USD asking amount, year/make/model evidence and documented passing field checks.
An inferred make/model or clipped year remains evidence but is withheld pending review.
Different models and publication periods do not form a price trend merely by joining dots.
Repeated readings of one ad count once; separate issue appearances are asking exposures,
with unresolved cross-issue vehicle duplication stated explicitly.

This pilot does not change public access, feed `classified_ask_board`, establish a full
AutoTrader archive, or quantify US market coverage. Its denominator is the retained
manifest; the complete historical publication/ad population remains unknown. Raw images
and contact details stay outside the public repository. No seller outreach is performed.

## Public experience

**Owner steering, October 10 — market rows and inspection.** A row answers what the vehicle is,
what distinguishes this example, where its listing places it, and what its auction is doing.
Lead with structured year/make/model. Preserve the source headline under attribution; do not
parse its promotional wording into specifications or quietly normalize an unresolved model.
Source attribution is secondary. The original listing is reached deliberately through Sources,
not a repeated outbound primary action. Clicking identity or an auction measure opens a compact
inspection immediately beneath that row, preserving scroll position, filters and keyboard focus.
An inspected lot stays reachable when its deadline passes; elapsed time alone cannot establish
the result. A different listing URL on the same vehicle must not replace the inspected episode.

**October 10 correction — Stack readings in the row.** The initial implementation's
field ordering and raw auction counts did not satisfy the distinction/performance question.
Configuration context is a fallback, not a claim that the selected fields make an example special.
In particular, `reported_conflict` can reflect differently worded transmission descriptions;
it must not automatically outrank meaningful configuration as if it were a material defect.
The fallback keeps attributed listed-engine, transmission, drive, body and appearance reports,
suppresses repeated identity, and flags differing reports without assigning their severity.
Listing-supplied state/ZIP retains its location basis. Venue, registration and private sighting
coordinates cannot substitute. Unknown mileage units cannot become a low-mileage claim.

The auction row projects **Stack A's existing per-bid order-book fold**. Its high, identity depth
and latest raise share one exact listing episode and retained bid collection. The compact reader
reuses the public-parent gate, complete keyset collection and fold, requesting bids only; it does
not load prose, identity profiles or live-frame history for each row. Only visible rows read,
with a shared query cache and minute refresh. Another listing URL or ambiguous episode ownership
refuses the read. No truncated discussion window supplies participant or sequence measurements.

The default depth threshold is explicit: identified bidders whose highest retained bid is at
least 90% of the retained high, including the leader. This is a descriptive slice of revealed
bidding, not a learned hot/cold boundary or a forecast. Counts with missing identities or unequal
held/reported bid counts are lower bounds. The gap to the second bidder requires count agreement
and complete identity keys. A latest-raise percentage also requires a strictly increasing held
sequence. Old-window, future, post-close, wrong-URL, duplicate and undated bid records are withheld.
Default zero source counts remain unknown. Count agreement never establishes source freshness;
the last bid clock, lot-write clock and browser-read clock have different meanings.

The compact inspection leads with the measurement and its interpretation, then contributors and
per-bid replay. Source counts, discussion and raw sequences are supporting disclosures. Stack A is
a deliberate deeper drill; BaT remains under Sources. Same question, episode and evidence context
through each step. The retained high is labeled and is the denominator of depth; a different
recorded current-price scalar cannot silently become that denominator.

### Distinguishing signals: proposed selection contract

This is the next reader contract for review, **not an implemented rarity or feature-value model**.
It reuses the existing stack owners. No new ontology tables, scoring spend or production writes
are authorized by this proposal.

A candidate is a claim or measurement about a specific relation: vehicle identity; component
installation in a configuration at a time; condition/history; or one auction episode. It carries
its value and unit, source observation/event IDs, valid-time and knowledge-time basis, evidence
status, comparison population when applicable, exclusions, and an explanation of why it is
being surfaced. A source's headline is testimony. A catalog engine is a component type; a seller's
engine phrase is an attributed claim; an established installation is a separate relationship.
These cannot share an unqualified `feature` string.

| Question | Existing stack owners | Admission and deterministic selection |
| --- | --- | --- |
| What configuration distinguishes this example? | S12 dimensions, S19 attributed claims, S31 modification recipes | Require an attributed configuration relation and retain its time scope. Compare supported values within a purpose-qualified sibling cohort; expose known/eligible counts. No rarity from missing values, broad model labels or promotional words. |
| Does that difference matter to value? | S14 option/color premiums, S57 feature attribution | Require a measured effect, qualified sibling match, support and uncertainty. Configuration frequency alone does not establish a premium. |
| What could change the decision? | S05 disclosure gaps, S39 inconsistencies, S59 value of information | Promote a classified, material unresolved question with the conflicting evidence and next discriminating evidence. Raw text inequality is insufficient. |
| What is the auction doing? | SA expressed demand, S21 pacing, S03 participant history, S22 comparable sales, S24 attention | Keep competition, pace, price position and attention separate. Live comparison requires the same observed phase and known capture coverage. Completed-lot percentile ranks cannot rank a live prefix. |

Proposed priority is lexicographic and inspectable: (1) admitted decision-critical unresolved
questions; (2) supported configuration effects with a qualified comparison; (3) measured
configuration departures with their denominators; (4) attributed configuration context. Within a
tier use evidence qualification, supported magnitude, then a stable field/relation key. Suppress
repeated identity and duplicate relations; keep at most three. Do not mix incomparable units into
an unexplained weighted score. Every selected item must return its tier and selection reason;
inspection must make excluded and unresolved candidates inspectable too.

The testable hypothesis is that this ordering answers what changes the vehicle decision more
reliably than a fixed engine/transmission/color list. Acceptance cases must include a modified
truck, a recreation, a stock sports car with an unusual configuration, a common configuration,
and conflicting/insufficient evidence. The current specification reader supplies attributed
context but lacks qualified frequency/effect outputs and classified material disagreements.
That reader boundary is outstanding; shipping the Stack A projection does not close it.

**Owner steering, October 4:** inventory counts, bid-price bins and raw model-label groups do not answer how a market or a vehicle is performing. PR558 passed technical checks and was rejected by the owner for its analytical design. Its controls and count charts are not the target design. This direction supersedes the earlier single-cohort-dropdown prescription. Implementation, deployment, runtime correctness and analytical usefulness are separate acceptance stages.

Arrival establishes the boundary of the view: the whole market, a named venue, a captured subset of that venue, or one listing episode. BaT is a venue within the market. Captured open inventory is not all BaT inventory; stored auction history is not all BaT history. Show supported coverage and dates, with unknown platform/whole-market denominators stated explicitly. Do not promote an illustrative platform sales count into a headline.

The visitor sees a supported comparison before configuring controls: what changed, relative to which population and time, with its magnitude and evidence. Source, time and dimension changes reshape that same view and preserve its drill context. A control earns its space by answering a question; repeated navigation, giant selects and unrelated sorting options do not substitute for an answer. Preserve chronological auction action. A high absolute bid alone is not a reason to rank an unrelated vehicle above the next closing auction.

There is no single universally comparable cohort. Let the question select the comparison: sale amount, bidding pace, attention, technical composition and commentary require different eligibility and matching. Broader platform context and the vehicle's qualified peers are distinct. A default broader benchmark excludes the selected cohort when supported; overlapping benchmarks say so. Preserve the existing visual language while making the analytical hierarchy readable.

The opening is a comparison chart and a compact set of related measures, ahead of the vehicle list. The chart has two labeled series: selected cohort and benchmark, with the exact unit, period, numerator/denominator and coverage. The SQL reader supplies the changes and comparison basis; the browser only formats and draws them. Signed commentary scores use their actual scale (not a base-100 index). Prices may be indexed only when the reader provides a supported consistent basket; raw median shifts must say that the mix of sold vehicles changed. Never call a composite of bids/sales/prices 'commentary mood'.

The measures are commentary stance, bid rate, recorded sales and value, sell-through, active supply and view rate. Only measures with deployed, qualified real reader output appear. Missing contracts are recorded here, not filled with fake values or six empty production tiles. A metric changing direction changes the chart, the comparison sentence and the evidence list together. Do not narrate 'Porsche is strong' from one metric: report which measure rose/fell relative to what, with its sample and dates.

Selecting a time point opens contributing auction/vehicle summaries, each with its measured feature, scope, source-read clock and source link. Selecting commentary expands the vehicle summary into **derived per-comment features** with rubric/version, event time, classification uncertainty, eligible/scored counts and the exact contributing comment/source IDs. Original text is a final evidence drill, with source attribution, not the primary analytic presentation. Include counterexamples and unclassified coverage; do not select only supportive quotations. Per-vehicle distributions reveal disagreement instead of collapsing all testimony into a falsely precise mood score.

Keyboard-accessible metric buttons, native cohort/time controls, a text/table equivalent for plotted values and visible focus. On phones the comparison chart and a concise selected measure remain first; supporting measures wrap, evidence opens below. No decorative graph or new vehicle page.

## Required grain and weighting

1. Comment feature: stable source comment ID + auction/listing event ID + vehicle UUID; posted_at is event time, created_at/ingested_at is knowledge time, analyzed_at is scoring time. The source link and scoring method/version/range belong to the feature. Return the measured dimension (asset enthusiasm, condition/restoration concern, originality, price expectation or seller credibility where the rubric actually supports it); social politeness is not evidence of rising prices. Preserve uncertainty and mixed/disagreeing dimensions instead of forcing a single positive/negative tag. Bids are events, not automatically opinions. Seller statements, questions and reactions are separately typed.
2. Auction commentary: summarize eligible scored comments for one source-qualified listing episode, not all lifetime comments on a vehicle. Return distribution, scored/eligible counts, unique platform-qualified participants where known, and uncertainty. Repeated comments from one participant/source are not independent corroboration. Unknown author keys remain unknown, never unified by equal handles.
3. Vehicle: keep auction episodes distinguishable; a relisting does not duplicate a fixed sale or make historical commentary current. Provide a supported rule if rolling episodes into a vehicle summary.
4. Model/submodel cohort: use exact supported registry membership and canonical/source-qualified identity, not substring matching or inferred build class. Ambiguous members stay out or appear as explicit unresolved coverage. Default stance is equal-weight eligible auction summaries; return comment-weighted stance separately with its weighting label so one popular lot cannot dominate unnoticed.
5. Timeframe: bucket comments/bids by posted_at, sales by supported sale event time, inventory by source snapshot time. Comment → auction → cohort folding happens in SQL/the existing fold. Today vs recorded history needs an explicit baseline ending before today's window; also offer prior equal-length window and same season/year when coverage supports them. Missing bucket data is a gap, not zero or interpolated evidence.
6. Comparison: cohort and benchmark use identical platform, units, event windows, cutoffs, scoring versions, coverage gates and phase rules. Return whether the benchmark excludes the cohort. Include historical coverage start/end, source changes and elapsed fraction of an incomplete current bucket.

## A finding creates relationships, not an endpoint

An attributed `700R4` claim can lead to a transmission type, its documented installation role and period, supporting text/photos/replies, unresolved specifications, and purpose-specific comparison memberships. A catalog type is not one physical gearbox. Compatibility, a proposed installation and an observed installation are different edges. Donor-derived suspension does not establish the donor vehicle's identity. Model year is not the modification date.

Use existing observation, component/catalog, build, identity and cohort owners. The UI does not identify parts with regex, grade builds from badges, merge people by handles, or reconstruct analytical folds from testimony on page load. A foreign key or similarly named catalog row does not prove the semantic relationship. Preserve uncertain matching, conflicting claims, superseded build states and their citations. Unknown parts should generate a useful question rather than an invented specification.

Comment analysis needs a **target and a stance toward that target**, with qualification: a question about oil leakage, an explanation from the seller, praise for the styling, and bidding intent are different features. One comment can address suspension, headers and exhaust clearance. Repeated questions about one leak are not four independently observed defects. An empty-text reply containing a video is not an empty or neutral opinion. Derive features per comment, then episode, then purpose-specific cohort and time; retain dependence, unclassified coverage and method versions at each level.

## Packard acceptance case and measure-specific cohorts

Public record `46dd9cc6-20ec-47cb-a563-159a8005115c`, [BaT listing 266541](https://bringatrailer.com/listing/1937-packard-115c-convertible-8/), anchors the design. This is an acceptance case, not a pinned live auction or a comparable-price claim. These are separate questions:

| Visitor question | Required comparison / database meaning | Visible form |
| --- | --- | --- |
| Is this Sunday opening unusually active? | Venue-local timezone, weekday, scheduled/actual close, soft-close changes, same elapsed phase, observed event coverage; earliest among captured lots is not earliest on the whole platform. | Aligned current and historical activity paths; empirical range only when the reader qualifies it. |
| Is the bidding pace unusual? | Bid events per observed time interval, phase-matched prior episodes, reserve rule, participant coverage; bid amount and count are distinct measures. | Bid path and rate relative to the stated baseline, with interval and sample. |
| What kind of modified Packard is this? | Source-qualified engine, gearbox, axle, suspension, brakes and installation edges; unknown installation dates and unverified quality stay explicit. | Build composition and evidence-linked questions, not one invented restoration score. |
| What does the discussion reveal? | Multi-target comment features, seller-role qualification, question/reply links where supported, media citations; no inferred answer link from proximity alone. | Technical concern → reported answer → corroborating or conflicting evidence. |
| Where is its price among relevant sales? | Fixed supported sale facts, year/generation/body/build/condition matching appropriate to this measure, currency, sale-time build state, member IDs and exclusions. | Distribution and this auction's position; current bid remains distinct from final sale. |
| Where might it close? | Versioned prediction as of a declared knowledge cutoff, calibrated interval, held-out/backtest error versus baseline, validated evidence and phase. | Forecast clearly separate from observed bids. No output before validation. |

The October 4 bounded anonymous audit found listing prose and seller replies describing more of the build than the retained structured fields. The source describes a 700R4, a Dana 44 and C4-derived suspension; replies qualify front/rear suspension and discuss an oil leak and exhaust questions. These are attributed claims, not independently confirmed mechanical facts. The selected stored description omitted some source detail. Retained images in this sample had no completed analysis. These dated findings define intake/reader acceptance; they do not authorize a historical repair or model run.

The four Corvette convertibles in the owner's screenshot share a label but span different generations, engines, mileage and specification. They may share a browse group while failing a particular comparison's matching rules. Distinguish **browse membership**, **qualified peers**, and **excluded/unknown dimensions**. Do not call that raw label group a complete comparable cohort.

## Market shape and nested vehicle maps

A venue map exposes its actual constituent listing episodes. A make region can contain one cell per eligible episode, grouped by supported model/generation/build or close order; changing grouping changes arrangement, not the measured population. Area, color and aggregation each have a stated meaning. Color is a supported selected measure against its declared baseline. Unknown has a separate neutral state; raw price, inventory count and missing scores are not heat. Parent color comes from the reader's declared aggregate, never the average of arbitrary child colors or a client-generated composite. Sparse cells need useful hover/focus information and an accessible list equivalent. Avoid repeating 'live lots' inside every cell when the legend already defines it.

Cross-venue comparison identifies venue and auction-session effects, capture gaps, local clocks and physical/online participation. Co-occurring Mecum/Barrett-Jackson events are context, not proof they caused BaT prices to change. The whole-market denominator can remain unknown while the captured scope remains navigable.

## Delivery order and release gates

1. **Surface retained inputs now:** on the existing market route, replace the oversized type-only activity wall and green increment multipliers with a time-scaled observed bid path, readable source-qualified specifications/prose and bounded discussion/media. Keep the original source and existing vehicle/observation drill. This establishes the evidence surface; it is not yet market-relative performance or distilled commentary.
2. **Qualify comparisons:** database owners extend existing readers with event/knowledge clocks, measure-specific membership, distributions, eligible/scored coverage and bounded contributors. UI binds that output to the same view; no competing fold, schema or writer. Reader state and production acceptance are recorded independently.
3. **Expose market relativity before the list:** phase-aligned activity, commentary features and supported sale outcomes become the opening answer; source/time/group changes reshape the comparison and nested map together. No fake-data prototype or unsupported performance color ships to production.
4. **Forecast only after grading:** preserve immutable observed sales and earlier assessments. Revisions carry their own cutoff and method. Do not equate money invested with resale premium or stack correlated effects as independent causal contributions.

Frontend owns visual hierarchy, interaction, accessibility and mapping a reader receipt to a legible display. Database/fold owners own measurement, semantic edges, cohort membership, baselines and reproducible revisions. Intake owners own faithful source preservation and media linkage. Each dependency needs an exact field, grain, unit, eligibility, permissions, source and acceptance example; a column's existence is not delivery. The private `UI_DB_REQUESTS.json` coordinates current gaps; this tracked contract is durable product direction.

## Bounded sale-context delivery

The existing `/valuation` tool now draws the actual qualified members returned by `valuation_by_ymm`; the market listing evidence surface links to it with recorded identity and subject exclusion. It never carries an unverified current bid or assumed currency into an amount comparison. This supplies inspectable nominal sale-price context, not the completed market opening, qualified asset peers, condition-adjusted value or a forecast.

**Further owner steering, October 4:** PR574/578 was rejected as unreadable and analytically incomplete. A precise price percentile over recorded year/make/model is not an assessment of an asset when features and condition are unmatched. Passing checks, merging and reproducing a receipt did not satisfy the design goal. This supersedes the previous distribution-first presentation.

The initial view is a source-sale comparison sheet: current recorded label, source sale date, exact published sold amount, and a mark on one shared price scale. It opens in newest-sale order. A selected row expands its exact source result, existing vehicle record and sanitized ancestry immediately beside the row. Phones give labels their own line and preserve exact amounts and the common scale. Distribution and unjoined date plots remain optional views; neither joins changing vehicle mix into a return or trend. There is no primary candidate marker, percentile or condition-adjusted range. Raw amount rank and detailed membership/capture clocks are secondary, collapsed context.

Each row is one qualified source sale episode, deduplicated by the reader's source-lot identity. Display paging does not change the full source denominator or scale. Current labels use one bounded anonymous `vehicles` metadata read for the visible page, with public/undeleted/nonvehicle gates. The vehicle UUID and exact current source locator must agree with the sale's qualified URL; a different relisting never lends a title. Missing or duplicate labels stay unresolved, and a metadata failure preserves the attributed amounts. Labels do not extract features, classify builds, establish condition at sale or enter the price calculation. A canonical identity fallback must not masquerade as an obtained listing title.

The sale window, platform, currency and fee basis are visible with the rows. Feature/condition matching is stated before any amounts. Coverage of current records and the retrospective evidence cutoff remain in the receipt; later discovery can change this population, so this is not an immutable historical replay. Empty and sparse receipts preserve source evidence without a fabricated aggregate. Inconsistent units, attribution, dates or knowledge clocks refuse all amount views rather than quietly filtering rows.

The deployed reader currently returns `conditionEvidence: unknown` for every member and `condition_adjusted_assessment: unmeasured`. Counts of populated current body, engine, transmission or condition fields are metadata coverage, not matched sale-time features. The visible distinctions among a recorded race-car label, an Aluminator-powered coupe label and a convertible label demonstrate why a broad name group cannot support an asset-value claim; the title alone does not establish any of those builds.

The next comparison requires a subject and sale-time feature receipts, not an added frontend discount formula. The existing subject `vehicle_id` identifies a reference asset where supported; a URL containing only make/model and an amount has not described a subject's condition or equipment. The existing reader/fold owners must return purpose/version, attributed features, sale-time validity, matched/unmatched/ambiguous dimensions, included episode IDs and exclusion reasons. Uncertainty in condition, originality or installation history must remain explicit. No matching or inferred build state is reconstructed from observations or title regex at page time. See the private `UI_DB_REQUESTS.json` follow-up for the exact additive fields, source/permission gates and acceptance case.

The visual reference is the analytical operation, not an automotive chart imitation: [Observable's ordinal dot example](https://observablehq.github.io/plot/marks/dot) associates named entities with values on a common scale; [Bloomberg's relative-value teaching example](https://data.bloomberglp.com/professional/sites/10/AdamLei-WP.pdf) distinguishes a chosen peer group and explicit comparison measures. Applying these here means showing which assets produce a distribution and qualifying their matching before treating the result as value.

The October 4 anonymous receipt for 1966 Ford Mustang returned 18 qualified USD source lots from 1,729 current public year/model records, within the requested October 4, 2023–October 4, 2026 window. Its latest qualifying sale was April 3, 2026. These are dated reader observations, not platform sales totals or pinned production metrics. The UI revealed the six-month qualifying-evidence gap rather than claiming a current market trend.

Next reader work stays with existing owners: add source-bound public title and sale-time variant/build context for each contributing sale, metric-specific membership/matching and exclusions, explicit snapshot/source-read clocks, and phase-matched bid exposure with contributing episode IDs. A same-label cohort cannot explain why two different builds have different prices. `live_lot_temperature` must qualify these semantics and expose bounded contributors before the UI promotes its ranks into performance heat. Browser latency and duplicate reader requests need separate measurement; this slice does not establish a two-second market answer.

## Analytical references

The reference is the analytical operation: [Bloomberg-hosted 2018 teaching primer, relative-value screen](https://data.bloomberglp.com/professional/sites/10/LUISS_2018Primer.pdf) for explicit peers and measures; [MSCI attribution example, May 2022](https://www.msci.com/research-and-insights/video/are-factors-only-for-quants) for separating benchmark, common factors and residual; [Finviz maps, January 2026](https://finviz.com/blog/new-stock-market-maps-for-market-cap-52-week-highs-lows-themes-and-insider-trading/) for distinct area/color encodings; [TradingView relative volume at time](https://www.tradingview.com/support/solutions/43000705489-relative-volume-at-time/) for aligned session phase and incomplete intervals; [SEC structured filing APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) for entity/concept/unit/period semantics; [SemEval target stance](https://aclanthology.org/S16-1003/) for distinguishing target stance from sentiment. Historical examples are not current quotes, validated automotive models or evidence of causality.

## Reader envelope, additive to existing owners

Capability guard identifies api-v1-market-trends / get_market_trends as the existing comparison owner. Extend that surface or its sanctioned backing fold; do not create a competing analytics pipeline. Existing market_lot_activity remains the bounded current-lot drill; it currently exposes 40 typed interactions for at most eight lots, not cohort-wide distilled commentary. Coordinate additive output with UI; preserve the deployed fallback.


The existing api-v1-market-trends Edge route authenticates an API user and uses a server-held service role. It is not an anonymous browser endpoint. Preserve that authentication. The public UI needs the same owner’s qualified output through its existing anonymous/RLS reader path; do not ship API keys or service role to make the route usable. Keep legacy get_market_trends callers compatible; choose an additive response/overload within this owner rather than silently changing its existing table return type.

Each metric requires: metric_id, state (ready/partial/unknown/unavailable/conflict), value/null, unit, numerator/null, denominator/null, grain, weighting, method_id/version, event_from/to, knowledge_cutoff, source_observed_at/null, folded_at, coverage (eligible/scored lots/comments; earliest/latest event; source completeness/limits), and bounded evidence cursor. `generated_at` never substitutes for source freshness. Do not invent confidence by recycling a stored observation score into aggregate certainty.

Series points require the same receipt at bucket grain, comparison value and baseline, plus SQL-calculated absolute/relative change when defined. Denominator zero yields a null ratio with a reason. A known zero under complete coverage remains zero. Overlap, incompatible scoring revisions, stale sources or mixed currency prevent an unqualified comparison. Current cumulative materialization is not historical as-of; future knowledge cannot silently enter a sale-time assessment.

Evidence responses repeat metric/cohort/bucket/cutoffs and provide stable UUIDs for contributing lots/observations/comments, contribution/weight, method and source attribution. Cursor pagination is server-side and bounded. Public/undeleted/vehicle-only eligibility applies to aggregates AND drill. Denied/private records must contribute neither payload nor public aggregate counts. No service-role browser credentials, no page-time observation-log reconstruction.

## Live reader inspection and exact gaps

Read-only deployment inspection at 2026-10-04 UTC:

- `auction_comments` has sentiment, sentiment_score, analyzed_at, community_stance_score, stance_scored_at, stance_model, condition_polarity, extracted_claims and rubric_version alongside posted_at, source_url and platform-qualified identity keys. Their existence does not prove comparable current/history coverage or a deployed cohort fold.
- `market_lot_activity` was deployed under PR525 and subsequently verified for its bounded public current-listing receipt. Its typed activity omits comment_text and distilled stance fields. It is a drill seed, not the market aggregate.
- `get_market_trends` reads raw vehicles.sale_price/sale_date. Its inspected body does not establish the qualified sold/public/deleted/nonvehicle eligibility required here. Do not label it verified sales-performance output.
- `get_make_market_stats` averages stored market_trends scores without a exposed rubric/cutoff/coverage receipt. This cannot justify today's Porsche mood vs all history.
- `get_auction_trends_v2` synthesizes a 'market sentiment' score from bid depth, sell-through and average-price movement. That is not measured commentary. Its commentary section joins comment_discoveries to vehicle_events by vehicle UUID rather than exact episode, groups neutral with negative, and substitutes missing measures with zero. Public eligibility and this episode/score semantics need repair/assay before exposing it as the requested experience.
- `get_model_price_history` has public/deleted/nonvehicle and vehicle_sale_basis eligibility, but latest 30 records are a bounded evidence sample, not a whole-market denominator or historical performance series.
- Current live-bid index history provides same-hour snapshots, with source/make coverage differing between archived and live readings. Do not present this as historical bid-event velocity or sale-return performance.

## Acceptance assays (real records only)

SQL and browser must agree on the contributing event/cohort IDs and metric receipts. Test: current vs prior window; model/submodel resolves to a supported exact cohort; sparse/absent history; negative/zero stance; incompatible rubric revisions; repeated author testimony; contradictory scores; incomplete current period; stale source; successful source read with no change; bid truncation; source view-counter reset; mixed currencies; relisting; private/deleted/nonvehicle exclusion; source/event/ingest clocks. No production synthetic testimony. A cohort-strength headline requires the actual measures and comparison receipts; if the reader is absent, the UI does not make that claim.


## Market exploration structure — owner steering, October 4

The owner’s Chevrolet URL illustrates a larger requirement: reveal market scale, let source/cohort/time lenses change the shape, and make the underlying points easy to drill. A brand’s captured live-lot count is not market size. The opening must identify its source and population before presenting a chart. Open inventory uses recorded current live state with future ends; ended outcomes use native event-time windows and current recorded knowledge. A filter must visibly change the appropriate chart and its record list. A highlight within a broader reference population must say what remains in that population.

The current deployed surfaces cover public captured BaT inventory and a maximum seven-day recorded-sale episode series. They do not establish complete platform coverage, overall auction-market size, immutable historical inventory, commentary stance, historical bid velocity or a cross-platform performance index. Keep those boundaries in the shared lens state and source receipts, rather than implying every adjacent panel uses the same population and clock.

Extend the existing market reader with source-qualified metric series and actual documented auction-session overlays. Required inputs are exact source registry IDs, native physical/online session IDs, venue/mode when recorded, source event start/end and timezone, eligible listing-episode membership, canonical-vehicle overlap, observation/capture coverage, and compatible metric/rubric/currency/exposure across before/during/after windows. Drill from an event marker to its real session, lots and source evidence. Online changes around a physical auction are observed associations; a calendar overlay does not establish causal impact. Missing source coverage is unknown, not zero. No fake events, totals or new intake/scoring spend are authorized by this UI request.


PR558 uses the existing Market destination and `/?make=...&board=1` route, but the owner rejected its count-first analytical presentation. Preserve useful source eligibility, clock receipts, keyboard behavior and exact contributor links while replacing its visual hierarchy through the release gates above. Raw recorded model labels remain browse labels until a qualified reader supplies semantic membership. Absolute daily counts can serve an evidence drill; they do not establish relative market performance.

The first evidence-surface implementation extends this same route with `?lot=<public vehicle UUID>`, retaining access to its current recorded listing URL after it leaves the open board. The existing `vehicles`, `auction_comments` and `get_vehicle_specs` readers supply eligible public parent metadata, at most100 latest exact-URL interaction rows, and canonical/reported fields plus optional preserved source text. Public/deleted/nonvehicle eligibility is repeated in the child query. Legacy comment permissions remain a separate database issue. The view draws actual posted bid records, offers a table and source-native anchors, and exposes statements/media without claiming target classifications, paired replies or scored stance. Different relistings on one vehicle are not combined. These separate requests are a current evidence read, not an atomic historical snapshot; the browser response timestamp does not prove source freshness. Listing-page capture receipts must match both vehicle and source URL before their clock or bid agreement can appear.

## Scheduled sales: the auction calendar — owner direction, October 15

The owner, 2026-10-15: the site reads as one market (BaT) when it is meant to be all of them. Give live auctions with
published rosters their own position: "a timer that's delayed out", a 3-to-6-month lead time instead of a 7-day online
auction, and a vehicle profile for each consigned car, "often resales". Measured the same day: the live board was
1,219 of 1,219 lots from BaT, its only live feed; Mecum's public index listed five upcoming sales with 2,407 lots, and
Nuke held none of them.

Contract, as delivered in `auction_calendar_read` and the Market tab's `?collection=calendar`:
- **Grain.** One upcoming lot is a `vehicle_events` row with `event_status` `upcoming` (Mecum) or `pending` (Gooding), a
  run day from today to the horizon, not withdrawn, on a public vehicle. A sale is the lots sharing a house and
  `metadata.sale_key` (else the slug of `metadata.auction_name` plus the run year). The sale's days come from the house
  (`sale_starts_on`, `sale_ends_on`), else from the first and last run day landed.
- **The writer's keys** (agreed with the Mecum intake lane on 2026-10-15, matching what extract-gooding already writes):
  `ended_at` = run day; `metadata.auction_name`, `auction_session_days`, `sale_key`, `sale_starts_on`, `sale_ends_on`,
  `sale_location`, `lot_number`, `has_reserve`, `currency`, `roster_first_seen_at` (kept from the first read) and
  `withdrawn_at`. After the sale the writer flips the status to the house's result and keeps the metadata.
- **The clock is the data's.** The page says how long ago each sale's lots were last written ("updated 12 min ago"),
  per sale and overall, never the time of the read (owner, 2026-10-15: a full read timestamp is noise).
- **Timers are days.** The house publishes a run day, not a minute: a sale counts days to its first run day, runs "day
  n of m" during its days, and a lot "runs in n days". No hours, minutes or seconds appear for a day-precision clock.
- **One axis.** Each sale row draws its run days (height = lots that day) on one axis from today to the last sale landed;
  the first seven days are shaded as the window a 7-day online auction runs in, so the live board and the calendar read
  as one timer at two lead times.
- **Roster fill is a measure.** Lots landed per sale against the lots the house lists ("111 of 1,037"), and those
  first seen in the last 7 days (the consignment observation is `roster_first_seen_at`). The listed count is the newest
  `source_census` row per house with `census_method` 'house_roster_facet' (the Mecum lane writes one per index read,
  keyed by sale_key; read through `house_roster_census()`, since `observation_sources` is not readable logged out).
  A listed sale with no lot landed and no recorded days is shown under the table, not on the axis. Last year's final
  roster as a baseline is still owed.
- **Non-vehicle lots** (`listing_kind` 'non_vehicle_item', e.g. Mecum road art) are not lots on the calendar, as on the map.
- **A backfilled sale stops reading unconfirmed** once a sale correction on the vehicle cites that lot among its
  `source.lots` (the house's own result was read and applied).
- **Resale history.** Every consigned car shows up to five earlier records of the same vehicle on any venue (VINs are
  unique on `vehicles`, so a resold car lands on its existing record). Outcomes are the source's own; a `sold` written by
  `orphan-backfill-v1` reads "recorded, result unconfirmed" (that backfill labeled any priced row sold, classified asks
  included), except Gooding and Barrett-Jackson, whose published prices `vehicle_sale_basis()` accepts as sales.
- **Prior occurrence dates.** An earlier record's displayed date comes from `ended_at`, else `sold_at`; when both
  are absent it stays undated. `created_at` remains a retention clock for existing prior eligibility and ordering,
  never a source occurrence date. This date correction does not qualify an earlier record's price or sale outcome.
- **Not claimed.** The calendar is the lots Nuke has landed, not the house's full roster, until the stated count is held
  beside it; an estimate is the house's; "no reserve" is the house's flag.
- **Read model.** The lots come from `mv_auction_calendar_lots` (one row per public vehicle lot, its earlier-event count),
  refreshed at :07 and :37 (job `refresh-auction-calendar`); a roster's earlier records are read live for the page's lots.
  `population.lots_built_at` is the read model's build time. Measured 2026-10-15 14:4xZ: reading lots from
  `vehicle_events` and `vehicles` on every call timed out at 16 s for anon while intake loaded the disk; from the read
  model the call answers in 0.13 to 0.5 s.

### Which house a sale belongs to

A confirmed sale's house on the map (`mv_treemap_outcomes.source_name`, and through it the family folds and their venue
toggles) is `market_venue_label(auction_source, canonical_platform)`: the source string stripped to `[a-z0-9]`, matched to
one house label (`Bring a Trailer`, `Mecum`, `Barrett-Jackson`, `RM Sotheby's`, `Gooding & Co`, `Bonhams`, `Broad Arrow`,
`Cars & Bids`, `PCarMarket`, `Collecting Cars`, `SBX Cars`, `Classic.com`), `auction_source` first, `canonical_platform`
second; null when neither names a house ("venue unrecorded"). The labels are the strings `FamilySalesChart` matches. A
house's share is quoted with the no-house count beside it. Measured 2026-10-15: the map's earlier CASE missed the slugs the
rows hold (`cars_and_bids`, `barrett-jackson`, `rm-sothebys`), so 37,688 of 286,610 confirmed sales had no house and Cars &
Bids, Barrett-Jackson and RM counted zero; with the function 3,532 have none (3,182 more are Barrett-Jackson by their
listing URL, being filled into `canonical_platform` from that URL). A row whose two fields name different houses is a
merged record, repaired at the record (241 Mecum lots carrying a Barrett-Jackson docket identity, 2026-10-15), not by a
precedence rule in the label.

## The feed and the brand map — owner direction, October 15

**The brand map.** The treemap may be the best format there is, and its tiles said little: "Chevrolet 27,885 sold,
$36K med, 11.5%". A brand is not its median price ("to define an entire brand on a median price is just totally
horrible"), and the share repeats the tile's area. The job is to present brand context no one has seen, from what the
data model already holds, and to name and build what it lacks. Delivered first (fold `mv_brand_market`): area =
dollars from confirmed sales; the tile reads dollars and sales, the p10–p90 band, the share of offered cars that sold,
the model year that trades, and the last 12 months against the 12 before (color; gray when too few sales are dated).
Missing and next: model families (model strings are split by trim, so "what this brand trades" cannot be shown yet),
and repeat-sale returns (the same car sold twice, and what it gained per year held).

Delivered later that day: model families (mv_family_market, 20261015131500; a brand opens on its families, a family on
its model names, each with the same measures, "Other models" holding the names not yet keyed). And a correction: the
all-venue 12-month move mixed in venues whose intake is uneven between the two years. Against the complete local BaT
archive it read Ferrari dollars -6% where BaT itself rose 93%, BMW sales -7% where BaT rose 2%, Chevrolet +30% / +51%
against BaT's +17% / +22%. The move is now read on Bring a Trailer only, the venue held in full both years (252,399 of
264,746 enumerated lots), and a tile is gray unless BaT holds at least half its sales. A move across every venue needs
each venue's intake to be complete in both windows; until the coverage view can say so per venue and year, it is not
shown.

**The feed: why is this listing in front of me.** Serving cars newest first over a mixed pile is not an organizing
method ("what am I doing here, why am I looking at this classified"). A listing earns its place the way social feeds
measure virality, by a measured reason it is worth a look:
- it is underpriced against its own market (which needs a defensible estimate of what the car should bring);
- the composition of the sale (who is selling, for example an original owner's car);
- the viewer's interests, from their own history and whatever access they grant;
- the patterns the corpus already shows people go crazy about, so a matching vehicle triggers something when it lands;
- and some new things introduced to test whether they hold the viewer.
The design system is the data: the order and what each row says come from these measures, not from layout.

**Live, not clocks.** The page should read as live to the second. No full date and time stamps (22 characters); when
the board is current it says live, otherwise how old the read is ("5 min ago"). No population sentence as a headline
("of 573 asks first seen in the last 24 hours" is not what matters), and no section named like a pipeline
("Classified arrivals").

**Ask less of the viewer.** Source, window, order, near me, band and price tiers are not the first thing on the page;
defaults do the work and the controls recede. The market-view switch is navigation, not a filter.

**What a row says.** The photo already says it is a rear-drive coupe; do not spend text on drivetrain or body. Say the
source (Craigslist), and above all how old the listing is: how early the viewer is (the Marketplace habit of refreshing
the top). "Original listing" as a label goes. Location matters and deserves its own thought.

**Refresh is a control.** Top right, it shows that something is happening and says what arrived. Refreshing never
loses the reader's place; scrolling up is not a refresh.

**Price must be believable.** An ask of $21,000 over a "$15K–40K" tier is not helpful. The viewer needs what the car
should sell for, a Zillow-grade estimate, which needs image analysis, condition, and the cost to make it a daily
driver, and differs per viewer. Until a number can be defended it is not shown (feedback rule: never show a price you
cannot defend); the honest interim is the ask placed against the same car's measured sales.

**Typography and logos.** Careful use of logos (makes, sources) and type is more fun, and the site under-uses it.

Delivered October 15 on the classifieds board: "Just listed"; a top-right refresh with the last successful read age,
checks quietly every two minutes and offers "N new" without moving the list; filters folded into one closed control;
rows with mileage, the source and the listing's age; the tier label and the raw taste score removed. The reader
(20261015070000) orders newest first by when a listing went up (listed_at = the post time, never later than the first
sighting) and returns the newest listing time. The top row's posting age stays distinct from the snapshot read time.
The refresh control uses the reader's `as_of`; a failed check offers retry, retaining prior rows. A new posting does
not establish source freshness. The window filter says "First captured" because eligibility uses first landing,
even when the posting is older.

Measured that day, and the reason "live" cannot yet be claimed of the market: the intake (poll-listing-feeds, every
15 minutes) captured 614 Craigslist listings in 24 h, a median 6.5 h after they were posted (p10 82 min, p90 3 days;
38 within the hour). Facebook Marketplace and KSL sent none (their jobs are paused). Being early on a listing needs an
intake that captures within minutes; that is intake work, not page work.

Next: the interest order (underpriced against same-car sales first, then sale composition and the viewer's band), and
the ask placed against measured sales.

What "same car" needs, measured 2026-10-15 02:15Z: sales and asks do not share model strings (Craigslist "tacoma
sr5", BaT "911 Carrera 4S Coupe 6-Speed"), so a price position needs a model-family key first. canonical_models
(3,456 rows, 212 makes, every row with aliases) resolves 496 of the day's 635 Craigslist asks (78.1%) by alias; the
misses are a make written into the model ("Toyota 4runner SR5 V6"), misspelled makes, and models the table lacks (F600,
B2000, 633). The fold to build: sales and asks keyed to one family (the same key the brand map needs for "what this
brand trades"), then each ask against its family's confirmed sales at its year, shown only with its sample.
Also delivered on October 15: what the listing says rides on each row (20261015080000): a disclosed broken odometer
shows no number (38 of 621 listings that day), a rolled-over one says so (38), and a title other than clean is said
(32); the rows are cards, photo first.

### Classifieds: surface the deals — owner direction, October 15 (04:15Z)

**The name is "Classifieds".** "Just listed" goes. What people care about is finding the deals; the benchmark is the
deal posts Barn Finds used to write ("this is a good deal, snatch this up"): surface what someone would want, and say
where each listing lands in our price analysis. That is the goal of the page, to teach people the market.

**His read of the top three, the acceptance case for any position measure.** A 1965 Plymouth Barracuda at $29,500
(vehicle eee88010-57c2-4290-baae-2d2088040f04): top dollar, maybe a little more, and it still needs investment. A 1999
Jeep Wrangler at $14,000 with 178,000 miles (ddb3afc1-94be-4083-a0c1-7582a97a9dc3): retail, on the expensive side, it
would have to prove it is special; it "lands right in the middle, and why is that not expressed". A 1995 GMC K1500 at
$3,500 with 300,000 miles (e308f6cd-b29b-4bf0-bbd0-22ef9656c517): worn out. A position measure reproduces top, middle and
low on these three, or says why it cannot. His pick among them weighed what he could do with the car (a build), the
make's following, and the photos; the three have nothing in common, and that comparison is what the page should help.

**Price follows condition, and condition is in the photos.** Image analysis is not good enough yet. For development,
analyze the photos, or put an Analyze control on a listing so the analysis is paid for only where someone asks, not
for every arrival. The detailed data model exists because of that analysis.

**Read each listing the way he does.** Make, model and condition, then the car's character, its history, what is
already known about it, and the market's measures. Cars in hard-to-reach regions sit longer on classifieds because
demand there is thinner; time to exit is read by region.

**Every photo.** He chose "based on one photo". Measured 2026-10-15 04:20Z: the intake held every photo the three
listing pages showed (21 of 21, 7 of 7, 3 of 3) and the card showed one. Delivered: each card carries all of them (one
read per page of 60 cards: 616 photos, 85 KB, 0.55 s cold, 0.17 s warm, logged out), a swipe on a phone, an arrow under
a pointer, the count in the corner, and a larger photo on a wide screen. Capture order is not kept (vehicle_images
position is 0 on every row), so the board's image leads.

Owners: the position and merit fold (each ask against its family's sales at its year, asks against similar asks, exit
outcomes) is the listing-merit lane; the card renders what it returns.

**What exists for condition, measured 2026-10-15 04:30Z.** No classified photo has a condition read (0 of 690 photos on
60 recent Craigslist cars; 0 of 100 recent classified cars carry a condition observation). The seller's declared
condition is already captured (569 of 701 priced listing observations in the last 24 h: good 275, excellent 179, fair
73, like new 32, salvage 10) and rides on the board as an attributed claim ("seller: like new"). A development read of
the owner's three cars from their photos agreed with his order: the Barracuda a very nice driver (glossy paint,
straight panels, redone interior, sound deadener over the floors), the Wrangler a lifted, tidy 4.0 driver showing its
178,374 miles, the K1500 a weathered truck photographed in weeds, three exterior photos only.

**The Analyze path.** One owner/admin control per listing card: api-v1-vision gains a listing route (requireWriteAuth
then requireAdminOrService; a daily cap) that reads the listing's photos, tries YONO first (no model fee) and otherwise
the caller's own connected provider (Nuke does not fund cloud inference; about $0.015 a photo on the owner's key, about
$0.18 for 12 photos), and writes one condition observation through ingest-observation (source nuke-vision, agent
inferred, so its confidence is capped at 0.6). The card shows the read beside the seller's claim; the position can then
be read against cars in like condition. Pixels alone never set a value.

## The live auction board — owner direction, October 15

Read on nuke.ag/?tab=market&collection=auctions as a visitor: "a lot of work goes into it ... but I don't even know
what I'm looking at." What he named:

- **Each datum once.** The rule for every group on the page: present a fact one time, in its most efficient place. The
  board showed its live-bid total twice and its lot count five times. AI is supposed to reduce what a viewer reads,
  not multiply it; rehashed data presented as important is the failure.
- **The headline number.** "$42.6M on Bring a Trailer live auctions" was a line of text that did not look real. It
  should look like a figure, in the world of its venue (the BaT mark, typography), relative to something the viewer
  can judge (the same hour in earlier weeks), and clickable, because people want to study what makes it up. The open
  lot count is equally meaningful and was neither relative nor clickable.
- **Ease the viewer in.** Two treemaps of different designs, a row of unexplained buttons (open inventory, recorded
  sales, auction calendar, captured listings, cohort, all makes) and map controls (group by brand, inside each box
  decades) made the page "scary": a viewer will not click what they cannot predict.
- **What a lot row says.** Running hot / running cold is not believed: its basis is invisible. Retained high, bidder
  counts, "within 10% of the high", "8/8 reported bids held" and "Source: BaT" are noise. The last bid's age and the
  last raise are mildly interesting. No reserve matters to buyers and should stand out (yellow). The image is small for
  the space it has, and the type is not used.
- **The lot drawer.** It repeated the name and the location, wrapped thin measures (leader's margin, bid coverage,
  "how much bidding sits near the high") in disclaimers, put the original-listing link in the wrong place, showed a
  "published headline" under Sources, and drew the bids as a chart and again as a table.
- **The product is the finish.** What the board should do is gauge where a lot will finish, from what equivalent
  lots did before: "back in 2019 the same equivalent vehicle had raised like this at this point and sold for this
  much", then an estimate and how confident it is, like a call sheet. The stacks and data analysis behind the board
  are the right idea; the board must turn them into that answer.

Delivered October 15, first pass (subtraction and the figure; the finish estimate is the next pass):
- **The masthead.** Bring a Trailer's mark and name, and the last successful browser-read age. Vehicle-row updates by
  arbitrary writers cannot establish source freshness. A failed refresh offers retry while retaining prior rows.
- **Two figures.** The dollars bid now and the open lots, each set as a figure (a new kit role) with its comparison
  stated once: change on a week ago and rank among the same hour in earlier weeks. Each opens the map of what it is
  made of: by dollars or by lots. The second treemap no longer shows unless asked.
- **Removed.** The Thursday strip and the edge strips (they repeated the totals), the coverage line, the hot/cold
  tags, filters and sorts (heatOf stays exported for the phone's shared fixture), and from each row "Source: BaT",
  the location, retained high, bidder counts, "within 10%" and reported-bids-held.
- **A lot.** A larger photo (a full-width card on a phone), the name at entity size, the row facts as text, time left,
  the bid with its pace ("bid 3 h ago · +0.6%"), and No reserve in yellow, also first among the filters.
- **The drawer.** One panel: bids and watchers, then the Bring a Trailer link, the record and Stack A; the bid chart
  once (no table); the latest question and the seller's latest words; then only the facts the row does not show
  (miles, colors, VIN, location).
- **The views.** Live now, Sold, Calendar and Just listed, then Make.

### Where a live lot should finish (model 32), October 15

The owner's product for the board: an estimate of where each live lot finishes, from what equivalent lots did before,
and how confident it is. Built from a backtest run offline against the local BaT archive (264,746 lots, 7.10M timed bids,
2014-07-30 → 2026-09-27) and production rows; the receipt is kept with the session logs.
- **Method (analog, v1 price-only).** For each live lot, the finished BaT lots that looked most like it at the same
  hours to close: same no-reserve flag, a near bid, a near position of the bid against where its model page usually
  finishes; same page, make and model year preferred. Estimate = the bid × their weighted median rise to the close;
  80% range from their 10th–90th percentile rise, calibrated per hours to close × no-reserve × grade. Never below the
  bid. Grade A: the page has comparables within 3 model years and ≥ 5 of the 50 analogs are on it; B: fewer same-page
  analogs; C: priced from the make.
- **Measured.** On 25,673 car lots closed 2026-04..09 (never used for tuning): median miss 19.4 / 16.7 / 15.0 / 13.3 /
  11.7% at 72 h / 24 h / 6 h / 1 h / 10 min, 80% ranges held 79-80%; naive (bid × typical rise) 33.4 / 25.2 / 20.7 /
  17.1 / 14.7%. Replayed on 1,106 production lots closed 09-28..10-14: 16.2% and 80.8%. By price tier at 24 h:
  19.1% under $25K to 11.2% over $100K, ranges holding 78-81% in every tier and for reserve-not-met lots.
- **Not shown, measured as worse:** the model 31 band alone once bidding starts (27% at every hour; 2.9× wide); the
  bid path alone before the last hours (no better than naive); live_lot_temperature_at's hours band as an estimate
  (22% at 24 h, 2.4× wide); the v24 engine (graded as made on 935 lots: 24-28% miss, its p25-p75 held 24-38%, its
  confidence_score does not track error, worse than naive at every horizon); hot/cold.
- **Confidence wording** is generated from the calibration, capped at the latest production measurement: grade A
  "8 in 10 cars like this finished inside this range. Half finished within 15%."; grade C "About 3 in 4 … treat it as
  rough" while its production coverage is under 78%.
- **Freshness.** Written hourly by a Mac job (scripts/market/live-finish.mjs, model 32 rows in hammer_predictions;
  first sight, bid changes and horizon crossings only). live_finish_estimates() withholds every estimate when the
  writer has been silent for two hours, so a sleeping laptop shows as missing, never stale; each estimate says
  "comparable sales through <date>".
- **Gaps.** The archive stops at 2026-09-27 (a daily append of settled lots is next); production has no BaT model-page
  key (titles map at 92.7-96.4%); bidder and comment counts improve the 24 h miss from 17.4% to 16.7% and come with a
  bounded engagement read later; grade C and reserve-not-met are the weakest cells.
