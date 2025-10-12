# Intelligent Data Annotation System

## Overview

The Intelligent Data Annotation System provides data provenance tracking and multi-contributor capabilities for vehicle profiles. Every piece of vehicle data is annotated with its source, verification status, and confidence level, creating a transparent and trustworthy vehicle history.

## Core Components

### 1. Database Schema

#### `vehicle_data_sources` Table
Tracks the provenance of every data field:
- **source_type**: `user_upload`, `web_scrape`, `vin_decode`, `library_spec`, `service_record`, `modification_doc`, `professional_assessment`, `manufacturer_data`
- **confidence_score**: 0.0 to 1.0 indicating data reliability
- **verification_status**: `unverified`, `human_verified`, `multi_verified`, `disputed`
- **source_metadata**: JSON containing additional context

#### `vehicle_modifications` Table
Specialized tracking for vehicle modifications:
- **modification_type**: Engine swaps, performance upgrades, cosmetic changes, etc.
- **before_specs** / **after_specs**: JSON objects tracking changes
- **documentation_urls**: Links to supporting documentation
- **affects_performance/emissions/safety**: Impact flags

### 2. Frontend Components

#### `<AnnotatedField>`
Clickable data fields that show source information:
```tsx
<AnnotatedField
  fieldName="engine_size"
  value="5.7L"
  vehicleId={vehicleId}
  annotation={annotation}
  displayFormat="text"
/>
```

#### `<DataSourcePopover>`
Displays detailed provenance information:
- Primary source with highest confidence
- All contributing sources
- Conflicting data from different sources
- Verification timeline

#### `<VehicleProfileWithAnnotations>`
Complete vehicle profile with annotated fields and data source legend.

### 3. Services

#### `DataSourceService`
- `createDataSource()`: Record new data source
- `getFieldAnnotation()`: Get provenance for specific field
- `trackScrapedData()`: Automatically track web scraping sources
- `trackUserData()`: Record user-contributed data

#### `useVehicleAnnotations` Hook
React hook for loading and managing field annotations.

## Data Source Types

### Automated Sources
- **Web Scraping**: BAT listings, dealer websites
- **VIN Decoding**: Manufacturer specifications
- **Library Specs**: Dealer handbooks, factory documentation

### Human Contributors
- **Vehicle Owners**: Direct data entry, photos, modifications
- **Service Shops**: Maintenance records, part replacements
- **Professionals**: Appraisals, inspections, certifications

## Verification Levels

1. **Unverified**: Raw data without human review
2. **Basic**: Single human verification
3. **Professional**: Verified by certified professional
4. **Multi-verified**: Multiple independent verifications

## Visual Indicators

- **✓✓**: Multi-verified data (green)
- **✓**: Professional verification (blue)
- **○**: Basic verification (yellow)
- **⚠**: Conflicting data sources (orange)

## Implementation Example

```tsx
// Load annotations for vehicle fields
const { annotations } = useVehicleAnnotations(vehicleId, [
  'make', 'model', 'year', 'engine_size'
]);

// Display annotated field
<AnnotatedField
  fieldName="make"
  value="Chevrolet"
  vehicleId={vehicleId}
  annotation={annotations.make}
/>
```

## Data Flow

1. **Data Entry**: User enters data or system scrapes information
2. **Source Tracking**: `DataSourceService.createDataSource()` records provenance
3. **Annotation Loading**: `useVehicleAnnotations` fetches source data
4. **Visual Display**: `AnnotatedField` shows data with source indicators
5. **User Interaction**: Click field to view detailed source information

## Benefits

### Trust & Transparency
- Every data point has clear provenance
- Conflicting information is surfaced, not hidden
- Verification creates premium data layers

### Collaborative Ecosystem
- Multiple parties can contribute to vehicle profiles
- Professional network effects increase data quality
- Service history accumulates over time

### Data Quality
- Confidence scoring resolves conflicts automatically
- Timeline shows data evolution
- Prevents data degradation through proper attribution

## Integration Points

### Vehicle Creation
When creating vehicles from scraped data:
```tsx
// Track all scraped fields
await DataSourceService.trackScrapedData(
  vehicleId, 
  scrapedData, 
  sourceUrl, 
  contributorId
);
```

### Service Records
When shops add service records:
```tsx
// Create modification record
await DataSourceService.createModification({
  vehicle_id: vehicleId,
  modification_type: 'part_replacement',
  parts_changed: ['brake_pads'],
  performed_by_shop: 'Joe\'s Auto Shop'
});
```

### Professional Verification
When professionals verify data:
```tsx
// Update verification status
await DataSourceService.createDataSource({
  vehicle_id: vehicleId,
  field_name: 'mileage',
  field_value: '56000',
  source_type: 'professional_assessment',
  verification_status: 'human_verified',
  confidence_score: 0.95
});
```

This system transforms static vehicle profiles into dynamic, collaborative documents that grow more valuable and trustworthy over time.
