# Production Configuration Guide

## 🚀 Your Production Setup

Based on your codebase, here's what you need for production:

### Frontend (Vite/React)
- **Deployed at**: `https://n-zero.dev` (via Vercel)
- **Framework**: Vite
- **Environment Variables Needed**: Set in Vercel Dashboard

### Backend Services
1. **Supabase** - Your main database
   - URL: `https://qkgaybvrernstplzjaam.supabase.co`
   - Used for: Vehicles, images, authentication, etc.

2. **Phoenix API** (`nuke_api`) - Special operations
   - Used for: Receipt parsing, web scraping, complex processing
   - **Production URL**: Need to determine where this is deployed
   - Default fallback in code: `http://localhost:4000/api`

---

## 📋 Required Environment Variables in Vercel

Go to **Vercel Dashboard** → Your Project → **Settings** → **Environment Variables**

### Required Variables

```env
# Supabase (REQUIRED)
VITE_SUPABASE_URL=https://qkgaybvrernstplzjaam.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

### Phoenix API (If You Use Receipt Parsing)

**Current Status**: Your Phoenix API (`nuke_api`) doesn't appear to be deployed in production yet.

**If you want receipt parsing to work in production**, you have two options:

**Option 1: Deploy Phoenix API**
- Deploy `nuke_api` to a hosting service (Fly.io, Render, Railway, etc.)
- Then set in Vercel:
  ```env
  VITE_API_URL=https://your-api-domain.com/api
  ```

**Option 2: Use Supabase Edge Functions Instead**
- Replace Phoenix API receipt parsing with a Supabase Edge Function
- No separate API deployment needed
- Frontend can call it directly via Supabase client

**Current `vercel.json` behavior**: 
- `/api/*` routes are proxied to Supabase Edge Functions (not Phoenix API)
- This is for mailbox functionality, not receipt parsing

---

## 🔍 How to Check Your Current Setup

### 1. Check if Phoenix API is deployed

```bash
# Check if nuke_api is deployed somewhere
curl -I https://n-zero.dev/api/health
# or
curl -I https://api.n-zero.dev/api/health
# or
curl -I https://nuke-api.fly.dev/api/health
```

### 2. Check Vercel Environment Variables

```bash
cd nuke_frontend
vercel env ls
```

This will show all environment variables set in Vercel.

---

## ⚙️ Production Configuration Steps

### Step 1: Set Supabase Variables in Vercel

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your project
3. Go to **Settings** → **Environment Variables**
4. Add:
   - `VITE_SUPABASE_URL` = `https://qkgaybvrernstplzjaam.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = (your actual key)
   - Select **Production**, **Preview**, and **Development**
5. Click **Save**

### Step 2: Determine Phoenix API Production URL

**Option A: Phoenix API is NOT deployed**
- You don't need `VITE_API_URL` in production
- Receipt parsing won't work (but rest of app will)

**Option B: Phoenix API is deployed somewhere**
- Set `VITE_API_URL` to the production API URL
- Example: `https://n-zero.dev/api` or `https://api.n-zero.dev/api`

### Step 3: Redeploy After Adding Variables

After adding environment variables:
1. Go to **Deployments** tab in Vercel
2. Click **⋯** on latest deployment
3. Click **Redeploy**
4. Wait for deployment to complete

---

## 🧪 Verify Production Configuration

### 1. Check Environment Variables in Build

The build logs in Vercel should show your environment variables are loaded (values are hidden for security).

### 2. Test Production Site

1. Visit `https://n-zero.dev`
2. Open browser console (F12)
3. Check for any errors related to missing API URLs
4. Try using features that require the Phoenix API (like receipt parsing)

### 3. Check Network Requests

In browser DevTools → Network tab:
- Supabase requests should go to `*.supabase.co`
- Phoenix API requests should go to your `VITE_API_URL` value
- If you see requests to `http://localhost:4000`, your `VITE_API_URL` is missing or incorrect

---

## 📝 Current Code Behavior

From `universalReceiptParser.ts`:
```typescript
private static API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
```

This means:
- If `VITE_API_URL` is set → uses that
- If not set → tries `http://localhost:4000` (will fail in production)
- **Solution**: Set `VITE_API_URL` in Vercel to your production Phoenix API URL

---

## 🎯 Next Steps

1. **Determine where your Phoenix API is deployed** (if at all)
2. **Set `VITE_API_URL` in Vercel** to the production API URL
3. **Redeploy** your frontend
4. **Test** receipt parsing and other Phoenix API features

---

## ❓ Questions to Answer

1. Is your Phoenix API (`nuke_api`) deployed in production?
   - If yes: What's the URL?
   - If no: Do you need it? (Only needed for receipt parsing)

2. Do you use receipt parsing in production?
   - If yes: You MUST deploy the Phoenix API and set `VITE_API_URL`
   - If no: You can skip `VITE_API_URL`

