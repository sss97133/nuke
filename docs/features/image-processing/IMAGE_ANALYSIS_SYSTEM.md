# Image Analysis System - Complete Guide

## Overview

The Nuke platform has a comprehensive AI-powered image analysis pipeline that processes vehicle images to extract:

1. **AWS Rekognition Labels** - Parts, tools, damage detection
2. **Appraiser Brain Analysis** - Professional assessment checklists
3. **SPID Sheet Extraction** - GM service parts identification
4. **Automated Tagging** - Smart categorization for search

## Architecture

```
Upload → Edge Function → [Rekognition + OpenAI Vision] → Database
                ↓
         analyze-image
                ↓
    ┌───────────┴───────────┐
    │                       │
AWS Rekognition      OpenAI Vision
    │                       │
    ├─ Labels              ├─ Appraiser Brain
    ├─ Bounding Boxes      └─ SPID Extraction
    └─ Confidence Scores
                ↓
         vehicle_images.ai_scan_metadata
         vehicle_spid_data (for SPID)
         image_tags (automated tags)
```

## Tools Available

### 1. Diagnostic Tool
**Purpose:** Test all components of the pipeline

```bash
node scripts/image-analysis-diagnostic.js
```

**What it checks:**
- ✓ API keys (OpenAI, AWS, Supabase)
- ✓ OpenAI API connectivity
- ✓ AWS Rekognition connectivity
- ✓ Edge function deployment
- ✓ End-to-end image processing
- ✓ Database state and statistics

**Output:**
- Color-coded status for each component
- Database statistics (processed vs unprocessed)
- Clear next steps if issues are found

### 2. Progress Monitor
**Purpose:** Real-time dashboard for batch processing

```bash
node scripts/image-analysis-monitor.js
```

**Features:**
- Live progress bar
- Processing rate (images/minute)
- Estimated time remaining
- Extraction breakdown (Rekognition, Appraiser, SPID)
- Recent activity feed
- Auto-refreshes every 5 seconds

**Use when:**
- Running batch processing
- Checking on processing status
- Monitoring for issues

### 3. Batch Processor
**Purpose:** Process all unprocessed images

```bash
# Basic usage
node scripts/batch-process-images.js

# With custom settings
node scripts/batch-process-images.js [BATCH_SIZE] [DELAY_MS] [VEHICLE_ID]

# Examples
node scripts/batch-process-images.js 10 1000              # 10 concurrent, 1s delay
node scripts/batch-process-images.js 5 2000 <vehicle-id>  # Process one vehicle
```

**Parameters:**
- `BATCH_SIZE`: Concurrent requests (default: 5)
- `DELAY_MS`: Milliseconds between batches (default: 2000)
- `VEHICLE_ID`: Optional vehicle filter

**Features:**
- Concurrent processing with configurable batch size
- Automatic retry logic (3 attempts)
- Progress tracking with ETA
- Resume capability (skips already processed)
- Detailed logging

## API Keys & Configuration

### Required Secrets (Supabase Edge Functions)

These are configured in Supabase Dashboard:

```bash
# View current secrets
supabase secrets list

# Set a secret
supabase secrets set KEY_NAME=value
```

**Required:**
- `OPENAI_API_KEY` - For Appraiser Brain + SPID extraction
- `AWS_ACCESS_KEY_ID` - For Rekognition
- `AWS_SECRET_ACCESS_KEY` - For Rekognition
- `AWS_REGION` - AWS region (optional, defaults to us-east-1)
- `SERVICE_ROLE_KEY` - For database access

**Optional (for other features):**
- `ANTHROPIC_API_KEY` - For Claude fallback
- `GEMINI_API_KEY` - For Google AI features
- `PERPLEXITY_API_KEY` - For research features

### Environment Variables (Local)

For running batch scripts, you need `.env.local` or `.env`:

```bash
# Supabase (REQUIRED)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# OpenAI (REQUIRED for local testing)
VITE_OPENAI_API_KEY=sk-proj-...
OPENAI_API_KEY=sk-proj-...  # Same as above

# AWS (REQUIRED for local testing)
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
```

## SDK Configuration

### OpenAI SDK
**Package:** `openai`
**Current Model:** `gpt-4o-mini` (vision capable)
**Usage:**

```typescript
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const response = await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [{
    role: 'user',
    content: [
      { type: 'text', text: 'Analyze this image' },
      { type: 'image_url', image_url: { url: imageUrl } }
    ]
  }]
});
```

**Cost:** ~$0.01 per image (Appraiser + SPID)

### AWS Rekognition SDK
**Package:** `@aws-sdk/client-rekognition`
**Current Service:** DetectLabels
**Usage:**

```typescript
import { RekognitionClient, DetectLabelsCommand } from "@aws-sdk/client-rekognition";

const client = new RekognitionClient({
  region: process.env.AWS_REGION,
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

**Cost:** $1 per 1,000 images

### Supabase SDK
**Package:** `@supabase/supabase-js`
**Usage:**

```typescript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Invoke edge function
const { data, error } = await supabase.functions.invoke('analyze-image', {
  body: {
    image_url: imageUrl,
    vehicle_id: vehicleId
  }
});
```

## Database Schema

### vehicle_images
```sql
ai_scan_metadata JSONB {
  scanned_at: timestamp,
  rekognition: {
    Labels: [ { Name, Confidence, Instances, BoundingBox } ]
  },
  appraiser: {
    is_stock: boolean,
    is_clean: boolean,
    has_visible_leaks: boolean,
    // ... context-specific fields
  },
  spid: {
    vin: string,
    build_date: string,
    rpo_codes: string[],
    // ... extracted SPID data
  }
}
```

### vehicle_spid_data
```sql
CREATE TABLE vehicle_spid_data (
  id UUID PRIMARY KEY,
  vehicle_id UUID REFERENCES vehicles(id),
  image_id UUID REFERENCES vehicle_images(id),
  vin TEXT,
  build_date TEXT,
  paint_code_exterior TEXT,
  paint_code_interior TEXT,
  engine_code TEXT,
  transmission_code TEXT,
  axle_ratio TEXT,
  rpo_codes TEXT[],
  extraction_confidence INTEGER,
  raw_extracted_text TEXT,
  extraction_method TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

### image_tags
```sql
CREATE TABLE image_tags (
  id UUID PRIMARY KEY,
  image_url TEXT,
  timeline_event_id UUID,
  vehicle_id UUID,
  tag_name TEXT,
  tag_type TEXT, -- 'part', 'tool', 'brand', 'process', 'issue', 'custom'
  x_position NUMERIC,
  y_position NUMERIC,
  width NUMERIC,
  height NUMERIC,
  confidence INTEGER,
  verified BOOLEAN,
  ai_detection_data JSONB,
  created_by UUID,
  created_at TIMESTAMPTZ
);
```

## Workflow

### Typical Usage Flow

1. **Initial Setup**
   ```bash
   # Verify everything is working
   node scripts/image-analysis-diagnostic.js
   ```

2. **Start Batch Processing**
   ```bash
   # Process all images
   node scripts/batch-process-images.js
   ```

3. **Monitor Progress** (in separate terminal)
   ```bash
   node scripts/image-analysis-monitor.js
   ```

4. **Verify Results**
   ```sql
   -- Check processed count
   SELECT 
     COUNT(*) as total,
     COUNT(CASE WHEN ai_scan_metadata->>'scanned_at' IS NOT NULL THEN 1 END) as processed
   FROM vehicle_images;
   
   -- Check extraction breakdown
   SELECT 
     COUNT(CASE WHEN ai_scan_metadata->'rekognition' IS NOT NULL THEN 1 END) as has_rekognition,
     COUNT(CASE WHEN ai_scan_metadata->'appraiser' IS NOT NULL THEN 1 END) as has_appraiser,
     COUNT(CASE WHEN ai_scan_metadata->'spid' IS NOT NULL THEN 1 END) as has_spid
   FROM vehicle_images
   WHERE ai_scan_metadata->>'scanned_at' IS NOT NULL;
   ```

### Automatic Processing (Upload)

Images are automatically analyzed when uploaded via:

```typescript
// In imageUploadService.ts (line 340-378)
private static triggerBackgroundAIAnalysis(
  imageUrl: string, 
  vehicleId: string, 
  imageId: string
): void {
  supabase.functions.invoke('analyze-image', {
    body: {
      image_url: imageUrl,
      vehicle_id: vehicleId
    }
  }).then(/* ... */);
}
```

## Monitoring & Debugging

### Check Edge Function Logs

```bash
# Watch logs in real-time
supabase functions logs analyze-image --follow

# Check recent logs
supabase functions logs analyze-image --limit 50
```

### Query Processing Status

```sql
-- Get processing statistics
SELECT 
  COUNT(*) as total_images,
  COUNT(CASE WHEN ai_scan_metadata->>'scanned_at' IS NOT NULL THEN 1 END) as processed,
  COUNT(CASE WHEN ai_scan_metadata->>'scanned_at' IS NULL THEN 1 END) as unprocessed,
  ROUND(
    100.0 * COUNT(CASE WHEN ai_scan_metadata->>'scanned_at' IS NOT NULL THEN 1 END) / COUNT(*),
    2
  ) as percent_complete
FROM vehicle_images;

-- Get recent failures (if any)
SELECT 
  id,
  image_url,
  ai_scan_metadata->>'error' as error_message,
  ai_scan_metadata->>'scanned_at' as attempted_at
FROM vehicle_images
WHERE ai_scan_metadata->>'error' IS NOT NULL
ORDER BY created_at DESC
LIMIT 10;
```

### Common Issues

**Issue:** "OpenAI API key not configured"
**Fix:**
```bash
supabase secrets set OPENAI_API_KEY=sk-proj-your-key
```

**Issue:** "AWS credentials not configured"
**Fix:**
```bash
supabase secrets set AWS_ACCESS_KEY_ID=AKIA...
supabase secrets set AWS_SECRET_ACCESS_KEY=...
```

**Issue:** "Function timeout"
**Fix:** Reduce batch size or increase delay:
```bash
node scripts/batch-process-images.js 3 3000  # 3 concurrent, 3s delay
```

**Issue:** "Rate limit exceeded"
**Fix:** Images are processed too fast. Increase delay between batches:
```bash
node scripts/batch-process-images.js 5 5000  # 5s delay
```

## Cost Estimates

Based on typical usage:

| Service | Cost per Image | 1,000 Images | 10,000 Images |
|---------|---------------|--------------|---------------|
| AWS Rekognition | $0.001 | $1.00 | $10.00 |
| OpenAI Vision (Appraiser) | $0.005 | $5.00 | $50.00 |
| OpenAI Vision (SPID) | $0.005 | $5.00 | $50.00 |
| **Total** | **$0.011** | **$11.00** | **$110.00** |

*Note: SPID extraction only runs on detected SPID sheets (~5% of images)*

Actual cost for 2,742 images: ~$30

## Performance

Typical processing times:

- **Single image:** 2-5 seconds
- **Batch of 10:** 15-30 seconds
- **1,000 images:** 30-45 minutes (at 5 concurrent)
- **All 2,742 images:** ~90 minutes (at 5 concurrent)

Factors affecting speed:
- Image size (larger images take longer)
- Network latency
- API rate limits
- Concurrent batch size

## Next Steps

1. **Run Diagnostic**
   ```bash
   node scripts/image-analysis-diagnostic.js
   ```

2. **If all green, start batch processing**
   ```bash
   node scripts/batch-process-images.js
   ```

3. **Monitor in separate terminal**
   ```bash
   node scripts/image-analysis-monitor.js
   ```

4. **When complete, verify in UI**
   - Open any vehicle profile
   - Click on an image
   - Check "AI Analysis" or "Details" tab
   - Should see Appraiser notes, tags, etc.

## Support

If you encounter issues:

1. Run diagnostic tool first
2. Check Edge Function logs
3. Verify API keys are valid
4. Check database for error messages
5. Ensure sufficient API credits

For questions or issues, reference this documentation and the diagnostic output.

