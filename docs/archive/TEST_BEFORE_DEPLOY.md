# Safe Testing Plan - Before Deployment

## Testing Strategy

Test each component individually, then together, before full deployment.

## Phase 1: Edge Functions (Backend)

### Test 1: Tier 1 Function (Organization)
**Risk:** LOW - Just categorizes images, no database writes on failure

```bash
# Test with one real image
curl -X POST \
  "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/analyze-image-tier1" \
  -H "Authorization: Bearer <your-supabase-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "image_url": "https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-images/18377b38-4232-4549-ba36-acce06b7f67e/dee16914-99c1-4106-a25c-bdd6601dc83d.jpg",
    "image_id": "c869d996-f36e-41a6-8874-e5f42b026517",
    "estimated_resolution": "medium"
  }' | jq '.'
```

**Expected:** JSON with angle, category, components
**If fails:** No data written, safe to debug

### Test 2: Database Schema
**Risk:** LOW - Just checking tables exist

```sql
-- Check new tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_name IN ('image_question_answers', 'missing_context_reports')
AND table_schema = 'public';

-- Check columns added
SELECT column_name 
FROM information_schema.columns 
WHERE table_name = 'vehicle_images' 
AND column_name IN ('analysis_history', 'context_score', 'processing_models_used');
```

**Expected:** All tables and columns present
**If fails:** Run migration again

## Phase 2: React Components (Frontend)

### Test 3: Components Compile
**Risk:** LOW - Build error = no deploy, site stays up

```bash
cd /Users/skylar/nuke/nuke_frontend

# Check TypeScript compilation
npx tsc --noEmit

# Check for imports that don't exist
grep -r "from '../pages/ImageProcessingDashboard'" src/
```

**Expected:** No TypeScript errors
**If fails:** Fix imports/types before deploying

### Test 4: Local Dev Server
**Risk:** ZERO - Only affects local, not production

```bash
cd /Users/skylar/nuke/nuke_frontend
npm run dev
```

Then visit: http://localhost:5173/admin/image-processing

**Expected:** Dashboard loads (even if empty data)
**If fails:** Fix component errors locally

## Phase 3: Single Image Test (End-to-End)

### Test 5: Process ONE Image
**Risk:** MINIMAL - Testing on 1 image before thousands

```bash
cd /Users/skylar/nuke

# Create single-image test script
cat > scripts/test-single-image.js << 'SCRIPT'
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

const env = dotenv.parse(fs.readFileSync('nuke_frontend/.env.local'));
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function test() {
  console.log('Testing single image...\n');
  
  // Get one image
  const { data: image } = await supabase
    .from('vehicle_images')
    .select('id, image_url, vehicle_id')
    .limit(1)
    .single();
  
  if (!image) {
    console.log('No images found');
    return;
  }
  
  console.log('Image:', image.id);
  console.log('Vehicle:', image.vehicle_id);
  
  // Test Tier 1
  console.log('\nCalling Tier 1 function...');
  const { data, error } = await supabase.functions.invoke('analyze-image-tier1', {
    body: {
      image_url: image.image_url,
      image_id: image.id,
      estimated_resolution: 'medium'
    }
  });
  
  if (error) {
    console.log('❌ Error:', error);
    return;
  }
  
  console.log('✅ Success!');
  console.log('Result:', JSON.stringify(data, null, 2));
  
  // Check database was updated
  console.log('\nChecking database...');
  const { data: updated } = await supabase
    .from('vehicle_images')
    .select('ai_scan_metadata, category, angle')
    .eq('id', image.id)
    .single();
  
  console.log('Category:', updated.category);
  console.log('Angle:', updated.angle);
  console.log('Has tier_1_analysis:', !!updated.ai_scan_metadata?.tier_1_analysis);
  
  if (updated.ai_scan_metadata?.tier_1_analysis) {
    console.log('\n✅ Database updated correctly!');
    console.log('\nSafe to run batch processing.');
  } else {
    console.log('\n⚠️  Database not updated - check function code');
  }
}

test().catch(console.error);
SCRIPT

node scripts/test-single-image.js
```

**Expected:** 
- ✅ Function returns success
- ✅ Database updated with analysis
- ✅ No errors

**If fails:** Debug before batch processing

## Phase 4: Small Batch Test

### Test 6: Process 10 Images
**Risk:** LOW - Only 10 images, easy to rollback

```bash
# Modify batch processor to limit
node -e "
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';

const env = dotenv.parse(fs.readFileSync('nuke_frontend/.env.local'));
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// Process just 10 images
const { data: images } = await supabase
  .from('vehicle_images')
  .select('id, image_url, vehicle_id')
  .limit(10);

console.log('Processing 10 test images...');

for (const img of images) {
  const { data, error } = await supabase.functions.invoke('analyze-image-tier1', {
    body: {
      image_url: img.image_url,
      image_id: img.id,
      estimated_resolution: 'medium'
    }
  });
  
  if (error) {
    console.log('❌', img.id.substring(0, 8), error.message);
  } else {
    console.log('✅', img.id.substring(0, 8), data.angle, data.category);
  }
}

console.log('\nDone! Check results in database.');
" 2>&1
```

**Expected:** 10/10 successful
**Cost:** ~$0.0008 (less than a penny!)

## Phase 5: Frontend Deployment

### Test 7: Build Check
**Risk:** LOW - Build fails = no deploy

```bash
cd /Users/skylar/nuke/nuke_frontend
npm run build
```

**Expected:** Build succeeds
**If fails:** Fix TypeScript errors

### Test 8: Deploy to Preview
**Risk:** ZERO - Preview URL, not production

```bash
# Deploy to Vercel preview (not production)
vercel --yes
```

**Expected:** Preview URL to test dashboard
**If fails:** Fix build errors

## Phase 6: Production Deployment (After All Tests Pass)

### Safe Deployment Steps:

1. **Deploy Backend First** (Already done ✅)
   - Edge Functions deployed
   - Database migrations applied
   
2. **Deploy Frontend** (When ready)
   ```bash
   vercel --prod --yes
   ```

3. **Verify Dashboard Loads**
   - Visit: https://n-zero.dev/admin/image-processing
   - Should show 0 images processed (normal before batch run)

4. **Start Small Batch** (100 images)
   ```bash
   # Process just 100 images first
   node scripts/tiered-batch-processor.js 2>&1 | head -100
   ```

5. **Monitor for 5 Minutes**
   - Watch dashboard
   - Check for errors
   - Verify costs are low

6. **If All Good → Full Batch**
   ```bash
   node scripts/tiered-batch-processor.js
   ```

---

## Rollback Plan (If Something Goes Wrong)

### If Edge Function Fails:
```bash
# Redeploy previous version
git log --oneline supabase/functions/analyze-image-tier1/
git checkout <previous-commit> supabase/functions/analyze-image-tier1/
supabase functions deploy analyze-image-tier1 --no-verify-jwt
```

### If Database Has Issues:
```bash
# Tables are non-destructive, just added
# If needed, drop new tables:
DROP TABLE IF EXISTS image_question_answers;
DROP TABLE IF EXISTS missing_context_reports;

# Or rollback migration:
supabase db reset --local
```

### If Frontend Breaks:
```bash
# Vercel keeps previous deployment
# Just rollback in Vercel dashboard
# Or redeploy previous commit:
git revert HEAD
vercel --prod --yes
```

**Everything has a safe rollback!**

---

## What I'll Test Right Now

Let me run through all the tests for you:

1. ✅ Test Edge Function with real image
2. ✅ Check database schema
3. ✅ Test TypeScript compilation
4. ✅ Process 5 test images
5. ✅ Verify results

Then you'll know it's safe to deploy!

