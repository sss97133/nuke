# Gemini Flash Implementation Guide

> **Goal**: Replace GPT-4o-mini with Gemini 1.5 Flash to reduce cost from $0.004/image to $0.0001/image (40x cheaper)

## Quick Start

### 1. Get Gemini API Key
1. Go to https://aistudio.google.com/apikey
2. Create new API key
3. Add to Supabase:
```bash
npx supabase secrets set GEMINI_API_KEY=your_key_here
```

### 2. Update analyze-image Function

Add this function alongside `runAppraiserBrain`:

```typescript
async function runAppraiserBrainGemini(imageUrl: string, context: string) {
  const geminiKey = Deno.env.get('GEMINI_API_KEY');
  if (!geminiKey) {
    console.error('[Gemini] No API key found');
    return null;
  }

  const prompt = `You are analyzing a vehicle photograph for a professional appraisal system.

COORDINATE SYSTEM:
The vehicle's center (0,0,0) is at the geometric center of the vehicle.
- X-axis: Positive = passenger side, Negative = driver side
- Y-axis: Positive = front of vehicle, Negative = rear
- Z-axis: Positive = up, Negative = down

CAMERA POSITION (estimate in spherical coordinates):
- azimuth_deg: 0° = front, 90° = driver side, 180° = rear, 270° = passenger side
- elevation_deg: 0° = level, positive = above, negative = below
- distance_mm: distance from vehicle center to camera

SUBJECT TAXONOMY:
Use these exact keys for subject identification:
- vehicle (full exterior shot)
- exterior.panel.fender.front.driver / .passenger / .rear.driver / .rear.passenger
- exterior.panel.door.front.driver / .passenger / .rear.driver / .rear.passenger
- exterior.panel.hood / .trunk / .roof
- exterior.bumper.front / .rear
- exterior.wheel.front.driver / .passenger / .rear.driver / .rear.passenger
- exterior.trim.grille / .molding
- exterior.light.headlight.driver / .passenger
- exterior.glass.windshield / .rear
- interior.dashboard / .dashboard.gauges / .dashboard.center_stack
- interior.seat.front.driver / .front.passenger / .rear
- interior.steering.wheel
- engine.bay / .block / .intake
- undercarriage.frame.front / .center / .rear
- undercarriage.suspension.front / .rear
- undercarriage.exhaust
- damage.dent / .scratch / .rust
- document.vin_tag / .spid_sheet

Return ONLY valid JSON:
{
  "category": "exterior|interior|engine|undercarriage|document|damage",
  "subject": "the.primary.subject.key",
  "description": "One sentence describing what's shown",
  "camera_position": {
    "azimuth_deg": number,
    "elevation_deg": number,
    "distance_mm": number,
    "confidence": number
  },
  "subject_position": {
    "x_mm": number,
    "y_mm": number,
    "z_mm": number
  },
  "is_close_up": boolean,
  "visible_damage": boolean
}`;

  try {
    // Download image and convert to base64
    const imageResponse = await fetch(imageUrl);
    const imageBuffer = await imageResponse.arrayBuffer();
    const base64Image = btoa(String.fromCharCode(...new Uint8Array(imageBuffer)));
    const mimeType = imageResponse.headers.get('content-type') || 'image/jpeg';

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64Image
                }
              }
            ]
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 500,
            responseMimeType: "application/json"
          }
        })
      }
    );

    const result = await response.json();
    
    if (!response.ok) {
      console.error('[Gemini] API error:', result);
      return null;
    }

    const content = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) {
      console.error('[Gemini] No content in response');
      return null;
    }

    const parsed = JSON.parse(content);
    
    // Add usage tracking (estimate)
    return {
      ...parsed,
      _model: 'gemini-1.5-flash',
      _cost_usd: 0.0001,  // Approximate
    };
  } catch (error) {
    console.error('[Gemini] Error:', error);
    return null;
  }
}
```

### 3. Switch the Default

In the main handler, change:
```typescript
// Before
const result = await runAppraiserBrain(image_url, context, supabase, user_id);

// After - with fallback
let result = await runAppraiserBrainGemini(image_url, context);
if (!result) {
  console.log('[analyze-image] Gemini failed, falling back to GPT');
  result = await runAppraiserBrain(image_url, context, supabase, user_id);
}
```

### 4. Test

```bash
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/analyze-image" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ANON_KEY" \
  -d '{
    "image_id": "test-id",
    "image_url": "https://example.com/image.jpg",
    "vehicle_id": "vehicle-id",
    "force_reprocess": true
  }'
```

## Cost Comparison

| Metric | GPT-4o-mini | Gemini Flash |
|--------|-------------|--------------|
| Cost/image | $0.0040 | $0.0001 |
| 334k images | $1,336 | $33 |
| Speed | ~3-5s | ~1-2s |
| Quality | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |

## Batch Processing

Once Gemini is working, process all images:

```typescript
// In a new edge function or script
async function batchProcessImages() {
  const batchSize = 100;
  let offset = 0;
  
  while (true) {
    // Get unprocessed images
    const { data: images } = await supabase
      .from('vehicle_images')
      .select('id, image_url, vehicle_id')
      .is('ai_scan_metadata->appraiser', null)  // Not yet analyzed with new system
      .range(offset, offset + batchSize - 1);
    
    if (!images || images.length === 0) break;
    
    // Process batch
    for (const image of images) {
      await fetch('/functions/v1/analyze-image', {
        method: 'POST',
        body: JSON.stringify({
          image_id: image.id,
          image_url: image.image_url,
          vehicle_id: image.vehicle_id,
          force_reprocess: true
        })
      });
      
      // Rate limit: 60 requests/minute for Gemini free tier
      await new Promise(r => setTimeout(r, 1000));
    }
    
    offset += batchSize;
    console.log(`Processed ${offset} images...`);
  }
}
```

## Troubleshooting

### "API key not valid"
- Verify key at https://aistudio.google.com/apikey
- Check it's added to Supabase secrets correctly

### "Resource exhausted"
- You've hit rate limits
- Free tier: 60 requests/minute
- Paid tier: 1000+ requests/minute

### Different results than GPT
- Gemini may classify subjects slightly differently
- May need to adjust prompt or add examples
- Quality is generally comparable for structured extraction

## Notes

- Gemini 1.5 Flash is optimized for speed and cost
- For higher accuracy on complex images, use Gemini 1.5 Pro ($0.0005/image)
- Both support JSON mode for structured output
- Image size doesn't significantly affect cost (unlike GPT)

