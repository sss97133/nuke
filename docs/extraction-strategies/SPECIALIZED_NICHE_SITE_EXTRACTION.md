# Specialized Niche Site Extraction Strategy

## Core Principle: Limited Data, High Value

When extracting data from specialized niche sites (like 2002AD), the approach differs significantly from high-volume marketplaces. The data is **limited but important**, requiring careful preservation of historical context and provenance.

## Key Characteristics of Specialized Niche Sites

### 1. **Rich Unique History**
- Long operational history (e.g., 24 years for 2002AD)
- Deep expertise in specific niche (BMW 2002s)
- Unique images spanning decades
- Limited but curated vehicle profiles

### 2. **Data Quality Profile**
- **High Signal**: Historical images, long-term relationships, specialized knowledge
- **Low Signal**: Individual vehicle profiles may be incomplete
- **High Value**: Aggregate insights from historical patterns
- **Low Volume**: Fewer vehicles, but each tells a story

### 3. **Relationship Dynamics**
- **Not dealers**: Often collaborators, advertisers, service providers
- **Historical context matters**: Timeline events back decades
- **Provenance is critical**: Track source, date, context of every piece of data

## Extraction Strategy

### 1. **Preserve Historical Context**

```typescript
// Always capture temporal metadata
{
  extracted_at: new Date().toISOString(),
  source_url: originalPageUrl,
  vehicle_year: extractedYear, // Use as approximate start_date
  historical_context: {
    organization_operating_since: '2000', // If known
    data_span: '2005-present', // Time range of data
  }
}
```

### 2. **Handle Incomplete Vehicle Profiles**

**Don't reject low-quality profiles - preserve what exists:**

```typescript
// Accept partial data
{
  year: extractedYear,      // May be approximate
  make: extractedMake,      // May be inferred
  model: extractedModel,    // May be partial
  description: rawText,     // Preserve original
  image_urls: foundImages,  // Even if low quality
  status: 'for_sale' | 'sold' | 'restoration',
  // Missing: VIN, exact specs, etc. - OK for historical context
}
```

### 3. **Relationship Type Accuracy**

**Understand the organization's actual role:**

```typescript
// NOT dealers - they're collaborators/advertisers
relationship_type: 'collaborator', // Not 'inventory'
metadata: {
  role: 'advertiser',
  is_dealer: false,
  is_advertiser: true,
  collaboration_type: 'advertising' | 'advertising_historical' | 'service'
}
```

### 4. **Timeline Events for Historical Context**

**Create timeline events even with approximate dates:**

```typescript
// Use vehicle year as approximate event date
const startDate = vehicle.year ? `${vehicle.year}-01-01` : null;

// Timeline can go back decades (e.g., 2005)
if (startDate && new Date(startDate) >= new Date('2005-01-01')) {
  await createTimelineEvent({
    event_date: startDate, // Approximate but valuable
    event_type: 'custom',
    title: `Featured by ${orgName}`,
    metadata: {
      collaboration_type: 'advertising',
      historical_context: true,
    }
  });
}
```

### 5. **Image Preservation Strategy**

**Even low-quality images have value:**

```typescript
// Preserve all images with quality metadata
{
  image_url: originalUrl,
  quality_rating: 2, // Low resolution, but historical value
  tags: ['organization_archive', 'low_resolution', 'historical'],
  metadata: {
    extracted_from: 'organization_site',
    approximate_date: vehicleYear,
    historical_significance: true,
  }
}
```

### 6. **Parts Catalog Integration**

**Index everything, even if incomplete:**

```typescript
// Batch process to avoid timeouts
const maxCategories = 5; // Process in batches
const startCategoryId = 0; // Resume from last processed

// Store with organization linkage
{
  catalog_id: organizationCatalogId,
  part_number: extractedId,
  name: cleanedName, // Even if partial
  price_current: extractedPrice,
  application_data: {
    organization_id: orgId,
    category_name: categoryName,
    product_url: sourceUrl,
  }
}
```

### 7. **Brochure/Library Documents**

**Preserve low-quality documents for historical value:**

```typescript
// Store in reference library even if low resolution
{
  document_type: 'brochure',
  quality_rating: 2, // Low resolution
  tags: ['organization_archive', 'low_resolution', 'historical'],
  metadata: {
    organization_id: orgId,
    historical_significance: true,
    approximate_year: extractedYear,
  }
}
```

## Data Quality Principles

### ✅ DO:
- Preserve incomplete data with clear metadata
- Capture historical context (dates, sources, relationships)
- Link everything to organization for provenance
- Use approximate dates when exact dates unavailable
- Store low-quality images/documents with quality ratings
- Create timeline events for historical relationships
- Batch process to handle large catalogs

### ❌ DON'T:
- Reject data because it's incomplete
- Assume organizations are dealers
- Lose historical context
- Skip timeline events for old data
- Ignore low-quality but unique images
- Process everything in one request (timeout risk)

## Aggregate Value

**The value is in the pattern, not individual records:**

- 24 years of 2002 data = insights into model trends
- Historical images = visual evolution documentation
- Parts catalog = comprehensive parts availability history
- Service history = restoration techniques over time
- Brochures = marketing evolution

## Implementation Checklist

- [x] Extract vehicles (even incomplete profiles)
- [x] Preserve historical dates (use vehicle year as approximate)
- [x] Set correct relationship types (collaborator, not inventory)
- [x] Create timeline events (back to 2005+)
- [x] Index parts catalog (batched processing)
- [x] Store brochures (with quality ratings)
- [x] Link everything to organization
- [x] Track provenance (source URLs, extraction dates)
- [x] Handle low-quality data gracefully
- [x] Preserve historical context

## Key Learnings

1. **Limited data ≠ Low value** - Historical context amplifies value
2. **Incomplete profiles are OK** - Aggregate patterns matter more
3. **Provenance is critical** - Track where every piece came from
4. **Timeline matters** - Even approximate dates create valuable patterns
5. **Quality ratings help** - Mark low-quality but preserve it
6. **Batch processing** - Handle large catalogs in chunks
7. **Relationship accuracy** - Understand actual org role (not dealers)
8. **Historical significance** - 24 years of data > perfect individual records

## Example: 2002AD Extraction

**What we extracted:**
- Vehicles: Incomplete profiles but with historical context
- Images: Low resolution but spanning decades
- Parts: 370+ indexed with organization linkage
- Brochures: Low quality but historically significant
- Timeline: Events back to 2005 based on vehicle years
- Relationships: Collaborator/advertiser (not dealer)

**Value created:**
- 24-year historical record of BMW 2002 market
- Visual documentation of restoration techniques
- Comprehensive parts availability data
- Marketing/brochure evolution
- Service provider relationship history

**Key insight:** The aggregate historical pattern is more valuable than any individual incomplete record.

