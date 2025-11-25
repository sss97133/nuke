# Image Info Panel - Wireframe & Data Specification

## Overview
The Image Info Panel displays contextual metadata about an image when swiped up in the mobile lightbox. **No emojis, no headers** - just clean data separated by dividers.

---

## Wireframe: Peek State (50% height)

```
┌─────────────────────────────────────┐
│             [IMAGE]                 │ ← 50% visible
├─────────────────────────────────────┤
│ ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ │
│ May 17, 2022 • 3:45 PM              │ ← Date/Time
│ San Francisco, CA                   │ ← Location (city, state)
│                                     │
│ iPhone 13 Pro Max                   │ ← Camera (make + model)
│ f/1.5 • 1/120s • ISO 100            │ ← EXIF (focal, f-stop, shutter, ISO)
│                                     │
│ @skylar • 2 days ago                │ ← Attribution (photographer/uploader)
│                                     │
│ engine bay • front • detail         │ ← Tags (spatial + AI)
│                                     │
│ 3 comments • 24 views               │ ← Stats
└─────────────────────────────────────┘
```

---

## Wireframe: Full State (90% height) with Tabs

```
┌──────────────┐
│   [IMAGE]    │ ← 10% thumbnail
├──────────────┤
│ ▔▔▔▔▔▔▔▔▔▔▔ │
├──────────────┴──────────────────────┐
│ [INFO] [TAGS] [COMMENTS] [ACTIONS] │ ← Tabs
├─────────────────────────────────────┤
│                                     │
│ (Full details with tabs)            │
│                                     │
└─────────────────────────────────────┘
```

---

## Data Structure

### 1. Date/Time
**Source**: `imageMetadata.created_at` or `imageMetadata.taken_at`
**Display**: 
- Primary: `"May 17, 2022 • 3:45 PM"` (formatted date + time)
- Secondary: `"2 days ago"` (relative time)

**Code Location**: `ImageInfoPanel.tsx` lines 131-144

---

### 2. Location
**Source**: `imageMetadata.exif_data.location` or `imageMetadata.exif_data.gps`
**Display Priority**:
1. City + State: `"San Francisco, CA"`
2. GPS Coordinates: `"37.7749, -122.4194"` (if no city/state)
3. Organization name (if available)

**Code Location**: `ImageInfoPanel.tsx` lines 148-168

---

### 3. Camera/EXIF
**Source**: `imageMetadata.exif_data.camera` and EXIF fields
**Display**:
- Camera: `"iPhone 13 Pro Max"` (make + model)
- EXIF: `"f/1.5 • 1/120s • ISO 100"` (focal length, f-stop, shutter, ISO)
- Dimensions: `"4032 × 3024"` (width × height)

**Code Location**: `ImageInfoPanel.tsx` lines 171-191

---

### 4. Attribution
**Source**: `attribution.photographer` or `attribution.uploader`
**Display**:
- Photographer name (from ghost_users or EXIF)
- Uploader name (from profiles)
- Source: `"dropbox_import"`, `"manual_upload"`, etc.

**Code Location**: `ImageInfoPanel.tsx` lines 194-211

---

### 5. Tags
**Source**: `tags` array (from `useImageTags` hook)
**Display**: 
- Peek: `"engine bay • front • detail"` (first 5 tags, joined with •)
- Full: Individual tag badges in TAGS tab

**Code Location**: `ImageInfoPanel.tsx` lines 226-233 (peek), 252-294 (full)

---

### 6. Stats
**Source**: `imageMetadata.view_count`, `imageMetadata.comment_count`, `comments.length`
**Display**: `"3 comments • 24 views"`

**Code Location**: `ImageInfoPanel.tsx` lines 214-223

---

### 7. AI Analysis
**Source**: `imageMetadata.ai_scan_metadata.appraiser`
**Display**:
- Angle: `"engine bay • front • detail"`
- Description: Full AI-generated description
- Model: `"GPT-4o"` (which AI model analyzed it)

**Code Location**: `ImageInfoPanel.tsx` lines 236-248

---

## Data Flow

```
ImageGallery
  └─> ImageLightbox
       ├─> loadImageMetadata() → sets imageMetadata, attribution
       ├─> useImageTags(imageId) → sets tags
       ├─> loadImageMetadata() → loads comments from vehicle_image_comments
       └─> ImageInfoPanel
            ├─> imageMetadata (from state)
            ├─> attribution (from state)
            ├─> tags (from hook)
            └─> comments (from state)
```

---

## Current Implementation Status

### ✅ Working
- Date/Time display
- Location display (with type checking)
- Camera/EXIF display
- Attribution display
- Tags display
- Stats display
- AI Analysis display

### ⚠️ Potential Issues
1. **Comments format**: `ImageInfoPanel` expects `comments` array with `username`, `created_at`, `comment_text`
   - But `ImageLightbox` loads comments with `user` object, not `username`
   - Need to transform: `comment.user?.full_name || comment.user?.username || 'User'`

2. **Tags format**: `ImageInfoPanel` expects `tag.tag_text || tag.tag_name`
   - But `useImageTags` might return different structure
   - Need to verify tag structure matches

3. **Attribution format**: `ImageInfoPanel` expects `attribution.photographer.name` and `attribution.uploader.full_name`
   - `ImageLightbox` sets `attribution.photographer.name` and `attribution.uploader` (profile object)
   - This should work, but verify

---

## Expected Data Structure

### imageMetadata
```typescript
{
  id: string;
  created_at: string;
  taken_at?: string;
  is_primary: boolean;
  view_count?: number;
  comment_count?: number;
  exif_data: {
    gps?: {
      latitude: number;
      longitude: number;
    };
    location?: {
      city?: string;
      state?: string;
      latitude?: number;
      longitude?: number;
      organization_name?: string;
    } | string; // Can be string or object
    camera?: {
      make?: string;
      model?: string;
    } | string; // Can be string or object
    focalLength?: number;
    fNumber?: number;
    exposureTime?: string;
    iso?: number;
    dimensions?: {
      width: number;
      height: number;
    };
  };
  ai_scan_metadata?: {
    appraiser?: {
      angle?: string;
      description?: string;
      model?: string;
      context?: string;
      analyzed_at?: string;
    };
  };
}
```

### attribution
```typescript
{
  photographer?: {
    name: string;
    camera?: string;
    isGhost?: boolean;
    confidence?: number;
  };
  uploader?: {
    id: string;
    full_name?: string;
    username?: string;
    avatar_url?: string;
  };
  source?: string;
}
```

### tags
```typescript
Array<{
  id: string;
  tag_text?: string;
  tag_name?: string;
  x_position?: number;
  y_position?: number;
  // ... other tag fields
}>
```

### comments
```typescript
Array<{
  id: string;
  user_id: string;
  comment_text: string;
  created_at: string;
  user?: {
    id: string;
    full_name?: string;
    username?: string;
    avatar_url?: string;
  };
  // OR (if transformed):
  username?: string; // transformed from user.username
}>
```

---

## Fixes Needed

1. **Transform comments** in `ImageInfoPanel` to match expected format:
   ```typescript
   const transformedComments = comments.map(c => ({
     ...c,
     username: c.user?.username || c.user?.full_name || 'User',
     created_at: c.created_at // format if needed
   }));
   ```

2. **Verify tag structure** matches what `ImageInfoPanel` expects

3. **Add error handling** for missing/null data

4. **Add loading states** while data is being fetched

