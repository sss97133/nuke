# Production Deployment Fix - Action Plan

**Status**: Code is production-ready, deployment URL returns 404  
**Priority**: HIGH - Blocks production access  
**Estimated Time**: 30 minutes to 2 hours

---

## Current Situation

✅ **Code Status**: All features implemented and committed  
✅ **Database**: Schema deployed with RLS policies  
✅ **Build Config**: Correct (vercel.json)  
⚠️ **Production URL**: https://n-zero.vercel.app returns 404

```bash
$ curl -I https://n-zero.vercel.app
HTTP/2 404 
x-vercel-error: DEPLOYMENT_NOT_FOUND
```

---

## Step 1: Verify Vercel Project Status

### Option A: Check Vercel Dashboard
1. Go to https://vercel.com/dashboard
2. Look for "nuke" or "n-zero" project
3. Check if project exists and is active
4. Verify current deployment URL

### Option B: Use Vercel CLI
```bash
# List all projects
vercel list

# Check current project status
cd /Users/skylar/nuke
vercel ls
```

**Expected Output**: Should show project name and production URL

---

## Step 2: Fix Deployment (Choose One Path)

### Path A: Project Exists But Deployment Failed

If project exists on Vercel but no deployment:

```bash
cd /Users/skylar/nuke/nuke_frontend

# Force rebuild and deploy
vercel --prod --force --yes

# OR build locally first to verify
npm run build
vercel --prod --prebuilt --yes
```

### Path B: Project Not Linked

If "Command not found" or "No project found":

```bash
cd /Users/skylar/nuke/nuke_frontend

# Link to existing Vercel project
vercel link

# Then deploy
vercel --prod --yes
```

### Path C: Project Doesn't Exist

If no project on Vercel at all:

```bash
cd /Users/skylar/nuke/nuke_frontend

# Create new project and deploy
vercel --prod --yes

# Follow prompts:
# - Project name: nuke (or n-zero)
# - Framework: Vite
# - Root directory: nuke_frontend
# - Build command: npm run build
# - Output directory: dist
```

### Path D: Domain Configuration Issue

If project exists but domain doesn't work:

1. Go to Vercel dashboard > Project Settings > Domains
2. Add domain: `n-zero.vercel.app`
3. OR note the actual production URL (e.g., `nuke-xyz123.vercel.app`)
4. Update documentation with correct URL

---

## Step 3: Verify Deployment Success

### Check Build Logs
```bash
vercel logs --prod
```

**Look for**:
- ✅ "Build completed"
- ✅ "Deployment ready"
- ⚠️ Any errors in logs

### Test Production URL

Once deployment succeeds, verify:

```bash
# Check status
curl -I [YOUR_PRODUCTION_URL]

# Should return:
# HTTP/2 200
# (not 404)
```

### Open in Browser
```bash
open [YOUR_PRODUCTION_URL]
```

**Verify**:
- ✅ Site loads
- ✅ Navigation works
- ✅ Can access /portfolio
- ✅ Can access /builder
- ✅ Can access /browse-investments

---

## Step 4: Configure Environment Variables

If site loads but features broken, check environment variables:

### Required Variables:
```bash
# On Vercel Dashboard > Project > Settings > Environment Variables

VITE_SUPABASE_URL=https://[your-project].supabase.co
VITE_SUPABASE_ANON_KEY=[your-anon-key]
```

### How to Find Supabase Credentials:
```bash
# Method 1: Check .env file
cat /Users/skylar/nuke/nuke_frontend/.env

# Method 2: Supabase CLI
supabase status
```

### Add to Vercel:
1. Go to Vercel Dashboard > Project > Settings > Environment Variables
2. Add `VITE_SUPABASE_URL` → Your Supabase URL
3. Add `VITE_SUPABASE_ANON_KEY` → Your anon key
4. Select "Production" environment
5. Click "Save"
6. Redeploy:
   ```bash
   vercel --prod --yes
   ```

---

## Step 5: Post-Deployment Testing

### Critical User Flows to Test:

#### 1. Authentication
```
1. Navigate to /login
2. Sign in with test account
3. Verify redirects to dashboard
```

#### 2. Portfolio Page
```
1. Navigate to /portfolio
2. Verify tabs load: Cash, Shares, Stakes, Bonds
3. Check data displays correctly
```

#### 3. Builder Dashboard
```
1. Navigate to /builder
2. Verify "Your Vehicles" section shows
3. Click "Create Funding Round" on a vehicle
4. Verify form loads
```

#### 4. Browse Investments
```
1. Navigate to /browse-investments
2. Switch tabs: Funding Rounds / Bonds
3. Verify cards display
4. Click on a card → should navigate to vehicle profile
```

#### 5. Financial Transactions
```
1. Create a funding round (small amount like $10)
2. Verify confirmation modal appears
3. Submit
4. Verify toast notification shows
5. Check funding round appears in browser
```

---

## Step 6: Monitor Production

### Check Error Logs
```bash
# Vercel logs
vercel logs --prod --follow

# Supabase logs
# Go to Supabase Dashboard > Logs
```

### Common Issues:

| Error | Cause | Fix |
|-------|-------|-----|
| "Module not found" | Build issue | Check imports, rebuild |
| "Unauthorized" | Supabase RLS | Check policies |
| "Function not found" | Database | Run migrations |
| "CORS error" | API config | Check Supabase settings |

---

## Rollback Plan (If Needed)

If deployment breaks something:

```bash
# List recent deployments
vercel list

# Rollback to previous deployment
vercel rollback [DEPLOYMENT_URL]
```

---

## Success Criteria

✅ Production URL returns 200 (not 404)  
✅ Site loads in browser  
✅ Navigation links work  
✅ User can log in  
✅ Portfolio page displays data  
✅ Builder dashboard shows vehicles  
✅ Browse investments shows funding rounds/bonds  
✅ Can create funding round (with confirmation modal)  
✅ Toast notifications appear on success/error  

---

## Quick Reference Commands

```bash
# Navigate to frontend
cd /Users/skylar/nuke/nuke_frontend

# Check Vercel status
vercel ls

# Force deploy
vercel --prod --force --yes

# Check logs
vercel logs --prod

# Check production URL
curl -I [YOUR_URL]

# Open in browser
open [YOUR_URL]
```

---

## Expected Results

After following these steps:

1. **Deployment URL works** (200 instead of 404)
2. **Site loads** in browser
3. **All navigation links functional**
4. **Financial features work**:
   - Portfolio displays holdings
   - Builder can create products
   - Browse shows investment opportunities
5. **UX features work**:
   - Toast notifications
   - Confirmation modals
   - Loading states

---

## If Still Blocked

If deployment still fails after all steps:

### Check These:

1. **Build locally**:
   ```bash
   cd /Users/skylar/nuke/nuke_frontend
   npm run build
   ```
   - Look for build errors
   - Check `dist/` folder exists

2. **Check package.json**:
   ```json
   {
     "scripts": {
       "build": "tsc && vite build"
     }
   }
   ```

3. **Check vercel.json paths**:
   ```json
   {
     "buildCommand": "cd nuke_frontend && npm run build",
     "outputDirectory": "nuke_frontend/dist"
   }
   ```

4. **Check Node version**:
   ```bash
   node --version  # Should be 18.x or 20.x
   ```

---

## Contact Support

If blocked after all steps:

- Vercel Support: https://vercel.com/support
- Supabase Support: https://supabase.com/support
- Check Vercel Status: https://vercel-status.com

---

**Next Step**: Start with Step 1 (Verify Vercel Project Status)

