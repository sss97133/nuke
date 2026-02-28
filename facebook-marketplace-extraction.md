# Facebook Marketplace Extraction -- Technical Reference

**Last updated:** 2026-02-27 (comprehensive GraphQL probe + 5-city production sweep)

---

## Architecture Overview

Facebook Marketplace data flows through two distinct paths:

```
[Residential IP / Local Mac]
  ├── fb-marketplace-local-scraper.mjs    <- runs locally, direct GraphQL (v2, no tokens)
  └── fb-relay-server.ts (port 8787)
        └── cloudflared tunnel -> FB_RELAY_URL
              └── edge functions call this for individual listing scrapes

[Supabase Edge Functions -- datacenter IPs, BLOCKED by FB]
  ├── fb-marketplace-bot-scraper           <- HTML scrape (returns empty from Supabase IPs)
  ├── fb-marketplace-sweep                 <- geographic sweep coordinator
  ├── fb-marketplace-orchestrator          <- bulk collection manager
  ├── extract-facebook-marketplace         <- single listing extractor (via Firecrawl)
  └── refine-fb-listing                    <- metadata enrichment (via relay)
```

---

## Critical Finding: IP Fingerprinting

**FB distinguishes residential IPs from datacenter IPs** -- the behavior is binary:

| IP Type | HTML Response Size | marketplace_listing_title hits | GraphQL |
|---------|-------------------|-------------------------------|---------|
| Residential (Mac/home) | ~1.1 MB | 24 listings | Works -- no tokens required |
| Supabase edge function (datacenter) | ~460 KB | 0 listings | Rate limit error (code 1675004) |

This is not user-agent based. FB fingerprints the IP range directly. Any UA works from residential.

---

## Logged-Out GraphQL Path -- CONFIRMED WORKING (residential IPs only)

### Breakthrough Finding (2026-02-27 comprehensive probe)

**NO TOKENS REQUIRED.** The GraphQL endpoint works without LSD token, without fb_dtsg, without cookies. Just a POST request.

**Minimal working request:**
```
POST https://www.facebook.com/api/graphql/
Content-Type: application/x-www-form-urlencoded

doc_id=33269364996041474
variables=<json>
__a=1
__comet_req=15
server_timestamps=true
```

That is it. No LSD header, no x-fb-lsd, no cookies, no special UA. The v1 scraper was doing unnecessary work fetching the HTML page just to extract an LSD token.

### Probe Results Summary

| Test | Finding |
|------|---------|
| LSD token required? | **NO** -- works without any token |
| fb_dtsg required? | **NO** -- not present in logged-out HTML anyway |
| User-Agent matters? | **NO** -- Chrome, Bingbot, Googlebot, curl, empty string all return 24 listings |
| Count > 24? | **NO** -- requesting count=48 or count=100 still returns max 24 |
| Count < 24? | **YES** -- count=1,5,12 returns exactly that many |
| Pagination overlap? | **ZERO** -- 10 pages (240 listings) had 0 duplicate IDs |
| Cross-city without per-city token? | **YES** -- same request format works for any city |
| Price filter works? | **YES** -- accurately constrains to price range |
| Year filter works? | **NO** -- effectively ignored (see below) |
| Make filter (stringVerticalFields) works? | **NO** -- effectively ignored |
| Radius parameter works? | **YES** -- affects geographic spread of results |

### Variables Shape (confirmed working)

```json
{
  "buyLocation": { "latitude": 30.2672, "longitude": -97.7431 },
  "categoryIDArray": [807311116002614],
  "contextual_data": [],
  "count": 24,
  "cursor": null,
  "marketplaceBrowseContext": "CATEGORY_FEED",
  "numericVerticalFields": [],
  "numericVerticalFieldsBetween": [],
  "priceRange": [0, 214748364700],
  "radius": 65000,
  "scale": 2,
  "stringVerticalFields": [],
  "topicPageParams": { "location_id": "austin", "url": "vehicles" }
}
```

### Response Structure

```
data.viewer.marketplace_feed_stories.edges[].node.listing
```

**Additional viewer-level fields:**
```
data.viewer.buy_location
data.viewer.marketplace_settings
data.viewer.marketplace_saved_searches
```

### Full Listing Schema (all fields, 100% presence unless noted)

```
listing.id                                          -- FB listing ID (10-18 digits)
listing.__typename                                  -- "GroupCommerceProductItem" (100%)
listing.marketplace_listing_title                   -- full title string (100%)
listing.custom_title                                -- alternate title (96%)
listing.custom_sub_titles_with_rendering_flags[]    -- array with subtitle e.g. "191 K miles" (100%)
listing.listing_price.amount                        -- price as decimal string e.g. "6500.00" (100%)
listing.listing_price.formatted_amount              -- formatted e.g. "6 500 $US" (100%)
listing.listing_price.amount_with_offset_in_currency -- cents as string (100%)
listing.strikethrough_price                         -- original price if reduced (25%)
listing.strikethrough_price.formatted_amount        -- formatted original price
listing.strikethrough_price.amount                  -- original price decimal
listing.comparable_price                            -- null for most (0%)
listing.comparable_price_type                       -- null for most (0%)
listing.min_listing_price                           -- null for most (0%)
listing.max_listing_price                           -- null for most (0%)
listing.primary_listing_photo.image.uri             -- thumbnail URL (100%)
listing.primary_listing_photo.id                    -- photo ID (100%)
listing.location.reverse_geocode.city               -- city name (100%)
listing.location.reverse_geocode.state              -- state abbreviation (100%)
listing.location.reverse_geocode.city_page          -- FB city page with display_name and id (100%)
listing.is_hidden                                   -- false for visible listings (100%)
listing.is_live                                     -- true for active listings (100%)
listing.is_pending                                  -- pending status (100%)
listing.is_sold                                     -- sold status (100%)
listing.is_viewer_seller                            -- always false for logged-out (100%)
listing.marketplace_listing_category_id             -- "807311116002614" for vehicles (100%)
listing.delivery_types[]                            -- array e.g. ["IN_PERSON"] (100%)
listing.listing_video                               -- video metadata if present (38%)
listing.listing_video.id                            -- video ID
listing.origin_group                                -- source group if from group sale (0%)
listing.parent_listing                              -- parent if multi-unit (0%)
listing.marketplace_listing_seller                  -- null for logged-out (0%)
listing.product_feedback                            -- null for logged-out (0%)
listing.if_gk_just_listed_tag_on_search_feed        -- "just listed" badge (0%)
```

**NOTE: `vehicle_info` is NOT returned in logged-out GraphQL.** Make/model/year/mileage must be parsed from title. The `custom_sub_titles_with_rendering_flags` sometimes contains mileage (e.g., "191 K miles").

### Pagination

```
data.viewer.marketplace_feed_stories.page_info.end_cursor  -- opaque JSON cursor
data.viewer.marketplace_feed_stories.page_info.has_next_page  -- boolean
```

- Pass `end_cursor` value as `cursor` in next request
- **Zero overlap** confirmed across 10 pages (240 listings)
- Cursor contains ad tracking metadata but works as-is
- Pagination appears unlimited (10 pages tested, `has_next_page` still true)

### Edge Structure

Each edge also contains:
```
edge.node.__typename    -- "MarketplaceFeedListingStory"
edge.node.story_type    -- "LISTING"
edge.node.story_key     -- unique story key
edge.node.tracking      -- JSON string with ranking data (qid, position, etc.)
edge.node.id            -- composite ID string
edge.cursor             -- same as page_info cursor
```

---

## Filter Behavior (Critical)

### Price Filter -- WORKS

| Range | Result | Notes |
|-------|--------|-------|
| $0-$5,000 | avg $3,268, range $350-$5,000 | Accurate |
| $5k-$15k | avg $8,503, range $5,000-$14,577 | Accurate |
| $15k-$50k | avg $24,995, range $15,900-$46,500 | Accurate |
| $50k+ | avg $116,842, range $50,000-$1,234,567 | Accurate |

Price range values are in cents (offset by 100): `[0, 500000]` = $0-$5,000.

### Year Filter -- DOES NOT WORK

| Filter | In-range | Out-of-range | Verdict |
|--------|----------|-------------|---------|
| 1960-1979 | 1/24 | 23/24 | BROKEN |
| 1980-1999 | 3/24 | 21/24 | BROKEN |
| 2000-2010 | 9/24 | 15/24 | BROKEN |
| 2020-2026 | 10/24 | 14/24 | Partially works (newer listings more likely to have vehicle_info) |

Year filter only constrains listings that have structured `vehicle_info` (seller filled in details). Most listings lack this, so the filter is effectively useless.

### Make Filter (stringVerticalFields) -- DOES NOT WORK

All make filters return the same 24 listings regardless of the make value. FB ignores this parameter for logged-out queries.

### Radius -- WORKS

| Radius | Cities | Notes |
|--------|--------|-------|
| 5,000m (~3mi) | 1 city | Very local |
| 16,000m (~10mi) | 2 cities | Neighborhood-level |
| 65,000m (~40mi) | 9 cities | Good metro coverage (default) |
| 200,000m (~124mi) | 17 cities | Regional |
| 500,000m (~311mi) | 19 cities | Multi-state |

**Strategy:** Use default 65,000m radius for metro-level sweeps. Overlap between adjacent metros at this radius is manageable (deduplicated by facebook_id).

---

## Production Sweep Results (2026-02-27)

### 5-City Sweep (10 pages each = 240 listings/city)

| City | Scanned | Vintage (1960-1999) | Vintage % | New Upserts |
|------|---------|--------------------|-----------|----|
| Austin, TX | 240 | 21 | 8.75% | 21 |
| Detroit, MI | 240 | 31 | 12.9% | 31 |
| Los Angeles, CA | 240 | 44 | 18.3% | 44 |
| Chicago, IL | 240 | 28 | 11.7% | 28 |
| Miami, FL | 240 | 20 | 8.3% | 20 |
| **TOTAL** | **1,200** | **144** | **12.0%** | **144** |

Zero errors across all cities. Zero rate limits encountered.

### Extrapolated Coverage

| Scenario | Metros | Pages/metro | Total scan | Est. vintage | Time |
|----------|--------|-------------|-----------|--------------|------|
| Quick sweep | 55 | 10 | 13,200 | ~1,600 | ~45 min |
| Full sweep | 55 | 50 | 66,000 | ~7,900 | ~4 hrs |
| Deep sweep | 55 | 100 | 132,000 | ~15,800 | ~8 hrs |

---

## What Does NOT Work from Datacenter IPs

| Approach | Error | Root Cause |
|----------|-------|------------|
| Any UA + GraphQL from Supabase | `Rate limit exceeded (1675004)` | IP-level block |
| Chrome UA + GraphQL from Supabase | Error 1357054 | IP-level block |
| Bingbot HTML scrape from Supabase | 460KB page, 0 titles | Stripped response |
| Sweep doc_id (3456763434364354) | `field_exception` | Wrong variable shape |

**FB error code reference:**
- `1675004` -- Rate limit exceeded (datacenter IP block)
- `1675002` -- Invalid query (wrong variables)
- `1357054` -- Generic server error (non-residential IP)
- `1357011` -- Incorrect Query (missing doc_id/query)

---

## doc_id Reference

| doc_id | Source | Status |
|--------|--------|--------|
| `33269364996041474` | fb-marketplace-bot-scraper | **CONFIRMED WORKING** -- returns `viewer.marketplace_feed_stories` |
| `3456763434364354` | fb-marketplace-sweep | `field_exception` -- wrong variables |
| `9501325113254307` | Found in HTML | Returns `data.login_data` -- unrelated |
| `32811453205106563` | Found in HTML | `missing_required_variable_value` |

**Important:** doc_ids change as FB deploys new builds. Monitor for failures.
**Note:** No doc_ids were found in the logged-out HTML page (probe found 0), so discovering new doc_ids requires inspecting authenticated traffic.

---

## Current Infrastructure

### Local Scripts (residential IP, working)
- `/Users/skylar/nuke/scripts/fb-marketplace-local-scraper.mjs` -- GraphQL sweep script **v2**
  - **No tokens required** -- simplified from v1
  - 55 US metro areas pre-configured (expanded from 43)
  - Year filter: 1960-1999 vintage vehicles (by title parsing)
  - Batch upserts to `marketplace_listings` table
  - Rate limiting: 2-3.5s between pages, 4-7s between cities
  - Run: `dotenvx run -- node scripts/fb-marketplace-local-scraper.mjs --location austin --dry-run`
  - Run all: `dotenvx run -- node scripts/fb-marketplace-local-scraper.mjs --all --max-pages 20`

- `/Users/skylar/nuke/scripts/fb-graphql-probe.mjs` -- Schema discovery probe
  - Tests token requirements, UA sensitivity, pagination, categories
  - Run: `node scripts/fb-graphql-probe.mjs`

- `/Users/skylar/nuke/scripts/fb-graphql-probe-2.mjs` -- Filter/behavior probe
  - Tests count, radius, price, year, make, cross-city, deep pagination
  - Run: `node scripts/fb-graphql-probe-2.mjs`

- `/Users/skylar/nuke/scripts/fb-relay-server.ts` -- HTTP relay (port 8787)
  - Exposes residential IP to edge functions via Cloudflare tunnel
  - Actions: `scrape` (full page), `resolve` (URL redirect), `message` (send seller message)
  - Start: `./scripts/start-fb-relay.sh`
  - Required for edge functions to reach FB

### Edge Functions
- `fb-marketplace-bot-scraper` -- BROKEN from datacenter IPs (returns 0 listings)
- `fb-marketplace-sweep` -- Geographic sweep coordinator, needs variable shape fix
- `extract-facebook-marketplace` -- Single listing via Firecrawl, works but $0.01/page
- `refine-fb-listing` -- Enriches listings via bingbot (works via relay)

### Database Tables
- `marketplace_listings` -- primary listing store (facebook_id, platform, url, title, price, current_price, parsed_year, parsed_make, parsed_model, status, location, image_url, etc.)
- `fb_marketplace_locations` -- metro area registry
- `fb_sweep_jobs` -- sweep tracking
- `fb_sweep_queue` -- per-location sweep queue
- `fb_listing_sightings` -- price tracking over time

---

## Year Filter Behavior -- Critical Note

**The year and make filters in GraphQL variables are effectively ignored.** FB only applies them when structured `vehicle_info` exists (seller filled in vehicle details). Most listings lack this.

**Strategy:** Do NOT use year/make filters in GraphQL variables. Fetch all vehicles, filter by title at upsert time. The v2 scraper sends empty `numericVerticalFieldsBetween` and `stringVerticalFields` arrays.

**Vintage rate by market (from 10-page sweeps):**
- Los Angeles: 18.3% (highest -- large classic car culture)
- Detroit: 12.9%
- Chicago: 11.7%
- Austin: 8.75%
- Miami: 8.3%
- National average: ~12%

---

## The Three Paths Forward

### Path 1: Local Residential Scraper (WORKING NOW -- v2 deployed)
**Mechanism:** Run `fb-marketplace-local-scraper.mjs` on any residential machine.

**Key improvements in v2:**
- No LSD token fetch needed -- one fewer HTTP request per city
- Batch upserts instead of individual queries
- 55 US metros (up from 43)
- Better rate limit handling with retry logic
- Status tracking (is_sold, is_pending mapped to listing status)

**Pros:**
- Works today, production-tested across 5 cities
- 24 listings/page, unlimited pagination
- Zero errors in 1,200-listing sweep
- No tokens, no cookies, no auth
- Any User-Agent works

**Cons:**
- Requires residential IP (cannot run from Supabase/AWS/GCP)
- Manual trigger (no cron from edge functions)

**Immediate action:** Run `--all --max-pages 50` for initial dataset (~4,000 vintage listings).

### Path 2: Relay Server + Edge Function (MEDIUM EFFORT)
**Mechanism:** Add GraphQL relay endpoint. Edge functions call relay for sweeps.

```
pg_cron -> edge function -> FB_RELAY_URL/graphql-sweep -> [residential IP] -> FB -> listings -> upsert
```

**What to build:**
1. Add `/graphql-sweep` to `fb-relay-server.ts` (accept location/cursor, return listings)
2. Create `fb-marketplace-graphql-sweep` edge function that calls relay
3. pg_cron to trigger sweeps on schedule

### Path 3: Session Replay (HIGH EFFORT, HIGH REWARD)
**Mechanism:** Authenticated FB cookies bypass IP fingerprinting and unlock `vehicle_info`.

**Benefit:** Structured make/model/year/mileage/transmission instead of title parsing.
**Risk:** Account ban, 100-person anti-scraping team, session expiry.

---

## Key Technical Numbers

| Metric | Value |
|--------|-------|
| Listings per GraphQL page | 24 (hard max) |
| Radius used | 65,000 meters (~40 miles) |
| Category ID for vehicles | 807311116002614 |
| US metros configured | 55 |
| Vintage fraction (national avg) | ~12% of all vehicles |
| Vintage listings per metro (10 pages) | ~20-44 |
| Estimated vintage per metro (50 pages) | ~100-220 |
| Estimated total (55 metros x 50 pages) | ~6,000-12,000 |
| HTML page size (residential) | ~1.1 MB |
| HTML page size (datacenter) | ~460 KB (stripped) |
| Token requirement | NONE (no LSD, no dtsg, no cookies) |
| UA requirement | NONE (any UA works, even empty) |

---

## Anti-Detection Notes

- Use 2-3.5 second delays between page fetches
- Use 4-7 second delays between cities
- No tokens needed -- simplifies request fingerprint
- FB's EDM team (100+ people) monitors for bulk patterns
- Stay under ~1 request/3 seconds per IP
- The 1675004 error from datacenter IPs is IP-level, permanent -- no workaround
- Pagination cursors are stateless -- can resume a sweep after a break
- 5-city x 10-page sweep completed with 0 rate limit events

---

## Next Steps (prioritized)

1. **Immediate:** Run `--all --max-pages 50` from local Mac (~4 hours, ~6,000+ vintage listings)
2. **Short-term:** Add launchd plist for daily automated sweep from local Mac
3. **Short-term:** Add `/graphql-sweep` to relay server for edge function automation
4. **Medium-term:** Build listing detail scraper (individual listing pages for full description/photos)
5. **Medium-term:** Price tracking -- re-sweep same cities to detect price changes
6. **Future:** Session replay path for structured vehicle_info data
