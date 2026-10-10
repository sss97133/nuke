# Market analysis: product direction and reader contract — 2026-10-04

This supersedes the price-histogram-first presentation. The owner wants market movement made visible through measured commentary, bidding, sales, supply and attention. No hypothetical numbers, invented trend or quote wall. This is a design/reader request, not authorization for database writes or scoring/model spend.

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

The initial display policy selects at most three attributed vehicle reports: disagreements first,
then powertrain, body and appearance, suppressing repeated identity and duplicate engine fields.
Unrooted scalar values and unknown mileage units do not become distinguishing claims. This is a
versioned presentation priority, not empirical rarity, price impact or verified installation.
Existing specification readers own evidence eligibility; the browser only selects and formats
their output. Listing-supplied state/ZIP must retain their location basis; venue, registration and
private sighting coordinates cannot substitute. Broader differentiation still needs qualified
condition, history, configuration and conditional-frequency readers.

Keep auction measures in consistent positions. The initial row can expose the exact episode's
recorded bid, positive source-reported bid/watcher counts and a supported latest bid-event time.
Default zero counts are unknown. The short drill shows actual retained bid records and their
numeric changes, with currency/capture limits. It does not manufacture recent bidder counts,
interval rates, peer-relative pace or forecasts from a truncated interaction window. Those
remain dependencies of the qualified measurement owner described below. Vehicle facts and
Sources have their own concise inspections; full records and bid sequences require a deliberate
deeper drill. Same question, same episode, same evidence context through each step.

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
