# Intelligent Work Session Analysis

## The Problem

When users upload 50-100 photos from a day's work, the system was creating **individual "Photo Added" timeline events** for EACH photo. This creates terrible UX:
- Timeline cluttered with 100+ identical "Photo Added" entries
- No context about what work was actually performed
- Hard to understand project history at a glance

## The Solution

**AI-Powered Work Session Analysis** that automatically:

1. **Groups uploaded photos by session** (same day, within 4-hour window)
2. **Analyzes images with OpenAI Vision** to understand what work was done
3. **Creates ONE meaningful timeline event** like:
   - "Interior seat restoration - replaced front driver and passenger seats"
   - "Engine bay detailing and cleaning"
   - "Brake system overhaul - replaced pads, rotors, and fluid"

Instead of 100 "Photo Added" entries, you get 5-10 intelligent work session summaries.

## Architecture

### Core Service: `workSessionAnalyzer.ts`

```typescript
WorkSessionAnalyzer.analyzeAndCreateWorkSession(
  vehicleId,
  imageIds,
  userId
)
```

**Flow:**
1. Groups images by upload time (4-hour windows = one work session)
2. Sends up to 10 images per group to GPT-4 Vision
3. AI analyzes: "What work was performed? What components? How long?"
4. Creates single `work_session` timeline event with AI-generated title/description
5. Links all images to that ONE event
6. Deletes old redundant "Photo Added" events

### Batch Upload Processor: `BatchUploadProcessor.tsx`

Invisible component that:
- Accumulates uploads over 5 seconds
- Automatically triggers work session analysis when batch completes
- Zero user friction - just upload photos, AI does the rest

### Cleanup Tool: `CleanupPhotoEventsButton.tsx`

One-time migration button for existing vehicles:
- Reprocesses all existing photos
- Converts existing "Photo Added" spam into intelligent sessions
- Shows: "Created 8 work sessions, removed 143 redundant events"

## AI Prompt Design

```
"You are analyzing photos from a vehicle restoration/repair session.
Look at these 12 photos and determine:
1. What work was performed? (be specific but concise)
2. What vehicle components/systems were worked on?
3. What type of work: repair, restoration, maintenance, modification, or inspection?
4. Roughly how many hours of work does this represent?"
```

Returns structured JSON:
```json
{
  "title": "Interior seat restoration",
  "description": "Removed and replaced front driver and passenger seats. Cleaned and conditioned leather. Fixed mounting brackets.",
  "workType": "restoration",
  "components": ["front_seats", "interior", "upholstery"],
  "estimatedHours": 3.5,
  "confidence": 0.92
}
```

## Timeline Event Structure

```typescript
{
  event_type: 'work_session',
  title: "Interior seat restoration",
  description: "Removed and replaced front driver...",
  metadata: {
    work_type: 'restoration',
    components: ['front_seats', 'interior'],
    estimated_hours: 3.5,
    confidence: 0.92,
    image_count: 12,
    session_duration_hours: 3.2
  }
}
```

## Cost Optimization

- Uses `detail: 'low'` for GPT-4 Vision (cheaper, faster)
- Limits to 10 images per analysis (prevents huge bills)
- Uses medium-sized image variants (not full resolution)
- Only processes in batches (not every single image)

## Future Enhancements

1. **Detect work type from tools visible** in photos (socket set = mechanical work)
2. **Cross-reference parts receipts** to add cost data to work sessions
3. **Time tracking integration** - link to actual hours logged
4. **Multi-vehicle learning** - improve analysis over time
5. **Manual override** - let users edit AI-generated titles/descriptions

## Usage

### For New Uploads
Just upload photos - analysis happens automatically after 5-second batch window.

### For Existing Timeline Cleanup
Add `CleanupPhotoEventsButton` to VehicleProfile:
```tsx
{isOwner && <CleanupPhotoEventsButton vehicleId={vehicle.id} isOwner={true} />}
```

User clicks "Clean Up Timeline" → AI analyzes all photos → Timeline fixed!

## Files Created

- `/src/services/workSessionAnalyzer.ts` - Core AI analysis logic
- `/src/components/images/BatchUploadProcessor.tsx` - Automatic batch processing
- `/src/components/vehicle/CleanupPhotoEventsButton.tsx` - One-time cleanup UI

## Database Schema Additions

Timeline events now include:
- `event_type: 'work_session'` (new type)
- `metadata.work_type` - repair, restoration, maintenance, modification, inspection
- `metadata.components` - array of parts/systems worked on
- `metadata.estimated_hours` - AI estimate of work duration
- `metadata.confidence` - AI confidence score (0-1)

---

**Result:** Professional timeline that shows actual work performed, not just "Photo Added" spam! 🎯

