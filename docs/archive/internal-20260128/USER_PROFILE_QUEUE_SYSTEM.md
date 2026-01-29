# User Profile Queue System

## Overview

The User Profile Queue System automatically discovers, queues, and extracts user profile data from external platforms (BaT, Cars & Bids, etc.) when we encounter usernames in comments, sellers, or other sources.

## How It Works

### 1. Automatic Discovery

User profiles are automatically queued via database triggers when:

- **Comments are created** - When a comment is inserted into `auction_comments` or `bat_comments`, the author's profile URL is automatically queued
- **Listings are created/updated** - When a `bat_listing` is created with a seller or buyer, their profiles are queued
- **External identities are created** - When an `external_identity` is created/updated with a `profile_url`, it's automatically queued

### 2. Queue Processing

The `process-user-profile-queue` Edge Function processes queued profiles:

1. Claims a batch of pending profiles (with locking to prevent double-processing)
2. Extracts profile data using platform-specific extractors
3. Updates `external_identities` with extracted metadata
4. Queues discovered vehicle listings for extraction
5. Marks profiles as complete or failed

### 3. IP Rotation & Rate Limiting

To avoid getting blocked:

- **Proxy Support**: Supports multiple proxy providers (Bright Data, Oxylabs, ScraperAPI, custom proxies)
- **IP Rotation**: Automatically rotates IPs when using proxy services
- **Rate Limiting**: Tracks requests per domain (10 requests/minute default)
- **Random Delays**: Adds human-like delays between requests
- **User Agent Rotation**: Randomizes user agents to avoid detection

## Database Schema

### `user_profile_queue` Table

```sql
CREATE TABLE user_profile_queue (
  id UUID PRIMARY KEY,
  profile_url TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'bat',
  username TEXT,
  external_identity_id UUID REFERENCES external_identities(id),
  status TEXT DEFAULT 'pending', -- 'pending', 'processing', 'complete', 'failed'
  priority INTEGER DEFAULT 50, -- 0-100, higher = more important
  error_message TEXT,
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  discovered_via TEXT, -- 'comment', 'seller', 'buyer', 'manual', 'trigger'
  source_vehicle_id UUID REFERENCES vehicles(id),
  source_comment_id TEXT,
  source_listing_id UUID,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  locked_at TIMESTAMPTZ,
  locked_by TEXT
);
```

## Triggers

### 1. `trigger_queue_profile_from_auction_comment`
- **Table**: `auction_comments`
- **When**: After INSERT
- **Action**: Queues profile URL for comment author

### 2. `trigger_queue_profile_from_bat_comment`
- **Table**: `bat_comments`
- **When**: After INSERT
- **Action**: Queues profile URL for BaT comment author

### 3. `trigger_queue_profile_from_listing`
- **Table**: `bat_listings`
- **When**: After INSERT OR UPDATE
- **Action**: Queues profiles for seller and buyer

### 4. `trigger_queue_profile_from_identity`
- **Table**: `external_identities`
- **When**: After INSERT OR UPDATE (when profile_url changes)
- **Action**: Queues profile URL for extraction

## Usage

### Manual Queue Insertion

```sql
INSERT INTO user_profile_queue (
  profile_url,
  platform,
  username,
  priority,
  discovered_via
) VALUES (
  'https://bringatrailer.com/member/username/',
  'bat',
  'username',
  80, -- High priority
  'manual'
);
```

### Trigger Processing

The queue is automatically processed via:

1. **Cron Job** (recommended):
   ```sql
   -- Set up cron to call the Edge Function every 5 minutes
   SELECT cron.schedule(
     'process-user-profile-queue',
     '*/5 * * * *', -- Every 5 minutes
     $$
     SELECT net.http_post(
       url := 'https://YOUR_PROJECT.supabase.co/functions/v1/process-user-profile-queue',
       headers := '{"Content-Type": "application/json", "Authorization": "Bearer YOUR_SERVICE_KEY"}'::jsonb,
       body := '{"batchSize": 3}'::jsonb
     );
     $$
   );
   ```

2. **Manual Trigger**:
   ```bash
   curl -X POST "https://YOUR_PROJECT.supabase.co/functions/v1/process-user-profile-queue" \
     -H "Authorization: Bearer YOUR_SERVICE_KEY" \
     -H "Content-Type: application/json" \
     -d '{"batchSize": 5}'
   ```

### Check Queue Status

```sql
-- Pending profiles
SELECT COUNT(*) FROM user_profile_queue WHERE status = 'pending';

-- Processing profiles
SELECT COUNT(*) FROM user_profile_queue WHERE status = 'processing';

-- Failed profiles
SELECT COUNT(*) FROM user_profile_queue WHERE status = 'failed';

-- Queue by platform
SELECT platform, status, COUNT(*) 
FROM user_profile_queue 
GROUP BY platform, status;
```

## Proxy Configuration

### Bright Data (Recommended)

```bash
BRIGHT_DATA_CUSTOMER_ID=your_customer_id
BRIGHT_DATA_PASSWORD=your_password
```

### Oxylabs

```bash
OXYLABS_USER=your_username
OXYLABS_PASSWORD=your_password
```

### ScraperAPI

```bash
SCRAPERAPI_KEY=your_api_key
```

### Custom Proxy List

```bash
CUSTOM_PROXY_LIST=proxy1.com:8080,proxy2.com:8080,proxy3.com:8080
```

## Priority Levels

- **0-30**: Low priority (auto-discovered, backfill)
- **31-60**: Medium priority (comment authors, buyers)
- **61-80**: High priority (sellers, manual queue)
- **81-100**: Critical priority (urgent extractions)

## Error Handling

- **Automatic Retry**: Failed profiles are automatically retried (up to `max_attempts`)
- **Exponential Backoff**: Delays increase with each retry
- **Lock Expiration**: Locks expire after 20 minutes to prevent stuck items
- **Error Logging**: All errors are logged in `error_message` field

## Monitoring

### Queue Health

```sql
-- Queue depth over time
SELECT 
  DATE_TRUNC('hour', created_at) as hour,
  status,
  COUNT(*) as count
FROM user_profile_queue
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY hour, status
ORDER BY hour DESC, status;
```

### Processing Rate

```sql
-- Profiles processed per hour
SELECT 
  DATE_TRUNC('hour', completed_at) as hour,
  COUNT(*) as processed
FROM user_profile_queue
WHERE status = 'complete'
  AND completed_at > NOW() - INTERVAL '24 hours'
GROUP BY hour
ORDER BY hour DESC;
```

### Failure Analysis

```sql
-- Most common errors
SELECT 
  error_message,
  COUNT(*) as count,
  platform
FROM user_profile_queue
WHERE status = 'failed'
GROUP BY error_message, platform
ORDER BY count DESC
LIMIT 10;
```

## Best Practices

1. **Start Small**: Begin with `batchSize: 1` to test, then increase gradually
2. **Monitor Rate Limits**: Watch for 429 errors and adjust rate limits accordingly
3. **Use Proxies**: Always use proxy services for production scraping
4. **Respect Robots.txt**: Check robots.txt before scraping
5. **Set Appropriate Priorities**: Use higher priorities for important profiles
6. **Monitor Queue Depth**: Keep queue depth manageable (< 1000 pending)

## Troubleshooting

### Profiles Stuck in "processing"

```sql
-- Unlock stuck items (older than 30 minutes)
UPDATE user_profile_queue
SET 
  status = 'pending',
  locked_at = NULL,
  locked_by = NULL
WHERE status = 'processing'
  AND locked_at < NOW() - INTERVAL '30 minutes';
```

### High Failure Rate

1. Check proxy configuration
2. Verify rate limits aren't too aggressive
3. Check if target site changed their structure
4. Review error messages for patterns

### Queue Not Processing

1. Verify cron job is running
2. Check Edge Function logs
3. Verify service role key is correct
4. Check for database connection issues

## Related Systems

- **Vehicle Queue**: `bat_extraction_queue` - Queues vehicle URLs for extraction
- **Import Queue**: `import_queue` - Queues raw listings for processing
- **External Identities**: `external_identities` - Stores user profile data
- **Profile Extraction**: `extract-bat-profile-vehicles` - Extracts profile data

## Future Enhancements

- [ ] Support for more platforms (eBay, Facebook Marketplace, etc.)
- [ ] Automatic profile data enrichment (member since, location, etc.)
- [ ] Profile activity tracking (comments, bids, listings over time)
- [ ] Integration with user claiming system
- [ ] Advanced proxy rotation strategies
- [ ] Machine learning for optimal extraction timing

