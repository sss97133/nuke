# Bid study reproduction

Run with installed frontend dependencies and Node 22.18 or newer:

```
node scripts/build-stacks-study.mjs
```

This performs anonymous, bounded SELECTs and saves a new raw capture in a timestamped temporary directory. It writes the derived study to `public/stacks/bid-study-v1.json`. It is an explicit operator command, never a build step or scheduled job.

To recompute an existing capture without changing its retrieval clock:

```
node scripts/build-stacks-study.mjs --cache=/absolute/path/to/capture
```

The capture manifest fixes the selection cutoff and read interval. `--adopt-retained` is only for legacy task captures without a manifest: it records their cache-file timestamps explicitly, rather than claiming new retrieval. Raw caches stay outside the public repository. Candidate and child reads both require public, non-deleted parents; no service-role credential is accepted.

## Complete declared populations

The same producer has an explicit full-population mode. It enumerates every matching stored public sold BaT episode, rather than choosing recent episodes within quarters:

```
node scripts/build-stacks-study.mjs --population --cache=/private/capture --output=/private/review.json --requests=100
```

Both paths must be outside the checkout. This mode writes a private review artifact and `review.json.receipt.json`; it does not replace the shipped study or publish automatically. The default close window is January 1, 2016 through the first invocation's UTC cutoff. `--from=ISO_TIMESTAMP` and `--before=ISO_TIMESTAMP` can declare another window when creating a new capture. On resume, omit them or repeat exactly the same normalized window. Rows require a recorded creation timestamp before the cutoff. This creation gate fixes an admission boundary, but current parent labels/counts remain mutable read-time fields: the capture is sequential, not an atomic snapshot or historical knowledge replay.

Exit code 2 means the request budget interrupted work or `--select-only` completed just the parent selection. Repeat the command with the same cache to continue. Budgets range from 1–1000 requests per invocation; they do not bound the population. Every acknowledged page is hashed and saved before advancing its UUID cursor. Parent and child enumeration each require a terminal empty page; short responses alone never establish completion. A parent timeout reduces the transport page size, preserving the population and cursor. An expensive child batch is split on a statement timeout, preserving superseded raw pages and every selected episode. A single-episode failure remains incomplete. A live process lock is never expired by age; crash recovery requires positive missing-process evidence on the same host.

The receipt separates selected episodes, distinct vehicle UUIDs, retained positive keyed bid rows, usable complete sequences and exclusions by reason. It records the scope, retrieval interval, canonical operator source hash and input hash. Bid count/hammer/source-order conflicts keep their existing exclusion semantics. A completed offline replay preserves the original retrieval clock and does not issue new reads. Source-capture freshness and all-BaT/global-market denominators remain unverified. Before public delivery, revalidate current public eligibility and measure output size, reader cost and coverage; private capture completion alone does not prove a deployed population reader.

If the REST transport repeatedly times out, `--sql-reader=/absolute/path/to/existing/q.sh` uses the sanctioned operator reader. Each query locally reduces its transaction role and claims to `anon`, repeats the public eligibility gates, and refuses a response unless it proves `current_user=anon`, `auth.role()=anon` and `auth.uid() IS NULL`. Administrative credentials stay in the existing reader's environment; none enter the review artifact or browser. This creates no SQL function, grant or new API. `--parent-page-size=500` can reset a previously reduced transport size after verifying the alternate reader.

Changing canonical fold code normally refuses cache reuse. Explicit `--refresh-method` records the former hash and deterministically remeasures retained inputs with the new fold source; it preserves source pages and retrieval clocks, recording a separate folding time. It does not change the population or acquire testimony. Changing the scope still requires a new capture.

Offline contracts: `node --test scripts/test-stacks-population-capture.mjs`. They verify interruption/resume, pages shorter than the transport cap, more than 120 parents and 8,000 children, batch splitting, changed scope/cache bytes, false completion, public gates and exact reuse of the existing fold/exclusion operators.

## Offline population analysis

Inspect a completed private population artifact with the same operator. This mode verifies the companion receipt, output bytes/hash and candidate/usable/excluded accounting before evaluating the existing canonical measurement expression. It creates no source client, capture directory or public output:

```
node scripts/build-stacks-study.mjs --analyze --input=/private/review.json --expression='by=participant&measure=relative' --size=25
```

Every query evaluates the entire declared eligible population. Only presentation pages are limited (1–100 rows); counts, means, quantiles, reference population and axis domain use the complete expression. `--group=CANONICAL_GROUP_KEY` pages its source contributors, including episode/vehicle/actor keys and empirical record percentiles. `--reference` pages every eligible reference reading, with source links for record references and canonical group keys for participant references. These are exhaustive inspection pages, with no sampling or statistical downweighting. Group responses carry a reference summary rather than embedding the full vector.

Pass the returned `page.nextCursor` as quoted JSON in `--cursor='JSON'` to continue. Cursors bind to the verified artifact hash, normalized expression, paired/excluded scope and inspection kind/group; a changed context is refused. Expressions use the existing URL parameters, including `paired=entry-outcome` and `excludeVehicle=UUID`. Scope, original retrieval clocks, input/fold/output hashes, exclusion reasons and unknown market denominator accompany each response. Captured eligibility is dated evidence and must be revalidated before public release.

Composite model-group keys contain a NUL separator between make and model. Shell arguments cannot contain that byte; pass the returned key as a JSON string with `--group-json` instead of `--group`. For example:

```
node scripts/build-stacks-study.mjs --analyze --input=/private/review.json --expression='by=model&measure=relative' --group-json='"chevrolet\u0000Corvette"' --size=25
```

The JSON selector accepts only a string, rejects conflicting or duplicate selectors, and preserves the exact key through contributor cursors. It also accepts ordinary group keys when JSON encoding is more convenient. No new source reads or analytical scope changes are introduced.

This operator prototype establishes no production endpoint or storage architecture. The shipped workbench still reads its retained sample. Offline contracts: `node --test scripts/test-stacks-study-query.mjs`, including exhaustive page traversal, source/percentile equivalence, receipt refusal and a **synthetic** 130,837-record scale regression.

The shipped October 8, 2026 05:29Z retained study has 1,408 selected candidates, 1,338 eligible episodes and 36,524 bids. It samples up to 32 recent public sold BaT episodes per calendar quarter, 2016–2026. This is not a census, probability sample or historical knowledge snapshot. See the page's expandable receipt and the design book's Stacks measurement contract.

`bidMeasurements.test.ts` verifies episode ordering/eligibility, calendar partitions, weighting, attribution, percentile references and transfer round trips. `bidPopulationReader.test.ts` checks public-parent gating, caps, primary-key continuation and failed-page behavior. `StackExplore.test.tsx` checks entry, scope changes, contributor context, sharing and absence of substituted results.

The overview and workbench share comparison marks: dot = displayed average (or one auction reading), pale interval = observed middle half, dashed reference = explicitly named selection median. Auction percentiles compare individual auction readings; make/model mean ranks remain in inspection and are qualified against record values, not peer-group means. Reference disclosure exposes its full record distribution and source contributors. Make/model navigation retains the existing expression and source context.

Selecting an entry/win scatter point carries `paired=entry-outcome` into the participant drill. Its population retains only attributed-outcome episodes with a positive observed bid span, matching both plotted axes. The calculation still uses the existing participant expression operator. The paired label and “All captured outcomes” control expose that boundary; source links preserve it. Calendar partial-year markings follow the capture clock rather than the viewer’s current year.

Make assets and attribution: `public/stacks/makes/SOURCES.md`. The bounded local mapping covers the six leading makes; other makes retain visible names.
