# Retained BaT captures into protected sale testimony

The source-sale qualification owner exists, but runs only for explicitly supplied
vehicle IDs. Cache arrival does not drive it. The next data-machine lane should
reuse that protected v1 intake, not promote unknown native results or implement
the held episode-v2 admission.

## Evidence and existing owners

Live October 8 00:03–00:15Z inspection: archiveFetch owns listing_page_snapshots;
ingest-observation owns protected source_snapshot_id/source_vehicle_event_id;
batch-extract-snapshots already routes service-only source_sale_qualification to
that intake. derivation_queue owns a piece-of-evidence x registered-reader work
grain and has an existing unique key, leases, attempts and observation references.
Its public-comment extension already admits a NULL user for a specific public
research lane. Its private-evidence dispatcher must retain its current work.

The other queues were inspected: bat_extraction_queue and
snapshot_extraction_queue are one row per vehicle, not per capture, and belong to
legacy profile extraction. extraction_repair_queue is a read-only view. They
cannot conserve multiple protected captures of the same parent.

An indexed first-50 inline BaT capture sample has 50 hashes, 12 parse clocks and
11 captures with matched, visible, real parents. The metadata catalog includes
vehicle_id, vehicle_matched, parsed_at, parser_version, auction_event_id, chassis,
vin_valid, mode, extractor and caller fields. Eleven actual pinned dry-run intake
requests qualified eight and refused three (conflict, current sale unknown,
ambiguous result); 0 writes/0 model calls. Successful request times were
307–644ms. This is a boundary sample, not a fleet coverage/yield estimate.

## Repair and grain

Extend derivation_queue with one exact registered deterministic route and typed
capture, vehicle and resulting protected-observation FKs. Add only one small
operational table: a finite cache-PK replay cursor and seed counters. It is not
testimony or another sale store. The public-parent/NULL-user route is constrained;
other work keeps its old owner rules and empty new columns. Direct API grants
are unchanged. The new service-only claim/finalize functions own this lane;
the generic dispatcher cannot claim it.

Retained capture metadata becoming eligible enqueues incrementally. The cursor
handles older material; at most500 indexed BaT keys are visited per batch while
pending work is bounded. A claimed request pins capture and parent. The snapshot
batcher's explicit queue mode processes at most20 captures, with a finite overall
budget and per-request timeout, then releases untouched leases. Source bodies,
metadata, profiles and native results are not written by this worker.

Only ingest-observation may derive/admit the protected sale. It independently
checks public real parent, pinned capture custody, raw SHA, supported parser,
clocks, exact agreement with the already-sourced current sold tuple and receipt
idempotence. Queue completion validates a same-parent/same-capture protected
observation and stores a typed result key. Refusals remain explicit; transient
failures retry15minutes and pause after3attempts. Expired leases are recoverable.

The existing cron credential helper and existing batch endpoint are reused;
no key is read into an operator log or added to the repository. A five-minute
schedule operates only this deterministic route. No model/provider/source fetch
or paid-intake activation. The cached reader and assay report visited keys,
eligible/settled/qualified/refused/failed work, immutable output references,
progress clocks and partial scope, rather than cron exit alone.

## Acceptance and limits

Test source FK/parent integrity, protected-result verification, private-lane
conservation, dry-run/write authorization, no AI fallback, unchanged evidence,
receipt replay, semantic refusal, transient retries/lease recovery, bounded
keyset progress and concurrent claim exclusion. Use synthetic PG17 constraints
and the actual handler/archive/intake tests. Ship one migration plus the existing
edge owner through normal checked PR/CI. Observe natural work and join admitted
receipt IDs back to unchanged captures and cached reader.

Unknown native amount/date/outcome, disagreeing captures and unsupported venues
stay unqualified. Existing historical/native intake, episode-v2, privacy and
publication holds remain. This closes automatic admission of currently supported
protected v1 testimony; it does not establish new historical event facts,
sale-time configuration, source independence or whole-market coverage.
