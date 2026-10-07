# Nuke

Nuke ([nuke.ag](https://nuke.ag)) is a data machine. It combines a model of entities and the
evidence about them with the computation that keeps running over that model. Every observation is a
row that keeps its source, its clocks and its trust. What matters is the shape those rows take after
they land.

Vehicles are the first entity Nuke tracks. Tracking one vehicle already means tracking people,
organizations, places, parts, documents, money and time.

## A live auction, measured

The machine places a live lot's current bid and bidder count against every comparable lot at the
same time to close, each priced only from the sales before it. The test covered 69,295 sold BaT lots,
from 2024-09 to 2026-09. Lots it tagged hot 24 hours before close finished above the middle of their
price band 86.8% of the time. Lots it tagged cold did so 11.3% of the time
([BaT coverage audit, §5](docs/ledger/2026-09-30_bat-data-coverage-audit.md#5-the-temperature)).

A language model can't take that reading. It has no clock, and it was trained after the fact, so it
already knows how past auctions ended. The machine reads only what was known at each moment, and the
same replay checks every reading against the result.

## A model that grows sideways

Most data products are catalogs: a fixed schema filled from the top down. Nuke grows from the bottom.
A bid, a comment, a photo, a receipt or a title transfer lands once in an append-only log. It is
then keyed to every entity it mentions: a vehicle, a person, a lot, a place or a part.

Each key opens a new path. A commenter becomes an identity with a history, and the history becomes a
record. That record then becomes a feature on every lot the person enters. Paths branch and they
cross. One identity sits in the bidder record, the seller-trust record and an ownership chain at
once.

There is no bottom to drill to. Resolution doesn't stop at the vehicle. It continues into
components, claims, time windows and the people making the claims. The work is foraging: follow a key
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
- **Claims with relations.** A statement about a vehicle is weighted by who made it, their relation to
  the vehicle at the time, and how their earlier claims resolved.

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
Measured 2026-10-06 08:40 UTC from the live database by [`scripts/data/readme-stats.mjs`](scripts/data/readme-stats.mjs), run daily by [`update-stats.yml`](.github/workflows/update-stats.yml). Rows are planner estimates to three figures; rates are block samples with their n. Read-only. Nothing here is typed by hand.

| | Rows | Coverage (sampled) |
|---|---|---|
| Auction comments (the auction log) | 19.9M | 84% author keyed to an identity · 11% sentiment-scored (n=40,043) |
| Bids | 4.27M |  |
| Observations (the fact log) | 10.1M |  |
| Images | 52.1M | 0.6% zone-classified · 0.5% vision-analyzed · 12% AI-processed (n=50,676) |
| Vehicles | 1.12M | 45% active · 36% with a VIN · 68% public (n=20,261) |
| Listings (BaT) | 157K |  |
| External identities | 648K |  |
| Organizations | 5.73K |  |

The database describing itself (`v_schema_atlas`, `v_job_health`): 927 tables (655 non-empty) · 3,377 of 16,452 columns described (21%) · 188 non-empty tables with no foreign key in or out · 6 tables with an undeclared writer in the last 30 days · 24 scheduled jobs active, 2 with a failure in the last 24 h · Postgres 17.6.
<!-- stats:end -->

</details>

## License

Proprietary. See [`LICENSE`](LICENSE).
