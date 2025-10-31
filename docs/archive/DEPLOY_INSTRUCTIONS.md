# Deploy Craigslist Image Extraction

## Quick Deploy

```bash
# 1. Make script executable (run once)
chmod +x deploy-functions.sh

# 2. Login to Supabase (run once)
supabase login

# 3. Deploy the function
./deploy-functions.sh
```

## Manual Deploy (if script fails)

```bash
supabase functions deploy scrape-vehicle --project-ref qkgaybvrernstplzjaam
```

## What This Deploys

The updated `scrape-vehicle` edge function now includes:
- ✅ **Craigslist support** - NEW!
- ✅ **Image extraction** from Craigslist listings (up to 50 images)
- ✅ **Bring a Trailer support** (existing)
- ✅ **Platform auto-detection** based on URL

## Test After Deployment

```bash
# Test Craigslist scraping
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/scrape-vehicle" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://sandiego.craigslist.org/esd/cto/d/el-centro-1972-gmc-suburban/7888155474.html"}'
```

Expected response:
```json
{
  "success": true,
  "data": {
    "source": "Craigslist",
    "title": "1972 GMC Suburban - $5,500",
    "year": "1972",
    "make": "GMC",
    "model": "Suburban",
    "asking_price": 5500,
    "mileage": 1000,
    "condition": "good",
    "images": [
      "https://images.craigslist.org/...",
      "... 13 total images"
    ]
  }
}
```

## Verify on Frontend

1. Go to https://n-zero.dev/add-vehicle
2. Paste the Craigslist URL
3. Watch it auto-fill vehicle data
4. See images download automatically (13 images for the GMC Suburban)
5. Create vehicle - images upload in background

## Function Location

**Edge Function:** `/supabase/functions/scrape-vehicle/index.ts`
**Endpoint:** `https://qkgaybvrernstplzjaam.supabase.co/functions/v1/scrape-vehicle`

## Troubleshooting

**If deployment fails:**
```bash
# Check if logged in
supabase projects list

# If not, login
supabase login

# Try deployment again
supabase functions deploy scrape-vehicle --project-ref qkgaybvrernstplzjaam --debug
```

**If function returns errors:**
- Check CORS proxy is accessible (corsproxy.io)
- Verify Craigslist listing is still active
- Check browser console for detailed errors

