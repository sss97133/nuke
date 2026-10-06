# Nuke

Nuke ([nuke.ag](https://nuke.ag)) is a vehicle data ledger: every vehicle and every observation about it, each with its source. The internet publishes the raw material (listings, bids, comments, photos, results); Postgres is the refinery.

Pre-launch. Production is the test environment. The repository is public; secrets and private data never enter it.

## The numbers

<!-- stats:start -->
Measured 2026-10-06 05:49 UTC from the live database by [`scripts/data/readme-stats.mjs`](scripts/data/readme-stats.mjs), run daily by [`update-stats.yml`](.github/workflows/update-stats.yml). Rows are planner estimates to three figures; rates are block samples with their n. Read-only. Nothing here is typed by hand.

| | Rows | Coverage (sampled) |
|---|---|---|
| Auction comments (the auction log) | 18.4M | 75% author keyed to an identity · 10% sentiment-scored (n=39,974) |
| Bids | 4.27M |  |
| Observations (the fact log) | 10.1M |  |
| Images | 52.1M | 0.8% zone-classified · 0.6% vision-analyzed · 11% AI-processed (n=52,490) |
| Vehicles | 1.00M | 44% active · 36% with a VIN · 68% public (n=19,958) |
| Listings (BaT) | 157K |  |
| External identities | 617K |  |
| Organizations | 5.73K |  |

The database describing itself (`v_schema_atlas`, `v_job_health`): 927 tables (655 non-empty) · 3,377 of 16,452 columns described (21%) · 188 non-empty tables with no foreign key in or out · 6 tables with an undeclared writer in the last 30 days · 24 scheduled jobs active, 1 with a failure in the last 24 h · Postgres 17.6.
<!-- stats:end -->

## How it works

Five layers, each defined inside the database. The model and its vocabulary are in [`docs/ledger/theory/data-machine.md`](docs/ledger/theory/data-machine.md).

1. **The log.** Every bid, comment, photo and fact lands once, append-only, with its event time and its ingest time. `auction_comments` is the auction log; `vehicle_observations` is the fact log.
2. **The state.** One row per live thing (a lot, a bidder), updated as each event lands.
3. **The baselines.** What comparable lots looked like at each hour to close, recomputed on a schedule.
4. **Features.** Measures keyed to an entity and an as-of time: a bidder's record, the effect of their entry, the lot-level sum.
5. **Predictions.** A defined bet on an outcome, graded against a baseline, backtested by replaying the log.

The invariants: append, never overwrite. Every datum carries its source, method, observed_at and trust. Every reference to another entity is a foreign key. The database describes itself: every live column carries a `COMMENT ON`, and `v_schema_atlas` keeps the score.

## Stack

- **Supabase**: Postgres and edge functions in [`supabase/functions/`](supabase/functions/). Schema, cron and SQL changes ship as migrations through CI.
- **Web**: [`nuke_frontend/`](nuke_frontend/) (Vite, React), deployed by Vercel on merge to `main`.
- **iOS**: the capture app in [`apps/`](apps/).

## Start here

| Question | Read |
|---|---|
| How do I work in this repo? | [`AGENTS.md`](AGENTS.md) |
| What is the data machine meant to do? | [`docs/ledger/theory/data-machine.md`](docs/ledger/theory/data-machine.md) and its [case ledger](docs/ledger/theory/data-machine-cases.md) |
| What exists and operates now? | The `v_schema_atlas` and `v_job_health` views, computed from the live database |
| What is alive and what is a shell? | [`docs/ledger/README.md`](docs/ledger/README.md) |
| Which function does X? | [`TOOLS.md`](TOOLS.md) |
| How is the market read? | [`docs/features/ask-nuke/THEORY.md`](docs/features/ask-nuke/THEORY.md) |

## License

Proprietary. See [`LICENSE`](LICENSE).
