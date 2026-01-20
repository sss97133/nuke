# Intelligent Auction Data Expansion Plan

## Current State: 8/8 Sources Working

| Source | Extracted | Profile Quality | Data Captured |
|--------|-----------|-----------------|---------------|
| Bring a Trailer | 143 | High | title, bid, time, reserve |
| Cars & Bids | 174 | High | title, bid, bids, time, reserve |
| PCarMarket | 24 | Medium | title, bid, time |
| Collecting Cars | 37 | High | title, bid, time |
| Broad Arrow | 30 | Medium | title, estimate |
| RM Sothebys | 22 | Medium | title only |
| Gooding | 15 | Low | title, year |
| SBX Cars | 35 | Medium | title, bid |

**Total: 480 profiles extracted from 8 sources**

---

## Phase 1: HTML-First Data Extraction (Cheap & Fast)

### Priority 1: Financial Analysis Data
Focus on extracting data that enables price analysis and market intelligence.

**Required Fields (HTML only):**
1. **Auction Pricing**
   - Current bid / High bid
   - Bid count / Bid history
   - Reserve status (met/not met/no reserve)
   - Starting bid / Opening bid
   - Estimate range (for consignment auctions)

2. **Vehicle Identification**
   - Year, Make, Model (parsed from title)
   - VIN (if visible in listing)
   - Mileage / Odometer reading
   - Title status (clean, salvage, etc.)

3. **Auction Timing**
   - Auction end time (absolute)
   - Time remaining (relative)
   - Auction start date
   - Days listed

4. **Seller/Auction Context**
   - Seller type (dealer, private, estate)
   - Location (state/country)
   - Shipping options available

### Priority 2: Vehicle Specifications (HTML)
Data that helps categorize and compare vehicles:

- Engine type/displacement
- Transmission type
- Drivetrain (RWD, AWD, FWD)
- Color (exterior/interior)
- Options/features list
- Modifications (if any)

### Priority 3: Market Behavior Signals
Behavioral data that predicts auction outcomes:

- Bid velocity (bids per hour)
- Watcher/follower count
- Comment count/engagement
- Time since last bid
- Final 24-hour bid activity

---

## Phase 2: Structured Data Extraction

### Approach: Source-Specific Parsers

Each auction site has predictable data structures. Build dedicated parsers for:

1. **Bring a Trailer** (highest volume, best data)
   - Detailed vehicle specs in listing
   - Full bid history available
   - Comments/questions visible
   - Seller verification status

2. **Cars & Bids** (growing platform)
   - Reserve indicator
   - Seller reputation
   - Video walkaround links
   - Inspection reports

3. **PCarMarket** (Porsche specialist)
   - Porsche-specific options (PTS, etc.)
   - Service history indicators
   - Authenticity documentation

4. **Collecting Cars** (global market)
   - Multiple currency support
   - International shipping data
   - Multi-region pricing

5. **Broad Arrow / RM Sotheby's** (high-end)
   - Estimate ranges
   - Provenance information
   - Auction house expertise
   - Historical sale records

---

## Phase 3: Image Processing (Later, Expensive)

### When to Add Images
- After HTML extraction is stable and comprehensive
- When budget allows for vision AI costs
- When specific use cases require visual analysis

### Image Use Cases
1. **Condition Assessment** - Damage detection, wear analysis
2. **Authenticity Verification** - Matching documented features
3. **Option Identification** - Visual feature extraction
4. **Quality Scoring** - Photo quality as seller quality signal

---

## Technical Architecture

### Data Pipeline

```
1. Scheduled Crawl (every 15 min for live auctions)
   ↓
2. HTML Extraction (Playwright)
   ↓
3. Parse & Normalize (source-specific parsers)
   ↓
4. Validate & Dedupe
   ↓
5. Store in vehicles table
   ↓
6. Update auction_events for bid history
```

### Database Schema Alignment

Current `vehicles` table fields for auction data:
- `high_bid` - Current/final bid amount
- `bid_count` - Number of bids
- `auction_end_date` - When auction ends
- `reserve_status` - 'no_reserve', 'reserve', 'reserve_met', 'reserve_not_met'
- `auction_source` - Source site name
- `sale_status` - 'auction_live', 'auction_ended', 'sold', etc.

### Crawl Frequency Strategy

| Auction State | Crawl Frequency |
|---------------|-----------------|
| > 24h remaining | Every 6 hours |
| 6-24h remaining | Every hour |
| < 6h remaining | Every 15 min |
| < 1h remaining | Every 5 min |
| Ended | Once (final results) |

---

## Financial Analysis Opportunities

### Market Intelligence Products

1. **Price Prediction**
   - Historical sales by make/model/year
   - Reserve rate analysis
   - Seasonal pricing patterns

2. **Arbitrage Detection**
   - Price gaps between platforms
   - Regional price differences
   - Undervalued auction alerts

3. **Market Trends**
   - Rising/falling model values
   - Collector interest shifts
   - Emerging collectible identification

4. **Seller Analytics**
   - Seller performance metrics
   - Dealer inventory tracking
   - Market maker identification

### Behavioral Analysis

1. **Bid Pattern Analysis**
   - Sniper detection
   - Proxy bidding behavior
   - Bid shilling indicators

2. **Engagement Metrics**
   - Listing quality scoring
   - Description completeness
   - Photo quality impact on price

3. **Timing Analysis**
   - Best day/time to list
   - Best day/time to bid
   - Auction length optimization

---

## Expansion Roadmap

### Week 1-2: Stabilize & Enhance
- Fix PCarMarket duplicate extraction issue
- Clean Gooding title parsing
- Add proper time remaining calculation
- Implement deduplication by URL + auction end date

### Week 3-4: Depth Over Breadth
- Add detail page scraping for top 3 sources
- Extract full bid history from BaT
- Parse vehicle specifications
- Add mileage extraction

### Month 2: Scale & Automate
- Scheduled extraction (cron/edge functions)
- Alerts for ending auctions
- Price change tracking
- Historical data archival

### Month 3: Analysis Layer
- Price prediction models
- Market trend dashboards
- Arbitrage detection system
- Automated reporting

---

## Cost Considerations

### HTML Extraction (Current)
- Playwright instances: Free (local) or ~$0.01/run (cloud)
- Database storage: Minimal (text data)
- **Estimated monthly: $10-50**

### Image Processing (Future)
- Vision AI: ~$0.01-0.03 per image
- Storage: ~$0.02/GB for images
- **Estimated monthly: $100-500** (depending on volume)

### Recommendation
**Stay HTML-first for 3-6 months.** The financial analysis value from HTML data alone is substantial. Add image processing only when specific high-value use cases are identified.

---

## Next Immediate Actions

1. **Run auction extractor on schedule** - Every hour during market hours
2. **Build bid history tracking** - Store bid changes over time
3. **Create auction end alerts** - Notify when auctions entering final phase
4. **Develop price comparison API** - Cross-source price lookup
5. **Archive ended auctions** - Historical sales database

---

*Generated: 2026-01-20*
*Status: 8/8 auction sources operational*
