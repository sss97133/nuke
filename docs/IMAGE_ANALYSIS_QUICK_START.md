# Image Analysis System - Quick Start

## Problem Statement

You have 2,742 vehicle images in your database but only ~1 has been analyzed. The image analysis pipeline exists but hasn't been run properly. You need:

1. **Clear understanding** of what's working vs broken
2. **Realistic progress monitoring** to see analysis happening
3. **SDK knowledge** for OpenAI and AWS services
4. **Batch processing** to analyze all images efficiently

## Solution: 3-Tool System

I've created three specialized tools:

### 1. 🔬 Diagnostic Tool
**Purpose:** Test everything end-to-end

```bash
node scripts/image-analysis-diagnostic.js
```

**What it checks:**
- ✓ API keys present and valid
- ✓ OpenAI connectivity (via Edge Function)
- ✓ AWS Rekognition connectivity (via Edge Function)
- ✓ Database state (processed vs unprocessed counts)
- ✓ End-to-end test (processes one real image)

**Output:** Color-coded report showing exactly what's working

### 2. 📊 Progress Monitor
**Purpose:** Real-time dashboard

```bash
node scripts/image-analysis-monitor.js
```

**Shows:**
- Live progress bar
- Processing rate (images/minute)
- ETA for completion
- Extraction breakdown (Rekognition, Appraiser, SPID)
- Recent activity feed
- Auto-refreshes every 5 seconds

### 3. ⚡ Batch Processor
**Purpose:** Process all images

```bash
# Default (5 concurrent, 2s delay)
node scripts/batch-process-images.js

# Custom (10 concurrent, 1s delay)
node scripts/batch-process-images.js 10 1000

# Process specific vehicle
node scripts/batch-process-images.js 5 2000 <vehicle-id>
```

**Features:**
- Concurrent processing
- Automatic retry (3 attempts)
- Progress tracking with ETA
- Resume capability (skips processed images)

## Setup (5 Minutes)

### Step 1: Run Setup Script

```bash
./scripts/setup-image-analysis.sh
```

This interactive script will:
- Check your current configuration
- Help you add missing API keys
- Verify Edge Function secrets
- Show you next steps

### Step 2: Configure API Keys

You need these in `/Users/skylar/nuke/nuke_frontend/.env.local`:

```bash
# Supabase (get from dashboard)
VITE_SUPABASE_URL=https://qkgaybvrernstplzjaam.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# OpenAI (get from platform.openai.com)
VITE_OPENAI_API_KEY=sk-proj-your-key
OPENAI_API_KEY=sk-proj-your-key  # Same as above
```

**Where to get keys:**
- **Supabase:** https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/settings/api
- **OpenAI:** https://platform.openai.com/api-keys

### Step 3: Verify Edge Function Secrets

These must be set in Supabase Dashboard:

```bash
# Check current secrets
supabase secrets list

# Set missing secrets
supabase secrets set OPENAI_API_KEY=sk-proj-your-key
supabase secrets set AWS_ACCESS_KEY_ID=AKIA...
supabase secrets set AWS_SECRET_ACCESS_KEY=...
```

**Dashboard:** https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/settings/functions

## Usage Flow

### 1. Verify Everything Works

```bash
node scripts/image-analysis-diagnostic.js
```

Expected output:
```
✓ API keys validated
✓ Edge function working
✓ Database connected
✓ End-to-end test passed

Database Stats:
• Total images: 2,742
• Processed: 1 (0.0%)
• Remaining: 2,741

Next Steps:
➜ Run batch processing: node scripts/batch-process-images.js
➜ Monitor progress: node scripts/image-analysis-monitor.js
```

### 2. Start Batch Processing

```bash
node scripts/batch-process-images.js
```

Output:
```
╔════════════════════════════════════════════════════════════════════════════╗
║                     BATCH IMAGE PROCESSOR                                  ║
╚════════════════════════════════════════════════════════════════════════════╝

Configuration:
   Batch size: 5 concurrent requests
   Delay between batches: 2000ms
   Max retries: 3

📊 Fetching unprocessed images...
   Found 2,741 unprocessed out of 2,742 total

📸 Processing 2,741 images...

📦 Batch 1/549 (5 images)
────────────────────────────────────────────────────────────────────────────
   ✓ 3f8a2b1c... (12 tags)
   ✓ 7d9e4f2a... (8 tags)
   ✓ 1a5c8d3b... (15 tags)
   ✓ 9b2f6e4c... (10 tags)
   ✓ 5e8a1d7f... (11 tags)
────────────────────────────────────────────────────────────────────────────
   ✓ Success: 5 | ✗ Failed: 0 | ⏱ 8234ms
   Overall: 5/5 | Rate: 0.61 img/s | ETA: 1h 14m
```

### 3. Monitor Progress (Separate Terminal)

```bash
node scripts/image-analysis-monitor.js
```

Output:
```
╔════════════════════════════════════════════════════════════════════════════╗
║              IMAGE ANALYSIS PROGRESS MONITOR                               ║
╚════════════════════════════════════════════════════════════════════════════╝

OVERALL PROGRESS
────────────────────────────────────────────────────────────────────────────
[████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 26.3%

Processed: 720 / 2,742
Remaining: 2,022

Processing Rate: 12.5 images/minute
Estimated Time Remaining: 2h 42m
Elapsed Time: 57m 32s


EXTRACTION BREAKDOWN
────────────────────────────────────────────────────────────────────────────
Rekognition Labels:  720 (100.0%)
Appraiser Analysis:  685 (95.1%)
SPID Sheets Found:   37 (5.1% of total)


RECENT ACTIVITY (Last Hour)
────────────────────────────────────────────────────────────────────────────
  3f8a2b1c... | 12s ago | ✓ Rekog | ✓ Appr
  7d9e4f2a... | 14s ago | ✓ Rekog | ✓ Appr | ✓ SPID
  1a5c8d3b... | 16s ago | ✓ Rekog | ✓ Appr
  9b2f6e4c... | 18s ago | ✓ Rekog | ✗ Appr
  5e8a1d7f... | 20s ago | ✓ Rekog | ✓ Appr
```

## What Gets Extracted

For each image, the system extracts:

### 1. AWS Rekognition Labels
- Parts detected (engine, wheel, brake, etc.)
- Tools visible (wrench, jack, etc.)
- Issues found (rust, damage, etc.)
- Bounding boxes for each detection
- Confidence scores

**Stored in:** `vehicle_images.ai_scan_metadata.rekognition`

### 2. Appraiser Brain Analysis
Context-aware professional assessment:

**For Engine Bay:**
- is_stock, is_clean, has_visible_leaks, wiring_quality, rust_presence

**For Interior:**
- seats_good_condition, dash_cracks, stock_radio, manual_transmission, carpets_clean

**For Exterior:**
- body_straight, paint_glossy, visible_damage, modifications

**For Undercarriage:**
- heavy_rust, recent_work, leaks_detected, exhaust_condition

**Stored in:** `vehicle_images.ai_scan_metadata.appraiser`

### 3. SPID Sheet Extraction (GM Vehicles)
If a SPID sheet is detected:
- VIN
- Build date
- Paint codes (exterior/interior)
- RPO codes (option codes)
- Engine code
- Transmission code
- Axle ratio

**Stored in:**
- `vehicle_images.ai_scan_metadata.spid`
- `vehicle_spid_data` table (structured)

### 4. Automated Tags
Searchable tags created from Rekognition results:
- Part names
- Tool names
- Issues detected
- Brands (if visible)

**Stored in:** `image_tags` table

## API Costs

Based on current usage:

| Service | Cost per Image | 2,742 Images |
|---------|---------------|--------------|
| AWS Rekognition | $0.001 | $2.74 |
| OpenAI Vision (Appraiser) | $0.005 | $13.71 |
| OpenAI Vision (SPID) | $0.005 | $0.69* |
| **Total** | **~$0.011** | **~$30** |

*SPID only runs on ~5% of images

## Performance

Expected processing time:
- **5 concurrent:** ~90 minutes for all 2,742 images
- **10 concurrent:** ~45 minutes (higher rate limit risk)
- **3 concurrent:** ~150 minutes (more conservative)

Rate: ~30-40 images per minute (at 5 concurrent)

## Troubleshooting

### Diagnostic Shows Red

```bash
node scripts/image-analysis-diagnostic.js
```

**If API keys missing:**
1. Run `./scripts/setup-image-analysis.sh`
2. Follow prompts to add keys
3. Run diagnostic again

**If Edge Function fails:**
1. Check secrets: `supabase secrets list`
2. View logs: `supabase functions logs analyze-image`
3. Redeploy if needed: `supabase functions deploy analyze-image`

### Processing Too Slow

Increase batch size:
```bash
node scripts/batch-process-images.js 10 1000  # 10 concurrent, 1s delay
```

### Rate Limit Errors

Decrease batch size and increase delay:
```bash
node scripts/batch-process-images.js 3 5000  # 3 concurrent, 5s delay
```

### Check Database Status

```sql
-- Overall stats
SELECT 
  COUNT(*) as total,
  COUNT(CASE WHEN ai_scan_metadata->>'scanned_at' IS NOT NULL THEN 1 END) as processed,
  ROUND(
    100.0 * COUNT(CASE WHEN ai_scan_metadata->>'scanned_at' IS NOT NULL THEN 1 END) / COUNT(*),
    2
  ) as percent_complete
FROM vehicle_images;

-- Extraction breakdown
SELECT 
  COUNT(CASE WHEN ai_scan_metadata->'rekognition' IS NOT NULL THEN 1 END) as has_rekognition,
  COUNT(CASE WHEN ai_scan_metadata->'appraiser' IS NOT NULL THEN 1 END) as has_appraiser,
  COUNT(CASE WHEN ai_scan_metadata->'spid' IS NOT NULL THEN 1 END) as has_spid
FROM vehicle_images
WHERE ai_scan_metadata->>'scanned_at' IS NOT NULL;
```

## SDK Documentation

### OpenAI SDK

**Package:** `openai`
**Docs:** https://platform.openai.com/docs/api-reference

```typescript
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Vision analysis
const response = await openai.chat.completions.create({
  model: 'gpt-4o-mini',  // Vision-capable model
  messages: [{
    role: 'user',
    content: [
      { type: 'text', text: 'Analyze this image' },
      { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } }
    ]
  }],
  max_tokens: 1000
});
```

### AWS SDK

**Package:** `@aws-sdk/client-rekognition`
**Docs:** https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-rekognition/

```typescript
import { RekognitionClient, DetectLabelsCommand } from "@aws-sdk/client-rekognition";

const client = new RekognitionClient({
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

const command = new DetectLabelsCommand({
  Image: { Bytes: imageBytes },
  MaxLabels: 50,
  MinConfidence: 60
});

const result = await client.send(command);
```

### Supabase SDK

**Package:** `@supabase/supabase-js`
**Docs:** https://supabase.com/docs/reference/javascript

```typescript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Invoke edge function
const { data, error } = await supabase.functions.invoke('analyze-image', {
  body: { image_url: imageUrl, vehicle_id: vehicleId }
});
```

## Next Steps

1. **Run setup:** `./scripts/setup-image-analysis.sh`
2. **Run diagnostic:** `node scripts/image-analysis-diagnostic.js`
3. **Start processing:** `node scripts/batch-process-images.js`
4. **Monitor progress:** `node scripts/image-analysis-monitor.js`

For detailed documentation, see: `docs/IMAGE_ANALYSIS_SYSTEM.md`

