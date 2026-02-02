# Active Agents Coordination

Last updated: 2026-02-01 ~9:15pm PST

## MEGA SHIP FLEET - 19 Agents Running

| Agent | Task | Status |
|-------|------|--------|
| a66a703 | BaT pending queue processing | Running |
| a6af507 | Collecting Cars queue (Typesense API) | Running |
| a789f98 | C&B Playwright Cloudflare bypass | Running |
| a8ce971 | Hemmings queue processing | Running |
| a81e762 | Craigslist backlog | Running |
| acc92b2 | Failed queue retry (8,752 items) | Running |
| a5443bb | PCarMarket extraction | Running |
| a00a224 | Hagerty extraction | Running |
| a089453 | eBay parts catalog expansion | Running |
| ad4cf66 | Live auction sync monitor | Running |
| afa5610 | Regional auction discovery | Running |
| ae7ec4a | BaT live listings discovery | Running |
| a915222 | Ollama fallback activation | Running |
| a635bf7 | Forum discovery (30 sources) | Running |
| a9a35f1 | Queue health monitor setup | Running |
| a2855f5 | International auction discovery | Running |
| ac0f985 | AutoTrader scout | Running |
| a22228d | CarGurus scout | Running |
| a348b81 | DuPont Registry scout | Running |

## Principle: NEVER ZERO

Extraction must always trend upward. Fallback hierarchy:
1. Native Extractors (fast, free)
2. API Bypasses (Typesense, etc.)
3. Firecrawl (when credits available)
4. Playwright (slow, free)
5. Ollama Local (slow, free)

## Priority Queue

### P0 - Critical
- [ ] **OpenAI quota exhausted** - blocks AI extractors (Ollama fallback available)
- [ ] **Cars & Bids Cloudflare** - needs Playwright bypass solution

### P1 - Process Queues
- [ ] Process BaT pending extractions
- [ ] Process Collecting Cars queue items
- [ ] Process Hemmings queue (30 items)
- [ ] Process Craigslist backlog

### P2 - Source Expansion
- [ ] eBay Motors extractor (ugly source - needs filters)
- [ ] Copart extractor (salvage - needs filters)
- [ ] Regional auction house discovery

### P3 - Blocked Sources
- [ ] Cars & Bids (Cloudflare)
- [ ] Classic.com (Cloudflare)
- [ ] Mecum (Cloudflare)
- [ ] Barrett-Jackson (Cloudflare)

## Session Stats

| Metric | Value |
|--------|-------|
| Vehicles | 219,610 |
| Live BaT Auctions | 126 |
| Pending Queue | 71,489 |
| Active Sources | 5 (BaT, CC, CL, Hagerty, PCarMarket) |
| Blocked Sources | 4 (C&B, Classic.com, Mecum, BJ) |

## How to Claim
1. Pick an unclaimed task from priority queue
2. Add yourself to Running table
3. Check the task box when done
