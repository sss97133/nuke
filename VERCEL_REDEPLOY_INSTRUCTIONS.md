# 🔄 Vercel Redeploy Instructions

## Issue
Production (https://n-zero.dev) is serving **stale cached code** with:
- ❌ Emojis in badges ("💰 6931% GAIN")
- ❌ INVEST buttons that were removed
- ❌ Old UI from before today's changes

## Solution: Force Redeploy

### Option 1: Vercel Dashboard (Recommended)

1. Go to: https://vercel.com/nzero/nuke/deployments
2. Click on the latest deployment
3. Click "Redeploy"
4. ✅ **Check "Use existing Build Cache" = OFF**
5. Click "Redeploy"
6. Wait 2-3 minutes for build

### Option 2: Vercel CLI

```bash
# Install Vercel CLI if needed
npm i -g vercel

# Login
vercel login

# Force redeploy with cache clear
vercel --prod --force

# Or trigger via git (already done)
git commit --allow-empty -m "Force redeploy"
git push origin main
```

### Option 3: GitHub Actions (If configured)

- Push was just made (commit: "🔄 FORCE: Trigger Vercel deployment")
- Vercel should auto-deploy in 2-3 minutes
- Check: https://github.com/sss97133/nuke/actions

---

## Verification After Redeploy

Visit: https://n-zero.dev

**Hard refresh** (don't use cached version):
- Mac: `Cmd + Shift + R`
- Windows: `Ctrl + Shift + R`

**Check for:**
- ✅ NO emojis in "GAIN" badge
- ✅ NO "INVEST $10/50/100" buttons
- ✅ Year/make/model clickable
- ✅ Time period filters visible
- ✅ Clean, professional UI

---

## If Still Showing Old Code

### Clear Vercel Edge Cache

```bash
# Via Vercel CLI
vercel domains purge n-zero.dev

# Or via Vercel Dashboard
Project Settings → Domains → Purge Cache
```

### Clear CDN Cache

Visit: https://n-zero.dev?_vercel_no_cache=1

This forces bypass of edge cache.

---

## Environment Variables Check

Ensure these are set in Vercel:

```bash
VITE_SUPABASE_URL=https://tzorvvtvzrfqkdshcijr.supabase.co
VITE_SUPABASE_ANON_KEY=[your-key]
```

If missing, add them and redeploy.

---

## Expected Timeline

- **Empty commit pushed:** ✅ Done (2:15 PM)
- **Vercel webhook triggered:** 0-30 seconds
- **Build starts:** Immediate
- **Build completes:** 2-3 minutes
- **Deployment live:** ~3-4 minutes total

**Check deployment status:**
https://vercel.com/nzero/nuke

---

## Troubleshooting

**If build fails:**
1. Check Vercel build logs
2. Look for TypeScript errors
3. Verify node_modules cached correctly

**If correct code but old content:**
1. Hard refresh browser
2. Clear browser cache
3. Try incognito/private window
4. Purge Vercel edge cache

**If database connection fails:**
1. Verify environment variables
2. Check Supabase dashboard
3. Test connection with Supabase client

---

**Last Updated:** October 30, 2025, 2:20 PM

