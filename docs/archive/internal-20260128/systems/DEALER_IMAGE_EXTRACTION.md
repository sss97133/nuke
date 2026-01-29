# Dealer Image Extraction - Logo, Favicon & Primary Image

## Overview

The dealer indexing system extracts three types of images for organizations:

1. **Logo** - Business logo (from Classic.com or website)
2. **Favicon** - Small icon for UI areas (from website)
3. **Primary Image** - Property front/building image (from website)

---

## Image Extraction Flow

```
Classic.com Dealer Profile
    ↓
Extract Logo URL (from Classic.com)
    ↓
Download & Store Logo
    ↓
Extract Website Favicon (from dealer website)
    ↓
Extract Primary Image (property front from website)
    ↓
Store in businesses table
```

---

## 1. Logo Extraction

### Source
- **Primary**: Classic.com profile page (`images.classic.com/uploads/dealer/...`)
- **Fallback**: Website logo if Classic.com logo not found

### Storage
- **Location**: Supabase Storage → `organization-logos/{domain}-logo.{ext}`
- **Database**: `businesses.logo_url`
- **Cached**: `source_favicons` table (for quick lookups)

### Formats Supported
- PNG, JPG, JPEG, SVG

### Example
```
Source: https://images.classic.com/uploads/dealer/One_Eleven_Motorcars.png
↓
Stored: https://supabase.co/storage/.../organization-logos/111motorcars-com-logo.png
↓
Database: businesses.logo_url = "https://supabase.co/storage/.../logo.png"
```

---

## 2. Favicon Extraction

### Purpose
Small icon for UI areas (badges, cards, small displays)

### Source
1. **Website HTML** - Extracts `<link rel="icon">` or `<link rel="shortcut icon">`
2. **Fallback**: Google Favicon Service (cached in `source_favicons`)

### Storage
- **Database**: `source_favicons` table (domain-based caching)
- **Function**: Uses `extractAndCacheFavicon()` from `_shared/extractFavicon.ts`

### Formats Supported
- SVG (preferred), PNG, ICO

### Example
```
Website: https://www.111motorcars.com
↓
Extract: <link rel="icon" href="/favicon.svg">
↓
Cached: source_favicons.favicon_url = "https://www.111motorcars.com/favicon.svg"
```

### Usage in UI
```typescript
// Get favicon for a dealer website
const favicon = await getCachedFavicon(dealer.website);
// Returns: "https://www.111motorcars.com/favicon.svg" or Google service URL
```

---

## 3. Primary Image Extraction (Property Front)

### Purpose
Representative image of the dealer property/building (for profile headers, cards)

### Source
Dealer website homepage - looks for images with keywords:
- `hero`, `about`, `property`, `building`, `facility`, `location`

### Storage
- **Database**: `businesses.cover_image_url`
- **Note**: Keeping expectations low - may not always find property front images

### Formats Supported
- JPG, JPEG, PNG, WebP

### Extraction Logic
```typescript
// Searches HTML for images matching patterns:
/<img[^>]+src="([^"]*hero[^"]*\.(?:jpg|jpeg|png|webp))"[^>]*/i
/<img[^>]+src="([^"]*about[^"]*\.(?:jpg|jpeg|png|webp))"[^>]*/i
/<img[^>]+src="([^"]*property[^"]*\.(?:jpg|jpeg|png|webp))"[^>]*/i
// ... etc
```

### Example
```
Website: https://www.111motorcars.com
↓
Find: <img src="/images/about-us-building.jpg">
↓
Database: businesses.cover_image_url = "https://www.111motorcars.com/images/about-us-building.jpg"
```

---

## Response Format

### Dealer Profile Response (with images)

```json
{
  "success": true,
  "organization_id": "org-uuid",
  "organization_name": "111 Motorcars",
  "logo_url": "https://supabase.co/storage/.../logo.png",
  "favicon_url": "https://www.111motorcars.com/favicon.svg",
  "primary_image_url": "https://www.111motorcars.com/images/building.jpg",
  "dealer_data": { ... },
  "action": "created"
}
```

---

## Database Schema

### businesses table fields:

| Field | Type | Description |
|-------|------|-------------|
| `logo_url` | `TEXT` | Business logo (stored in Supabase Storage) |
| `cover_image_url` | `TEXT` | Primary image (property front) |
| `banner_url` | `TEXT` | Banner image (if exists) |

### source_favicons table:

| Field | Type | Description |
|-------|------|-------------|
| `domain` | `TEXT` | Website domain (unique) |
| `favicon_url` | `TEXT` | Cached favicon URL |
| `source_type` | `TEXT` | `'dealer'`, `'auction'`, etc. |
| `source_name` | `TEXT` | Human-readable name |

---

## Usage in Frontend

### Logo (Large Display)
```typescript
<img src={business.logo_url} alt={business.business_name} />
```

### Favicon (Small UI Areas)
```typescript
// Get from source_favicons table
const favicon = await getCachedFavicon(business.website);
<img src={favicon} className="w-4 h-4" />
```

### Primary Image (Profile Header)
```typescript
<img 
  src={business.cover_image_url || business.logo_url} 
  alt={`${business.business_name} property`}
  className="w-full h-48 object-cover"
/>
```

---

## Current Limitations

1. **Primary Image**: May not always find property front images (keeping expectations low)
2. **Favicon**: Falls back to Google service if website favicon not found
3. **Logo**: Requires Classic.com profile or website logo to be present

---

## Future Enhancements

1. **Better Primary Image Detection**: Use AI to identify property/building images
2. **Image Download & Storage**: Download primary images to Supabase Storage (currently just stores URL)
3. **Multiple Images**: Extract portfolio/gallery images from dealer websites
4. **Image Validation**: Verify images are actually property fronts before using

