# Setup Firecrawl for KSL Scraping

## ⚠️ Important: Edge Functions Need Environment Variables in Supabase

The Firecrawl API key needs to be set in **Supabase's environment variables**, not just your local `.env` file.

## Steps to Configure

### 1. Get Firecrawl API Key
- Sign up at https://firecrawl.dev
- Get your API key from the dashboard

### 2. Set in Supabase Dashboard

1. Go to your Supabase project dashboard
2. Navigate to: **Project Settings** → **Edge Functions** → **Secrets**
3. Add a new secret:
   - **Name:** `FIRECRAWL_API_KEY`
   - **Value:** Your Firecrawl API key

### 3. Redeploy Edge Function

After setting the secret, redeploy the scrape-vehicle function:

```bash
supabase functions deploy scrape-vehicle
```

Or use the Supabase Dashboard:
1. Go to **Edge Functions**
2. Find `scrape-vehicle`
3. Click **Redeploy**

### 4. Test

Once deployed, test with:

```bash
node scripts/test-ksl-with-firecrawl.js
```

## Alternative: Set Locally First

To test locally, add to your `.env` file:
```bash
FIRECRAWL_API_KEY=your_key_here
```

Then test the script, but remember the edge function still needs it in Supabase!

