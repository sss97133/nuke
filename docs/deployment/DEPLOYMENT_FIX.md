# Deployment Not Working - Fix Guide

## 🚨 Issue: Changes Not Deploying

If your changes aren't appearing in production, follow these steps:

## Step 1: Verify All Changes Are Committed

```bash
# Check for uncommitted changes
git status

# If there are changes, commit them
git add -A
git commit -m "fix: deploy all changes"
```

## Step 2: Push to GitHub

```bash
# Push to main branch
git push origin main

# Verify push succeeded
git log origin/main -1
```

## Step 3: Check Vercel Deployment

### Option A: Vercel Dashboard
1. Go to: https://vercel.com/dashboard
2. Find your project
3. Check "Deployments" tab
4. Look for latest deployment:
   - ✅ "Ready" = Success
   - ❌ "Error" = Check build logs
   - ⏳ "Building" = In progress

### Option B: Vercel CLI
```bash
cd nuke_frontend
vercel ls
```

## Step 4: Force Redeploy (If Needed)

```bash
cd nuke_frontend
vercel --prod --force
```

## Step 5: Verify GitHub Integration

1. Vercel Dashboard → Project Settings → Git
2. Verify GitHub repo is connected
3. Verify branch is set to `main`
4. Check "Auto-deploy" is enabled

## Common Issues

### Issue: Build Fails
**Check**: Vercel Dashboard → Deployments → Build Logs
**Fix**: Resolve build errors, then push again

### Issue: No Auto-Deploy
**Check**: Vercel Dashboard → Settings → Git
**Fix**: Reconnect GitHub or enable auto-deploy

### Issue: Wrong Branch
**Check**: Vercel Dashboard → Settings → Git → Production Branch
**Fix**: Set to `main`

### Issue: Changes Not Committed
**Check**: `git status`
**Fix**: `git add -A && git commit -m "message" && git push`

## Quick Fix Script

Run:
```bash
./scripts/force-deploy.sh
```

This will:
1. Stage all changes
2. Commit if needed
3. Push to main
4. Trigger Vercel deployment

## Verification

After deployment:
1. Wait 2-5 minutes
2. Visit production URL
3. Hard refresh (Cmd+Shift+R)
4. Verify changes are live

