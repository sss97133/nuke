# Skeleton Vehicle Enrichment Playbook

**Created:** 2026-03-26
**Purpose:** Document exactly what data each source provides and how to extract it, before running bulk enrichment on ~91K skeleton vehicles.

---

## Executive Summary

| Source | Skeletons | Structured Data | Access Method | Fields Available | Difficulty |
|--------|-----------|-----------------|---------------|-----------------|------------|
| Classic Driver | 50,528 | dataLayer JSON + HTML fields | Direct curl | 12-15 fields | Easy |
| ClassicCars.com | 33,894 | Schema.org JSON-LD `@type: car` | Direct curl | 10-12 fields | Easy |
| The Market (Bonhams) | 5,154 | SSR HTML (Nuxt.js) | Direct curl | 15-20 fields | Medium |
| ER Classics | 1,763 | Magento li.label/data + dataLayer | Direct curl | 4-6 fields | Easy but sparse |
| **Total** | **91,339** | | | | |

**Key finding:** All four sources serve data via direct HTTP -- no Firecrawl or Playwright needed. ClassicCars.com has the richest structured data (Schema.org JSON-LD with full Car type). The Market has the richest content but requires HTML parsing. ER Classics has the least structured data (most vehicles are sold, minimal specs retained).

---

## Source 1: Classic Driver (50,528 skeletons)

### URL Pattern
```
https://www.classicdriver.com/en/car/{make}/{model}/{year}/{entity_id}
```

### Access Method
**Direct curl with browser UA.** No anti-bot protection detected. Pages are Drupal-rendered server-side HTML.

```bash
curl -s -L -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" "$URL"
```

### Available Structured Data

**1. dataLayer (JavaScript object, top of page)**
```json
{
  "entityType": "node",
  "entityBundle": "car",
  "entityId": "879037",
  "entityLabel": "1999 Nissan Cima - (FGY-33)",
  "entityName": "BHAuction",
  "entityUid": "146331",
  "entityCreated": "1639043525",
  "Publish Date": "2021.12.09",
  "Auction": "BH Auction - Collection Car Auction",
  "Seller Type": "auction_house"
}
```
Parse with: `dataLayer\s*=\s*\[({.*?})\]`

**2. dataLayer.push ecommerce (separate push call)**
```json
{
  "ecommerce": {
    "detail": {
      "products": [{
        "name": "1999 Nissan Cima - (FGY-33)",
        "id": "879037",
        "price": 0,
        "brand": "BINGO",
        "category": "Car",
        "label": "car/Nissan/Cima/1999",
        "variant": "JP"
      }]
    },
    "currencyCode": "EUR"
  }
}
```
Parse with: `dataLayer\.push\(({.*?ecommerce.*?})\)`

**3. HTML field-label / field-item pairs (in page body)**
Spec fields are in divs with `class="field-label"` and `class="field-item"`. The exact structure mixes labels and values in a stream. Best approach: regex for labeled values.

### Extractable Fields

| Vehicle Column | Source Location | Reliability | Notes |
|---------------|----------------|-------------|-------|
| `year` | dataLayer label, HTML field | HIGH | Always present |
| `make` | dataLayer label path | HIGH | In `label: "car/Nissan/Cima/1999"` |
| `model` | dataLayer `entityTaxonomy.make_and_model` | HIGH | |
| `sale_price` | ecommerce `products[0].price` | MEDIUM | 0 = "Price on Request" |
| `currency` | ecommerce `currencyCode` | HIGH | Usually EUR |
| `mileage` | HTML "Mileage" field | MEDIUM | Format: "4 423 km / 2 749 mi" -- needs parsing |
| `exterior_color` | HTML "Exterior colour" field | MEDIUM | Present when listed |
| `interior_color` | HTML "Interior colour" field | MEDIUM | Present when listed |
| `transmission` | HTML "Gearbox" field | MEDIUM | "Automatic", "Manual" |
| `body_type` | HTML "Car type" field | MEDIUM | "Saloon", "Coupe", "Convertible" |
| `description` | HTML description div | HIGH | Rich text, usually 200-500 words |
| `drive_side` | HTML "Drive" field | MEDIUM | "LHD", "RHD" |
| `condition` | HTML "Condition" field | MEDIUM | "Used", "Restored", etc. |
| `location` | HTML near dealer info | MEDIUM | City/country |
| `seller_name` | ecommerce `brand` or HTML dealer | HIGH | Dealer/auction house name |
| `chassis_number` | HTML "Chassis number" field | LOW | Only for some listings |
| `lot_number` | HTML "Lot number" field | MEDIUM | For auction listings |
| `images` | CDN URLs in `<img>` srcset | HIGH | Pattern: `classicdriver.com/cdn-cgi/image/...` |

### Quality Notes
- **Price:** Many listings show `price: 0` meaning "Price on Request" -- do NOT write 0 as sale_price
- **Mileage:** Uses non-breaking spaces as thousands separator ("4 423 km") -- strip `\xa0` and `&nbsp;`
- **Images:** Use Cloudflare Image Resizing CDN. Base image path extractable from srcset: `sites/default/files/cars_images/{uid}/{car_folder}/{filename}.jpeg`
- **Description:** Always present and substantive. Often includes history, provenance, condition notes
- **Seller type:** Mix of dealers, auction houses, private sellers. Available in dataLayer `Seller Type`
- **Auction context:** When from an auction, the auction name is in dataLayer `Auction` field

### Parser Strategy
```
1. Fetch HTML
2. Extract dataLayer JSON (entity metadata + ecommerce pricing)
3. Regex-extract field-label/field-item pairs for specs
4. Extract description from the large text block after specs
5. Extract image URLs from srcset attributes
6. Map to vehicle columns
```

### Rate Limits / Anti-Bot
- No Cloudflare challenge detected
- No CAPTCHA
- Standard politeness: 1 req/sec should be fine
- CDN-cached pages, fast response

### Sample Extracted Record
```json
{
  "source_id": "879037",
  "url": "https://www.classicdriver.com/en/car/nissan/cima/1999/879037",
  "year": 1999,
  "make": "Nissan",
  "model": "Cima",
  "variant": "FGY-33",
  "mileage": 4423,
  "mileage_unit": "km",
  "body_type": "Saloon",
  "exterior_color": "Silver",
  "interior_color": "Grey",
  "transmission": "Automatic",
  "drive_side": "RHD",
  "condition": "Used",
  "engine": "4.1L V8 (270 hp)",
  "sale_price": null,
  "currency": "EUR",
  "description": "The FGY-33 is the third generation of the Cima that Nissan first unveiled in 1996...",
  "seller_name": "BINGO",
  "seller_type": "auction_house",
  "location": "Chiyoda-ku, Tokyo, Japan",
  "lot_number": "18",
  "auction_name": "BH Auction - Collection Car Auction - Collection No. 7 - December 2021",
  "image_count": 27,
  "images": ["https://www.classicdriver.com/cdn-cgi/image/format=auto,fit=cover,width=1920,height=1029/sites/default/files/..."]
}
```

---

## Source 2: ClassicCars.com (33,894 skeletons)

### URL Pattern
```
https://classiccars.com/listings/view/{listing_id}/{year}-{make}-{model}-for-sale-in-{city}-{state}-{zip}
```

### Access Method
**Direct curl with browser UA.** Returns full server-rendered HTML. Note: WebFetch (headless browser) returns 403, but curl works fine.

```bash
curl -s -L -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" "$URL"
```

### Available Structured Data

**1. Schema.org JSON-LD `@type: "car"` (BEST SOURCE)**
Embedded in `<script type="application/ld+json">` tag. Full Schema.org Car type with all key fields:

```json
{
  "@context": "https://schema.org",
  "@type": "car",
  "productID": "CC-1990675",
  "mpn": "1990675",
  "name": "1979 Ford Ranchero",
  "brand": "Ford",
  "model": "Ranchero",
  "description": "1979 Ford Ranchero Rebuilt inside and out...",
  "productionDate": "1979",
  "bodyType": "",
  "vehicleIdentificationNumber": "AMS38064",
  "color": "Custom",
  "vehicleInteriorColor": "",
  "sku": "378547",
  "image": "System.Collections.Generic.List`1[ClassicCars.Entity.ListingImage]",
  "url": "https://classiccars.com/listings/view/...",
  "offers": {
    "@type": "offer",
    "priceCurrency": "USC",
    "price": "33995.0000"
  },
  "mileageFromOdometer": {
    "@type": "QuantitativeValue",
    "value": "120000",
    "unitCode": "Miles"
  }
}
```

**2. HTML data-listing-* attributes**
```html
data-listing-year="1979"
data-listing-make="Ford"
data-listing-model="Ranchero"
data-listing-formatted-price="$33,995"
data-listing-id="1990675"
```

**3. HTML data-jumbo attributes (image gallery)**
```html
data-jumbo="https://photos.classiccars.com/cc-temp/listing/199/675/54831447-1979-ford-ranchero-std.jpg"
```

**4. OG Meta Tags**
```
og:title: For Sale: 1979 Ford Ranchero in Cadillac, Michigan
og:description: Custom 1979 Ford Ranchero for sale located in Cadillac, Michigan - $33,995
og:image: https://photos.classiccars.com/cc-temp/listing/199/675/54831447-1979-ford-ranchero-std.jpg
```

### Extractable Fields

| Vehicle Column | Source Location | Reliability | Notes |
|---------------|----------------|-------------|-------|
| `year` | JSON-LD `productionDate` | HIGH | Always present |
| `make` | JSON-LD `brand` | HIGH | Always present |
| `model` | JSON-LD `model` | HIGH | Always present |
| `sale_price` | JSON-LD `offers.price` | HIGH | Decimal string like "33995.0000" |
| `currency` | JSON-LD `offers.priceCurrency` | HIGH | "USC" (USD) |
| `vin` | JSON-LD `vehicleIdentificationNumber` | MEDIUM | Often short/partial (not full 17-char VIN) |
| `mileage` | JSON-LD `mileageFromOdometer.value` | MEDIUM | "0" may mean unknown, not zero |
| `exterior_color` | JSON-LD `color` | MEDIUM | Sometimes "Custom" or empty |
| `interior_color` | JSON-LD `vehicleInteriorColor` | LOW | Often empty string |
| `body_type` | JSON-LD `bodyType` | LOW | Often empty string |
| `description` | JSON-LD `description` | HIGH | Full listing description, ~100-500 words |
| `location` | URL slug or OG description | HIGH | City, State in URL pattern |
| `images` | `data-jumbo` attributes | HIGH | 5-20 high-res JPGs per listing |

### Quality Notes
- **VIN field:** Contains the VIN but many are short identifiers, not full 17-character VINs. Example: "AMS38064" (8 chars). Validate length before writing to `vin` column
- **Price:** Always numeric. "USC" appears to be their code for USD. Reliable
- **Mileage:** "0" may mean "not reported" rather than literally zero miles. Cross-reference with description text
- **Description:** Contains the full seller description. Sometimes includes structured data embedded in natural language: "cylinders: 8 cylinders drive: rwd fuel: gas odometer: 120000"
- **Image bug:** JSON-LD `image` field contains a .NET serialization artifact: `"System.Collections.Generic.List\`1[ClassicCars.Entity.ListingImage]"` -- DO NOT USE. Use `data-jumbo` attributes instead
- **Body type:** Almost always empty in JSON-LD. Could be extracted from description with AI
- **Interior color:** Almost always empty in JSON-LD

### Parser Strategy
```
1. Fetch HTML
2. Find <script type="application/ld+json"> containing @type: "car"
3. Parse JSON -- this gives year, make, model, price, VIN, mileage, color, description
4. Extract data-jumbo attributes for image URLs
5. Extract location from URL slug: /{year}-{make}-{model}-for-sale-in-{city}-{state}-{zip}
6. Validate VIN length (only write if 17 chars)
7. Validate mileage (skip if "0" unless description confirms)
```

### Rate Limits / Anti-Bot
- Returns 403 to some automated tools (WebFetch blocked)
- Direct curl with Chrome UA works fine
- reCAPTCHA present on contact forms but not page loads
- Recommend: 1-2 req/sec with browser UA

### Sample Extracted Record
```json
{
  "source_id": "CC-1990192",
  "url": "https://classiccars.com/listings/view/1990192/1972-dodge-demon-for-sale-in-cadillac-michigan-49601",
  "year": 1972,
  "make": "Dodge",
  "model": "Demon",
  "sale_price": 28995,
  "currency": "USD",
  "vin": "AMB0998",
  "vin_valid": false,
  "mileage": 0,
  "mileage_note": "0 likely means unreported for drag car",
  "exterior_color": "Blue",
  "interior_color": null,
  "body_type": null,
  "description": "1972 DODGE DEMON BUILT FOR THE DRAGSTRIP CAN BE MADE STREET WITH A LITTLE WORK...",
  "location_city": "Cadillac",
  "location_state": "Michigan",
  "location_zip": "49601",
  "image_count": 18,
  "images": ["https://photos.classiccars.com/cc-temp/listing/199/192/54824588-1972-dodge-demon-std.jpg", "..."]
}
```

---

## Source 3: The Market by Bonhams (5,154 skeletons)

### URL Pattern
```
https://themarket.co.uk/en/listings/{make}/{model}/{uuid}
```

### Access Method
**Direct curl with browser UA.** The site is a Nuxt.js (Vue SSR) app. Pages are server-side rendered -- the full HTML body contains all vehicle text. No JavaScript execution needed for basic data extraction.

```bash
curl -s -L -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" "$URL"
```

### Available Structured Data

**1. SSR HTML Body (primary data source)**
The full page content is rendered server-side. Vehicle specs and description are in the HTML body as text nodes. The structure is:

```
Title: "1961 Daimler SP250"
Bid count: "24 Bids"
Sale status: "Vehicle sold"
Sold price: "Sold for £27,100 (inc. Buyer's Premium)"
Estimate: "£27,000 - £32,000" (in description text)
Description: Multiple paragraphs (Background, Overview, Exterior, Interior, Mechanical, History, Summary)
Specs: Fuel type, Vehicle location, Registration, Chassis/VIN, Mileage
```

**2. `window.__NUXT__` Config (metadata only)**
Contains API URL, public keys, and app config. NOT listing data. The access token `zofLzhMgDXeT3nv3` is a Storyblok CMS token, not the listing API token.

**3. OG Meta Tags**
```
og:title: "1961 Daimler SP250  For Sale by Auction"
og:description: "Built in 1961, 'DMY 160A' is a B-Spec Daimler SP250 Dart..."
og:image: "https://cdn.themarket.co.uk/{uuid}/{image_uuid}.jpg?optimizer=image&..."
og:url: "https://themarket.co.uk//en/listings/daimler/sp250/{uuid}"
```

**4. API (requires authentication)**
Base URL: `https://api.themarket.net/`
The public access token does NOT work for listing endpoints (returns 406 Unauthorized). The API is for authenticated app users only.

### Extractable Fields

| Vehicle Column | Source Location | Reliability | Notes |
|---------------|----------------|-------------|-------|
| `year` | og:title, body text | HIGH | In title pattern: "{year} {make} {model}" |
| `make` | URL path, og:title | HIGH | |
| `model` | URL path, og:title | HIGH | |
| `sale_price` | Body text "Sold for £X" | HIGH | Includes buyer's premium |
| `currency` | Body text (£/EUR/$) | HIGH | Usually GBP |
| `estimate_low` | Description text | MEDIUM | "£27,000 - £32,000" |
| `estimate_high` | Description text | MEDIUM | |
| `bid_count` | Body text "24 Bids" | HIGH | |
| `description` | Body text (multiple sections) | HIGH | Very rich: 500-2000 words, sectioned |
| `mileage` | Body text near specs | MEDIUM | "65,232 miles" or "378km" |
| `registration` | Body text | MEDIUM | UK reg number like "DMY 160A" |
| `chassis_number` | Body text | MEDIUM | When provided |
| `exterior_color` | Description text | MEDIUM | Mentioned in description, not structured |
| `interior_color` | Description text | MEDIUM | Mentioned in description, not structured |
| `engine` | Description "Mechanical" section | HIGH | Very detailed |
| `transmission` | Body text near specs | MEDIUM | |
| `location` | Body text "Vehicle location" | HIGH | "Leicester, United Kingdom" |
| `seller_type` | Body text "Private: {username}" | HIGH | "Private" or "Trade" |
| `seller_name` | Body text after "Seller" | HIGH | Username |
| `sale_status` | Body text | HIGH | "Vehicle sold" or auction timing |
| `images` | og:image, CDN URLs | HIGH | Pattern: `cdn.themarket.co.uk/{listing_uuid}/{image_uuid}.jpg` |

### Quality Notes
- **Richest descriptions of any source.** Organized into sections: Background, Overview, Exterior, Interior, Mechanical, History, Summary. Professional editorial quality
- **Auction data:** Includes final hammer price with buyer's premium, bid count, estimate range, reserve status
- **No JSON-LD or Schema.org markup.** All data must be extracted from rendered HTML text
- **Sold listings:** All 5,154 skeletons appear to be completed auctions. This means sold prices are available
- **Color extraction:** Colors are mentioned narratively in descriptions ("finished in Jaguar Opalescent Grey") rather than in structured fields. AI extraction recommended for color
- **Duplicated content:** The page renders the description twice (once in the main view, once in an expanded section). Deduplicate during extraction
- **Mixed vehicles and motorcycles.** The Triumph Tiger 100 sample is a motorcycle, not a car. Filter or tag appropriately
- **Image CDN:** `cdn.themarket.co.uk/{listing_uuid}/{image_uuid}.jpg` with optimizer params for sizing

### Parser Strategy
```
1. Fetch HTML
2. Extract og:title for year/make/model
3. Strip <script> and <style> tags from body
4. Extract text lines from body HTML
5. Parse structured sections:
   - "Sold for £X" -> sale_price
   - "N Bids" -> bid_count
   - "Vehicle location" -> next line is location
   - "Seller" -> "Private: username" or similar
6. Extract full description text (Background through Summary sections)
7. For color, engine, mileage: either regex from description or use AI
8. Extract images from og:image and CDN URL patterns
```

**AI-assisted extraction recommended** for fields embedded in narrative text (color, engine, VIN/chassis).

### Rate Limits / Anti-Bot
- No CAPTCHA on page loads
- Nuxt SSR serves full HTML
- Google reCAPTCHA v3 present but passive (no challenge)
- Pusher.js for real-time bidding (not relevant for sold listings)
- Recommend: 1 req/sec

### Sample Extracted Record
```json
{
  "source_id": "eab4d43e-34fa-4684-80d8-7debf592855a",
  "url": "https://themarket.co.uk/en/listings/daimler/sp250/eab4d43e-34fa-4684-80d8-7debf592855a",
  "year": 1961,
  "make": "Daimler",
  "model": "SP250",
  "sale_price": 27100,
  "currency": "GBP",
  "price_includes_premium": true,
  "estimate_low": 27000,
  "estimate_high": 32000,
  "bid_count": 24,
  "mileage": 65232,
  "mileage_unit": "miles",
  "registration": "DMY 160A",
  "chassis_number": "102683",
  "exterior_color": "Jaguar Opalescent Grey",
  "interior_color": "Oxblood leather",
  "engine": "2.5-litre V8 (2548cc), 140 bhp",
  "transmission": "Automatic",
  "body_type": "Sports car",
  "drive_side": "RHD",
  "location": "Bonhams|Cars Online HQ, United Kingdom",
  "seller_type": "consignment",
  "seller_name": "Fraser Jackson",
  "description": "Built in 1961, 'DMY 160A' is a B-Spec Daimler SP250 Dart...",
  "description_sections": ["Background", "Overview", "Exterior", "Interior", "Mechanical", "History", "Summary"],
  "image_count": 350,
  "images": ["https://cdn.themarket.co.uk/eab4d43e-34fa-4684-80d8-7debf592855a/036a3af2-4018-43d5-94e7-18f6247fa29e.jpg"]
}
```

---

## Source 4: ER Classics (1,763 skeletons)

### URL Pattern
```
https://www.erclassics.com/{make}-{year}-{sku}/
```

### Access Method
**Direct curl with browser UA.** Magento e-commerce platform. Server-rendered HTML.

```bash
curl -s -L -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" "$URL"
```

### Available Structured Data

**1. Magento `li > span.label / span.data` Pairs (BEST SOURCE)**
```html
<li><span class="label">Ref. nr.:</span> <span class="data">1250</span></li>
<li><span class="label">Make:</span> <span class="data">SOLD</span></li>
<li><span class="label">Model:</span> <span class="data">MG</span></li>
<li><span class="label">Year:</span> <span class="data">1971</span></li>
```
Parse with: `<span class="label">([^<]+)</span>\s*<span class="data">([^<]+)</span>`

**WARNING:** The "Make" field contains "SOLD" when the car is sold, not the actual make. The real make is in the URL slug or page title.

**2. dataLayer.push ecommerce**
```json
{
  "ecommerce": {
    "detail": {
      "products": [{
        "id": "2540",
        "name": "MG 1971",
        "sku": "1250",
        "price": "0.00"
      }]
    }
  }
}
```

**3. JSON-LD (Store/Organization only)**
Four JSON-LD blocks present, but ALL are about the dealer (E&R Classics), NOT the vehicle:
- BreadcrumbList
- WebSite
- Organization (contact info)
- Store (address, hours, geo coords)

No `@type: Car` or `@type: Product` JSON-LD.

**4. Description in `div.std`**
Full description text including specs mentioned narratively.

### Extractable Fields

| Vehicle Column | Source Location | Reliability | Notes |
|---------------|----------------|-------------|-------|
| `year` | li span.data for "Year:" | HIGH | Always present |
| `make` | URL slug, page title, dataLayer name | HIGH | NOT from span.data (shows "SOLD") |
| `model` | li span.data for "Model:" | MEDIUM | Sometimes shows make instead of model |
| `sku` | li span.data for "Ref. nr.:" | HIGH | E&R internal ref number |
| `sale_price` | dataLayer `price` | LOW | Always "0.00" for sold items |
| `description` | div.std content | HIGH | Includes specs in narrative form |
| `exterior_color` | Description text | MEDIUM | "British Racing Green" |
| `engine` | Description text | MEDIUM | "1798 cc engine with 96 hp" |
| `transmission` | Description text | LOW | "manual gearbox" |
| `mileage` | Description text | LOW | "50 km after restoration" |
| `condition` | Description text | MEDIUM | "body off restored" |
| `title_origin` | Description text | MEDIUM | "USA title", "Romanian title" |
| `images` | b-cdn.net URLs | HIGH | 60-150 photos per listing |

### Quality Notes
- **Most vehicles are sold.** All 1,763 skeletons show as SOLD. Prices are not retained (always 0.00)
- **Make/Model confusion:** The `span.data` for "Make:" shows "SOLD" instead of the actual make. Must extract make from URL slug or `dataLayer.products[0].name`
- **Very sparse structured data.** Only 4 fields in the spec list (ref, make/SOLD, model, year). Everything else must come from description text
- **Description quality varies.** Some have detailed specs ("1798 cc engine with 96 hp and manual gearbox"), others just say "very good condition"
- **Sold description overlay:** The description often starts with "*** THIS CAR HAS BEEN SOLD ***" boilerplate. Strip this prefix
- **Image CDN:** Uses BunnyCDN: `erclassics.b-cdn.net/media/catalog/product/cache/2/{size}/...`. Multiple size variants available: `thumbnail/335x224`, `image/700x`, `thumbnail/1920x`
- **Single dealer:** All vehicles are from E&R Classics in Waalwijk, Netherlands
- **Import documentation:** Many listings note "USA title and document importduties for every EU country are paid by us" -- useful for provenance

### Parser Strategy
```
1. Fetch HTML
2. Extract li span.label/span.data pairs for year, model, sku
3. Extract make from URL slug: erclassics.com/{make}-{year}-{sku}/
4. Extract description from div.std (strip "THIS CAR HAS BEEN SOLD" prefix)
5. Extract image URLs from b-cdn.net pattern
6. For engine, color, mileage: regex from description or AI
7. Note: No price data available for sold items
```

### Rate Limits / Anti-Bot
- Google reCAPTCHA present but not on page loads
- Magento standard protections
- Recommend: 1 req/sec

### Sample Extracted Record
```json
{
  "source_id": "1250",
  "url": "https://www.erclassics.com/mg-1971-1250/",
  "year": 1971,
  "make": "MG",
  "model": "MGB Cabriolet",
  "sale_price": null,
  "sale_status": "sold",
  "exterior_color": "British Racing Green",
  "engine": "1798 cc, 96 hp",
  "transmission": "Manual",
  "mileage": 50,
  "mileage_unit": "km",
  "mileage_note": "after restoration",
  "condition": "Body off restored",
  "description": "MGB Cabriolet 1971 body off restored as new...",
  "title_origin": "USA",
  "seller_name": "E&R Classics",
  "location": "Waalwijk, Netherlands",
  "image_count": 157,
  "images": ["https://erclassics.b-cdn.net/media/catalog/product/cache/2/image/700x/17f82f742ffe127f42dca9de82fb58b1/b/c/bcar_1250.jpg"]
}
```

---

## Extraction Priority & Approach

### Recommended Processing Order

| Priority | Source | Count | Method | Est. Time | Value |
|----------|--------|-------|--------|-----------|-------|
| 1 | ClassicCars.com | 33,894 | JSON-LD parse only | 6-8 hrs @ 2/sec | HIGH -- richest structured data |
| 2 | Classic Driver | 50,528 | dataLayer + HTML parse | 10-14 hrs @ 1/sec | HIGH -- most vehicles, good specs |
| 3 | The Market (Bonhams) | 5,154 | HTML text parse + AI | 4-6 hrs @ 1/sec | HIGH -- richest descriptions, sold prices |
| 4 | ER Classics | 1,763 | HTML parse + AI | 1-2 hrs @ 1/sec | MEDIUM -- sparse data, no prices |

### Implementation Plan

**Phase 1: ClassicCars.com (no AI needed)**
- Parse JSON-LD `@type: car` for all structured fields
- Extract `data-jumbo` for images
- Parse location from URL slug
- Pure regex, no LLM cost
- Fields filled: year, make, model, price, VIN (partial), mileage, color, description

**Phase 2: Classic Driver (no AI needed)**
- Parse dataLayer for entity metadata and pricing
- Regex-extract HTML field-label/field-item pairs
- Extract description block
- Pure regex, no LLM cost
- Fields filled: year, make, model, mileage, color, transmission, body_type, drive_side, condition, description, seller

**Phase 3: The Market by Bonhams (AI for some fields)**
- Parse og:title for year/make/model
- Regex for sale_price, bid_count, location, seller
- AI extraction for: color, engine, chassis from narrative text
- Fields filled: year, make, model, sale_price, bid_count, estimate, mileage, description, and AI-extracted specs

**Phase 4: ER Classics (AI for most fields)**
- Parse li.label/data for year, model, sku
- Extract make from URL
- AI extraction for: color, engine, transmission, mileage from description
- Fields filled: year, make, model, description, and AI-extracted specs

### Cost Estimate

| Source | Method | LLM Cost | Compute Time |
|--------|--------|----------|-------------|
| ClassicCars.com | Pure regex | $0 | ~8 hrs |
| Classic Driver | Pure regex | $0 | ~14 hrs |
| The Market | Regex + AI for 5K descriptions | ~$5-10 | ~6 hrs |
| ER Classics | Regex + AI for 1.7K descriptions | ~$2-4 | ~2 hrs |
| **Total** | | **~$7-14** | **~30 hrs** |

---

## Common Pitfalls

1. **Do not write price=0.** Both Classic Driver and ER Classics use 0 to mean "Price on Request" or "Sold, no price retained"
2. **Do not trust ClassicCars.com VINs at face value.** Many are short identifiers (8 chars), not valid 17-char VINs
3. **Do not trust ER Classics "Make" field.** It shows "SOLD" for sold vehicles
4. **Do not store ClassicCars.com JSON-LD `image` field.** It contains a .NET serialization bug
5. **Do not double-count The Market descriptions.** The page renders the same text twice
6. **Mileage value "0" needs validation.** Cross-reference with description text before writing
7. **The Market includes motorcycles.** Not all 5,154 are cars -- filter or tag vehicle_type
8. **ER Classics descriptions start with sold boilerplate.** Strip "*** THIS CAR HAS BEEN SOLD ***" prefix

---

## Appendix: Existing Extractors to Check

Before building new parsers, check if any existing edge functions already handle these sources:

```bash
ls /Users/skylar/nuke/supabase/functions/ | grep -i -E "classic|market|bonhams|erclass"
```

Also check `TOOLS.md` and `observation_extractors` table for registered extractors.
