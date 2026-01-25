# Extraction Factory Plan

Started: 2026-01-25
Mission: Build **QUALITY-FIRST** extractors matching BaT standard, then run to 100% completion

**KEY PRINCIPLE:** Never run incomplete extractors at scale. Fix quality FIRST.

---

## PHASE 0: QUALITY FIXES (MUST COMPLETE FIRST)

### P0 Blockers
- [x] **0.1** Fix PCarMarket: Add vehicle_images storage (FIXED - images now stored)
- [x] **0.2** Add title parsing (year/make/model) to mecum-proper-extract.js (DONE - verified with test batch)
- [x] **0.3** Add title parsing to pcarmarket-proper-extract.js (DONE - verified with test batch)
- [x] **0.4** Validate fixes with 5-vehicle test batch each (VERIFIED: both extractors working, images stored, year/make/model parsed)

### Quality Validation
- [x] **0.5** Create EXTRACTOR_QUALITY_COMPARISON.md (done)
- [x] **0.6** Analyze mecum extractor vs BaT (75% score - needs title parsing)
- [x] **0.7** Analyze pcarmarket extractor vs BaT (70% score - needs image fix + title)

---

## PHASE 1: CURRENT SOURCE COMPLETION (After Quality Fixes)

### Mecum (~3,700 pending)
- [x] **1.1** Test batch of 100 - VIN dedup working
- [x] **1.2** Validate VIN deduplication working - VERIFIED
- [x] **1.3** Check vehicle_images population (target: 15+ per vehicle) - VERIFIED: avg 21.7 img/vehicle (46 vehicles have images)
- [ ] **1.4** Run batch of 500 (ONLY after 0.2 complete)
- [ ] **1.5** Final quality validation vs BaT baseline

### PCarMarket (~180 pending)
- [x] **1.6** Fix vehicle_images storage FIRST (task 0.1) - DONE in Phase 0
- [x] **1.7** Validate image extraction (should get 18-20 per vehicle) - VERIFIED: avg 35.7 img/vehicle (28 vehicles)
- [ ] **1.8** Run batch of 100 (ONLY after fixes)

### BaT (~400 pending)
- [ ] **1.9** Check bat-wayback-batch-extract.js status
- [ ] **1.10** Run if Firecrawl budget allows
- [ ] **1.11** Validate against BaT gold standard (it IS the standard)

### Cars & Bids (15,620 pending - CF blocked)
- [ ] **1.12** Investigate Cloudflare bypass with Playwright
- [ ] **1.13** Test with Firecrawl as fallback
- [ ] **1.14** Document blocker if unsolvable

---

## PHASE 2: NEW EXTRACTOR FACTORY

### Kindred Motorworks
- [x] **2.1** Inspect site structure
- [x] **2.2** Generate extractor
- [ ] **2.3** Test extractor (5 vehicles)
- [ ] **2.4** Validate quality vs BaT
- [ ] **2.5** Full extraction run

### Streetside Classics
- [x] **2.6** Inspect site structure
- [x] **2.7** Generate extractor
- [ ] **2.8** Test extractor
- [ ] **2.9** Validate quality
- [ ] **2.10** Full extraction run

### Vanguard Motor Sales
- [x] **2.11** Inspect site structure
- [x] **2.12** Generate extractor
- [ ] **2.13** Test extractor
- [ ] **2.14** Validate quality
- [ ] **2.15** Full extraction run

### Gateway Classic Cars
- [ ] **2.16** Inspect site
- [ ] **2.17** Generate extractor
- [ ] **2.18** Test and validate
- [ ] **2.19** Full extraction

### European Collectibles
- [ ] **2.20** Inspect site
- [ ] **2.21** Generate extractor
- [ ] **2.22** Test and validate
- [ ] **2.23** Full extraction

### Otto Car
- [ ] **2.24** Inspect site
- [ ] **2.25** Generate extractor
- [ ] **2.26** Test and validate

### Avant Garde Collection
- [ ] **2.27** Inspect site
- [ ] **2.28** Generate extractor
- [ ] **2.29** Test and validate

---

## PHASE 3: AUCTION HOUSE EXTRACTORS

### RM Sotheby's
- [ ] **3.1** Inspect site (complex - multiple auctions)
- [ ] **3.2** Analyze API patterns
- [ ] **3.3** Generate extractor
- [ ] **3.4** Test with recent auction

### Barrett-Jackson
- [ ] **3.5** Inspect site
- [ ] **3.6** Generate extractor
- [ ] **3.7** Test

### Bonhams
- [ ] **3.8** Inspect site
- [ ] **3.9** Generate extractor

### Gooding & Co
- [ ] **3.10** Inspect site
- [ ] **3.11** Generate extractor

---

## PHASE 4: QUALITY ASSURANCE

- [ ] **4.1** Run extraction quality report for all sources
- [ ] **4.2** Identify sources below BaT baseline
- [ ] **4.3** Investigate and fix gaps
- [ ] **4.4** Re-run failed sources
- [ ] **4.5** Final validation: all sources at 90%+ vs BaT

---

## DISCOVERED TASKS

(Add tasks here as you discover them during extraction)

---

## BLOCKERS

- **Cars & Bids**: Cloudflare blocking (15,620 vehicles stuck)
- **Hemmings**: Cloudflare blocking (30 vehicles stuck)

---

## METRICS SNAPSHOT

Last updated: 2026-01-25 14:00 UTC

| Source | Pending | Active | Quality Score |
|--------|---------|--------|---------------|
| Mecum | 3,764 | 5,019 | TBD |
| Hagerty | 0 | ~500 | TBD |
| PCarMarket | 192 | ~300 | TBD |
| BaT | 410 | 24,831 | BASELINE |
| C&B | 15,620 | 4,736 | BLOCKED |
