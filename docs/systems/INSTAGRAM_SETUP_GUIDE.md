# Instagram Content Ingestion - Setup Guide

## Edge Functions Created

✅ **sync-instagram-organization** - Syncs Instagram posts for an organization
✅ **detect-vehicles-in-content** - Analyzes images and links to vehicles
✅ **backfill-instagram-content** - Historical sync of all posts
✅ **process-instagram-webhook** - Real-time webhook handler

## Setup Steps

### 1. Configure Instagram Graph API

#### Get Instagram Business Account
1. Organization needs Instagram Business or Creator account
2. Account must be connected to a Facebook Page
3. Get Instagram Business Account ID from Meta Business Suite

#### Create Meta App
1. Go to [Meta for Developers](https://developers.facebook.com/)
2. Create new app
3. Add "Instagram Graph API" product
4. Get App ID and App Secret

#### Get Access Token
1. Generate User Access Token with permissions:
   - `instagram_basic`
   - `instagram_content_publish` (if publishing)
   - `pages_read_engagement`
2. Exchange for Long-Lived Token (60 days)
3. Store in environment variable: `INSTAGRAM_ACCESS_TOKEN`

### 2. Set Environment Variables

Add to Supabase Edge Function secrets:

```bash
# Required - Facebook App Credentials
FACEBOOK_APP_ID=9b0118aa9df248469f59c4ce9f1efe91
FACEBOOK_APP_SECRET=your_facebook_app_secret_here

# Required - Instagram Access Token (obtained via OAuth)
INSTAGRAM_ACCESS_TOKEN=your_long_lived_token_here

# Optional (for webhook verification)
INSTAGRAM_WEBHOOK_VERIFY_TOKEN=n-zero-webhook-token
```

**Note**: The `INSTAGRAM_ACCESS_TOKEN` will be automatically stored when users connect via OAuth. You can also manually set it for testing.

### 3. Link Organization to Instagram Account

#### Option A: Via External Identities (Recommended)

```sql
-- 1. Create external identity
INSERT INTO external_identities (
  platform,
  handle,
  profile_url,
  display_name,
  metadata
)
VALUES (
  'instagram',
  'lartdelautomobile',
  'https://www.instagram.com/lartdelautomobile/',
  'L''Art de l''Automobile',
  jsonb_build_object(
    'instagram_account_id', 'YOUR_INSTAGRAM_BUSINESS_ACCOUNT_ID',
    'organization_id', '39773a0e-106c-4afa-ae50-f95cbd74d074'::uuid
  )
)
ON CONFLICT (platform, handle) DO UPDATE
SET metadata = EXCLUDED.metadata;
```

#### Option B: Via API Call

```typescript
// Link external identity to organization
await supabase.functions.invoke('sync-instagram-organization', {
  body: {
    organization_id: '39773a0e-106c-4afa-ae50-f95cbd74d074',
    instagram_handle: 'lartdelautomobile',
    instagram_account_id: 'YOUR_INSTAGRAM_BUSINESS_ACCOUNT_ID'
  }
});
```

### 4. Run Historical Sync

#### One-Time Backfill

```typescript
// Sync all historical posts
await supabase.functions.invoke('backfill-instagram-content', {
  body: {
    organization_id: '39773a0e-106c-4afa-ae50-f95cbd74d074',
    instagram_handle: 'lartdelautomobile',
    instagram_account_id: 'YOUR_INSTAGRAM_BUSINESS_ACCOUNT_ID',
    limit: null // null = all posts, or specify number
  }
});
```

#### Or via SQL (using RPC if created)

```sql
-- If you create an RPC function
SELECT backfill_instagram_content(
  '39773a0e-106c-4afa-ae50-f95cbd74d074'::uuid,
  'lartdelautomobile',
  'YOUR_INSTAGRAM_BUSINESS_ACCOUNT_ID'
);
```

### 5. Set Up Webhook (For Real-Time Sync)

#### Subscribe to Webhooks

1. Go to Meta App Dashboard
2. Webhooks → Instagram
3. Subscribe to `media` field
4. Callback URL: `https://your-project.supabase.co/functions/v1/process-instagram-webhook`
5. Verify Token: `n-zero-webhook-token` (or your custom token)

#### Webhook Verification

The function handles GET requests for verification automatically.

### 6. Ongoing Sync

#### Manual Sync (Latest Posts)

```typescript
await supabase.functions.invoke('sync-instagram-organization', {
  body: {
    organization_id: '39773a0e-106c-4afa-ae50-f95cbd74d074',
    instagram_handle: 'lartdelautomobile',
    limit: 25 // Latest 25 posts
  }
});
```

#### Scheduled Sync (Cron Job)

Create a Supabase cron job to sync daily:

```sql
-- Create cron job for daily sync
SELECT cron.schedule(
  'sync-instagram-daily',
  '0 2 * * *', -- 2 AM daily
  $$
  SELECT net.http_post(
    url := 'https://your-project.supabase.co/functions/v1/sync-instagram-organization',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := jsonb_build_object(
      'organization_id', '39773a0e-106c-4afa-ae50-f95cbd74d074',
      'instagram_handle', 'lartdelautomobile'
    )
  );
  $$
);
```

## Testing

### Test Single Post Sync

```typescript
// Test with a specific post
await supabase.functions.invoke('sync-instagram-organization', {
  body: {
    organization_id: '39773a0e-106c-4afa-ae50-f95cbd74d074',
    instagram_handle: 'lartdelautomobile',
    instagram_account_id: 'YOUR_INSTAGRAM_BUSINESS_ACCOUNT_ID',
    limit: 1
  }
});
```

### Check Results

```sql
-- Check ingested content
SELECT 
  id,
  title,
  content_url,
  platform,
  published_at,
  status,
  vehicle_detection_confidence
FROM user_content
WHERE organization_id = '39773a0e-106c-4afa-ae50-f95cbd74d074'
ORDER BY published_at DESC
LIMIT 10;

-- Check vehicle links
SELECT 
  uc.title,
  v.make || ' ' || v.model || ' ' || v.year as vehicle,
  cvl.confidence,
  cvl.detection_method
FROM content_vehicle_links cvl
JOIN user_content uc ON cvl.content_id = uc.id
JOIN vehicles v ON cvl.vehicle_id = v.id
WHERE uc.organization_id = '39773a0e-106c-4afa-ae50-f95cbd74d074'
ORDER BY uc.published_at DESC;
```

## Troubleshooting

### Error: "Instagram access token not configured"
- Set `INSTAGRAM_ACCESS_TOKEN` in Supabase Edge Function secrets
- Ensure token is long-lived (60 days) and has correct permissions

### Error: "Instagram account ID required"
- Provide `instagram_account_id` in request
- Or store in `external_identities.metadata.instagram_account_id`

### Rate Limits
- Instagram Graph API: 25 calls per user per hour
- Functions include rate limiting delays
- For large backfills, process in smaller batches

### No Vehicles Detected
- Check image quality in Supabase Storage
- Verify OpenAI API key is configured
- Check `detected_vehicle_data` in `user_content` table
- Review confidence scores in `content_vehicle_links`

### Webhook Not Working
- Verify webhook URL is accessible
- Check verify token matches
- Ensure webhook subscription is active in Meta App Dashboard

## Next Steps

1. ✅ Edge Functions created
2. ⏳ Set up Instagram API credentials
3. ⏳ Link organization to Instagram account
4. ⏳ Run historical backfill
5. ⏳ Set up webhook for real-time sync
6. ⏳ Build frontend components to display content

## API Reference

### sync-instagram-organization

**Request:**
```json
{
  "organization_id": "uuid",
  "instagram_handle": "string",
  "instagram_account_id": "string (optional)",
  "limit": 25,
  "since": "ISO date string (optional)"
}
```

**Response:**
```json
{
  "success": true,
  "results": {
    "processed": 10,
    "created": 8,
    "updated": 2,
    "errors": []
  },
  "next_cursor": "cursor_string"
}
```

### detect-vehicles-in-content

**Request:**
```json
{
  "content_id": "uuid",
  "image_urls": ["url1", "url2"],
  "organization_id": "uuid (optional)"
}
```

**Response:**
```json
{
  "success": true,
  "vehicles_detected": 2,
  "links_created": 1,
  "links": [
    {
      "vehicle_id": "uuid",
      "confidence": 0.92,
      "link_type": "primary"
    }
  ]
}
```

### backfill-instagram-content

**Request:**
```json
{
  "organization_id": "uuid",
  "instagram_handle": "string",
  "instagram_account_id": "string (optional)",
  "limit": null,
  "batch_size": 25
}
```

**Response:**
```json
{
  "success": true,
  "total_posts_fetched": 150,
  "results": {
    "processed": 150,
    "created": 145,
    "updated": 5,
    "errors": []
  }
}
```

