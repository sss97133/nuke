# Bundle Analysis Options - Safe Execution

## ✅ Two Ways to Run Bundle Analysis Without Failing

### Option 1: Supabase Edge Function (Recommended)
**Status: Deployed and ready**

The `analyze-bundle` edge function runs safely in Supabase's environment:
- ✅ No local environment dependencies
- ✅ Proper error handling
- ✅ Automatic retries
- ✅ Access to database functions

**Usage:**
```bash
node scripts/analyze-bundle-safe.js \
  <vehicle_id> \
  <bundle_date> \
  <device_fingerprint> \
  <organization_id>
```

**Example:**
```bash
node scripts/analyze-bundle-safe.js \
  eea40748-cdc1-4ae9-ade1-4431d14a7726 \
  2025-11-01 \
  "Unknown-Unknown-Unknown-Unknown" \
  1f76d43c-4dd6-4ee9-99df-6c46fd284654
```

### Option 2: GitHub Actions Workflow
**Status: Ready to use**

Run bundle analysis via GitHub Actions:
1. Go to GitHub repository
2. Click "Actions" tab
3. Select "Analyze Image Bundle" workflow
4. Click "Run workflow"
5. Fill in the inputs:
   - Vehicle ID
   - Bundle date (YYYY-MM-DD)
   - Device fingerprint
   - Organization ID
6. Click "Run workflow"

**Benefits:**
- ✅ Runs in GitHub's cloud environment
- ✅ No local setup needed
- ✅ Full logging and error reporting
- ✅ Can be scheduled or triggered manually

## 🔧 How It Works

Both options:
1. Get bundle context from database (`get_bundle_context`)
2. Call `generate-work-logs` edge function with bundle images
3. Populate receipt tables (`work_order_parts`, `work_order_labor`, etc.)
4. Return success with event ID and results

## 📊 Current Status

- ✅ Edge function deployed: `analyze-bundle`
- ✅ Safe script created: `scripts/analyze-bundle-safe.js`
- ✅ GitHub Actions workflow: `.github/workflows/analyze-bundle.yml`
- ⚠️ Function needs testing (currently getting 503 error - checking logs)

## 🐛 Troubleshooting

If you get errors:
1. Check Supabase function logs in dashboard
2. Verify environment variables are set
3. Ensure bundle exists for that date/device
4. Check that `generate-work-logs` function is deployed

## 🎯 Next Steps

Once the function is working:
1. Test with a small bundle (6 images)
2. Verify receipt data is populated
3. Check receipt UI displays correctly
4. Run analysis on more bundles

