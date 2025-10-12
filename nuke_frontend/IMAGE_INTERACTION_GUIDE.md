# Image Interaction Behavior Guide

This document describes how image interactions work in the vehicle profile system.

## Image Display Components

### LazyImage Component
- **Object Fit**: Uses `object-fit: contain` to display images properly without cropping
- **Lazy Loading**: Images load when they enter the viewport (50px margin)
- **Progressive Enhancement**: Preloads higher quality versions on hover
- **Shimmer Effect**: Shows loading animation while images are being fetched

### SimpleImageViewer Component
- **Overlay Buttons**: Delete and Info buttons appear on image hover
- **Default State**: Overlay buttons are hidden (opacity: 0)
- **Hover State**: Overlay buttons become visible (opacity: 0.8)
- **Access Control**: Only image uploaders and vehicle owners can see delete button

## Image Resolution and Quality

### Hero Image (Vehicle Profile)
- **Priority Order**: Uses `large` (800px) → `full` (original) → fallback to `image_url`
- **Optimization**: Automatically selects best available quality for main display

### Image Variants
- **Thumbnail**: 150px width for grid views
- **Medium**: 400px width for standard displays
- **Large**: 800px width for hero images and detailed views
- **Full**: Original resolution for maximum quality

## Upload Behavior

### Drag and Drop
- **Visual Feedback**: Border changes color on drag hover
- **File Limit**: Supports up to 200 files in a single upload
- **File Types**: Accepts images and PDFs (for document category)
- **Size Limit**: Maximum 10MB per file

### Metadata Extraction
- **EXIF Data**: Extracts camera settings, GPS location, and date taken
- **Timeline Integration**: Uses photo date for proper timeline placement
- **Fallback Dates**: Uses file modified date if EXIF date unavailable

## Modal Interactions

### Timeline Event Modal
- **Action Buttons**: All buttons have click handlers with functionality indicators
- **Available Actions**:
  - Add Technician Details
  - Add Work Details
  - Correct Information
  - Tag People

### Image Lightbox
- **Full Screen View**: Click any image to open in lightbox
- **Navigation**: Arrow keys or click controls to browse images
- **Overlay Controls**: Delete and Info buttons visible on hover
- **Keyboard Support**: ESC key closes lightbox

## Access Control

### Delete Permissions
- **Uploaders**: Can delete images they uploaded
- **Vehicle Owners**: Can delete any image on their vehicles
- **Visual Indicator**: Delete button only appears for authorized users

### Image Categories
- **General**: Standard vehicle photos
- **Document**: PDFs and document images
- **Primary**: First uploaded image becomes hero image automatically

## Performance Optimizations

### Lazy Loading
- **Intersection Observer**: Images load when entering viewport
- **Preloading**: Higher quality variants preload on hover
- **Caching**: 1-hour cache control on all images

### Variant Generation
- **Automatic**: Creates multiple sizes during upload
- **Fallback Handling**: Uses original if variant generation fails
- **Progressive Loading**: Shows thumbnail first, upgrades to higher quality

## Error Handling

### Upload Failures
- **Storage Cleanup**: Removes uploaded files if database insert fails
- **User Feedback**: Clear error messages for common issues
- **Graceful Degradation**: Continues with original if optimization fails

### Display Failures
- **Fallback URLs**: Attempts multiple variant URLs before failing
- **Error States**: Shows placeholder with loading icon
- **Retry Logic**: Automatic retry for failed image loads