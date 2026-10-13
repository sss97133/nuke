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

## Read further

| Question | Read |
|---|---|
| What is the model, in full? | [`docs/ledger/theory/data-machine.md`](docs/ledger/theory/data-machine.md) |
| What are the stacks, and what does each one need? | [`data-machine-cases.md` §13](docs/ledger/theory/data-machine-cases.md#13-aspiration-twenty-stacks-the-model-must-be-able-to-carry-owner-2026-10-06) |
| How do I work in this repo? | [`AGENTS.md`](AGENTS.md) |
| Which function does X? | [`TOOLS.md`](TOOLS.md) |

<details>
<summary>Daily measurements</summary>

<!-- stats:start -->
Measured 2026-10-13 06:56 UTC from the live database by [`scripts/data/readme-stats.mjs`](scripts/data/readme-stats.mjs), run daily by [`update-stats.yml`](.github/workflows/update-stats.yml). Rows are planner estimates to three figures; rates are block samples with their n. Read-only. Nothing here is typed by hand.

| | Rows | Coverage (sampled) |
|---|---|---|
| Auction comments (the auction log) | 20.1M | 100% author keyed to an identity · 11% sentiment-scored (n=40,410) |
| Bids | 4.27M |  |
| Observations (the fact log) | 12.2M |  |
| Images | 52.5M | 0.7% zone-classified · 0.5% vision-analyzed · 11% AI-processed (n=51,765) |
| Vehicles | 1.01M | 45% active · 36% with a VIN · 68% public (n=20,772) |
| Listings (BaT) | 175K |  |
| External identities | 699K |  |
| Organizations | 5.73K |  |

The database describing itself (`v_schema_atlas`, `v_job_health`): 944 tables (673 non-empty) · 5,230 of 16,631 columns described (31%) · 185 non-empty tables with no foreign key in or out · 7 tables with an undeclared writer in the last 30 days · 33 scheduled jobs active, 4 with a failure in the last 24 h · Postgres 17.6.
<!-- stats:end -->

</details>

<details>
<summary>Intake and processing rates</summary>

<!-- intake:start -->
Measured 2026-10-13 07:21 UTC from the live database by [`scripts/data/readme-stats.mjs`](scripts/data/readme-stats.mjs), run daily by [`update-stats.yml`](.github/workflows/update-stats.yml). Rows landed per complete UTC day at each layer. Landed counts are exact; columns marked ≈ scale up a page sample whose n is in the header. Read-only. Nothing here is typed by hand.

| Day (UTC) | Comments landed | Comments sentiment-scored ≈ (1% page sample, n=196,307) | Vehicles landed (BaT / Craigslist) | Images landed | Images vision-analyzed ≈ (0.1% page sample, n=52,836) | BaT lots read by the live pull (latest read per lot, so older days undercount) |
|---|---:|---:|---:|---:|---:|---:|
| 2026-10-12 | 10,977 | 0 sampled | 766 (183 / 518) | 21,588 | 0 sampled | 496 |
| 2026-10-11 | 4,890 | 0 sampled | 487 (55 / 387) | 13,888 | 0 sampled | 232 |
| 2026-10-10 | 12,078 | 0 sampled | 633 (120 / 458) | 32,476 | 0 sampled | 486 |
| 2026-10-09 | 12,183 | 0 sampled | 847 (199 / 605) | 73,918 | 0 sampled | 227 |
| 2026-10-08 | 9,934 | 0 sampled | 832 (219 / 578) | 11,903 | 0 sampled | 216 |
| 2026-10-07 | 13,622 | 0 sampled | 893 (242 / 615) | 53,533 | 0 sampled | 202 |
| 2026-10-06 | 13,041 | 0 sampled | 1,142 (242 / 576) | 66,509 | 0 sampled | 203 |

- **Live pull at measurement:** 779 of 1,294 live BaT lots are more than 2 h past their next scheduled read, and 116 live lots have never been read (`monitored_auctions.next_poll_at`, `last_synced_at`).
- **Source coverage:** 26,242 of 785,126 known listing targets extracted (3.3%), across 10 sources (`source_target_coverage`).
- **Clocks:** comments `auction_comments.created_at`, sentiment `auction_comments.analyzed_at`, vehicles `vehicles.created_at` split by `canonical_platform`, images `vehicle_images.created_at`, vision `vehicle_images.vision_analyzed_at`, live-pull reads `monitored_auctions.last_synced_at`, which keeps only each lot's latest read.
- **Sampled zeros:** `tablesample system` keeps whole pages at random, so a day's rows reach the sample 95% of the time only when they span at least 299 comment pages or 2,995 image pages. "0 sampled" rules out steady processing, not a small run.
<!-- intake:end -->

</details>

## License

Proprietary. See [`LICENSE`](LICENSE).
