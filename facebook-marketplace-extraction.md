# Facebook Marketplace Extraction — Technical Reference

**Last updated:** 2026-02-27 (VP Extraction GraphQL probe session)

---

## Architecture Overview

Facebook Marketplace data flows through two distinct paths:

```
[Residential IP / Local Mac]
  ├── fb-marketplace-local-scraper.mjs    ← runs locally, direct GraphQL
  └── fb-relay-server.ts (port 8787)
        └── cloudflared tunnel → FB_RELAY_URL
              └── edge functions call this for individual listing scrapes

[Supabase Edge Functions — datacenter IPs, BLOCKED by FB]
  ├── fb-marketplace-bot-scraper           ← HTML scrape (returns empty from Supabase IPs)
  ├── fb-marketplace-sweep                 ← geographic sweep coordinator
  ├── fb-marketplace-orchestrator          ← bulk collection manager
  ├── extract-facebook-marketplace         ← single listing extractor (via Firecrawl)
  └── refine-fb-listing                    ← metadata enrichment (via relay)
```

---

## Critical Finding: IP Fingerprinting

**FB distinguishes residential IPs from datacenter IPs** — the behavior is binary:

| IP Type | HTML Response Size | marketplace_listing_title hits | GraphQL |
|---------|-------------------|-------------------------------|---------|
| Residential (Mac/home) | ~1.1 MB | 24 listings | Works with LSD token |
| Supabase edge function (datacenter) | ~460 KB | 0 listings | Rate limit error (code 1675004) |

This is not user-agent based. Both residential and datacenter tests used the bingbot UA. FB fingerprints the IP range directly.

---

## Logged-Out GraphQL Path — CONFIRMED WORKING (residential IPs only)

### Proof of Concept (tested 2026-02-27)

**Step 1: Get LSD token** — fetch the marketplace page, extract from HTML:
```
"LSD"..."token":"AdRSbMnUmqVdfzAqCLST"
```

**Step 2: Call GraphQL endpoint:**
```
POST https://www.facebook.com/api/graphql/
Content-Type: application/x-www-form-urlencoded
User-Agent: Mozilla/5.0 (compatible; bingbot/2.0; ...)
x-fb-lsd: <token>

doc_id=33269364996041474
variables=<json>
lsd=<token>
__a=1
__comet_req=15
server_timestamps=true
```

**Variables shape (confirmed working):**
```json
{
  "buyLocation": { "latitude": 30.2672, "longitude": -97.7431 },
  "categoryIDArray": [807311116002614],
  "contextual_data": [],
  "count": 24,
  "cursor": null,
  "marketplaceBrowseContext": "CATEGORY_FEED",
  "numericVerticalFields": [],
  "numericVerticalFieldsBetween": [{ "max": 2025, "min": 1960, "name": "year" }],
  "priceRange": [0, 214748364700],
  "radius": 65000,
  "scale": 2,
  "stringVerticalFields": [],
  "topicPageParams": { "location_id": "austin", "url": "vehicles" }
}
```

**Response structure:**
```
data.viewer.marketplace_feed_stories.edges[].node.listing
```

Each listing node contains:
- `id` — FB listing ID (10-18 digit number)
- `marketplace_listing_title` — full title string (e.g., "2007 International 4300")
- `listing_price.amount` — price as string (e.g., "9000.00")
- `listing_price.formatted_amount` — formatted (e.g., "9 000 $US")
- `listing_price.amount_with_offset_in_currency` — cents as string
- `location.reverse_geocode.city` — city name
- `location.reverse_geocode.state` — state abbreviation
- `primary_listing_photo.image.uri` — thumbnail URL
- `is_sold`, `is_hidden`, `is_live`, `is_pending` — status flags
- `delivery_types` — array (e.g., ["IN_PERSON"])
- **NOTE: `vehicle_info` is NOT returned** — make/model/year must be parsed from title

**Pagination:**
```
data.viewer.marketplace_feed_stories.page_info.end_cursor
data.viewer.marketplace_feed_stories.page_info.has_next_page
```
Pass `end_cursor` value as `cursor` in next request. Works perfectly — zero overlap between pages.

**Geographic coverage:**
- Tested: Austin TX, Seattle WA, Chicago IL — all return 24 listings per page
- LSD token must be fetched from that location's page URL: `/marketplace/{slug}/vehicles/`
- Location slug examples: `austin`, `seattle`, `chicago`, `losangeles`, `dallas`, etc.

---

## What Does NOT Work from Datacenter IPs

| Approach | Error | Root Cause |
|----------|-------|------------|
| Bingbot UA + GraphQL from Supabase | `Rate limit exceeded (1675004)` | IP-level block |
| Chrome UA + GraphQL from Supabase | Error 1357054 (French error message) | IP-level block |
| Bingbot HTML scrape from Supabase | 460KB page, 0 titles | Stripped-down response to datacenter IPs |
| Sweep doc_id (3456763434364354) | `field_exception` error | Wrong variable shape |

**FB error code reference:**
- `1675004` — Rate limit exceeded (shown to datacenter IPs)
- `1675002` — Invalid query (wrong variables)
- `1357054` — Generic server error (non-residential IP rejection)
- `1357011` — Incorrect Query (missing doc_id/query)

---

## doc_id Reference

| doc_id | Source | Status |
|--------|--------|--------|
| `33269364996041474` | fb-marketplace-bot-scraper | **CONFIRMED WORKING** from residential IPs. Returns `viewer.marketplace_feed_stories`. |
| `3456763434364354` | fb-marketplace-sweep | Returns `field_exception` — variable shape mismatch |
| `9501325113254307` | Found in HTML | Returns `data.login_data` — unrelated |
| `32811453205106563` | Found in HTML | `missing_required_variable_value` — wrong vars |

**Important:** doc_ids change over time as FB deploys new builds. The one that works today (`33269364996041474`) may be replaced. Monitor for failures.

---

## Current Infrastructure

### Local Scripts (residential IP, working)
- `/Users/skylar/nuke/scripts/fb-marketplace-local-scraper.mjs` — GraphQL sweep script
  - 43 US metro areas pre-configured
  - Year filter: 1960-1999 vintage vehicles
  - Upserts to `marketplace_listings` table
  - Run: `dotenvx run -- node scripts/fb-marketplace-local-scraper.mjs --location austin --dry-run`

- `/Users/skylar/nuke/scripts/fb-relay-server.ts` — HTTP relay (port 8787)
  - Exposes residential IP to edge functions via Cloudflare tunnel
  - Actions: `scrape` (full page), `resolve` (URL redirect), `message` (send seller message)
  - Start: `./scripts/start-fb-relay.sh`
  - Required for edge functions to reach FB

### Edge Functions
- `fb-marketplace-bot-scraper` — **BROKEN from datacenter IPs** (returns 0 listings). Would need relay integration.
- `fb-marketplace-sweep` — geographic sweep coordinator, uses wrong variable shape for GraphQL
- `extract-facebook-marketplace` — single listing via Firecrawl, works but expensive (~$0.01/page)
- `refine-fb-listing` — enriches listings via bingbot (works for individual items via relay)

### Database Tables
- `marketplace_listings` — primary listing store (columns: `facebook_id`, `platform`, `url`, `title`, `price`, `current_price`, `parsed_year`, `parsed_make`, `parsed_model`, etc.)
- `fb_marketplace_locations` — metro area registry
- `fb_sweep_jobs` — sweep tracking
- `fb_sweep_queue` — per-location sweep queue
- `fb_listing_sightings` — price tracking over time

---

## Year Filter Behavior — Critical Note

**The year filter in GraphQL variables (`numericVerticalFieldsBetween`) is effectively ignored for most listings.** FB only applies it when structured `vehicle_info` exists (which requires the seller to have filled in vehicle details). Most listings don't have structured vehicle_info.

| Approach | Actual behavior |
|----------|----------------|
| URL params `?minYear=1960&maxYear=1999` | Ignored — shows all years |
| GraphQL `numericVerticalFieldsBetween` year filter | Ignored for most listings (no vehicle_info) |
| Title parsing (what local scraper does) | WORKS — correct approach |

**What this means for coverage:**
- Per metro, all-vehicles query returns ~8% vintage (title-parsed) in Austin
- Detroit area had more vintage: ~17% of first page
- Estimate: ~200 genuine vintage vehicles (1960-1999) per metro with title parsing
- To get 10,000 vintage listings: need to sweep ~50 metros × ~100 pages each

**Strategy:** Do NOT use year filter in variables. Fetch all vehicles, filter by title at upsert time. This is what `fb-marketplace-local-scraper.mjs` already does correctly.

---

## The Three Paths Forward

### Path 1: Local Residential Scraper (WORKING NOW)
**Mechanism:** Run `fb-marketplace-local-scraper.mjs` on any residential machine (Mac, VPS with residential IP).

**Pros:**
- Works today, confirmed tested
- 24 listings/page, unlimited pagination
- Multi-metro with 43 pre-configured US cities
- ~1,000 listings per metro available

**Cons:**
- Requires someone to run it manually or on a machine that's always on
- Not automated via Supabase cron

**Immediate action:** Run `--all` flag to sweep all 43 metros for vintage vehicles.

### Path 2: Relay Server + Edge Function Integration (MEDIUM EFFORT)
**Mechanism:** Add a GraphQL sweep endpoint to `fb-relay-server.ts`. Edge functions call the relay (via `FB_RELAY_URL`) to run sweeps. Relay does the actual FB calls from residential IP.

**Architecture:**
```
pg_cron → edge function → FB_RELAY_URL/graphql-sweep → [residential IP] → FB GraphQL → return listings → edge function → upsert to DB
```

**What needs building:**
1. Add `/graphql-sweep` endpoint to `fb-relay-server.ts`
   - Accepts: location slug, lat/lng, cursor, year_min/max
   - Returns: listings array + next_cursor
2. Update `fb-marketplace-bot-scraper` to use relay when `FB_RELAY_URL` is set
3. Keep cloudflare tunnel running (requires machine to be on)

**Pros:** Automated, no manual intervention per run.
**Cons:** Relay must be running continuously. Single point of failure. Cloudflare tunnel has periodic disconnects.

### Path 3: Session Replay (HIGH EFFORT, HIGH REWARD)
**Mechanism:** Authenticate a real FB account, extract session cookies (`c_user`, `xs`, `datr`), replay in edge function requests. Removes the residential IP requirement and unlocks additional data (vehicle_info fields, seller info).

**What's needed:**
- FB account authentication
- Cookie extraction (`c_user`, `xs`, `datr`, `fr` tokens)
- Session refresh mechanism (cookies expire ~90 days)
- `fb_dtsg` token for write operations

**Why it's better:**
- Works from any IP (authenticated requests bypass IP fingerprinting)
- Returns structured vehicle_info (year, make, model, mileage, transmission)
- Access to seller profiles and messaging
- Higher rate limits (authenticated users get more API quota)

**Why it's risky:**
- Account gets banned if detected
- Need to rotate accounts or use residential proxy for session acquisition
- FB's 100-person anti-scraping team actively monitors this

---

## Key Technical Numbers

| Metric | Value |
|--------|-------|
| Listings per GraphQL page | 24 |
| Radius used | 65,000 meters (~40 miles) |
| Category ID for vehicles | 807311116002614 |
| Year filter field name | "year" (numericVerticalFieldsBetween) |
| US metros configured | 43 |
| Vintage fraction of all listings (title parsed) | ~8-17% per metro |
| Estimated vintage listings per metro | ~200-400 (title-parsed from all-years query) |
| Estimated total vintage listings (43 metros) | ~9,000-17,000 |
| NOTE: Year URL filter / GraphQL filter | IGNORED — does not constrain results |
| HTML page size (residential) | ~1.1 MB |
| HTML page size (datacenter) | ~460 KB (stripped) |

---

## Next Steps (prioritized)

1. **Immediate:** Run `--all` sweep from local Mac to populate `marketplace_listings` with initial dataset
2. **Short-term:** Add `/graphql-sweep` to relay server, set up pg_cron to call it via edge function
3. **Medium-term:** Build session replay path using FB account cookies (session acquisition via Playwright on residential)
4. **Infrastructure:** Keep relay tunnel alive with a daemon/launchd plist

---

## Anti-Detection Notes

- Use 1.5-3 second delays between page fetches
- Fresh LSD token per location (fetched from that location's HTML page)
- Do NOT cache LSD tokens — they are session-specific and change each request
- FB's EDM team (100+ people) monitors for bulk access patterns
- Stay under ~1 request/3 seconds per IP to avoid triggering rate limits
- The "Rate limit exceeded (1675004)" from datacenter IPs is IP-level, not session-level — no amount of token rotation fixes it
