# BaT Data Quality - Quick Summary

## The Problem

**"We should have very good data from BaT, it shouldn't be this hard to access it."**

You're right. The data is there, but the extraction pipeline has gaps.

## Key Findings

### ✅ What's Working (80%+ coverage)
- **Images:** 90% of vehicles have images
- **Auction Events:** 86% of vehicles have `auction_events`
- **VINs:** 75% of vehicles have VINs
- **30,617 comments** stored in `auction_comments`

### ❌ What's Broken
- **Only 52% of vehicles have comments** despite 86% having `auction_events`
- **Two comment systems** (`auction_comments` and `bat_comments`) causing confusion
- **`bat-simple-extract` only gets ~50 comments** (limited by JSON in initial page load)
- **500+ vehicles** have `auction_events` but comments were never extracted

## The Root Cause

You have **two extraction functions**:

1. **`bat-simple-extract`** - Quick but incomplete (only ~50 comments from JSON)
2. **`extract-auction-comments`** - Scalable DOM parser (gets ALL comments) but requires `auction_event_id`

**The problem:** Many vehicles were imported with `bat-simple-extract`, which created `auction_events` but only extracted ~50 comments. The scalable `extract-auction-comments` function was never called.

## The Solution

### For the 500+ vehicles missing comments:

1. **They already have `auction_events`** ✅
2. **Just need to call `extract-auction-comments`** for each one
3. **This will extract ALL comments** via DOM parsing

### Pipeline Fix:

**New imports should:**
1. Create `auction_event` (if not exists)
2. Call `extract-auction-comments` (not `bat-simple-extract` for comments)

**Existing vehicles:**
1. Find vehicles with `auction_events` but no comments
2. Call `extract-auction-comments` for each
3. This will backfill all missing comments

## Data Quality Numbers

| Metric | Count | % |
|--------|-------|---|
| Total BaT Vehicles | 1,446 | 100% |
| With VIN | 1,086 | 75% |
| With Auction Events | 1,248 | 86% |
| **With Comments** | **748** | **52%** ⚠️ |
| With Images | 1,302 | 90% |

## Recommendation

**Don't get rid of `bat-simple-extract`** - it's useful for quick vehicle data (VIN, specs, images).

**But for comments, always use `extract-auction-comments`** - it's the scalable solution.

**The fix:** Create a script that:
1. Finds all vehicles with `auction_events` but no comments
2. Calls `extract-auction-comments` for each
3. This should bring comment coverage from 52% → 80%+

## Next Steps

1. ✅ Assessment complete (this document)
2. ⏳ Create backfill script for missing comments
3. ⏳ Update extraction pipeline to always use `extract-auction-comments` for comments
4. ⏳ Consider consolidating `bat_comments` → `auction_comments` (only 30 vehicles affected)

See `BAT_DATA_QUALITY_ASSESSMENT.md` for full details.

