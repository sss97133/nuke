# Fix Plan - Data Extraction Quality + Backfill

## MANDATORY FIRST STEP: Study Before Coding

- [ ] **Read specs/lessons-learned.md** - Know what NOT to do
- [ ] **Read specs/database-schema.md** - Understand the data model
- [ ] **Read specs/backfill-strategy.md** - How to fix existing profiles
- [ ] **Read FUNCTION_MAP.md** - Know what functions exist
- [ ] **Check current state** - Run SQL queries to understand what's broken

## Priority 1: Understand Current State

- [ ] **Run queue health check**
  - SQL: `SELECT status, count(*) FROM import_queue GROUP BY status`
  - Document: How many pending, failed, stuck?

- [ ] **Check profile completeness**
  - SQL: `SELECT COUNT(*) FROM vehicles WHERE extraction_completeness >= 0.8`
  - Document: What % are complete?

- [ ] **Check image coverage**
  - SQL: `SELECT COUNT(*) FROM vehicles v LEFT JOIN vehicle_images vi ON vi.vehicle_id = v.id WHERE vi.id IS NULL`
  - Document: How many vehicles have zero images?

## Priority 2: Quick Wins (Immediate Impact)

- [ ] **Reduce batch size to 3**
  - Current: 10-20 items causing timeouts
  - Files: `process-import-queue`, `process-bat-extraction-queue`
  - Change: `BATCH_SIZE = 3`

- [ ] **Skip KSL items** (3,037 items blocking queue)
  - SQL: `UPDATE import_queue SET status='skipped' WHERE listing_url LIKE '%ksl.com%'`

- [ ] **Skip dead links (404/410)**
  - SQL: `UPDATE import_queue SET status='skipped' WHERE error_message LIKE '%404%' OR error_message LIKE '%410%'`

- [ ] **Release orphaned locks** (items stuck >15 min)
  - SQL: `UPDATE import_queue SET status='pending', locked_at=NULL WHERE status='processing' AND locked_at < NOW() - INTERVAL '15 minutes'`

## Priority 3: Fix __NEXT_DATA__ Extraction (Cars & Bids)

- [ ] **Analyze C&B page structure**
  - Fetch a Cars & Bids listing
  - Find `__NEXT_DATA__` script tag
  - Document the JSON structure

- [ ] **Extract images from __NEXT_DATA__**
  - Path: `data.props.pageProps.auction.images[]`
  - Test on 5 C&B listings

- [ ] **Extract comments from __NEXT_DATA__**
  - Path: `data.props.pageProps.auction.comments[]`
  - Include replies and timestamps

- [ ] **Extract bids from __NEXT_DATA__**
  - Path: `data.props.pageProps.auction.bids[]`
  - Include bidder usernames and timestamps

## Priority 4: Implement Backfill System

- [ ] **Create extraction_retry_queue table**
  ```sql
  CREATE TABLE extraction_retry_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID REFERENCES vehicles(id),
    listing_url TEXT NOT NULL,
    missing_fields TEXT[] NOT NULL,
    retry_method TEXT NOT NULL,
    attempts INT DEFAULT 0,
    status TEXT DEFAULT 'pending'
  );
  ```

- [ ] **Queue vehicles needing backfill**
  - Vehicles with discovery_url but no images
  - Vehicles with invalid VINs
  - Vehicles with null prices

- [ ] **Create backfill processor**
  - Fetch source URL
  - Extract missing fields only
  - Update vehicle without overwriting good data

## Priority 5: Multi-Pass Extraction Architecture

- [ ] **Implement Pass 1: Structure Examination**
  - Detect: __NEXT_DATA__, embedded JSON, JSON-LD, DOM
  - Return extraction method to use

- [ ] **Implement Pass 2: Image Extraction**
  - Recursive: Try primary method, fallback to DOM if <5 images
  - Deduplicate results

- [ ] **Implement Pass 3: Comments/Bids Extraction**
  - Only for auction sites
  - Include threaded replies

- [ ] **Implement Aggregation Phase**
  - Combine all passes
  - Calculate completeness score
  - Store raw_extraction_json

## Priority 6: Source-to-Profile Comparison

- [ ] **Add extraction validation**
  - After extraction: compare source to stored
  - Log: fields in source but missing in profile
  - Store extraction_missing_fields array

- [ ] **Add completeness tracking**
  - Calculate extraction_completeness (0.0 to 1.0)
  - Track which fields are missing

## Priority 7: Backfill Execution

- [ ] **Backfill BaT profiles** (highest value)
  - Target: Vehicles with BaT discovery_url
  - Focus: Images, price, VIN

- [ ] **Backfill C&B profiles**
  - Target: Vehicles with Cars & Bids discovery_url
  - Focus: Images, comments, bids

- [ ] **Backfill Classic.com profiles**
  - Target: Vehicles with Classic.com discovery_url
  - Focus: Images, price, specs

## Completed

<!-- Move items here when done -->
