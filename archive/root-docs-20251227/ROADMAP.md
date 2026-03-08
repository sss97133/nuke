# Nuke Platform Roadmap

## Current State (Dec 2, 2025)

### Data Inventory
| Metric | Count |
|--------|-------|
| Active Vehicles | 234 |
| Pending (need images/data) | 226 |
| Archived (bad data) | 52 |
| Auction Events | 1 |
| Component Definitions | 16 |
| Reference Documents | 32 |
| Knowledge Gaps Tracked | 4 |

### Working Systems
- Vehicle scraping (BaT, ClassicCars work well)
- Image download and storage
- Tier 1 AI analysis (basic categorization)
- Auction outcome detection (sold vs RNM)
- Database schema for reference system

### Blocked/Needs Work
- Hemmings scraping (bot protection)
- KSL scraping (500 errors - rate limit?)
- Tier 2 AI analysis (needs reference library)
- Reference document indexing (PDFs not processed)
- Parts pricing integration

---

## Phase 1: Data Quality (This Week)

### 1.1 Fix Scraping Issues
- [ ] Implement exponential backoff for rate limits
- [ ] Add proxy rotation for bot-protected sites
- [ ] Create fallback extraction for failed scrapes

### 1.2 Complete Pending Vehicles
- [ ] Re-scrape 44 ClassicCars listings
- [ ] Handle 36 Hemmings with slower rate
- [ ] Evaluate 49 "Other" sources

### 1.3 Data Validation
- [ ] Verify year/make/model accuracy
- [ ] Cross-validate VINs with NHTSA
- [ ] Check for duplicate listings

---

## Phase 2: Reference Library (Next 2 Weeks)

### 2.1 Service Manual Indexing
The 5 GM service manuals (1973, 1977, 1980, 1981, 1987) need to be:
- [ ] Downloaded and stored
- [ ] OCR processed for text extraction
- [ ] Chunked into searchable sections
- [ ] Embedded for vector search
- [ ] Page-level citations enabled

### 2.2 Component Knowledge Base
Expand from 16 to comprehensive coverage:
- [ ] Exterior components (grilles, bumpers, fenders, trim)
- [ ] Interior components (dash, seats, door panels)
- [ ] Drivetrain (engines, transmissions, axles)
- [ ] Suspension and steering
- [ ] Electrical systems
- [ ] Year-specific variations (73-75, 76-80, 81-87)

### 2.3 Parts Pricing Integration
- [ ] LMC Truck catalog scraping
- [ ] Classic Industries pricing
- [ ] eBay sold listings for rare parts
- [ ] Real-time price updates

---

## Phase 3: AI Analysis Pipeline (Month 2)

### 3.1 Tier 2 Expert Analysis
- [ ] Component identification with confidence scores
- [ ] Condition assessment (1-10 scale with criteria)
- [ ] Modification detection (stock vs aftermarket)
- [ ] Authenticity verification (matching numbers, correct parts)

### 3.2 Epistemic Awareness
- [ ] Track what AI knows vs infers vs doesn't know
- [ ] Auto-generate research requests for unknowns
- [ ] Citation system linking to reference documents
- [ ] Handoff notes for human experts

### 3.3 Research Agent
- [ ] Auto-search for missing component info
- [ ] Cross-reference parts catalogs
- [ ] Find comparable sales for valuation
- [ ] Update knowledge gaps when resolved

---

## Phase 4: Market Intelligence (Month 3)

### 4.1 Price Analytics
- [ ] Trend charts by YMM
- [ ] Condition-adjusted valuations
- [ ] Regional price variations
- [ ] Seasonal patterns

### 4.2 Auction Analysis
- [ ] Success rate by seller type
- [ ] Reserve gap patterns (why auctions fail)
- [ ] Optimal pricing recommendations
- [ ] Time-to-sell predictions

### 4.3 Dealer Intelligence
- [ ] Inventory tracking across dealers
- [ ] Markup analysis
- [ ] Turnover rates
- [ ] Quality scoring

---

## Phase 5: User Features (Month 4)

### 5.1 Vehicle Profiles
- [ ] Claim/verify ownership
- [ ] Maintenance timeline
- [ ] Parts wishlist with pricing
- [ ] Repair cost estimates

### 5.2 Marketplace Features
- [ ] Contact seller integration
- [ ] Price alerts
- [ ] Saved searches
- [ ] Comparison tools

### 5.3 Community
- [ ] Expert verification badges
- [ ] Contribution tracking
- [ ] Knowledge sharing rewards

---

## Technical Debt

### Database
- [ ] Fix `vehicle_id` column warning in completeness trigger
- [ ] Add indexes for common queries
- [ ] Partition large tables by date

### Scraping
- [ ] Move to dedicated scraping service (not edge functions)
- [ ] Implement job queue with retries
- [ ] Add monitoring and alerting

### Frontend
- [ ] Code splitting for bundle size
- [ ] Image lazy loading
- [ ] Offline support

---

## Key Metrics to Track

### Data Quality
- % of vehicles with complete data (year, make, model, VIN, images)
- % of images with AI analysis
- Knowledge gap resolution rate

### Market Coverage
- Unique vehicles tracked
- Auction events captured
- Price data points per YMM

### User Value
- Accuracy of price estimates
- Time saved in research
- Parts cost savings identified

