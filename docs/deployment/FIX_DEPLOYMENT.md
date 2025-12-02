# FIX DEPLOYMENT - Step by Step

## 🚨 IMMEDIATE FIX

### Step 1: Ensure All Files Are Committed
```bash
cd /Users/skylar/nuke
git add -A
git status  # Verify all files are staged
git commit -m "fix: ensure all files committed for deployment"
```

### Step 2: Push to GitHub
```bash
git push origin main
```

### Step 3: Verify GitHub Has Latest Code
- Go to: https://github.com/sss97133/nuke
- Check latest commit matches your local
- Verify all files are in the repo

### Step 4: Check Vercel GitHub Integration
1. Go to: https://vercel.com/dashboard
2. Find your project
3. Settings → Git
4. Verify:
   - ✅ GitHub repo is connected
   - ✅ Branch is set to `main`
   - ✅ Auto-deploy is enabled

### Step 5: Force Deploy via CLI
```bash
cd /Users/skylar/nuke/nuke_frontend
vercel --prod --force --yes
```

## 🔍 Common Deployment Blockers

### Blocker 1: Missing Files in Git
**Symptom**: Build fails with "file not found"
**Fix**: 
```bash
git add nuke_frontend/src/components/parts/*.tsx
git commit -m "add missing files"
git push
```

### Blocker 2: GitHub Not Connected
**Symptom**: No auto-deploy on push
**Fix**: Connect in Vercel Dashboard → Settings → Git

### Blocker 3: Build Fails
**Symptom**: Deployment shows "Error"
**Fix**: Check build logs, fix errors, push again

### Blocker 4: Wrong Branch
**Symptom**: Changes on different branch
**Fix**: Set production branch to `main` in Vercel

## ✅ Verification

After deploying:
1. Check Vercel dashboard - deployment should show "Ready"
2. Visit production URL
3. Hard refresh (Cmd+Shift+R)
4. Verify changes are live

