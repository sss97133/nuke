# Source-aware acquisition

Owner direction, November 11, 2026: the McCormick organization roster and the
2008 Bentley profile must help a buyer act before the auction. An imported car
is an acquisition candidate, with a state derived from its source appearance.
The profile should persist after that appearance ends.

This extends MARKET_MEASUREMENT_UI_CONTRACT.md; it does not qualify new money,
turn an auctioneer into the vehicle owner, or authorize transactions.

## Source state

Read the existing vehicle × venue × listing episode in `vehicle_events`, not
the vehicle's most recent generic write or an earlier sale of the physical car.
Retain the source URL/native key, lot, auction dates, date precision, source
observation clock and auctioneer organization. A typed upcoming auction
appearance establishes an advertised offer. It does not establish the private
seller's identity, title, inspection findings or a bid.

The current profile presents the auctioneer, scheduled lot day, day-precision
timer, venue, source check and deliberate Sources access. Known representation
replaces the misleading orphaned-profile notice; VIN verification remains an
acquisition question. The header uses auction state rather than undated
activity. A date passing produces awaiting-result, never an inferred sale.
Explicit sold, no-sale and withdrawal evidence resolve distinct states.
Disappearance and refreshing an old page are not new outcomes.

## Price band

The target is a dated, versioned prediction interval for the final hammer,
conditional on a sale, alongside the separate probability/outcome of no sale.
It must declare currency, fee basis, evidence cutoff, model and eligible
comparison population. A no-sale high bid is not a hammer transaction.
An observed sale-price distribution is a separate display, not the prediction.

Unknown specification, mileage, service history and condition contribute
uncertainty. Receiving consistent independent evidence may narrow the interval;
correction, conflict or an adverse inspection may move or widen it. Counting
filled fields or adding a fixed confidence bonus per input cannot measure this.
Preserve each revision with its evidence so the buyer can inspect what changed.

Use the existing estimate/prediction owners. Before enabling a pre-auction
numeric forecast, freeze knowledge before each historic appearance and compare
with qualified final outcomes. Hold out physical vehicles and sale events to
avoid leakage; compare with the existing baseline. Report interval coverage,
width and error by venue, vehicle segment, evidence quality and forecast horizon,
with support counts and unknown outcomes. Calibration on live BaT bids does not
establish pre-auction McCormick accuracy. The existing model's heuristic interval
is not a measured probability interval. Unsupported intervals remain unavailable.

## Finding and preparing an acquisition

Search, the brand/model radar, retained listings, calendars and maps need to
consume the same source episode and state. A scheduled auction venue is a
different location role from the car's confirmed present location. Display
that role; never manufacture a vehicle-location observation from a venue.
An ended auction should retain its source, revisions, comparisons and result.

The lot opens an inspection inside Nuke, preserving roster filters and position.
Qualified recorded sales expose dates, amounts, units, fees and actual records.
Source documents are deliberate supporting links. Buyer preparation can assemble
the auctioneer's registration, payment, inspection and removal requirements with
their source and effective/check dates. The current pages are not a signed buyer
contract. Submission, signing, payment and seller contact are distinct actions.

A possible deal needs an acquisition price or proposed bid, a supported value
reference, fees and a cost/uncertainty allowance. No bid does not mean a free car.
Multi-car acquisition scenarios must retain each lot, outcome dependency, fees,
transport and capital constraints. Shared transport savings require actual cost
evidence; summing independent intervals does not establish a bundle confidence.

## Acceptance

The Bentley and representative other lots show their source-backed state and
timing in the actual profile. A buyer can inspect market records, follow a mark
to evidence, and return to their roster. Source-only stock remains inspectable
without a fake vehicle ID. Terminal, missing-date, duplicate, changed-source and
failed-reader cases remain explicit. Check the same cars in search and relevant
maps/radar; an inventory row or a green build is not discovery acceptance.

Open outcomes remain: a calibrated pre-auction band and revision reader,
cross-surface episode/location-role propagation, radar/deal qualification,
multi-lot planning, effective source-terms admission and completed-result
reconciliation. The UI source-state repair alone does not complete them.
