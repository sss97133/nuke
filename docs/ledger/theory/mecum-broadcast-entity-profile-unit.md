# Mecum broadcast evidence to an entity profile

This review unit reuses `vehicle_observations`, `auction_events`, `publications`,
`organizations`, `observation_properties`, `pipeline_registry` and `relink_testimony`.
It adds no second source log, identity store, fold table or edge function.

The first case is the January 17, 2026 Kissimmee S114 presentation: catalogue
1159827, VIN 194677S101228, canonical vehicle
`12cde831-8981-471b-9631-588bc1251259`, presentation
`de832587-d233-4b83-bf76-4cefcb62ff84`, YouTube `c9fxArnD3IY`, publisher Mecum
`d2f587a0-5993-4d2c-9032-0fb3dd94d995`. The source became available January 24;
the event date does not provide a wall-clock time. October ingestion/identity
knowledge is a separate clock. Later May sale evidence cannot enter a January
source-as-of replay.

## Evidence produced and its limits

The offline reader uses 33 actual PK-verified source rows: 25 caption attribute
claims, seven overlay samples and one simultaneous physical-board sample. Six
overlay points qualify for the nominal-offset fit; the seventh has decoded-frame
alignment outside the declared tolerance. The endpoint display proxy is
60,000 USD / 54 nominal media seconds, or 1,111.11 USD/s. The overlay regression
proxy is 934.01 USD/s. These measure sampled display dynamics. Accepted bids,
true bid velocity, exact display-change times, active-lot duration, continuous
vehicle visibility, speaker identity and acoustic excitement remain unknown.
Eight caption cues cover 67 seconds of deduplicated cue bounds; this is neither
utterance duration nor auction duration.

The existing organization has 569 vehicle relationships and an indexed corpus
of 23,515 stored Mecum presentations. Only 3,279 have listing keys, 390 high-bid
values, 3,322 winning-bid values and nine broadcast labels. These are coverage
measurements of stored data, not a claim of complete auction history or verified
outcomes. Existing July organization intelligence still labels Mecum a dealership;
this unit preserves that older fold rather than overwriting it with an uncited
classification.

Two scoped derived observations already landed through the sanctioned existing
intake with the verified Mecum organization subject:
`6ab50cc0-e0ab-4336-a36a-3ab2d7bb69c1` and
`b08e59fa-4c1a-4c07-aaed-d31346a36012`. They carry the actual input source tuples,
proxy units, uncertainty and sample coverage. This is a live log receipt, not a
claim that the new typed subject key or native fold has been deployed.

## Staged native flow

1. Existing intake optionally resolves an exact `property_key`, checks declared
   kind, value type and unit, and verifies an organization subject UUID. The raw
   body stays unchanged. Legacy claims without a canonical property remain valid.
2. Reviewed keys join the source row to its carrier publication, presentation,
   physical vehicle and organization subject. `publications.organization_id` is
   the existing publisher bridge. YouTube carrier identity is distinct from Mecum
   publisher identity. The `relink_testimony` overload binds previously NULL
   context in place, preserves source identity and records its first binding
   system clock; retries do not create testimony or extra audit rows.
   Legacy numeric source offsets remain in their immutable source body: the
   contribution reader projects `media.start_seconds` only when the typed offset
   is NULL and the raw JSON value is numeric/nonnegative. Binding rejects a
   mismatched YouTube publication/video. No typed source clock or exact frame
   boundary is synthesized from that fallback.
3. `fold_broadcast_profile` updates only the affected presentation and publisher
   organization. Counter/sufficient-statistic deltas preserve separate display
   instruments. Supersession removes the old contribution. Derived profile outputs
   never feed back into the input measure. The existing privacy predicate excludes
   private testimony from public aggregates; all 33 actual demonstrated inputs
   passed that live predicate.
4. `drain_broadcast_profile_queue` replays flagged presentations, compares the
   rebuilt state and adjusts only that presentation's organization contribution.
   The scheduled budget is 20 presentations, at most 50 per call, with 5,000 inputs
   per presentation. Oversized work stays dirty and retains its complete existing
   foreground state. The result exposes processed inputs, deferred work and drift.
   It does not rescan the whole platform or source log.
5. `read_broadcast_entity_profile` and the existing observations GET endpoint
   return the public organization fold, typed derived subject claims and attached
   presentation folds/input watermarks. Output ownership is declared in the
   existing registry. The native reader serves current state; historical native
   replay is explicitly unfinished, despite independent availability/ingestion
   filters in the offline reader and preserved binding clocks.

## Review and deployment boundaries

The second migration depends on the first key/strict-attribution migration.
Deploy migrations before either modified edge entry point. A canonical YouTube
publication must first be registered through its reviewed writer with the verified
Mecum organization publisher. Existing citation/profile rows remain immutable;
attachment uses the sanctioned primitive.

The source-derived vocabulary review names five reusable existing properties and
two earned price-evidence properties with actual motivating observation IDs.
All 38 current registry properties exclude `media`. No property is invented or
auto-ratified by this patch. A 427-cubic-inch claim cannot bind as 427 liters.
Existing `schema_proposals`/review commons handle the proposal; live
`fn_schema_proposal_apply` leaves `modify_property` to a curator. Speaker identity
stays NULL until direct evidence earns a link to the existing identity commons.

`community_events` is a possible existing auction-session entity and has an
organization FK, but its mandatory exact start timestamp cannot represent the
date-only session without reviewed precision work. A session bridge, true accepted
bid grains, voice roles, room/venue subjects, cohort baselines and residuals are
open branches, not completed outputs. The existing market event remains `live`;
this draft does not overwrite outcome, high_bid, winning_bid or bid_history.

Native PG17 execution is local and synthetic. Production scale, index/lock/runtime
assays, publisher ownership, schema approval, CI deployment and actual attached
replay remain separate gates. No production DDL or new production fold writes
were performed in this lane.

The input cap bounds replayed contributions. The per-event query plan and read/sort
cost over a larger production event still require measurement; this draft does not
claim a production latency guarantee from the local boundary test.
