# Vercel Environment Variables Setup

## 🚨 Critical: Required Environment Variables

Your app **will not work** without these environment variables set in Vercel:

### Required Variables

1. **VITE_SUPABASE_URL**
   - Your Supabase project URL
   - Format: `https://[project-id].supabase.co`
   - Example: `https://qkgaybvrernstplzjaam.supabase.co`

2. **VITE_SUPABASE_ANON_KEY**
   - Your Supabase anonymous/public key
   - Found in: Supabase Dashboard → Settings → API → Project API keys → `anon` `public`

---

## 📋 How to Set Environment Variables in Vercel

### Method 1: Vercel Dashboard (Recommended)

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your project (`nuke` or `nuke-frontend`)
3. Go to **Settings** → **Environment Variables**
4. Click **Add New**
5. For each variable:
   - **Name**: `VITE_SUPABASE_URL` (or `VITE_SUPABASE_ANON_KEY`)
   - **Value**: Your actual value
   - **Environment**: Select all (Production, Preview, Development)
   - Click **Save**
6. **Important**: After adding variables, redeploy:
   - Go to **Deployments** tab
   - Click **⋯** on latest deployment
   - Click **Redeploy**

### Method 2: Vercel CLI

```bash
cd nuke_frontend

# Add environment variable
vercel env add VITE_SUPABASE_URL production
# Paste your value when prompted

vercel env add VITE_SUPABASE_ANON_KEY production
# Paste your value when prompted

# List all environment variables
vercel env ls

# Pull environment variables (for local dev)
vercel env pull .env.local
```

---

## ✅ Verification Steps

### 1. Check Variables Are Set

```bash
cd nuke_frontend
vercel env ls
```

Should show:
- ✅ `VITE_SUPABASE_URL` (Production, Preview, Development)
- ✅ `VITE_SUPABASE_ANON_KEY` (Production, Preview, Development)

### 2. Test Local Build

```bash
cd nuke_frontend

# Create .env.local with your variables
echo "VITE_SUPABASE_URL=https://your-project.supabase.co" > .env.local
echo "VITE_SUPABASE_ANON_KEY=your-anon-key" >> .env.local

# Build locally
npm run build

# Should build successfully without errors
```

### 3. Check Production Site

1. Visit your production URL
2. Open browser DevTools (F12)
3. Check Console for errors:
   - ❌ "Missing required Supabase configuration" = Variables not set
   - ❌ "Database connection failed" = Wrong URL/key
   - ✅ No errors = Variables are correct

---

## 🔍 Troubleshooting

### Problem: "Missing required Supabase configuration"

**Cause**: Environment variables not set in Vercel

**Fix**:
1. Add variables in Vercel Dashboard (see Method 1 above)
2. Redeploy the project
3. Wait for deployment to complete

### Problem: "Database connection failed"

**Cause**: Wrong Supabase URL or key

**Fix**:
1. Verify URL format: `https://[project-id].supabase.co`
2. Verify key is the `anon` `public` key (not service role key)
3. Check Supabase Dashboard → Settings → API
4. Update variables in Vercel
5. Redeploy

### Problem: Build succeeds but site shows no content

**Possible Causes**:
1. Variables set but not redeployed → **Redeploy after adding variables**
2. Variables set for wrong environment → Check Production vs Preview
3. RLS policies blocking access → Check Supabase RLS policies
4. No public vehicles in database → Check `vehicles` table for `is_public=true`

**Debug Steps**:
1. Check browser console for errors
2. Check Network tab for failed API calls
3. Verify Supabase project is active
4. Check RLS policies allow public read access

---

## 📝 Quick Checklist

- [ ] `VITE_SUPABASE_URL` set in Vercel (all environments)
- [ ] `VITE_SUPABASE_ANON_KEY` set in Vercel (all environments)
- [ ] Project redeployed after adding variables
- [ ] Build succeeds locally with `.env.local`
- [ ] Production site loads without console errors
- [ ] Vehicles with `is_public=true` exist in database

---

## 🔗 Related Documentation

- [Supabase Environment Variables](https://supabase.com/docs/guides/getting-started/local-development#environment-variables)
- [Vercel Environment Variables](https://vercel.com/docs/concepts/projects/environment-variables)
- [Deployment Setup Guide](./DEPLOYMENT_SETUP.md)

