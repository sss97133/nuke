# Google OAuth app for DealerScan (Supabase Auth)

You need a **Google OAuth 2.0 Client** (Web application) so "Continue with Google" works. Supabase handles the flow; Google just needs to trust your Supabase callback URL.

## 1. Google Cloud Console

1. Go to **https://console.cloud.google.com/**
2. Create or select a project (e.g. "DealerScan").
3. **APIs & Services** → **OAuth consent screen**  
   - Choose **External** (or Internal if it’s only your org).  
   - App name: e.g. **DealerScan**.  
   - User support email: your email.  
   - Developer contact: your email.  
   - Save.
4. **APIs & Services** → **Credentials** → **Create credentials** → **OAuth client ID**.
5. Application type: **Web application**.
6. Name: e.g. **DealerScan Web**.
7. **Authorized redirect URIs** → Add exactly:
   ```text
   https://qkgaybvrernstplzjaam.supabase.co/auth/v1/callback
   ```
   (That’s your Supabase project. If you use a different Supabase project, use its URL and `/auth/v1/callback`.)
8. **Authorized JavaScript origins** (optional but good to set):
   - `https://dealerscan-three.vercel.app`
   - `http://localhost:5173` (for local dev)
9. Create. Copy the **Client ID** and **Client Secret**.

## 2. Supabase

1. **Supabase Dashboard** → your project → **Authentication** → **Providers**.
2. Find **Google** → Enable.
3. Paste **Client ID** and **Client Secret** from Google.
4. Save.

## 3. Supabase URL Configuration (so you don’t land on n-zero)

**Authentication** → **URL Configuration**:

- **Site URL**: `https://dealerscan-three.vercel.app`
- **Redirect URLs**: add `https://dealerscan-three.vercel.app/**`

## If something fails

- **“Redirect URI mismatch”**  
  The URI in Google (step 7) must match exactly what Supabase uses:  
  `https://qkgaybvrernstplzjaam.supabase.co/auth/v1/callback`  
  No typo, no extra path, same protocol (https).

- **“Access blocked: This app’s request is invalid”**  
  Finish the OAuth consent screen (step 3). If the app is in “Testing”, only test users can sign in until you submit for verification (or add your email as a test user).

- **“Can’t create OAuth client”**  
  You need a Google Cloud project and the OAuth consent screen configured first (steps 2–3). If you don’t see “Create credentials” → “OAuth client ID”, make sure the consent screen is saved.
