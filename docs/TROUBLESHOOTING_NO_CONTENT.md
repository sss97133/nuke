# Troubleshooting: No Images/Content Showing

## 🔍 Quick Diagnosis

If your site shows no content or images, check these in order:

### 1. Check Browser Console
Open DevTools (F12) → Console tab
- ❌ "Missing required Supabase configuration" → Environment variables not set
- ❌ "Database connection failed" → Wrong Supabase credentials
- ❌ Network errors → Check Supabase URL is correct
- ✅ No errors → Check database has public vehicles

### 2. Check Environment Variables in Vercel

**Required Variables:**
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

**How to Check:**
```bash
cd nuke_frontend
vercel env ls
```

**If Missing:**
1. Go to Vercel Dashboard → Your Project → Settings → Environment Variables
2. Add both variables (for Production, Preview, Development)
3. **Redeploy** (this is critical!)

### 3. Check Database Has Public Vehicles

The homepage only shows vehicles where `is_public = true`.

**Check in Supabase:**
```sql
SELECT COUNT(*) FROM vehicles WHERE is_public = true;
```

**If count is 0:**
- Either no vehicles exist, or
- All vehicles have `is_public = false`

**To make vehicles public:**
```sql
UPDATE vehicles SET is_public = true WHERE id = 'your-vehicle-id';
```

### 4. Check Deployment Status

**Verify deployment happened:**
```bash
cd nuke_frontend
vercel ls
```

**Check latest deployment:**
- Go to Vercel Dashboard → Deployments
- Check if latest deployment succeeded
- Check build logs for errors

**If deployment failed:**
- Check build logs for errors
- Verify `vercel.json` is correct
- Check Node.js version matches (should be 20.x)

---

## 🛠️ Step-by-Step Fix

### Step 1: Verify Environment Variables

```bash
# Run verification script
./scripts/verify-deployment.sh
```

### Step 2: Add Missing Variables (if needed)

**Via Vercel Dashboard:**
1. https://vercel.com/dashboard
2. Select your project
3. Settings → Environment Variables
4. Add:
   - Name: `VITE_SUPABASE_URL`
   - Value: `https://qkgaybvrernstplzjaam.supabase.co` (your actual URL)
   - Environments: All (Production, Preview, Development)
5. Add:
   - Name: `VITE_SUPABASE_ANON_KEY`
   - Value: Your actual anon key from Supabase
   - Environments: All
6. **Save**

### Step 3: Redeploy

**Critical:** After adding environment variables, you MUST redeploy:

**Option A: Via Dashboard**
1. Vercel Dashboard → Deployments
2. Click **⋯** on latest deployment
3. Click **Redeploy**

**Option B: Via CLI**
```bash
cd nuke_frontend
vercel --prod --yes
```

### Step 4: Verify Database

**Check if vehicles exist:**
```sql
-- In Supabase SQL Editor
SELECT id, make, model, is_public, created_at 
FROM vehicles 
ORDER BY created_at DESC 
LIMIT 10;
```

**Make vehicles public (if needed):**
```sql
-- Make all vehicles public (use with caution)
UPDATE vehicles SET is_public = true;

-- Or make specific vehicle public
UPDATE vehicles SET is_public = true WHERE id = 'vehicle-id-here';
```

### Step 5: Test Locally

**Create `.env.local`:**
```bash
cd nuke_frontend
echo "VITE_SUPABASE_URL=https://your-project.supabase.co" > .env.local
echo "VITE_SUPABASE_ANON_KEY=your-anon-key" >> .env.local
```

**Build and test:**
```bash
npm run build
npm run preview
```

Visit `http://localhost:4173` and check if content loads.

---

## 🐛 Common Issues

### Issue: "Updates aren't pushing"

**Symptoms:**
- Code changes not appearing on site
- Deployment not triggering

**Causes & Fixes:**

1. **GitHub not connected to Vercel**
   - Fix: Connect in Vercel Dashboard → Settings → Git
   - Or use manual deployment: `vercel --prod --yes`

2. **Pushing to wrong branch**
   - Fix: Push to `main` branch (or branch configured in Vercel)

3. **Build failing silently**
   - Fix: Check Vercel Dashboard → Deployments → Build logs

4. **Caching issues**
   - Fix: Hard refresh browser (Cmd+Shift+R / Ctrl+Shift+R)
   - Or: Clear Vercel cache and redeploy

### Issue: "No images showing"

**Possible Causes:**

1. **Images not in database**
   - Check: `SELECT * FROM vehicle_images LIMIT 10;`
   - Fix: Upload images to vehicles

2. **Image URLs broken**
   - Check: Image URLs in database are valid
   - Fix: Re-upload images or fix URLs

3. **Storage bucket permissions**
   - Check: Supabase Storage → vehicle-images bucket → Public
   - Fix: Make bucket public or use signed URLs

4. **CORS issues**
   - Check: Browser console for CORS errors
   - Fix: Configure CORS in Supabase Storage settings

### Issue: "No vehicles showing"

**Possible Causes:**

1. **No vehicles with `is_public = true`**
   - Fix: Update vehicles to be public (see Step 4 above)

2. **RLS policies blocking access**
   - Check: Supabase → Authentication → Policies
   - Fix: Ensure public read access is allowed

3. **Query filter too restrictive**
   - Check: Time period filter might be excluding all vehicles
   - Fix: Try "All Time" filter

---

## ✅ Verification Checklist

After fixing, verify:

- [ ] Environment variables set in Vercel (all environments)
- [ ] Project redeployed after adding variables
- [ ] Build succeeds (check Vercel logs)
- [ ] Browser console shows no errors
- [ ] Database has vehicles with `is_public = true`
- [ ] Images exist in `vehicle_images` table
- [ ] Storage bucket is public or accessible
- [ ] RLS policies allow public read access

---

## 📞 Still Not Working?

1. **Check browser console** for specific error messages
2. **Check Vercel deployment logs** for build errors
3. **Check Supabase logs** for database errors
4. **Run verification script**: `./scripts/verify-deployment.sh`
5. **Test locally** with `.env.local` to isolate deployment issues

---

## 📚 Related Docs

- [Environment Variables Setup](./VERCEL_ENV_SETUP.md)
- [Deployment Setup Guide](./DEPLOYMENT_SETUP.md)
- [Vercel CLI Commands](./VERCEL_CLI_COMMANDS.md)

