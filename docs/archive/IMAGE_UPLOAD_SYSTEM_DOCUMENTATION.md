# Image Upload System Documentation

## Overview
Your image upload system has been audited and fixed. Here's how it works and what was corrected.

## Core Architecture

### Frontend Components
- **UniversalImageUpload.tsx** - Main upload component for vehicle images
- **ImageGallery.tsx** - Displays images with "No images found" message when empty
- **VehicleImageGallery.tsx** - Alternative gallery component

### Backend Services
- **ImageUploadService.ts** (Frontend) - Handles upload to Supabase storage
- **DocumentController.ex** (Elixir) - Handles document uploads via API
- **OwnershipVerificationController.ex** (Elixir) - Handles ownership document uploads

## Database Schema

### Tables
- **vehicle_images** - Main image storage with 40+ columns
- **vehicle_documents** - Document storage (receipts, manuals, etc.)
- **ownership_verifications** - Ownership proof documents

### Storage
- **Supabase Storage Bucket**: `vehicle-images`
- **File Structure**: `{vehicle_id}/{unique_filename}.ext`
- **Variants**: thumbnail, medium, large URLs stored in `variants` JSON column

## Permissions (Fixed)

### Before Fix
- 15 overlapping RLS policies causing conflicts
- Complex permission logic blocking simple uploads

### After Fix
- **3 Simple Policies**:
  1. **INSERT**: Users upload to vehicles they own
  2. **SELECT**: Users see their images + public vehicle images
  3. **UPDATE/DELETE**: Users modify their own images on their vehicles

## Issues Fixed

### 1. Placeholder URLs (FIXED)
**Problem**: Elixir backend was using `placeholder-storage.com` instead of real uploads
**Solution**:
- Updated `DocumentController.ex` and `OwnershipVerificationController.ex`
- Added real Supabase storage upload functionality
- Marked 7 existing broken URLs for re-upload

### 2. Permission Conflicts (FIXED)
**Problem**: Multiple overlapping RLS policies blocking uploads
**Solution**: Simplified to 3 clear policies focused on vehicle ownership

### 3. Environment Variables (CONFIGURED)
**Problem**: Missing Supabase credentials for Elixir backend
**Solution**: Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`

## How Image Upload Works Now

### Frontend Upload (via UniversalImageUpload)
1. User selects images → File validation
2. EXIF extraction → Variant generation (thumbnail, medium, large)
3. Upload to `vehicle-images` bucket → Database record creation
4. Timeline event creation → Gallery refresh

### Backend Upload (via Elixir API)
1. API receives file upload → Validation
2. Upload to Supabase storage → Generate public URL
3. Database record creation → Response to client

## Upload Flow

```
User Selects Image
       ↓
File Validation (size, type)
       ↓
EXIF Data Extraction
       ↓
Generate Variants (thumb, medium, large)
       ↓
Upload to Supabase Storage
       ↓
Save to vehicle_images Table
       ↓
Create Timeline Event
       ↓
Refresh Gallery Display
```

## File Organization

```
vehicle-images/ (Supabase Bucket)
├── documents/
│   └── {timestamp}_{filename}     # Document uploads
├── ownership/
│   └── {timestamp}_{filename}     # Ownership verification docs
└── {vehicle_id}/
    └── {uuid}.{ext}               # Vehicle images
    └── {uuid}_thumbnail.jpg       # Thumbnails
    └── {uuid}_medium.jpg          # Medium variants
    └── {uuid}_large.jpg           # Large variants
```

## Key Features

### Security
- Row Level Security (RLS) policies
- User authentication required
- Vehicle ownership verification
- File type and size validation

### Performance
- Multiple image variants (thumbnail, medium, large)
- Lazy loading in galleries
- Progressive image loading
- EXIF metadata extraction

### User Experience
- Drag and drop upload
- Progress indicators
- Error handling with clear messages
- Auto-primary image setting (first upload)

## Testing Your System

### 1. Frontend Image Upload
- Use `UniversalImageUpload` component in vehicle pages
- Upload should create variants and show in gallery
- Check `vehicle_images` table for records

### 2. Backend Document Upload
- Use Elixir API endpoints for documents
- Files now upload to real Supabase storage
- Check for proper URLs (not placeholder-storage.com)

### 3. Gallery Display
- Should show "No images found" when empty
- Should display thumbnails when images exist
- Click to view in lightbox with larger variants

## Environment Variables Required

```bash
# For Elixir Backend
export SUPABASE_URL="https://qkgaybvrernstplzjaam.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
```

## Troubleshooting

### "No images found for this vehicle"
- Check RLS policies allow user to SELECT images
- Verify `vehicle_id` matches between images and vehicle
- Confirm user owns the vehicle (`uploaded_by = user_id`)

### Upload Failures
- Check storage bucket permissions
- Verify authentication token
- Confirm file size under 10MB limit

### Broken Image URLs
- Old placeholder URLs marked with "BROKEN:" prefix
- Users need to re-upload affected files
- New uploads will use real Supabase URLs

## Summary

Your image upload system is now working with:
✅ Simplified, clear permissions
✅ Real file uploads (no more placeholders)
✅ Proper database schema with variants
✅ Full frontend/backend integration
✅ Comprehensive error handling

The system supports both direct frontend uploads (for vehicle photos) and backend API uploads (for documents), all storing files in your Supabase `vehicle-images` bucket with proper access control.