# Thorough Site Mapping Accountability

## The Real Accountability

**Not just volume. Complete data extraction.**

Every site needs:
1. **Thorough site map** - All page types, all sections, all data points
2. **Complete field mapping** - Every available field mapped to database
3. **Site-specific rules** - Custom extraction logic for each site
4. **Validation** - Verify we're not missing data

**Accountability = We capture EVERYTHING available, not just the obvious fields.**

---

## Site Mapping Requirements

### For Every Source, We Must Map:

#### 1. All Page Types
- Vehicle listing pages
- Browse/search pages
- Dealer profile pages
- User profile pages (if applicable)
- Auction pages (if applicable)
- Category pages
- Filter pages

#### 2. All Data Sections on Each Page
- Header/title section
- Image gallery
- Technical specifications
- Pricing information
- Description/overview
- Features/options
- History/service records
- Seller/dealer information
- Location information
- Auction details (if applicable)
- Bid history (if applicable)
- Comments/reviews (if applicable)
- Related vehicles
- Similar listings

#### 3. All Fields in Each Section
- **Technical Specs**: year, make, model, trim, VIN, mileage, color, transmission, engine, drivetrain, body_style, doors, seats, weight, dimensions, fuel_type, mpg, etc.
- **Pricing**: asking_price, sale_price, reserve_price, current_bid, buyer_premium, currency, etc.
- **Description**: full narrative, highlights, features list, options list, etc.
- **History**: service_records, accident_history, ownership_history, modifications, etc.
- **Seller**: name, type, website, phone, email, location, rating, etc.
- **Auction**: lot_number, auction_status, end_date, bid_count, bid_history, etc.
- **Images**: all gallery images, primary image, thumbnail, etc.

#### 4. Site-Specific Fields
- Custom fields unique to that site
- Platform-specific data (e.g., BaT comments, SBX lot numbers)
- Metadata fields
- Structured data (JSON-LD, microdata)

---

## Site Map Structure

### Complete Site Map Document

For each source, we create a comprehensive map:

```typescript
interface CompleteSiteMap {
  source_domain: string;
  source_name: string;
  source_type: 'marketplace' | 'auction_house' | 'dealer' | 'classified';
  
  // Page type mappings
  page_types: {
    vehicle_listing: {
      url_pattern: string;
      sections: SectionMap[];
      fields: FieldMap[];
      extraction_rules: ExtractionRule[];
    };
    browse_page: {
      url_pattern: string;
      sections: SectionMap[];
      fields: FieldMap[];
      extraction_rules: ExtractionRule[];
    };
    dealer_profile: {
      url_pattern: string;
      sections: SectionMap[];
      fields: FieldMap[];
      extraction_rules: ExtractionRule[];
    };
    // ... all page types
  };
  
  // Field mappings
  field_mappings: {
    // Core vehicle fields
    vehicle_fields: Record<string, FieldMapping>;
    // Raw data fields
    raw_data_fields: Record<string, FieldMapping>;
    // Organization fields
    organization_fields: Record<string, FieldMapping>;
    // External identity fields
    external_identity_fields: Record<string, FieldMapping>;
  };
  
  // Site-specific rules
  extraction_rules: {
    title_parsing: TitleParsingRule;
    price_extraction: PriceExtractionRule;
    vin_validation: VINValidationRule;
    image_extraction: ImageExtractionRule;
    // ... all extraction rules
  };
  
  // Validation rules
  validation: {
    required_fields: string[];
    field_formats: Record<string, RegExp>;
    data_quality_checks: QualityCheck[];
  };
  
  // Completeness tracking
  completeness: {
    total_fields_available: number;
    fields_mapped: number;
    fields_extracted: number;
    coverage_percentage: number;
    missing_fields: string[];
  };
}
```

---

## Field Mapping Accountability

### Every Field Must Be Mapped

**Not just:**
- ✅ year, make, model, price

**But also:**
- ✅ trim, VIN, mileage, color, transmission, engine, drivetrain
- ✅ body_style, doors, seats, weight, dimensions
- ✅ fuel_type, mpg_city, mpg_highway, mpg_combined
- ✅ asking_price, sale_price, reserve_price, current_bid
- ✅ description, highlights, features, options
- ✅ service_records, accident_history, ownership_history
- ✅ seller_name, seller_type, seller_website, seller_phone
- ✅ location, city, state, zip_code
- ✅ lot_number, auction_status, auction_end_date, bid_count
- ✅ all_images, primary_image, thumbnail
- ✅ comments, reviews, ratings
- ✅ **Every field available on the site**

### Field Mapping Document

For each site, we create a complete field mapping:

```typescript
interface CompleteFieldMapping {
  // Core vehicle fields (vehicles table)
  vehicle_fields: {
    year: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    make: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    model: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    trim: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    vin: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    mileage: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    color: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    transmission: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    engine_size: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    horsepower: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    torque: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    drivetrain: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    body_style: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    doors: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    seats: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    weight_lbs: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    length_inches: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    width_inches: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    height_inches: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    wheelbase_inches: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    fuel_capacity_gallons: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    mpg_city: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    mpg_highway: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    mpg_combined: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    asking_price: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    sale_price: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    notes: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    // ... ALL vehicle table fields
  };
  
  // Raw data fields (raw_data JSONB)
  raw_data_fields: {
    lot_number: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    auction_status: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    auction_end_date: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    current_bid: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    bid_count: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    buyer_premium_percent: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    highlights: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    features: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    options: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    exterior: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    interior: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    mechanical: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    service: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    condition: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    history: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    // ... ALL site-specific fields
  };
  
  // Organization fields (businesses table)
  organization_fields: {
    business_name: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    website: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    phone: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    email: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    address: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    city: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    state: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    zip_code: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    description: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    specializations: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    // ... ALL organization fields
  };
  
  // External identity fields (external_identities table)
  external_identity_fields: {
    handle: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    display_name: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    profile_url: { selector: string; pattern: RegExp; transform: Function; confidence: number };
    // ... ALL external identity fields
  };
}
```

---

## Site-Specific Extraction Rules

### Every Site Needs Custom Rules

**Not generic extraction. Site-specific logic.**

```typescript
interface SiteSpecificRules {
  // Title parsing (every site formats differently)
  title_parsing: {
    pattern: RegExp;
    year_extraction: Function;
    make_extraction: Function;
    model_extraction: Function;
    trim_extraction: Function;
    special_handling: {
      // e.g., SBX Cars: "AMG GT 63 4matic+" → model: "GT 63", transmission: "4matic+"
      mercedes_benz: {
        amg_nomenclature: Function;
        transmission_separation: Function;
      };
    };
  };
  
  // Price extraction (different formats, currencies)
  price_extraction: {
    selector: string;
    pattern: RegExp;
    currency_detection: Function;
    cleanup: Function; // Remove commas, symbols, etc.
    validation: Function; // Check if price is reasonable
  };
  
  // VIN extraction and validation
  vin_extraction: {
    selector: string;
    pattern: RegExp;
    validation: Function; // ISO 3779 check digit
    confidence_scoring: Function;
  };
  
  // Image extraction
  image_extraction: {
    gallery_selector: string;
    primary_selector: string;
    thumbnail_selector: string;
    lazy_loading_handling: Function; // data-src, data-lazy, etc.
    quality_filtering: Function; // Filter out low-res, watermarks, etc.
  };
  
  // Structured data extraction
  structured_data: {
    json_ld: boolean;
    microdata: boolean;
    opengraph: boolean;
    extraction_functions: Function[];
  };
  
  // Pagination
  pagination: {
    pattern: string;
    next_page_selector: string;
    page_number_extraction: Function;
  };
  
  // Authentication requirements
  authentication: {
    required: boolean;
    method: 'none' | 'login' | 'api_key' | 'session';
    handling: Function;
  };
}
```

---

## Completeness Validation

### Verify We're Not Missing Data

**For every site, validate:**

```typescript
interface CompletenessValidation {
  // Field coverage
  field_coverage: {
    total_fields_on_site: number;
    fields_mapped: number;
    fields_extracted: number;
    coverage_percentage: number;
    missing_fields: string[];
  };
  
  // Section coverage
  section_coverage: {
    sections_on_page: string[];
    sections_mapped: string[];
    sections_extracted: string[];
    missing_sections: string[];
  };
  
  // Data quality
  data_quality: {
    completeness_score: number; // 0-1
    accuracy_score: number; // 0-1
    consistency_score: number; // 0-1
    overall_score: number; // 0-1
  };
  
  // Validation results
  validation_results: {
    sample_urls_tested: number;
    extraction_success_rate: number;
    field_extraction_rates: Record<string, number>;
    issues_found: string[];
  };
}
```

---

## Autonomous Site Mapping Process

### How the System Creates Thorough Maps

**Step 1: Deep Site Analysis**
```typescript
async function analyzeSiteThoroughly(url: string): Promise<CompleteSiteMap> {
  // 1. Crawl all page types
  const pageTypes = await discoverAllPageTypes(url);
  
  // 2. For each page type, analyze all sections
  const sections = await analyzeAllSections(pageTypes);
  
  // 3. For each section, identify all fields
  const fields = await identifyAllFields(sections);
  
  // 4. Map fields to database schema
  const mappings = await mapAllFieldsToDatabase(fields);
  
  // 5. Create extraction rules
  const rules = await createExtractionRules(url, fields);
  
  // 6. Validate completeness
  const validation = await validateCompleteness(mappings, fields);
  
  return {
    page_types: pageTypes,
    field_mappings: mappings,
    extraction_rules: rules,
    validation: validation,
    completeness: calculateCompleteness(mappings, fields)
  };
}
```

**Step 2: Field Discovery (AI-Powered)**
```typescript
async function identifyAllFields(sections: Section[]): Promise<Field[]> {
  // Use AI to identify ALL fields on the page
  const prompt = `Analyze this automotive listing page and identify EVERY data field available.
  
  Don't just list the obvious fields (year, make, model, price).
  List EVERYTHING:
  - All technical specifications
  - All pricing information
  - All description sections
  - All features and options
  - All history and service records
  - All seller information
  - All location data
  - All auction details (if applicable)
  - All images
  - All metadata
  - All structured data (JSON-LD, microdata)
  - All hidden fields in HTML
  - All data in JavaScript variables
  - Everything visible and extractable
  
  Return comprehensive list with selectors, patterns, and extraction methods.`;
  
  // AI returns complete field list
  return aiIdentifyFields(sections, prompt);
}
```

**Step 3: Complete Mapping**
```typescript
async function mapAllFieldsToDatabase(fields: Field[]): Promise<CompleteFieldMapping> {
  // Get database schema
  const vehicleSchema = await getVehicleSchema();
  const organizationSchema = await getOrganizationSchema();
  const rawDataSchema = getRawDataSchema();
  
  // Map every field
  const mappings: CompleteFieldMapping = {
    vehicle_fields: {},
    raw_data_fields: {},
    organization_fields: {},
    external_identity_fields: {}
  };
  
  for (const field of fields) {
    // Find best match in database schema
    const match = findBestSchemaMatch(field, vehicleSchema, organizationSchema, rawDataSchema);
    
    if (match.table === 'vehicles') {
      mappings.vehicle_fields[field.name] = createFieldMapping(field, match);
    } else if (match.table === 'raw_data') {
      mappings.raw_data_fields[field.name] = createFieldMapping(field, match);
    } else if (match.table === 'businesses') {
      mappings.organization_fields[field.name] = createFieldMapping(field, match);
    } else if (match.table === 'external_identities') {
      mappings.external_identity_fields[field.name] = createFieldMapping(field, match);
    }
  }
  
  return mappings;
}
```

**Step 4: Validation**
```typescript
async function validateCompleteness(
  mappings: CompleteFieldMapping,
  availableFields: Field[]
): Promise<CompletenessValidation> {
  // Check field coverage
  const mappedFieldNames = [
    ...Object.keys(mappings.vehicle_fields),
    ...Object.keys(mappings.raw_data_fields),
    ...Object.keys(mappings.organization_fields),
    ...Object.keys(mappings.external_identity_fields)
  ];
  
  const availableFieldNames = availableFields.map(f => f.name);
  const missingFields = availableFieldNames.filter(f => !mappedFieldNames.includes(f));
  
  const coverage = (mappedFieldNames.length / availableFieldNames.length) * 100;
  
  // Test extraction on samples
  const testResults = await testExtractionOnSamples(mappings);
  
  return {
    field_coverage: {
      total_fields_on_site: availableFieldNames.length,
      fields_mapped: mappedFieldNames.length,
      fields_extracted: testResults.extracted_fields.length,
      coverage_percentage: coverage,
      missing_fields: missingFields
    },
    validation_results: testResults
  };
}
```

---

## Accountability Metrics

### Track Completeness, Not Just Volume

**For every source:**
1. **Field Coverage**: % of available fields mapped
2. **Extraction Rate**: % of mapped fields successfully extracted
3. **Data Completeness**: % of vehicles with complete data
4. **Quality Score**: Accuracy and consistency of extracted data
5. **Missing Fields**: List of fields available but not extracted

**Targets:**
- Field Coverage: 95%+ (map 95%+ of available fields)
- Extraction Rate: 90%+ (successfully extract 90%+ of mapped fields)
- Data Completeness: 85%+ (85%+ of vehicles have complete core data)
- Quality Score: 0.9+ (90%+ accuracy)

---

## Implementation

### Updated Autonomous System

The `database-fill-agent` now:
1. **Thoroughly maps every source** before ingestion
2. **Validates completeness** (not just basic fields)
3. **Tracks field coverage** for each source
4. **Improves mappings** when fields are missing
5. **Reports on completeness** not just volume

**Accountability = Complete data extraction, not just basic fields.**

---

## Example: duPont Registry Complete Map

**Not just:**
- year, make, model, price

**But complete map of:**
- All 50+ vehicle fields
- All raw_data fields (lot_number, auction_status, etc.)
- All organization fields (dealer profiles)
- All external identity fields (user profiles)
- All site-specific fields
- All extraction rules
- All validation rules

**Result: Complete data extraction, not partial.**

---

## Summary

**Accountability means:**
- ✅ Thorough site mapping (all page types, all sections)
- ✅ Complete field mapping (every available field)
- ✅ Site-specific rules (custom extraction logic)
- ✅ Completeness validation (verify we're not missing data)
- ✅ Quality tracking (accuracy and consistency)

**Not just volume. Complete, accurate data extraction.**

