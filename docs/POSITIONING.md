# Positioning: one voice

How to say what Nuke is to someone with five minutes: a grant reviewer, an investor, a mechanic. The
[README](../README.md) is the description. This is how to speak it, the evidence a stranger can check, and the things
that lose the room. It supersedes the 2026-02-08 note "vertical data + applied AI" (removed in the same change) and
sits beside [`VISION.md`](VISION.md), which is direction rather than description.

Every number here carries its source and date. Re-read the sources before quoting a number outside; the daily
measurements in the README move.

## The sentence

Nuke is a data machine for physical assets. Every observation about an asset (a bid, a comment, a photo, a receipt, a
title transfer) is kept with its source, its clocks and its trust, and the system computes the asset's state, its
cohort baseline and its predictions from that log, point-in-time, so every number can be replayed and graded.
Vehicles are the first asset class.

Shorter: **an observational ledger for physical assets, with its predictions graded in the open.**

## Why a stranger bounces, and the fix

A reader without time prices the ratio of claim to checkable evidence. Until 2026-10-07 the repo carried three
one-liners from three eras: "make every collector vehicle liquid" with ETFs and vaults (`VISION.md`, 2026-02-05),
"vertical data + applied AI, bots that hire humans" (the removed note, 2026-02-08) and "a data machine" (README,
2026-10-06). The loudest was the least evidenced, so the honest reader discounted all of it. A model asked "is this
fundable" read the two words "vehicle data ledger" and answered from them.

The fix is not to the machine. It is one voice, and a description that carries a measured number wherever it goes.
Lead with the instrument and its grading table. The vision comes after, and only when asked.

## What is measured

Read on prod 2026-10-07 between 02:50Z and 03:11Z unless stated. The registry and the daily measurements move;
re-read before quoting. Modest numbers with a named cause are the asset; they are what a reviewer can check.

| Result | Number | Source |
|---|---|---|
| Hammer-price predictor, model v13 | 208 scored, median abs error 48.2%, bias +32.0%, 0 within 10% | `prediction_accuracy` |
| Hammer-price predictor, model v24 | 399 scored, median abs error 33.2%, bias −12.5%, 36 within 10%, 103 within 20% | `prediction_accuracy` |
| Predictor run, live | 2026-02-19 to 2026-04-01, 50,534 predictions, hourly scoring | `hammer_predictions`; `docs/ledger/INTENT_LEDGER.md` §2 |
| Named cause of the residual error | condition and configuration live in images and comments, not fields ("the ±40% calibration killer") | `docs/features/ask-nuke/THEORY.md` |
| Band tag backtest, 24 h before close | 69,295 sold BaT lots 2024-09-01..2026-09-27, each priced from earlier sales only: cold 11.3%, in line 40.9%, hot 86.8% finished above their band middle (48 h: 13.2 / 40.3 / 82.9%) | `docs/ledger/2026-09-30_bat-data-coverage-audit.md` §5 |
| Stack registry | 64 stacks; 5 at or above 0.9 coverage; mean 0.12; the order-book stack SA v2 at 0.50 (8 of 16 needs present, 2 partial, 6 missing) | `v_stacks`, measured 2026-10-07 03:11Z |
| Buyer concentration (V012 discovery) | 68,957 distinct BaT buyers; top 1% took 14% of lots; 39 won 50 or more | `vein_ledger` |
| Soft-close extension | 322 of 400 settled BaT lots extended past the scheduled close (80%) | `docs/ledger/theory/data-machine-cases.md` §4 |
| Corpus (planner estimates, 2026-10-06) | 19.9M auction comments (84% keyed to an identity), 4.27M bids, 157K BaT listings, 1.12M vehicles, 52.1M images (0.5% vision-analyzed) | README daily measurements |

Row counts are cost, not results. Lead with the error and the coverage; mention the rows as the size of the testbed.

## The research question

For a funder who funds R&D, the question is one sentence with a grading rule:

> Can point-in-time state, estimated from heterogeneous untrusted observations (images, comments, receipts, bids) that
> each keep their source, clock and relation to the asset, close a measured 33% median error in asset price prediction,
> and be ready inside a two-minute decision window?

The unproven parts, each a Phase I objective:

1. **Condition and configuration from images and text**, at the accuracy the error demands. Today 0.5% of images are
   vision-analyzed and the predictor is condition-blind by its own calibration table.
2. **Relation-weighted claim credibility.** A statement about an asset weighted by who made it, their relation to the
   asset at the time, and how their earlier claims resolved. Designed (`data-machine-cases.md` §13.3); no measured
   instance yet.
3. **Leakage-free replay at scale.** A feature at moment *t* uses only what was known before *t*, over 19.9M comments
   and 4.27M bids. Most market-data products violate this; the architecture here is built around it.

Grading: median absolute % error against the cohort baseline on a held-out final month, in the same
`prediction_accuracy` table, by price tier; the bar is v24's 33.2%. Generality: any asset class whose record is
fragmented public observation (equipment, aircraft, property, art). Vehicles are the testbed because they are the
largest public corpus with timed bids.

## Models: sensor, not source

The strong claim ("language models cannot exist in the same reality as factual documentation") loses the room, because
the reply is "the model reads your ledger." The defensible claim, already in the repo
(`docs/content/thesis-aperture-of-llm-control.md`; `data-machine-cases.md` §13.4):

- A model trained on today's web has leakage by construction. It cannot say what was known two hours before a close.
- Its place in the machine is as an observer: it turns a comment into an attributed claim, a photo into a condition
  observation, and the output lands as a row with provenance. It is never the source of a number.
- The calculations and the retained, replayable log are what the model cannot produce.

A model is a sensor. The ledger is the instrument.

## The two-minute window

BaT's soft close moves the close to the last bid + 2 minutes, and 80% of settled lots extend. The decision moment is
that chain. Everything the system knows about a lot must therefore be folded before the chain starts, which is why
the architecture is a fold over a log rather than a query at decision time. Speed is a property of the layers, not of
a model. The order-book stack's six missing substrates (comment stance dimension, order-book fold per lot per minute,
cohort demand curve by minutes to close, residual snapshots, outcome ledger) are the near-term work plan.

## The physical shape comes after the instrument

Live-streamed garage sessions, the accounting layer and passive capture are all sources into the same substrates, not
separate products:

- A garage session is the richest observation available: a camera on the work, the receipt, the person doing it, all
  clocked.
- Accounting is money as one more observation layer on the same entities (investment, maintenance, repair as evidenced
  interventions; `data-machine-cases.md` §9).
- Passive capture is the vision gate and the photo sync.

To a funder these are the market and the company sections. Lead with the instrument; the garage is where it gets its
best data.

## How to say it

**To a reviewer.** "An observational ledger for physical assets. Every fact keeps its source and its clocks, state is
computed from the log point-in-time, and predictions are graded against outcomes in a public table. Our best price
model has a 33% median error on 399 lots and we know why: condition lives in photos and comments, not fields. The
Phase I question is whether provenance-weighted extraction from those sources closes the gap, measured the same way."

**To an investor.** "Auctions settle in a two-minute window and the crowd prices on what is written in the listing.
We fold everything known about the asset before the window opens, with a grading table that says how often we are
right. Collector vehicles are the testbed: 157K settled BaT lots, 20M comments, 4M bids. The ledger generalizes to any
asset with a fragmented public record."

**To a mechanic.** "It's the record. Every job, every part, every photo, every dollar on the truck, with who did it and
when, and the market for that truck next to it."

## What loses the room

- ETFs, derivatives, vaults, "undercut BaT". Direction, not evidence. Keep it in `VISION.md`.
- "LLMs cannot exist in the same reality." Say sensor and instrument.
- Row counts as the lead. 52M images is a cost. The result is 0.5% analyzed and a 33% error with a named cause.
- "AI-powered", "platform", "disrupt", "Bloomberg for cars".
- A person's money, vehicle or contact details. The repo is public; refer to records by id.
- A number without its source, date and denominator.

## NSF SBIR/STTR Project Pitch, shaped

Program facts, read 2026-10-07: reauthorized 2026-04-13 through 2031 (S. 3971); NSF relaunched under solicitation
NSF 26-510; Phase I about $305K; the Project Pitch is the screen, four sections, one pending pitch per company.
Character limits are from [seedfund.nsf.gov/project-pitch](https://seedfund.nsf.gov/project-pitch/).

| Section | Limit | What goes in, from this doc |
|---|---|---|
| 1. Technology innovation | 3,500 chars | The sentence; the nine layers in two lines; the model as sensor; origin: a mechanic's own records and the gap between what a listing says and what the work shows |
| 2. Technical objectives and challenges | 3,500 chars | The research question; the three unproven parts as objectives; the grading rule and the 33.2% bar; the testbed size; why this is R&D (the outcome is unknown and the calibration table proves it) |
| 3. Market opportunity | 1,750 chars | Who decides in the two-minute window (bidders, dealers, flippers), who needs the record (owners, lenders, insurers); the settled-lot volume as the market's size; later asset classes |
| 4. Company and team | 1,750 chars | Founder-mechanic who builds and sells vehicles, user #1; pre-launch; the corpus already built; the team is the gap a reviewer will name, and STTR's required research-institution partner is one answer |

The prose is not drafted here. It is drafted when the owner says go, from this doc and the README, and he reviews it
before anything is submitted.
