# Nuke

Nuke ([nuke.ag](https://nuke.ag)) is a data machine for physical assets. It keeps every observation
about an asset with its source, its clocks and its trust. State, baselines and predictions are
computed from that log, point-in-time, so every number can be replayed and graded.

Vehicles are the first asset class. One vehicle's history already runs through sales, shops, places,
parts, documents, money and time. Artworks and automobilia are the second. They differ from vehicles
in their identity key and in the events they carry, and they run through the same layers.

## Observation, not knowledge

A language model holds knowledge. It compresses everything it read into a generalization, with no
timestamps and no sources. A fluent answer can be wrong, and the model can't tell which. It was also
trained after the fact, so it can't say what was known on a given day.

Nuke holds observations. Each one records what was said or seen, from which source and when, exactly
as it was recorded. A correction supersedes an observation and never erases it, so the record of what
was known at any moment survives.

The two sit at opposite ends of a spectrum: generalization at one end, record-keeping and provenance
at the other. A model is useful here as one more observer. It can read a photo, a comment or a
receipt and propose a claim, and the claim is kept as testimony with its reader and its evidence. The
design rule is that a claim becomes a fact only by agreement across independent readings, by a
document, or by the asset owner's confirmation.
[`data-machine.md`](docs/ledger/theory/data-machine.md) states each rule of this kind beside the
mechanism that enforces it, or says that none exists yet.

## A model that grows sideways

Most data products are catalogs: a fixed schema filled from the top down. Nuke grows from the bottom.
A bid, a comment, a photo, a receipt or a title transfer lands once in an append-only log. It is
then keyed to every entity it mentions: a vehicle, an artwork, a lot, a place, a part or a document.

Each key opens a new path. A sale links to the vehicle's earlier sales, a part to every vehicle that
carries it, and a place to every sale near it. Paths branch and they cross. One sale sits in a
vehicle's history, a cohort's price curve and a venue's record at once.

There is no bottom to drill to. Resolution doesn't stop at the asset. It continues into components,
claims, time windows and the source behind each claim. The work is foraging: follow a key to the next
entity, and add a new source without redesigning what is already there. The second asset class
arrived that way. Auction lots of artworks and automobilia landed as entities with their own
observation log, and the vehicle tables were not redesigned.

## Nine layers

Every path through the data runs through the same nine typed layers. A table in any layer is meant
to declare its grain, its key and its clock.

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

The registry holds the stacks as data, in the live `v_stacks` view. Each stack lists the layers it
needs, and a coverage function measures them against the live schema. The number of stacks and their
mean coverage are in the measurements at the bottom of this page. What is not covered is the backlog.

A stack shows its coverage before its numbers: how much of its universe it describes, what share of
that is keyed and dated, and which sources would close the gap. A prediction row waiting for its
outcome row is a thesis. A stack with an outcome ledger has a track record.

## Invariants

The design rules for every table and reader:

- **Append, never overwrite.** A correction supersedes the original, which is kept.
- **Bitemporal.** Every event carries the time it happened and the time it was learned.
- **Point-in-time correct.** A feature at moment *t* uses only events from before *t*.
- **Every reference is a key.** Text that names another entity becomes a foreign key to it.
- **The database describes itself.** A column's comment states its meaning, unit, source, grain and
  clock. `v_schema_atlas` scores the schema and `v_job_health` scores the scheduled jobs.
- **No number without its denominator.**

A rule holds only where something enforces it. These do today:

| Rule | Enforced by |
|---|---|
| An observation without a source is refused | the trigger `trg_citation_required_vehicle_observations` on the observation log |
| New code cannot insert into the observation log around its writers | [`no-raw-testimony-insert.mjs`](scripts/guardrails/no-raw-testimony-insert.mjs), a ratchet in the pull-request gate ([`pre-deploy-check.yml`](.github/workflows/pre-deploy-check.yml)) |
| An edge function deployed from this repository that writes must authenticate its caller, or be named in the guard's allowlist with the reason | [`check-write-guard.mjs`](scripts/guardrails/check-write-guard.mjs), which blocks the deploy. It reads the source in this repository, so it does not cover a function deployed without source here. [`production-engineering.md`](.claude/rules/production-engineering.md) counts those under "Noted drift" |
| No view lets a visitor write past row-level security | the `view_write_guard` event trigger, which fails the statement |
| No migration opens a personal column to the public | [`no-pii-exposure.mjs`](scripts/guardrails/no-pii-exposure.mjs) in the pull-request gate |
| No secret reaches the repository or the browser bundle | [`no-committed-secrets.sh`](scripts/guardrails/no-committed-secrets.sh) and the build's `check-client-secrets` step |
| Readers and writers keep their contracts | the SQL contract tests in [`supabase/sql/`](supabase/sql/), each run in a fresh PostgreSQL database on pull requests |
| The site works for a logged-out visitor | [`logged-out-live.mjs`](scripts/ci/logged-out-live.mjs), after every deploy and every 30 minutes |
| The numbers on this page are not typed | [`readme-stats.mjs`](scripts/data/readme-stats.mjs), which writes the blocks at the bottom |

The rest is measured, not enforced. The blocks at the bottom of this page say how many columns are
described, how many tables have no foreign key in or out, and how many scheduled jobs failed in the
last day.

## What is in this repository

Nuke is pre-launch, and production is the test environment. Most of the code is SQL and TypeScript
because the model lives in the database. Tables, folds, readers and scheduled jobs ship as migrations
through CI.

| Path | Holds |
|---|---|
| [`supabase/migrations/`](supabase/migrations/) | the model: every table, view, function, trigger and scheduled job |
| [`supabase/functions/`](supabase/functions/) | edge functions: intake, extraction, readers and the MCP connector |
| [`nuke_frontend/`](nuke_frontend/) | the web app (Vite, React), deployed by Vercel |
| [`apps/`](apps/) | the iOS capture app and the Mac relay it was ported from |
| [`scripts/`](scripts/) | CI gates, guardrails, extractors and the measurement script behind this page |
| [`docs/`](docs/README.md) | the theory, the open cases, dated audits and the library |
| [`tools/`](tools/) | the SDK, a file scanner, a desktop app, widgets and typeface tooling |
| [`api/`](api/) | the OAuth proxy the MCP connector signs in through |
| [`yono/`](yono/) | training and serving scripts for the image classifier |
| [`AGENTS.md`](AGENTS.md), [`.claude/rules/`](.claude/rules/), [`skills/`](skills/), [`.claude-plugin/`](.claude-plugin/) | instructions for the coding agents that work here |

## MCP: Nuke Asset Advisor

A read-only, citation-first MCP server for agents, live at `https://nuke.ag/mcp/advisor`. Give it a
listing URL, a VIN or a budget. Each claim it returns carries its citations (source, URL and event
time) and a confidence, and a value that is not recorded is reported that way. The full connector
remains at `/mcp`.

```json
{ "mcpServers": { "nuke-asset-advisor": { "url": "https://nuke.ag/mcp/advisor" } } }
```

Install for Claude Code, Cursor and Claude Desktop: [`supabase/functions/mcp-connector/ADVISOR.md`](supabase/functions/mcp-connector/ADVISOR.md).

## Read further

| Question | Read |
|---|---|
| What is the model, in full? | [`docs/ledger/theory/data-machine.md`](docs/ledger/theory/data-machine.md) |
| What are the stacks, and what does each one need? | [`data-machine-cases.md` §13](docs/ledger/theory/data-machine-cases.md#13-aspiration-twenty-stacks-the-model-must-be-able-to-carry-owner-2026-10-06) |
| How does a second asset class fit the same shape? | [`data-machine-cases.md` §21](docs/ledger/theory/data-machine-cases.md#21-art-is-the-second-asset-class-the-artwork-is-the-endpoint-owner-2026-11-08) and [`asset-entity-model.md`](docs/ledger/theory/asset-entity-model.md) |
| What has been measured, and how is it said in one breath? | [`docs/POSITIONING.md`](docs/POSITIONING.md) |
| How do I work in this repo? | [`AGENTS.md`](AGENTS.md) |
| Which function does X? | [`TOOLS.md`](TOOLS.md) |
| Where is everything else? | [`docs/README.md`](docs/README.md) |
| How do agents install the MCP server? | [`supabase/functions/mcp-connector/ADVISOR.md`](supabase/functions/mcp-connector/ADVISOR.md) |

<details>
<summary>Daily measurements</summary>

<!-- stats:start -->
Measured 2026-11-14 00:46 UTC from the live database by [`scripts/data/readme-stats.mjs`](scripts/data/readme-stats.mjs), run daily by [`update-stats.yml`](.github/workflows/update-stats.yml). Rows are planner estimates to three figures; rates are block samples with their n. Read-only. Nothing here is typed by hand.

| | Rows | Coverage (sampled) |
|---|---|---|
| Auction comments (the auction log) | 25.0M | 95% author keyed to an identity · 8.9% sentiment-scored (n=50,501) |
| Bids | 4.99M |  |
| Observations (the fact log) | 15.3M |  |
| Images | 64.2M | 0.6% zone-classified · 0.4% vision-analyzed · 9.2% AI-processed (n=65,683) |
| Vehicles | 1.43M | 53% active · 32% with a VIN · 77% public (n=29,314) |
| Listings (BaT) | 176K |  |
| External identities | 998K |  |
| Organizations | 5.76K |  |

The database describing itself (`v_schema_atlas`, `v_job_health`): 1,724 tables (1,091 non-empty) · 6,423 of 41,455 columns described (15%) · 520 non-empty tables with no foreign key in or out · 5 tables with an undeclared writer in the last 30 days · 128 scheduled jobs active, 19 with a failure in the last 24 h · Postgres 17.6.

The stack registry (`v_stacks`): 66 stacks registered, 65 at status measured · 6 at coverage 0.9 or above · mean coverage 0.22. Coverage is the share of a stack's needs present in the live schema; partial needs do not count.

Invalid indexes in `public`: 0.

Owner-run views in `public` that anon or authenticated can write through, past row-level security: 0. Allowed: `geometry_columns` (PostGIS view owned by supabase_admin; its insert, update and delete rules are DO INSTEAD NOTHING).
<!-- stats:end -->

</details>

<details>
<summary>Intake and processing rates</summary>

<!-- intake:start -->
Measured 2026-11-14 00:47 UTC from the live database by [`scripts/data/readme-stats.mjs`](scripts/data/readme-stats.mjs), run daily by [`update-stats.yml`](.github/workflows/update-stats.yml). Rows landed per complete UTC day at each layer. Landed counts are exact; columns marked ≈ scale up a page sample whose n is in the header. Read-only. Nothing here is typed by hand.

| Day (UTC) | Comments landed | Comments sentiment-scored ≈ (1% page sample, n=251,759) | Vehicles landed (BaT / Craigslist) | Images landed | Images vision-analyzed ≈ (0.1% page sample, n=63,465) | BaT lots read by the live pull (latest read per lot, so older days undercount) |
|---|---:|---:|---:|---:|---:|---:|
| 2026-11-13 | 11,033 | 0 sampled | 6,721 (200 / 452) | 246,995 | 0 sampled | 1,339 |
| 2026-11-12 | 15,340 | 0 sampled | 7,406 (283 / 445) | 307,618 | 0 sampled | 359 |
| 2026-11-11 | 14,200 | 0 sampled | 8,123 (221 / 397) | 312,538 | 0 sampled | 243 |
| 2026-11-10 | 14,242 | 0 sampled | 11,726 (317 / 413) | 288,511 | 0 sampled | 274 |
| 2026-11-09 | 14,407 | 0 sampled | 10,771 (135 / 504) | 243,918 | 0 sampled | 224 |
| 2026-11-08 | 7,579 | 0 sampled | 2,076 (86 / 451) | 61,677 | 0 sampled | 74 |
| 2026-11-07 | 10,021 | 0 sampled | 1,172 (130 / 535) | 46,689 | 0 sampled | 136 |

- **Live pull at measurement:** 74 of 1,407 live BaT lots are more than 2 h past their next scheduled read, and 8 live lots have never been read (`monitored_auctions.next_poll_at`, `last_synced_at`).
- **Source coverage:** 155,876 of 970,271 known listing targets extracted (16%), across 18 sources (`source_target_coverage`).
- **Clocks:** comments `auction_comments.created_at`, sentiment `auction_comments.analyzed_at`, vehicles `vehicles.created_at` split by `canonical_platform`, images `vehicle_images.created_at`, vision `vehicle_images.vision_analyzed_at`, live-pull reads `monitored_auctions.last_synced_at`, which keeps only each lot's latest read.
- **Sampled zeros:** `tablesample system` keeps whole pages at random, so a day's rows reach the sample 95% of the time only when they span at least 299 comment pages or 2,995 image pages. "0 sampled" rules out steady processing, not a small run.
<!-- intake:end -->

</details>

## License

Proprietary. See [`LICENSE`](LICENSE).
