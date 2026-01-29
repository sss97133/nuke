# Firecrawl Setup - Quick Instructions

## ✅ You Added the Key - Now Configure Supabase

Since you added the Firecrawl key, here's what to do next:

### Step 1: Set Key in Supabase Dashboard

The edge function needs the key in **Supabase's secrets**, not just your local `.env`:

1. Go to: https://supabase.com/dashboard/project/[your-project]/settings/functions
2. Scroll to **Secrets** section
3. Click **Add new secret**
4. Name: `FIRECRAWL_API_KEY`
5. Value: (paste your Firecrawl API key)
6. Click **Save**

### Step 2: Redeploy Edge Function

After adding the secret, redeploy the function:

```bash
supabase functions deploy scrape-vehicle
```

### Step 3: Test It

Once deployed, test with:

```bash
node scripts/test-ksl-with-firecrawl.js "https://cars.ksl.com/listing/10322112"
```

## Quick Test Scripts Ready

I've created these scripts for you:

- **`scripts/test-ksl-with-firecrawl.js`** - Test if Firecrawl is working
- **`scripts/import-ksl-single.js`** - Import a single listing

Once Firecrawl is configured, you can import listings automatically!

