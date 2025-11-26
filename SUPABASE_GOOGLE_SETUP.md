# 🔧 Supabase Dashboard: Google OAuth Setup

## ✅ Quick Steps

### 1. Go to Supabase Dashboard
**URL:** https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/auth/providers

### 2. Find Google Provider
Scroll down or search for **"Google"** in the providers list.

### 3. Enable Google Provider
Click on **"Google"** to open the configuration panel.

### 4. Enter Your Credentials

**Enable Google:**
- Toggle the switch to **ON** (enabled)

**Client ID (for Supabase):**
```
(your-google-client-id-here)
```

**Client Secret (for Supabase):**
```
(your-google-client-secret-here)
```

### 5. Save
Click **"Save"** button at the bottom of the configuration panel.

---

## ⚠️ Also Required: Google Cloud Console

Before Google OAuth will work, you must also add the redirect URI in Google Cloud Console:

### Google Cloud Console Setup

1. Go to: https://console.cloud.google.com/apis/credentials
2. Find your OAuth 2.0 Client ID (from your Google Cloud Console)
3. Click **Edit** (pencil icon)
4. Under **"Authorized redirect URIs"**, add:
   ```
   https://qkgaybvrernstplzjaam.supabase.co/auth/v1/callback
   ```
5. Click **Save**

---

## ✅ Status Check

After completing both steps above:

1. ✅ **Code**: Already done (Google button added to login)
2. ✅ **Supabase Dashboard**: Configure with credentials above
3. ✅ **Google Cloud Console**: Add redirect URI above

Once both are done, the "Continue with Google" button will work!

---

## 🧪 Test It

1. Go to your login page
2. Click **"Continue with Google"**
3. Should redirect to Google sign-in
4. After signing in, redirects back to your app

---

## 📋 Summary

**What to put in Supabase:**
- **Enable**: ON
- **Client ID**: (Your Google Client ID from Google Cloud Console)
- **Client Secret**: (Your Google Client Secret from Google Cloud Console)

**What to put in Google Cloud Console:**
- **Redirect URI**: `https://qkgaybvrernstplzjaam.supabase.co/auth/v1/callback`

That's it! 🎉

