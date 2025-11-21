# Diagnose: analyze-image Function Not Working

## Status

✅ **Function redeployed** (version 53) - should have access to new OpenAI key
✅ **Secrets configured** - OpenAI, AWS, Service Role all set
⚠️ **No recent calls** - No `analyze-image` calls in logs (only old 401 from version 51)

## What "Not Working" Could Mean

### 1. Function Not Being Called
- Frontend not invoking the function
- API key issue preventing invocation
- Function not triggered on upload

### 2. Function Called But Failing
- 401 Unauthorized → Client API key invalid
- 500 Error → Function error (check logs)
- Silent failure → Function completes but no data saved

### 3. Function Works But No Data
- Secrets not accessible to function
- AWS/OpenAI calls failing silently
- Data not being saved to database

## How to Diagnose

### Step 1: Check Browser Console
When you click "AI" button or upload image:
1. Open browser DevTools (F12)
2. Go to Console tab
3. Look for errors related to `analyze-image`
4. Share the exact error message

### Step 2: Check Edge Function Logs
Go to: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/logs/edge-functions
- Filter by `analyze-image`
- Look for recent calls (after redeploy)
- Check status codes (200 = success, 401/500 = error)
- Click on a log entry to see full error details

### Step 3: Test Function Directly
```bash
# Get anon key from .env.local, then:
curl -X POST https://qkgaybvrernstplzjaam.supabase.co/functions/v1/analyze-image \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "image_url": "https://example.com/test.jpg",
    "vehicle_id": "test-id"
  }'
```

## Common Issues & Fixes

### Issue 1: "401 Unauthorized"
**Cause**: Invalid client API key
**Fix**: Update `VITE_SUPABASE_ANON_KEY` in `.env.local`

### Issue 2: "AWS credentials not configured"
**Cause**: AWS secrets not accessible
**Fix**: Verify secrets are set: `supabase secrets list`

### Issue 3: "OpenAI API key invalid"
**Cause**: OpenAI key not accessible or invalid
**Fix**: 
- Verify key is set: `supabase secrets list | grep OPENAI`
- Redeploy function: `supabase functions deploy analyze-image`

### Issue 4: Function completes but no data
**Cause**: Silent failures in OpenAI/AWS calls
**Fix**: Check Edge Function logs for detailed errors

## Next Steps

1. **Share the specific error** you're seeing (browser console or logs)
2. **Check Edge Function logs** for `analyze-image` after trying again
3. **Test with a new image upload** and see if it triggers the function

## Quick Test

Try uploading a new image to any vehicle and check:
- Browser console for errors
- Edge Function logs for `analyze-image` call
- Database after 10-15 seconds:
  ```sql
  SELECT ai_scan_metadata 
  FROM vehicle_images 
  WHERE id = '[new-image-id]';
  ```

