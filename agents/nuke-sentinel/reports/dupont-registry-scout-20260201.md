# DuPont Registry Scout Report

**Date:** 2026-02-01
**Source:** https://www.dupontregistry.com
**Status:** Added to source_registry (pending)
**Recommendation:** HIGH PRIORITY - Build extractor

---

## Executive Summary

DuPont Registry is a premium luxury/exotic car marketplace with excellent data quality and structured data availability. The site specializes in high-end vehicles (Ferrari, Lamborghini, Bugatti, Rolls-Royce, etc.) with approximately 12,000+ active listings.

**Viability Score: 9/10**

---

## Technical Assessment

### Infrastructure
- **Framework:** Next.js (React)
- **CDN:** AWS CloudFront
- **Protection:** AWS WAF with CAPTCHA challenges
- **Data Format:** Server-side rendered with `__NEXT_DATA__` JSON

### Cloudflare/WAF Status
| Test | Result |
|------|--------|
| Raw curl (no UA) | 405 blocked (CAPTCHA) |
| Browser UA | SUCCESS (full page) |
| Direct fetch tool | 405 blocked |
| Sitemap.xml | Accessible |

**Recommendation:** Use Firecrawl or Playwright with proper browser headers.

### Required Headers
```
User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36
Accept: text/html,application/xhtml+xml
```

---

## Data Structure

### Listing URL Pattern
```
https://www.dupontregistry.com/autos/listing/{year}/{make}/{model}/{id}
```

Example:
```
https://www.dupontregistry.com/autos/listing/2024/ferrari/roma--spider/547439
```

### Data Location
All vehicle data is in `__NEXT_DATA__` script tag:
```
props.pageProps.initialState.carState.response
```

### Available Fields

| Field | Path | Example |
|-------|------|---------|
| ID | `id` | 547439 |
| Year | `year` | 2024 |
| VIN | `vin` | "ZFF09RPA5R0303220" |
| Price | `price` | 288995 |
| Mileage | `mileage` | 1417 |
| Make | `carBrand.name` | "Ferrari" |
| Model | `carModel.name` | "Roma Spider" |
| Description | `description` | Full text with options |
| Exterior Color | `exteriorColor.name` | "Red" |
| Interior Color | `interiorColor.name` | "Red" |
| Transmission | `carModification.transmission` | "Automatic" |
| Drivetrain | `carModification.driveTrain` | "Rwd (rear-wheel drive)" |
| Body Style | `carModification.bodyStyle` | "Convertible" |
| Engine | `carModification.engine` | "Volume, L: 3.9, Cylinders: 8" |
| Fuel Type | `carModification.fuelType` | "Gasoline" |
| Dealer Name | `dealer.name` | "Ferrari Quebec" |
| Dealer ID | `dealer.id` | 320 |
| Dealer Phone | `dealer.dealerLocations[0].phone` | "(866) 690-3975" |
| Images | `photos[].image.original` | Full URLs |

### Image Sizes Available
- `width_1920` - Large (1920px)
- `width_916` - Medium-large
- `width_720` - Medium
- `width_480` - Small
- `width_292` - Thumbnail
- `width_110` - Mini thumbnail
- `original` - Full size JPG

---

## Inventory Coverage

### Brand Counts (as of 2026-02-01)

| Brand | Count | Notes |
|-------|-------|-------|
| Ford | 3,150 | Includes GT, Bronco, Mustang |
| Porsche | 1,654 | 911, 935, etc. |
| Ferrari | 1,345 | Full range |
| Mercedes-Benz | 1,213 | AMG, SL, etc. |
| Bentley | 786 | Continental, Bentayga |
| Audi | 676 | R8, RS models |
| Aston Martin | 561 | DB series, Vantage |
| BMW | 542 | M cars |
| Lamborghini | 515 | Huracan, Urus, Aventador |
| Rolls-Royce | 459 | Cullinan, Ghost, Phantom |
| McLaren | 353 | Full range |
| Cadillac | 306 | CT5-V, Escalade |
| Land Rover | 295 | Defender mostly |
| Maserati | 255 | Ghibli, Levante |
| Dodge | 191 | Viper, Hellcat |
| Bugatti | 23 | Chiron, Veyron |

**Total estimated inventory: ~12,000+ vehicles**

---

## Discovery Options

### Sitemaps Available
```
https://www.dupontregistry.com/sitemap.xml
├── listings-active1.xml (active listings)
├── listings-active2.xml
├── listings1.xml through listings13.xml (all listings)
├── autos/make.xml (make index)
├── autos/make_model.xml (model index)
└── autos/make_model_year.xml
```

### Sitemap URL Format
```xml
<url>
  <loc>https://www.dupontregistry.com/autos/listing/2024/ferrari/roma--spider/547439</loc>
  <lastmod>2026-02-01</lastmod>
</url>
```

---

## Quality Assessment

| Metric | Score | Notes |
|--------|-------|-------|
| VIN Availability | HIGH | Available on most listings |
| Image Quality | HIGH | Multiple sizes, high-res originals |
| Price Accuracy | HIGH | Real asking prices |
| Data Completeness | HIGH | Full specs, options, description |
| Dealer Info | HIGH | Name, phone, address, website |
| Update Frequency | DAILY | Sitemap lastmod updated daily |

**Overall Quality Score: 0.90/1.0**

---

## Extraction Strategy

### Recommended Approach

1. **Discovery:** Parse `listings-active1.xml` and `listings-active2.xml` for new URLs
2. **Extraction:**
   - Use Firecrawl with browser UA
   - Parse `__NEXT_DATA__` JSON from HTML
   - Extract `carState.response` object
3. **Mapping:** Direct field mapping to ExtractedVehicle schema

### Sample Extractor Logic
```typescript
// Parse __NEXT_DATA__ from HTML
const match = html.match(/<script id="__NEXT_DATA__"[^>]*>(.+?)<\/script>/);
const data = JSON.parse(match[1]);
const car = data.props.pageProps.initialState.carState.response;

const vehicle: ExtractedVehicle = {
  url: sourceUrl,
  title: `${car.year} ${car.carBrand.name} ${car.carModel.name}`,
  year: car.year,
  make: car.carBrand.name,
  model: car.carModel.name,
  vin: car.vin,
  mileage: car.mileage,
  exterior_color: car.exteriorColor?.name,
  interior_color: car.interiorColor?.name,
  transmission: car.carModification?.transmission,
  engine: car.carModification?.engine,
  sale_price: car.price,
  seller_username: car.dealer?.name,
  image_urls: car.photos?.map(p => p.image.original),
  description: car.description,
};
```

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| WAF blocking | Use Firecrawl/Playwright with browser UA |
| Build ID changes | Extract from page, don't hardcode |
| Rate limiting | Respect robots.txt, add delays |
| CAPTCHA escalation | Monitor success rate, have backup |

---

## Next Steps

1. [x] Add to source_registry (completed)
2. [ ] Build `extract-dupont-registry` edge function
3. [ ] Test with 10 sample listings
4. [ ] Set up sitemap discovery job
5. [ ] Deploy and monitor

---

## Source Registry Entry

```sql
-- Added with this scout report
SELECT * FROM source_registry WHERE slug = 'dupont-registry';

slug:               dupont-registry
display_name:       duPont Registry
category:           marketplace
status:             pending
data_quality_score: 0.90
cloudflare_protected: true
discovery_method:   sitemap
```

---

*Report generated by Nuke Sentinel Scout*
