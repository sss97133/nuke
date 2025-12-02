# DEPLOYMENT DIAGNOSTIC & FIX

## 🚨 IMMEDIATE ACTIONS

### Run This Script:
```bash
cd /Users/skylar/nuke
bash EMERGENCY_DEPLOY.sh
```

### Or Manual Steps:

#### 1. Ensure All Files Committed
```bash
cd /Users/skylar/nuke
git add -A
git status  # Check what's staged
git commit -m "fix: deploy all changes"
```

#### 2. Push to GitHub
```bash
git push origin main
```

#### 3. Verify Push Succeeded
```bash
git log origin/main -1  # Should match your local commit
```

#### 4. Force Deploy via Vercel CLI
```bash
cd nuke_frontend
vercel --prod --force --yes
```

## 🔍 DIAGNOSTIC CHECKLIST

### Check 1: Are Files in Git?
```bash
git ls-files nuke_frontend/src/components/parts/
```
Should show 7 files. If missing, they need to be added.

### Check 2: Does Build Work?
```bash
cd nuke_frontend
npm run build
```
If fails, fix errors before deploying.

### Check 3: Is GitHub Connected to Vercel?
- Go to: https://vercel.com/dashboard
- Project → Settings → Git
- Verify repo is connected
- Verify branch is `main`
- Verify auto-deploy is ON

### Check 4: Are There Uncommitted Changes?
```bash
git status
```
If yes, commit them.

### Check 5: Is Code Pushed?
```bash
git log origin/main..HEAD
```
If shows commits, they're not pushed yet.

## 🛠️ COMMON FIXES

### Fix 1: Missing Parts Files
```bash
git add nuke_frontend/src/components/parts/*.tsx
git commit -m "add missing parts files"
git push
```

### Fix 2: Build Fails
Check build logs, fix TypeScript errors, then:
```bash
cd nuke_frontend
npm run build  # Must succeed
```

### Fix 3: GitHub Not Connected
1. Vercel Dashboard → Add New Project
2. Select GitHub repo
3. Configure (auto-detects vercel.json)
4. Deploy

### Fix 4: Auto-Deploy Disabled
1. Vercel Dashboard → Settings → Git
2. Enable "Auto-deploy from Git"
3. Set production branch to `main`

## ✅ VERIFICATION

After deploying:
1. Vercel Dashboard → Deployments → Latest should be "Ready"
2. Visit production URL
3. Hard refresh (Cmd+Shift+R)
4. Check browser console for errors

## 🎯 ROOT CAUSE

Most likely issues:
1. **Files not in git** - parts components missing
2. **Build failing** - TypeScript or import errors
3. **GitHub not connected** - No auto-deploy
4. **Changes not pushed** - Local commits not on GitHub

Run the diagnostic checks above to identify which one.

