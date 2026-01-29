# Edge Function Maintenance Guide

## Overview

This guide helps maintain a clean, efficient edge function ecosystem.

## Regular Maintenance Tasks

### Weekly
- [ ] Review Supabase logs for function errors
- [ ] Check for functions with high error rates
- [ ] Monitor function execution times

### Monthly
- [ ] Run full health check: `node scripts/test-all-edge-functions-health.js`
- [ ] Review function usage statistics
- [ ] Identify and delete unused experimental functions
- [ ] Update function documentation

### Quarterly
- [ ] Full audit of all edge functions
- [ ] Review and update function contracts
- [ ] Clean up deprecated functions
- [ ] Optimize slow functions

## Function Lifecycle

### 1. Creation
- ✅ Document function purpose and contract
- ✅ Add to `EDGE_FUNCTION_CONTRACTS.md`
- ✅ Write tests if Tier 1 function
- ✅ Deploy and verify

### 2. Active Use
- ✅ Monitor logs for errors
- ✅ Track usage statistics
- ✅ Update documentation as needed

### 3. Deprecation
- ⚠️ Mark as deprecated in documentation
- ⚠️ Add `replaced_by` field if applicable
- ⚠️ Remove from frontend calls
- ⚠️ Wait 30 days before deletion

### 4. Deletion
- 🗑️ Verify no references in code
- 🗑️ Check cron jobs and triggers
- 🗑️ Delete function
- 🗑️ Update documentation

## Best Practices

### Naming Conventions
- Use kebab-case: `analyze-image`, `process-vehicle-import`
- Be descriptive: `scrape-vehicle` not `scrape`
- Include action verb: `analyze-`, `process-`, `extract-`, `generate-`

### Function Categories
- **Tier 1**: User-facing, called from frontend (test before every deploy)
- **Tier 2**: High-value processing (test weekly)
- **Tier 3**: Background/admin (test monthly)
- **Tier 4**: Experimental/specialized (test as needed)

### Testing
- Always test Tier 1 functions before deployment
- Use real data for Tier 1 function tests
- Health checks are sufficient for Tier 3/4

### Documentation
- Document input/output contracts
- Include usage examples
- Note dependencies and secrets required
- Update when function changes

## Monitoring

### Key Metrics
- Function execution time
- Error rate
- Success rate
- Usage frequency

### Alerts
- Tier 1 function failures
- Functions with >10% error rate
- Functions taking >30s consistently
- Functions not used in 90+ days

## Cleanup Scripts

### Analyze Unused Functions
```bash
node scripts/analyze-unused-edge-functions.js
```

### Delete Unused Functions
```bash
bash scripts/delete-unused-edge-functions.sh
```

### Health Check
```bash
node scripts/test-all-edge-functions-health.js
```

### Tier 1 Test
```bash
node scripts/test-tier1-functions-real-data.js
```

## Common Issues

### Function Not Found (404)
- **Cause**: Function deleted but still referenced
- **Fix**: Update code to use correct function or remove reference

### High Error Rate
- **Cause**: Function logic issue or invalid inputs
- **Fix**: Review logs, fix logic, improve validation

### Timeout Issues
- **Cause**: Function taking too long
- **Fix**: Optimize function, add async processing, increase timeout

### Unused Functions
- **Cause**: Function created but never integrated
- **Fix**: Delete if experimental, integrate if needed

## Resources

- [Testing Strategy](./EDGE_FUNCTION_TESTING_STRATEGY.md)
- [Function Contracts](./EDGE_FUNCTION_CONTRACTS.md)
- [Cleanup Plan](./EDGE_FUNCTION_CLEANUP_PLAN.md)


