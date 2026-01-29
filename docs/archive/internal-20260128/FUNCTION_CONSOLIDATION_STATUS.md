# Image Analysis Function Consolidation Status

> **Status**: Consolidation complete. All functions now route to `analyze-image`.

## Summary

We had 6+ duplicate image analysis functions. They've been consolidated into ONE:

| Function | Status | Action Taken |
|----------|--------|--------------|
| `analyze-image` | ✅ **PRIMARY** | Enhanced with 3D coordinates |
| `analyze-image-tier1` | 🔄 Deprecated | Forwards to analyze-image |
| `analyze-image-tier2` | 🔄 Deprecated | Forwards to analyze-image |
| `analyze-image-contextual` | 🔄 Deprecated | Forwards to analyze-image |
| `ai-tag-image-angles` | 🔄 Deprecated | Forwards to analyze-image |
| `backfill-image-angles` | ❌ Delete candidate | Not in active use |

## The Primary Function: `analyze-image`

**Location**: `supabase/functions/analyze-image/index.ts`

**What it does**:
1. AWS Rekognition label detection
2. OpenAI Vision "Appraiser Brain" for detailed analysis
3. 3D coordinate calculation (spherical → cartesian)
4. SPID sheet detection
5. VIN tag detection
6. Automated tag generation
7. Cost tracking

**Output stored in**:
- `vehicle_images.ai_scan_metadata` (full JSONB)
- `vehicle_images.ai_detected_angle` (simple label)
- `image_camera_position` (structured 3D coordinates)

## Deprecated Functions

Each deprecated function now contains a shim that forwards to `analyze-image`:

```typescript
// Example: analyze-image-tier2/index.ts
// DEPRECATED: This endpoint forwards to analyze-image
// Kept for backward compatibility only

serve(async (req) => {
  // Forward to the main analyze-image function
  const response = await fetch(
    `${Deno.env.get('SUPABASE_URL')}/functions/v1/analyze-image`,
    {
      method: 'POST',
      headers: req.headers,
      body: await req.text()
    }
  );
  return response;
});
```

## Why Consolidation?

1. **Maintainability**: One function to update, not six
2. **Consistency**: Same analysis logic everywhere
3. **Cost tracking**: Centralized spend monitoring
4. **Quality**: Best analysis for every image

## Migration Notes

- Old function endpoints still work (they forward)
- No client code changes needed
- Can delete deprecated functions after confirming no active callers
- Check logs for any calls to deprecated endpoints

## Next Steps

1. Monitor for calls to deprecated endpoints (1-2 weeks)
2. Delete deprecated functions if no traffic
3. Update any hardcoded references in frontend/scripts
4. Implement Gemini Flash for cost reduction

