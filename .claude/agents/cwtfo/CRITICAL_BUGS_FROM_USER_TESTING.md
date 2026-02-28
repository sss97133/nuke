# CRITICAL BUGS FROM USER TESTING
**Date: 2026-02-26**
**Source: AI user panel (5 personas tested nuke.ag)**

---

## P0 — BLOCKING REVENUE

### 1. Search/API Filtering Completely Broken
**Reported by:** Marcus (collector), Priya (data scientist)

**Symptom:**
- Query: `?make=Porsche&model=911&year=1973`
- Expected: Porsche 911s from 1973
- Actual: Random vehicles (Mercedes, Ford, tractors, golf carts)
- Search UI: "porsche 997 gt3" → 0 actual 997 GT3s, got 911SC/944/Cayman/Firebird/Austin-Healey
- Duplicate results (same Safari 911SC appeared 10+ times)

**Impact:**
- Platform unusable for targeted research
- API worthless for ML training
- Users can't find what they're looking for
- Makes entire product look broken

**Owner:** VP Platform / CTO
**Files:**
- `supabase/functions/api-v1-vehicles/index.ts`
- `supabase/functions/universal-search/index.ts`
- Frontend search components

**Fix Required:**
- Audit query parameter handling in API endpoints
- Fix make/model/year filtering logic
- Implement deduplication in search results
- Add search relevance scoring

---

### 2. Data Not Surfacing in Search UI
**Reported by:** Priya (data scientist), Marcus (collector)

**Symptom:**
- Database has 625K observations
- Search results show "F tier, 0 data points" on every vehicle
- No images visible in search results (despite 33M images in DB)
- Quality scores exist but don't display

**Impact:**
- Users think database is empty
- Can't evaluate vehicles from search page
- Forces clicking into every result (terrible UX)

**Owner:** VP Platform
**Files:**
- Frontend search result components
- API response formatting
- Image URL generation

**Fix Required:**
- Surface observation count in search results
- Show primary image thumbnails
- Display quality scores
- Show key specs (year/make/model/price) in result cards

---

### 3. Market Dashboard Database Timeout
**Reported by:** Marcus (collector), James (investor)

**Symptom:**
- Error: "canceling statement due to statement timeout"
- Shows 4 submarkets with 0 vehicles each
- $0 AUM contradicts $40K market cap in database
- 7d/30d changes all show "—"

**Impact:**
- Makes platform look broken/fake
- Investor rejected based on this error
- Can't demonstrate market value proposition

**Owner:** VP Platform / CFO
**Files:**
- `supabase/functions/api-v1-exchange/index.ts`
- Market dashboard component
- `market_segment_stats` or `market_segment_stats_cache` queries

**Fix Required:**
- Fix slow query (use cache table)
- Populate actual fund holdings
- Calculate real NAV or remove feature
- Either make it work or hide it until ready

---

## P1 — DEGRADED EXPERIENCE

### 4. Missing Core Search Filters
**Reported by:** All 5 users

**Missing:**
- Price range filter
- Year range filter
- Mileage filter
- Location/distance filter
- Transmission type filter
- "For Sale Now" vs "Sold" toggle
- Sort by price/date/relevance

**Impact:**
- Users can't narrow results
- Have to manually scan hundreds of irrelevant listings
- Dealers (Sarah) can't find inventory efficiently

**Owner:** VP Platform
**Priority:** High but blocked by P0 search fix

---

### 5. No VIN Search
**Reported by:** Dave (restorer)

**Symptom:**
- Tried searching by VIN → no results
- No dedicated VIN lookup field

**Impact:**
- Can't verify specific vehicles
- Dealers checking car history can't use platform

**Owner:** VP Platform
**Fix:** Add VIN search field, direct lookup endpoint

---

### 6. Data Completeness Issues
**Reported by:** Priya (data scientist)

**Stats from sample:**
- VIN: 32% complete ❌
- Mileage: 42% complete ❌
- Sale price: 66% complete
- Transmission: 66% complete
- Overall: 50% null rate

**Impact:**
- Only 22% of records usable for ML models
- Can't build reliable price predictions
- Undermines "comprehensive data" claim

**Owner:** VP Extraction + VP Intel
**Fix:** Backfill campaign for VIN/mileage/specs

---

## P2 — FEATURE GAPS

### 7. No Comparable Sales / Price Intelligence
**Reported by:** Marcus (collector), Sarah (dealer)

**Missing:**
- "Show me recent sales of similar cars"
- Price trends over time
- Market appreciation/depreciation data
- Outlier explanations (why did this one sell higher?)

**Impact:**
- This is the #1 requested feature
- Users would pay $20-30/month for this
- Without it, platform is just an archive

**Owner:** VP Intel
**Scope:** New feature, not a bug fix

---

### 8. No Service Records / Documentation
**Reported by:** Dave (restorer)

**Symptom:**
- Database has `service_records` table with 242 records (across 1M vehicles)
- No build sheets, no Ferrari Classiche certs, no COAs
- Can't assess authenticity or maintenance history

**Impact:**
- Restorers can't use platform for professional work
- Missing key provenance data
- Auction comments partially fill gap but not structured

**Owner:** VP Docs (if exists) or VP Intel
**Scope:** Major data acquisition effort

---

### 9. API Export Limitations
**Reported by:** Priya (data scientist)

**Missing:**
- No CSV/Parquet export
- No bulk download endpoint
- Must paginate through 21K pages to get 1M vehicles
- Rate limit (1K req/hour) makes this 10+ hours

**Impact:**
- Can't easily extract training data
- Researchers will scrape instead of paying
- Friction for enterprise customers

**Owner:** VP Platform
**Fix:** Add `/api-v1-export` endpoint with CSV/Parquet format

---

## P3 — MARKET EXCHANGE SPECIFIC

### 10. Exchange Not Investment-Grade
**Reported by:** James (investor - family office)

**Issues:**
- Claims Reg A compliance but no SEC Form 1-A filing found
- Static $10 NAV, not mark-to-market
- Zero vehicles in funds despite non-zero market cap
- No custodian disclosed, no audit, no liquidity mechanism

**Impact:**
- Institutional investors will reject immediately
- Potential regulatory risk if claiming compliance falsely
- Can't raise capital until compliant

**Owner:** CFO + Legal
**Scope:** 12-18 month regulatory buildout

---

## WHAT USERS ACTUALLY LIKED

✅ **Vehicle profiles** - 352 images, preserved auction data, timeline view
✅ **Auction comment archives** - 11.6M comments, forensic gold mine
✅ **Fast, clean UI** - professional design, loads quickly
✅ **Architecture** - observation model, multi-source aggregation
✅ **SDK concept** - Stripe-style API is right approach

**Key insight:** The product EXISTS and has VALUE. It's just buried under broken search.

---

## RECOMMENDED PRIORITY ORDER

1. **Fix search filtering** (P0 #1) - everything else is irrelevant if this doesn't work
2. **Surface data in search UI** (P0 #2) - users think DB is empty
3. **Fix or hide market dashboard** (P0 #3) - broken features make everything look broken
4. **Add basic search filters** (P1 #4) - price/year/mileage/location
5. **VIN search** (P1 #5) - quick win, high value
6. **Backfill data gaps** (P1 #6) - ongoing, assign to extraction team
7. **Build comps feature** (P2 #7) - this is the monetization unlock
8. **API export endpoint** (P2 #9) - enables enterprise customers
9. **Service records acquisition** (P2 #8) - long-term data project
10. **Exchange compliance** (P3 #10) - CFO/legal track, 12-18 months

---

## REVENUE IMPACT

**Current state:** Can't charge because search doesn't work.

**If P0 bugs fixed:**
- Marcus: $20-30/month for working search + price trends
- Priya: $200-800/month for API access with export
- Sarah: Maybe $50/month if deal flow features added
- James: Not until Reg A+ filed (12-18 months)
- Dave: $30-50/month if service records added

**Estimated ARR unlock from P0+P1 fixes:** $10K-50K/month (100-500 users at $20-100/month)

**Big money (P2):** Comps feature + API access could justify $500-3K/month enterprise tier.

---

## OWNER ASSIGNMENTS

| Bug | Owner | Estimate |
|-----|-------|----------|
| Search filtering | VP Platform / CTO | 2-3 days |
| Data surfacing | VP Platform | 1-2 days |
| Dashboard fix | VP Platform / CFO | 1 day (or hide it) |
| Search filters | VP Platform | 3-5 days |
| VIN search | VP Platform | 1 day |
| Data backfill | VP Extraction + VP Intel | Ongoing |
| Comps feature | VP Intel | 2-3 weeks |
| API export | VP Platform | 2-3 days |
| Service records | VP Docs / VP Intel | 3-6 months |
| Exchange compliance | CFO + Legal | 12-18 months |

**Critical path:** Search fix → data surfacing → filters → VIN → comps.

Everything else can run in parallel.