---
paths:
  - "supabase/functions/*extract*/**"
  - "supabase/functions/*ingest*/**"
  - "supabase/functions/*import*/**"
  - "supabase/functions/*discovery*/**"
  - "supabase/functions/_shared/**"
---

# Extraction Rules

## Archive Fetch
- NEVER use raw `fetch()` for external URLs — use `archiveFetch()` from `_shared/archiveFetch.ts`
- Firecrawl calls: `archiveFetch({ useFirecrawl: true })`
- BaT URLs: `archiveFetch()` wraps batFetcher internally
- Exception: JSON API endpoints (not HTML pages)

> "Fetch once, extract forever."

## Schema Discovery
- NEVER pre-define schema before seeing actual data
- Discovery: sample 20-50 documents, enumerate ALL fields
- Aggregate: compile field catalog with frequencies
- Then design schema, then extract

## Single Write Path
- ALL data flows through `ingest-observation` with entity resolution
- NEVER bypass to write directly to `auction_comments`, `vehicle_events`, etc.
- Two parallel data pipelines = data fork = broken

## Entity Resolution
- Auto-match threshold = 0.80 minimum
- Below 0.80 = candidate only, never auto-match
- NEVER call `merge_into_primary` without AI verification (use `merge_proposals`)
- NEVER create new vehicle record if Tier 1/2 match exists

## Source species (2026-10-18)
- The extractor's builder identifies the source's species from evidence on the source itself; it is never a question
  for the owner. Species are the physics in `docs/ledger/theory/data-machine-cases.md` §6: timed with soft close (an
  end time and bids), block house (a sale event and lots), dealer site (inventory on the seller's own site), classifieds
  (seller posts that live days, keyed by post id, no close), auth-walled marketplace (read only through a session or
  token), aggregator (a map of who exists, or a curator pointing at listings elsewhere), media/forums/video, owner's
  private data. Craigslist and KSL are classifieds, not marketplaces.
- Before a source's data lands, its `observation_sources` row carries `species`, `species_set` and `species_evidence`
  (`{examined_at, examined: [URLs or stored pages], seen, doc, extractor, listing_rule}`), written by a migration. Read a
  saved page (`listing_page_snapshots`) or the live page: does a listing have an end time and bids, a sale and a lot, a
  seller post with no close, dealer stock, outbound links to the real listing, a login wall? Use the doc's assignment
  where it names the source and say so in `doc`.
- A source with several species (Hagerty Marketplace auctions and classifieds, Barn Finds posts and its own ads) gets
  its primary species, the full set, and a rule in `listing_species_from_evidence()` that reads the listing's own URL or
  metadata. Never infer a species from a name.
- `source_species_gaps()` must stay empty; the deploy run fails while any source holding data lacks a species.
  Contract: `supabase/sql/test_source_species.sql`.

## Before Building
- Check `TOOLS.md` — does a tool already handle this intent?
- Check `pipeline_registry` — who owns this column?
- Check `supabase/functions/` — is there already an extractor?
- Declare the source's species with evidence (above) before its first row lands.
