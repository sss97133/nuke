# Extraction Data Format - Raw Output Examples

## Request Format

```typescript
// Input to extract-with-proof-and-backfill
{
  url: "https://dealer.com/inventory/1985-chevy-k10",
  source_type: "dealer_website",  // Optional
  organization_id: "org-uuid",    // Optional
  skip_proofreading: false,       // Optional, default: false
  skip_re_extraction: false       // Optional, default: false
}
```

---

## Response Format

### Success Response (High Confidence)

```json
{
  "success": true,
  "data": {
    "vin": "1GCHK33K3FE123456",
    "year": 1985,
    "make": "Chevrolet",
    "model": "C/K",
    "series": "K10",
    "trim": "Cheyenne",
    "mileage": 85000,
    "price": 25000,
    "asking_price": 25000,
    "color": "Red",
    "exterior_color": "Red",
    "interior_color": "Black",
    "transmission": "Automatic",
    "drivetrain": "4WD",
    "engine": "350 V8",
    "engine_size": "5.7L",
    "body_style": "Pickup",
    "body_type": "Pickup",
    "title_status": "Clean",
    "description": "1985 Chevy K10 Cheyenne 4x4. Original 350 V8, automatic transmission. 85,000 miles. Clean title. Excellent condition throughout...",
    "images": [
      "https://dealer.com/images/vehicle1.jpg",
      "https://dealer.com/images/vehicle2.jpg"
    ],
    "image_urls": [
      "https://dealer.com/images/vehicle1.jpg",
      "https://dealer.com/images/vehicle2.jpg"
    ],
    "location": "Nashville, TN",
    "seller": "Jordan Motorsports",
    "seller_phone": "(615) 555-0123",
    "seller_email": "sales@jordanmotorsports.com",
    "listing_title": "1985 Chevrolet K10 Cheyenne 4x4",
    "listing_url": "https://dealer.com/inventory/1985-chevy-k10",
    
    // Optional fields (if extracted)
    "bed_length": "SWB",
    "engine_status": null,
    "transmission_status": null,
    "odometer_status": null,
    "modifications": ["Lowered", "Custom wheels"]
  },
  "confidence": 0.92,
  "extraction_method": "firecrawl_schema",
  "missing_fields": [],
  "proofreading_applied": true,
  "re_extraction_applied": false
}
```

### Success Response (Medium Confidence - Missing Some Fields)

```json
{
  "success": true,
  "data": {
    "year": 1985,
    "make": "Chevrolet",
    "model": "C/K",
    "series": "K10",
    "price": 25000,
    "description": "1985 Chevy K10 for sale...",
    "images": ["https://dealer.com/image1.jpg"],
    "listing_url": "https://dealer.com/inventory/1985-chevy-k10",
    
    // Missing critical fields
    "vin": null,
    "mileage": null,
    "color": null,
    "transmission": null,
    "drivetrain": null
  },
  "confidence": 0.65,
  "extraction_method": "llm_extraction",
  "missing_fields": ["vin", "mileage", "color", "transmission", "drivetrain"],
  "proofreading_applied": true,
  "re_extraction_applied": true  // Re-extraction was triggered
}
```

### Success Response (Low Confidence - After Re-extraction)

```json
{
  "success": true,
  "data": {
    "year": 1985,
    "make": "Chevrolet",
    "model": "C/K",
    "series": "K10",
    "price": 25000,
    "mileage": 85000,  // Re-extracted
    "color": "Red",    // Re-extracted
    "transmission": "Automatic",  // Re-extracted
    "description": "1985 Chevy K10...",
    "images": ["https://dealer.com/image1.jpg"],
    "listing_url": "https://dealer.com/inventory/1985-chevy-k10",
    
    // Still missing
    "vin": null
  },
  "confidence": 0.75,
  "extraction_method": "re_extraction",
  "missing_fields": ["vin"],  // Still missing VIN
  "proofreading_applied": true,
  "re_extraction_applied": true
}
```

### Error Response

```json
{
  "success": false,
  "error": "All extraction strategies failed",
  "confidence": 0,
  "extraction_method": "none",
  "missing_fields": [],
  "proofreading_applied": false,
  "re_extraction_applied": false
}
```

---

## Field Descriptions

### Critical Fields (Required for High Confidence)

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `vin` | `string \| null` | 17-character VIN | `"1GCHK33K3FE123456"` |
| `year` | `number \| null` | Model year | `1985` |
| `make` | `string \| null` | Manufacturer (normalized) | `"Chevrolet"` or `"GMC"` |
| `model` | `string \| null` | Model name (normalized) | `"C/K"`, `"Blazer"`, `"Suburban"` |
| `price` | `number \| null` | Price in USD | `25000` |
| `mileage` | `number \| null` | Odometer reading | `85000` |

### Important Optional Fields

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `series` | `string \| null` | Series designation | `"K10"`, `"C20"`, `"K5"` |
| `trim` | `string \| null` | Trim level | `"Cheyenne"`, `"Silverado"` |
| `asking_price` | `number \| null` | Asking price (alias for price) | `25000` |
| `color` | `string \| null` | Exterior color | `"Red"` |
| `exterior_color` | `string \| null` | Exterior color (alias) | `"Red"` |
| `interior_color` | `string \| null` | Interior color | `"Black"` |
| `transmission` | `string \| null` | Transmission type | `"Automatic"`, `"Manual"` |
| `drivetrain` | `string \| null` | Drivetrain type | `"4WD"`, `"2WD"`, `"RWD"` |
| `engine` | `string \| null` | Engine description | `"350 V8"` |
| `engine_size` | `string \| null` | Engine displacement | `"5.7L"` |
| `body_style` | `string \| null` | Body style | `"Pickup"`, `"SUV"` |
| `body_type` | `string \| null` | Body type (alias) | `"Pickup"`, `"SUV"` |
| `title_status` | `string \| null` | Title condition | `"Clean"`, `"Salvage"` |
| `description` | `string \| null` | Full description text | `"1985 Chevy K10..."` |
| `images` | `string[]` | Array of image URLs | `["url1", "url2"]` |
| `image_urls` | `string[]` | Array of image URLs (alias) | `["url1", "url2"]` |
| `location` | `string \| null` | Location (city, state) | `"Nashville, TN"` |
| `seller` | `string \| null` | Seller/dealer name | `"Jordan Motorsports"` |
| `seller_phone` | `string \| null` | Seller phone number | `"(615) 555-0123"` |
| `seller_email` | `string \| null` | Seller email | `"sales@dealer.com"` |
| `listing_title` | `string \| null` | Original listing title | `"1985 Chevrolet K10..."` |
| `listing_url` | `string` | Original listing URL | `"https://..."` |

### Squarebody-Specific Fields

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `bed_length` | `string \| null` | Bed length | `"SWB"` or `"LWB"` |
| `engine_status` | `string \| null` | Engine status | `"No Motor"` or `null` |
| `transmission_status` | `string \| null` | Transmission status | `"No Transmission"` or `null` |
| `odometer_status` | `string \| null` | Odometer status | `"Broken"` or `null` |
| `modifications` | `string[]` | List of modifications | `["Lowered", "Custom wheels"]` |

---

## Metadata Fields

| Field | Type | Description |
|-------|------|-------------|
| `success` | `boolean` | Whether extraction succeeded |
| `confidence` | `number` | Confidence score (0-1) |
| `extraction_method` | `string` | Method used: `"firecrawl_schema"`, `"llm_extraction"`, `"dom_regex"`, `"re_extraction"`, or `"none"` |
| `missing_fields` | `string[]` | Array of critical fields still missing |
| `proofreading_applied` | `boolean` | Whether AI proofreading was applied |
| `re_extraction_applied` | `boolean` | Whether re-extraction was triggered |
| `error` | `string \| undefined` | Error message if failed |

---

## Confidence Score Breakdown

Confidence is calculated based on data completeness:

- **0.9 - 1.0**: High confidence - All critical fields present, most optional fields present
- **0.7 - 0.9**: Medium confidence - Most critical fields present
- **0.5 - 0.7**: Low confidence - Some critical fields missing
- **< 0.5**: Very low confidence - Many critical fields missing

**Critical Fields** (weighted 2x): `vin`, `year`, `make`, `model`, `price`, `mileage`  
**Optional Fields** (weighted 1x): `trim`, `series`, `color`, `transmission`, `drivetrain`, `engine`, `description`

---

## Example: Dealer Inventory Extraction

When extracting dealer inventory (multiple listings), the response format is slightly different:

```json
{
  "success": true,
  "listings": [
    {
      "title": "1985 Chevy K10",
      "url": "https://dealer.com/listing1",
      "price": 25000,
      "year": 1985,
      "make": "Chevrolet",
      "model": "K10",
      "vin": "1GCHK33K3FE123456",
      "mileage": 85000,
      "thumbnail_url": "https://dealer.com/thumb1.jpg"
    },
    {
      "title": "1979 GMC C10",
      "url": "https://dealer.com/listing2",
      "price": 18000,
      "year": 1979,
      "make": "GMC",
      "model": "C10",
      "vin": "1GCCC34K1FE789012",
      "mileage": 120000,
      "thumbnail_url": "https://dealer.com/thumb2.jpg"
    }
  ],
  "dealer_info": {
    "name": "Jordan Motorsports",
    "website": "https://jordanmotorsports.com",
    "phone": "(615) 555-0123",
    "address": "123 Main St",
    "city": "Nashville",
    "state": "TN",
    "zip": "37203"
  },
  "listings_found": 2,
  "squarebody_count": 2
}
```

This format is returned by `scrape-multi-source` for bulk inventory extraction.

---

## Data Normalization

All extracted data is normalized:

- **Make**: `"Chevy"` → `"Chevrolet"`, `"GMC"` → `"GMC"`
- **Model**: `"pickup"` / `"truck"` → `"C/K"`, `"Blazer"` → `"Blazer"`
- **Price**: `"$25,000"` → `25000` (number, no currency symbols)
- **Mileage**: `"85k miles"` → `85000` (number), `"120000 km"` → `74565` (converted to miles)
- **VIN**: Always uppercase, validated format (17 chars, no I/O/Q)

---

## Usage in Your Code

```typescript
const response = await supabase.functions.invoke('extract-with-proof-and-backfill', {
  body: { url: 'https://dealer.com/listing' }
});

if (response.data.success) {
  const vehicleData = response.data.data;
  const confidence = response.data.confidence;
  const missingFields = response.data.missing_fields;
  
  // Use vehicleData to create/update vehicle record
  // Check confidence to determine if manual review needed
  // Use missingFields to know what still needs to be found
}
```

