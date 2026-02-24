# 🌐 REMOTE-ONLY PRODUCTION SETUP

**Date**: January 2025  
**Goal**: Everything runs on remote/production - ZERO localhost dependencies

---

## 🎯 **CONFIGURATION OVERVIEW**

### **Remote Supabase (Production Database)**
- **URL**: `https://qkgaybvrernstplzjaam.supabase.co`
- **Anon Key**: `<your-supabase-anon-key>`

### **Production Frontend**
- **URL**: `https://nukefrontend.vercel.app`
- **Project**: `nuke_frontend` (only Vercel project)
- **Auto-deploys**: On git push to main

### **GitHub OAuth App**
- **App Name**: nuke (owned by sss97133)
- **Client ID**: `Ov23lie2ivkxA9C6hiNA`
- **Callback URL**: `https://qkgaybvrernstplzjaam.supabase.co/auth/v1/callback`

---

## 📋 **SETUP CHECKLIST**

### ✅ **Step 1: Update GitHub OAuth App**

1. Go to: https://github.com/settings/developers
2. Click on your OAuth App: **"nuke"**
3. Update **Authorization callback URL** to:
   ```
   https://qkgaybvrernstplzjaam.supabase.co/auth/v1/callback
   ```
4. **Remove or disable** any localhost URLs like:
   - ❌ `http://localhost:54321/auth/v1/callback`
   - ❌ `http://localhost:5174/auth/callback`

### ✅ **Step 2: Configure Supabase Auth URLs**

1. Go to: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam
2. Navigate to: **Authentication** → **URL Configuration**
3. Set **Site URL**:
   ```
   https://nukefrontend.vercel.app
   ```
4. Set **Redirect URLs** (add all):
   ```
   https://nukefrontend.vercel.app/**
   https://nukefrontend.vercel.app/auth/callback
   https://nukefrontend.vercel.app/vehicles
   https://nukefrontend.vercel.app/dashboard
   ```

### ✅ **Step 3: Verify Vercel Environment Variables**

All environment variables are already configured in Vercel:
- ✅ `VITE_SUPABASE_URL`: https://qkgaybvrernstplzjaam.supabase.co
- ✅ `VITE_SUPABASE_ANON_KEY`: (configured)
- ✅ `VITE_OPENAI_API_KEY`: (configured)
- ✅ `VITE_NUKE_CLAUDE_API`: (configured)
- ✅ `VITE_DROPBOX_CLIENT_ID`: howu7w7zml4m6mq
- ✅ `VITE_DROPBOX_CLIENT_SECRET`: (configured)

### ✅ **Step 4: Update Login Component**

The login component should always use production Supabase, not check for localhost.

---

## 🔧 **CODE CHANGES NEEDED**

### **1. Remove Localhost Detection in Login**

File: `nuke_frontend/src/components/auth/Login.tsx`

**Current problematic code:**
```typescript
const isLocalSupabase = import.meta.env.VITE_SUPABASE_URL?.includes('localhost');
const options = isLocalSupabase
  ? { redirectTo: `${window.location.origin}/auth/callback` }
  : {}; // Let Supabase handle the redirect for remote instances
```

**Should be:**
```typescript
// Always let Supabase handle OAuth redirects (remote production)
const options = {
  // Supabase will redirect to the configured Site URL after auth
};
```

### **2. Remove Localhost References**

Search for and remove/update any code that checks for localhost:
```bash
# Find all localhost references
grep -r "localhost" nuke_frontend/src/ | grep -v "node_modules"
```

---

## 🚀 **DEPLOYMENT WORKFLOW**

### **For Production Changes:**
```bash
cd /Users/skylar/nuke
git add .
git commit -m "feat: your change description"
git push origin main
# Auto-deploys to https://nukefrontend.vercel.app
```

### **Test Production Deployment:**
```bash
# Check deployment status
cd nuke_frontend && vercel inspect nukefrontend.vercel.app --scope=nuke

# View production logs
vercel logs nukefrontend.vercel.app --scope=nuke
```

---

## 🔐 **AUTHENTICATION FLOW**

### **Remote-Only OAuth Flow:**

1. User visits: `https://nukefrontend.vercel.app`
2. Clicks "Login with GitHub"
3. Redirected to GitHub OAuth: `https://github.com/login/oauth/authorize?client_id=Ov23lie2ivkxA9C6hiNA`
4. User approves
5. GitHub redirects to: `https://qkgaybvrernstplzjaam.supabase.co/auth/v1/callback`
6. Supabase processes auth
7. Supabase redirects to: `https://nukefrontend.vercel.app/` (Site URL)
8. User is logged in ✅

### **No Localhost Involved:**
- ❌ No localhost:5174
- ❌ No localhost:54321
- ✅ Everything runs on production URLs

---

## 🗄️ **DATABASE & STORAGE**

### **All Data on Remote Supabase:**
- **Database**: PostgreSQL on Supabase Cloud
- **Storage Buckets**:
  - `vehicle-images`: Vehicle photos
  - `vehicle-data`: Documents and files
- **Authentication**: Supabase Auth with GitHub OAuth

### **Storage URLs:**
```
https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-images/...
https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-data/...
```

---

## ✅ **VERIFICATION STEPS**

After configuration, verify:

### **1. Check Deployment**
```bash
curl -s https://nukefrontend.vercel.app/ | grep "Nuke Vehicle Platform"
```

### **2. Test Login Flow**
1. Go to: https://nukefrontend.vercel.app/login
2. Click "Login with GitHub"
3. Should redirect to GitHub, then back to production site
4. Should NOT redirect to localhost

### **3. Verify Database Connection**
```bash
# Check if Supabase is accessible
curl -s "https://qkgaybvrernstplzjaam.supabase.co/rest/v1/" \
  -H "apikey: <your-supabase-key>"
```

### **4. Test Vehicle Creation**
1. Log in to: https://nukefrontend.vercel.app
2. Navigate to: Add Vehicle
3. Create a test vehicle
4. Verify it appears in Supabase dashboard

---

## 🚫 **WHAT TO AVOID**

### **Do NOT:**
- ❌ Run local Supabase (`supabase start`)
- ❌ Use localhost URLs in OAuth configuration
- ❌ Create `.env.local` files
- ❌ Point environment variables to localhost
- ❌ Mix localhost and production configurations

### **Always:**
- ✅ Use remote Supabase for everything
- ✅ Test on production deployment
- ✅ Commit and push to trigger auto-deployment
- ✅ Use production URLs in all configurations

---

## 🔄 **QUICK FIXES**

### **If OAuth redirects to localhost:**
1. Check GitHub OAuth App callback URL
2. Check Supabase Site URL and Redirect URLs
3. Verify no localhost checks in Login.tsx

### **If database operations fail:**
1. Verify Vercel environment variables
2. Check Supabase project is online
3. Test API key with curl command above

### **If builds fail:**
1. Check Vercel deployment logs
2. Verify all environment variables are set
3. Test build locally: `npm run build`

---

## 📱 **MOBILE ACCESS**

Since everything is remote, mobile works perfectly:
- **iOS**: https://nukefrontend.vercel.app
- **Android**: https://nukefrontend.vercel.app
- **Desktop**: https://nukefrontend.vercel.app

No localhost dependencies = works everywhere!

---

## 🎯 **SUMMARY**

**Current State:**
- ✅ Frontend: Remote (Vercel)
- ✅ Database: Remote (Supabase)
- ✅ Storage: Remote (Supabase)
- ✅ Auth: Remote (Supabase + GitHub)
- ✅ AI APIs: Remote (OpenAI, Claude)

**Next Steps:**
1. Update GitHub OAuth callback URL
2. Update Supabase redirect URLs
3. Fix Login.tsx to remove localhost detection
4. Test login flow on production

**Result:** 100% remote, works from any device, no localhost needed! 🚀

