# Nuke

Nuke ([nuke.ag](https://nuke.ag)) is a data machine. It combines a model of entities and the
evidence about them with the computation that keeps running over that model.

Vehicles are the first entity in the model. One vehicle's history already runs through sales, shops,
places, parts, documents, money and time.

## A model that grows sideways

Most data products are catalogs: a fixed schema filled from the top down. Nuke grows from the bottom.
A bid, a comment, a photo, a receipt or a title transfer lands once in an append-only log. It is
then keyed to every entity it mentions: a vehicle, a lot, a place, a part or a document.

Each key opens a new path. A sale links to the vehicle's earlier sales, a part to every vehicle that
carries it, and a place to every sale near it. Paths branch and they cross. One sale sits in a
vehicle's history, a cohort's price curve and a venue's record at once.

There is no bottom to drill to. Resolution doesn't stop at the vehicle. It continues into
components, claims, time windows and the source behind each claim. The work is foraging: follow a key
to the next entity, and add a new source without redesigning what is already there.

## Nine layers

Every path through the data runs through the same nine typed layers. Each layer is a table with a
declared grain, key and clock.

| Layer | Holds |
|---|---|
| Log | append-only source events, each with an event time and an ingest time |
| Key | every text reference, resolved to a foreign key |
| Dimension | taxonomies built from evidence: generation, body, engine, color, options, place, part |
| Fold | state per entity, replayable from the log |
| Baseline | the expected value of a measure for a cohort as of a time |
| Residual | the observed value minus the baseline |
| Feature | a residual or fold indexed by entity and as-of time |
| Prediction | a feature set, a model version and a horizon |
| Outcome | what happened, joined back by key and clock |

The present is a fold over the log. The past is a replay: a new feature is computed for every past
moment from only what was known then, so it is graded honestly.

## Stacks

A **stack** is a named path through the layers that answers one question. Parallel agent sessions
develop them at the same time. A repair to a shared layer, such as a key, a clock or a dimension,
moves every stack that runs through it.

Examples:
- **The auction as an order book.** Every bid in the comments is a timed quote, and a stated "I'd pay
  X" is a reservation price. Folded minute by minute, each lot has a demand curve. Its residual
  against the cohort can show a thin top hours before close.
- **The car as a bond.** Value is modeled as use, maintenance and residual, from odometer readings,
  receipts and the cohort's price path.
- **Liquidity as an option.** Time-to-sale curves per cohort and venue. The gap between the price that
  sells in 14 days and the patient price is the option value.
- **Ownership as flow.** County-to-county transfers per cohort, compared with a gravity model, show
  where supply thins next.
- **Claims with relations.** A statement about a vehicle is weighted by its source, the source's
  relation to the vehicle at the time, and how the source's earlier claims resolved.

The registry holds 64 stacks as data, read from the live `v_stacks` view on 2026-10-07. Each stack
lists the layers it needs, and a coverage function measures them against the live schema. On average,
12% of a stack's needs exist today, and the rest is the backlog.

A stack shows its coverage before its numbers: how much of its universe it describes, what share of
that is keyed and dated, and which sources would close the gap. A prediction row waiting for its
outcome row is a thesis. A stack with an outcome ledger has a track record.

## Invariants

- **Append, never overwrite.** A correction supersedes the original, which is kept.
- **Bitemporal.** Every event carries the time it happened and the time it was learned.
- **Point-in-time correct.** A feature at moment *t* uses only events from before *t*.
- **Every reference is a key.** Text that names another entity becomes a foreign key to it.
- **The database describes itself.** Every column carries a comment with its meaning, unit, source,
  grain and clock. `v_schema_atlas` scores the schema and `v_job_health` scores the scheduled jobs.
- **No number without its denominator.**

## Built on

- **Postgres on Supabase.** The model lives in the database. Edge functions are in
  [`supabase/functions/`](supabase/functions/), and schema changes ship as migrations through CI.
- **Web**: [`nuke_frontend/`](nuke_frontend/) (Vite, React), deployed by Vercel.
- **iOS**: the capture app in [`apps/`](apps/).

## MCP: Nuke Asset Advisor

Read-only, citation-first MCP for agents (`https://nuke.ag/mcp/advisor` after deploy). Full connector remains at `/mcp`.

```json
{ "mcpServers": { "nuke-asset-advisor": { "url": "https://nuke.ag/mcp/advisor" } } }
```

Install for Claude Code, Cursor, and Claude Desktop: [`supabase/functions/mcp-connector/ADVISOR.md`](supabase/functions/mcp-connector/ADVISOR.md).

## Read further

| Question | Read |
|---|---|
| What is the model, in full? | [`docs/ledger/theory/data-machine.md`](docs/ledger/theory/data-machine.md) |
| What are the stacks, and what does each one need? | [`data-machine-cases.md` §13](docs/ledger/theory/data-machine-cases.md#13-aspiration-twenty-stacks-the-model-must-be-able-to-carry-owner-2026-10-06) |
| How do I work in this repo? | [`AGENTS.md`](AGENTS.md) |
| Which function does X? | [`TOOLS.md`](TOOLS.md) |
| How do agents install Nuke MCP? | [`supabase/functions/mcp-connector/ADVISOR.md`](supabase/functions/mcp-connector/ADVISOR.md) |

<details>
<summary>Daily measurements</summary>

<!-- stats:start -->
Measured 2026-11-13 04:28 UTC from the live database by [`scripts/data/readme-stats.mjs`](scripts/data/readme-stats.mjs), run daily by [`update-stats.yml`](.github/workflows/update-stats.yml). Rows are planner estimates to three figures; rates are block samples with their n. Read-only. Nothing here is typed by hand.

| | Rows | Coverage (sampled) |
|---|---|---|
| Auction comments (the auction log) | 25.0M | 95% author keyed to an identity · 8.9% sentiment-scored (n=49,871) |
| Bids | 4.99M |  |
| Observations (the fact log) | 14.6M |  |
| Images | 58.8M | 0.6% zone-classified · 0.4% vision-analyzed · 9.1% AI-processed (n=63,493) |
| Vehicles | 1.43M | 53% active · 32% with a VIN · 77% public (n=28,631) |
| Listings (BaT) | 176K |  |
| External identities | 958K |  |
| Organizations | 5.76K |  |

The database describing itself (`v_schema_atlas`, `v_job_health`): 1,719 tables (1,091 non-empty) · 6,420 of 41,364 columns described (16%) · 520 non-empty tables with no foreign key in or out · 5 tables with an undeclared writer in the last 30 days · 128 scheduled jobs active, 19 with a failure in the last 24 h · Postgres 17.6.

The stack registry (`v_stacks`): 66 stacks registered, 65 at status measured · 6 at coverage 0.9 or above · mean coverage 0.22. Coverage is the share of a stack's needs present in the live schema; partial needs do not count.

Invalid indexes in `public`: 1. An interrupted `CREATE INDEX CONCURRENTLY` leaves one that no query reads and, when ready, every write still maintains: `idx_vehicles_stale_listing_clock` on `vehicles` (not ready, 0 bytes).

Owner-run views in `public` that anon or authenticated can write through, past row-level security: 0. Allowed: `geometry_columns` (PostGIS view owned by supabase_admin; its insert, update and delete rules are DO INSTEAD NOTHING).
<!-- stats:end -->

</details>

<details>
<summary>Intake and processing rates</summary>

<!-- intake:start -->
Measured 2026-11-13 04:29 UTC from the live database by [`scripts/data/readme-stats.mjs`](scripts/data/readme-stats.mjs), run daily by [`update-stats.yml`](.github/workflows/update-stats.yml). Rows landed per complete UTC day at each layer. Landed counts are exact; columns marked ≈ scale up a page sample whose n is in the header. Read-only. Nothing here is typed by hand.

| Day (UTC) | Comments landed | Comments sentiment-scored ≈ (1% page sample, n=250,962) | Vehicles landed (BaT / Craigslist) | Images landed | Images vision-analyzed ≈ (0.1% page sample, n=65,999) | BaT lots read by the live pull (latest read per lot, so older days undercount) |
|---|---:|---:|---:|---:|---:|---:|
| 2026-11-12 | 15,340 | 0 sampled | 7,406 (278 / 445) | 307,618 | 0 sampled | 793 |
| 2026-11-11 | 14,200 | 0 sampled | 8,123 (221 / 397) | 312,538 | 0 sampled | 243 |
| 2026-11-10 | 14,242 | 0 sampled | 11,726 (317 / 413) | 288,511 | 0 sampled | 274 |
| 2026-11-09 | 14,407 | 0 sampled | 10,771 (135 / 504) | 243,918 | 0 sampled | 224 |
| 2026-11-08 | 7,579 | 0 sampled | 2,076 (86 / 451) | 61,677 | 0 sampled | 74 |
| 2026-11-07 | 10,021 | 0 sampled | 1,172 (130 / 535) | 46,689 | 0 sampled | 136 |
| 2026-11-06 | 12,701 | 0 sampled | 1,338 (203 / 549) | 60,733 | 0 sampled | 221 |

- **Live pull at measurement:** 0 of 1,403 live BaT lots are more than 2 h past their next scheduled read, and 0 live lots have never been read (`monitored_auctions.next_poll_at`, `last_synced_at`).
- **Source coverage:** 155,706 of 970,254 known listing targets extracted (16%), across 18 sources (`source_target_coverage`).
- **Clocks:** comments `auction_comments.created_at`, sentiment `auction_comments.analyzed_at`, vehicles `vehicles.created_at` split by `canonical_platform`, images `vehicle_images.created_at`, vision `vehicle_images.vision_analyzed_at`, live-pull reads `monitored_auctions.last_synced_at`, which keeps only each lot's latest read.
- **Sampled zeros:** `tablesample system` keeps whole pages at random, so a day's rows reach the sample 95% of the time only when they span at least 299 comment pages or 2,995 image pages. "0 sampled" rules out steady processing, not a small run.
<!-- intake:end -->

</details>

## License

Proprietary. See [`LICENSE`](LICENSE).
