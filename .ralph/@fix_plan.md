# Fix Plan - CARS & BIDS EXTRACTION (URGENT)

## THE PROBLEM

C&B vehicles are missing VIN and mileage:
```
1984 Chevrolet Corvette Coupe: VIN=✗ Miles=✗
2022 Maserati Mc20 Coupe: VIN=✗ Miles=✗
2018 Ferrari 488 Spider: VIN=✗ Miles=✗
```

**Root cause:** C&B blocks direct fetch (HTTP 403). Must use Firecrawl.

## PRIORITY 1: FIX C&B VIN/MILEAGE EXTRACTION

- [ ] **Update process-import-queue to handle C&B specially**
  - Detect `carsandbids.com` URLs
  - Use Firecrawl (not direct fetch) for C&B
  - Parse `__NEXT_DATA__` JSON for vehicle data

- [ ] **Extract these fields from __NEXT_DATA__**
  ```javascript
  const auction = nextData?.props?.pageProps?.auction
  // Fields to extract:
  auction.vin           // VIN
  auction.mileage       // Mileage
  auction.title         // Title
  auction.images        // Images array
  auction.engine        // Engine
  auction.transmission  // Transmission
  auction.color         // Color
  auction.location      // Location
  ```

- [ ] **Test on 5 C&B vehicles**
  - Verify VIN extracted
  - Verify mileage extracted
  - Verify images linked

## TECHNICAL DETAILS

**File to modify:** `supabase/functions/process-import-queue/index.ts`

**Add C&B detection:**
```typescript
function isCarsAndBidsUrl(url: string): boolean {
  return url.includes('carsandbids.com');
}
```

**Add __NEXT_DATA__ extraction:**
```typescript
function extractFromNextData(html: string) {
  const match = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  const data = JSON.parse(match[1]);
  const auction = data?.props?.pageProps?.auction;
  return {
    vin: auction?.vin,
    mileage: auction?.mileage,
    title: auction?.title,
    images: auction?.images || [],
    engine: auction?.engine,
    transmission: auction?.transmission,
    color: auction?.color,
    location: auction?.location,
  };
}
```

**For C&B URLs, always use Firecrawl:**
```typescript
if (isCarsAndBidsUrl(url)) {
  // Direct fetch returns 403 - must use Firecrawl
  const result = await firecrawlScrape({ url, formats: ['html'] });
  const extracted = extractFromNextData(result.data.html);
  // Use extracted data...
}
```

## VALIDATION

After fixing, run:
```bash
npx tsx scripts/ralph-status-check.ts
```

**Success criteria:**
- C&B vehicles show VIN=✓
- C&B vehicles show Miles=✓

## DO NOT DO

- ❌ Create new extraction functions
- ❌ Try direct fetch for C&B (always 403)
- ❌ Work on anything else until C&B fixed
