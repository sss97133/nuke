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

The shipped October 8, 2026 05:29Z retained study has 1,408 selected candidates, 1,338 eligible episodes and 36,524 bids. It samples up to 32 recent public sold BaT episodes per calendar quarter, 2016–2026. This is not a census, probability sample or historical knowledge snapshot. See the page's expandable receipt and the design book's Stacks measurement contract.

`bidMeasurements.test.ts` verifies episode ordering/eligibility, calendar partitions, weighting, attribution, percentile references and transfer round trips. `bidPopulationReader.test.ts` checks public-parent gating, caps, primary-key continuation and failed-page behavior. `StackExplore.test.tsx` checks entry, scope changes, contributor context, sharing and absence of substituted results.

The overview and workbench share comparison marks: dot = displayed average (or one auction reading), pale interval = observed middle half, dashed reference = explicitly named selection median. Auction percentiles compare individual auction readings; make/model mean ranks remain in inspection and are qualified against record values, not peer-group means. Reference disclosure exposes its full record distribution and source contributors. Make/model navigation retains the existing expression and source context.

Selecting an entry/win scatter point carries `paired=entry-outcome` into the participant drill. Its population retains only attributed-outcome episodes with a positive observed bid span, matching both plotted axes. The calculation still uses the existing participant expression operator. The paired label and “All captured outcomes” control expose that boundary; source links preserve it. Calendar partial-year markings follow the capture clock rather than the viewer’s current year.

Make assets and attribution: `public/stacks/makes/SOURCES.md`. The bounded local mapping covers the six leading makes; other makes retain visible names.
