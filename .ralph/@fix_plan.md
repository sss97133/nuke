# Fix Plan - C&B Extraction

## Steps (do ONE per loop)

- [ ] **Step 1**: Read process-import-queue/index.ts, find extraction logic, write findings to @progress.md
- [ ] **Step 2**: Add `extractCarsAndBidsData()` function to the file
- [ ] **Step 3**: Add C&B URL detection, use Firecrawl + the new function
- [ ] **Step 4**: Deploy with `supabase functions deploy process-import-queue --no-verify-jwt`
- [ ] **Step 5**: Validate with `npx tsx scripts/ralph-status-check.ts` - C&B should show VIN=✓

## Success Criteria

```
🚨 CARS & BIDS EXTRACTION CHECK:
   Vehicle Name: VIN=✓ Miles=✓
```

## Current Status

Waiting for Step 1...
