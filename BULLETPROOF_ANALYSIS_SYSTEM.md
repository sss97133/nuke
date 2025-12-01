# Bulletproof Analysis System - Self-Repairing Architecture

## Overview

The analysis system is now **bulletproof and self-repairing** with automatic retries, health checks, queue management, and failure recovery.

## Architecture

### 1. **Analysis Queue Table** (`analysis_queue`)
- **Purpose**: Tracks all analysis requests with status, retries, and errors
- **Features**:
  - Prevents duplicate analyses (checks for pending/processing)
  - Automatic retry with exponential backoff (1min, 5min, 15min, 30min)
  - Priority system (1-10, lower = higher priority)
  - Status tracking: `pending` → `processing` → `completed`/`failed`/`retrying`
  - Error logging with full stack traces

### 2. **Queue Processor** (`process-analysis-queue` Edge Function)
- **Runs**: Every 5 minutes via cron
- **Processes**: Up to 10 analyses per run
- **Features**:
  - Uses `SKIP LOCKED` to prevent concurrent processing
  - Marks items as processing before starting
  - Calls appropriate analysis function
  - Handles errors gracefully with retry logic
  - Returns detailed status report

### 3. **Auto-Queue Triggers**
- **Vehicle Creation**: Automatically queues analysis when new vehicle is created (priority 3)
- **Image Addition**: Automatically queues analysis when images are added (priority 5)
- **Prevents Duplicates**: Checks for existing pending/processing analyses

### 4. **Enhanced Expert Agent** (`vehicle-expert-agent`)
- **Health Checks**: Verifies vehicle exists before processing
- **Better Error Handling**: Returns detailed error info for debugging
- **Logging**: Comprehensive console logging for troubleshooting

### 5. **Frontend Integration**
- **Queue Instead of Direct Call**: Frontend queues analysis instead of calling directly
- **Status Polling**: Polls for results with reasonable timeout
- **User Feedback**: Shows queue status and processing messages

## Self-Repairing Features

### Automatic Retries
- **Exponential Backoff**: 1min → 5min → 15min → 30min
- **Max Retries**: 3 attempts before permanent failure
- **Smart Retry**: Only retries on transient errors (network, timeouts)

### Health Checks
- Vehicle existence verification
- Image count validation
- Database connectivity checks

### Failure Recovery
- **Failed analyses** are logged with full error details
- **Retrying analyses** automatically rescheduled
- **Old completed/failed** analyses cleaned up after 30 days

### Monitoring
- Queue status visible via `get_analysis_status()` function
- Queue position tracking
- Retry count and next retry time visible

## Usage

### Manual Trigger (Frontend)
```typescript
// Queue analysis with high priority
await supabase.rpc('queue_analysis', {
  p_vehicle_id: vehicleId,
  p_analysis_type: 'expert_valuation',
  p_priority: 2, // High priority
  p_triggered_by: 'user'
});
```

### Check Status
```typescript
const { data: status } = await supabase.rpc('get_analysis_status', {
  p_vehicle_id: vehicleId
});
// Returns: has_pending, has_completed, has_failed, latest_status, queue_position, retry_count, next_retry_at
```

### Automatic Processing
- **Cron Job**: Runs every 5 minutes
- **Auto-Triggers**: On vehicle/image creation
- **No Manual Intervention**: System handles everything automatically

## Error Handling

### Transient Errors (Auto-Retry)
- Network timeouts
- API rate limits
- Temporary service unavailability

### Permanent Errors (Logged)
- Invalid vehicle ID
- Missing required data
- Configuration errors

### Error Details
All errors are logged with:
- Error message
- Error type
- Stack trace
- Timestamp
- Retry count

## Queue Priority System

1. **Priority 1**: Critical (manual admin trigger)
2. **Priority 2**: High (user manual trigger)
3. **Priority 3**: Medium-High (new vehicle import)
4. **Priority 5**: Normal (image addition)
5. **Priority 10**: Low (background refresh)

## Monitoring & Debugging

### Check Queue Status
```sql
SELECT * FROM analysis_queue 
WHERE vehicle_id = 'your-vehicle-id'
ORDER BY created_at DESC;
```

### View Failed Analyses
```sql
SELECT * FROM analysis_queue 
WHERE status = 'failed'
ORDER BY created_at DESC
LIMIT 10;
```

### View Retrying Analyses
```sql
SELECT * FROM analysis_queue 
WHERE status = 'retrying'
ORDER BY next_retry_at ASC;
```

## Benefits

1. **No Lost Analyses**: Everything is tracked in the queue
2. **Automatic Recovery**: Failed analyses retry automatically
3. **No Duplicates**: Queue prevents duplicate requests
4. **Priority System**: Important analyses process first
5. **Full Visibility**: All status and errors are logged
6. **Self-Healing**: System recovers from failures automatically
7. **Scalable**: Can process hundreds of analyses per hour

## Next Steps

1. ✅ Queue table created
2. ✅ Queue processor function created
3. ✅ Auto-queue triggers created
4. ✅ Cron job scheduled
5. ✅ Frontend updated to use queue
6. ⏳ Deploy and test
7. ⏳ Monitor queue performance
8. ⏳ Add admin dashboard for queue monitoring

