# Go Fetch - Quick Reference

> Verified commands only. See EXTRACTION-PLAYBOOK.md for full details.

## Proven Sources (with data)

```
BaT         24,416 active   bat-simple-extract (edge fn)
Mecum        4,681 active   mecum-proper-extract.js
C&B          4,736 active   ⚠️ CF blocked
Craigslist   6,532 active   scrape-craigslist-search
Hagerty         36 active   hagerty-proper-extract.js
PCarMarket       5 active   pcarmarket-proper-extract.js
Hemmings         0 active   ⚠️ CF blocked
```

## Run Extraction

```bash
# All working sources
dotenvx run -- node scripts/run-extractions.js

# Specific source
dotenvx run -- node scripts/run-extractions.js mecum
dotenvx run -- node scripts/run-extractions.js hagerty
dotenvx run -- node scripts/run-extractions.js pcarmarket

# Direct with batch size and workers
dotenvx run -- node scripts/mecum-proper-extract.js 200 3
```

## Single URL

```bash
# Auto-route to correct extractor
curl -X POST "$SUPABASE_URL/functions/v1/smart-extraction-router" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "THE_URL"}'
```

## Check Status

```bash
dotenvx run -- node scripts/extraction-state.js summary
```

## Blocked by Cloudflare

- Cars & Bids: 15,620 pending
- Hemmings: 30 pending

Need Firecrawl credits or stealth bypass.
