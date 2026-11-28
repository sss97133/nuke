# Auction comment surface measurements

The existing `popup_vehicle_intel` owner has an episode-specific overload:

```sql
popup_vehicle_intel(p_vehicle_id uuid, p_auction_event_id uuid, p_request jsonb default '{}')
```

The one-argument vehicle reader is unchanged. The new overload computes deterministic measurements from retained source comments. It neither runs inference nor writes source, observation, fold, persona, or scheduling rows. This contract must be deployed and exercised anonymously before a consumer treats it as available.

## Grain and source eligibility

One vehicle UUID and one canonical BaT auction UUID are required. The parent must be public, undeleted, unmerged, and a vehicle. The lot must match that parent and have a supported canonical source URL and finite recorded close. Competing public lot bindings for the slash-normalized URL refuse the measurement. Private bindings are excluded from that comparison.

Inputs are rows keyed to the exact auction. A conflicting vehicle key or source locator refuses the reading. A missing comment URL can retain its typed lot relationship, identified in the evidence. Unkeyed comments are not assessed. At most 5,000 source rows, 4 MiB of text, and 10,000 stored media references are measured; exceeding a limit withholds features and evidence. Limits apply before lexical processing and snapshot serialization.

The event window uses the recorded close minus fourteen days, matching the existing order-book lower bound. This is not an observed opening time. Unknown/nonfinite event and recording clocks remain explicit coverage gaps. Source labels and bid markers are retained separately; they are not new semantic classifications.

## Two knowledge modes

- `{}` requests `current_recorded_state`: posted time is at or before the earlier of the read time and recorded close; database recording time is at or before the read time.
- `{"knowledge_mode":"recorded_input_reconstruction","cutoff":"2026-11-25T21:00:00Z"}` applies that finite, explicitly zoned cutoff to both input clocks, with event time also capped by the currently recorded close. This is a retrospective reconstruction from current rows, not a receipt that a forecast or feature was served then.

All reads are current mutable testimony. No frozen historical snapshot, source-availability clock, original scheduled close, settled transfer, or profit is established. A final sale price, vehicle specifications, and legacy persona outputs are not feature inputs.

## Features and denominators

Eligible discussion uses the source labels `question`, `answer`, `observation`, `seller_update`, `seller_response`, and `expert_opinion`, with no bid amount. It must satisfy both clock cutoffs. Its volume is partitioned into text-bearing entries, media-only entries, and entries with neither captured text nor media. Blank text with media references is not declared ingestion loss.

The SQL returns whitespace-separated token runs, median token count, literal question-mark counts/presence, URL markers, and a named English automotive numeric-unit pattern. These are surface features. A question mark does not prove a question, a unit marker does not prove expertise, and no literacy or human-ability rating is produced. Media references are stored strings, not verified images or admitted assets.

Seller flags remain source flags. Participants are distinct resolved `external_identities` keys on platform `bat`; unknown keys remain unknown, and equal handles are never unified. No commenter is declared a buyer or builder from prose. Existing persona and sentiment stores are neither republished nor averaged into these measurements.

## Evidence and continuation

The initial page contains up to twenty source contributions. `evidence_filter` accepts `all_discussion`, `text`, `media_only`, or `no_captured_content`. Evidence retains comment/auction/vehicle IDs, native source anchor when known, event and database clocks, source-label basis, measured features, and an attributed excerpt of at most 600 PostgreSQL characters.

A continuation supplies `offset` and `snapshot_hash`. In current mode it must also carry the initial `event_cutoff` and `recorded_cutoff`; reconstruction mode carries its original `cutoff`. The hash binds the method, keys, source close/URL, clock cutoffs, filter, and bounded source projection. It is a consistency check, not a signed or immutable historical witness. A changed source or filter refuses with `evidence_snapshot_changed` and no old contributors. Resetting the read obtains a new current snapshot.

An empty eligible set is a measured zero within those known inputs. Coverage gaps, unsupported bindings, and refused/capped readings are not zero activity or zero demand. A consumer must validate the method/version and display the text denominator separately from total discussion volume.

## Verification and remaining work

The native PG17 contract checks the old function body/ACL, invoker execution, named execute grants, private/deleted/merged/nonvehicle gates, source-key conflicts, media-only evidence, whitespace/Unicode, unknown/nonfinite clocks, delayed arrivals, pinned distinct pages, source/filter changes, malformed requests, input-size and 5,000/5,001-row boundaries, replay and drift refusal, anonymous execution, and unchanged caller timeouts.

The exact candidate SELECT was also executed read-only against three real public lots. It returned discussion/text/media counts of 38/30/8 (BMW), 25/25/0 (Subaru), and 74/69/5 (Sprinter), matching the separately inspected source assay. That proves candidate calculations on those records; it does not prove deployed RPC access or population coverage.

Production anonymous RPC verification and the existing auction evidence consumer are still required. Cohort-level rollups, calibrated semantic dimensions, historical prediction evaluation, and builder/reputation/profit measurements remain separate open outcomes.
