# KSL Bot Protection Notice

## ⚠️ Issue

KSL Cars has implemented bot protection that blocks automated scraping. Both direct Playwright scraping and the edge function are returning "Access to this page has been denied."

## ✅ Solutions

### Option 1: Manual Data Entry
Use `scripts/import-ksl-manual.js` to manually import listing data:

```javascript
const listing = {
  url: 'https://cars.ksl.com/listing/10322112',
  title: '1980 Chevrolet 1/2 Ton',
  year: 1980,
  make: 'Chevrolet',
  model: '1/2 Ton',
  price: 3000,
  mileage: 114638,
  vin: '1GEKRLS123484738',
  // ... etc
};
```

### Option 2: Use Firecrawl API
The `scrape-vehicle` edge function already supports Firecrawl. Set `FIRECRAWL_API_KEY` in environment to bypass bot protection:

```bash
# Add to .env
FIRECRAWL_API_KEY=your_key_here
```

Then the edge function will use Firecrawl automatically for KSL listings.

### Option 3: Manual URL Collection
1. Manually visit KSL search pages
2. Collect listing URLs
3. Use admin UI to import them one by one
4. Or batch import via script with collected URLs

### Option 4: Browser Extension
Create a browser extension that:
- Runs in the user's browser (no bot detection)
- Collects listing URLs from search pages
- Sends them to your import API

## 📋 Current Status

- ✅ Admin UI built and ready
- ✅ Import scripts ready
- ✅ Database integration complete
- ⚠️ Automated scraping blocked by KSL
- 💡 Solution: Use Firecrawl API or manual collection

## 🔧 Quick Fix

The easiest solution is to set up Firecrawl API, which the scrape-vehicle function already supports:

1. Get Firecrawl API key from https://firecrawl.dev
2. Add to `.env`: `FIRECRAWL_API_KEY=your_key`
3. The edge function will automatically use it for KSL listings

