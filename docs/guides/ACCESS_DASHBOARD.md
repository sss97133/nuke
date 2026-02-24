# Access Your Processing Dashboard

## Web-Based Monitoring (Professional)

I've created a **professional web dashboard** for monitoring image processing.

### Option 1: Full Dashboard

Add to your app routes (`nuke_frontend/src/App.tsx`):

```typescript
import ImageProcessingDashboard from './pages/ImageProcessingDashboard';

// Add route:
<Route path="/admin/image-processing" element={<ImageProcessingDashboard />} />
```

Then visit: **https://nuke.ag/admin/image-processing**

**Shows:**
- ✅ Real-time progress bars for each tier
- ✅ Total cost accumulation
- ✅ Savings calculator
- ✅ Context quality distribution
- ✅ Model usage breakdown  
- ✅ Recent activity feed
- ✅ Processing rate & ETA
- ✅ Auto-refreshes every 5 seconds

### Option 2: Mini Widget (Bottom-Right Corner)

Import `ProcessingMonitor` component anywhere:

```typescript
import ProcessingMonitor from './pages/ProcessingMonitor';

// Add to any page layout:
<ProcessingMonitor />
```

**Shows:**
- Simple progress bar
- Processed / Total count
- Auto-updates every 3 seconds
- Appears as floating widget

### Option 3: Terminal Monitor (Current)

```bash
cd /Users/skylar/nuke
node scripts/image-analysis-monitor.js
```

**Shows:**
- ASCII progress bars
- Processing statistics
- Real-time updates

### Option 4: Database Queries

```sql
-- Quick status check
SELECT 
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE ai_scan_metadata->'tier_1_analysis' IS NOT NULL) as tier1_done,
  COUNT(*) FILTER (WHERE ai_scan_metadata->'tier_2_analysis' IS NOT NULL) as tier2_done,
  ROUND(100.0 * COUNT(*) FILTER (WHERE ai_scan_metadata->'tier_1_analysis' IS NOT NULL) / COUNT(*), 2) as percent_complete
FROM vehicle_images;
```

### Option 5: Supabase Dashboard

**Real-time table view:**
https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/editor

Navigate to `vehicle_images` table and watch the `ai_scan_metadata` column populate in real-time.

---

## Recommended: Full Dashboard

The `ImageProcessingDashboard.tsx` gives you professional-grade monitoring:

```
┌─────────────────────────────────────────────────────────────┐
│  Image Processing Dashboard               🔄 Auto-Refresh   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Total Images         Tier 1           Tier 2    Tier 3    │
│  ┌─────────────┐     ┌──────────┐    ┌────────┐ ┌───────┐ │
│  │    2,741    │     │   687    │    │   145  │ │   32  │ │
│  └─────────────┘     │  ████░░░ │    │ ██░░░░ │ │ █░░░░ │ │
│                      │   25.1%  │    │  5.3%  │ │  1.2% │ │
│                      └──────────┘    └────────┘ └───────┘ │
│                                                             │
│  Total Cost           Full Price       Savings             │
│  ┌─────────────┐     ┌──────────┐    ┌────────────┐       │
│  │   $2.14     │     │  $54.82  │    │  $52.68    │       │
│  │ $0.00031/img│     │ if GPT-4o│    │   96.1%    │       │
│  └─────────────┘     └──────────┘    └────────────┘       │
│                                                             │
│  Context Quality Distribution                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Rich (60+)    ████████████████████░░░░░  847  (31%)  │  │
│  │ Good (30-60)  ██████████░░░░░░░░░░░░░  412  (15%)  │  │
│  │ Medium (10-30)███████░░░░░░░░░░░░░░░  298  (11%)  │  │
│  │ Poor (<10)    ████████████████████████ 1184  (43%)  │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  Recent Activity                                           │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 3f8a2b1c... │ claude-3-haiku │ 95% │ 12s ago        │  │
│  │ 7d9e4f2a... │ claude-3-haiku │ 93% │ 14s ago        │  │
│  │ 1a5c8d3b... │ claude-3-haiku │ 97% │ 16s ago        │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  [Refresh Now] [View Gap Reports] [Query Database]         │
│                                                             │
│  Auto-refreshing every 5 seconds...                        │
└─────────────────────────────────────────────────────────────┘
```

This is what professional software looks like! 

Add it to your app and access at: `/admin/image-processing`

