# Bonhams Auction Extractor

High-quality extraction for Bonhams auction house listings with full gallery support.

## Features

- **Multi-currency support**: GBP, USD, EUR, JPY, CHF
- **Tiered buyer's premium calculation**: Bonhams 3-tier structure (27.5%/21%/15%)
- **Full gallery extraction**: 30-80+ images per lot
- **VIN + Chassis number detection**: Modern VINs and classic chassis numbers
- **Complete auction metadata**: Lot number, sale ID, estimates, hammer price, total price
- **Rich content extraction**: Description, condition report, provenance, history, literature
- **Status tracking**: sold, unsold, withdrawn, upcoming

## URL Patterns

### Lot Page
```
https://www.bonhams.com/auction/{sale-id}/lot/{lot-number}/
```
Example: `https://www.bonhams.com/auction/29123/lot/42/`

### Catalog Page
```
https://www.bonhams.com/auction/{sale-id}/
```
Example: `https://www.bonhams.com/auction/29123/`

### Department Page
```
https://www.bonhams.com/department/MOT/
```
Motoring department (use for discovery)

## API Usage

### Basic Extraction (no DB save)
```bash
curl -X POST "$VITE_SUPABASE_URL/functions/v1/extract-bonhams" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.bonhams.com/auction/29123/lot/42/"
  }'
```

### Extract and Save to Database
```bash
curl -X POST "$VITE_SUPABASE_URL/functions/v1/extract-bonhams" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.bonhams.com/auction/29123/lot/42/",
    "save_to_db": true
  }'
```

### Update Existing Vehicle
```bash
curl -X POST "$VITE_SUPABASE_URL/functions/v1/extract-bonhams" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.bonhams.com/auction/29123/lot/42/",
    "vehicle_id": "uuid-here"
  }'
```

## Response Schema

```typescript
interface BonhamsExtracted {
  url: string;
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  chassis_number: string | null;

  // Pricing (multi-currency)
  estimate_low: number | null;
  estimate_high: number | null;
  estimate_currency: string | null;
  hammer_price: number | null;
  buyers_premium: number | null;
  total_price: number | null;
  price_currency: string | null;

  // Auction metadata
  lot_number: string | null;
  sale_id: string | null;
  sale_name: string | null;
  sale_date: string | null;
  sale_location: string | null;
  auction_status: 'sold' | 'unsold' | 'withdrawn' | 'upcoming' | null;

  // Specs
  mileage: number | null;
  engine: string | null;
  transmission: string | null;
  exterior_color: string | null;
  interior_color: string | null;
  body_style: string | null;

  // Content
  description: string | null;
  condition_report: string | null;
  provenance: string | null;
  history: string | null;
  literature: string | null;

  // Images
  image_urls: string[];  // 30-80+ images

  // Metadata
  vehicle_id?: string;
  scrape_source: 'firecrawl';
  scrape_cost_cents: number;
}
```

## Database Tables

### vehicles
Core vehicle record with:
- VIN/chassis number
- Year/make/model
- Sale price (total_price = hammer + premium)
- Mileage, colors, transmission, engine
- Description and condition

### external_listings
Platform-specific tracking:
- `platform: 'bonhams'`
- `listing_url_key` for deduplication
- Lot number, sale ID
- Estimate range (low/high)
- Hammer price, buyer's premium, total price
- Multi-currency metadata

### vehicle_images
All gallery images:
- `source: 'bonhams_import'`
- `position` for ordering
- `is_external: true`

### timeline_events
Historical auction events:
- `event_type: 'auction_sold'` or `'auction_listed'`
- Sale date, lot number
- Hammer price breakdown

## Buyer's Premium Calculation

Bonhams uses a 3-tier structure (2024 rates):

| Hammer Price Range | Premium Rate |
|--------------------|--------------|
| £0 - £500,000 | 27.5% |
| £500,001 - £1,000,000 | 21% |
| Above £1,000,000 | 15% |

Example:
- Hammer: £750,000
- Premium: (£500k × 27.5%) + (£250k × 21%) = £137,500 + £52,500 = £190,000
- Total: £940,000

## Cost Tracking

Bonhams requires JavaScript rendering, so Firecrawl is mandatory:
- **Cost per extraction**: ~$0.01 (1 cent)
- All costs logged to `api_usage_logs` table
- Provider: `'firecrawl'`
- Function name: `'extract-bonhams'`

## Image Extraction

Bonhams provides extensive galleries (30-80+ images per lot):
- High-resolution CDN URLs
- Original/full-size versions (resize params stripped)
- Multiple patterns: `<img>`, `data-src`, `background-image`, JSON
- Deduplication before save

## Error Handling

- **Invalid URL**: Returns 400 if not bonhams.com
- **Firecrawl failure**: Returns 500 with error message
- **Missing data**: Logs warning, continues with partial extraction
- **DB errors**: Throws error, rolls back transaction

## Development

### Local Testing
```bash
cd /Users/skylar/nuke
dotenvx run -- deno run --allow-all supabase/functions/extract-bonhams/index.ts
```

### Deploy
```bash
supabase functions deploy extract-bonhams --no-verify-jwt
```

### Logs
```bash
supabase functions logs extract-bonhams --project-ref qkgaybvrernstplzjaam
```

## Integration Examples

### Frontend (React)
```typescript
const extractBonhams = async (url: string) => {
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/extract-bonhams`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseAnonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url, save_to_db: true }),
    }
  );
  return response.json();
};
```

### Bulk Import Script
```bash
#!/bin/bash
for url in $(cat bonhams_urls.txt); do
  curl -X POST "$VITE_SUPABASE_URL/functions/v1/extract-bonhams" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"url\": \"$url\", \"save_to_db\": true}"
  sleep 2  # Rate limiting
done
```

## Related Functions

- `extract-cars-and-bids-core` - Cars & Bids extraction
- `bat-simple-extract` - Bring a Trailer extraction
- `extract-hagerty-listing` - Hagerty Marketplace extraction
- `import-pcarmarket-listing` - PCarMarket extraction

## Roadmap

- [ ] Catalog page scraping (extract all lots from sale)
- [ ] Department page discovery (find new sales)
- [ ] Live bidding status tracking
- [ ] Currency conversion to USD
- [ ] Seller/buyer identity extraction
- [ ] Comparison with Bonhams price archives
