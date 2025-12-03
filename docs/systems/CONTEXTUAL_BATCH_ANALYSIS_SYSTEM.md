# Contextual Batch Analysis System

## Overview

The Contextual Batch Analysis System provides intelligent, situation-aware analysis of image batches. Instead of analyzing individual images in isolation, it understands the complete context surrounding a batch of images, including:

1. **Complete Situational Understanding** - What work is being performed, why, and how it fits into the vehicle's history
2. **Temporal Relationships** - Whether this is a continuation of previous work, preparation for future work, or standalone
3. **User Association Patterns** - Understanding user involvement, skill level, and commitment
4. **Time Investment Calculation** - Estimating actual work hours and session duration
5. **User Commitment Scoring** - Developing a comprehensive score based on patterns, consistency, and time investment

## Architecture

### Edge Function: `analyze-batch-contextual`

Located at: `supabase/functions/analyze-batch-contextual/index.ts`

**Key Features:**
- Uses Claude 3.5 Sonnet with structured system prompts (following Claude best practices)
- Loads complete vehicle context (specs, history, owner patterns)
- Analyzes temporal context (previous and subsequent batches)
- Calculates user commitment scores
- Records comprehensive analysis in database

**System Prompt Design:**
The system prompt follows Claude's best practices for system prompts:
- Clear role definition (expert automotive analyst)
- Structured context (vehicle, user patterns, temporal relationships)
- Specific analysis requirements
- JSON response format

**Input:**
```json
{
  "event_id": "uuid",
  "vehicle_id": "uuid",
  "user_id": "uuid",
  "image_ids": ["uuid1", "uuid2", ...]
}
```

**Output:**
- Updates `timeline_events` metadata with:
  - `contextual_analysis` - Complete situational understanding
  - `user_commitment_score` - Calculated commitment metrics
- Updates event title and description with contextual insights

### Database Schema

**Migration:** `supabase/migrations/20250115_add_contextual_analysis_fields.sql`

Adds:
- `contextual_analysis_status` column to `timeline_events` table
- Index for pending analysis queries

**Data Storage:**
All contextual analysis data is stored in the `metadata` JSONB field:

```json
{
  "contextual_analysis": {
    "situation_summary": "Complete description of the situation",
    "work_type": "Type of work performed",
    "work_category": "maintenance|repair|restoration|modification|inspection|documentation",
    "primary_activity": "Main activity description",
    "components_involved": ["component1", "component2"],
    "temporal_relationships": {
      "is_continuation": true,
      "continuation_of": "Previous work description",
      "is_preparation": false,
      "preparation_for": null,
      "is_standalone": false
    },
    "time_investment": {
      "estimated_work_hours": 4.5,
      "estimated_session_duration_hours": 6.0
    },
    "user_involvement": {
      "level": "primary_worker|documenting|supervising|observing",
      "skill_indicators": ["indicator1", "indicator2"],
      "commitment_indicators": ["indicator1", "indicator2"]
    },
    "contextual_insights": {
      "relationship_to_previous_work": "How this relates to previous work",
      "relationship_to_vehicle_history": "How this fits into vehicle history",
      "patterns_detected": ["pattern1", "pattern2"]
    },
    "confidence_score": 85,
    "reasoning": "Explanation of analysis"
  },
  "user_commitment_score": {
    "time_investment_score": 25,
    "consistency_score": 20,
    "quality_score": 20,
    "engagement_score": 15,
    "overall_commitment": 80,
    "level": "dedicated",
    "factors": ["High time investment", "Consistent contributions", "Quality work indicators"]
  }
}
```

### Frontend Components

#### TimelineEventReceipt Component

**Location:** `nuke_frontend/src/components/TimelineEventReceipt.tsx`

**Enhancements:**
- Displays contextual analysis results when available
- Shows user commitment score with level and factors
- "ANALYZE NOW" button for pending analysis
- Visual indicators for analysis status

**Display Sections:**
1. **Contextual Analysis** - Shows situation summary, activity, components, temporal relationships, and time investment
2. **User Commitment Level** - Displays commitment level (casual/regular/dedicated/expert) with score and factors
3. **Pending Analysis** - Shows "Evidence set (X photos) pending analysis" with trigger button

#### ContextualAnalysisService

**Location:** `nuke_frontend/src/services/contextualAnalysisService.ts`

**Methods:**
- `analyzeEventBatch()` - Triggers analysis for a specific event
- `findPendingAnalysisEvents()` - Finds all events needing analysis
- `processPendingForVehicle()` - Processes all pending events for a vehicle

## User Commitment Scoring

The system calculates a comprehensive commitment score based on:

1. **Time Investment Score (0-30 points)**
   - Based on estimated work hours
   - Formula: `min(30, estimated_hours * 2)`

2. **Consistency Score (0-25 points)**
   - Based on total contributions
   - 20+ contributions: 25 points
   - 10-19 contributions: 20 points
   - 5-9 contributions: 15 points
   - 2-4 contributions: 10 points
   - 1 contribution: 5 points

3. **Quality Score (0-25 points)**
   - Based on work quality indicators from analysis
   - Professional: 25 points
   - Skilled DIY: 20 points
   - Amateur: 10 points
   - Unknown: 5 points

4. **Engagement Score (0-20 points)**
   - Based on batch frequency
   - < 24 hours between batches: 20 points
   - < 1 week: 15 points
   - < 1 month: 10 points
   - > 1 month: 5 points

**Commitment Levels:**
- **Expert** (75-100): High time investment, consistent contributions, quality work, frequent engagement
- **Dedicated** (60-74): Regular contributions with good quality indicators
- **Regular** (40-59): Some consistency and engagement
- **Casual** (0-39): Occasional contributions

## Usage

### Triggering Analysis

**From Receipt Component:**
Click "ANALYZE NOW" button on pending analysis events

**Programmatically:**
```typescript
import { ContextualAnalysisService } from '../services/contextualAnalysisService';

await ContextualAnalysisService.analyzeEventBatch(
  eventId,
  vehicleId,
  userId,
  imageIds
);
```

### Processing Pending Events

```typescript
const result = await ContextualAnalysisService.processPendingForVehicle(vehicleId);
console.log(`Processed: ${result.processed}, Failed: ${result.failed}`);
```

## Integration Points

1. **Image Upload Flow** - Can be triggered automatically after batch uploads
2. **Timeline Events** - Analysis results update event titles and descriptions
3. **User Profiles** - Commitment scores can inform user reputation
4. **Vehicle History** - Contextual insights enhance vehicle documentation

## Future Enhancements

1. **Automatic Triggering** - Auto-analyze batches after upload
2. **Batch Processing** - Process multiple events in background
3. **Pattern Learning** - Learn from user patterns over time
4. **Cross-Vehicle Insights** - Compare patterns across vehicles
5. **Commitment Rewards** - Gamification based on commitment levels

## References

- [Claude System Prompt Best Practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/system-prompts)
- Edge Function: `supabase/functions/analyze-batch-contextual/index.ts`
- Service: `nuke_frontend/src/services/contextualAnalysisService.ts`
- Component: `nuke_frontend/src/components/TimelineEventReceipt.tsx`
- Migration: `supabase/migrations/20250115_add_contextual_analysis_fields.sql`

