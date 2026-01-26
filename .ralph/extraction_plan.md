# Extraction Factory Plan

Started: 2026-01-25
Mission: Extract vehicles at scale. Quality is good enough - START EXTRACTING.

**KEY PRINCIPLE:** Ship it. Run extractions, check results, fix issues as they appear.
**DO NOT** spend loops validating - spend loops EXTRACTING.

---

## ⚡ IMMEDIATE PRIORITY - STATUS 2026-01-25 9:10PM

### Mecum - RUNNING ✅
- [x] **0.2** Title parsing fixed ✓
- [x] **1.3** Images storing correctly (21.7 avg) ✓
- [x] **1.4** ✅ **RUNNING**: Multiple processes active (500+500+100 batches)
- **PROGRESS**: 257+ vehicles updated in last 10 minutes
- **PENDING**: 4,433 remaining

### PCarMarket - NEARLY COMPLETE ✅
- [x] **0.1** Image storage fixed ✓
- [x] **1.7** Images verified (35.7 avg) ✓
- [x] **1.8** ✅ Mostly processed
- **PENDING**: 11 remaining

### BaT Backfill - RUNNING ✅ (via bat-simple-extract)
- [x] **1.9** ✅ **RUNNING**: Direct extraction via edge function (no Firecrawl needed)
- **PROGRESS**: 24 vehicles extracted in last 10 minutes
- **PENDING**: 360 remaining

### Hagerty - RUNNING ✅
- **PROGRESS**: 38 vehicles updated in last 10 minutes
- **PENDING**: 40 remaining

---

## PHASE 1 CHECKLIST (after immediate runs)

- [ ] **1.10** Check Mecum results: `SELECT COUNT(*) FROM vehicles WHERE profile_origin='mecum' AND created_at > NOW() - INTERVAL '1 hour'`
- [ ] **1.11** Check PCarMarket results
- [ ] **1.12** If issues found, investigate and fix
- [ ] **1.13** Run another batch of 500 Mecum
- [ ] **1.14** Run another batch of 100 PCarMarket

---

## PHASE 2: DISCOVERY EXPANSION

### Mecum Discovery - PRIORITY
Current: 8,783 vehicles | Need: More auctions to scrape
- [ ] **2.1** Run discovery: `dotenvx run -- node scripts/mecum-fast-discover.js 100 3`
- [ ] **2.2** Add older auctions (2022, 2021, 2020) to discovery script
- [ ] **2.3** Add more locations (portland, denver, tulsa, etc.)
- [ ] **2.4** Target: 50,000+ Mecum vehicles in DB

### Cars & Bids (15,620 pending - CF blocked)
- [ ] **2.5** Try Playwright: `npx playwright test scripts/cab-playwright-extract.ts`
- [ ] **2.6** If blocked, try Firecrawl
- [ ] **2.7** Document if unsolvable

### New Sites (lower priority)
- [ ] Kindred Motorworks - extractor exists, test it
- [ ] Streetside Classics - extractor exists, test it
- [ ] Vanguard Motor Sales - extractor exists, test it

---

## SUCCESS METRICS

**Target:** 1000+ new vehicles per day flowing into DB

Check with:
```sql
SELECT profile_origin, COUNT(*)
FROM vehicles
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY profile_origin;
```

---

## BLOCKERS

- **Cars & Bids**: Cloudflare (15,620 stuck)
- **Hemmings**: Cloudflare (30 stuck)
- **Firecrawl**: Out of credits - BaT wayback extraction blocked

---

## NOTES FOR RALPH

1. **Don't validate endlessly** - extractors are ready, run them
2. **One loop = one extraction batch** - not one validation check
3. **Check results AFTER running** - not before
4. **If something fails, note it and move on** - don't get stuck investigating
5. **Goal is vehicles in DB** - not perfect code
