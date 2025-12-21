# Content Creator Ingestion - Implementation Summary

## Overview
This document summarizes the complete strategy for ingesting data from automotive content creators and linking their content to vehicles in the Nuke platform.

## Documents Created

1. **CONTENT_CREATOR_INGESTION_STRATEGY.md** - Comprehensive technical strategy
   - Data ingestion methods (APIs, scraping, AI)
   - Vehicle-content linking approaches
   - Database schema design
   - Implementation workflow
   - Technical considerations

2. **AUTOMOTIVE_INFLUENCERS_LIST.md** - Curated influencer database
   - 50+ automotive content creators
   - Organized by platform and category
   - Prioritized by ingestion value
   - Platform-specific notes

3. **20250122_content_creator_system.sql** - Database migration
   - New tables: `content_creator_profiles`, `creator_content`, `content_vehicle_links`
   - Extends existing `external_identities` table
   - Helper functions and views
   - RLS policies

## Key Components

### Database Schema

#### New Tables
1. **`user_content`**
   - Stores individual content items (videos, posts) from users or organizations
   - Links to `user_id` OR `organization_id` (one must be set)
   - Links to `external_identities` for platform account (YouTube channel, etc.)
   - Tracks engagement metrics (views, likes, comments)
   - Vehicle detection metadata
   - Status tracking (pending_review, verified, etc.)
   - **Key Principle**: Content creators are users/organizations, not separate entities

2. **`content_vehicle_links`**
   - Links content to vehicles
   - Supports multiple vehicles per content
   - Confidence scoring and verification
   - Link types: primary, secondary, mentioned, related

#### Existing Tables Used
- **`profiles`**: User profiles (content creators are users)
- **`businesses`**: Organizations (users can create organizations)
- **`external_identities`**: Platform accounts (YouTube, TikTok, Instagram, etc.)
- **`organization_vehicles`**: Links vehicles to organizations (data sources)

### Vehicle Detection Methods

1. **Automatic (High Confidence)**
   - Title/description parsing (regex + LLM)
   - VIN detection
   - License plate OCR
   - Image recognition

2. **Semi-Automatic (Medium Confidence)**
   - Fuzzy matching (make/model/year)
   - Temporal proximity
   - Location matching

3. **Manual (Review Queue)**
   - User interface for review
   - Community contributions
   - Verification workflow

### Platform Integration

#### YouTube (Primary)
- **API**: YouTube Data API v3
- **Rate Limits**: 10,000 units/day (free), 1M/day (paid)
- **Data Available**: Full metadata, transcripts, comments
- **Priority**: Highest - best API access

#### TikTok (Secondary)
- **API**: Research API (limited access)
- **Fallback**: Web scraping
- **Data Available**: Basic metadata, engagement stats
- **Priority**: Medium - may need scraping

#### Instagram (Secondary)
- **API**: Graph API
- **Rate Limits**: 200 calls/hour
- **Data Available**: Posts, stories (limited), engagement
- **Priority**: Medium - good for visual content

#### Twitter/X (Tertiary)
- **API**: API v2 (paid tiers)
- **Data Available**: Tweets, engagement, media
- **Priority**: Low - less vehicle-specific content

## Implementation Roadmap

### Phase 1: MVP (Weeks 1-4)
1. **Database Setup**
   - Run migration: `20250122_content_creator_system.sql`
   - Verify tables and indexes
   - Test helper functions

2. **YouTube Integration**
   - Set up YouTube Data API credentials
   - Create Edge Function for YouTube ingestion
   - Implement basic channel/video sync
   - Title-based vehicle detection

3. **Basic UI**
   - Content creator profile pages
   - Content listing with vehicle links
   - Manual linking interface

### Phase 2: Enhanced Detection (Weeks 5-8)
1. **Multi-Platform Support**
   - Instagram integration
   - TikTok integration (or scraping)

2. **Advanced Detection**
   - Image recognition (OpenAI Vision)
   - Transcript analysis (Whisper API)
   - Fuzzy vehicle matching

3. **Review Queue**
   - Dashboard for pending reviews
   - Bulk operations
   - Confidence-based prioritization

### Phase 3: Advanced Features (Weeks 9-12)
1. **Real-Time Monitoring**
   - Webhook integration (where available)
   - Scheduled sync jobs
   - Change detection

2. **Community Features**
   - User contributions
   - Voting/consensus system
   - Moderation tools

3. **Analytics**
   - Creator performance metrics
   - Vehicle popularity tracking
   - Content engagement analysis

## Priority Creators (Start Here)

### Tier 1 - High Value
1. **Doug DeMuro** - Reviews specific vehicles, clear identification
2. **Hoovie's Garage** - Owns specific cars, documents ownership
3. **Tavarish** - Repairs specific supercars, detailed documentation
4. **B is for Build** - Builds specific project cars, clear vehicle tracking
5. **Vice Grip Garage** - Rescues specific barn finds, vehicle identification
6. **Supercar Blondie** - Features specific vehicles, clear identification
7. **Shmee150** - Owns specific collection cars, clear ownership

### Tier 2 - Medium Value
- Throttle House
- TheStraightPipes
- Savagegeese
- Carwow
- Mighty Car Mods
- Finnegan's Garage

## Technical Architecture

### Ingestion Flow
```
1. Discovery
   └─> Identify creators (manual list + auto-discovery)
   └─> Create external_identity records
   └─> Create content_creator_profile records

2. Content Collection
   └─> API polling (daily for new, weekly for stats)
   └─> Create creator_content records
   └─> Download thumbnails to Supabase Storage

3. Vehicle Detection
   └─> Automatic processing (title/description/image)
   └─> Queue for review (medium confidence)
   └─> Manual review (low confidence)

4. Linking & Verification
   └─> Auto-link (high confidence)
   └─> Create content_vehicle_links
   └─> Update vehicle timeline

5. Ongoing Sync
   └─> Regular updates (daily/weekly/monthly)
   └─> Engagement tracking
   └─> Vehicle popularity metrics
```

### Edge Functions Needed

1. **`sync-youtube-creator`**
   - Syncs YouTube channel data
   - Fetches new videos
   - Updates stats
   - Triggers vehicle detection

2. **`detect-vehicles-in-content`**
   - Processes content for vehicle detection
   - Uses multiple methods (title, description, image, transcript)
   - Creates content_vehicle_links with confidence scores

3. **`sync-creator-stats`**
   - Updates creator profile stats
   - Runs on schedule (weekly)
   - Updates engagement metrics

## Success Metrics

1. **Coverage**
   - Number of creators tracked: Target 50+ in first 3 months
   - Content items ingested: Target 1,000+ in first month
   - Vehicle-content links: Target 500+ verified links

2. **Accuracy**
   - Auto-detection success rate: Target 70%+ high confidence
   - Manual review queue size: Keep under 100 items
   - User corrections: Track and minimize

3. **Engagement**
   - Content views on Nuke: Track unique views
   - User interactions: Track clicks, shares
   - Vehicle profile views from content: Track referrals

4. **Value**
   - Unique vehicle data discovered: Track new vehicles from content
   - Timeline events enriched: Track events added from content
   - User engagement increase: Track overall platform engagement

## Next Steps

1. **Review and Approve**
   - Review strategy document
   - Review influencer list
   - Review database schema

2. **Set Up Infrastructure**
   - Run database migration
   - Set up API credentials (YouTube, Instagram, etc.)
   - Create Edge Function scaffolding

3. **Start with Tier 1 Creators**
   - Begin with Doug DeMuro (high value, clear vehicle identification)
   - Implement basic YouTube sync
   - Test vehicle detection pipeline

4. **Iterate and Expand**
   - Refine detection algorithms
   - Add more creators
   - Expand to other platforms

## Questions to Resolve

1. **API Rate Limits**
   - How to handle YouTube quota limits?
   - Should we prioritize certain creators?
   - Do we need paid API tiers?

2. **Vehicle Detection Confidence**
   - What confidence threshold for auto-linking?
   - How to handle ambiguous content?
   - Manual review process?

3. **Content Storage**
   - Store thumbnails in Supabase Storage?
   - CDN for content delivery?
   - Archive old content?

4. **Privacy & Compliance**
   - Public content only?
   - Attribution requirements?
   - GDPR/CCPA considerations?

5. **Community Features**
   - Allow users to link content?
   - Voting/consensus system?
   - Moderation workflow?

## Resources

- **Strategy Document**: `docs/systems/CONTENT_CREATOR_INGESTION_STRATEGY.md`
- **Influencer List**: `docs/data/AUTOMOTIVE_INFLUENCERS_LIST.md`
- **Database Migration**: `supabase/migrations/20250122_content_creator_system.sql`
- **Existing External Identities**: `supabase/migrations/20251214_external_identities_and_claims.sql`

