# Fix: Auth sending you to n-zero after Google sign-in

**Don’t have a Google OAuth app yet?** See **[GOOGLE_OAUTH_SETUP.md](./GOOGLE_OAUTH_SETUP.md)** for creating the client and connecting it to Supabase.

Supabase only redirects to the URL you request **if that URL is allowlisted**. Otherwise it sends users to the project **Site URL** (which is probably n-zero).

## Do this once (2 minutes)

1. Open **Supabase Dashboard**: https://supabase.com/dashboard → select project (e.g. nuke / the one your app uses).
2. Go to **Authentication** → **URL Configuration**.
3. Set **Site URL** to your DealerScan app:
   - `https://dealerscan-three.vercel.app`
4. Under **Redirect URLs**, add (one per line if needed):
   - `https://dealerscan-three.vercel.app/**`
5. Save.

After that, "Continue with Google" on dealerscan-three.vercel.app will return users to dealerscan-three.vercel.app/dashboard instead of n-zero.

No code deploy needed—this is project settings only.
