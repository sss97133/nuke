# Quick Start: Content Creator Ingestion

## Overview
This guide provides a quick start for implementing content creator ingestion in the Nuke platform.

## Step 1: Database Setup

Run the migration to create the necessary tables:

```bash
# Apply the migration
supabase migration up 20250122_content_creator_system
```

Or via Supabase Dashboard:
1. Go to SQL Editor
2. Run the contents of `supabase/migrations/20250122_content_creator_system.sql`

## Step 2: Set Up API Credentials

### YouTube Data API
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable YouTube Data API v3
4. Create credentials (API Key)
5. Add to Supabase Edge Function secrets:
   - `YOUTUBE_API_KEY`

### Instagram Graph API (Optional)
1. Go to [Meta for Developers](https://developers.facebook.com/)
2. Create an app
3. Get access token
4. Add to Supabase Edge Function secrets:
   - `INSTAGRAM_ACCESS_TOKEN`

## Step 3: Link External Identity to User/Organization

### Via SQL
```sql
-- 1. Create external identity (if user doesn't exist yet, they'll claim it later)
INSERT INTO external_identities (platform, handle, profile_url, display_name)
VALUES ('youtube', 'dougdemuro', 'https://www.youtube.com/@dougdemuro', 'Doug DeMuro')
ON CONFLICT (platform, handle) DO NOTHING
RETURNING id;

-- 2. If user exists and wants to claim this identity:
-- User can claim via external_identity_claims workflow
-- Or if you know the user_id:
UPDATE external_identities 
SET claimed_by_user_id = '<user_id>'::uuid,
    claimed_at = NOW(),
    claim_confidence = 100
WHERE platform = 'youtube' AND handle = 'dougdemuro';

-- 3. Store platform stats in metadata (optional)
UPDATE external_identities
SET metadata = jsonb_build_object(
  'subscriber_count', 5100000,
  'total_views', 2000000000,
  'content_count', 500
)
WHERE platform = 'youtube' AND handle = 'dougdemuro';
```

### Via Edge Function (Future)
```typescript
// Will be implemented in sync-youtube-creator function
```

## Step 4: Test Vehicle Detection

### Manual Test
```sql
-- Create test content (linked to user or organization)
INSERT INTO user_content (
  user_id,  -- OR organization_id (one must be set)
  external_identity_id,
  platform,
  content_type,
  external_content_id,
  content_url,
  title,
  description,
  published_at
)
VALUES (
  '<user_id>'::uuid,  -- User who created this content
  '<external_identity_id>'::uuid,  -- YouTube channel identity
  'youtube',
  'video',
  'test-video-id',
  'https://www.youtube.com/watch?v=test',
  '2020 Porsche 911 Turbo S Review: The Ultimate Daily Driver',
  'In this video, I review the 2020 Porsche 911 Turbo S...',
  NOW()
)
RETURNING id;

-- Test vehicle detection (manual link)
SELECT link_content_to_vehicle(
  '<content_id>'::uuid,
  '<vehicle_id>'::uuid,
  'primary',
  0.9,
  'title_parse'
);
```

## Step 5: View Results

### Check User/Organization Content Stats
```sql
SELECT * FROM user_content_stats
WHERE handle = 'dougdemuro';
```

### Check Vehicle Content
```sql
SELECT * FROM vehicle_content_summary
WHERE make = 'Porsche' AND model = '911';
```

### Check Content Links
```sql
SELECT 
  uc.title,
  uc.content_url,
  v.make,
  v.model,
  v.year,
  cvl.link_type,
  cvl.confidence
FROM user_content uc
JOIN content_vehicle_links cvl ON uc.id = cvl.content_id
JOIN vehicles v ON cvl.vehicle_id = v.id
WHERE uc.user_id = '<user_id>'::uuid  -- OR uc.organization_id = '<org_id>'
ORDER BY uc.published_at DESC;
```

## Step 6: Create Edge Functions (Next Steps)

### sync-youtube-creator
- Fetches channel data from YouTube API
- Creates/updates creator profile
- Fetches new videos
- Triggers vehicle detection

### detect-vehicles-in-content
- Processes content for vehicle detection
- Uses title/description parsing
- Uses image recognition (if available)
- Creates content_vehicle_links

### sync-creator-stats
- Updates creator profile stats
- Runs on schedule (weekly)
- Updates engagement metrics

## Priority Creators to Start With

1. **Doug DeMuro** - @dougdemuro
   - High value, clear vehicle identification
   - Large following (5.1M+ subscribers)
   - Regular content uploads

2. **Hoovie's Garage** - @hooviesgarage
   - Owns specific cars, documents ownership
   - 1.6M+ subscribers
   - Clear vehicle tracking

3. **Tavarish** - @tavarish
   - Repairs specific supercars
   - 1.8M+ subscribers
   - Detailed documentation

## Common Queries

### Find Content Needing Review
```sql
SELECT 
  uc.id,
  uc.title,
  uc.content_url,
  uc.vehicle_detection_confidence,
  ei.handle,
  p.full_name as user_name,
  b.business_name as org_name
FROM user_content uc
LEFT JOIN external_identities ei ON uc.external_identity_id = ei.id
LEFT JOIN profiles p ON uc.user_id = p.id
LEFT JOIN businesses b ON uc.organization_id = b.id
WHERE uc.status = 'pending_review'
ORDER BY uc.vehicle_detection_confidence DESC, uc.published_at DESC
LIMIT 50;
```

### Find High-Confidence Auto-Links
```sql
SELECT 
  uc.title,
  v.make || ' ' || v.model || ' ' || v.year as vehicle,
  cvl.confidence,
  cvl.detection_method
FROM user_content uc
JOIN content_vehicle_links cvl ON uc.id = cvl.content_id
JOIN vehicles v ON cvl.vehicle_id = v.id
WHERE cvl.confidence >= 0.8
ORDER BY cvl.confidence DESC, uc.published_at DESC;
```

### User/Organization Content Performance
```sql
SELECT 
  ei.handle,
  ei.platform,
  ei.metadata->>'subscriber_count' as subscriber_count,
  COUNT(uc.id) as content_count,
  COUNT(DISTINCT cvl.vehicle_id) as vehicles_featured,
  SUM(uc.view_count) as total_views,
  COALESCE(p.full_name, b.business_name) as source_name
FROM user_content uc
JOIN external_identities ei ON uc.external_identity_id = ei.id
LEFT JOIN profiles p ON uc.user_id = p.id
LEFT JOIN businesses b ON uc.organization_id = b.id
LEFT JOIN content_vehicle_links cvl ON uc.id = cvl.content_id
GROUP BY ei.handle, ei.platform, ei.metadata, p.full_name, b.business_name
ORDER BY (ei.metadata->>'subscriber_count')::int DESC NULLS LAST;
```

## Troubleshooting

### Migration Fails
- Check if tables already exist
- Verify Supabase connection
- Check for conflicting constraints

### API Rate Limits
- Implement exponential backoff
- Use batch requests where possible
- Cache frequently accessed data
- Consider paid API tiers

### Vehicle Detection Low Confidence
- Review title/description quality
- Check if vehicle data exists in database
- Consider manual review
- Improve detection algorithms

## Next Steps

1. **Review Documentation**
   - Read `CONTENT_CREATOR_INGESTION_STRATEGY.md` for full strategy
   - Review `AUTOMOTIVE_INFLUENCERS_LIST.md` for creator list

2. **Set Up Infrastructure**
   - Create Edge Functions
   - Set up scheduled jobs
   - Configure API credentials

3. **Start Ingestion**
   - Begin with Tier 1 creators
   - Test vehicle detection
   - Iterate and improve

4. **Build UI**
   - Creator profile pages
   - Content listing
   - Manual linking interface
   - Review queue dashboard

