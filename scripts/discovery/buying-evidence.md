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

## Structured request comparison

`--request /private/request.json` selects a separate read-only mode in this same
operator. It compares an attributed request against 1–10 explicit candidate records
using the existing anonymous `get_vehicle_specs(uuid[],true)` and
`get_field_provenance(uuid,text)` readers. It does not reread comments, images or
source websites. Missing source requests require independent acquisition and
interpretation; this mode does not infer a buying request from browsing or prose.

Synthetic request example (not a real buyer or production observation):

```json
{
  "schema_version": "buying_request_v1",
  "id": "example-request",
  "source_ref": "operator:synthetic-example",
  "source_url": null,
  "observed_at": "2026-10-14T00:00:00Z",
  "recorded_at": "2026-10-14T00:00:00Z",
  "status": "open",
  "valid_until": null,
  "criteria": [
    {"id":"year","property_key":"year","operator":"between","value":[1980,1989],"unit":null,"requirement":"required","claim_scope":"listing_report"},
    {"id":"manual","property_key":"transmission_type","operator":"eq","value":"manual","unit":null,"requirement":"preferred","claim_scope":"listing_report"}
  ]
}
```

```sh
node scripts/discovery/buying-evidence.mjs \
  --request /private/request.json --vehicles VEHICLE_UUID,OTHER_VEHICLE_UUID \
  --out /private/new-request-comparison

node scripts/discovery/buying-evidence.mjs \
  --cache /private/new-request-comparison/capture.json \
  --out /private/replayed-request-comparison

node --test scripts/discovery/buying-evidence.test.mjs scripts/discovery/buying-evidence-matching.test.mjs
```

Requirements reference candidate property keys; they are not claims about the
candidate. `eq`, `in`, `gte`, `lte` and inclusive `between` compare exact typed
values. String comparisons trim and ignore case; they infer no synonyms, vehicle
aliases, cultural meaning or unit conversions. Required and preferred criteria
remain separate. Every hard requirement must be met before `criteria_met`; unknown,
conflicting or empty hard requirements cannot establish a fit. A preferred mismatch
does not disqualify a candidate. Closed, expired, unknown-status or future requests
are refused for active evaluation. Supplied source attribution and open status are
operator declarations, not independently verified request truth.

The supported public-reader scope is eleven existing keys: year, make, model, VIN,
interior/exterior color, engine configuration/displacement, transmission, drivetrain
and reported odometer miles. Unsupported requirements remain visible as unknown,
including asking price, nearby, rust-free, current installation and true mileage.
The property catalog may contain more keys than this reader can qualify. Units are
exact `liters`, `miles` or null as declared by these properties. Approximate values
without bounds cannot establish an exact/range match.

Only current typed canonical claims corroborated by the same observation ID, value,
source, role and clocks in complete field provenance can qualify a predicate. The
current record's selected listing URL scopes the match. Other listing episodes do
not become current configuration evidence. Primitive record fields only label the
report. They never fill missing claims. Same-listing differing reports stay
unadjudicated counterevidence; changes in paint or mileage may be history rather
than factual contradiction. Unknown counterevidence clocks block certainty; future
claims do not enter an earlier cutoff. All clocks retain submillisecond precision.

`capture.json` preserves the supplied request/hash, exact candidate input and read
hashes; `report.json` and `review.html` expose every predicate, source ID and gap.
Replaying the same captured input is deterministic. It does not reconstruct a past
database state or a previous canonical winner from today's reader. Separate current
reads can disagree; the custody check withholds such claims. Privacy, time, row,
deadline and output boundaries from the existing operator remain in force, with two
consecutive provenance failures stopping further provenance reads.

This is a private operator comparison of retained listing reports. Request
admission, active inventory, source enumeration, maintained matches, public feed,
geographic/cultural relevance and profit remain separate missing capabilities.
Whole-market coverage is unmeasured; the population is the exact supplied record
manifest. Exit 0 establishes complete selected reader access, not a supported match
or available vehicle; exit 2 retains the partial receipt. No database changes,
source activation, paid inference or contact is performed.

## Listing inspection plan

`--plan` selects a third read-only mode for 1–10 named public vehicles: an
**estimate to inspect**, not an estimate to restore. It is the smallest first version
of the listing → pre-purchase inspection pipeline in
`docs/library/technical/work-order-intelligence.md` § "A job is a future receipt".
Logic lives in `buying-evidence-plan.mjs`; the reviewed claim → operation vocabulary is
`buying-evidence-plan-keywords.json`.

```sh
node scripts/discovery/buying-evidence.mjs --plan \
  --vehicles VEHICLE_UUID,OTHER_VEHICLE_UUID --out /private/new-listing-plan

node scripts/discovery/buying-evidence.mjs \
  --cache /private/new-listing-plan/capture.json --out /private/replayed-listing-plan

node --test scripts/discovery/buying-evidence-plan.test.mjs
```

Output is `capture.json` (rows and read receipts), `plan.json` and a readable
`plan.txt`. Per vehicle, in order:

1. **Identity.** Year, make, model, VIN, displacement, transmission, drivetrain and
   induction from the record, the cached VIN decode (`vin_decoded_data`, only with a
   success error code), the description extraction and regex matches in the listing text
   with verbatim sentence excerpts. Each field is `agree`, `conflict`,
   `unresolved_specificity`, `single_source` or `no_source`. Listing-text model tokens
   are compared only within a reviewed series family. A conflict means the records
   disagree; the inspection decides.
2. **Claims.** Condition and unresolved-work sentences from the listing text (verbatim),
   non-failure `description_discoveries` rows (flags, condition note, reported work,
   modifications, documents, title, mileage; an exact excerpt only when the extracted text
   appears in the listing text, otherwise marked paraphrase), and current
   `vehicle_observations` of kind `condition` (rubric notes, text and image inference).
   Each claim keeps its source row and path, method, clocks and recorded confidence;
   LLM extraction confidence stays null. Extraction failure rows are excluded and counted.
   An image claim counts only when its `vehicle_images` row is on the same vehicle,
   nonsensitive and from a reviewed listing-import source for the listing host; others are
   excluded and counted. Identical text from several projections becomes one checklist item.
3. **Candidate operations.** Condition claims matched by the keyword table to live
   `labor_operations` (single book value, no range) and `stage_transition_labor_map` rows or
   summed chains (author-declared min/typical/max; materials currency unstated). Every target
   is labelled `seed_uncalibrated` with year applicability; unmatched condition claims are
   listed as having no reference operation. Reported completed work and modifications never
   produce operations.
4. **Rate.** `resolve_labor_rate()` called with no arguments and shown exactly as returned.
   Its contract branch reads the absent `work_contracts` only when client and organization
   are both passed, so it is never executed here. The rate is not multiplied into hours.
5. **Parts.** Only `catalog_parts` rows with `price_current > 0`, a name match for the
   operation's term, a `fits_models` token equal to a record model token and the record
   year inside the row's year range; labelled `text_match_unverified`, and unusable while
   year, make or model conflict.
6. **PPI checklist.** Every identity conflict and every claim becomes an item with an empty
   finding slot: `inspection_type: pre_purchase`, `system`, `verdict`
   (supports/contradicts/unknown), `finding`, `severity` (info/monitor/concern/critical),
   `evidence_photo_ref`, inspector and clock, following
   `docs/library/reference/dictionary/inspection.md`.

Not read: comment discoveries, auction comments, component identifications, image
condition observations, condition scores and page captures; each is named in the report's
retrieval boundary. Reads follow the existing bounds (READ ONLY, 5-second statements,
public parent gate repeated on child reads, keyset pages, two-failure stop, private 0700/0600
output outside the checkout, no SQL errors echoed). No paid inference, scraping, writes or
contact. Exit 0: all parents public, all selected reads complete and the rate read; exit 2
retains the partial plan.
