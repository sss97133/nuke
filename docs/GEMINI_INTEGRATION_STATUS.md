# Gemini Integration Status

> **Goal**: Replace GPT-4o-mini ($0.004/image) with Gemini Flash ($0.0001/image) for 40x cost reduction
> **Status**: IN PROGRESS - API model name issue being resolved
> **Last Updated**: December 29, 2025

---

## The Goal

Reduce image analysis cost from **$1,336** to **$33** for 334k images by switching from GPT-4o-mini to Gemini Flash.

| Model | Cost/Image | 334k Images |
|-------|------------|-------------|
| GPT-4o-mini (current) | $0.0040 | $1,336 |
| **Gemini Flash (target)** | **$0.0001** | **$33** |

---

## What Was Done

### 1. Added Gemini Function
Added `runAppraiserBrainGemini()` to `supabase/functions/analyze-image/index.ts`:

```typescript
async function runAppraiserBrainGemini(imageUrl: string, context: string): Promise<any> {
  const geminiKey = Deno.env.get('free_api_key') || Deno.env.get('GEMINI_API_KEY');
  // ... downloads image, converts to base64, calls Gemini API
}
```

### 2. Updated Flow to Try Gemini First
Modified the main handler to:
1. Try Gemini Flash first (cheap)
2. Fall back to GPT-4o-mini if Gemini fails

```typescript
// Try Gemini Flash first ($0.0001/image vs $0.004/image for GPT)
let result = await runAppraiserBrainGemini(image_url, context)

if (result && result.category && !result._gemini_error) {
  // Use Gemini result
} else {
  // Fall back to GPT
  result = await runAppraiserBrain(image_url, context, supabase, user_id)
}
```

### 3. Added API Key to Supabase Secrets
- Secret name: `free_api_key`
- Also tried: `GEMINI_API_KEY`
- Both are set in Supabase Edge Function secrets

---

## Current Issue

**Problem**: API returns 404 - model not found

```json
{
  "gemini_error": "api_error",
  "gemini_error_message": "Status 404: models/gemini-1.5-flash-002 is not found..."
}
```

**Tried model names**:
- `gemini-1.5-flash` - 404
- `gemini-1.5-flash-latest` - 404
- `gemini-1.5-flash-002` - 404 (current)

**Possible causes**:
1. API key doesn't have access to these models
2. Need to use a different model name
3. API key is for a different region/project

---

## Next Steps

### To Debug

1. **List available models** with the API key:
```bash
curl "https://generativelanguage.googleapis.com/v1beta/models?key=YOUR_KEY"
```

2. **Try older model names**:
- `gemini-pro-vision` (older but stable)
- `gemini-1.0-pro-vision-latest`

3. **Check API key type**:
- Is it from Google AI Studio (aistudio.google.com)?
- Or from Google Cloud Console (different access)?

### To Fix

Once model name is confirmed, update this line in `analyze-image/index.ts`:
```typescript
const response = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/CORRECT_MODEL_NAME:generateContent?key=${geminiKey}`,
```

---

## Code Location

**Main file**: `supabase/functions/analyze-image/index.ts`

Key functions:
- `runAppraiserBrainGemini()` - Lines ~1092-1285 (Gemini implementation)
- `runAppraiserBrain()` - Lines ~900-1085 (GPT fallback)
- Main handler - Lines ~147-170 (orchestration)

---

## Testing

```bash
# Test with force_reprocess
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/analyze-image" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ANON_KEY" \
  -d '{
    "image_id": "test-id",
    "image_url": "https://example.com/image.jpg",
    "vehicle_id": "vehicle-id",
    "force_reprocess": true
  }' | jq '{
    model: .appraisal._model,
    cost: .appraisal._cost_usd,
    gemini_error: ._debug.gemini_error,
    model_used: ._debug.model_used
  }'
```

**Success looks like**:
```json
{
  "model": "gemini-1.5-flash",
  "cost": 0.0001,
  "gemini_error": null,
  "model_used": "gemini-1.5-flash"
}
```

---

## Related Docs

- `docs/IMAGE_ANALYSIS_3D_COORDINATE_SYSTEM.md` - Full 3D coordinate system docs
- `docs/GEMINI_IMPLEMENTATION_GUIDE.md` - Original implementation guide
- `docs/FUNCTION_CONSOLIDATION_STATUS.md` - Function cleanup status

---

## Summary

The Gemini integration code is complete and deployed. The issue is finding the correct model name that works with the `free_api_key` secret. Once resolved, image analysis costs will drop from $0.004 to $0.0001 per image (40x reduction).


