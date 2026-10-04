# BaT closing acquisition — October 4, 2026

Prepared implementation and focused tests. Not merged, deployed, or verified in
Nuke production. The minute/cap-three HTML workaround in the earlier draft is
superseded by the stream migration in this PR.

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

Production schema rollout requires the owner's explicit authorization under
AGENTS.md. After checked merge, existing CI applies migrations then deploys
`extract-bat-core`, `ingest-observation`, `sync-live-auctions`. Inspect locks,
live schema/function versions, actual subscribed coverage and receipt-to-intake
timing; then verify original Mustang observations/123000 result, final source
cache read and Realtime browser update. Leave unrelated owner holds intact.
