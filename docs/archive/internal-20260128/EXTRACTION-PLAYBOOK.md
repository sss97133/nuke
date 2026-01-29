# Nuke Extraction Playbook

> Verified technical documentation. Last updated: 2025-01-25

## Proven Extractors (with active vehicle counts)

| Source | Active Vehicles | Extractor | Type | Status |
|--------|-----------------|-----------|------|--------|
| **Bring a Trailer** | 24,416 | `bat-simple-extract` | Edge Function | ✅ Working |
| **Mecum** | 4,681 | `mecum-proper-extract.js` | Playwright | ✅ Working |
| **Cars & Bids** | 4,736 | `extract-cars-and-bids-core` | Edge Function | ⚠️ CF Blocked |
| **Craigslist** | 6,532 | `scrape-craigslist-search` | Edge Function | ✅ Working |
| **Hagerty** | 36 | `hagerty-proper-extract.js` | Playwright | ✅ Working |
| **PCarMarket** | 5 | `pcarmarket-proper-extract.js` | Playwright | ✅ Working |
| **Hemmings** | 0 | `hemmings-proper-extract.js` | Playwright | ⚠️ CF Blocked |

**Total Active Vehicles: 63,127**

---

## Verified Edge Functions (tested & deployed)

```
✓ bat-simple-extract           # BaT single listing extraction
✓ extract-cars-and-bids-core   # C&B extraction (needs CF bypass)
✓ extract-hagerty-listing      # Hagerty Marketplace
✓ import-pcarmarket-listing    # PCarMarket listings
✓ extract-rm-sothebys          # RM Sotheby's (deployed, untested at scale)
✓ extract-bonhams              # Bonhams (deployed, untested at scale)
✓ extract-dupont-registry      # Dupont Registry (deployed, untested at scale)
✓ extract-vehicle-data-ai      # Generic AI extraction fallback
✓ smart-extraction-router      # Auto-routes to correct extractor
✓ scrape-vehicle-with-firecrawl # Firecrawl wrapper
✓ scrape-vehicle               # Generic scraper
```

---

## Verified Playwright Scripts

All exist at `/Users/skylar/nuke/scripts/`:

```
✓ mecum-proper-extract.js      # 11KB - Mecum with workers
✓ hagerty-proper-extract.js    # 9KB - Hagerty extraction
✓ pcarmarket-proper-extract.js # 9KB - PCarMarket extraction
✓ carsandbids-proper-extract.js # 11KB - C&B (blocked by CF)
✓ hemmings-proper-extract.js   # 10KB - Hemmings (blocked by CF)
```

---

## "Go Fetch" Execution Flow

```
INPUT: URL or "go fetch [source]"
         │
         ▼
    Parse Domain
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│ ROUTING TABLE                                           │
├─────────────────────────────────────────────────────────┤
│ bringatrailer.com → bat-simple-extract (edge fn)        │
│ mecum.com         → mecum-proper-extract.js (Playwright)│
│ hagerty.com       → hagerty-proper-extract.js           │
│ pcarmarket.com    → pcarmarket-proper-extract.js        │
│ carsandbids.com   → ⚠️ CF blocked                       │
│ hemmings.com      → ⚠️ CF blocked                       │
│ craigslist.org    → scrape-craigslist-search            │
│ UNKNOWN           → scrape-vehicle-with-firecrawl + AI  │
└─────────────────────────────────────────────────────────┘
```

---

## Commands That Work

### Check Status
```bash
# Pipeline status
dotenvx run -- node scripts/extraction-state.js summary

# Quick pending count by source
dotenvx run -- node -e "
const S=process.env.VITE_SUPABASE_URL,K=process.env.SUPABASE_SERVICE_ROLE_KEY;
['bat','mecum','hagerty','pcarmarket','carsandbids','hemmings'].forEach(async s=>{
  const r=await fetch(S+'/rest/v1/vehicles?discovery_source=eq.'+s+'&status=eq.pending&select=id&limit=1',
    {headers:{'apikey':K,'Authorization':'Bearer '+K,'Prefer':'count=exact'}});
  console.log(s.padEnd(15),r.headers.get('content-range')?.split('/')[1]||'0','pending');
});
"
```

### Run Extraction
```bash
# Unified runner (all Playwright sources)
dotenvx run -- node scripts/run-extractions.js

# Specific source
dotenvx run -- node scripts/run-extractions.js mecum

# Direct Playwright script
dotenvx run -- node scripts/mecum-proper-extract.js 200 3
# Args: [batch_size] [worker_count]
```

### Single URL via Edge Function
```bash
# BaT
curl -X POST "$SUPABASE_URL/functions/v1/bat-simple-extract" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://bringatrailer.com/listing/..."}'

# Generic (auto-routes)
curl -X POST "$SUPABASE_URL/functions/v1/smart-extraction-router" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://any-site.com/listing/..."}'
```

---

## Data Schema (what extractors produce)

```typescript
interface ExtractedVehicle {
  url: string;              // Required - source URL
  year: number | null;      // 4-digit year
  make: string | null;      // Normalized (Chevrolet not Chevy)
  model: string | null;     // Clean model name
  vin: string | null;       // 17-char VIN for dedup
  mileage: number | null;
  exterior_color: string | null;
  interior_color: string | null;
  transmission: string | null;
  engine: string | null;
  sale_price: number | null;
  seller_username: string | null;
  image_urls: string[];
  description: string | null;
}
```

---

## Current Blockers

### Cloudflare Protection
**Affected:** Cars & Bids (15,620 pending), Hemmings (30 pending)

**Tried:**
- Standard Playwright → blocked
- Firecrawl → works but credits exhausted

**Options:**
1. Wait for Firecrawl credits to refresh
2. puppeteer-extra-plugin-stealth
3. Residential proxy rotation
4. Manual browser session with saved cookies

---

## File Locations

```
/Users/skylar/nuke/
├── supabase/functions/           # Edge functions
│   ├── bat-simple-extract/       # ✅ Proven
│   ├── extract-cars-and-bids-core/
│   ├── extract-hagerty-listing/
│   ├── import-pcarmarket-listing/
│   ├── extract-vehicle-data-ai/  # Generic fallback
│   └── smart-extraction-router/  # Auto-routing
├── scripts/
│   ├── mecum-proper-extract.js   # ✅ Proven (4,681 vehicles)
│   ├── hagerty-proper-extract.js # ✅ Proven (36 vehicles)
│   ├── pcarmarket-proper-extract.js # ✅ Proven (5 vehicles)
│   ├── carsandbids-proper-extract.js # CF blocked
│   ├── hemmings-proper-extract.js    # CF blocked
│   ├── run-extractions.js        # Unified runner
│   ├── extraction-state.js       # State tracking
│   └── fix-craigslist-data.js    # Data cleanup
└── docs/
    └── EXTRACTION-PLAYBOOK.md    # This file
```

---

## Verification Queries

```sql
-- Active vehicles by source
SELECT discovery_source, COUNT(*)
FROM vehicles
WHERE status = 'active'
GROUP BY discovery_source
ORDER BY COUNT(*) DESC;

-- Pending extraction queue
SELECT discovery_source, COUNT(*) as pending
FROM vehicles
WHERE status = 'pending'
GROUP BY discovery_source
ORDER BY pending DESC;

-- Data quality check
SELECT
  discovery_source,
  COUNT(*) as total,
  COUNT(vin) as has_vin,
  COUNT(sale_price) as has_price,
  ROUND(100.0 * COUNT(vin) / COUNT(*), 1) as vin_pct
FROM vehicles
WHERE status = 'active'
GROUP BY discovery_source;
```
