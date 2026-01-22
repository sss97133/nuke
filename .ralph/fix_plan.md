# Ralph Wiggum Fix Plan

## Current Mission: Extraction Accuracy & Backfill

Started: 2026-01-22
Target: 5+ hours autonomous work

---

## PHASE 1: BASELINE METRICS (Loops 1-5)

- [x] **1.1** Run extraction accuracy query, save results to progress.md
- [ ] **1.2** Run image coverage query, identify sources with <2 avg images
- [ ] **1.3** Run activity query, identify stale sources (no updates in 7d)
- [ ] **1.4** Sample 5 BaT vehicles - compare DB fields vs source URL content
- [ ] **1.5** Sample 5 Craigslist vehicles - compare DB fields vs source URL content

---

## PHASE 2: DIAGNOSE EXTRACTION GAPS (Loops 6-15)

- [ ] **2.1** Read `extract-bat-core/index.ts` - document what fields it extracts
- [ ] **2.2** Read `extract-cars-and-bids-core/index.ts` - document extraction patterns
- [ ] **2.3** Check C&B lazy-loading status - is it still broken?
- [ ] **2.4** Read `process-import-queue/index.ts` - understand routing logic
- [ ] **2.5** Identify which extractor handles Craigslist URLs
- [ ] **2.6** Identify which extractor handles Mecum URLs
- [ ] **2.7** List fields BaT extractor SHOULD get but DOESN'T
- [ ] **2.8** List fields C&B extractor SHOULD get but DOESN'T
- [ ] **2.9** List fields Craigslist extractor SHOULD get but DOESN'T
- [ ] **2.10** Document extraction gaps in `docs/EXTRACTION_GAPS.md`

---

## PHASE 3: FIX HIGHEST-IMPACT GAPS (Loops 16-30)

- [ ] **3.1** BaT: Fix VIN extraction if missing (check __NEXT_DATA__ parsing)
- [ ] **3.2** BaT: Fix mileage extraction if missing
- [ ] **3.3** BaT: Ensure all gallery images are captured (not just first)
- [ ] **3.4** C&B: Fix lazy-loading image extraction (use Playwright or Firecrawl)
- [ ] **3.5** C&B: Extract VIN from __NEXT_DATA__ JSON
- [ ] **3.6** Craigslist: Ensure location is extracted
- [ ] **3.7** Craigslist: Ensure all images are captured
- [ ] **3.8** Deploy updated extractors: `supabase functions deploy [name]`
- [ ] **3.9** Test extraction on 3 sample URLs per source
- [ ] **3.10** Validate improvements with accuracy query

---

## PHASE 4: BACKFILL STRATEGY (Loops 31-45)

- [ ] **4.1** Count vehicles per source missing VIN
- [ ] **4.2** Count vehicles per source missing mileage
- [ ] **4.3** Count vehicles per source with 0 images
- [ ] **4.4** Create backfill script: `scripts/backfill-missing-fields.ts`
- [ ] **4.5** Backfill: Re-extract 100 BaT vehicles missing VIN
- [ ] **4.6** Validate backfill success rate
- [ ] **4.7** Backfill: Re-extract 100 BaT vehicles missing images
- [ ] **4.8** Backfill: Re-extract 100 C&B vehicles missing images
- [ ] **4.9** Backfill: Re-extract 100 Craigslist vehicles missing location
- [ ] **4.10** Update backfill metrics in progress.md

---

## PHASE 5: UNKNOWN SOURCE CLASSIFICATION (Loops 46-55)

- [ ] **5.1** Query 100 "Unknown Source" vehicles, inspect discovery_urls
- [ ] **5.2** Identify URL patterns that should map to known sources
- [ ] **5.3** Create classification rules for unrecognized URLs
- [ ] **5.4** Update `auto_set_auction_source()` trigger with new patterns
- [ ] **5.5** Re-classify "Unknown Source" vehicles
- [ ] **5.6** Validate classification accuracy
- [ ] **5.7** Document new sources discovered

---

## PHASE 6: LIVING PROFILE INFRASTRUCTURE (Loops 56-65)

- [ ] **6.1** Check if re-extraction trigger exists for sold auctions
- [ ] **6.2** Check if price update sync is working (external_listings → vehicles)
- [ ] **6.3** Verify BaT sold auctions update vehicles.sale_price
- [ ] **6.4** Create/fix trigger for continuous price updates
- [ ] **6.5** Test with a sample sold auction
- [ ] **6.6** Document update frequency per source

---

## PHASE 7: METRICS DASHBOARD (Loops 66-75)

- [ ] **7.1** Create view: `extraction_accuracy_by_source`
- [ ] **7.2** Create view: `image_coverage_by_source`
- [ ] **7.3** Create view: `profile_activity_by_source`
- [ ] **7.4** Create view: `backfill_candidates` (vehicles needing re-extraction)
- [ ] **7.5** Test all views return correct data
- [ ] **7.6** Document views in `docs/EXTRACTION_METRICS.md`

---

## DISCOVERED TASKS (add as you find them)

### CRITICAL: Migration Not Applied (Found Loop 1)
The `20260122_normalize_auction_source.sql` migration EXISTS but was NEVER APPLIED:
- Trigger `trigger_auto_set_auction_source` doesn't exist in DB
- 3,888 vehicles stuck as "Unknown Source" with known URLs
- Migration only covers ~15 sources, but there are 67+ unique domains

**Immediate Actions:**
- [x] **D.1** Apply the normalization migration to create trigger
- [x] **D.2** Extend migration with Beverly Hills Car Club pattern (2,012 vehicles)
- [x] **D.3** Extend migration with L'Art de l'Automobile pattern (995 vehicles)
- [x] **D.4** Extend migration with Barrett-Jackson pattern (52 vehicles)
- [x] **D.5** Extend migration with Classic.com pattern (56 vehicles)
- [x] **D.6** Extend migration with KSL Cars pattern (36 vehicles)
- [x] **D.7** Extend migration with CollectiveAuto pattern (219 vehicles)
- [x] **D.8** Re-run UPDATE statements to reclassify existing "Unknown Source"
- [x] **D.9** Verify Unknown Source count dropped: 3,888 → 196 (95% reduction!)

**Top Unknown Source domains to add:**
```
beverlyhillscarclub.com     - 2,012 vehicles
lartdelautomobile.com       -   995 vehicles
collectiveauto.com          -   219 vehicles
classic.com                 -    56 vehicles
barrett-jackson.com         -    52 vehicles
cars.ksl.com                -    36 vehicles
tbtfw.com                   -    36 vehicles
fantasyjunction.com         -    21 vehicles
classiccars.com             -    15 vehicles
```

---

## BLOCKED TASKS (move here if stuck)

- [ ] ...

---

## COMPLETED TASKS (move here when done)

- [x] Setup: Created PROMPT.md with full context
- [x] Setup: Created fix_plan.md with task breakdown

---

## NOTES

- Each checkbox = 1 loop iteration
- If a task takes multiple loops, break it down further
- If blocked, document in progress.md and move on
- Target: 75 loops = ~5 hours at 4 min/loop
