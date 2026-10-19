# Retained evidence repair guide

This guide helps future agents continue the all-vehicle repair exposed by the 1963 Corvette
conversation. The useful outcome is an immediate answer from retained evidence: broad market
context, supported configuration comparisons, exact source support and the next decision-critical
unknown. The remaining work concerns evidence relationships and their consumers. More appraisals
or diagnostic reports alone do not close it.

Findings below are dated **2026-10-05 UTC** and come from the completed reader batch. They are not
a live census. Read current [AGENTS.md](../../AGENTS.md), the
[data-machine theory](../ledger/theory/data-machine.md),
[C27](../ledger/theory/data-machine-cases.md#11-whole-market-evidence-and-immediate-vehicle-questions)
and the [market measurement contract](MARKET_MEASUREMENT_UI_CONTRACT.md). Refresh the affected
live atlas and writer/reader behavior before engineering; do not repeat the whole investigation.

## What was delivered

**2026-10-10 retained-data delivery, measured at 22:26 UTC.**
[PR923](https://github.com/sss97133/nuke/pull/923) delivered four ratified powertrain selectors and their canonical source proof. Its 87-claim/30-vehicle batch was validation, not population completion. [PR928](https://github.com/sss97133/nuke/pull/928) extended the existing color queue and finite listing replay to all six properties. [PR935](https://github.com/sss97133/nuke/pull/935) added deterministic powertrain assertions from qualified retained description text. These changes are implemented, tested, merged, automatically deployed and runtime-verified through anonymous provenance and canonical readers.

Since the original six-property replay began at 17:21:28 UTC, the live queue had admitted **25,074 new powertrain claims across 1,865 vehicle IDs** at 22:26 UTC. It admitted 2,027 claims in the preceding 30 minutes, with no failed queue items. The latest 50 claims passed current-source custody checks. The assay also checked 200 completed items; these bounded samples do not prove every historical claim's current eligibility. Counts describe source testimony, not distinct new canonical slots, independently verified configurations, fully modeled vehicles or whole-corpus coverage. The existing 120-attempt/minute ceiling is capacity, not measured yield.

The native-description epoch had visited 78,000 listing keys and seeded 17,636 work items; its baseline remained incomplete. Nested receipts preserve the prior six-property epoch's 38,500 visits and the older color replay's 714,675 visits. These visits can include multiple observations of one vehicle and are not additive vehicle coverage. All completed work and source testimony survive epoch changes; new eligible arrivals enqueue independently of recording-clock order.

[PR938](https://github.com/sss97133/nuke/pull/938) adds the existing ratified odometer-reading property. It preserves displayed counts, original units, precision and approximation; true accumulated mileage and the reading event date remain unknown. It merged and deployed, but text comparisons against production `observation_kind[]` arrays stopped replay. The local text-array fixture masked this compatibility bug. [PR941](https://github.com/sss97133/nuke/pull/941) repaired it, passed every actual CI check, merged at23:36:32 UTC and automatically deployed. Live replay resumed. [PR939](https://github.com/sss97133/nuke/pull/939) reuses qualified inputs within each bounded drain. [PR942](https://github.com/sss97133/nuke/pull/942) overlaps at most two admissions within the same attempt/time governors; it passed integrated-head CI, merged at00:10:18 UTC on October11 and automatically deployed. A natural120-attempt drain completed119 claims in14.7 seconds after deployment. Different workload mixes prevent a causal speed-gain claim.

PR941 also delivered six field paths: ratified `year`, `make` and `model` extractor labels, plus native exterior/interior finish labels and front/rear power routes. The production enum-array fixture proves612 baseline/arrival claims. At23:51 UTC, the indexed completion window since23:00 contained **1,580 claims across375 vehicle IDs**, including261 odometer claims and166–167 each for year/make/model. All ten supported keys appear; sampled current-source proofs pass. Labels remain unverified, native claims keep exact quotations and unknown factory/current roles, and original JSON/clocks survive. These bounded counts are source claims, not net new canonical slots or complete vehicles.

[PR945](https://github.com/sss97133/nuke/pull/945) repaired an anonymous canonical-reader gap: table-reading invoker predicates could not see the source catalog under its authenticated-only RLS policy. Earlier canonical existence samples could find another HTML claim and did not prove each native winner. The repair shares pure row predicates with intake/completion and checks current metadata inside the existing canonical view's owner context. Production source RLS, invoker security, existing OIDs and grants remain intact. All actual CI checks passed; it merged at00:30:39 UTC on October11 and automatically deployed. Anonymous runtime proof now checks exact expected canonical winner IDs and provenance across15 source-family samples spanning all ten keys. All407 incident requests requeued with exact prior operational receipts retained were complete at01:22:26 UTC; ten sampled completions passed current-source custody checks. Later request failures and120 expired leases still require investigation.

[PR948](https://github.com/sss97133/nuke/pull/948) extends literal retained VIN labels through the existing ratified VIN property, queue, intake and readers. It admits qualified public `html_match` source labels with17 uppercase allowed characters; the identifier namespace is explicit, identity remains unverified and checksum status is not evaluated. Historical short identifiers remain in their original source JSON. The extension makes no physical `vehicles.vin` update, provider request or factory-reference assertion. Its disposable production-enum/RLS fixture proves101 baseline claims plus a late arrival and preserves prior work and nested receipts. A paused-job claim barrier prevents an already-running old handler from claiming a newly installed mode before matching-worker activation. The migration is `20261011002640_retained_listing_vin_label_projection.sql`; all actual CI passed, it merged at01:55:44 UTC on October11 and automatically deployed in run38103469523. At02:02:45 UTC,20 VIN work items were complete and129 pending. Five natural VIN claims passed anonymous provenance and exact expected canonical-winner checks, including explicit namespace, format, checksum and identity qualifiers.

A later bounded failure assay identified a PostgreSQL/JavaScript material-boundary disagreement: a native sentence with black leather and gray cloth inserts produced `black` in JavaScript but `black leather with gray` in PostgreSQL. Existing source-tuple guards correctly rejected that disagreement. The implemented and locally tested `20261011013632_retained_presentation_witness_agreement.sql` forces the existing SQL expression's shortest overall match without expanding accepted sentence forms. It preserves function identity/grants and rechecks only up to500 exhausted interior-color requests whose witness actually changes, retaining exact prior operational rows. Shared SQL/JS cases and a six-claim source-to-public-reader fixture pass; [PR951](https://github.com/sss97133/nuke/pull/951) passed all actual CI, merged at02:29:06 UTC and automatically deployed. At03:02 UTC all nine selected production requests were complete; five sampled completions passed current-source custody and anonymous exact canonical-winner/provenance checks. A private differential assay of30 real retained descriptions across seven parsers found no disagreement after the repair; it is not a whole-corpus proof.

[PR955](https://github.com/sss97133/nuke/pull/955) models Craigslist's original `extraction_metadata.raw.attributes.raw.auto_miles`, rather than a flat mileage field that could confirm an existing physical scalar. The existing source and ratified odometer property both accept listing testimony. Claims preserve raw counts, native post IDs, the platform miles basis, broken/rolled-over disclosures, unknown true mileage/event time and a 0.4 confidence cap. Physical vehicle values, source-kind contracts, provider requests and paid capacity stay unchanged. The production-enum/RLS fixture proves 101 baseline claims and a late out-of-order arrival through the existing arrival trigger, exact public readers and forged-claim refusal. All 239 ingest tests, 104 archive regressions and applicable PR CI passed. It merged at 03:48 UTC on October 11. The first CI deployment hit the one-second arrival-trigger lock limit and rolled back completely; its quiet-window retry succeeded without weakening the limit. At 03:55:12 UTC, 46 natural Craigslist claims across 46 vehicle IDs were complete; five sampled claims passed current-source custody and anonymous exact canonical-winner/provenance checks, including original count, units, post ID and disclosures. The finite baseline remains incomplete.

A bounded follow-up assay at03:23 UTC found121 exhausted items:120 expired leases with retry timestamps in the exact 00:04:00.672708–00:05:01.036821 UTC window and one transmission request with an already-admitted, currently valid child but no queue completion receipt. All121 current native witnesses agree between SQL and JavaScript across43 qualified public parent captures. Historical lease root cause remains unknown. `20261011033344_retained_exhausted_work_recovery.sql` is implemented and locally tested: it rechecks only this window and the named valid-child request, preserves exact previous work inside the existing controller receipt and returns qualified work to normal guarded intake/completion. The121-item fixture verifies exclusions for private/superseded parents, outside-window, lower-attempt and unrelated-error rows, owner pause/repeat refusal, unchanged testimony/vehicles and completion through the existing CAS. [PR958](https://github.com/sss97133/nuke/pull/958) passed all actual CI, merged at04:38:26 UTC and automatically deployed. At04:43:14 UTC all121 selected items were complete; five natural completions passed current-source custody and anonymous exact canonical-winner/provenance checks. Two later exhausted work receipts remain outside this precisely bounded incident; their claims were already admitted and current at the last assay. Historical root cause remains unknown.

[PR959](https://github.com/sss97133/nuke/pull/959) reads exact four-digit original Craigslist year rows through the existing ratified Model Year property, independently of odometer availability. Raw text and native post IDs survive; the typed listing label retains a 0.4 confidence cap, unverified identity and unknown event/factory/current roles. Flat vehicle/year confirmations and ambiguous combined make/model text are unused. All 258 ingest tests, 104 archive regressions and actual PR CI passed, along with the PostgreSQL proof of 101 baseline labels, a late arrival, exact public readers, forgery refusal and current withdrawals. Existing odometer custody, physical vehicles, source contracts and the arrival trigger survive. It merged at05:03:32 UTC and automatically deployed. At05:07:21 UTC19 natural year labels across19 vehicle IDs were complete; five samples passed current custody and anonymous exact canonical-winner/provenance checks. The finite baseline remains incomplete.

[PR960](https://github.com/sss97133/nuke/pull/960) retains the literal year and subject label from a bounded original publisher introduction, such as a2014 motorhome built on a2013 chassis, without reconciling those roles or inferring make/model. The original quote, protected capture fingerprint, unverified identity and unknown event/factory/current roles survive through the existing year selector, queue, source guards and readers at the existing0.6 cap. Thirty real qualified introductions agree between SQL and JavaScript;279 ingest tests,104 archive regressions and the PG17 proof of101 baseline claims plus a late arrival pass. All20 actual CI checks passed; it merged at05:56:32 UTC on October11 and automatically deployed in run38116424954. At05:59:24 UTC23 natural year claims across23 vehicle IDs were complete, with five current-custody and anonymous exact canonical-winner/provenance checks passing. The finite baseline remains incomplete.

The same worker publishes sanitized failure-stage counts in its existing response, distinguishing admission HTTP/receipt/exception failures from completion RPC/custody/exception/budget failures. At05:59:04 UTC a natural scheduled response reported77 claims stored, with all stage counts zero and no admission HTTP failures. The stage counts describe failed operations rather than unique items or a historical root cause. Existing retry states, completion custody and attempt/time/concurrency limits remain; no inference/provider calls were added.

A current-reader cost assay then found the year predicate initializing its native text witness for unrelated property candidates. A dense fixed50-vehicle read of all eleven fields timed out in that initialization; the same50 current-year-only slice completed4.15s when directly bound to the registered property UUID. The implemented `20261011060954_retained_year_witness_candidate_guard.sql` moves already-required property/profile/method refusals before parsing and rejects an already-disallowed over500-byte quote before its introduction expression. Its local PG17 proof compares500 existing source pairs, tests refusal composites and a parser trap, and preserves custody, work/replay/job receipts, source/property/vehicle data, function identity/grants and the public winner. It changes no eligibility, replay epoch, schedule or capacity. Production deployment and before/after all-field performance remain pending.

At06:01–06:05 UTC the same fixed500 vehicle IDs selected at04:49 had344 current year fields, versus50 at baseline:294 newly covered vehicles and none losing a year. The new slots were289 Craigslist labels and five native description labels. This is a selected cohort and a focused year read in slices, not whole-corpus coverage, an atomic snapshot or proof of complete vehicle models. Private records, exact before/after comparison, full input-field catalog and catalog-based table/relationship gaps are in `/Users/skylar/nuke-logs`.

The owner's objective remains ongoing: raw retained evidence → qualified source input → deterministic attributed JSON → existing canonical intake and DB guards → bound keys/relationships → reader proof → finite baseline exhaustion plus arrivals. Each family is a checkpoint, not permission to stop. Preserve existing holds on historical sale/source corrections, paused jobs and new paid capacity. Private runtime/data receipts are in `/Users/skylar/nuke-logs`; refresh live ownership and progress before continuing.

| Repair | Delivery and demonstrated behavior | Remaining boundary |
|---|---|---|
| [PR600](https://github.com/sss97133/nuke/pull/600) | Existing `valuation_by_ymm` adds public `source_context`; implemented, tested, merged, deployed and anonymous-runtime-verified across three vehicle cohorts. | No new price admission, configuration matching or public UI. URL groups are not verified unique sales. |
| [PR624](https://github.com/sss97133/nuke/pull/624) | Existing `extract-mecum` adds a private, service-only `source_result_preview` using one exact retained capture and verified raw hash; implemented, tested, merged, deployed and runtime-verified. | Source claims remain unqualified. No capture-to-parent/event attestation or historical correction was admitted. |

The batch changed no tables, columns, constraints, typed evidence relationships or canonical
historical records. PR600 did replace an existing SQL function through an approved migration;
PR624 changed edge reader code. Distinguish reader delivery from a repaired persisted model.

For 1963 Corvettes the delivered public RPC returned **1,389 native presentations / 942 recorded
auction URL groups**, including 372 Mecum and 85 Barrett-Jackson, alongside **21 qualified price
records**. Native context omits amounts and is not price-qualified. Its population is all-time;
the price window is separate. Explicit historical knowledge requests withhold native context
where historical availability is unestablished. Twenty examples per venue are bounded evidence
drills, not the denominator; overflow withholds totals. Those populations cannot be subtracted to
claim a number of missing eligible sales.

## Preserve the question and the evidence grain

A marketplace listing first establishes a **blip**: source identity, retained text and images,
capture/recording clocks and attributed clues. It need not create an identified vehicle. Preserve
unresolved matches so later evidence can connect to it. A badge establishes a visible badge; an
engine specification supplied by a seller remains that seller's claim. The next question should
serve the current decision, rather than demand an engine builder's history before identification.

The reusable path is retained source → attributed claim → entity and relevant episode or role →
event and knowledge clocks → maintained measurement → reader. One vehicle can appear in multiple
sales. One sale can have multiple captures. A component can have different factory, installed and
later states. A reader must retain those distinctions when forming cohorts or claiming rank.

Keep broader evidence available for each supported purpose. A row lacking a qualified sold amount
may support a recorded presentation count. An undated presentation cannot establish volume in a
particular month. Movement needs compatible periods and coverage; liquidity needs exposure;
ranking needs a declared measure and denominator. A thin build slice should not erase the wider
model/generation market. The proposed high position of the 1963/427 remains a hypothesis.

## Work that remains

These are repairs to pursue through existing owners, not proposed parallel tables or permission
to admit held historical testimony. Verify the live vocabulary before selecting a representation.

| Priority and work | Existing starting point | Acceptance evidence |
|---|---|---|
| P0 Bind captures to entities and source episodes | `ingest-observation`, typed source attribution, vehicle/event identity owners and `archiveFetch` | A pinned hash-verified capture reaches the correct vehicle and auction episode. Two captures of one episode count once; two appearances of one chassis remain separate. Unsupported aliases and conflicting parent pointers stay unresolved. |
| P0 Preserve supported clocks | Venue extractors and existing event/observation owners | Scheduled civil run day, reported result day, actual closing/settlement time, capture time and recording time retain their own basis and precision. Unknown timezone or close time stays unknown. A historical consumer obeys knowledge availability. |
| P0 Reconcile result claims across venues | `extract-mecum`, the other venue extractors, canonical intake and sanctioned supersession | Amount, outcome, currency and fee basis have separate source support and refusal reasons. Sold, no-sale, bid-goes-on and an intermediate bid remain distinct. Original and contradictory claims survive. |
| P0 Bind auction video evidence | Existing Mecum broadcast lane, media observations and source-event/property attribution | Clip and timestamp drill to the retained claim, correct lot/event and permitted consumer. Report discovered, captured, extracted, landed, bound and usable coverage separately. The inspected 1967 S114 example does not establish 1963 coverage. |
| P1 Attribute configuration at the relevant episode | Existing specifications, image witnesses, component/build relations, property catalogue and cohort folds | Factory configuration, sale-time installed configuration and current state remain distinct. Each dimension returns match, mismatch, unknown or conflict with source and knowledge time. The badge-only engine case stays uncertain. |
| P1 Qualify nested cohorts and market measurements | `valuation_by_ymm`, `vehicle_price_facts`, existing cohort and market readers | Broad activity remains visible while price/build slices apply their own eligibility. Contributions, unresolved reasons, venue mix, dates and units survive. A non-Corvette case proves the mechanism is general. |
| P1 Connect the user-facing answer | Existing `/valuation`, market, agent/API and iOS consumers | The user can see broad context and narrower supported evidence, then drill to exact episodes/captures without assembling source comparisons manually. Counts and cutoffs agree with the supplying reader. |
| P1 Establish reliable arrival speed | Existing SQL/API readers and maintained folds | Measure the same bounded requests cold, warm and under declared concurrency; retain p50/p95, errors and payload scope after deployment. Fix the measured bottleneck. A timeout increase or one successful warm read does not close this work. |
| P2 Represent opportunity roles when in scope | Existing identity/relationship, ownership/transfer and market owners | Discovery/operator skill, capital, seller cooperation and buyer fit remain separate attributed roles. Costs, time and terms support any opportunity conclusion; price spread alone does not establish profit. |

Source/event binding is the next concrete model repair. UI and bounded profiling can proceed
independently where authorized. A complete price/rank claim depends on the missing source,
configuration and cohort support; do not present that claim while only its display is implemented.

## Resume the Mecum witness

The existing witness is [Mecum lot173892](https://www.mecum.com/lots/173892/1963-chevrolet-corvette-resto-mod/),
vehicle `b2414fd1-33eb-4911-bf14-2832ccc432f7`, native event
`efae4387-582f-45f2-b9ba-d70cf2325496`. This is a historical comparison and reconciliation witness;
it is not an established identity match to the marketplace lead. The retained source identifies
Kissimmee 2014, lot F208.
The repaired preview recovers **2014-01-24 as a scheduled civil run day**, not an asserted sale or
settlement instant. Parent custody, original currency and fee basis remain unestablished.

The dated native event had null `sold_at`, `ended_at` and `source_listing_id`, with no metadata
keys. The capture carried no parent attestation. A same-chassis source check supported a candidate
relationship, but that relationship was not admitted. The archived URL uses `www`; the native
locator does not. Exact URL lookup previously missed the capture. Preserve the original locators;
an alias candidate is not a universal URL-normalization rule.

The source also has distinct URL lot, source database, auction and lot-number identifiers. Do not
collapse their namespaces. The vehicle already retained a modified-engine description alongside
another engine scalar. This is a role/time/conflict question; an empty scalar or property FK is
not proof that the original description was lost.

Two owner boundaries matter:

- `ingest-observation` derives protected sale attribution through `source_sale_qualification`.
  The inspected qualification is BaT-specific. Generic caller-supplied `source_snapshot_id` is
  ignored. Extend the owning path when authorized; raw metadata or event writes do not repair it.
- `correct_vehicle_sale_provenance_batch(jsonb,text,text)` audits profile corrections. The
  inspected function does not bind/correct the native auction event and has no dry-run argument.
  Changing only `vehicles.sale_date` would leave this event reader's clock gap unresolved.

Locate and prepare the existing owner extension that can attest capture → parent → exact episode
and preserve the run-day basis. Prove that the intended consumer receives this relationship.
Keep unknown price units unqualified; do not fill an actual close timestamp from schedule text.

## Evidence and reusable code

Private receipts are outside the public repository under
`~/nuke-logs/market-evidence-hypothesis-20261004/`. If unavailable on another machine,
use the linked PRs and committed synthetic fixtures; retrieve protected evidence through the
authorized archive owner rather than copying raw captures into the repository.

| Location | What it establishes |
|---|---|
| `shared-reader/completion-receipt.json` | PR600 exact checked/merged commits, deployment, dated three-cohort results and initial timeout failures. |
| `shared-reader/corvette-full-reader-plan.json` | One measured warm full-reader plan; not a p95 or causal explanation of the initial timeouts. |
| `mecum-reconciliation/completion-receipt.json` | PR624 exact stages, checks, runtime and remaining limits. |
| `mecum-reconciliation/current-pin.json` | The specific retained capture, raw hash and expected run-day basis for the private replay. |
| `mecum-reconciliation/next-source-binding-plan.json` | Exact native clock/binding gaps and inspected canonical-owner limits; prepared, not written. |
| `mecum-reconciliation/after-runtime.json` and `after-anonymous-runtime.json` | One service preview succeeded in 1.427 seconds; anonymous access returned 401 without source fields. |

Reuse the actual owners and tests:

- [Mecum extractor](../../supabase/functions/extract-mecum/index.ts):
  `parseMecumSourceResultCandidate` and `action: source_result_preview`. The preview takes exactly
  one `snapshot_id`, verifies the raw hash and performs no source fetch, inference or writes.
- [Archive owner](../../supabase/functions/_shared/archiveFetch.ts): `readArchivedPage` supports
  `snapshotId` and `htmlOnly`; `readPinnedArchivedPage` owns protected attribution checks.
- [Canonical intake](../../supabase/functions/ingest-observation/index.ts): verify the current
  `source_sale_qualification` contract before extending it.
- [Focused Mecum tests](../../scripts/test-mecum-source-result.mjs): actual parser/handler/archive/auth
  paths with synthetic fixtures and an optional private capture replay. Use the installed frontend
  dependencies and `node --test scripts/test-mecum-source-result.mjs`. Private replay uses
  `MECUM_WITNESS_HTML`, `MECUM_WITNESS_PIN` and a fresh private `MECUM_WITNESS_OUTPUT`; it creates
  output without overwriting an existing receipt.
- [Candidate assay](../../scripts/assay-sale-population.mjs): existing explicit bounded subject/input
  modes locate unresolved candidates. It is a diagnostic, not price qualification or write authority.
- [Public-reader coverage assay](../../scripts/assays/public-reader-coverage.mjs): run through
  `scripts/check-ingestion-health.sh --public-readers` with a finite scope and private output.
  Its HTTP modes accept a current publishable key in `SUPABASE_ANON_KEY` or
  `VITE_SUPABASE_ANON_KEY`, sent through `apikey` without a bearer identity. Legacy anon JWTs
  must name the Nuke project and still pass server validation; privileged credentials never
  substitute for an anonymous read. A successful credential check establishes no population
  coverage: retain reader failures, unfinished pages and unknown eligible denominators.

Reuse the already pinned HTML parser instead of reconstructing script-tag grammar with a regex.
Do not repeat the failed `deno check --cached-only` invocation: the installed CLI rejected that
flag. Inspect installed tooling before adding dependency downloads or model calls.

### Typed specification projection assay, 2026-10-15

The same operator accepts `--family typed-specifications`. Use the existing
`public_reader_lineage_subjects_v1` manifest (`population` and `vehicleIds`) with
an explicit `properties: [{key, id}]` list taken from the inspected property registry.
It reads the existing `get_vehicle_specs(uuid[],boolean)` overload with
`p_include_typed_claims: true`, then checks each selected claim against
`get_field_provenance`. The older scalar `specifications` mode remains separate.

```sh
bash scripts/check-ingestion-health.sh --public-readers \
  --family typed-specifications --subjects /private/typed-subjects.json \
  --env /private/public-reader.env --out /private/new-typed-receipt.jsonl --max-pages 1
```

Each page gates at most 20 explicit public parents before any child read. The
default deadline is 15 minutes; set `--until` for a shorter run. The assay checks
declared scope, property/type/unit, selected observation, source pointer and URL,
values, microsecond clocks, original quotation and shared uncertainty qualifiers.
Receipts retain hashes, keys and reasons, without quotation payloads. Missing
claims or qualifiers stay unavailable/unmeasured; empty results cannot pass.
Exit 0 establishes only agreement of the requested current projections, never
independent registry ratification, source truth, physical configuration or readiness.

At 04:59:27 UTC the atlas estimated 1,017,178 stored vehicle records; full public
and eligible denominators remained unknown. A one-record control at 05:04:59–05:05:04
returned 11 typed claims and found all 11 selected observations in provenance,
with no mismatches. Missing projections/qualifiers prevented a complete match for
all 11: this is an incomplete result, not supported-answer coverage. The same
record's scalar reader returned eight rows, a different scope. No production
claim or supported-answer gain was created by this measurement. Private receipts
are under `/Users/skylar/nuke-logs/data-model-expand-20261015/`. Follow the observed
qualifier gaps into their existing reader owners; retain the separate curator and
replay holds on [PR1361](https://github.com/sss97133/nuke/pull/1361).

### Publisher-reported work assay, 2026-10-15

`--family reported-work` takes the same `public_reader_lineage_subjects_v1`
manifest. Per gated public parent it calls only the opt-in
`vehicle_build_log_public(p_vehicle_id, p_include_reported: true)` overload, then
drills each report to its parent listing on the anonymous `vehicle_observations`
route, constrained by source observation and vehicle. It never reads the private
activity child.

```sh
bash scripts/check-ingestion-health.sh --public-readers \
  --family reported-work --subjects /private/subjects.json \
  --env /private/public-reader.env --out /private/new-reported-work.jsonl
```

Per report it checks the fixed uncertainty (unverified occurrence, unknown
performer and intent, not independent), month precision and label, that the
performed clause is a prefix of the full sentence and carries no recommendation,
that four clocks keep their bases at microsecond precision, and that the parent is
a current native listing whose source, URL, capture witness and clocks agree and
whose text contains the exact sentence. One sentence on one listing page counts
once: a repeat is reported as `reported_work_repeated_listing_sentence`, never
corroboration. An absent overload stops as `reported_work_reader_absent`
(incomplete); zero reports is missing support; a withheld, missing or oversized
parent stays a gap. Source capability and protected admission are asserted by the
reader, not established by this route; capture authenticity, publisher truth and
physical occurrence remain unmeasured.

The source drill also preserves the v1/v2 witness's bounded source-wide refusal
for negated completion and governing proposed/recommended-work context. A reader
row that matches an isolated sentence in such a source fails as
`reported_source_completion_context_withheld`; matching text alone cannot discard
the surrounding qualification. This control does not establish semantic quality
outside the existing witness's context rules.

At 06:25:04–06:25:05 UTC on 2026-10-15 an anonymous control over the two first-admission
vehicles made two requests and stopped as `reported_work_reader_absent`: the held
overload is not deployed, so nothing agrees yet. Against a local PostgreSQL
fixture the assay accepted all four real reader rows and matched each to its
parent's sentence; against the earlier capture-grain reader state it flagged the
repeated listing sentence.

### Repeated captures of one listing page, 2026-10-15

A listing assertion's grain is one page (source, listing URL) and its projection
inputs, not one capture. BaT live reads re-capture an unchanged page roughly every
40 minutes, and the arrival trigger queued each capture for retained-property
projection, so the same claims were written again per capture. Bounded reads on
2026-10-15: all 101 description parents projected 05:37–06:37 UTC were word-for-word
repeats of an earlier queued capture (719 of 974 retained claims that hour); all 20
`html_match` parents in the hour to 06:42 repeated the nine projected fields; a
0.15% block sample found 38 of 40 current description captures repeating; on the
20 diagnostic vehicles 4,999 current claims stood for 286 listing assertions (one
repeated 367 times). The share of the 616,038 completed projection items that came
from repeats is unmeasured: three bounded samples hit the 10 s statement limit.

Visitors see it: `get_field_provenance` lists each repeat as its own source report.
The `typed-specifications` drill now counts these rows
(`typed_provenance_repeated_listing_assertion`, `repeatedAssertionObservations`); an
anonymous control at 06:47 UTC found 43 repeated rows behind three selected claims
on two vehicles. A repeat is neither corroboration nor a new claim.

The held repair changes only `trg_enqueue_retained_listing_properties()`: a
re-capture whose projection inputs equal an earlier current, queued capture of the
same page stays testimony and is not queued. Its contract is
`supabase/sql/test_retained_recapture_enqueue.sql`. Existing duplicate claims and a
provenance reader collapse are separate decisions (`get_field_provenance` is pinned by
held PR1361). PR1361's 703-entry replay frame is 82 listing assertions on 81 vehicles.
Private receipts: `/Users/skylar/nuke-logs/data-model-expand-20261015/recapture-load-measurements.json`.

## How to close the next repair

Start from a fresh isolated worktree. Select one useful source-to-consumer case and its relevant
disagreement case. Inspect only the affected atlas rows, current owner and indexed evidence.
State the missing relationship, row grain, source keys, clocks, units, writer and consumer before
choosing a schema change. Missing vocabulary belongs in the existing `schema_proposals` path.

Acceptance must cover the relevant risks: repeated capture versus resale; wrong parent versus
supported match; sold versus no-sale/intermediate bid; absent currency/fees; civil day versus exact
instant; conflicting configuration; unavailable historical knowledge; and public/private eligibility
in both totals and drill. Use retained evidence and local synthetic fixtures. Do not insert
synthetic production testimony.

Prepare and validate the concrete repair before requesting any authorization it still needs.
Historical intake and production source corrections, PR516/551/503/502, OWNER-OFF desktop intake
and paused jobs remain held as of this receipt. PR600's approval covered its one SQL reader
migration; it did not release those holds. This documentation request adds no schema/data,
access, contact, financing, scheduled-worker or paid-inference authorization.

Record implemented, tested, merged, deployed and runtime-verified stages separately, including
the exact checked head, changed owner, same-case before/after result and what remains unverified.
Count affected data at the repair's declared grain after admission, distinguishing unchanged,
superseded, unresolved and consumer-visible records. Do not label a reader's returned URL groups
as model changes or assume that one repaired witness proves fleet completion.

## Prepared historical supersession reader repair, 2026-10-12

The existing `valuation_by_ymm` reader selects archived sale interpretations using
the current `is_superseded` flag in two places. A local disposable fixture using
the deployed definition and the actual `supersede_observation_relay` reproduces a
fixed `known_at` result changing from eleven sales / 40.9091 percentile to ten /
45 after supersession. The successor has the same supported value: this isolates
temporal membership rather than claiming improved interpretation accuracy.

The prepared migration changes only those two predicates. In `known_at` mode an
original interpretation remains eligible before its finite recorded
`superseded_at`; at and after that instant it is withheld. All source/admission
clocks and other qualification gates still apply. Unknown/nonfinite supersession
clocks are withheld. Retrospective/current selection stays unchanged. The patch
checks the exact inspected owner definition, refuses drift, and permits an
identical retry without changing its owner, grants, settings or security mode.

The existing source-sale regression exercises actual tracked writer/reader
migrations with synthetic producer admission. It compares the complete earlier,
current and unaffected results except calculation execution timestamps, and
checks admission boundaries, before/at/after retirement, deterministic replay,
retained testimony, retry attribution and privacy. This is one eleven-sale
fixture, not fleet coverage, commit-availability or a full historical-model proof.

**Delivery hold:** review preparation and draft publication are authorized;
merge and production function application require separate owner approval.
Feature pushes and PR events cannot run `supabase-deploy.yml`: it applies on
`push` to `main` or explicit manual dispatch. A draft is reviewable code, not
deployed behavior. Existing schema/intake holds remain in force.

After explicit approval and successful applicable CI/review, use the existing
exact-head merge and deployment path. Before deployment, retain a private copy
of the function definition/hash and permissions, and pin one already-retained
qualified supersession pair with independently finite event, capture, admission
and retirement clocks. Record fixed reader parameters and full historical/current
receipts; do not create synthetic production testimony. If no admissible real
pair exists, leave the runtime claim unverified.

After the normal CI deployment, verify the deployed definition equals the
reviewed two-predicate replacement and that permissions/security settings match.
Read the pinned pair at the same pre-retirement cutoff and at/after retirement,
checking source IDs, successor admission, exclusions, totals and percentile.
Repeat with identical parameters and an unaffected subject/cohort; compare the
current result to its baseline. Retain private receipts and separate implemented,
tested, merged, deployed and runtime-verified stages. This reader repair adds no
semantic claims or modeled-fleet coverage; broader held-out accuracy remains open.

## Delivered public search pagination repair, 2026-10-13

**Merged in PR1016 and deployed by run 38407458224 on October 13.** The live
definition and preserved function identity/permissions match the checked migration.
The bounded anonymous Alvis sequence passed. PR1013 delivered API/UI cursor
consumption, and PR1027 restored the SQL reader's order after mixed-result sorting.
The final anonymous 94+100 continuation matched the SQL prefix with no overlap;
all 195 queried parents passed public eligibility. Anonymous browser search reached
194 loaded results and opened the first stable detail and source-claims panel.
These cases do not establish whole-population search quality or service objectives.
This repair establishes no new public-ready records or fleet coverage.
The existing `search_vehicles_fts(text,integer,boolean,integer)` reader
is the owner; no new production reader, table, count, grant or index is added.

The cached live definition applies the same offset and full limit independently
to exact-make and broader make/model branches. Its year-prefix branch can also
return the same vehicle again through the broader match. In a synthetic fixture:

| Request | Cached reader | Prepared repair |
| --- | --- | --- |
| 9 exact + 7 fallback candidates, limit 5 / offset 5 | 6 rows, skipping the first 5 fallback rows | Correct 5-row slice |
| Same population, limit 5 / offset 10 | Empty despite remaining fallback candidates | Correct 5-row slice |
| Year-prefix and broader-match overlap, limit 20 | 16 rows containing 6 duplicate IDs | 10 distinct candidates, highest matching branch priority |

[The migration](../../supabase/migrations/20261013090000_search_vehicles_fts_single_offset.sql)
carries one remaining offset and limit through bounded, ordered branch scans.
Year matches retain relevance 0.98, exact make 0.95, and broader matches 0.9.
Within each branch the existing order remains image presence, coalesced image
count, coalesced BaT/general views, sale price descending with nulls last, year
descending, then UUID. A full primary page returns before the broader query.
Higher-priority year matches are excluded from the later branch. No total count
is inferred from a returned page.

The patch refuses definition drift from the cached SHA256
`f77ef0a7a8512a87cf4bb11bcf4bb042958794566c8fcc6177f93277fd5bb7b3`, accepts an identical
retry, and verifies the resulting definition. CREATE OR REPLACE retains the
existing owner, ACL, security mode, settings and signature. Every branch also
requires `deleted_at IS NULL` and excludes `listing_kind = 'non_vehicle_item'`,
aligning search with the existing public vehicle-reader population. A null
listing kind remains eligible. The cached reader exposed those otherwise public
deleted/non-vehicle fixtures. Required identity fields and `is_auto_vehicle`
remain, unless the caller explicitly selects non-auto mode; the production
taxonomy classifier and its policy are unchanged.

Run `bash scripts/test-search-reader-pagination.sh` with installed PostgreSQL
(`PG_BINDIR` may select its binary directory). It creates and removes its own
Unix-socket cluster, uses synthetic data, and cannot consume a production URL.
The [SQL fixture](../../supabase/sql/test_search_vehicles_fts_pagination.sql)
executes the exact cached definition and actual migration twice. PostgreSQL 17.9
passed all offsets for page sizes 1, 2, 5 and 20 against hand-declared ID/relevance
oracles; ordinary eligible first pages remain identical. Tests also cover private,
deleted, non-vehicle and incomplete records, false/unknown auto decisions, anonymous execution, explicit
non-auto mode, empty/NULL queries, zero/NULL limits, invalid offsets, unchanged
catalog attributes and deployment refusal after definition drift. The same actual
SQL fixture and drift check run in the existing CI database-contract job. The classifier
is a declared fixture stand-in, not a test of the live classifier's taxonomy.

A separate 12,001-candidate fixture (6,000 exact + 6,001 fallback) reconciles every
ID with a 94-candidate first page, 100-candidate later pages and one-row lookahead,
including an offset-10,000 oracle check. Installed `auto_explain` confirms that
both baseline and patched full first pages execute only the exact branch: the
same make-index scan over 6,000 rows and 95-row top-N sort. At offset 5,999 the
patch consumes 6,000 exact candidates then 100 fallback candidates; the latter
uses the fixture's sequential scan and top-N sort. This is the fixture's
pre-index phase; its simple make index models the existing access path. The
separate index phase and its unchanged-ID comparisons are described below.

One local warm run with nested-plan logging took 2.118 ms before / 1.885 ms after
for the full first page, and 11.373 ms for the boundary page. These are synthetic
single-run diagnostics, not a production speedup, p95 or service objective.
Production's previously observed estimate of roughly 42,171 public Porsche rows
scanned and 19,594 eligible rows sorted motivated the separate index below.
Deep offsets still sort/visit preceding candidates and now decrement the offset
in PL/pgSQL. Separate HTTP requests do not share a snapshot: concurrent eligibility
or rank changes can still move records across pages.

### Separate exact-make index, delivered 2026-10-13

**Merged in PR1022 and deployed by run 38414268903 on October 13.** The normal
merge trigger did not appear; the existing exact-file deployment workflow applied
the reviewed migration from incorporating main. Live definition and valid/ready/live
flags were verified. The same anonymous Porsche requests changed from a 15,157 ms
SQL timeout to 252 ms / 101 rows, and from 16,666 ms to 409 ms at the search edge. These
individual observations establish bounded behavior, not fleet p95 or causal isolation.
The pagination migration does not build an index.
The separate [index migration](../../supabase/migrations/20261013110000_vehicles_public_make_search_rank.sql)
targets the observed exact-make scan/sort with this all-make access path:

```sql
CREATE INDEX CONCURRENTLY idx_vehicles_public_make_search_rank
ON public.vehicles (
  make,
  (primary_image_url IS NOT NULL) DESC,
  (COALESCE(image_count, 0)) DESC,
  (COALESCE(bat_view_count, view_count, 0)) DESC,
  sale_price DESC NULLS LAST,
  year DESC,
  id
)
WHERE is_public = true
  AND deleted_at IS NULL
  AND listing_kind IS DISTINCT FROM 'non_vehicle_item'
  AND year IS NOT NULL AND make IS NOT NULL AND model IS NOT NULL;
```

Its predicate matches the repaired public/YMM reader, including undeleted and
non-vehicle exclusions. Auto classification remains a residual predicate; no
immutability claim is made for that helper. No source rows, reader, ranking,
grants, service capacity, or server timeout policy are changed. The existing
`supabase-deploy.yml` uses `psql -f` without a wrapping transaction, as required
by `CREATE INDEX CONCURRENTLY`.

The migration uses 120 s statement and 10 s lock limits. Preflight refuses
existing lock waiters, idle transactions in the current database, active target
readers/writers, and other active index builds. These are point-in-time checks,
not a reservation that prevents later traffic. Existing same-name objects must
have the exact expected definition and ready/valid/live flags; an identical
retry retains the index. Conflicts and failed builds refuse for inspection.
Postflight checks the same structure/flags and lock waiters. There is no automatic
drop/rebuild or timeout increase. A failed concurrent build can leave an invalid
index; inspect and explicitly resolve that artifact before retrying through the
existing delivery path. The [PostgreSQL concurrent-build documentation](https://www.postgresql.org/docs/17/sql-createindex.html#SQL-CREATEINDEX-CONCURRENTLY)
describes the two scans, old-transaction waits and invalid-index failure state.

The owner's dated catalog sample on 2026-10-13 estimated 1,007,218 stored vehicle
rows, 2,531,074,048 heap bytes / 308,969 pages, and 11,314,577,408 total bytes.
The existing make/source index measured 55,304,192 bytes with approximately
676,918 entries. No inspected vehicle index referenced image presence, image
count or BaT view count; no index build was active at that observation. These
are retained metadata observations, not current deployment preflight or an
eligible-population census. The separate cached 632,014 eligible-record export
had maximum make length 50 and none longer than 256 characters; that does not
guarantee current or future key width. No truncation or extra population
exclusion is introduced to force keys into the btree limit.

The existing SQL fixture now applies the actual index migration twice and
repeats its complete 12,001-candidate reconciliation and hand-declared smaller
ID/relevance oracles before/after the index. Public, deleted, non-vehicle,
incomplete identity and unknown/non-auto controls remain intact. Ordinary
synthetic updates to image presence, counts, coalesced views, price, year,
make and eligibility maintain order and partial membership. The reader's full
catalog representation is unchanged.

On installed PostgreSQL 17.9, nested plans changed from a 6,000-row make-index
scan plus sort to a 95-row ordered rank-index scan for the same 95-result first
page, with no Sort or Incremental Sort node. At offset 5,999 the exact branch
still consumes 6,000 ordered rows; the broader fallback still scans and sorts.
One local warm run measured the repaired reader at 2.010 ms before / 0.188 ms
after index for that first page and 11.853 / 5.407 ms at the boundary. The index
occupied 760 kB in this small synthetic fixture. These measurements are neither
production speedup nor p50/p95, a storage projection, or a fleet coverage gain.

`bash scripts/test-search-reader-pagination.sh` also exercises live fixture
sessions for active-reader, idle-transaction, lock-waiter and active-build
refusal. A conflicting valid index is retained unchanged. A deliberately
oversized synthetic make causes the real concurrent build to fail and leave an
invalid index with the intended definition; an otherwise safe retry refuses
that state. No catalog validity flags are forged. CI's existing database-contract
job invokes the same runner with `--ci-service`, restricted to its localhost
disposable database; both paths assert the actual nested plan and drift refusals.

Image/view-count changes maintain additional index entries and can reduce HOT
update opportunities. The live index uses 40,681,472 bytes; exact structure and
validity and the bounded requests above are verified. Production write
amplification and broader cold/warm reader performance remain unverified. This index does not resolve
broad ILIKE/year-prefix scans, low auto-classification acceptance, or the cost
of large offsets. After any authorized checked delivery, retain exact index
structure/validity, size, lock state, and same-request before/after results and
plans; report the reader improvements separately from public readiness.

Future changes still require refreshed live definitions/permissions, applicable
CI and production checks. The receipts above establish their stated boundaries;
neither fixtures nor a bounded runtime case establish population readiness.

## Delivered exact retained-work assay aggregation, 2026-10-13

The existing `assay_retained_listing_properties()` returned `unavailable / read_failed`
with SQLSTATE `57014` while the scheduled worker was succeeding. Successful cron
executions do not establish completed claims or current custody. Two separately
bounded live measurements identified additive cost: the exact done count/distinct
pass took 2,126.345 ms for 498,013 done work rows, including a 9,760 kB external sort;
the existing 200-row custody check took 982.926 ms. Custody selection read only 101
entries from each end of the completed index. These are dated component timings,
not a sum measured from one complete assay invocation.

`20261013144500_consolidate_retained_listing_assay.sql` merged in PR1030 after all
24 actual checks passed or completed neutrally, and deployed through run38419105278.
The live definition and OID/owner/ACL/configuration match the reviewed migration.
It aggregates the entire work relation once by property/status and
derives the exact status, completed, failed, due, property and recent-completion
counts from that small result. Global `COUNT(DISTINCT observation_id)` remains a
separate exact pass. Custody selection/checking, the recent attribution join, JSON
shape and null behavior, source scan receipts, status rules, permissions and the
existing five-second function setting remain unchanged. No population cap, index,
table, stored counter, writer or resource setting is added. The guarded migration
accepts only the measured baseline or its exact already-applied replacement; the
latter is a no-op. Other definition/config drift refuses before replacement.

The existing retained-property PostgreSQL fixture now checks complete old/new JSON
equality on real replay, empty/incomplete/missing state, all work statuses, duplicate
result IDs across properties, exact recent cutoffs, private-parent withdrawal,
complete small-population custody and cancellation. Its `v_job_health` consumer
agrees, and the migration preserves OID, owner, ACL, configuration, data, indexes,
custody and public reader definitions. The same `image-projection` CI job runs it.

A disposable PostgreSQL 17.9 fixture also reconciles all 500,000 synthetic work rows
(498,000 done, 490,000 distinct results). At default `work_mem=4MB` and
`hash_mem_multiplier=2`, additive aggregation took 65.420 ms versus 137.598 ms across
the old component queries. Whole synthetic assay timings were 317.736 → 256.932 ms;
the reversed warm-order repeat was 323.038 → 253.421 ms. Temporary I/O stayed at
1,220 blocks read / 1,222 written. A grouped/hash distinct alternative was rejected:
148.607 ms and 4,842 temporary blocks written, versus 71.605 ms / 1,222 for the
original distinct query. No memory increase was used to hide that regression.

Those synthetic rows have missing custody parents, and their four-row observation
clock fixture tests recent-join semantics without rewriting immutable testimony.
The scale timings therefore do not model production custody cost, cold storage or
concurrent ingestion. Lifetime aggregation remains linear in retained work; this
repair does not guarantee the assay stays below its budget at every future size.
At 15:08:42 UTC the existing full assay completed within its five-second statement
limit (4,624 ms connector wall time): 504,750 done, 39 pending and six failed work
items, with 21 due. The existing 200-row custody sample had zero stale results;
full custody remains unverified. The returned health is `failed`, not healthy.
Source replay remains unfinished. This restores exact accounting, not fleet
readiness; preserve `unavailable` if a later read cannot complete.

## Identity source-witness population assay, 2026-10-13

The existing `public-reader-coverage` operator now has an identity acquisition
mode for a fixed, hash-verified population manifest. Its question is whether the
displayed year, make and model each have an attributed source witness through
the existing retained-listing custody owners. This is one evidence gate for
`find_open`, not a physical-identity judgment or release certificate.

```sh
bash scripts/check-ingestion-health.sh --public-readers \
  --identity-evidence /private/operator-config.json --out /private/new-segment.jsonl
```

The configuration embeds an existing population-reconciliation configuration and
declares `mode: public_identity_evidence_v1`, a finite request/time budget, batch
size up to 200, and a pause of at least 100 ms between requests. Optional `after`
selects the next manifest segment; it does not certify an earlier segment. The
runner verifies the entire original manifest before making any live request,
then reuses `q.sh` with read-only transactions, a 5 s statement limit and 1 s lock
limit. No schema, testimony, grants, worker capacity or source access changes.

Each batch exhausts the indexed active typed and legacy Y/M/M candidate paths.
Plausible retained-listing claims are enumerated with 100-key pages and explicit
lookahead, then checked by original-observation primary key through
`retained_listing_property_result_matches`. Public child/source eligibility,
property/method/profile, recording clocks and displayed-value agreement are
required. Year comparison is exact; make/model use trim and case normalization.
Unknown source-event time and unverified physical identity stay explicit.

Private subjects reveal no values. Failed/changed/oversized/incomplete batches
remain unassessed, retain retry ranges, and never become evidence of absence.
Two consecutive read failures stop the run. A bounded memory ceiling can stop a
dense batch; it cannot qualify a missing facet. Method-definition fingerprints
and identity fingerprints prevent silently combining changed inputs across pages.

After inspecting a failure, an operator can retry an exact saved interval with
`after` (exclusive) and `through` (inclusive). Both boundaries must belong to the
original fully validated manifest. The last batch ends at that key even when it
is smaller than the configured batch size; no successful neighboring records need
to be reread. `rangeExhausted` reports traversal of the selected interval, while
`collectionExhausted` still records failed collection. It does not imply that the
full manifest was visited: full-population counts, remaining keys, failure ranges
and the original denominator remain in the receipt. Time/request limits, custody
checks and the two-failure stop still apply. Preserve prior segment receipts and
verify their union before claiming a completed population measurement.

Private per-record receipts retain full candidate counts and up to three
qualified claim/source references per facet. Output distinguishes qualified
support, disagreement, invalid supported witnesses, unsupported methods, missing
support in the declared paths and incomplete reads. Legacy badges and filled
fields cannot pass; missing support in these paths cannot establish global
absence across other evidence owners. Terminal counts and hashes make incomplete
output distinguishable from a completed segment.

The dated full stored/public/eligible denominators accompany every summary.
Independent source-fidelity/semantic review, anonymous delivery, identity/context,
refusal controls, freshness and service remain separate unassessed gates. Thus
source-support gains cannot be reported as newly ready records. The private
full-manifest accounting control traversed 632,014 keys within a 128 MB heap;
its replies were synthetic and establish no production coverage. Production
population acquisition and its measured source-support distribution remain pending.


### Publisher-reported work with month precision, 2026-10-15

The next retained-evidence case asks what work a publisher reports, when, and by
whom. A deterministic diagnostic selected 20 retained source observations from
completed displacement work with native captures but no engine-family witness;
this is not a random sample or a fleet denominator. Two inspected public
vehicles contain month-dated work assertions in their retained descriptions,
but the existing anonymous build-log reader returned no work rows, and the
indexed observation lookup found no `work_record` rows for those two vehicles.
At 05:26 UTC the atlas estimated 1,017,178 stored vehicle records. Full public
and eligible denominators remain unknown; net supported-answer gain is zero.

The existing owners distinguish these meanings: `work_sessions` is the actual
work ledger, `work_record` is confirmed work, and `activity` can preserve an
unconfirmed action report. The local proposed integration uses an attributed
activity child tied to its original listing observation through the existing
source foreign key and protected `ingest-observation` path. Its selector accepts
only the source observation and a bounded report index; it derives the exact
source sentence, performed clause, month, capture witness and unknown performer.
A source month never becomes a fabricated day, and a recommendation never becomes
a reported completed repair. The bounded v1 grammar recognizes explicit action
and literal object phrases from inspected testimony; unknown phrases, qualification
tails and “and more” remain withheld. These source words establish no parts catalog
identity.

A report's grain is one sentence on one listing page (source, listing URL, exact
sentence), not one capture. On 2026-10-15 each of the two first-admission
vehicles held 15–16 non-superseded captures of a single listing page, all with
identical text. A later capture of the same sentence replays the existing report
(`duplicate`, zero writes); the custody trigger refuses a second current child
under an advisory lock, and the reader returns the earliest admitted report once.
When the admitted capture is withdrawn, a surviving capture may carry the report.
A different listing page is a separate publication of the sentence, not
corroboration.

The proposed required two-argument `vehicle_build_log_public(uuid,boolean)`
overload returns separate `work_records` and `reported_work` arrays. Its report
reader rechecks source custody and current eligibility; the one-argument reader,
general activity visibility and confirmed-work totals keep their existing
contracts. The table opts in to qualified reports and retains a legacy-reader
fallback when the overload is absent. Reported work preserves unverified
occurrence, unknown intent and performer, original quotation, exact source keys
and distinct capture/recording clocks.

This integration is **local preparation, held from production**. The registered
BaT source currently excludes `activity`. The held migration prepares an exact
six-to-seven-kind change on the existing source, adding only `activity` after
installing intake and database gates that require the protected report selector.
Other registry values, general activity visibility and unrelated source activity
remain unchanged. Applying that capability and releasing the new anonymous reader
scope require a concrete owner-reviewed decision. No production source capability,
testimony, permissions, queue or capacity changed.
The existing schema-proposal `add_source` path does not modify a registered slug,
so it cannot be used to evade that source contract. Local fixtures may simulate
the proposed capability to prove the actual handler and reader. Final checked
head, test receipts and release order belong in the private review packet before
any release decision: `/Users/skylar/nuke-logs/data-model-expand-20261015/REPORTED_WORK_PACKET.json`.

Local proof for this proposal passed 18 actual handler/PostgreSQL steps
(including the repeated-capture step, which fails against the earlier
capture-grain identity), 414 cached intake tests and 27 focused table tests. SQL and JavaScript agreed on all
20 retained diagnostic texts: five candidate assertions across four sources,
including withholding the vague “and more” assertion. Candidate detection is not
admission or independent corroboration. The fixture anonymous reader returned
three attributed reports and one unchanged confirmed-work control. Deployed Edge,
PostgREST and browser behavior remain unverified. The local withdrawal test
injects a late replay-boundary change; it is not a concurrent transaction proof.
