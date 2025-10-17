# 🎯 COMPLETE DASHBOARD SETUP GUIDE

## 🚀 **3 DASHBOARDS TO UPDATE**

---

## 1️⃣ **VERCEL DASHBOARD** (Rename Project)

### **URL:** https://vercel.com/nzero/nuke_frontend/settings

### **Steps:**
1. ✅ **Already open** (I opened it for you)
2. Scroll down to **"Project Name"** section
3. Find the text input with `nuke_frontend`
4. Delete the text and type: `nuke`
5. Click **"Save"** button
6. Wait for confirmation message

### **Result:**
- Your new URL: `https://nuke.vercel.app`
- Old URL will redirect automatically

---

## 2️⃣ **GITHUB OAUTH DASHBOARD** (Update Callback)

### **URL:** https://github.com/settings/developers

### **Steps:**

1. Click on **"OAuth Apps"** tab (if not already there)

2. Find and click on your app: **"nuke"**
   - Client ID: `Ov23lie2ivkxA9C6hiNA`

3. Find **"Authorization callback URL"** field

4. **Current value** (what it might say now):
   ```
   http://localhost:54321/auth/v1/callback
   ```
   OR
   ```
   http://localhost:5174/auth/callback
   ```

5. **Change it to**:
   ```
   https://qkgaybvrernstplzjaam.supabase.co/auth/v1/callback
   ```

6. Click **"Update application"** button

### **Why this URL?**
This is your **Supabase auth endpoint**. GitHub sends the user here after they approve, then Supabase redirects them to your site.

---

## 3️⃣ **SUPABASE DASHBOARD** (Update Redirect URLs)

### **URL:** https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/auth/url-configuration

### **Steps:**

#### **A. Update Site URL**

1. Find **"Site URL"** field at the top

2. **Change it to**:
   ```
   https://nuke.vercel.app
   ```

3. Click **"Save"** (or it auto-saves)

#### **B. Update Redirect URLs**

1. Scroll down to **"Redirect URLs"** section

2. You'll see a text box (might have some URLs already)

3. **Add these lines** (one per line):
   ```
   https://nuke.vercel.app/**
   https://nuke.vercel.app/auth/callback
   https://nuke.vercel.app/vehicles
   https://nuke.vercel.app/dashboard
   ```

4. **Optional:** Keep localhost for local development:
   ```
   http://localhost:5174/**
   ```

5. Click **"Save"** button

### **What this does:**
Tells Supabase which URLs are allowed to receive authentication redirects. The `**` means "any path under this domain".

---

## 🧪 **TEST THE SETUP**

After completing all 3 dashboards:

### **1. Clear Your Browser Cache**
- Chrome: `Cmd + Shift + Delete` (Mac) or `Ctrl + Shift + Delete` (Windows)
- Or use Incognito/Private window

### **2. Visit Your Site**
```
https://nuke.vercel.app
```

### **3. Test Login Flow**

1. Click **"Login with GitHub"**
2. You should see GitHub's authorization page
3. Click **"Authorize"**
4. You should be redirected back to: `https://nuke.vercel.app`
5. You should be logged in ✅

### **4. If It Doesn't Work**

Check these:
- ❌ Redirects to localhost? → Check GitHub callback URL
- ❌ "Invalid redirect URL" error? → Check Supabase redirect URLs
- ❌ 401 error? → Check environment variables in Vercel

---

## 📋 **CHECKLIST**

Before you start:
- [ ] Open all 3 dashboard URLs in separate tabs
- [ ] Have this guide open for reference

Complete these in order:
- [ ] **Vercel**: Rename project to `nuke`
- [ ] **GitHub**: Update callback to Supabase URL
- [ ] **Supabase**: Update Site URL to `nuke.vercel.app`
- [ ] **Supabase**: Add redirect URLs

Test:
- [ ] Visit https://nuke.vercel.app
- [ ] Test GitHub login
- [ ] Verify you're redirected back to the site
- [ ] Confirm you can access the dashboard

---

## 🎯 **SUMMARY**

**3 Simple Updates:**

1. **Vercel**: `nuke_frontend` → `nuke`
2. **GitHub**: Callback → `https://qkgaybvrernstplzjaam.supabase.co/auth/v1/callback`
3. **Supabase**: Site URL → `https://nuke.vercel.app` + Add redirect URLs

**Result:** Clean URL, working login, everything remote! 🚀

---

## 📞 **NEED HELP?**

If something doesn't work:
1. Check you saved all 3 dashboards
2. Clear browser cache and try incognito
3. Check browser console for errors (F12)
4. Verify the URLs are exactly as written (no typos)

**Most common issue:** Forgetting to click "Save" in one of the dashboards!

