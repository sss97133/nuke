# Production Environment Checklist ✅

## 🎯 Quick Answer

For **production** on `https://n-zero.dev`, you need these environment variables in **Vercel**:

### Required (Must Have)

```env
VITE_SUPABASE_URL=https://qkgaybvrernstplzjaam.supabase.co
VITE_SUPABASE_ANON_KEY=your-actual-anon-key-here
```

### Optional (Only if you use these features)

```env
# Only if Phoenix API is deployed in production
VITE_API_URL=https://your-phoenix-api-domain.com/api

# Only if you use OpenAI features
VITE_OPENAI_API_KEY=sk-...

# Only if you use Dropbox integration
VITE_DROPBOX_CLIENT_ID=howu7w7zml4m6mq
VITE_DROPBOX_CLIENT_SECRET=6d9mpmfkdt3qtob
```

---

## 📍 Where to Set These

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your project (probably named "nuke")
3. Go to **Settings** → **Environment Variables**
4. Click **Add New** for each variable
5. Select **Production**, **Preview**, and **Development**
6. **Save** each one
7. **Redeploy** your app (Deployments → ⋯ → Redeploy)

---

## 🔍 Check Current Vercel Environment

```bash
cd nuke_frontend
vercel env ls
```

This shows all environment variables currently set in Vercel.

---

## ⚠️ Important Notes

### About `VITE_API_URL`

- **Only needed if** your Phoenix API (`nuke_api`) is deployed in production
- **Current status**: Doesn't appear to be deployed yet
- **If not set**: Receipt parsing won't work, but everything else will
- **If you need it**: Deploy Phoenix API first, then set this variable

### About Supabase

- You're already using production Supabase: `https://qkgaybvrernstplzjaam.supabase.co`
- This is required - your app won't work without it

---

## ✅ Verification Steps

After setting environment variables and redeploying:

1. **Visit production site**: `https://n-zero.dev`
2. **Open browser console** (F12)
3. **Check for errors**: Should be no missing API URL errors
4. **Test authentication**: Try logging in
5. **Test vehicle pages**: Check if prices display correctly

---

## 🚀 Summary

**Minimum for production to work:**
- ✅ `VITE_SUPABASE_URL`
- ✅ `VITE_SUPABASE_ANON_KEY`

**Everything else is optional** based on what features you use!

