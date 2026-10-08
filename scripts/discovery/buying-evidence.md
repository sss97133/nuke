# Retained buying evidence finder

Owner use case, October 8, 2026: mileage reassures a later buyer, but personal use
requires understanding maintenance, unresolved work, usage, storage, exposure,
ownership and physical condition. A lower reading does not establish no work due.
The first tool finds supporting testimony; economic weights and failure predictions
need qualified outcomes and calibration before they can be delivered.

## Build plan and delivered boundary

1. Inspect existing owners and actual retained documents; reuse comment and photo
   stores, the observation log and protected listing captures. No new testimony store.
2. Read explicit public vehicle IDs with repeated parent gates, finite deadlines,
   UUID keyset pages and per-field budgets. Preserve source/episode identity and clocks.
3. Locate exact excerpts using a deterministic search vocabulary or an operator's
   literal query. Produce private JSON and an HTML comparison for human review.
4. Test source-to-report behavior and disagreement/refusal cases on synthetic local
   fixtures, then execute a bounded real-record read. Do not admit discoveries as facts.

The operator belongs to the existing `scripts/discovery/` repair tooling. The
description owner remains `discover-description-data`; the comment owner remains
the existing refinery; the image owner remains the photo analysis pipeline.
Snapshot prose uses `_shared/batParser.ts`, not a second HTML parser. There is no
new endpoint, writer, registry claim, queue, schedule or model call.

## Run

Requires installed Node 22.18+ (native TypeScript stripping for the shared parser)
and the existing `scripts/data/q.sh` read credentials. The shared script loads its
existing environment. No dependency installation is needed.

```sh
node scripts/discovery/buying-evidence.mjs \
  --vehicles VEHICLE_UUID,OTHER_VEHICLE_UUID \
  --out /private/new-buying-evidence-review

node scripts/discovery/buying-evidence.mjs \
  --cache /private/new-buying-evidence-review/capture.json \
  --query 'heater core' --out /private/new-heater-core-review

node --test scripts/discovery/buying-evidence.test.mjs
```

Live scope: 1–10 distinct UUIDs; default 100 rows/page, 5 pages/collection,
120 seconds across the run. Maximum 200 rows/page, 10 pages/collection, 300 seconds.
Each SQL transaction is READ ONLY with a 5-second statement timeout. `--qsh`
selects an existing read script, never a shell command. Source bodies, amounts and
identity evidence remain in private output outside both this and the shared public
checkout. A new directory is mandatory; files are 0600 and its directory is 0700.
Stdout contains only counts and an output location. SQL errors are not echoed.

Output: `capture.json` retains fetched rows and individual read receipts;
`report.json` links exact excerpts to row IDs, paths, source URLs, episode IDs,
recorded author/seller metadata and original clock strings; `review.html` compares
the records and exposes gaps and excerpts. It loads no remote images or scripts.
Cache replay makes zero database calls and preserves the original retrieval window.
Excerpt offsets are Unicode code points in the indicated text region, whose SHA256
is retained. Identical quote clusters are review aids, never independent witness votes.

## Interpretation and acceptance

- A search hit is a **lexical candidate**, not an admitted claim or diagnosis.
  Question, conditional, negation and subject-scope flags are review hints, not
  semantic classifications. Original conflicting statements remain visible.
- Recorded seller status does not establish ownership. Both author identity keys
  remain visible; they are not silently reconciled or scored.
- Mileage is the current vehicle projection with unqualified unit/truth. No mileage
  cutoff, failure probability, maintenance completion, cost estimate or resale
  premium is inferred. Missing matches mean unknown, not absence or neglect.
- Existing observation and image extractions remain attributed to their method and
  path. Image search currently reads only `ai_extractions`; `analysis_history`,
  `ai_extraction_consensus` and other stores are unmeasured, so an empty selected field
  does not establish no retained analysis elsewhere. Image taken_at has writer-dependent
  meaning and is not asserted as EXIF truth.
  No new vision inference or raw photograph interpretation is performed.
- Listing captures require same-vehicle protected metadata, successful BaT capture,
  and independently recomputed HTML SHA256. Their clock is capture, not publication.
  Parser-region completeness is explicitly unestablished. Offloaded/oversized/missing
  bodies retain locators and named gaps; no recapture or storage-access bypass.
- Native bid rows are excluded from lexical discovery but counted in fetched scope.
  Only explicitly nonsensitive, nonsuperseded images are eligible; observation reads
  reuse `observation_is_public`. Public/undeleted/vehicle parent gating precedes and
  is repeated on child reads. This operator is not a public publication contract.
- Only an empty continuation page establishes exhaustion of the selected SQL scope.
  Budgets, failed reads and bad cursors remain partial. Field budgets withhold whole
  fields and report gaps instead of silently truncating. Exhaustion is not source,
  vehicle-history, media-analysis or market completeness.
  Two consecutive failures of the same family stop that reader across later vehicles,
  even when independent families succeed between them.
- These are separate current reads with a fixed selection cutoff, not an atomic
  historical knowledge snapshot. Raw date strings preserve PostgreSQL microseconds.

Exit 0: all requested parents and selected SQL collections were read to exhaustion;
semantic/source gaps may remain. Exit 2: unavailable parent or incomplete collection;
the receipt still records retained results. Exit 1: invalid invocation or fatal error.

Next repairs should start from reviewed source IDs and exact missing relationships:
source episode and ownership window, component/procedure, intervention date/mileage,
performed versus planned work, and corroborating documents/images. Route admitted
claims through the existing canonical owners and sanctioned writer. Reliability and
resale stacks should consume qualified evidence separately and state their outcomes,
cohort, horizon, denominator, uncertainty and calibration before assigning weights.
