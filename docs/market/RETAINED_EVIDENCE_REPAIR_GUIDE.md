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

The next implemented source expansion is `20261011050753_retained_native_description_year_projection.sql`. It retains the literal year and subject label from a bounded original publisher introduction, such as a2014 motorhome built on a2013 chassis, without reconciling those roles or inferring make/model. The original quote, protected capture fingerprint, unverified identity and unknown event/factory/current roles survive through the existing year selector, queue, source guards and readers at the existing0.6 cap. Thirty real qualified native introductions agree between SQL and JavaScript. The disposable PG17 proof covers101 baseline claims and a late arrival, exact public winners, source/property/parent/privacy withdrawal, preserved earlier custody and forged year/identity refusal. The native selector also passes the actual SDK/hash/dedup test;104 archive regressions pass. Production merge, deployment and natural-source proof remain pending. The same worker adds sanitized failure-stage counts to its existing response, distinguishing admission HTTP/receipt/exception failures from completion RPC/custody/exception/budget failures. Its tests preserve retry states, completion custody, attempt/time/concurrency limits and zero provider/model calls; stage counts describe failed operations rather than unique items or a historical root cause.

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

Reuse the already pinned HTML parser instead of reconstructing script-tag grammar with a regex.
Do not repeat the failed `deno check --cached-only` invocation: the installed CLI rejected that
flag. Inspect installed tooling before adding dependency downloads or model calls.

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
