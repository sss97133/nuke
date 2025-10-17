# Unified Tag System - Clean Architecture

## Current Problem
**CHAOS**: 54 columns in `image_tags` table with massive duplication:
- `tag_name` AND `text` (same thing)
- `confidence` AND `automated_confidence` AND `trust_score` (same thing)
- `verified` AND `verification_status` AND `validation_status` (same thing)
- Multiple date fields, multiple status fields, multiple cost fields
- 8+ different tag-related components in frontend
- Multiple backend APIs (Phoenix + Supabase Edge Functions)

## Solution: Single Unified System

### Database Schema (CLEAN)

```sql
CREATE TABLE image_tags (
  -- Identity
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- References (what is being tagged)
  image_id UUID REFERENCES vehicle_images(id) ON DELETE CASCADE,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  timeline_event_id UUID REFERENCES timeline_events(id) ON DELETE CASCADE,
  
  -- Tag Content
  tag_name TEXT NOT NULL,  -- "Transfer Case NP205" or "Rust" or "Paint"
  tag_type TEXT NOT NULL,  -- 'part', 'tool', 'supply', 'damage', 'work'
  
  -- Spatial (optional - null if not spatially tagged)
  x_position NUMERIC(5,2),  -- Percentage
  y_position NUMERIC(5,2),
  width NUMERIC(5,2),
  height NUMERIC(5,2),
  
  -- Source & Confidence
  source_type TEXT NOT NULL DEFAULT 'manual',  -- 'manual', 'ai', 'imported'
  confidence NUMERIC(3,2) NOT NULL DEFAULT 1.0,  -- 0.0 to 1.0
  verified BOOLEAN DEFAULT false,
  
  -- Metadata (everything else goes here)
  metadata JSONB DEFAULT '{}'::jsonb,
  /*
    {
      "ai_supervised": true/false,
      "part_number": "NP205",
      "brand": "GM",
      "category": "drivetrain",
      "estimated_cost": 800,
      "vendor_links": [...],
      "work_session": "Engine rebuild - Day 3",
      "user_notes": "Shows wear on input shaft",
      "connected_receipt_id": "uuid",
      "receipt_vendor": "CJ Pony Parts",
      "receipt_amount": 847.50
    }
  */
  
  -- Audit
  created_by UUID REFERENCES auth.users(id),
  inserted_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Frontend Components (UNIFIED)

**ONE Component**: `ImageLightbox.tsx`
- Displays image
- Loads ALL tags (AI + manual)
- Shows tags in sidebar with full context
- Handles verify/reject
- Integrates with all image sources

**ONE Service**: `tagService.ts`
```typescript
interface Tag {
  id: string;
  tag_name: string;
  tag_type: 'part' | 'tool' | 'supply' | 'damage' | 'work';
  source_type: 'manual' | 'ai' | 'imported';
  confidence: number;
  verified: boolean;
  metadata: TagMetadata;
}

class TagService {
  static async getTagsForImage(imageId: string): Promise<Tag[]>
  static async verifyTag(tagId: string): Promise<void>
  static async rejectTag(tagId: string): Promise<void>
  static async createManualTag(tag: Partial<Tag>): Promise<Tag>
}
```

**ONE Hook**: `useImageTags.ts`
```typescript
function useImageTags(imageId: string) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(false);
  
  const loadTags = async () => { ... }
  const verifyTag = async (tagId: string) => { ... }
  const rejectTag = async (tagId: string) => { ... }
  
  return { tags, loading, loadTags, verifyTag, rejectTag };
}
```

### Backend (UNIFIED)

**ONE Edge Function**: `auto-analyze-upload`
- Takes image URL
- Runs Rekognition
- Calls AI Agent Supervisor (Claude)
- Creates AI tags with full metadata
- Returns standardized Tag objects

**ONE AI Agent**: `ai-agent-supervisor`
- Analyzes Rekognition results
- Adds vehicle context
- Connects to receipts
- Tracks tool usage
- Returns enriched tags

### Data Flow (SIMPLE)

```
1. Image Upload
   ↓
2. Extract EXIF → Save to vehicle_images
   ↓
3. Auto-trigger AI Analysis
   ↓
4. Rekognition → Basic labels
   ↓
5. AI Agent Supervisor → Enriched tags with context
   ↓
6. Save to image_tags (ONE table)
   ↓
7. Frontend loads tags via ONE query
   ↓
8. Display in ImageLightbox (ONE component)
```

## Migration Plan

### Phase 1: Database Cleanup
1. Create clean `image_tags_v2` table with unified schema
2. Migrate existing data from old schema
3. Drop old columns
4. Rename `image_tags_v2` → `image_tags`

### Phase 2: Frontend Consolidation
1. Delete duplicate tag components:
   - ❌ EnhancedImageTagger.tsx
   - ❌ SimplePhotoTagger.tsx
   - ❌ ProImageViewer tag systems
   - ❌ VehicleTagExplorer.tsx (already removed)
2. Keep ONLY `ImageLightbox.tsx`
3. Create `tagService.ts` and `useImageTags.ts`

### Phase 3: Backend Simplification
1. Keep `auto-analyze-upload` Edge Function
2. Keep `ai-agent-supervisor` Edge Function
3. Remove Phoenix API tag endpoints (use Supabase direct)

### Phase 4: Testing & Validation
1. Test tag creation (manual + AI)
2. Test tag display in lightbox
3. Test verify/reject workflow
4. Test receipt connections
5. Test tool tracking

## Expected Result

**ONE unified tag system** where:
- All tags live in one clean table
- All tags display in one component
- All tags come from two sources (AI or manual)
- All tags have the same interface
- NO confusion, NO duplication, NO fragmentation

**Clean, simple, functional.**

