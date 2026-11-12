# Vehicle header forms from machine items

Owner direction, 2026-11-11: the existing vehicle header is the banner. It takes
different forms when data establishes different situations. Do not add an auction
card or another identity header. Define and test the machine rules before changing
the renderer. Every visible datum first exists as a functional data item.

## Ownership and qualification

The existing source capture/admission path and sanctioned event writer retain the
native appearance. `vehicle_profile_read` projects it into `masthead.header_form`.
`organization_source_inventory_read` supplies the already-public active publisher
and current roster. No frontend event query, new property registry, ownership
inference, direct testimony write, grant, or RLS change is involved.

This adapter qualifies McCormick's existing `mccormick_live_v1` projection. Other
sources retain existing behavior until their native contracts are qualified. A
shared word such as “upcoming” alone does not qualify a source.

Require the exact native key/URL, a nonduplicate and unretracted appearance, current
public nondeleted vehicle parent, addressed unsuperseded listing observation from
the publisher, catalog lineage, and the existing day-precision scheduled-run-day
convention. The auctioneer relationship establishes representation for the
activity, never title ownership. A missing logo remains missing.

## Rules

| Evidence situation | Existing header's form | Supported interpretation |
| --- | --- | --- |
| Upcoming appearance, matching current roster, future run day | `auction_acquisition` | Advertised for auction; freshness qualified separately |
| Same relationship, scheduled calendar day reached | `auction_day` | Auction day; never infer live bidding or exact lot time |
| Elapsed run day, projection still reports upcoming | `auction_awaiting_result` | No inferred sale from date passage |
| Explicit terminal or continued-offer native status | `auction_result_context` | Reported sold, unsuccessful, cancelled and continued offer remain distinct; price qualification is separate |
| Retained future appearance absent from/inconsistent with current roster, or unsupported native status | `auction_context` | Current offer not established |
| Multiple equally ranked eligible appearances | `appearance_selection` | Preserve every candidate; withhold chosen appearance and price context |
| Retracted, duplicate, superseded or malformed lineage, or ineligible parent/publisher | No auction form | Disqualified association cannot advertise the car |

Rank current-roster appearances scheduled today first, then the nearest
future current-roster offer, then the latest elapsed appearance. Unmatched future
context follows. Never rank by generic database refresh time. Evaluate the entire
tied set, rather than comparing only two rows.

## Functional data items

These are projections over existing fields, not newly registered observation
properties. New testimony vocabulary still uses `schema_proposals`.

| Item | Existing field/owner | Functional tool |
| --- | --- | --- |
| `auctioneer` | `vehicle_events.source_organization_id`, public publisher identity | Open the organization; recorded name/logo, role auctioneer |
| `auction_state` | `vehicle_events.event_status`, current roster qualification | Open inventory; reported state, current offer qualification and freshness are separate values |
| `schedule` | `vehicle_events.ended_at` with scheduled-run-day/day-precision metadata | Open inventory; lot, sale key and civil run date; calendar-day countdown declares UTC basis, exact lot time remains null |
| `primary_action` | Existing `valuation_by_ymm` and canonical vehicle identity | Open `/valuation` with structured year/make/model/vehicle parameters; no invented candidate price |
| `hammer_estimate` | Existing `compute-vehicle-valuation` owner, purpose qualification boundary | Explicit unresolved estimate item plus market comparison action; no numeric hammer range until the preauction model/evidence relationship is established |

Each selected appearance carries source URL/key, observation ID, catalog snapshot
and hash, and separate source/roster check clocks. Freshness comes from the existing
roster reader, including failed refresh, rather than a frontend timeout constant.
`price_scope: appearance_only` prevents an old physical-vehicle sale from becoming
the pending auction's price. Ambiguous selection withholds price context.

The estimate connection remains open. An asking price, market distribution, stored
heuristic estimate or live-bid forecast does not alone qualify a preauction hammer
band. The renderer must not turn this unresolved item into a large placeholder or
hide another correctly qualified price role.

## Tests and delivery boundary

`supabase/sql/test_vehicle_auction_header_form.sql` applies the migration twice and
executes the actual injected profile query against read-only JSON fixture views,
with the retained inventory-reader baseline. It checks anonymous branding without
organization table access, parent/source qualification, retraction, supersession,
stale/failed refresh, disappearance, day precision, elapsed dates, native results,
chronology, full ties, internal action parameters and absent numeric estimates.
Existing profile/native-listing contracts cover unchanged rules.

From a checkout with the repository's PostgreSQL test prerequisites, run:

```sh
scripts/ci/run-db-contracts.sh test_vehicle_auction_header_form.sql test_vehicle_profile_read.sql test_native_listing_profile_evidence.sql
```

The normal database-contract CI job discovers the auction-header test; its
successful PR #3359 run explicitly executed it. That enforces this reader's
behavior. The broader instruction against UI bypasses is a repository construction
rule, not a claim that a universal design-enforcement gate exists.

The inventory reader filters canonical native identifiers to current roster
candidates before decoding large retained payloads. Unknown legacy identifier forms
retain their original matching path. All existing title, URL, parent ambiguity and
public-parent qualification remains in place.

The same reader has a native-ID scoped overload for the header. Its execution
permissions are copied from the existing reader; the existing one-argument API
delegates to the same implementation with no native filter. Header requests decode
only the addressed lot's candidate payloads, retaining cross-parent ambiguity checks.

These tests prove rules, not visual acceptance, source-wide readiness, calibrated
forecasts, archive completeness or estimate accuracy improvements. Retained real
data replay precedes renderer work. Search/maps/radar, buyer requirements/costs,
multi-car scenarios and the qualified estimate remain broader open outcomes.

## Delivery and portable pickup — 2026-11-11

The machine layer shipped in [PR #3359](https://github.com/sss97133/nuke/pull/3359),
merged as `46fa0781b4e31fbeed72da080a7d9cbf3043c5ed`. The normal Supabase
[deployment](https://github.com/sss97133/nuke/actions/runs/43059913962) succeeded.
An anonymous production API probe verified the real upcoming Bentley's selected
form and addressed roster binding, an absent parent and unknown native ID, and an
archived-result vehicle whose profile survives without becoming a current offer.
This is reader/runtime acceptance, not visual acceptance. The first adapter is
McCormick-specific; the construction rule applies to all product work.

**Next bounded implementation:** make the existing vehicle header and existing
structured data table consume `masthead.header_form.items` from the shared
`vehicle_profile_read` request. Keep each datum's primary owner, one primary
internal action, supported auctioneer branding, and the schedule's declared
precision/currentness. Do not restore the rejected separate prose card or add a
direct frontend event query. Start from refreshed main in an isolated worktree;
the original implementation worktree was removed after release.

**Acceptance:** on the real McCormick upcoming vehicle, a visitor can recognize
the auctioneer, auction offer and supported countdown in the existing header,
inspect the same addressed items in the data table, and use the actual internal
tool. Recheck elapsed/no-result, explicit result, stale/retracted/ambiguous and
private/deleted cases. Preserve the model/configuration key used by comparison.
The car/photo must remain immediately accessible. Verify the deployed interaction
and visual hierarchy; SQL tests alone cannot establish this acceptance.

**Still open:** the renderer; a purpose-qualified numerical preauction hammer band
and its evaluation; recorded source artwork; completed-auction reconciliation;
discovery/maps/radar; buyer requirements/costs; and multi-car acquisition scenarios.
Do not label a broad market distribution or an uncalibrated/live-bid model as a
qualified preauction forecast. No estimate-accuracy gain has been established.

Relevant original owner corrections, requirement-to-evidence receipt, anonymous probe and
known rejected approach are retained privately under
`~/nuke-logs/auction-header-machine-20261111/`, with the previous lane linked from
its `PICKUP.json`. Another checkout can discover the contract, executable tests,
deployed revision and next acceptance case from this repository without that local
folder. The case remains open under **C27 / §11** until its consumer is delivered.

## Facet items: every header token is a defined set of line items (2026-11-11)

Owner direction, 2026-11-11: "your job is wiring the header not just one off fixing.
the point of the design is to flush out the data with extreme prudence and accuracy";
on the transmission, "it should show what it was originally equipped with vs what it
has now and should discuss gearing etc ... should perfectly define that the heck the
transmission is"; on location, "we have an awesome map system its a shame we dont use it".

Each strip facet (`trim`, `body_style`, `engine`, `transmission`, `drivetrain`,
`location`) and each identity token (`year`, `make`, `model`) carries `items` from
`vehicle_profile_read`. The item list is the definition of the token. It is the same
for every vehicle; a vehicle differs only in which items are established. A click
renders these items; the frontend chooses no lead source, ranks no trust and folds no
sources.

### Item shape

| Field | Meaning |
| --- | --- |
| `key` | Stable item key, e.g. `transmission.current.model` |
| `facet` | `as_built`, `current`, `decode` or `derived` |
| `value`, `unit` | The value; `null` when missing |
| `status` | `established` (registry decode, receipt, owner-signed, or two independent agreeing sources), `reading` (one photo reading or transcription, witness attached), `claim` (attributed listing, seller or user statement), `conflict` (sources disagree; every side returned), `missing` |
| `sources[]` | Each: source slug and label, URL, method, observed_at, witness `{kind, id}` (image, receipt, document, observation) |
| `rule` | For decodes: rule key and citation URL (e.g. `gm_1972_1980_car_vin_v1`) |
| `equation` | For `derived`: expression and the item keys it reads; computed by the reader, never landed |
| `needed` | For `missing` or `reading`: the evidence that would establish it (e.g. "photo of the transmission ID stamp", "axle tag") |

### Item lists

| Token | Items |
| --- | --- |
| `year`, `make`, `model`, `body_style` | `decode` from the VIN under its chart (position and rule); recorded value; title/registration claim |
| `engine` | `as_built.engine` (VIN engine code under the chart); `current.family`, `current.displacement`, `current.block_casting`, `current.block_date`, `current.engine_code_stamp`, `current.heads`, `current.induction`, `current.cam`, `current.machine_work` (receipts, work orders); `derived.changed` (as built vs current, citing the change claim) |
| `transmission` | `as_built.type`, `as_built.model` (body tag, order code, build documents, owner statement as `claim`); `current.type`, `current.model`, `current.id_stamp`, `current.date_code`, `current.gear_ratios` (rule table for the identified model), `current.shifter`; `axle.as_built.ratio`, `axle.current.ratio` (axle tag or stamp, receipt); `current.tire_size`; `derived.final_drive` per gear and `derived.rpm_at_60` (equation over the ratio, axle and tire items) |
| `location` | `current.area` (ZCTA or city), sources (photo GPS fold: photo count and date range; listing location), `map` (ZCTA and bounds for the one map); public area grain only, never photo points |
| `trim` | Recorded trim; tribute rule (`tribute_badge_rule_v1`); factory trim decode where a chart exists |

Rule tables (gear ratios by transmission model, axle codes, engine codes and casting
numbers, body-tag codes) live in the database with their citations and are keyed by
make, model or code and year range, so every vehicle with the same evidence decodes
the same way. New testimony vocabulary goes through one `schema_proposals` set; a
missing key is reported as a missing item, never a page-local fact.

**Acceptance:** click every token on at least four vehicles (the 1973 Firebird
`20d21fb0-4651-4469-a0ba-e751309a1e54`, another 1973 Firebird, a listing-sourced car,
a thin-evidence car). Each shows only items, each item with its status and sources,
and each missing item names its evidence. No prose card, no bare count, no off-page jump.
