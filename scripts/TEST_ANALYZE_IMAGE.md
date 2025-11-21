# Test analyze-image Function

## Function Redeployed ✅

The function has been redeployed (version 53) and should now have access to the OpenAI key.

## How to Test

### Option 1: Via UI (Easiest)
1. Go to any vehicle profile
2. Open an image in Lightbox
3. Click "AI" button
4. Check browser console for errors
5. Wait 10-15 seconds
6. Check if "Appraiser Notes" appear

### Option 2: Upload New Image
1. Upload a new image to any vehicle
2. Check browser console for errors
3. Wait 10-15 seconds
4. Check database:
   ```sql
   SELECT ai_scan_metadata 
   FROM vehicle_images 
   WHERE id = '[new-image-id]';
   ```

### Option 3: Check Logs
Go to: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/logs/edge-functions
- Filter by `analyze-image`
- Look for recent calls
- Check for errors

## What to Look For

### Success Indicators
- Function returns 200 status
- `ai_scan_metadata.rekognition` has data
- `ai_scan_metadata.appraiser` has data (if image is exterior/interior/engine)
- `ai_scan_metadata.spid` has data (if SPID sheet detected)

### Error Indicators
- 401 Unauthorized → Client API key issue
- 500 Error → Function error (check logs for details)
- "AWS credentials not configured" → AWS secret issue
- "OpenAI API key invalid" → OpenAI key issue
- Function completes but no data → Silent failure (check logs)

## Common Issues

1. **401 Unauthorized** - Frontend needs valid API key in `.env.local`
2. **Function errors silently** - Check Edge Function logs for details
3. **Secrets not accessible** - Might need to redeploy (already done)
4. **Function not called** - Check browser console for errors

## Next Steps

1. Test via UI or upload
2. Check Edge Function logs
3. Verify data in database
4. If still failing, share the specific error message

