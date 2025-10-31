# Test Plan: Intelligent Work Session Analyzer

## ✅ Deployed to Production
**URL:** https://n-zero.dev

## What Got Deployed

1. **WorkSessionAnalyzer** - AI service that analyzes batches of photos and creates intelligent timeline events
2. **CleanupPhotoEventsButton** - One-time cleanup tool visible to vehicle owners
3. **Fixed RLS policies** - Images now load properly (no more 400 errors)
4. **Technical view** - Proper columns, optimized thumbnails, sortable

## How to Test

### Test 1: Clean Up Existing "Photo Added" Spam (1974 Bronco)

1. **Navigate to your Bronco:**
   ```
   https://n-zero.dev/vehicle/eea40748-cdc1-4ae9-ade1-4431d14a7726
   ```

2. **Scroll to the "Timeline Cleanup Tool" card**
   - Should appear in the left column if you're the owner
   - Grey card with "Timeline Cleanup Tool" header

3. **Click "Clean Up Timeline" button**
   - Confirms: "This will analyze all your photos with AI..."
   - Click OK

4. **Watch AI analyze your photos:**
   - Button changes to "Analyzing photos with AI..."
   - Takes 10-30 seconds depending on photo count
   - Check browser console for: `🔍 Analyzing X photos to create work session...`

5. **Check Results:**
   - Should show: `✅ Success! Created X work session events and removed Y redundant "Photo Added" entries.`
   - Refresh page
   - Open timeline - should see intelligent events like:
     - "Interior seat restoration" (18 photos)
     - "Engine bay cleaning" (12 photos)
   - Instead of 100+ "Photo Added" entries

### Test 2: Upload New Photos (Future Uploads)

1. **Upload a batch of photos**
   - Click "Add Photos"
   - Select 5-10 related photos (same work session)
   - Upload them

2. **Wait 5 seconds**
   - BatchUploadProcessor accumulates uploads
   - After 5 seconds of no new uploads, triggers AI analysis

3. **Check timeline:**
   - Should create ONE meaningful event, not 10 individual "Photo Added" events
   - Console logs: `✅ Created intelligent work session event instead of 10 individual photo events`

### Test 3: Homepage Technical View

1. **Navigate to homepage:**
   ```
   https://n-zero.dev
   ```

2. **Click "Technical" view mode**
   - Should see proper columns: Year, Make, Model, Mileage, Price, etc.
   - No emoji clutter
   - Images load fast (thumbnails, not full-res)
   - Click column headers to sort

3. **Try filters:**
   - Click "Filters" button
   - Set year range: 1964-1991
   - Check "Has Images"
   - Should filter instantly

## Expected Console Output

### Successful Work Session Analysis:
```
🔍 Analyzing 18 photos to create work session...
[AI processing...]
✅ Created intelligent work session event instead of 18 individual photo events
```

### Timeline Event Created:
```json
{
  "event_type": "work_session",
  "title": "Interior seat restoration",
  "description": "Removed and replaced front driver and passenger seats. Cleaned and conditioned leather. Fixed mounting brackets.",
  "metadata": {
    "work_type": "restoration",
    "components": ["front_seats", "interior", "upholstery"],
    "estimated_hours": 3.5,
    "confidence": 0.92,
    "image_count": 18
  }
}
```

## What to Look For

### ✅ Good Signs:
- Timeline shows meaningful work descriptions
- Fewer timeline events (100 → 10)
- Photos grouped logically
- Event titles make sense ("Interior restoration" not "Photo Added")

### ❌ Bad Signs:
- Still seeing "Photo Added" spam
- AI analysis fails (check if OPENAI_API_KEY is set)
- Timeline cleanup button doesn't appear (check if you're vehicle owner)
- 400 errors in console (RLS policy issue)

## Troubleshooting

### "Timeline Cleanup Tool not showing"
- Make sure you're logged in as vehicle owner
- Check: `isRowOwner || isVerifiedOwner` should be true

### "AI analysis fails"
- Check `.env.local` has `VITE_OPENAI_API_KEY`
- Console error will show: "AI analysis failed: [error]"
- Falls back to generic "X photos uploaded" event

### "Images still not loading"
- Check console for 400 errors
- Run: `mcp_supabase_execute_sql` to verify RLS policies
- Should see `public_read_vehicle_images` policy with `qual = "true"`

### "Still seeing Photo Added events"
- Old events won't auto-delete
- Must click "Clean Up Timeline" button manually
- Or wait for next photo upload (future uploads use new system)

## Cost Estimate

- **GPT-4 Vision:** ~$0.01-0.05 per batch (10 images)
- **Average vehicle cleanup:** ~$0.20-0.50 for 100-150 photos
- **Ongoing uploads:** Minimal (batches processed automatically)

## Next Steps After Testing

1. **Feedback on AI-generated titles** - Are they accurate?
2. **Tune prompts** - If titles are generic, we can make them more specific
3. **Add manual override** - Let users edit AI-generated event titles
4. **Batch processing improvements** - Adjust 4-hour window or image count limits

---

**Ready to test!** Start with the Bronco cleanup button. 🚗

