# BaT Function Retirement Plan

> **Goal**: Retire all old/broken BaT extractors and migrate to the proven two-function system  
> **Date Created**: 2026-01-07  
> **Status**: Planning Phase

## Status note (2026-01-10)

Some statements in this document were written before newer routing/worker updates landed. Treat any references to routing BaT through `import-bat-listing` or `comprehensive-bat-extraction` as legacy; the canonical workflow is documented in:

- `docs/BAT_EXTRACTION_SUCCESS_WORKFLOW.md`
- `docs/ops/EDGE_FUNCTION_GOVERNANCE.md`
- `docs/EXTRACTION_TOOLKIT_INDEX.md`

---

## Functions to Retire

### ❌ High Priority (Broken/Incomplete)

| Function | Status | Why Retire | Replacement |
|----------|--------|------------|-------------|
| `bat-extract-complete-v2` | ❌ RETIRE | Missing VIN/specs extraction | Use `extract-premium-auction` + `extract-auction-comments` |
| `bat-extract-complete-v3` | ❌ RETIRE | Untested, incomplete | Use `extract-premium-auction` + `extract-auction-comments` |
| `comprehensive-bat-extraction` | ❌ RETIRE | Uses Firecrawl mapper, doesn't extract VIN/specs | Use `extract-premium-auction` + `extract-auction-comments` |
| `bat-simple-extract` | ❌ RETIRE | Incomplete, doesn't call comments extractor | Use `extract-premium-auction` + `extract-auction-comments` |
| `import-bat-listing` | ❌ RETIRE | Old system, uses deprecated approach | Use `extract-premium-auction` + `extract-auction-comments` |

### ⚠️ Medium Priority (May Still Be Used)

| Function | Status | Action | Notes |
|----------|--------|---------|-------|
| `process-bat-extraction-queue` | ⚠️ REVIEW | Verify completion criteria | Current code calls `extract-premium-auction` + `extract-auction-comments` |
| `bat-reextract` | ⚠️ REVIEW | Check if still needed | May be used for repair workflows |
| `bat-batch-extract` | ⚠️ REVIEW | Check if still needed | May be used for batch operations |

---

## Current Callers (What Needs Migration)

### Functions Calling Old Extractors

1. **`process-bat-extraction-queue`**
   - **Calls**: `comprehensive-bat-extraction`
   - **Location**: `supabase/functions/process-bat-extraction-queue/index.ts`
   - **Action**: Update to call `extract-premium-auction` + `extract-auction-comments`
   - **Priority**: HIGH (actively used)

2. **`smart-extraction-router`**
   - **Calls**: May route to old extractors
   - **Location**: `supabase/functions/smart-extraction-router/index.ts`
   - **Action**: Update routing logic to use new functions for BaT
   - **Priority**: MEDIUM

3. **`go-grinder`**
   - **Calls**: May call old extractors
   - **Location**: `supabase/functions/go-grinder/index.ts`
   - **Action**: Review and update if needed
   - **Priority**: LOW

### Scripts Calling Old Functions

Found **42 scripts** that may reference old functions. Key ones to update:

1. **`scripts/import-bat-listing.sh`**
   - **Action**: Update to use new functions or mark as deprecated
   - **Priority**: HIGH

2. **`scripts/import-all-bat-complete.js`**
   - **Action**: Update to use new functions
   - **Priority**: MEDIUM

3. **`scripts/re-extract-all-bat-data.js`**
   - **Action**: Update to use new functions
   - **Priority**: MEDIUM

4. **`scripts/comprehensive-re-extraction-pipeline.js`**
   - **Action**: Update to use new functions
   - **Priority**: MEDIUM

---

## Migration Steps

### Phase 1: Update Active Callers (Week 1)

1. **Update `process-bat-extraction-queue`**
   ```typescript
   // OLD:
   await supabase.functions.invoke('comprehensive-bat-extraction', {...});
   
   // NEW:
   // Step 1: extract-premium-auction
   const { data: coreResult } = await supabase.functions.invoke('extract-premium-auction', {
     body: { url: batUrl, max_vehicles: 1 }
   });
   
   // Step 2: extract-auction-comments
   if (coreResult?.created_vehicle_ids?.[0] || coreResult?.updated_vehicle_ids?.[0]) {
     const vehicleId = coreResult.created_vehicle_ids[0] || coreResult.updated_vehicle_ids[0];
     await supabase.functions.invoke('extract-auction-comments', {
       body: { auction_url: batUrl, vehicle_id: vehicleId }
     });
   }
   ```

2. **Update `smart-extraction-router`**
   - Add BaT detection logic
   - Route BaT URLs to `bat-extract-complete-v1` (or two-step if orchestrator not ready)

3. **Test thoroughly** on known-good listings

### Phase 2: Mark Functions as Deprecated (Week 2)

1. **Update `extractor_registry` table**
   ```sql
   UPDATE extractor_registry
   SET status = 'deprecated',
       notes = 'Replaced by extract-premium-auction + extract-auction-comments'
   WHERE name IN ('bat-extract-complete-v2', 'bat-extract-complete-v3', 'comprehensive-bat-extraction', 'bat-simple-extract');
   ```

2. **Add deprecation warnings** to function code
   ```typescript
   console.warn('[DEPRECATED] This function is deprecated. Use extract-premium-auction + extract-auction-comments instead.');
   ```

3. **Update documentation** to mark as deprecated

### Phase 3: Update Scripts (Week 3)

1. **Review all 42 scripts** that reference old functions
2. **Update critical scripts** (import, re-extract, batch operations)
3. **Mark others as deprecated** or delete if unused

### Phase 4: Remove Functions (Week 4+)

1. **Wait 30 days** after deprecation to ensure no active usage
2. **Check `extraction_attempts` table** for any recent calls
3. **Delete function code** (or move to `_deprecated/` folder)
4. **Update documentation**

---

## Verification Checklist

Before retiring a function:

- [ ] No recent calls in `extraction_attempts` table (last 30 days)
- [ ] All callers updated to use new functions
- [ ] Marked as deprecated in `extractor_registry`
- [ ] Documentation updated
- [ ] Tested replacement functions work correctly
- [ ] No critical scripts still using it

---

## Rollback Plan

If something breaks:

1. **Revert function status** in `extractor_registry` to `active`
2. **Revert caller changes** to use old function
3. **Document the issue** and fix before retrying retirement

---

## Timeline

| Phase | Duration | Status |
|-------|----------|--------|
| Phase 1: Update Active Callers | 1 week | ⏳ PENDING |
| Phase 2: Mark as Deprecated | 1 week | ⏳ PENDING |
| Phase 3: Update Scripts | 1 week | ⏳ PENDING |
| Phase 4: Remove Functions | After 30 days | ⏳ PENDING |

**Total Estimated Time**: 3-4 weeks + 30 day waiting period

---

## Notes

- **Don't delete functions immediately** - mark as deprecated first
- **Keep function code** in `_deprecated/` folder for reference
- **Monitor `extraction_attempts`** to ensure no one is still using old functions
- **Update this document** as migration progresses

---

**Last Updated**: 2026-01-07  
**Next Review**: After Phase 1 completion

