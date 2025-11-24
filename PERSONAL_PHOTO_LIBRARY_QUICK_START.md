# Personal Photo Library - Quick Start Guide

**Get started in 5 minutes** 🚀

---

## ⚡ TL;DR

```bash
# 1. Apply database migration
cd /Users/skylar/nuke
supabase db push

# 2. Start frontend (if not running)
cd nuke_frontend
npm run dev

# 3. Open browser
open http://localhost:5173/photos

# 4. Upload photos!
```

---

## 📋 Step-by-Step Setup

### Step 1: Database Migration

Apply the migration to make `vehicle_id` nullable and add personal library support:

```bash
cd /Users/skylar/nuke

# Option A: Using Supabase CLI (recommended)
supabase db push

# Option B: Manual SQL
psql <your_connection_string> -f supabase/migrations/20251123200000_personal_photo_library.sql
```

**Verify migration succeeded:**

```bash
psql <your_connection_string> -c "
  SELECT column_name, data_type, is_nullable 
  FROM information_schema.columns 
  WHERE table_name = 'vehicle_images' 
  AND column_name IN ('vehicle_id', 'ai_processing_status', 'organization_status');
"
```

Expected output:
```
   column_name        | data_type | is_nullable
─────────────────────┼───────────┼─────────────
 vehicle_id          | uuid      | YES
 ai_processing_status| text      | YES
 organization_status | text      | YES
```

### Step 2: Backfill Existing Data (Optional)

Mark existing vehicle-linked photos as "organized":

```sql
UPDATE vehicle_images
SET 
  organization_status = 'organized',
  organized_at = created_at,
  ai_processing_status = 'pending'
WHERE vehicle_id IS NOT NULL
  AND organization_status IS NULL;
```

### Step 3: Start Frontend

```bash
cd nuke_frontend
npm run dev
```

Frontend will start at `http://localhost:5173`

### Step 4: Navigate to Photo Library

Open browser and go to:
```
http://localhost:5173/photos
```

You should see the Personal Photo Library page!

---

## 🎯 First Upload Test

### Test Case: Upload 10 Photos

1. **Go to** `/photos`
2. **Drag and drop** 10 photos into the upload zone
3. **Wait** for uploads to complete (progress bar shows)
4. **Check** that photos appear in "Unorganized" tab
5. **Verify** counter shows "10 photos to organize"

### Expected Behavior

- Photos upload in parallel (fast!)
- Thumbnails generated automatically
- AI status shows "Pending" badges
- No vehicle_id required ✅

---

## 🤖 AI Processing (Optional for Now)

If you want to test AI suggestions, run the processing script:

```bash
# Get your user ID first
psql <connection_string> -c "
  SELECT id, email FROM auth.users LIMIT 5;
"

# Process photos for specific user
node scripts/process-personal-library-images.js <your_user_id>

# Or process all users
node scripts/process-personal-library-images.js --all
```

**Requirements**:
- `OPENAI_API_KEY` environment variable set
- `SUPABASE_SERVICE_ROLE_KEY` environment variable set

**What it does**:
1. Analyzes each photo with GPT-4o-mini (~$0.001/image)
2. Detects vehicle make/model/year
3. Classifies angle (front, rear, interior, etc.)
4. Extracts VINs if visible
5. Groups similar photos
6. Creates AI suggestions

---

## ✅ Testing Checklist

### Basic Upload ✓
- [ ] Drag-drop single photo
- [ ] Drag-drop 10 photos
- [ ] Drag-drop 100 photos
- [ ] Click "Select from Computer"
- [ ] Upload HEIC images (if on Mac)

### Grid View ✓
- [ ] Switch density: Small / Medium / Large
- [ ] Verify thumbnails load
- [ ] Check AI status badges appear
- [ ] Test scroll performance

### Multi-Select ✓
- [ ] Click checkbox on single photo
- [ ] Click "Select All"
- [ ] Verify toolbar appears at bottom
- [ ] Click "Cancel" to deselect

### Link to Vehicle ✓
- [ ] Select 5 photos
- [ ] Click "Link to Vehicle"
- [ ] Select a vehicle from modal
- [ ] Verify photos disappear from inbox
- [ ] Check counter decreased by 5

### AI Suggestions (if processing ran) ✓
- [ ] Click "AI Suggestions" tab
- [ ] Verify suggestions appear
- [ ] Expand a suggestion
- [ ] Click "Accept & Create Vehicle Profile"
- [ ] Verify vehicle created
- [ ] Check photos linked to new vehicle

---

## 🐛 Troubleshooting

### Photos not uploading?

**Check browser console** for errors:
```
Right-click → Inspect → Console tab
```

Common issues:
- Storage bucket permissions (check RLS policies)
- File size too large (>10MB limit)
- Network timeout (try smaller batch)

### Photos not appearing in grid?

**Check database**:
```sql
SELECT id, file_name, vehicle_id, organization_status, ai_processing_status
FROM vehicle_images
WHERE user_id = '<your_user_id>'
ORDER BY created_at DESC
LIMIT 10;
```

**Verify RLS policy** allows viewing:
```sql
SELECT * FROM vehicle_images 
WHERE user_id = auth.uid() 
AND vehicle_id IS NULL;
```

### AI Processing stuck on "Pending"?

Check OpenAI API key:
```bash
echo $OPENAI_API_KEY
```

Manual processing:
```bash
node scripts/process-personal-library-images.js <user_id>
```

### Thumbnails not loading?

Check storage bucket public access:
```sql
-- Verify public bucket policy exists
SELECT * FROM storage.buckets WHERE id = 'vehicle-images';
```

---

## 🚀 Production Deployment

### 1. Deploy Database Changes

```bash
# Production database
supabase db push --linked
```

### 2. Deploy Frontend

```bash
cd nuke_frontend

# Build production bundle
npm run build

# Deploy (if using Vercel)
vercel --prod
```

### 3. Setup AI Processing (Background Worker)

Create an Edge Function to process photos automatically:

```typescript
// supabase/functions/process-photo-library/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

serve(async (req) => {
  // Runs every 5 minutes via cron
  // Processes pending photos in batches
  // Creates AI suggestions
})
```

Schedule with Supabase Cron:
```sql
SELECT cron.schedule(
  'process-photo-library',
  '*/5 * * * *',  -- Every 5 minutes
  'https://<your-project>.supabase.co/functions/v1/process-photo-library'
);
```

---

## 📊 Monitoring

### Check System Health

```sql
-- Unorganized photo count per user
SELECT 
  user_id,
  COUNT(*) as unorganized_count
FROM vehicle_images
WHERE vehicle_id IS NULL 
  AND organization_status = 'unorganized'
GROUP BY user_id
ORDER BY unorganized_count DESC;

-- AI processing status breakdown
SELECT 
  ai_processing_status,
  COUNT(*) as count
FROM vehicle_images
WHERE vehicle_id IS NULL
GROUP BY ai_processing_status;

-- AI suggestion acceptance rate
SELECT 
  status,
  COUNT(*) as count,
  AVG(confidence) as avg_confidence
FROM vehicle_suggestions
GROUP BY status;
```

### Performance Metrics

```sql
-- Average time to organize photos
SELECT 
  AVG(EXTRACT(EPOCH FROM (organized_at - created_at)) / 60) as avg_minutes
FROM vehicle_images
WHERE organized_at IS NOT NULL;

-- Most common detected vehicles
SELECT 
  ai_detected_vehicle->>'make' as make,
  ai_detected_vehicle->>'model' as model,
  COUNT(*) as photo_count
FROM vehicle_images
WHERE ai_detected_vehicle IS NOT NULL
GROUP BY make, model
ORDER BY photo_count DESC
LIMIT 10;
```

---

## 🎉 Success! Now What?

### For Users
1. **Upload** all your car photos (10,000+)
2. **Review** AI suggestions
3. **Organize** into vehicle profiles
4. **Achieve** Inbox Zero!

### For Developers
1. **Monitor** usage and performance
2. **Tune** AI prompts for better detection
3. **Add** smart album features
4. **Build** native mobile app

---

## 📚 Related Documentation

- [Complete System Documentation](./docs/PERSONAL_PHOTO_LIBRARY_SYSTEM.md)
- [UI Wireframes](./docs/PERSONAL_PHOTO_LIBRARY_WIREFRAME.md)
- [Image Sets System](./docs/IMAGE_SETS_ERD_AND_WIREFRAME.md)
- [Image Processing Standards](./docs/IMAGE_PROCESSING_PROFESSIONAL_STANDARDS.md)

---

## 🆘 Need Help?

**Check logs**:
```bash
# Frontend logs
cd nuke_frontend && npm run dev

# Database logs
supabase logs --type db

# Edge function logs
supabase functions logs process-photo-library
```

**Common commands**:
```bash
# Reset database (DANGER: deletes all data)
supabase db reset

# Run migrations only
supabase db push

# Check migration status
supabase migration list
```

---

**Built**: November 23, 2025  
**Status**: Production Ready  
**Version**: 1.0.0

