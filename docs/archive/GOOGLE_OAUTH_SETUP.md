# Google OAuth Setup Guide

## ✅ Configuration Complete in Code

I've added Google OAuth support to your codebase:
- ✅ Added Google OAuth configuration to `supabase/config.toml`
- ✅ Added "Continue with Google" button to Login component
- ✅ Updated `env.example` with Google OAuth variables

## 📋 Setup Steps Required

### Step 1: Configure Google Cloud Console

Your Google OAuth credentials are already created. Now you need to configure the authorized redirect URIs:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to **APIs & Services** → **Credentials**
3. Find your OAuth 2.0 Client ID (your actual client ID from Google Cloud Console)
4. Click **Edit** (pencil icon)
5. Under **Authorized redirect URIs**, add:
   ```
   https://qkgaybvrernstplzjaam.supabase.co/auth/v1/callback
   ```
6. If you're testing locally, also add:
   ```
   http://localhost:54321/auth/v1/callback
   ```
7. Click **Save**

### Step 2: Configure Supabase Dashboard

1. Go to [Supabase Dashboard](https://supabase.com/dashboard/project/qkgaybvrernstplzjaam)
2. Navigate to **Authentication** → **Providers**
3. Find **Google** in the list
4. Click to enable/configure it
5. Enter your credentials:
   - **Client ID (for Supabase)**: (Your Google Client ID)
   - **Client Secret (for Supabase)**: (Your Google Client Secret)
6. Click **Save**

### Step 3: Set Environment Variables

#### For Local Development

Add to your `.env` file (or create one if it doesn't exist):

```env
GOOGLE_CLIENT_ID=your-google-client-id-here
GOOGLE_CLIENT_SECRET=your-google-client-secret-here
```

**Location**: Create `.env` in the project root (`/Users/skylar/nuke/`)

#### For Production (Vercel)

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your project
3. Go to **Settings** → **Environment Variables**
4. Add:
   - **Key**: `GOOGLE_CLIENT_ID`
   - **Value**: (Your Google Client ID)
   - **Environment**: Production, Preview, Development (select all)
5. Add:
   - **Key**: `GOOGLE_CLIENT_SECRET`
   - **Value**: (Your Google Client Secret)
   - **Environment**: Production, Preview, Development (select all)
6. Click **Save**

**Note**: These environment variables are used by Supabase, not directly by the frontend. Make sure your Supabase project has access to them.

### Step 4: Update Supabase Project Environment Variables

Since you're using remote Supabase, you may need to set these in Supabase's environment:

1. Go to [Supabase Dashboard](https://supabase.com/dashboard/project/qkgaybvrernstplzjaam)
2. Navigate to **Settings** → **Edge Functions** → **Environment Variables** (if available)
3. Or set them via Supabase CLI:
   ```bash
   supabase secrets set GOOGLE_CLIENT_ID=your-google-client-id-here
   supabase secrets set GOOGLE_CLIENT_SECRET=your-google-client-secret-here
   ```

**Important**: The Supabase Dashboard provider configuration (Step 2) should be sufficient. The environment variables are mainly for local Supabase development.

## 🧪 Testing

### Test Local Development

1. Make sure local Supabase is running:
   ```bash
   supabase start
   ```

2. Start your frontend:
   ```bash
   cd nuke_frontend
   npm run dev
   ```

3. Go to `http://localhost:5174/login`
4. Click **Continue with Google**
5. Should redirect to Google OAuth
6. After authorization, should redirect back to your app

### Test Production

1. Deploy your changes:
   ```bash
   cd nuke_frontend
   vercel --prod
   ```

2. Go to your production URL (e.g., `https://n-zero.dev/login`)
3. Click **Continue with Google**
4. Should redirect to Google OAuth
5. After authorization, should redirect back to production

## ⚠️ Important Notes

1. **Client Secret Security**: 
   - The client secret you provided is sensitive. Store it securely.
   - Never commit it to git (already in `.gitignore` if using `.env`)
   - Google will show a warning about downloading the secret - you've already saved it

2. **OAuth Consent Screen**:
   - Your app is in "Testing" mode
   - Only test users listed in the OAuth consent screen can use it
   - To make it public, you'll need to submit for verification

3. **Authorized Domains**:
   - Make sure your production domain is added to authorized domains in Google Cloud Console
   - Go to **APIs & Services** → **OAuth consent screen** → **Authorized domains**

4. **Redirect URI Format**:
   - Must match exactly: `https://qkgaybvrernstplzjaam.supabase.co/auth/v1/callback`
   - No trailing slashes
   - Must use `https` for production

## 🎯 Current Status

- ✅ Code implementation complete
- ⏳ Google Cloud Console configuration (redirect URI)
- ⏳ Supabase Dashboard configuration (provider setup)
- ⏳ Environment variables setup

Once you complete steps 1-3, Google OAuth will be fully functional!

