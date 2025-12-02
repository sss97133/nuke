# ClassicCars.com Import System

## Overview
Complete system for importing vehicle listings from ClassicCars.com with automatic image analysis and condition scoring.

## Components

### 1. URL Parser (`nuke_frontend/src/services/listingURLParser.ts`)
- Added `classiccars` as a supported source
- New `parseClassicCarsListing()` method that extracts:
  - Vehicle details (year, make, model, VIN, mileage)
  - Colors (exterior, interior)
  - Transmission, drivetrain, engine
  - Title status, convertible status
  - Location
  - Seller information (name, phone, email, address)
  - All listing images
  - Description

### 2. Scraper Edge Function (`supabase/functions/scrape-vehicle/index.ts`)
- Added `scrapeClassicCars()` function
- Extracts structured data from ClassicCars.com HTML
- Returns image URLs and all vehicle/seller data

### 3. Import Edge Function (`supabase/functions/import-classiccars-listing/index.ts`)
Complete import pipeline:
1. **Scrapes listing** using scrape-vehicle function
2. **Finds or creates vehicle** (by VIN or year/make/model)
3. **Downloads all images** from listing
4. **Analyzes images with OpenAI Vision** to generate condition scores
5. **Uploads images** to Supabase storage
6. **Creates vehicle_images records** with analysis metadata
7. **Calculates overall condition score** (average of all image scores)
8. **Creates timeline event** documenting the import

### 4. Frontend Component (`nuke_frontend/src/components/vehicle/ClassicCarsImporter.tsx`)
- Simple UI for pasting ClassicCars.com URLs
- Shows import progress
- Displays results (images processed, condition score)
- Links to imported vehicle profile

## Usage

### From Frontend
```tsx
import { ClassicCarsImporter } from '../components/vehicle/ClassicCarsImporter';

<ClassicCarsImporter 
  onImportComplete={(vehicleId) => {
    // Navigate to vehicle or refresh
  }}
/>
```

### Direct API Call
```typescript
const { data, error } = await supabase.functions.invoke('import-classiccars-listing', {
  body: {
    url: 'https://classiccars.com/listings/view/1985175/...',
    userId: user.id
  }
});
```

## Features

### Image Analysis
- Downloads all images from listing (up to 20 for performance)
- Analyzes each image with GPT-4 Vision API
- Generates condition score (1-10) for each image
- Calculates overall vehicle condition score
- Stores analysis results in image metadata

### Data Extraction
- Vehicle specifications
- Seller contact information
- Listing description
- Price information
- All images with metadata

### Smart Matching
- First tries to match by VIN
- Falls back to year/make/model matching
- Updates existing vehicles or creates new ones
- Prevents duplicate imports

## Example

Import the 1977 Chevrolet Blazer:
```
https://classiccars.com/listings/view/1985175/1977-chevrolet-blazer-for-sale-in-sedona-arizona-86325
```

This will:
1. Extract all vehicle data
2. Download all listing images
3. Analyze images for condition
4. Create vehicle profile with condition score
5. Store seller contact information
6. Link everything together

## Condition Scoring

The system analyzes images and provides:
- **Individual image scores** (1-10) based on:
  - Paint quality (rust, scratches, dents)
  - Body panel alignment
  - Overall maintenance appearance
  - Visible wear and tear
- **Overall vehicle score** (average of all image scores)
- **Confidence level** for each analysis

## Database Schema

### Vehicles Table
- Standard vehicle fields
- `discovery_source`: 'classiccars_com'
- `discovery_url`: Original listing URL
- `origin_metadata`: JSON with seller info, listing ID, etc.
- `condition_rating`: Overall score (1-10)

### Vehicle Images Table
- Standard image fields
- `source`: 'classiccars_com'
- `metadata.ai_analysis`: Condition score and analysis
- `metadata.original_url`: Original image URL
- `metadata.classiccars_listing_id`: Listing ID

### Timeline Events
- Event type: 'discovery'
- Source: 'classiccars_com'
- Metadata includes listing URL, seller info, condition score

## Environment Variables

Required:
- `OPENAI_API_KEY`: For image analysis
- `SUPABASE_URL`: Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY`: Service role key for admin operations

## Performance

- Processes up to 20 images per import (to avoid timeouts)
- Images processed in batches of 5
- 1 second delay between batches
- 30 second timeout per image download
- Total import time: ~2-5 minutes for typical listing

## Future Enhancements

- Support for bulk imports (multiple URLs)
- Enhanced image analysis (angle detection, part identification)
- Price analysis and market comparison
- Automatic VIN decoding if available
- Integration with valuation system

