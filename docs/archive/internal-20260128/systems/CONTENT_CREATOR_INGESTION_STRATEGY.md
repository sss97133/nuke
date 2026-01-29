# Content Creator Ingestion Strategy

## Overview
Ingest data from automotive content creators (YouTubers, TikTokers, Instagram influencers, etc.) and link their content to the original vehicles featured in that content.

## Current Foundation

### Existing Infrastructure
- **`profiles` table**: User profiles (content creators are just users)
- **`businesses` table**: Organizations (users can create organizations)
- **`external_identities` table**: Already supports platforms like 'youtube', 'instagram', 'tiktok'
- **`external_identity_claims`**: Proof-backed claiming system for linking external accounts to N-Zero users
- **`vehicles` table**: Comprehensive vehicle data with provenance tracking
- **`organization_vehicles`**: Links vehicles to organizations (data sources)
- **`timeline_events`**: Vehicle history tracking
- **`external_listings`**: External content source tracking

### Architecture Principle
- **Content creators are users** who may have organizations
- **Both users and organizations** are sources of data for vehicles
- **Content is a data source** like receipts, listings, etc.
- No separate "creator profile" system - use existing user/organization model

## Data Ingestion Strategies

### 1. Platform APIs (Primary Method)

#### YouTube Data API v3
**What to Extract:**
- Channel metadata (subscriber count, view count, creation date)
- Video metadata (title, description, publish date, view count, like count, comment count)
- Video thumbnails and transcripts
- Playlists and series
- Comments (for vehicle mentions)

**Key Endpoints:**
- `channels.list` - Channel info
- `search.list` - Search videos by keywords
- `videos.list` - Video details
- `playlists.list` - Playlist contents
- `commentThreads.list` - Comments

**Rate Limits:** 10,000 units/day (free tier), 1M units/day (paid)

**Vehicle Detection Methods:**
- Title parsing: "2020 Porsche 911 Review"
- Description analysis: Extract VINs, make/model/year mentions
- Video transcripts: AI-powered vehicle identification
- Thumbnail OCR: License plates, VIN tags
- Comments: User mentions of vehicle details

#### TikTok API (Research API)
**What to Extract:**
- User profile (follower count, video count)
- Video metadata (views, likes, shares, comments)
- Video captions and hashtags
- Video URLs and thumbnails

**Vehicle Detection:**
- Hashtag analysis: #porsche911 #restoration
- Caption parsing: Vehicle mentions
- Visual AI: Vehicle recognition in thumbnails/videos

**Limitations:** TikTok API access is restricted; may need web scraping fallback

#### Instagram Graph API
**What to Extract:**
- Profile metadata (followers, posts count)
- Post metadata (likes, comments, caption, location)
- Post media (images, videos)
- Stories (if available via API)

**Vehicle Detection:**
- Caption analysis
- Image recognition (vehicle detection AI)
- Location tags (car shows, meets)
- Hashtags

**Rate Limits:** 200 calls/hour per user token

#### Twitter/X API v2
**What to Extract:**
- User profile (followers, tweet count)
- Tweets (text, media, engagement metrics)
- Threads and replies

**Vehicle Detection:**
- Tweet text analysis
- Media recognition
- Hashtags and mentions

### 2. Web Scraping (Fallback/Supplement)

**When to Use:**
- Platform doesn't offer API
- API rate limits exceeded
- Need historical data not available via API
- Real-time monitoring beyond API capabilities

**Tools:**
- Firecrawl (already in use for BaT scraping)
- Puppeteer/Playwright for dynamic content
- Scrapy for large-scale scraping

**Ethical Considerations:**
- Respect robots.txt
- Rate limiting
- Terms of service compliance
- Data retention policies

### 3. AI-Powered Vehicle Detection

**Multi-Modal Approach:**
1. **Text Analysis (LLM)**
   - Parse titles, descriptions, captions
   - Extract: make, model, year, VIN, license plate
   - Confidence scoring

2. **Image Recognition (Vision AI)**
   - Vehicle detection in thumbnails/thumbnails
   - License plate OCR
   - VIN tag recognition
   - Make/model classification

3. **Video Analysis**
   - Frame extraction at key moments
   - Vehicle appearance detection
   - License plate tracking across frames
   - Audio transcription for vehicle mentions

**Implementation:**
- Use existing `extract-and-route-data` Edge Function pattern
- OpenAI Vision API for image analysis
- Whisper API for video transcription
- Custom vehicle recognition model (future)

### 4. Manual Claiming/Verification

**User-Driven:**
- Content creators claim their external identities
- Link their YouTube/TikTok/Instagram accounts
- Verify ownership via profile link or screenshot
- Auto-populate content library

**Community-Driven:**
- Users tag vehicles in creator content
- Crowdsourced vehicle identification
- Verification through consensus

## Data Model Extensions

### New Tables Needed

```sql
CREATE TABLE user_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Source: User or Organization (one must be set)
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  external_identity_id UUID REFERENCES external_identities(id) ON DELETE SET NULL,
  
  -- Content Metadata
  platform TEXT NOT NULL, -- 'youtube', 'tiktok', 'instagram', 'twitter'
  content_type TEXT NOT NULL, -- 'video', 'post', 'story', 'reel'
  external_content_id TEXT NOT NULL, -- Platform's ID
  content_url TEXT NOT NULL,
  title TEXT,
  description TEXT,
  thumbnail_url TEXT,
  
  -- Engagement
  view_count INTEGER DEFAULT 0,
  like_count INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,
  share_count INTEGER DEFAULT 0,
  
  -- Timing
  published_at TIMESTAMPTZ,
  discovered_at TIMESTAMPTZ DEFAULT NOW(),
  last_synced_at TIMESTAMPTZ,
  
  -- Vehicle Linkage (nullable - content may not feature specific vehicle)
  primary_vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  
  -- Detection Metadata
  vehicle_detection_confidence NUMERIC(3,2) DEFAULT 0.0,
  detection_method TEXT, -- 'title_parse', 'description_parse', 'image_recognition', 'transcript', 'manual'
  detected_vehicle_data JSONB, -- Raw detection results
  
  -- Status
  status TEXT DEFAULT 'pending_review' CHECK (status IN (
    'pending_review', -- Needs human verification
    'verified',       -- Vehicle link confirmed
    'no_vehicle',     -- Content doesn't feature specific vehicle
    'unclear'         -- Couldn't determine vehicle
  )),
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT user_content_source_check CHECK (
    (user_id IS NOT NULL AND organization_id IS NULL) OR
    (user_id IS NULL AND organization_id IS NOT NULL)
  ),
  UNIQUE(platform, external_content_id)
);
```

**Note:** Content creators are users (or organizations). No separate creator profile table needed. Stats can be stored in `external_identities.metadata` if needed.

#### `content_vehicle_links`
```sql
CREATE TABLE content_vehicle_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id UUID REFERENCES creator_content(id) ON DELETE CASCADE,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  
  -- Link Details
  link_type TEXT NOT NULL CHECK (link_type IN (
    'primary',      -- Main vehicle featured
    'secondary',    -- Vehicle appears but not focus
    'mentioned',    -- Vehicle mentioned in text
    'related'       -- Related vehicle (same owner, similar model)
  )),
  
  -- Detection Info
  confidence NUMERIC(3,2) DEFAULT 0.0,
  detection_method TEXT,
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Verification
  verified_by UUID REFERENCES auth.users(id),
  verified_at TIMESTAMPTZ,
  verification_notes TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(content_id, vehicle_id, link_type)
);
```

#### `content_extraction_queue`
```sql
-- Extends existing content_extraction_queue
-- Add creator_content_id field
ALTER TABLE content_extraction_queue 
ADD COLUMN IF NOT EXISTS creator_content_id UUID REFERENCES creator_content(id) ON DELETE CASCADE;
```

### Extend Existing Tables

#### `external_identities`
- Already supports platforms: 'youtube', 'instagram', 'tiktok', 'twitter'
- Add metadata fields for creator-specific data:
  ```sql
  ALTER TABLE external_identities
  ADD COLUMN IF NOT EXISTS creator_stats JSONB DEFAULT '{}';
  ```

#### `timeline_events`
- Add content creator events:
  ```sql
  -- Extend event_type to include:
  -- 'content_featured', 'content_review', 'content_restoration'
  ```

## Vehicle-Content Linking Methods

### 1. Automatic Detection (High Confidence)

**Title/Description Parsing:**
- Regex patterns: `(\d{4})\s+([A-Z][a-z]+)\s+([A-Z][a-z0-9]+)`
- LLM extraction: "Extract vehicle make, model, year from: {text}"
- VIN detection: 17-character alphanumeric patterns

**Image Recognition (Critical for Instagram):**
- **GPT-4 Vision Analysis**: Primary method for Instagram content
  - Vehicle make/model/year detection
  - License plate OCR → Vehicle lookup
  - VIN tag recognition → Direct vehicle match
  - Distinctive features (modifications, color, damage)
  - Context clues (location, event type)
- **Multi-Image Analysis**: For carousel posts, analyze all images
- **Confidence Scoring**: Based on visual clarity, feature visibility
- **See**: `docs/systems/INSTAGRAM_CONTENT_INGESTION.md` for detailed image-first strategy

**Transcript Analysis:**
- Video transcripts → Vehicle mentions
- Context analysis → Primary vehicle identification

### 2. Semi-Automatic (Medium Confidence)

**Fuzzy Matching:**
- Make/model/year from description → Search vehicles table
- Confidence scoring based on field matches
- Manual review queue for 50-80% confidence

**Temporal Proximity:**
- Content published date vs vehicle timeline events
- Location matching (if available)
- Owner/creator relationship

### 3. Manual Linking (Low Confidence/Review)

**User Interface:**
- Content review dashboard
- Vehicle suggestion based on detection
- One-click link confirmation
- Bulk linking tools

**Community Contribution:**
- Users can link content to vehicles
- Voting/consensus system
- Moderation for accuracy

## Ingestion Workflow

### Phase 1: Discovery
1. **Influencer Identification**
   - Start with provided list
   - Auto-discover via platform search
   - Community submissions

2. **Profile Creation**
   - Create `external_identity` record
   - Create `content_creator_profile` record
   - Initial stats sync

### Phase 2: Content Collection
1. **API Polling**
   - Daily sync for new content
   - Weekly full stats update
   - Respect rate limits

2. **Content Storage**
   - Create `creator_content` records
   - Store metadata and engagement metrics
   - Download thumbnails to Supabase Storage

### Phase 3: Vehicle Detection
1. **Automatic Processing**
   - Title/description parsing
   - Image recognition (if available)
   - Transcript analysis (if available)

2. **Queue for Review**
   - High confidence → Auto-link
   - Medium confidence → Review queue
   - Low confidence → Manual review

### Phase 4: Linking & Verification
1. **Auto-Linking**
   - High confidence matches → Direct link
   - Create `content_vehicle_links` records
   - Update vehicle timeline

2. **Manual Review**
   - Review queue interface
   - Vehicle suggestion UI
   - Bulk operations

### Phase 5: Ongoing Sync
1. **Regular Updates**
   - Daily: New content check
   - Weekly: Stats refresh
   - Monthly: Full content audit

2. **Engagement Tracking**
   - Update view/like/comment counts
   - Track trending content
   - Vehicle popularity metrics

## Implementation Priority

### MVP (Minimum Viable Product)
1. **YouTube Integration**
   - YouTube Data API setup
   - Basic channel/video ingestion
   - Title-based vehicle detection

2. **Database Schema**
   - Create new tables
   - Extend existing tables

3. **Basic UI**
   - Content creator profile pages
   - Content listing with vehicle links
   - Manual linking interface

### Phase 2
1. **Multi-Platform Support**
   - Instagram integration
   - TikTok integration (if API available)

2. **Enhanced Detection**
   - Image recognition
   - Transcript analysis
   - Fuzzy matching

### Phase 3
1. **Advanced Features**
   - Video frame analysis
   - Real-time content monitoring
   - Community contribution tools
   - Analytics dashboard

## Technical Considerations

### Rate Limiting
- Implement exponential backoff
- Queue-based processing
- Batch API calls where possible
- Cache frequently accessed data

### Data Storage
- Store thumbnails in Supabase Storage
- Use CDN for content delivery
- Archive old content metadata
- Compress JSONB metadata

### Performance
- Index on `creator_content(platform, external_content_id)`
- Index on `content_vehicle_links(vehicle_id, content_id)`
- Materialized views for popular queries
- Background job processing

### Privacy & Compliance
- Respect platform ToS
- Handle user data per GDPR/CCPA
- Public content only (no private posts)
- Attribution requirements

## Success Metrics

1. **Coverage**
   - Number of creators tracked
   - Content items ingested
   - Vehicle-content links created

2. **Accuracy**
   - Auto-detection success rate
   - Manual review queue size
   - User corrections count

3. **Engagement**
   - Content views on N-Zero
   - User interactions with creator content
   - Vehicle profile views from content

4. **Value**
   - Unique vehicle data discovered
   - Timeline events enriched
   - User engagement increase

