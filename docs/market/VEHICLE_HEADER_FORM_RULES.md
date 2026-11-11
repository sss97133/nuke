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
