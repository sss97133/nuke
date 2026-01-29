# SBX Cars Post-Ingestion & Maintenance Plan

## Overview

Complete maintenance strategy for keeping SBX Cars data up-to-date, discovering new listings, and monitoring existing auctions.

---

## Architecture

### 1. Discovery System (`discover-sbxcars-listings`)

**Purpose**: Finds new listing URLs without scraping full details (fast, lightweight)

**How It Works**:
- Uses Firecrawl's `links` format to extract all listing URLs from browse pages
- Checks multiple sections: `/auctions`, `/upcoming`, `/ended`
- Handles pagination (tries `?page=2`, `?page=3`, etc.)
- Filters out URLs already in `import_queue` or `vehicles` table
- Adds new URLs to `import_queue` with `status='pending'`

**Edge Function**: `supabase/functions/discover-sbxcars-listings/index.ts`

**Run Schedule**:
- **Discovery**: Every 6 hours (finds new listings)
- **Frequency**: `0 */6 * * *` (cron schedule)

**Output**: New listing URLs added to `import_queue` table

---

### 2. Monitoring System (`monitor-sbxcars-listings`)

**Purpose**: Updates existing SBX Cars vehicles with bid changes, status updates

**How It Works**:
- Monitors vehicles where `discovery_source='sbxcars'` and auction is still active
- Extracts: current bid, auction status, sale price (if sold)
- Updates vehicle records with latest data
- Can monitor single vehicle or batch (default 50)

**Edge Function**: `supabase/functions/monitor-sbxcars-listings/index.ts`

**Run Schedule**:
- **Active Auctions**: Every 30 minutes
- **Frequency**: `*/30 * * * *` (cron schedule)

**Output**: Updated vehicle records with latest auction data

---

### 3. Full Scraping System (`scrape-sbxcars`)

**Purpose**: Comprehensive scraping of individual listings with full data extraction

**When Used**:
- Processes items from `import_queue` (triggered by `process-import-queue`)
- Manual runs for specific URLs
- Initial bulk ingestion

**Edge Function**: `supabase/functions/scrape-sbxcars/index.ts`

**Features**:
- Full data extraction (all sections, highlights, Carfax, inspection, etc.)
- Mercedes-Benz model parsing (AMG nomenclature, 4matic+ transmission)
- User/organization creation (sellers, bidders, specialists)
- Stores complete data in `import_queue.raw_data`

---

### 4. Queue Processing (`process-import-queue`)

**Purpose**: Processes queued listings into full vehicle records

**How It Works**:
- Picks up items from `import_queue` where `source='sbxcars'`
- Calls `scrape-sbxcars` if full data needed
- Creates vehicle records with all extracted data
- Links organizations, creates timeline events
- Downloads and stores images

**Run Schedule**:
- **Queue Processing**: Every 5 minutes
- **Frequency**: `*/5 * * * *` (cron schedule)

**Edge Function**: `supabase/functions/process-import-queue/index.ts` (existing)

---

## Database Schema

### Tables Used

1. **`import_queue`**
   - `listing_url`: SBX Cars listing URL
   - `source_id`: Reference to `scrape_sources` table
   - `status`: 'pending', 'processing', 'completed', 'failed'
   - `raw_data`: Complete scraped data JSON
   - `priority`: Higher priority for live auctions

2. **`vehicles`**
   - `discovery_source`: 'sbxcars'
   - `discovery_url`: SBX Cars listing URL
   - `asking_price`: Current bid
   - `sale_price`: Final sale price (if sold)
   - `auction_end_date`: Auction end date
   - `auction_status`: 'live', 'ended', 'sold', 'upcoming'
   - `origin_metadata`: Additional SBX Cars data

3. **`scrape_sources`**
   - Domain: 'sbxcars.com'
   - Source name: 'SBX Cars'
   - Source type: 'auction_house'

---

## Cron Jobs Setup

### 1. Discovery Job (Finds New Listings)

```sql
-- Enable pg_cron if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Remove existing job if exists
SELECT cron.unschedule('sbxcars-discover') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'sbxcars-discover'
);

-- Schedule discovery: Every 6 hours
SELECT cron.schedule(
  'sbxcars-discover',
  '0 */6 * * *', -- Every 6 hours
  $$
  SELECT
    net.http_post(
      url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/discover-sbxcars-listings',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body := jsonb_build_object(
        'max_pages', 50,
        'sections', ARRAY['auctions', 'upcoming', 'ended']
      )
    ) AS request_id;
  $$
);
```

### 2. Monitoring Job (Updates Existing Listings)

```sql
-- Remove existing job if exists
SELECT cron.unschedule('sbxcars-monitor') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'sbxcars-monitor'
);

-- Schedule monitoring: Every 30 minutes
SELECT cron.schedule(
  'sbxcars-monitor',
  '*/30 * * * *', -- Every 30 minutes
  $$
  SELECT
    net.http_post(
      url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/monitor-sbxcars-listings',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body := jsonb_build_object(
        'batch_size', 50
      )
    ) AS request_id;
  $$
);
```

### 3. Queue Processing (Already Exists)

The existing `process-import-queue` cron job handles SBX Cars listings automatically.

---

## Maintenance Workflow

### Daily Operations

1. **Discovery** (Every 6 hours)
   - Finds new listing URLs from browse pages
   - Adds to `import_queue` with `status='pending'`
   - Skips URLs already processed

2. **Queue Processing** (Every 5 minutes)
   - Processes pending items from `import_queue`
   - Full scrapes listings via `scrape-sbxcars`
   - Creates vehicle records with complete data

3. **Monitoring** (Every 30 minutes)
   - Checks active auctions for bid/status updates
   - Updates vehicle records with latest data
   - Tracks auction outcomes (sold, ended, etc.)

### Weekly Operations

- **Review Discovery Stats**: Check how many new listings found
- **Monitor Errors**: Review failed queue items
- **Update Selectors**: If site structure changes, update DOM selectors

### Monthly Operations

- **Full Re-scan**: Run discovery with larger `max_pages` to catch any missed listings
- **Data Quality Audit**: Verify extracted data accuracy
- **Performance Review**: Check function execution times and optimize if needed

---

## Error Handling

### Discovery Errors

- **Site Structure Changes**: Update selectors in `discover-sbxcars-listings`
- **Rate Limiting**: Increase delays between requests
- **Missing Pages**: Adjust `max_pages` parameter

### Monitoring Errors

- **Vehicle Not Found**: URL may have changed or listing removed
- **Parsing Failures**: Update extraction logic in `monitor-sbxcars-listings`
- **Timeout**: Reduce `batch_size` if monitoring times out

### Queue Processing Errors

- **Scraping Failures**: Review Edge Function logs
- **Data Validation Errors**: Check `raw_data` structure
- **Image Download Failures**: Verify image URLs and storage bucket

---

## Performance Optimization

### Discovery

- **Use Firecrawl Links Format**: Faster than full HTML scraping
- **Limit Pages Per Run**: Start with 50 pages, increase if needed
- **Parallel Sections**: Can run multiple sections concurrently

### Monitoring

- **Batch Processing**: Monitor 50 vehicles per run
- **Incremental Updates**: Only update changed fields
- **Skip Completed Auctions**: Filter by `auction_end_date`

### Queue Processing

- **Existing System**: Already optimized with concurrency-safe locking
- **Priority Handling**: Live auctions get higher priority
- **Rate Limiting**: Built into `scrape-sbxcars` function

---

## Monitoring & Alerts

### Key Metrics to Track

1. **Discovery Stats**
   - New URLs found per run
   - URLs already existing
   - Pages checked
   - Errors encountered

2. **Monitoring Stats**
   - Vehicles checked per run
   - Vehicles updated
   - Errors encountered

3. **Queue Stats**
   - Items pending
   - Items processed
   - Items failed
   - Average processing time

### Health Checks

- **Discovery Frequency**: Should find new listings regularly
- **Monitoring Updates**: Active auctions should update frequently
- **Queue Processing**: Should process items within 5-10 minutes
- **Error Rate**: Should be < 5% of total operations

---

## Site Structure Changes

If SBX Cars changes their site structure:

1. **Update Selectors**: Modify DOM selectors in:
   - `scrape-sbxcars/index.ts`
   - `monitor-sbxcars-listings/index.ts`
   - `discover-sbxcars-listings/index.ts`

2. **Test Functions**: Run test scrapes to verify extraction

3. **Deploy Updates**: Deploy updated Edge Functions

4. **Monitor Logs**: Watch for errors after deployment

---

## Scaling Considerations

### Current Capacity

- **Discovery**: ~50 pages per run (configurable)
- **Monitoring**: ~50 vehicles per run (configurable)
- **Queue Processing**: ~15 items per run (existing system)

### Scaling Options

1. **Increase Batch Sizes**: Adjust `batch_size` parameters
2. **Parallel Execution**: Run multiple instances concurrently
3. **Separate Jobs**: Split sections into separate cron jobs
4. **Dedicated Queue**: Create SBX Cars-specific queue processing

---

## Post-Ingestion Checklist

After initial bulk ingestion:

- [ ] Verify all sections scraped (auctions, upcoming, ended)
- [ ] Check data quality (images, descriptions, specs)
- [ ] Verify organizations created correctly
- [ ] Confirm users/bidders extracted
- [ ] Test monitoring on sample vehicles
- [ ] Verify cron jobs scheduled correctly
- [ ] Check Edge Function logs for errors
- [ ] Test discovery function manually
- [ ] Verify queue processing works
- [ ] Set up monitoring dashboards (optional)

---

## Support & Troubleshooting

### Common Issues

1. **No New Listings Found**
   - Check if site structure changed
   - Verify Firecrawl API key
   - Increase `max_pages` parameter

2. **Monitoring Not Updating**
   - Verify vehicle has `discovery_source='sbxcars'`
   - Check if auction is still active
   - Review Edge Function logs

3. **Queue Items Stuck**
   - Check `process-import-queue` logs
   - Verify scraping function works
   - Manually retry failed items

### Debug Commands

```bash
# Test discovery
node scripts/run-sbxcars-scraper.js

# Test monitoring single listing
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/monitor-sbxcars-listings" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"listing_url": "https://sbxcars.com/listing/555/..."}'

# Check queue status
# (Query import_queue table in Supabase Dashboard)
```

---

## Next Steps

1. **Deploy Functions**: Deploy `discover-sbxcars-listings` and `monitor-sbxcars-listings`
2. **Set Up Cron Jobs**: Run SQL scripts to schedule jobs
3. **Test Discovery**: Run discovery function manually to verify
4. **Test Monitoring**: Monitor a few sample vehicles
5. **Verify Queue Processing**: Ensure queue items process correctly
6. **Monitor Logs**: Watch Edge Function logs for first few runs
7. **Optimize**: Adjust batch sizes and frequencies based on results

---

## Related Documentation

- **Field Mapping**: `docs/imports/SBXCARS_COMPLETE_FIELD_MAPPING.md`
- **DOM Mapping**: `docs/imports/SBXCARS_DOM_MAPPING.md`
- **Ingestion Summary**: `docs/imports/SBXCARS_INGESTION.md`

