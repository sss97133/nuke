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

**2026-10-10 powertrain increment — implemented and locally tested; rollout pending.**
An indexed 30-parent listing sample retained `engine_size` in 30, `transmission` in 29 and
`drivetrain` in three JSON envelopes. The existing `ingest-observation` selector now supports
four already ratified core keys: `engine_configuration`, `engine_displacement_l`,
`transmission_type` and `drivetrain_layout`. The typed parent, original text, separate clocks,
normalization version and unknown factory/current roles remain attached. Database admission
and both existing readers enforce the normalized value against the current parent. The
provenance reader exposes the source text beside the normalized value. No new property
catalog, fact log or paid extraction is introduced.

The private preview yields 87 properties (28 configuration, 30 displacement, 26 transmission,
three drivetrain), with 33 absent or unresolved values. This is sample eligibility, not
production admission or fleet coverage. Checkpoints are: discovered fields → deterministic
JSON projection → canonical writer/DB guards → reader proof → owner-approved rollout and
bounded admission. Existing color replay/cron remains unchanged; automatic powertrain
backfill and retained raw documents that have not yet become JSON remain open work.

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
