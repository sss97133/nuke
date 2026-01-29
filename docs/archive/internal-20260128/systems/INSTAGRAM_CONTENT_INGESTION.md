# Instagram Content Ingestion - Image-First Vehicle Detection

## Use Case: Organizations That Prioritize Instagram

**Example**: [L'Art de l'Automobile](https://www.instagram.com/lartdelautomobile) - [N-Zero Organization](https://n-zero.dev/org/39773a0e-106c-4afa-ae50-f95cbd74d074)

**Challenge**: 
- Instagram posts often have minimal text (captions, hashtags)
- Vehicle identification relies heavily on visual content
- Need to match Instagram images to vehicles in database
- Limited structured data for matching

**Solution**: Image-first vehicle detection using AI vision analysis

## Architecture

### Data Flow

```
Instagram Post
  ↓
1. Ingest Post Metadata (caption, hashtags, timestamp)
  ↓
2. Download Images/Video Thumbnails
  ↓
3. AI Vision Analysis (Primary Detection Method)
  ├─ Vehicle Make/Model Recognition
  ├─ License Plate OCR
  ├─ VIN Tag Detection
  ├─ Distinctive Features (color, modifications, damage)
  └─ Context Clues (location, event, other vehicles)
  ↓
4. Text Analysis (Secondary - Limited Data)
  ├─ Caption parsing
  ├─ Hashtag analysis
  └─ Comments (if available)
  ↓
5. Fuzzy Matching Against Vehicle Database
  ├─ Visual features match
  ├─ Make/model/year from AI
  ├─ License plate lookup
  ├─ VIN match (if detected)
  └─ Temporal/location proximity
  ↓
6. Confidence Scoring & Linking
  ├─ High confidence (≥0.8) → Auto-link
  ├─ Medium confidence (0.5-0.8) → Review queue
  └─ Low confidence (<0.5) → Manual review
```

## Image Analysis Pipeline

### Step 1: Image Download & Storage

```typescript
// Edge Function: sync-instagram-content
async function ingestInstagramPost(postId: string, organizationId: string) {
  // 1. Fetch post from Instagram Graph API
  const post = await fetchInstagramPost(postId);
  
  // 2. Download images to Supabase Storage
  const imageUrls = await downloadImagesToStorage(
    post.media_urls,
    `organizations/${organizationId}/instagram/${postId}`
  );
  
  // 3. Create user_content record
  const content = await createUserContent({
    organization_id: organizationId,
    platform: 'instagram',
    content_type: post.media_type, // 'photo', 'video', 'carousel'
    external_content_id: postId,
    content_url: post.permalink,
    title: post.caption?.substring(0, 200),
    description: post.caption,
    thumbnail_url: imageUrls[0],
    published_at: post.timestamp,
    metadata: {
      hashtags: post.hashtags,
      mentions: post.mentions,
      location: post.location,
      image_urls: imageUrls
    }
  });
  
  // 4. Queue for vehicle detection
  await queueVehicleDetection(content.id, imageUrls);
}
```

### Step 2: AI Vision Analysis

**Primary Detection Method** - Uses existing `analyze-image` Edge Function pattern:

```typescript
// Edge Function: detect-vehicles-in-instagram-content
async function detectVehiclesInContent(contentId: string, imageUrls: string[]) {
  const detections = [];
  
  for (const imageUrl of imageUrls) {
    // Use GPT-4 Vision for vehicle detection
    const analysis = await analyzeImageWithAI(imageUrl, {
      prompt: `Analyze this Instagram post image and identify any vehicles visible.

Extract:
1. **Vehicle Count**: How many distinct vehicles are visible?
2. **For Each Vehicle**:
   - Make (e.g., "Porsche", "Ferrari", "BMW")
   - Model (e.g., "911", "Testarossa", "M3")
   - Year (if visible or estimable from design cues)
   - Color
   - Distinctive features (modifications, damage, custom paint)
   - License plate (if visible - extract full plate)
   - VIN tag (if visible - extract 17-character VIN)
   - Position in image (primary focus vs background)

3. **Context Clues**:
   - Location indicators (signs, landmarks)
   - Event type (car show, restoration, delivery)
   - Other vehicles visible (for context)

4. **Confidence**: How confident are you in each identification?

Return JSON:
{
  "vehicles": [
    {
      "make": "Porsche",
      "model": "911",
      "year": 1973,
      "color": "Orange",
      "license_plate": "ABC1234",
      "vin": null,
      "is_primary_focus": true,
      "distinctive_features": ["RWB widebody", "custom wheels"],
      "confidence": 0.95
    }
  ],
  "context": {
    "location": "Car show",
    "event_type": "showcase"
  }
}`
    });
    
    detections.push({
      image_url: imageUrl,
      analysis: analysis,
      vehicles_detected: analysis.vehicles
    });
  }
  
  // Store detections
  await storeVehicleDetections(contentId, detections);
  
  // Attempt to match to vehicles in database
  await matchDetectedVehicles(contentId, detections);
}
```

### Step 3: Vehicle Matching Algorithm

**Multi-Factor Matching** with confidence scoring:

```typescript
async function matchDetectedVehicles(contentId: string, detections: any[]) {
  for (const detection of detections) {
    for (const vehicle of detection.vehicles_detected) {
      // Build search query
      const searchCriteria = {
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year ? {
          min: vehicle.year - 2,
          max: vehicle.year + 2
        } : null,
        color: vehicle.color,
        license_plate: vehicle.license_plate
      };
      
      // Search vehicles table
      const candidates = await searchVehicles(searchCriteria);
      
      // Score each candidate
      for (const candidate of candidates) {
        const score = calculateMatchScore(vehicle, candidate, {
          // License plate exact match: +50 points
          license_plate_match: vehicle.license_plate && 
            candidate.license_plate?.toUpperCase() === vehicle.license_plate.toUpperCase() ? 50 : 0,
          
          // VIN exact match: +100 points (instant match)
          vin_match: vehicle.vin && candidate.vin === vehicle.vin ? 100 : 0,
          
          // Make/model/year match: +30 points
          make_model_year_match: (
            candidate.make?.toLowerCase() === vehicle.make?.toLowerCase() &&
            candidate.model?.toLowerCase() === vehicle.model?.toLowerCase() &&
            (!vehicle.year || Math.abs(candidate.year - vehicle.year) <= 2)
          ) ? 30 : 0,
          
          // Color match: +10 points
          color_match: candidate.color?.toLowerCase() === vehicle.color?.toLowerCase() ? 10 : 0,
          
          // Distinctive features match: +10 points
          features_match: checkDistinctiveFeatures(vehicle, candidate) ? 10 : 0,
          
          // Organization relationship: +20 points
          org_relationship: await checkOrganizationRelationship(
            candidate.id,
            detection.organization_id
          ) ? 20 : 0,
          
          // Temporal proximity: +5 points
          temporal_proximity: await checkTemporalProximity(
            candidate.id,
            detection.published_at
          ) ? 5 : 0
        });
        
        const confidence = Math.min(score / 100, 1.0);
        
        // Create link if confidence is high enough
        if (confidence >= 0.5) {
          await linkContentToVehicle(contentId, candidate.id, {
            link_type: vehicle.is_primary_focus ? 'primary' : 'secondary',
            confidence: confidence,
            detection_method: 'image_analysis',
            detected_vehicle_data: vehicle
          });
        }
      }
    }
  }
}
```

### Step 4: License Plate OCR

**Critical for High-Confidence Matches**:

```typescript
async function extractLicensePlate(imageUrl: string): Promise<string | null> {
  // Use existing VIN/plate detection from analyze-image function
  const analysis = await fetch('https://your-project.supabase.co/functions/v1/analyze-image', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      image_url: imageUrl,
      analysis_type: 'license_plate'
    })
  });
  
  const result = await analysis.json();
  
  // License plate format: typically 1-8 alphanumeric characters
  // May include spaces, dashes
  if (result.license_plate) {
    return normalizeLicensePlate(result.license_plate);
  }
  
  return null;
}

function normalizeLicensePlate(plate: string): string {
  // Remove spaces, dashes, convert to uppercase
  return plate.replace(/[\s-]/g, '').toUpperCase();
}
```

### Step 5: VIN Tag Detection

**Highest Confidence Match** - Uses existing VIN detection:

```typescript
async function extractVINFromImage(imageUrl: string): Promise<string | null> {
  // Use existing VIN detection from import-classiccars-listing
  const analysis = await fetch('https://your-project.supabase.co/functions/v1/analyze-image', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      image_url: imageUrl,
      analysis_type: 'vin_tag'
    })
  });
  
  const result = await analysis.json();
  
  // VIN must be exactly 17 characters
  if (result.vin && result.vin.length === 17) {
    return result.vin.toUpperCase();
  }
  
  return null;
}
```

## Text Analysis (Secondary - Limited Data)

### Caption Parsing

```typescript
async function parseCaption(caption: string): Promise<VehicleClues> {
  // Use LLM to extract vehicle mentions
  const prompt = `Extract vehicle information from this Instagram caption:
"${caption}"

Look for:
- Make and model mentions
- Year references
- VIN numbers
- License plates
- Vehicle-specific hashtags

Return JSON:
{
  "make": "Porsche" | null,
  "model": "911" | null,
  "year": 1973 | null,
  "vin": "WP0ZZZ91112345678" | null,
  "license_plate": "ABC1234" | null,
  "hashtags": ["#porsche911", "#classiccar"],
  "confidence": 0.7
}`;
  
  const response = await callOpenAI(prompt);
  return JSON.parse(response);
}
```

### Hashtag Analysis

```typescript
function extractVehicleFromHashtags(hashtags: string[]): VehicleClues {
  // Common patterns:
  // #porsche911, #ferrari308, #bmwm3e30
  // #1973porsche, #classic911
  
  const patterns = [
    /#(\d{4})([a-z]+)(\d+)/i,  // #1973porsche911
    /#([a-z]+)(\d+)/i,          // #porsche911
    /#([a-z]+)([a-z]+)(\d+)/i   // #bmwm3e30
  ];
  
  // Try to extract make/model/year from hashtags
  // Low confidence but useful as additional signal
}
```

## Confidence Thresholds

### Auto-Link (High Confidence ≥ 0.8)
- **VIN match**: 100% confidence → Instant link
- **License plate + make/model match**: 85-95% confidence
- **Make/model/year + distinctive features + org relationship**: 80-90% confidence

### Review Queue (Medium Confidence 0.5-0.8)
- **Make/model/year match only**: 60-70% confidence
- **Make/model match with color**: 55-65% confidence
- **Visual match with low text confidence**: 50-60% confidence

### Manual Review (Low Confidence < 0.5)
- **Make/model only (no year)**: 40-50% confidence
- **Visual match only (no text)**: 30-40% confidence
- **Unclear or multiple vehicles**: < 30% confidence

## Implementation Steps

### 1. Set Up Instagram Graph API

```typescript
// Get Instagram Business Account ID
const instagramAccount = await getInstagramBusinessAccount(organizationId);

// Subscribe to webhooks for new posts
await subscribeToWebhooks(instagramAccount.id, {
  fields: ['media', 'mentions', 'comments'],
  callback_url: 'https://your-project.supabase.co/functions/v1/instagram-webhook'
});
```

### 2. Create Edge Functions

**`sync-instagram-organization`**:
- Fetches posts from Instagram Graph API
- Creates `user_content` records
- Downloads images to Supabase Storage
- Queues for vehicle detection

**`detect-vehicles-in-content`**:
- Analyzes images with GPT-4 Vision
- Extracts vehicle information
- Matches to vehicles in database
- Creates `content_vehicle_links` with confidence scores

**`process-instagram-webhook`**:
- Handles real-time post notifications
- Triggers immediate ingestion for new posts

### 3. Review Queue Interface

```typescript
// Query for medium-confidence matches needing review
const reviewQueue = await supabase
  .from('user_content')
  .select(`
    *,
    content_vehicle_links!inner (
      vehicle_id,
      confidence,
      detection_method,
      vehicles (make, model, year, color, license_plate)
    )
  `)
  .eq('status', 'pending_review')
  .gte('vehicle_detection_confidence', 0.5)
  .lt('vehicle_detection_confidence', 0.8)
  .order('published_at', { ascending: false });
```

## Example: L'Art de l'Automobile

### Organization Setup

```sql
-- 1. Link Instagram account to organization
INSERT INTO external_identities (platform, handle, profile_url, display_name)
VALUES (
  'instagram',
  'lartdelautomobile',
  'https://www.instagram.com/lartdelautomobile',
  'L''Art de l''Automobile'
)
ON CONFLICT (platform, handle) DO NOTHING
RETURNING id;

-- 2. Link to organization (if organization exists)
UPDATE external_identities
SET claimed_by_user_id = (
  SELECT discovered_by FROM businesses 
  WHERE id = '39773a0e-106c-4afa-ae50-f95cbd74d074'::uuid
)
WHERE platform = 'instagram' AND handle = 'lartdelautomobile';
```

### Content Ingestion Flow

1. **New Instagram Post Published**
   - Webhook triggers `process-instagram-webhook`
   - Post metadata ingested
   - Images downloaded

2. **Vehicle Detection**
   - Images analyzed with GPT-4 Vision
   - Vehicles detected: "1973 Porsche 911", "Orange", "RWB widebody"
   - License plate detected: "ABC1234" (if visible)

3. **Matching**
   - Search vehicles: `make='Porsche' AND model='911' AND year BETWEEN 1971 AND 1975`
   - License plate match: `license_plate='ABC1234'`
   - Organization relationship: Vehicle linked to L'Art de l'Automobile
   - **Confidence: 0.92** → Auto-link

4. **Result**
   - `content_vehicle_links` created with `link_type='primary'`
   - Vehicle timeline updated with Instagram post
   - Post appears on vehicle profile

## Success Metrics

1. **Detection Rate**: % of posts with vehicles successfully detected
2. **Match Accuracy**: % of auto-links that are correct (verified by users)
3. **Review Queue Size**: Keep under 50 items
4. **Processing Time**: < 30 seconds per post
5. **Coverage**: % of organization's vehicles that have linked content

## Challenges & Solutions

### Challenge: Multiple Vehicles in One Post
**Solution**: Detect all vehicles, create multiple `content_vehicle_links` with appropriate `link_type` (primary vs secondary)

### Challenge: Low-Quality Images
**Solution**: Use multiple images from carousel posts, combine signals for higher confidence

### Challenge: No License Plate/VIN Visible
**Solution**: Rely on visual make/model recognition + organization relationship + temporal proximity

### Challenge: Custom/Modified Vehicles
**Solution**: Store distinctive features in `detected_vehicle_data`, use for fuzzy matching

### Challenge: Instagram API Rate Limits
**Solution**: Batch processing, webhook-based real-time ingestion, respect rate limits

## Next Steps

1. **Implement Instagram Graph API integration**
2. **Build image analysis pipeline** (reuse existing `analyze-image` function)
3. **Create matching algorithm** with confidence scoring
4. **Build review queue interface** for medium-confidence matches
5. **Test with L'Art de l'Automobile** as pilot organization

