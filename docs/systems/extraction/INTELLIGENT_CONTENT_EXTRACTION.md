# Intelligent Content Extraction System

## Overview

The Intelligent Content Extraction System automatically detects, extracts, and attributes valuable data from user comments. When a user shares a listing URL, specs, VIN, price, or any other vehicle-related content in a comment, the system:

1. **Detects** valuable content using pattern matching and NLP
2. **Queues** the content for processing
3. **Extracts** structured data from the content
4. **Merges** data intelligently with existing vehicle profiles
5. **Credits** the contributor and builds their reputation
6. **Annotates** the provenance of all data

## Architecture

### Three-Layer System

```
User Comment
    ↓
┌─────────────────────────────────────┐
│  1. Content Detector (Frontend)    │
│  - Regex patterns for URLs          │
│  - NLP for specs/events             │
│  - Confidence scoring               │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│  2. Extraction Queue (Database)     │
│  - Stores detected content          │
│  - Tracks processing status         │
│  - Links to source comments         │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│  3. Processor (Edge Function)       │
│  - Scrapes listings                 │
│  - Validates VIN matches            │
│  - Handles merge conflicts          │
│  - Awards contribution points       │
└─────────────────────────────────────┘
```

## Database Schema

### `content_extraction_queue`

Stores detected content awaiting processing.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `vehicle_id` | UUID | Target vehicle |
| `comment_id` | UUID | Source comment |
| `user_id` | UUID | Contributor |
| `content_type` | TEXT | Type: `listing_url`, `youtube_video`, `vin_data`, etc. |
| `raw_content` | TEXT | The actual content (URL, VIN, specs, etc.) |
| `context` | TEXT | Surrounding text for context |
| `confidence_score` | NUMERIC(3,2) | Detection confidence (0.0-1.0) |
| `status` | TEXT | `pending`, `processing`, `completed`, `failed` |
| `extracted_data` | JSONB | Structured data after extraction |
| `contribution_value` | INTEGER | Points awarded |
| `data_quality_score` | NUMERIC(3,2) | Data quality (0.0-1.0) |

### `attributed_data_sources`

Tracks who contributed what data to vehicle profiles.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `vehicle_id` | UUID | Target vehicle |
| `data_field` | TEXT | Field contributed: `images`, `specs`, `price`, etc. |
| `contributed_by` | UUID | User who provided the data |
| `source_comment_id` | UUID | Original comment |
| `extraction_job_id` | UUID | Link to extraction queue |
| `data_id` | UUID | ID of created record (image_id, event_id, etc.) |
| `contribution_value` | INTEGER | Points for this contribution |
| `verification_status` | TEXT | `unverified`, `auto_verified`, `peer_verified`, etc. |
| `data_quality_score` | NUMERIC(3,2) | Quality score |
| `source_url` | TEXT | Original source URL |

### `user_contribution_scores`

User reputation system based on data contribution quality.

| Column | Type | Description |
|--------|------|-------------|
| `user_id` | UUID | Primary key |
| `total_contributions` | INTEGER | Total contributions made |
| `total_points` | INTEGER | Total points earned |
| `avg_quality_score` | NUMERIC(3,2) | Average quality of contributions |
| `accuracy_rate` | NUMERIC(3,2) | Percentage of verified contributions |
| `verified_contributions` | INTEGER | Count of verified contributions |
| `reputation_tier` | TEXT | `novice`, `contributor`, `trusted`, `expert`, `authority` |

### `data_merge_conflicts`

Tracks when extracted data conflicts with existing data.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `vehicle_id` | UUID | Target vehicle |
| `field_name` | TEXT | Conflicting field: `make`, `model`, `vin`, etc. |
| `existing_value` | TEXT | Current value |
| `proposed_value` | TEXT | New value from extraction |
| `proposed_by` | UUID | User who provided new data |
| `resolution_status` | TEXT | `pending`, `auto_merged`, `user_merged`, etc. |

## Content Detection

The `ContentDetector` service analyzes comment text to identify extractable content:

### Supported Content Types

1. **Listing URLs** (95% confidence)
   - Bring a Trailer, Mecum, KSL, Craigslist
   - eBay, Cars.com, AutoTrader, Hemmings
   - Barrett-Jackson, Gooding, Facebook Marketplace

2. **YouTube Videos** (70-90% confidence)
   - Walkaround videos, reviews, auction footage
   - Higher confidence if context mentions "walkaround", "review", "video"

3. **VIN Numbers** (75-95% confidence)
   - 17-character alphanumeric (no I, O, Q)
   - Higher confidence if context explicitly mentions "VIN"

4. **Specs Data** (60-80% confidence)
   - Horsepower: "350 hp", "300 horsepower"
   - Torque: "400 lb-ft", "300 nm"
   - Engine: "5.7L V8", "6.2L"
   - Transmission: "manual", "6-speed", "automatic"
   - Drivetrain: "4WD", "AWD", "RWD"

5. **Price Data** (60-90% confidence)
   - Sale prices: "sold for $45,000"
   - Asking prices: "asking $35,000"
   - Bid amounts: "winning bid $50k"

6. **Timeline Events** (50-95% confidence)
   - Maintenance: "oil change", "brake replacement"
   - Repairs: "engine rebuild", "transmission fixed"
   - Modifications: "installed coilovers", "upgraded turbo"
   - Higher confidence with dates and mileage

7. **Image URLs** (80% confidence)
   - Direct image links: `.jpg`, `.png`, `.gif`, `.webp`

8. **Document URLs** (70-90% confidence)
   - PDFs, service manuals, brochures
   - Higher confidence if context mentions "manual", "brochure"

9. **Contact Info** (70-80% confidence)
   - Phone numbers, email addresses

## Processing Flow

### 1. Comment Submission

```typescript
// User posts comment with content
"Check out this listing: https://bringatrailer.com/listing/1980-chevrolet-silverado/
Sold for $42,000 with only 45k miles!"
```

### 2. Content Detection

```typescript
const detected = await ContentDetector.analyzeComment(
  commentText,
  vehicleId,
  commentId,
  'vehicle_comments'
);

// Detected:
// [
//   { type: 'listing_url', content: 'https://bringatrailer...', confidence: 0.95 },
//   { type: 'price_data', content: '$42,000', confidence: 0.9 },
//   { type: 'specs_data', content: '45k miles', confidence: 0.7 }
// ]
```

### 3. Queue for Processing

```typescript
await ContentDetector.queueDetectedContent(
  detected,
  vehicleId,
  userId,
  commentId,
  'vehicle_comments'
);

// Creates rows in content_extraction_queue table
```

### 4. Automatic Processing

```typescript
// Edge function: process-content-extraction
// Triggered immediately for high-confidence listings
// Polls queue every 5 seconds for other content

// For listing_url:
1. Scrape listing (reuse existing bat-scraper)
2. Validate VIN match
3. Import images
4. Merge data intelligently
5. Create timeline event
6. Award contribution points
```

### 5. Attribution

```typescript
// After successful extraction:
await supabase.rpc('award_contribution_points', {
  p_user_id: userId,
  p_vehicle_id: vehicleId,
  p_data_field: 'images',
  p_data_type: 'vehicle_images',
  p_contribution_value: 50, // Points earned
  p_data_quality_score: 0.95
});

// Automatically triggers:
// - User reputation tier update
// - Contribution count increment
// - Accuracy rate recalculation
```

## Reputation System

### Tiers

| Tier | Points Required | Badge |
|------|----------------|-------|
| Novice | 0-99 | 🌱 |
| Contributor | 100-499 | ⭐ |
| Trusted | 500-1999 | 💎 |
| Expert | 2000-4999 | 🏆 |
| Authority | 5000+ | 👑 |

### Point Values

| Contribution Type | Points | Quality Multiplier |
|------------------|--------|-------------------|
| Listing URL (with VIN match) | 10 base + 2 per image + 5 per field | 0.95 |
| Listing URL (no VIN) | 10 base + 2 per image + 5 per field | 0.75 |
| YouTube Video | 15 | 0.80 |
| VIN Number | 25 | 0.90 |
| Specs Data | 5 | 0.60 |
| Sale Price | 20 | 0.85 |
| Asking Price | 10 | 0.60 |
| Timeline Event | 10 | 0.70 |
| Image URL | 5 | 0.60 |
| Document URL | 15 | 0.80 |

## Conflict Resolution

When new data conflicts with existing data:

1. **Automatic Resolution** (high confidence + VIN match)
   - VIN match + higher confidence → auto-merge
   - Example: New listing has VIN, existing doesn't → auto-update

2. **Flag for Review** (uncertain conflicts)
   - Different VINs → create `data_merge_conflict`
   - Different year/make/model → flag for admin
   - User gets partial points for flagging the issue

3. **Confidence-Based Merging**
   - Fill missing fields (no conflict)
   - Update if new confidence > existing confidence
   - Preserve higher-quality data

## UI Components

### 1. `ExtractionQueueStatus`

Shows pending/processing extraction jobs at top of comments section.

```tsx
<ExtractionQueueStatus vehicleId={vehicleId} />
// Displays: "Processing Content (3)"
// - Listing → Processing... 95%
// - VIN → Queued 75%
// - Specs → Queued 60%
```

### 2. `UserReputationBadge`

Displays user's reputation tier inline with their name.

```tsx
<UserReputationBadge userId={userId} inline={true} />
// Displays: "⭐ CONTRIBUTOR" (clickable for details)
```

### 3. `AttributedDataIndicator`

Shows who contributed specific data to a vehicle profile.

```tsx
<AttributedDataIndicator vehicleId={vehicleId} dataField="images" />
// Displays: "Data Contributors (5)"
// - ✓✓ skylar → images • 50 pts • Quality: 95%
// - ✓ john_doe → price • 20 pts • Quality: 85%
```

## Installation

### 1. Apply Migration

```bash
# Option A: Supabase CLI
npx supabase db push

# Option B: Supabase Dashboard
# Go to SQL Editor
# Paste contents of: supabase/migrations/20251202_intelligent_content_extraction_system.sql
# Click RUN

# Option C: Direct psql
psql -h [host] -U postgres -d [database] -f supabase/migrations/20251202_intelligent_content_extraction_system.sql
```

### 2. Deploy Edge Function

```bash
npx supabase functions deploy process-content-extraction
```

### 3. Set up Cron Job (Optional)

For automatic queue processing every 5 minutes:

```sql
-- Using pg_cron
SELECT cron.schedule(
  'process-content-extraction',
  '*/5 * * * *', -- Every 5 minutes
  $$SELECT net.http_post(
    url := '[YOUR_SUPABASE_URL]/functions/v1/process-content-extraction',
    headers := '{"Authorization": "Bearer [SERVICE_ROLE_KEY]"}'::jsonb
  );$$
);
```

## Testing

### Test Scenarios

#### 1. BaT Listing Detection

```typescript
// Post comment:
"Found this: https://bringatrailer.com/listing/1980-chevrolet-silverado-crew-cab-pickup/"

// Expected:
// ✅ Detected: listing_url (95% confidence)
// ✅ Queued for processing
// ✅ Edge function triggered
// ✅ Listing scraped successfully
// ✅ Images imported (15+ images)
// ✅ Vehicle data merged
// ✅ Timeline event created
// ✅ User awarded 50+ points
// ✅ Reputation tier updated
```

#### 2. Multi-Content Detection

```typescript
// Post comment:
"This truck sold for $42,000 on BaT. VIN: 1GCGC34N0AE123456. Has the 350 V8 with 200hp."

// Expected:
// ✅ Detected: price_data (90% confidence)
// ✅ Detected: vin_data (95% confidence)
// ✅ Detected: specs_data (80% confidence) x2
// ✅ All queued for processing
// ✅ Points awarded for each contribution
```

#### 3. VIN Mismatch Handling

```typescript
// Vehicle has VIN: ABC123...
// Comment contains: XYZ789...

// Expected:
// ✅ Detected: vin_data
// ✅ Processing attempted
// ❌ VIN mismatch detected
// ✅ data_merge_conflict created
// ⚠️ Flagged for admin review
// ✅ User awarded partial points (5pts) for flagging issue
```

#### 4. YouTube Video

```typescript
// Post comment:
"Here's a walkaround video: https://youtube.com/watch?v=abc123"

// Expected:
// ✅ Detected: youtube_video (90% confidence)
// ✅ Queued for processing
// ✅ Timeline event created with video link
// ✅ User awarded 15 points
```

## API Reference

### Functions

#### `queue_content_extraction`

Queue content for extraction.

```sql
SELECT queue_content_extraction(
  p_vehicle_id := '[vehicle_id]',
  p_comment_id := '[comment_id]',
  p_comment_table := 'vehicle_comments',
  p_user_id := '[user_id]',
  p_content_type := 'listing_url',
  p_raw_content := 'https://bringatrailer.com/listing/...',
  p_context := 'Check out this listing...',
  p_confidence_score := 0.95,
  p_detection_method := 'regex'
);
```

#### `award_contribution_points`

Award points to a user for a contribution.

```sql
SELECT award_contribution_points(
  p_user_id := '[user_id]',
  p_vehicle_id := '[vehicle_id]',
  p_data_field := 'images',
  p_data_type := 'vehicle_images',
  p_data_id := '[image_id]',
  p_source_comment_id := '[comment_id]',
  p_extraction_job_id := '[job_id]',
  p_source_url := 'https://...',
  p_contribution_value := 50,
  p_data_quality_score := 0.95
);
```

### Edge Function

#### `process-content-extraction`

Processes pending extraction queue items.

```typescript
// Invoke manually
const { data, error } = await supabase.functions.invoke('process-content-extraction');

// Returns:
{
  success: true,
  processed: 5,
  results: [
    { id: '...', success: true, type: 'listing_url' },
    { id: '...', success: true, type: 'vin_data' },
    { id: '...', success: false, error: 'VIN mismatch' }
  ]
}
```

## Future Enhancements

1. **AI-Powered Content Understanding**
   - Use GPT-4 to extract structured data from freeform text
   - "I replaced the clutch and flywheel at 95k miles in March 2023"
   - → Auto-create timeline event with date, mileage, parts

2. **Cross-Vehicle Learning**
   - Build collective knowledge of common issues per vehicle
   - Suggest related maintenance when user adds work
   - "Users who replaced the water pump also replaced the thermostat"

3. **Automated Fact-Checking**
   - Cross-reference VIN decoders, CarFax, auction results
   - Flag suspicious claims (e.g., "1000hp" on stock engine)

4. **Gamification**
   - Badges: "BaT Hunter", "Spec Master", "VIN Detective"
   - Leaderboards: Top contributors per vehicle type
   - Achievements: "First to find listing", "100 contributions"

5. **API Integration**
   - Auto-import from user's BaT saved listings
   - Connect to AutoTrader/Cars.com accounts
   - Sync with Hemmings watchlist

## Troubleshooting

### Issue: Content not detected

**Cause:** Low confidence threshold or pattern not recognized

**Fix:** Lower confidence threshold in `ContentDetector.analyzeComment()` or add new pattern

### Issue: Processing stuck in "pending"

**Cause:** Edge function not deployed or cron not running

**Fix:** 
```bash
npx supabase functions deploy process-content-extraction
# Or invoke manually: supabase.functions.invoke('process-content-extraction')
```

### Issue: Duplicate data imported

**Cause:** Missing duplicate check in processor

**Fix:** Add `ON CONFLICT` clause to inserts or check for existing records first

### Issue: Wrong user credited

**Cause:** User ID not passed correctly

**Fix:** Verify `user_id` in `queueDetectedContent()` call

## Support

For questions or issues, contact the Nuke Platform team or file an issue in the GitHub repository.

---

**Built with ❤️ by the Nuke Platform team**

