# Data Inconsistency Analysis and Fix Plan

**Date**: 2026-02-01
**Total Inconsistencies Found**: 265 records (181 + 84)

---

## Executive Summary

Two classes of logical contradictions were identified in the vehicles table:

1. **Class A**: 181 vehicles with `auction_outcome = 'sold'` but `reserve_status = 'reserve_not_met'`
2. **Class B**: 84 vehicles with `auction_outcome = 'reserve_not_met'` but `reserve_status = 'no_reserve'`

Both represent impossible states based on business logic. The analysis below provides evidence-based fixes for each group.

---

## Class A Analysis: `sold` + `reserve_not_met` (181 records)

### The Problem
These records indicate a vehicle was sold, yet the reserve was not met. This is logically impossible:
- If a vehicle was **sold**, the winning bid must have met or exceeded the reserve price
- Therefore, `reserve_status` should be either `'reserve_met'` or `'no_reserve'`

### Data Characteristics
```
Total Records: 181
- With sale_price: 1 (0.6%)
- Without sale_price: 180 (99.4%)
- With high_bid: 57 (31.5%)

Average sale_price (when present): $220,000
```

### Pattern Analysis

**Key Finding**: Normal sold vehicles nearly always have sale_price recorded:
- `sold + reserve_met`: 11,123 records, 100% have sale_price
- `sold + no_reserve`: 27,063 records, 99.9% have sale_price

The contradictory records have almost no sale_price data, suggesting **data quality issues in the extraction or import process rather than logical business state errors**.

### Root Cause Assessment

The most likely explanation is that these vehicles actually sold (as indicated by `auction_outcome = 'sold'`), but:
1. The `sale_price` data failed to populate (data import/ETL failure)
2. The `reserve_status` was incorrectly defaulted to `'reserve_not_met'` instead of being inferred from the sale outcome
3. Since they sold, the reserve must have been met (or there was no reserve)

### Proposed Fix

**For all 181 records**: Set `reserve_status = 'reserve_met'`

**Rationale**:
- The source of truth is `auction_outcome = 'sold'` (likely from official auction records)
- Vehicles that sold must have met the reserve (or had no reserve)
- Setting to `'reserve_met'` is safer than assuming `'no_reserve'` without additional data
- This aligns with the 11,123 normal `sold + reserve_met` cases

**Update Statement**:
```sql
UPDATE vehicles
SET reserve_status = 'reserve_met'
WHERE auction_outcome = 'sold'
  AND reserve_status = 'reserve_not_met';

-- Affects: 181 records
-- Verification query post-update:
-- SELECT COUNT(*) FROM vehicles WHERE auction_outcome = 'sold' AND reserve_status = 'reserve_not_met';
-- Expected result: 0 rows
```

---

## Class B Analysis: `reserve_not_met` + `no_reserve` (84 records)

### The Problem
These records indicate:
- `auction_outcome = 'reserve_not_met'` → The reserve price was not met
- `reserve_status = 'no_reserve'` → There was no reserve

This is a contradiction: you cannot fail to meet a reserve if there was no reserve.

### Data Characteristics
```
Total Records: 84
- With sale_price: 77 (91.7%)
- Without sale_price: 7 (8.3%)
- With high_bid: 25 (29.8%)

Average sale_price (when present): $46,971
Average high_bid (when present): $51,033
```

### Subgroup Analysis

**Subgroup 1: reserve_not_met + no_reserve + HAS sale_price (77 records)**
- Average sale_price: $46,971
- Average high_bid: $51,033
- These vehicles have prices recorded, suggesting they actually sold

**Subgroup 2: reserve_not_met + no_reserve + NO sale_price (7 records)**
- No sale_price data
- Very low average high_bid: $131
- Likely legitimately failed (reserve_not_met) but with wrong reserve_status

### Pattern Analysis

Normal baseline data:
- `reserve_not_met + reserve_not_met`: 7,259 records, 0% have sale_price (correct - no sale if reserve not met)
- Records with reserve_not_met normally have NO sale_price

**Key Finding**: 91.7% of these records HAVE sale_price, which contradicts the normal pattern for reserve_not_met auctions.

### Root Cause Assessment

Two distinct failure modes:

**For Subgroup 1 (77 records with sale_price)**:
- These vehicles likely sold (they have sale_price)
- The true state should be: `auction_outcome = 'sold'`
- The `reserve_status = 'no_reserve'` is probably correct
- The `auction_outcome` was incorrectly set to `'reserve_not_met'`

**For Subgroup 2 (7 records without sale_price)**:
- These auctions legitimately failed to meet reserve (reserve_not_met)
- The `reserve_status = 'no_reserve'` is incorrect
- Should be: `reserve_status = 'reserve_not_met'` to match the auction_outcome

### Proposed Fixes

**Fix 2A: For 77 records with sale_price**
```sql
UPDATE vehicles
SET auction_outcome = 'sold'
WHERE auction_outcome = 'reserve_not_met'
  AND reserve_status = 'no_reserve'
  AND sale_price IS NOT NULL;

-- Affects: 77 records
-- Verification query post-update:
-- SELECT COUNT(*) FROM vehicles WHERE auction_outcome = 'reserve_not_met' AND reserve_status = 'no_reserve' AND sale_price IS NOT NULL;
-- Expected result: 0 rows
```

**Fix 2B: For 7 records without sale_price**
```sql
UPDATE vehicles
SET reserve_status = 'reserve_not_met'
WHERE auction_outcome = 'reserve_not_met'
  AND reserve_status = 'no_reserve'
  AND sale_price IS NULL;

-- Affects: 7 records
-- Verification query post-update:
-- SELECT COUNT(*) FROM vehicles WHERE auction_outcome = 'reserve_not_met' AND reserve_status = 'no_reserve' AND sale_price IS NULL;
-- Expected result: 0 rows
```

---

## Implementation Plan

### Phase 1: Validation (BEFORE EXECUTION)
Run these verification queries:
```sql
-- Verify count of each inconsistency
SELECT COUNT(*) FROM vehicles WHERE auction_outcome = 'sold' AND reserve_status = 'reserve_not_met';
-- Expected: 181

SELECT COUNT(*) FROM vehicles WHERE auction_outcome = 'reserve_not_met' AND reserve_status = 'no_reserve';
-- Expected: 84

SELECT COUNT(*) FROM vehicles WHERE auction_outcome = 'reserve_not_met' AND reserve_status = 'no_reserve' AND sale_price IS NOT NULL;
-- Expected: 77

SELECT COUNT(*) FROM vehicles WHERE auction_outcome = 'reserve_not_met' AND reserve_status = 'no_reserve' AND sale_price IS NULL;
-- Expected: 7
```

### Phase 2: Execute Fixes
Execute in order:
1. Fix for Class A (181 records)
2. Fix 2A for Class B Subgroup 1 (77 records)
3. Fix 2B for Class B Subgroup 2 (7 records)

### Phase 3: Post-Execution Verification
Run these checks to confirm all fixes applied successfully:
```sql
-- Verify no Class A inconsistencies remain
SELECT COUNT(*) FROM vehicles WHERE auction_outcome = 'sold' AND reserve_status = 'reserve_not_met';
-- Expected: 0

-- Verify no Class B inconsistencies remain
SELECT COUNT(*) FROM vehicles WHERE auction_outcome = 'reserve_not_met' AND reserve_status = 'no_reserve';
-- Expected: 0

-- Spot check: verify the sold records now have proper reserve_status
SELECT COUNT(DISTINCT reserve_status) FROM vehicles WHERE auction_outcome = 'sold';
-- Expected: 2 (reserve_met and no_reserve)

-- Verify no reserve_not_met records have sale_price anymore
SELECT COUNT(*) FROM vehicles WHERE auction_outcome = 'reserve_not_met' AND sale_price IS NOT NULL;
-- Expected: 0
```

---

## Risk Assessment

### Low Risk
- All fixes follow logical business rules
- Changes are minimal and isolated to specific field values
- Supported by clear data patterns and evidence
- Can be easily rolled back if needed

### No Data Loss
- Only updating state fields, not deleting records
- All changes are additive to data quality
- Sale_price and other key fields remain unchanged

### Confidence Levels
- **Class A Fix (181 records)**: HIGH - Clear that sold vehicles should have reserve met
- **Class B Fix 2A (77 records)**: HIGH - Sale_price presence is strong evidence of completed sale
- **Class B Fix 2B (7 records)**: HIGH - Lack of sale_price combined with reserve_not_met outcome supports fix

---

## Summary of Changes

| Issue | Records | Fix | Confidence |
|-------|---------|-----|-----------|
| `sold + reserve_not_met` | 181 | Set `reserve_status = 'reserve_met'` | HIGH |
| `reserve_not_met + no_reserve + has_sale_price` | 77 | Set `auction_outcome = 'sold'` | HIGH |
| `reserve_not_met + no_reserve + no_sale_price` | 7 | Set `reserve_status = 'reserve_not_met'` | HIGH |
| **TOTAL** | **265** | | |

**Expected Outcome**: All 265 records will transition from logically impossible states to consistent, verifiable states based on available data evidence.
