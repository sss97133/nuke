# Event Pipeline System

The Event Pipeline is a centralized system that automatically tracks all user actions and creates corresponding:
1. **Vehicle Timeline Events** - Historical record of what happened to each vehicle
2. **User Contributions** - Track user activity for reputation and achievements
3. **Profile Stats** - Real-time statistics for user profiles
4. **Achievement System** - Automatic achievement detection and awarding

## Usage

### Basic Event Processing

```typescript
import { EventPipeline } from '../services/eventPipeline';

// Process any user action through the pipeline
await EventPipeline.processEvent({
  vehicleId: 'vehicle-uuid',
  userId: 'user-uuid', // optional, will use current user if not provided
  eventType: 'image_upload', // see supported types below
  eventData: {
    // Event-specific data
    fileName: 'photo.jpg',
    category: 'exterior',
    // ... other relevant data
  },
  metadata: {
    // Additional context
    upload_source: 'web_interface',
    // ... other metadata
  }
});
```

### Supported Event Types

1. **`image_upload`** - User uploads vehicle photos
   ```typescript
   eventData: {
     fileName: string;
     fileSize: number;
     category: string;
     caption?: string;
     dateTaken?: string;
   }
   ```

2. **`vehicle_creation`** - User creates new vehicle profile
   ```typescript
   eventData: {
     make: string;
     model: string;
     year: number;
     vin?: string;
     initialImages?: string[];
   }
   ```

3. **`vehicle_edit`** - User modifies vehicle information
   ```typescript
   eventData: {
     oldData: VehicleData;
     newData: VehicleData;
     editContext?: {
       reason?: string;
       source?: 'manual_edit' | 'bulk_import' | 'ai_correction' | 'verification_update';
     }
   }
   ```

4. **`verification`** - User verifies vehicle data accuracy
   ```typescript
   eventData: {
     verifiedFields: string[];
     verificationType: 'manual' | 'professional' | 'automated';
     confidenceScore: number;
   }
   ```

5. **`annotation`** - User adds data provenance annotations
   ```typescript
   eventData: {
     field: string;
     annotation: string;
     annotationType: 'source' | 'correction' | 'note';
     sourceReference?: string;
     provenance: string;
   }
   ```

### Batch Processing

For bulk operations, use batch processing to avoid overwhelming the database:

```typescript
const events = [
  { vehicleId: 'uuid1', eventType: 'image_upload', eventData: {...} },
  { vehicleId: 'uuid2', eventType: 'vehicle_edit', eventData: {...} },
  // ... more events
];

await EventPipeline.processBatchEvents(events);
```

### Getting User Activity

Retrieve user's recent activity for dashboards:

```typescript
const recentActivity = await EventPipeline.getUserActivity(userId, 10);
// Returns array of activity objects with vehicle info
```

### Getting Contribution Summary

Get aggregated contribution statistics:

```typescript
const contributions = await EventPipeline.getUserContributionSummary(userId);
// Returns: { image_upload: 15, vehicle_data: 8, verification: 3, ... }
```

## What Happens Automatically

When you call `EventPipeline.processEvent()`, the system automatically:

1. **Creates Timeline Event** - Adds detailed event to `vehicle_timeline_events` table
2. **Logs Contribution** - Increments daily contribution count in `user_contributions` table
3. **Updates Profile Stats** - Updates real-time counters in `profile_stats` table
4. **Creates Activity** - Adds entry to `profile_activity` for user's activity feed
5. **Checks Achievements** - Evaluates if user earned any new achievements

## Integration Examples

### Image Upload Component
```typescript
// In your upload success handler
await EventPipeline.processEvent({
  vehicleId,
  eventType: 'image_upload',
  eventData: {
    fileName: file.name,
    fileSize: file.size,
    category: selectedCategory,
    caption: userCaption
  }
});
```

### Vehicle Creation Form
```typescript
// After successful vehicle creation
await EventPipeline.processEvent({
  vehicleId: newVehicle.id,
  eventType: 'vehicle_creation',
  eventData: {
    make: formData.make,
    model: formData.model,
    year: formData.year,
    vin: formData.vin
  }
});
```

### Data Verification System
```typescript
// When user verifies data accuracy
await EventPipeline.processEvent({
  vehicleId,
  eventType: 'verification',
  eventData: {
    verifiedFields: ['make', 'model', 'year'],
    verificationType: 'manual',
    confidenceScore: 95
  }
});
```

## Database Tables Used

- `vehicle_timeline_events` - Immutable history of vehicle events
- `user_contributions` - Daily contribution tracking by type
- `profile_stats` - Real-time user statistics
- `profile_activity` - User activity feed
- `profile_achievements` - Achievement tracking

## Achievement System

Achievements are automatically checked and awarded based on user statistics:

- **First Vehicle** (10 pts) - Added first vehicle
- **First Photo** (5 pts) - Uploaded first image  
- **Vehicle Collector** (50 pts) - Added 5+ vehicles
- **Photo Enthusiast** (25 pts) - Uploaded 10+ photos
- **Active Contributor** (100 pts) - Made 25+ contributions

## Benefits

1. **Consistent Tracking** - All user actions flow through single pipeline
2. **Rich Timeline** - Every vehicle has complete history with provenance
3. **User Engagement** - Achievements and stats encourage participation
4. **Data Quality** - Contribution tracking enables reputation systems
5. **Audit Trail** - Complete record of who did what when
6. **Scalable** - Handles both individual actions and bulk operations

## Error Handling

The pipeline is designed to be resilient:
- Individual failures don't break the entire pipeline
- Errors are logged but don't throw exceptions
- Missing user context is handled gracefully
- Database constraints prevent duplicate entries

Use this system for all user actions that should be tracked in vehicle timelines and user profiles.
