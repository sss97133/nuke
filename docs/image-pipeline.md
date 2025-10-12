# Image Pipeline Architecture

## Overview

The image pipeline provides comprehensive image processing, storage, and optimization for vehicle documentation. The system handles EXIF metadata extraction, multi-resolution variant generation, and integration with the vehicle timeline system.

## System Components

### Core Services

- **ImageUploadService**: Handles file upload, validation, and database persistence
- **ImageOptimizationService**: Generates optimized image variants for different use cases
- **ImageMetadata Utilities**: Extracts EXIF data and geographic information

### Database Schema

```sql
CREATE TABLE vehicle_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID REFERENCES vehicles(id),
    user_id UUID REFERENCES auth.users(id),
    image_url TEXT NOT NULL,
    storage_path TEXT,
    filename TEXT,
    file_size INTEGER,
    mime_type TEXT,
    category TEXT,
    is_primary BOOLEAN DEFAULT FALSE,
    variants JSONB DEFAULT '{}',
    exif_data JSONB DEFAULT '{}',
    taken_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);
```

## Upload Process

### 1. File Processing
- File validation (type, size limits)
- EXIF metadata extraction
- Image orientation correction

### 2. Variant Generation
The system generates three optimized variants:
- **thumbnail**: 150px width, 70% quality
- **medium**: 400px width, 80% quality
- **large**: 800px width, 85% quality

### 3. Storage
- Original image stored in Supabase Storage
- Variants uploaded with naming convention: `{id}_{variant}.jpg`
- Public URLs generated for all variants

### 4. Database Persistence
```typescript
{
  variants: {
    thumbnail: "https://storage.url/thumb.jpg",
    medium: "https://storage.url/medium.jpg",
    large: "https://storage.url/large.jpg",
    full: "https://storage.url/original.jpg"
  }
}
```

## Performance Characteristics

- **Thumbnail loading**: ~10KB vs ~3MB (300x improvement)
- **Gallery pages**: 200KB vs 50MB total transfer
- **Mobile optimization**: Adaptive variant selection

## API Reference

### ImageUploadService.uploadImage()

```typescript
static async uploadImage(
  vehicleId: string,
  file: File,
  category: string = 'general'
): Promise<ImageUploadResult>
```

**Parameters:**
- `vehicleId`: Vehicle identifier
- `file`: Image file (max 10MB)
- `category`: Image classification

**Returns:**
- `success`: Upload success status
- `imageId`: Database record identifier
- `imageUrl`: Primary image URL

### ImageOptimizationService.generateVariantBlobs()

```typescript
async generateVariantBlobs(file: File): Promise<OptimizationResult>
```

Generates Canvas-based image variants with EXIF orientation handling.

## Component Integration

### VehicleThumbnail
Automatically selects optimal variant based on display size:
- Small: thumbnail → medium → large → full
- Medium: medium → large → thumbnail → full
- Large: large → full → medium → thumbnail

### FeedService
Uses medium variants for optimal performance in discovery feeds.

## Error Handling

- Upload failures trigger automatic cleanup
- Variant generation failures fall back to original image
- Network failures provide user feedback and retry options

## Configuration

```typescript
// Size and quality settings
private readonly SIZES = {
  thumbnail: { width: 150, quality: 0.7 },
  medium: { width: 400, quality: 0.8 },
  large: { width: 800, quality: 0.85 },
};
```