# Accurate extraction (real lot data, not URL slugs)

We never promote queue items to vehicles using only URL slug data (e.g. year/make/model from the path). Each source that has bulk URLs in `import_queue` should be processed by a scraper that **fetches the lot page** and **parses real fields** (price, VIN, color, etc.).

## Queue-based scrapers (run these for pending URLs)

| Source            | Script                          | How it works |
|-------------------|----------------------------------|--------------|
| **Mecum**         | `scripts/scrape-mecum-lots.ts`   | Fetches each lot URL, parses `__NEXT_DATA__` (hammerPrice, vinSerial, color, transmission, mileage, images). Inserts/updates `vehicles`, marks queue complete. |
| **Barrett-Jackson** | `scripts/scrape-barrett-jackson-lots.ts` | Playwright: loads each lot page (client-rendered), extracts title, year/make/model, VIN, sale price, lot #, color, transmission from DOM. Inserts/updates `vehicles`, marks queue complete. |

**Usage**

```bash
# Mecum (server-side fetch; no browser)
npx tsx scripts/scrape-mecum-lots.ts --batch 30 --loop

# Barrett-Jackson (Playwright)
npx tsx scripts/scrape-barrett-jackson-lots.ts --batch 20 --loop
```

## Other sources

- **Broad Arrow** (~193 pending): Use `scripts/backfill-broadarrow-full.ts --extract` to scrape real data from listing pages. The generic `process-import-queue` would otherwise send these to `extract-vehicle-data-ai`.
- **Bring a Trailer / Cars and Bids / PCarMarket / Hagerty / etc.**: Routed by `process-import-queue` to dedicated edge-function extractors; those extractors scrape or call APIs for real data.
- **Unknown URLs**: `process-import-queue` falls back to `extract-vehicle-data-ai` (can hit quota). Prefer adding a dedicated scraper for any source we bulk-ingest.

## Rule

**Do not** mark queue items complete and insert into `vehicles` using only:
- `year`/`make`/`model` parsed from the URL path
- No `sale_price`, `vin`, or other fields from the actual page

**Do** run the appropriate scraper so each vehicle has data from the real lot page.
