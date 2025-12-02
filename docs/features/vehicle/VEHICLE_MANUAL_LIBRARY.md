# Vehicle Manual Library System

## Overview

The Vehicle Manual Library stores repair manuals, assembly manuals, factory service books, wiring diagrams, and parts catalogs for vehicles in the database. This system helps improve image classification accuracy by providing reference materials that AI can use to identify parts and understand spatial relationships.

## Database Schema

### `vehicle_manuals`
Stores manual metadata:
- **Identification**: title, type, publisher, year, ISBN, part number
- **Vehicle Matching**: make, model, year range, body style, engine/transmission options, VIN ranges
- **File Storage**: URL, storage path, file size, page count
- **Content Indexing**: table of contents, indexed sections, part numbers, diagram pages
- **Quality**: verification status, completeness, quality score

### `vehicle_manual_links`
Links manuals to specific vehicles (many-to-many):
- Match confidence (0-100)
- Match reason (auto-matched, manual, etc.)
- Usage tracking

### `manual_image_references`
Links specific manual pages/sections to help classify images:
- Part names, part numbers, system areas
- Page numbers, diagram types
- Spatial hints for 3D mapping

## Auto-Matching

The `auto_match_manuals_to_vehicle()` function automatically links manuals to vehicles based on:
- **Exact match** (100%): Make, model, year within range, body style
- **Close match** (90%): Make, model, year within ±2 years
- **Make + year** (75%): Make matches, year in range, model unspecified
- **Make only** (50%): Just make matches

## Integration with Image Classification

The enhanced `backfill-image-angles` function now:
1. **Loads available manuals** for each vehicle
2. **Includes manual references** in AI classification prompts
3. **Validates classifications** against manual part references
4. **Boosts confidence** when parts match manual diagrams
5. **Flags for review** when parts don't match available manuals

## Uploading Manuals

### For 73-87 GM Trucks (Example)

```sql
-- Insert a manual
INSERT INTO vehicle_manuals (
  title,
  manual_type,
  publisher,
  publication_year,
  make,
  model,
  model_year_start,
  model_year_end,
  body_style,
  file_url,
  storage_path,
  uploaded_by
) VALUES (
  '1973-1987 GM Truck Factory Service Manual',
  'factory_service_manual',
  'General Motors',
  1987,
  'Chevrolet',
  'C/K Series',
  1973,
  1987,
  'Pickup',
  'https://storage.../gm-truck-73-87.pdf',
  'manuals/gm-truck-73-87.pdf',
  auth.uid()
);

-- Auto-link to matching vehicles
SELECT * FROM auto_match_manuals_to_vehicle('vehicle-uuid-here');
```

## Manual Types

- `repair_manual` - General repair guides (Chilton, Haynes)
- `assembly_manual` - Factory assembly procedures
- `factory_service_manual` - OEM service documentation
- `wiring_diagram` - Electrical schematics
- `parts_catalog` - Parts identification and ordering
- `owner_manual` - Owner's handbook
- `technical_bulletin` - Service bulletins
- `recall_notice` - Safety recalls
- `service_bulletin` - Technical service bulletins

## Next Steps

1. **Upload your 73-87 GM truck manuals** - We can create a script to bulk upload
2. **Index manual content** - Extract part numbers, diagram pages, section titles
3. **Create manual references** - Link specific pages to part names/system areas
4. **Test classification** - Run image classification with manual context

## Benefits

- **Higher accuracy** for part identification
- **Spatial mapping** using manual diagrams
- **Validation** against authoritative sources
- **Community resource** - manuals benefit all users with matching vehicles

