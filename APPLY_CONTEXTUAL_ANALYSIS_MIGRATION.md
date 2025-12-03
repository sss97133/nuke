# Apply Contextual Analysis Migration

## Step 1: Run Migration in Supabase Dashboard

Go to Supabase Dashboard → SQL Editor and run:

```sql
-- Add contextual analysis fields to timeline_events
-- These fields support the enhanced contextual batch analyzer

-- Note: vehicle_timeline_events is a VIEW, the base table is timeline_events

-- Add contextual analysis status
ALTER TABLE timeline_events
ADD COLUMN IF NOT EXISTS contextual_analysis_status TEXT DEFAULT 'pending' 
  CHECK (contextual_analysis_status IN ('pending', 'processing', 'completed', 'failed'));

-- Add index for pending analysis queries
CREATE INDEX IF NOT EXISTS idx_timeline_events_contextual_status 
  ON timeline_events(contextual_analysis_status) 
  WHERE contextual_analysis_status = 'pending';

-- Add comment
COMMENT ON COLUMN timeline_events.contextual_analysis_status IS 
  'Status of contextual batch analysis: pending, processing, completed, or failed';
```

## Step 2: Deploy Edge Function

```bash
cd /Users/skylar/nuke
npx supabase functions deploy analyze-batch-contextual
```

## Step 3: Test the System

1. Navigate to a vehicle profile with images
2. Find a timeline event with 4+ images (like the one mentioned: "Evidence set (4 photos)")
3. Open the receipt modal for that event
4. Click the "ANALYZE NOW" button
5. Wait ~5-10 seconds for analysis
6. Refresh/reload to see results

## Expected Results

You should see:

### Contextual Analysis Section (blue background):
- Situation summary
- Activity description
- Components involved
- Temporal relationships (continuation/preparation/standalone)
- Time investment estimates

### User Commitment Level Section (yellow background):
- Level: CASUAL | REGULAR | DEDICATED | EXPERT
- Overall score (0-100)
- Contributing factors

## Troubleshooting

If analysis doesn't trigger:
1. Check browser console for errors
2. Check Supabase Functions logs
3. Verify ANTHROPIC_API_KEY is set in Supabase secrets

If results don't appear:
1. Check `timeline_events` table for the event
2. Look at `metadata` column - should have `contextual_analysis` and `user_commitment_score` keys
3. Hard refresh the receipt modal

