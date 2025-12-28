# Post-Cleanup Checklist

**Date**: 2025-12-27  
**Status**: ✅ 60 functions deleted | ⏳ Verification in progress

## ✅ Completed

1. ✅ Deleted 60 unused edge functions
2. ✅ Created deletion log
3. ✅ Updated test scripts (removed deleted function references)

## ⏳ Next Steps

### 1. Verify System Health
```bash
# Run health check on remaining functions
node scripts/test-all-edge-functions-health.js

# Test Tier 1 functions with real data
node scripts/test-tier1-functions-real-data.js
```

### 2. Update Documentation
- [ ] Update `EDGE_FUNCTION_CONTRACTS.md` if any deleted functions were documented
- [ ] Archive old docs that reference deleted functions (move to `docs/archive/`)
- [ ] Update README if it lists edge functions

### 3. Check Database/Cron Jobs
```sql
-- Check for any cron jobs calling deleted functions
SELECT * FROM cron.job WHERE command LIKE '%test-gemini%' OR command LIKE '%scrape-lmc%';

-- Check for any database triggers calling deleted functions
SELECT * FROM pg_trigger WHERE tgname LIKE '%test%' OR tgname LIKE '%lmc%';
```

### 4. Monitor Production
- [ ] Check Supabase logs for errors related to deleted functions
- [ ] Monitor for 404s on deleted function endpoints
- [ ] Verify no frontend errors in production

### 5. CI/CD Improvements
- [ ] Add pre-deployment health check to CI/CD
- [ ] Set up alerts for function failures
- [ ] Create automated cleanup script for future unused functions

## 📊 Impact Summary

- **Deleted**: 60 functions (26% reduction)
- **Remaining**: ~167 functions
- **Risk**: Low (none were frontend-called)
- **Benefit**: Cleaner codebase, faster deployments

## 🔍 Verification Commands

```bash
# Count remaining functions
supabase functions list --project-ref qkgaybvrernstplzjaam | wc -l

# Check for broken references
grep -r "test-gemini\|scrape-lmc-truck\|quick-endpoint" nuke_frontend supabase/functions --include="*.ts" --include="*.tsx"

# Verify critical functions still work
node scripts/test-tier1-functions-real-data.js
```

## 🚨 If Issues Found

1. **404 Errors**: Function was deleted but still referenced
   - Fix: Update code to use correct function or remove reference
   
2. **Cron Job Failures**: Cron job calling deleted function
   - Fix: Update cron job or remove if no longer needed
   
3. **Database Trigger Failures**: Trigger calling deleted function
   - Fix: Update trigger or remove if no longer needed

## 📝 Maintenance Going Forward

### Monthly
- Review edge function usage logs
- Identify unused functions
- Delete experimental/test functions after 30 days

### Before Deployments
- Run health check: `node scripts/test-all-edge-functions-health.js`
- Verify Tier 1 functions: `node scripts/test-tier1-functions-real-data.js`

### Quarterly
- Full audit of all edge functions
- Update documentation
- Clean up deprecated functions


