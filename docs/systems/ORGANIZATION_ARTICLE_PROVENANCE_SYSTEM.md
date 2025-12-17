# Organization Article Provenance System

## Overview

Build organization provenance the same way we build vehicle provenance. Articles, blog posts, press releases, and news about organizations create timeline events with extracted images, building a rich historical record.

## Goal

Transform organizations from static profiles into living entities with documented history, milestones, and visual provenance—just like vehicles have timelines with photos, receipts, and work history.

## Architecture

### 1. Article Discovery Pipeline

```
Article URL (manual or auto-discovered)
    ↓
Edge Function: discover-org-articles
    ↓
Extract HTML (Firecrawl or direct fetch)
    ↓
Extract Images (similar to vehicle scraping)
    ↓
Extract Metadata (title, description, published date)
    ↓
Create business_timeline_events
    ↓
Store images in image_urls array
```

### 2. Database Schema

**`business_timeline_events`** (already exists):
- `image_urls TEXT[]` - Array of image URLs from article
- `documentation_urls TEXT[]` - Source article URL
- `metadata->source_type: 'article'` - Marks as article-sourced
- `metadata->auto_discovered: true/false` - Manual vs automated

**`organization_article_queue`** (new):
- Tracks articles being processed
- Prevents duplicate processing
- Links to created timeline events
- Supports batch discovery workflows

### 3. Image Extraction Strategy

Uses same patterns as vehicle scraping:
- OG/Twitter meta images (highest quality)
- JSON-LD structured data images
- Standard `<img>` tags
- Data attributes (lazy loading)
- Filters out icons, logos, avatars, tiny images
- Limits to top 20 images per article

### 4. UI Components

**Timeline Display**:
- Shows article images in grid (up to 6 visible)
- Click images to view full size
- Source article link below images
- Chronological ordering by `event_date`

**Add Article Button**:
- Located in Contributors timeline section
- Prompts for article URL
- Calls edge function to process
- Shows success/error feedback

## Implementation Status

### ✅ Completed

1. Edge function: `supabase/functions/discover-org-articles/index.ts`
   - Extracts images from HTML
   - Creates timeline events
   - Deduplicates by URL
   - Supports Firecrawl or direct fetch

2. Database queue: `organization_article_queue` table
   - Tracks processing status
   - Prevents duplicates
   - Links to timeline events

3. UI integration:
   - "Add Article" button in timeline
   - Image grid display in events
   - Source article links
   - Timeline query includes `image_urls`

### 🚧 Future: Automated Discovery

**Phase 1: Organization Website Discovery**
- Scan org's blog/news sections (`/blog/`, `/news/`, `/press/`, `/articles/`, `/about/`, `/history/`)
- Extract article links from index pages
- Process each article automatically

**Phase 2: External Search**
- Search queries: `"[org name] history"`, `"[org name] story"`, `"[org name] founded"`
- Google News API integration
- Press release aggregators
- Industry publication searches

**Phase 3: RSS/Feed Monitoring**
- Monitor organization RSS feeds
- Auto-process new articles
- Schedule periodic discovery runs

**Phase 4: AI-Enhanced Discovery**
- Use AI to identify relevant articles
- Score relevance (history > news > mentions)
- Filter out irrelevant content
- Extract key milestones automatically

## Usage Examples

### Manual Addition

1. User clicks "Add Article" button
2. Pastes article URL (e.g., `https://bringatrailer.com/2025/12/16/the-history-of-bring-a-trailer/`)
3. System extracts images and metadata
4. Creates timeline event with images
5. Appears in organization timeline

### Automated Discovery (Future)

```typescript
// Trigger discovery for an organization
POST /functions/v1/discover-org-articles
{
  "organizationId": "bd035ea4-75f0-4b17-ad02-aee06283343f",
  "discover": true
}

// System will:
// 1. Check org website for blog/news sections
// 2. Extract article links
// 3. Process each article
// 4. Create timeline events with images
```

## Data Flow

### Article → Timeline Event

```typescript
{
  business_id: "bd035ea4-75f0-4b17-ad02-aee06283343f",
  event_type: "milestone_reached",
  event_category: "recognition",
  title: "The History of Bring a Trailer",
  description: "Article about Bring a Trailer",
  event_date: "2025-12-16",
  image_urls: [
    "https://bringatrailer.com/wp-content/uploads/2025/12/bat-history-1.jpg",
    "https://bringatrailer.com/wp-content/uploads/2025/12/bat-history-2.jpg",
    // ... more images
  ],
  documentation_urls: ["https://bringatrailer.com/2025/12/16/the-history-of-bring-a-trailer/"],
  metadata: {
    source_url: "https://bringatrailer.com/2025/12/16/the-history-of-bring-a-trailer/",
    source_type: "article",
    image_count: 12,
    auto_discovered: false
  }
}
```

## Benefits

1. **Rich Provenance**: Organizations gain visual history like vehicles
2. **Automatic Discovery**: Can find articles without manual input
3. **Image Preservation**: Extracts images before they disappear
4. **Chronological Record**: Timeline shows org evolution over time
5. **Source Attribution**: Links back to original articles
6. **Searchable History**: All events queryable and filterable

## Edge Cases

- **No Images**: Skip article if no images found (can be configurable)
- **Duplicate URLs**: Dedupe by `metadata->source_url`
- **Broken Links**: Handle gracefully, mark as failed in queue
- **Large Articles**: Limit to top 20 images to avoid bloat
- **Authentication**: Use service role for automated events

## Future Enhancements

1. **Image Quality Scoring**: Prioritize high-res images
2. **Content Analysis**: Extract key facts, dates, people mentioned
3. **Multi-Language**: Support articles in different languages
4. **Video Extraction**: Extract video URLs from articles
5. **Social Media**: Integrate Twitter/LinkedIn posts about org
6. **Archive Integration**: Wayback Machine for historical articles
7. **AI Summarization**: Generate timeline event descriptions from article content

## Related Systems

- **Vehicle Timeline System**: Similar provenance model for vehicles
- **Image Extraction**: Reuses patterns from vehicle scraping
- **Organization Intelligence**: Can use article data for org classification
- **Contributor System**: Articles can be attributed to contributors

## Files

- `supabase/functions/discover-org-articles/index.ts` - Main edge function
- `supabase/migrations/.../add_org_article_discovery_queue.sql` - Queue table
- `nuke_frontend/src/pages/OrganizationProfile.tsx` - UI integration
- `nuke_frontend/src/components/organization/OrganizationTimeline.tsx` - Timeline display

## Notes

- Uses same image extraction patterns as vehicle scraping (proven, reliable)
- Firecrawl optional but recommended for JS-heavy sites
- Timeline events support `image_urls` array (already in schema)
- Can be extended to support other content types (videos, PDFs, etc.)


