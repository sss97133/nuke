# Firecrawl Integration for 403 Bypass

## Overview

Firecrawl is integrated into `scrape-vehicle` to bypass Cloudflare and 403 errors when scraping vehicle listings.

## How It Works

1. **Firecrawl First**: If `FIRECRAWL_API_KEY` is set, tries Firecrawl API first
2. **Fallback**: If Firecrawl fails or isn't configured, falls back to direct fetch
3. **Automatic**: Works transparently - no code changes needed

## Setup

### 1. Get Firecrawl API Key

1. Sign up at https://www.firecrawl.dev
2. Get your API key from the dashboard
3. Add to Supabase environment variables:

```bash
# In Supabase Dashboard → Settings → Edge Functions → Secrets
FIRECRAWL_API_KEY=fc-your-api-key-here
```

Or via CLI:
```bash
supabase secrets set FIRECRAWL_API_KEY=fc-your-api-key-here
```

### 2. Test It

```bash
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/scrape-vehicle" \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.hemmings.com/listing/..."}'
```

## Pricing

- **Free Tier**: 1,000 requests/month
- **Starter**: $20/month - 10,000 requests
- **Pro**: $99/month - 100,000 requests

Perfect for scraping millions of squarebody listings!

## Benefits

- ✅ Bypasses Cloudflare protection
- ✅ Handles JavaScript-rendered pages
- ✅ Works on sites that block direct scraping
- ✅ Automatic fallback if Firecrawl unavailable
- ✅ No code changes needed - just add API key

## Usage

The system automatically uses Firecrawl when:
- `FIRECRAWL_API_KEY` is set
- Direct fetch returns 403/Forbidden
- Site requires JavaScript rendering

No changes needed to existing code - it just works!

