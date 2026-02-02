# Source Operations Architecture

## The Problem
- Need 200+ extractors running constantly
- Sources change, break, go stale
- New sources emerge daily
- "Ugly sources" (eBay, Copart, Manheim) have good data buried in noise

## Three Teams

### Team 1: Source Health (Monitoring)
**Job**: Keep tabs on all existing sources

```
┌─────────────────────────────────────────┐
│         SOURCE HEALTH MONITOR           │
├─────────────────────────────────────────┤
│ Per-source metrics:                     │
│ - Last successful extraction            │
│ - Success rate (24h/7d/30d)             │
│ - Avg extraction time                   │
│ - Data quality score                    │
│ - Cloudflare/block status               │
│ - Schema drift detection                │
│                                         │
│ Alerts:                                 │
│ - Source down > 1 hour                  │
│ - Success rate < 80%                    │
│ - New fields detected                   │
│ - Extraction time 2x baseline           │
└─────────────────────────────────────────┘
```

### Team 2: Source Discovery (Growth)
**Job**: Find new sources constantly

```
Targets:
- Regional auction houses (500+ exist)
- Marque-specific forums (911uk, e30zone, etc.)
- Facebook Groups (private sales)
- Instagram dealers (@carsandbids posts)
- YouTube lot walks
- Estate sales, barn finds
- International (Japan, UK, Germany auctions)
```

### Team 3: Ugly Source Filtering
**Job**: Extract signal from noisy sources

```
┌─────────────────────────────────────────┐
│         UGLY SOURCE FILTERS             │
├─────────────────────────────────────────┤
│ eBay:                                   │
│ - Skip "Parts Only" listings            │
│ - Skip sellers with < 95% feedback      │
│ - Skip prices < $500 or > $5M           │
│ - Require actual photos (not stock)     │
│ - Verify VIN matches description        │
│                                         │
│ Copart:                                 │
│ - Filter by damage type (minor only?)   │
│ - Skip "Certificate of Destruction"     │
│ - Flag salvage/rebuilt title            │
│ - Extract pre-accident value estimate   │
│                                         │
│ Manheim:                                │
│ - Dealer wholesale = lower confidence   │
│ - Extract condition report if available │
│ - Cross-reference with retail listings  │
└─────────────────────────────────────────┘
```

## Source Registry Table

```sql
CREATE TABLE source_registry (
  id UUID PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL, -- auction, marketplace, forum, social, dealer

  -- Health
  status TEXT DEFAULT 'active', -- active, degraded, blocked, archived
  last_successful_at TIMESTAMPTZ,
  success_rate_24h FLOAT,
  avg_extraction_ms INT,

  -- Config
  extractor_function TEXT, -- edge function name
  fallback_method TEXT, -- playwright, firecrawl, manual
  requires_auth BOOLEAN DEFAULT false,
  cloudflare_protected BOOLEAN DEFAULT false,

  -- Quality
  data_quality_score FLOAT, -- 0-1
  is_ugly_source BOOLEAN DEFAULT false,
  quality_filters JSONB, -- source-specific filters

  -- Discovery
  discovery_url TEXT, -- where to find new listings
  discovery_method TEXT, -- sitemap, api, crawl, rss
  discovery_frequency INTERVAL DEFAULT '1 hour',

  -- Metrics
  total_extracted INT DEFAULT 0,
  total_vehicles_created INT DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

## Known Sources Status

| Source | Status | Extractor | Quality | Notes |
|--------|--------|-----------|---------|-------|
| Bring a Trailer | Active | extract-bat-core | High | Comment pollution fixed |
| Cars & Bids | Blocked | - | High | Cloudflare |
| Collecting Cars | Active | extract-collecting-cars | High | Typesense API bypass |
| Craigslist | Active | extract-craigslist | Medium | JSON-LD extraction |
| Hemmings | Pending | - | High | 30 in queue |
| Mecum | Blocked | - | High | Cloudflare |
| Barrett-Jackson | Blocked | - | High | Cloudflare |
| eBay Motors | Not started | - | LOW | Ugly source |
| Copart | Not started | - | LOW | Salvage/ugly |
| Manheim | Not started | - | Medium | Dealer wholesale |
| Facebook MP | Active | fb-marketplace | Medium | Requires Meta API |
| AutoTrader | Not started | - | Medium | |
| CarGurus | Not started | - | Medium | |
| Classic.com | Blocked | - | High | Cloudflare |
| PCarMarket | Active | import-pcarmarket | High | |
| Hagerty | Active | extract-hagerty | High | |

## Priority Actions

1. **Build source_registry table** - Central tracking
2. **Create health monitor cron** - Alert on degradation
3. **eBay filter system** - Extract good listings only
4. **Discovery crawler** - Find new auction houses
5. **Scale to 200 extractors** - Parallel processing

## The Vision

```
200 extractors running 24/7
├── 50 premium sources (BaT, C&B, Mecum, etc.)
├── 50 regional auctions (Russo & Steele, Worldwide, etc.)
├── 50 marketplace sources (eBay, FB, CL variants)
├── 30 forum sources (Rennlist, Pelican, etc.)
└── 20 international (Japan, UK, Germany)

Metrics:
- 10,000+ new listings discovered/day
- 1,000+ vehicles extracted/day
- 99% source uptime
- Never zero extraction
```
