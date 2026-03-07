# Extraction: read first, don’t fuck shit up

There’s a lot of work in the extraction department. Read the docs and successful patterns before changing anything.

---

## Read these before touching extraction

| Doc | What it covers |
|-----|----------------|
| **`docs/archive/internal-20260128/EXTRACTION-PLAYBOOK.md`** | Proven extractors, routing table, commands that work. BaT, Mecum, C&B, PCarMarket, Hagerty, Hemmings – which is working vs blocked. |
| **`docs/ACCURATE_EXTRACTION.md`** | Never promote queue → vehicles from URL slugs only. Real lot data (price, VIN, etc.) from the right scraper per source. |
| **`EXTRACTION_STATUS.md`** (repo root) | Current state: BaT target, pending by source, blockers (Firecrawl), what’s running. |
| **`supabase/functions/_shared/EXTRACTOR_QUALITY_CHECKLIST.md`** | Resolve existing vehicle before insert (vehicle_events → discovery_url → URL pattern → insert). Chassis/VIN, listing metadata. |
| **`docs/EXTRACTION_POLICY.md`** | No sloppy Firecrawl; check targets before turning on tools; prefer Playwright for import_queue. |
| **`docs/EXTRACTION_TARGETS.md`** | What we’re aiming at (BaT 222k, etc.). Run `npm run status:targets` before long runs. |
| **`.claude/HEMMINGS_CRAWLER_RESEARCH.md`** | Hemmings: Cloudflare, discovery → extraction pattern, scripts that work when CF isn’t blocking. |

Successful sessions and runbooks:

- **`docs/agents/EXTRACTOR_BACKFILL_RUNBOOK.md`** – Gooding chunked backfill, checklist for new/changed extractors.
- **`docs/archive/internal-20260128/GO-FETCH.md`** – Verified commands, which sources are proven vs blocked.

---

## The gap: we don’t have “all” of them

It’s a real gap that we don’t have full coverage for:

- **PCarMarket** – React SPA; needs JS rendering (Playwright or Firecrawl). Edge `import-pcarmarket-listing` exists; local `pcarmarket-proper-extract.js` works when not blocked. Full coverage = discovery (get all listing URLs) + then extract each with the right tool.
- **Cars & Bids** – Cloudflare blocks simple/Playwright in many environments. `extract-cars-and-bids-core` uses Firecrawl. When Firecrawl credits were exhausted, C&B stalled. Full coverage = Firecrawl (or a stealth bypass) + discovery + extraction.
- **Hemmings** – Cloudflare (“Just a moment…”). Scripts exist: `hemmings-fast-discover.js`, `hemmings-proper-extract.js`, `hemmings-extract-loop.sh`. They work when CF lets the browser through. Full coverage = run discovery then extraction with rate limiting; if CF blocks, need Firecrawl or better stealth.
- **Barn Finds** – Added as a live-auction/monitoring source; no dedicated full-coverage extractor doc. Commented in `parallel-source-blitz.ts` (would use `extract-vehicle-data-ai`). Full coverage = define URL patterns, discovery, then a dedicated or generic extractor.

Don’t promise “all” until we’ve actually run discovery + extraction for that source and either have the backlog cleared or documented why it’s blocked (e.g. Firecrawl, CF).

---

## Before you change extraction (checklist)

1. **Read** the playbook and ACCURATE_EXTRACTION so you know which extractor and flow per source.
2. **Resolve before insert** – use EXTRACTOR_QUALITY_CHECKLIST: vehicle_events → discovery_url → URL pattern → then insert. No duplicate vehicles.
3. **Don’t mark queue complete** without real page data (price, VIN, or other real fields). No URL-slug-only promotion.
4. **Check targets** – `npm run status:targets`. Don’t spin up long runs with no pending work or no plan to hit the target.
5. **Prefer Playwright** for import_queue when the source can be scraped with it; save Firecrawl for when it’s actually required (and rate-limit).
6. **If you add or change an extractor** – align with EXTRACTOR_QUALITY_CHECKLIST and the shared resolver; test on a few URLs before batch.

---

## Quick reference: where things live

- **Queue:** `import_queue` (listing_url, status, etc.). Route by URL to the right extractor.
- **Canonical extractors list:** EXTRACTION-PLAYBOOK.md + edge `approved-extractors.ts` / shared checklist.
- **Live status:** `EXTRACTION_STATUS.md`, `SYSTEM_STATUS_REPORT.md`, `npm run status:targets`.

Don’t get sloppy. The work that’s in place is there for a reason.
