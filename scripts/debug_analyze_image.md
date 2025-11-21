# Debug: analyze-image Function Not Working

## Issues Found

1. **401 Unauthorized** - One `analyze-image` call returned 401 (invalid API key for invocation)
2. **Function exists** - `analyze-image` is deployed (version 52, ACTIVE)
3. **Secrets set** - OpenAI key was just set via CLI
4. **Silent failures** - Function returns `null` if OpenAI key missing (doesn't throw error)

## Possible Causes

### 1. Function Not Getting Secrets
The function uses `Deno.env.get('OPENAI_API_KEY')` - if the secret isn't accessible, it returns null silently.

### 2. AWS Credentials Issue
If AWS credentials fail, the function throws an error and the whole analysis fails.

### 3. Client API Key Issue
The frontend needs a valid API key to invoke the function (separate from Edge Function secrets).

## How to Debug

### Check Function Logs
Go to: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/logs/edge-functions
- Filter by `analyze-image`
- Look for recent errors
- Check execution time (if it's very fast, it might be failing early)

### Test Function Directly
```bash
# Get a valid anon key from .env.local
# Then test:
curl -X POST https://qkgaybvrernstplzjaam.supabase.co/functions/v1/analyze-image \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "image_url": "https://example.com/test.jpg",
    "vehicle_id": "test-id"
  }'
```

### Check Secret Access
The function should be able to access:
- `OPENAI_API_KEY` - Just set
- `AWS_ACCESS_KEY_ID` - Already configured
- `AWS_SECRET_ACCESS_KEY` - Already configured
- `SERVICE_ROLE_KEY` - Already configured
- `SUPABASE_URL` - Auto-provided by Supabase

## Next Steps

1. Check Edge Function logs for `analyze-image` errors
2. Verify secrets are accessible (might need to redeploy function)
3. Test function with valid client API key
4. Check if function is being called from frontend

