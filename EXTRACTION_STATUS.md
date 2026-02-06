# Extraction Status - Updated 2026-02-05

## Current State

### BaT Extraction (Live - Updated 13:31 PST)
- **bat_listings**: 128,721 (target: ~230,000)
- **BaT pending**: 49,823 (down from 91k!)
- **BaT processing**: 30,296 (high parallelism)
- **URLs discovered**: 177,731 (up 40k from start!)
- **Extraction rate**: ~1,500/min
- **ETA to complete pending**: ~33 minutes

### Live Auction Monitoring (Updated 13:31 PST)
- **Collecting Cars**: 505 monitored
- **BaT**: 211 monitored
- **PCarMarket**: 37 monitored
- **SBX Cars**: 30 monitored
- **C&B**: 10 monitored
- **Total**: 793 monitored (target: 800+ - 99% complete!)
- Added BarnFinds, CarForSale, Hemmings, Barrett-Jackson sources
- Discovery agents running for Bonhams, RM Sotheby's, Mecum

### Discovery Progress (Year Crawling)
| Year | Pages Crawled | New URLs Found |
|------|---------------|----------------|
| 2014 | 131 | 7,482 |
| 2015 | 97 | 6,504 |
| 2016 | 137 | 6,366 |
| 2017 | 164 | 13,301 |
| 2018 | 103 | 11,860 |
| 2019 | 195 | 5,569 |
| 2020 | 219 | 4,739 |
| 2021 | 117 | 3,766 |
| 2022-24 | ~1050 each | 22,850 |

**Note**: Each year has ~1,500+ pages. Years 2014-2021 are only 6-14% crawled.

### Other Sites
- **C&B pending**: 44 (Playwright extraction running)
- **PCarMarket pending**: 19 (Playwright extraction running)
- **Collecting Cars pending**: 20 (blocked - needs Firecrawl)

### Running Processes
- 12+ BaT extraction agents (subagents)
- 5 continuous-queue-processors
- Year discovery crawlers for 2015, 2018, 2021
- Playwright multi-source extractor

## Major Actions Taken

1. **Discovered missing data**: Found 91,336 BaT URLs marked "complete" but never actually extracted
2. **Reset to pending**: All 91k URLs now being re-extracted
3. **Year discovery**: Started deep crawling years 2014-2021 (finding ~170 new URLs per page)
4. **Parallel extraction**: Running 15+ parallel workers

## To Monitor

```bash
# Check BaT progress
PGPASSWORD="RbzKq32A0uhqvJMQ" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -c "
SELECT
  (SELECT COUNT(*) FROM bat_listings) as bat_listings,
  (SELECT COUNT(*) FROM import_queue WHERE listing_url LIKE '%bringatrailer%' AND status='pending') as pending
;"

# Check year crawl progress
PGPASSWORD="RbzKq32A0uhqvJMQ" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -c "
SELECT crawl_type, MAX(page_number) as max_page, SUM(urls_new) as new_urls
FROM bat_crawl_state WHERE crawl_type LIKE 'year_%' GROUP BY 1 ORDER BY 1;
"
```

## Blockers

1. **Firecrawl**: API key overdrawn (-140 credits). Need to configure second plan API key for:
   - Collecting Cars (20 pending)
   - Any new C&B/PCarMarket if Playwright fails

## Next Steps

1. Continue year discovery until all years fully crawled (~1500 pages each)
2. Process all 88k+ pending BaT items
3. Fix Firecrawl API key for remaining sites
