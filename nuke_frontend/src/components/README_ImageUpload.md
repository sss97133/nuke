# Streamlined Image Upload System

This document explains the consolidated image upload system that replaces the previous fragmented approach with three separate components.

## Overview

The new system provides a unified approach to image uploading with three main components:

1. **UnifiedImageUpload** - Core component with all upload functionality
2. **UnifiedImageUploadService** - Service layer for upload operations
3. **ImageUploadWrapper** - Simple wrapper for different use cases

## Components

### UnifiedImageUpload

The main component that handles all image upload scenarios:

```tsx
import { UnifiedImageUpload } from './UnifiedImageUpload';

<UnifiedImageUpload
  vehicleId="vehicle-id"
  mode="single" // 'single' | 'bulk' | 'work-session'
  showMetadataForm={true}
  onUploadSuccess={(results) => console.log('Uploaded:', results)}
  onComplete={(sessions) => console.log('Work sessions:', sessions)}
/>
```

**Props:**
- `vehicleId` (required) - Vehicle ID for upload association
- `mode` - Upload mode: single image, bulk images, or work session analysis
- `showMetadataForm` - Whether to show detailed metadata form
- `onUploadSuccess` - Callback for successful uploads
- `onComplete` - Callback for work session completion

### ImageUploadWrapper

Simplified wrapper for common use cases:

```tsx
import { ImageUploadWrapper } from './ImageUploadWrapper';

<ImageUploadWrapper
  vehicleId="vehicle-id"
  variant="simple" // 'simple' | 'detailed' | 'bulk' | 'work-session'
  onUploadSuccess={(results) => console.log('Success:', results)}
/>
```

**Variants:**
- `simple` - Basic single image upload
- `detailed` - Single image with metadata form
- `bulk` - Multiple image upload
- `work-session` - Work session analysis with duplicate detection

### UnifiedImageUploadService

Service layer for programmatic uploads:

```tsx
import { UnifiedImageUploadService } from '../services/unifiedImageUploadService';

// Upload single image
const result = await UnifiedImageUploadService.uploadImage(
  vehicleId,
  file,
  {
    category: 'exterior',
    caption: 'Front view',
    is_primary: true
  }
);

// Upload multiple images
const results = await UnifiedImageUploadService.uploadImages(
  vehicleId,
  files,
  { category: 'restoration' }
);

// Delete image
await UnifiedImageUploadService.deleteImage(imageId);

// Set primary image
await UnifiedImageUploadService.setPrimaryImage(vehicleId, imageId);
```

## Migration Guide

### From ImageUpload.tsx

**Old:**
```tsx
import ImageUpload from './ImageUpload';

<ImageUpload
  vehicleId={vehicleId}
  onImageUploaded={(url) => console.log(url)}
/>
```

**New:**
```tsx
import { ImageUploadWrapper } from './ImageUploadWrapper';

<ImageUploadWrapper
  vehicleId={vehicleId}
  variant="simple"
  onUploadSuccess={(results) => console.log(results)}
/>
```

### From BulkImageUpload.tsx

**Old:**
```tsx
import { BulkImageUpload } from './BulkImageUpload';

<BulkImageUpload
  vehicleId={vehicleId}
  onComplete={(sessions) => console.log(sessions)}
/>
```

**New:**
```tsx
import { ImageUploadWrapper } from './ImageUploadWrapper';

<ImageUploadWrapper
  vehicleId={vehicleId}
  variant="work-session"
  onComplete={(sessions) => console.log(sessions)}
/>
```

### From ImageUploadForm.tsx

**Old:**
```tsx
import ImageUploadForm from './images/ImageUploadForm';

<ImageUploadForm
  vehicleId={vehicleId}
  onUploadSuccess={() => console.log('Success')}
/>
```

**New:**
```tsx
import { ImageUploadWrapper } from './ImageUploadWrapper';

<ImageUploadWrapper
  vehicleId={vehicleId}
  variant="detailed"
  onUploadSuccess={(results) => console.log(results)}
/>
```

## Features

### All Modes
- Drag & drop support
- File validation (type, size)
- Progress indicators
- Error handling
- Supabase storage integration
- Database metadata storage

### Work Session Mode
- Duplicate detection
- Timestamp extraction
- Work session analysis
- User activity tracking
- Timeline event creation

### Metadata Form Mode
- Category selection
- Caption and description
- Date taken
- Angle specification
- Primary image setting

## Database Schema

The system uses the existing `vehicle_images` table:

```sql
CREATE TABLE vehicle_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID REFERENCES vehicles(id),
  user_id UUID REFERENCES auth.users(id),
  image_url TEXT NOT NULL,
  category TEXT,
  caption TEXT,
  description TEXT,
  is_primary BOOLEAN DEFAULT false,
  angle INTEGER,
  taken_at DATE,
  file_name TEXT,
  file_size INTEGER,
  file_type TEXT,
  storage_path TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

## Storage Organization

Images are stored in the `vehicle-data` bucket with the following structure:

```
vehicle-data/
├── vehicles/
│   └── {vehicle-id}/
│       ├── images/
│       │   └── {timestamp}_{filename}
│       └── work_sessions/
│           └── {timestamp}_{filename}
└── temp/
    └── {timestamp}_{filename}
```

## Error Handling

The system provides comprehensive error handling:

- File validation errors
- Upload failures
- Database errors
- Authentication errors
- Storage quota errors

All errors are displayed to the user with clear messages and suggested actions.

## Performance Considerations

- Files are validated before upload
- Large files show progress indicators
- Batch uploads are processed sequentially
- Duplicate detection prevents redundant uploads
- Automatic cleanup on failed uploads

## Security

- User authentication required
- Row Level Security (RLS) policies
- File type validation
- Size limits enforced
- User ownership verification

## Testing

To test the streamlined system:

1. **Simple Upload:**
   ```tsx
   <ImageUploadWrapper vehicleId="test-id" variant="simple" />
   ```

2. **Bulk Upload:**
   ```tsx
   <ImageUploadWrapper vehicleId="test-id" variant="bulk" />
   ```

3. **Work Session:**
   ```tsx
   <ImageUploadWrapper vehicleId="test-id" variant="work-session" />
   ```

4. **Detailed Form:**
   ```tsx
   <ImageUploadWrapper vehicleId="test-id" variant="detailed" />
   ```

## Deprecated Components

The following components are now deprecated and should be replaced:

- ❌ `ImageUpload.tsx` → Use `ImageUploadWrapper` with `variant="simple"`
- ❌ `BulkImageUpload.tsx` → Use `ImageUploadWrapper` with `variant="work-session"`
- ❌ `images/ImageUploadForm.tsx` → Use `ImageUploadWrapper` with `variant="detailed"`

## Benefits

1. **Consistency** - Single upload system across all components
2. **Maintainability** - One codebase to maintain instead of three
3. **Features** - All advanced features available in all modes
4. **Performance** - Optimized upload process with better error handling
5. **User Experience** - Consistent UI/UX across the platform
6. **Flexibility** - Easy to add new upload modes or features

The streamlined system maintains all existing functionality while providing a cleaner, more maintainable architecture that follows the USER's core fundamentals focus.
