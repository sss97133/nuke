# ACTION PLAN — USER TESTING FOLLOW-UP
**Date: 2026-02-26**
**Source: 5 AI users tested nuke.ag, found critical bugs**

---

## IMMEDIATE ACTIONS (THIS WEEK)

### 1. FIX SEARCH FILTERING (P0)
**Owner:** VP Platform / CTO
**Time:** 2-3 days
**Files:**
- `supabase/functions/api-v1-vehicles/index.ts`
- `supabase/functions/universal-search/index.ts`

**Issue:** Query params ignored, returns random vehicles

**Test case:**
```bash
# Should return ONLY Porsche 911s from 1973
curl "https://nuke.ag/api-v1-vehicles?make=Porsche&model=911&year=1973"

# Currently returns: Mercedes, Ford, tractors, golf carts
```

**Acceptance criteria:**
- Make/model/year filters work correctly
- No duplicate results (same car appearing 10+ times)
- Search relevance scoring (exact matches first)

---

### 2. SURFACE DATA IN SEARCH UI (P0)
**Owner:** VP Platform
**Time:** 1-2 days
**Files:** Frontend search components

**Issue:** Backend has data, UI shows "F tier, 0 observations" on everything

**Fix:**
- Display observation count in search results
- Show primary image thumbnails
- Show quality score
- Show key specs (year/make/model/price)

---

### 3. FIX OR HIDE MARKET DASHBOARD (P0)
**Owner:** VP Platform / CFO
**Time:** 1 day
**Decision:** Either fix the query timeout or remove the page entirely

**Issue:** Database timeout error visible to users, shows contradictory data

**Options:**
A) Fix the query (use cache table)
B) Hide page until exchange is production-ready
C) Mark as "DEMO - NOT LIVE" prominently

**Recommendation:** Option B (hide it). James (investor) said it makes platform look fake.

---

## NEXT 30 DAYS

### 4. ADD BASIC SEARCH FILTERS
**Owner:** VP Platform
**Time:** 3-5 days

**Required filters:**
- Price range slider
- Year range
- Mileage range
- Location/distance (zip + radius)
- Transmission type
- "For Sale" vs "Sold" toggle
- Sort by: price, date, relevance

---

### 5. VIN SEARCH
**Owner:** VP Platform
**Time:** 1 day

**Add:**
- VIN input field in search
- Direct VIN lookup endpoint: `/api-v1-vehicles/by-vin/:vin`
- Handle partial VIN matches

---

### 6. DATA BACKFILL CAMPAIGN
**Owner:** VP Extraction + VP Intel
**Time:** Ongoing

**Target improvements:**
- VIN: 32% → 70%+ complete
- Mileage: 42% → 70%+ complete
- Transmission: 66% → 80%+ complete

**Focus:** BaT listings first (highest value), then C&B, Mecum

---

### 7. API EXPORT ENDPOINT
**Owner:** VP Platform
**Time:** 2-3 days

**Add:** `/api-v1-export` endpoint
- Accept: format=csv|json|parquet
- Accept: filters (same as search)
- Return: bulk download link or streaming response
- Rate limit: 10 exports/day for free tier

**This unlocks:** Priya (data scientist) willing to pay $200-800/month

---

## NEXT 90 DAYS

### 8. COMPARABLE SALES FEATURE (THE REVENUE UNLOCK)
**Owner:** VP Intel
**Time:** 2-3 weeks

**Scope:**
- "Show me recent sales of similar cars" button on every vehicle
- Similarity algorithm (make/model/year/trim/mileage/condition)
- Display: last 10-20 comps with sale prices, dates, platforms
- Price trend chart (6-12 month rolling avg)
- Outlier explanations ("This sold higher because: low mileage, rare color")

**Revenue impact:** Marcus willing to pay $20-30/month for this feature alone

---

### 9. SERVICE RECORDS ACQUISITION
**Owner:** VP Docs / VP Intel
**Time:** 3-6 months (ongoing)

**Strategy:**
- Partner with specialist shops (Ferrari dealers, Porsche specialists)
- Allow owners to upload service records
- OCR + AI extraction for structured data
- Build provenance timeline

**Goal:** Move from 242 service records → 100K+ records

---

## REGULATORY TRACK (12-18 MONTHS)

### 10. MARKET EXCHANGE COMPLIANCE
**Owner:** CFO + Legal
**Time:** 12-18 months

**Required:**
- File SEC Reg A+ (Form 1-A)
- Engage registered broker-dealer or file BD license
- Appoint qualified custodian
- Independent valuation methodology
- Big 4 audit
- Deploy >$5M in actual vehicle acquisitions

**Until then:** Keep exchange as internal demo, don't market to investors

---

## METRICS TO TRACK

**Weekly:**
- Search success rate (% queries returning relevant results)
- Data completeness (VIN %, mileage %, price %)
- API error rate

**Monthly:**
- User signups (track cohorts: collectors, dealers, researchers)
- Feature usage (which features drive retention?)
- Revenue (once we start charging)

**Quarterly:**
- Data coverage (# vehicles, # observations)
- Regulatory progress (SEC filing status)

---

## WHO OWNS WHAT

| Area | Owner | Key Deliverables |
|------|-------|------------------|
| Search/API | VP Platform / CTO | Fix filtering, add filters, VIN search, export endpoint |
| Data Quality | VP Extraction + VP Intel | Backfill VIN/mileage, service records acquisition |
| Pricing Intelligence | VP Intel | Comps feature, price trends, market analysis |
| Market Exchange | CFO + Legal | Reg A+ filing, compliance buildout |
| Documentation | VP Docs (TBD) | Service records, build sheets, provenance |

---

## NEXT STEPS

1. **File tasks** in `agent_tasks` for each P0/P1 item
2. **Assign owners** - tag VP Platform, VP Extraction, VP Intel
3. **Set deadlines** - P0 items due this week
4. **Daily standups** - track progress on critical path
5. **Re-test in 2 weeks** - run user panel again to verify fixes

---

## REVENUE FORECAST (OPTIMISTIC)

**If P0+P1 fixed (30 days):**
- 100 users at $20-30/month → $2K-3K MRR
- 10 API users at $200/month → $2K MRR
- **Total: $4K-5K MRR**

**If P2 features added (90 days):**
- 500 users at $20-50/month → $10K-25K MRR
- 50 API users at $200-800/month → $10K-40K MRR
- **Total: $20K-65K MRR**

**Current state: $0 MRR** (can't charge with broken search)

---

**Bottom line:** We have a real product buried under fixable bugs. Search is the unlock. Everything else follows.