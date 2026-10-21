# BaT closing acquisition — October 4, 2026

PRs 565 and 566 are merged and deployed. The owner explicitly approved PR 566's
schema rollout at checked head `0e98bbc41` (full head recorded in PR 566).
Supabase deployment run 37232927835 applied the migration and deployed all three
affected functions. The minute/cap-three HTML workaround is superseded.

At 20:46 UTC, runtime health exposed 63 unresolved clock-retired lots and no
subscriptions. Their board sale_status had already become not_sold, so the
auction_live-only board recovery selector missed them. The follow-up migration
resumes recent existing monitors independently of board status and HTML gates,
until a qualified same-source terminal result. Its PG17 regression passed;
PR 576 merged as `254499406` and deployed through Supabase run 37234778070.
The minute reader selected all 62 remaining lots at 21:08 UTC. By 21:11 UTC
they all had sourced terminal outcomes; eligible/missing counts were both zero.
This is late recovery of the interrupted closing session, not live-close proof.

The 62-lot backfill exposed a control-loop stall: the admission queue drained
before another heartbeat or protocol ping, causing public_socket_heartbeat_missing.
The bounded follow-up lets admission drain independently while socket controls
continue each second. FIFO receipt order and the canonical intake stay intact.
Its blocked-admission regression verifies continued pings/connected heartbeats;
production rollout and timing verification of that repair remain pending.

The existing source reader recovered the reported Mustang at 20:49 UTC:
canonical sold result 123000, buyer robsq22, native sold_at 17:39:28 UTC,
14 bids. The anonymous production profile showed SOLD $123,000 after reload.
The open page received pulse updates but other auction readers retained stale
data; PR 577 fixes shared price/comment/sequence invalidation and is merged,
with production deployment still pending at this evidence stage. No waiting production locks.
Live-second performance under production closing load remains unmeasured.

The reported Mustang (`45122195-393d-4c00-83a2-5b517ae9ce44`, BaT post
`119935516`, lot 266577) was last read at 16:45 UTC with $118,888 and ten bids.
The monitor retired at its scheduled 17:36 deadline; its next read was 17:45.
BaT published $121,000, $122,000 and $123,000 bids, then its $123,000 sold
record at 17:39:28 UTC. Its public recovery endpoint returned 110 comments and
14 native bids at 19:18 UTC. This is late recovery, not live-capture evidence.

Independent passive observation of post 122706961 captured live bids,
extensions and the $33,000 result. A $31,000 bid with native timestamp
18:01:38 arrived at 18:01:39.011 UTC. The sold system comment timestamped
18:08:34 arrived at 18:08:35.245. Public source events have no universal
sequence/publication clock. Never claim exactly-once source delivery or invent
publication time for metadata, extension, likes or stats frames.

## Existing capabilities and ownership

`extract-bat-core` remains the BaT acquisition entry point. No new Edge Function,
source account, paid service, cron, or model call. Existing `bat-live-pull`
dispatches one multiplexed public WebSocket worker each minute. Workers last
115 seconds, overlap, and subscribe to every eligible lot, independently of
the three HTML fallback slots and their in-flight governor. The closing window
begins 15 minutes before the latest sourced end and continues until a native
terminal record, plus two minutes of conversation after that record.

Native post IDs already exist in `vehicles.origin_metadata.external_id` from
the canonical `bat_auctions_page` producer. Missing/mismatched locators remain
unobserved and fail coverage; one bad locator does not stop good lots.
More than 200 eligible monitors refuses the capped read and fails coverage.

```
BaT public Pusher (single/stats/list channels)
  -> extract-bat-core live_stream
  -> ingest-observation bat_live_events_v1 (service only)
  -> ingest_bat_live_events (private atomic RPC)
     -> vehicle_observations: immutable original frame, source/receipt/DB clocks
     -> auction_comments: native-ID dedupe and canonical participant identity
     -> auction_events + vehicle_events + monitored_auctions: current fold
     -> fresh extract-bat-core final read: existing sale provenance writer
  -> existing vehicle_events Realtime subscriber -> direct browser pulse
```

The existing `update_auction_state` RPC cannot serve this intake: it logs
receipt-time bids to parallel `bid_events` and closes on a scheduled deadline.
The private atomic admission RPC therefore extends the existing intake rather
than reviving that alternate writer. `monitored_auctions.stream_state` is a
derived control/fold column, registered to `ingest-observation`. Native source
testimony stays in the existing immutable log. Earlier core HTML writes cannot
overwrite a newer native projection; its guard checks the actual capture clock
or a same-transaction immutable receipt. Vehicle sale caches continue through
the existing provenance/correction writer on a fresh final read.

Closing HTML fallback comments use this same locked intake with explicit
`direct_html` provenance, avoiding the legacy comment/profile INSERT race.

## Clocks, delivery and health

Native comment timestamps are preserved as observed event time. Other frames
use explicit collector receipt time with publication unknown; DB `ingested_at`
is assigned by the database. Raw frames preserve every delivered source field;
the previous observed scheduled end is retained with each admission. Native
comments dedupe across reconnects/overlap. Other frames lack source event IDs,
so equal payloads dedupe within five-second receipt windows; distinct receipt
windows and changed payloads remain observations.

The receive queue flushes every second and retains its unacknowledged prefix on
failure. Public protocol ping and collector coverage heartbeats run every
second. The current coverage assay fails after three seconds without a current
subscription, or when acknowledged intake stalls over two seconds. These are
targets until production timing is measured. A successful cron alone cannot
pass `v_job_health` for this source. No eligible lot is `idle`, not fleet proof.

Reconnect uses BaT's public `bat_listing_missed_comments` JSON endpoint and
current metadata. Native bid/comment/result recovery does not reconstruct
missed non-replayable extension/stat/like frames. A buffer overflow or network
gap is a real capture failure, never an asserted complete historical dataset.
Unqualified native comment clocks/identity preserve raw testimony and fail the
projection assay instead of inventing posted-at values or poisoning every lot.

Only the current `vehicle_events` cache is added to the existing Realtime
publication. Its existing public-read/service-write RLS and grants are
preserved. The large comment log is not published. Browser pulse uses the
delivered row directly, with native bid/comment clocks and final price, instead
of fetching again or waiting for the 60-second fallback refresh.

## Native timing diagnostics, delivered October 21, 2026

The existing collector emits `bat_live_collector_start_v1` and
`bat_live_collector_end_v1` with a generated control-plane `collector_run_id`.
Existing native intake requests carry that ID, a sequence and `native_collector=1`.
At most twelve requests per worker request `bat_native_intake_timing_v1`, separating
authentication, monitor/source/parent validation reads, preparation and canonical
RPC duration. SDK fetch counts and runtime-limit counts apply only to the sampled
native operation. The service-role guard still runs before diagnostic labels are
accepted; the labels confer no authority and never enter source testimony.

Start/end records expose selection/authentication timings and transport attempt,
backoff, acknowledgement-processing and unfinished-work counts. They contain no
source payloads, prices, credentials or headers. Attempt counts include retries and
duplicates. A missing end record does not prove an empty queue or a completed worker.
Use a bounded six-consecutive-start window with full lifetimes (eight-minute ceiling),
then correlate existing dispatch metadata, native gateway timings and coverage
predicates. A dispatch response alone does not establish collector survival;
sampled timings and health snapshots do not establish continuous capture. No new
fetches, scheduler/budget changes or additional telemetry tables are introduced.

## Canonical collector preparation, October 21, 2026 — architecture hold

The bounded diagnostic delivery established a repeatable nested Edge-call ceiling;
current capture integrity still fails. The documented budget is 30 calls per trace
per 60 seconds, incompatible with one-second cross-function coverage before frames.
The prepared service-only `bat_live_collect_v1` mode keeps the 115-second collector
inside `ingest-observation`, where each batch calls existing `ingestBatLive` with
fresh monitor/source/parent reads and the unchanged canonical RPC. Core's prepared
second step makes one authenticated handoff. Deploy intake first, then core, only
after specific approval of this execution-owner change; normal CI is the only path.

Only `mode` and optional boolean `dry_run` are accepted. Caller targets, URLs,
credentials, duration, concurrency and retention overrides are refused. Dry-run
and idle start no background task, source request or write. Dry-run preserves the
existing service-only target manifest. Live acceptance returns a run ID and count;
it does not promise collection completion. Every batch has its own SDK diagnostics
and ten-second deadline, independent of the completed incoming handoff signal.
The selected identity is a negative fence after fresh reads, never cached eligibility.
A changed post, vehicle or URL refuses the old channel's coverage as well as frames.

Local acknowledgement still waits for canonical success. Transient failures keep
atomic prefixes without per-lot retry amplification; semantic failures can isolate
poison. Independent frame/coverage lanes, per-lot FIFO, 50/200 ceilings and duplicate
replay are preserved. Failed cleanup emits a terminal diagnostic and retains the
unresolved state. The first rollout's compatibility adapter keeps current core
behavior until the reviewed handoff step; the legacy batch endpoint stays available.

No schema, grant, source budget, cron cadence, worker lifetime, capacity, retention
or episode-v2 change is included. Recovery-generation correctness, dispatch bunching
and RPC tail latency remain open even if the nested-call bottleneck is removed.
Source-wide readiness, historical continuity and supported-answer gain remain unproved.

## Focused evidence

- Six deterministic Deno tests: captured source records, clock qualification,
  replay/source mismatch, cancellations, no-loss retry, all 20 simultaneous lots.
- Disposable PG17 intake/fold tests: atomic admissions, replay, participant
  identity, final result, stale HTML races, immediate final read, private RPC
  privileges, current-cache publication, green-cron/missing-feed failure,
  acknowledgement backlog failure, and all 20 lots despite HTML cap three.
- Actual new collector connected to public Pusher, sustained one-second
  heartbeat/ping for 30 seconds and recovered the native sold record. Local
  evidence only; zero source/database writes.
- Source/core extractor passes Deno check. Full three-entry check has the same
  15 pre-existing errors as refreshed main (three intake typing errors, twelve
  live-board typing errors); new modules typecheck. CI guardrail gate passes.
- Companion UI tests/typecheck cover canonical rows, extensions, pending
  result, native clocks and source-confirmed sold price.

Reproduce without network or production access (installed Deno and PG17):

```sh
deno test supabase/functions/_shared/batLiveEvents.test.ts
deno run --allow-write=/private/tmp/nuke-bat-prepared-fixture.json supabase/sql/prepare_bat_public_live_fixture.ts
# The SQL refuses any database except the disposable nuke_soft_close_test.
psql -d nuke_soft_close_test -f supabase/sql/test_bat_public_live_events.sql
```

Production schema rollout received the owner's explicit authorization under
AGENTS.md. After checked merge, existing CI applies migrations then deploys
`extract-bat-core`, `ingest-observation`, `sync-live-auctions`. Inspect locks,
live schema/function versions, actual subscribed coverage and receipt-to-intake
timing; then verify original Mustang observations/123000 result, final source
cache read and Realtime browser update. Leave unrelated owner holds intact.
