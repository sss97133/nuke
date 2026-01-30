# Extraction Comparison System - Work Summary
## Date: 2026-01-29

### What Was Built

1. **Hybrid Extractor** (`scripts/hybrid-extractor.ts`)
   - Smart extraction that tries naive fetch first, falls back to Playwright
   - Quality threshold: 50 points (naive must hit this to avoid Playwright)
   - Saves 40-70 seconds per batch vs running Playwright on everything

2. **Parallel Comparison Tool** (`scripts/parallel-free-vs-paid-extractor.ts`)
   - Runs naive and Playwright extractions in parallel
   - Generates investor-ready metrics
   - Saves results to Supabase database

3. **CSV Export** (`scripts/export-comparison-csv.ts`)
   - summary.csv - Per-URL comparison data
   - methods.csv - All extraction attempts
   - investor-deck.csv - Aggregate stats for deck
   - domain-breakdown.csv - Per-domain recommendations

### Key Fixes Made

1. **Bot Detection** - Fixed overly aggressive detection that was blocking BaT
   - Now requires BOTH short content (<2000 chars) AND block signals

2. **Make/Model Extraction** - Improved to prioritize title/structured data
   - Before: Datsun 240Z showed as "Porsche cayenne-diesel-156"
   - After: Correctly shows "Datsun 240Z Series I"

3. **Image Extraction** - Fixed regex that was blocking legitimate images
   - "ad" pattern was matching inside "uploads"
   - Now uses word-boundary patterns

### Investor Metrics (from 30 URLs tested)

| Metric | Value |
|--------|-------|
| Naive Success Rate | 50% |
| Playwright Success Rate | 97% |
| Quality Improvement | +25 points |
| URLs only Playwright succeeded | 14 (47%) |
| URLs Playwright 20+ points better | 16 (53%) |
| Easy sites (naive works) | 8 |
| Medium sites (need PW) | 7 |
| Hard sites (neither great) | 15 |

### Domain Intelligence

| Recommendation | Domains |
|----------------|---------|
| NAIVE_OK | bringatrailer.com, dupontregistry.com, autotrader.com |
| PLAYWRIGHT_REQUIRED | collectingcars.com, hemmings.com, carsandbids.com, hagerty.com, rmsothebys.com, bonhams.com |
| PLAYWRIGHT_RECOMMENDED | pcarmarket.com, mecum.com, ebay.com |

### Database

- Table: `extraction_comparisons`
- Total records: 54
- Columns: url, domain, free_quality, paid_quality, difficulty, full_result (JSONB)

### Files Changed

- `scripts/hybrid-extractor.ts` - New file, hybrid extraction strategy
- `scripts/urls-for-extraction.txt` - Cleaned up (removed login-required URLs)
- Data in `extraction-comparison-results/` directory

### How to Use

```bash
# Run hybrid extractor on single URL
npx tsx scripts/hybrid-extractor.ts <url>

# Run batch comparison
npx tsx scripts/parallel-free-vs-paid-extractor.ts --batch scripts/urls-for-extraction.txt

# Export CSV for investor deck
npx tsx scripts/export-comparison-csv.ts
```
