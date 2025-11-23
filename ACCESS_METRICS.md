# How to Access Your Metrics Dashboards

## 3 Ways to Access Processing Metrics

### 1. **Admin Dashboard** (Primary - For You/Staff)

**URL:** https://n-zero.dev/admin/image-processing

**Who can access:**
- Admin users (you)
- Staff with admin privileges

**How to add link:**

Add to `AdminDashboard.tsx` tabs:

```typescript
<button 
  onClick={() => navigate('/admin/image-processing')}
  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded"
>
  📊 Image Processing
</button>
```

Or add as tab:
```typescript
<button
  onClick={() => setActiveTab('processing')}
  className={activeTab === 'processing' ? 'active' : ''}
>
  Image Processing
</button>

// In tab content:
{activeTab === 'processing' && (
  <ImageProcessingDashboard />
)}
```

**What it shows:**
- Real-time processing progress
- Cost accumulation
- Model usage breakdown
- Context quality distribution
- Recent activity feed
- Quality metrics

---

### 2. **Vehicle Profile Page** (For Vehicle Owners)

**URL:** https://n-zero.dev/vehicle/[vehicle-id]

**Who can access:**
- Vehicle owner
- Contributors to that vehicle
- Anyone viewing the profile

**Add to VehicleProfile.tsx:**

```typescript
import ProfileCompletenessCard from '../components/ProfileCompletenessCard';

// In the profile page (e.g., sidebar or stats section):
<ProfileCompletenessCard vehicleId={vehicleId} />
```

**What vehicle owners see:**
- Their vehicle's completeness score (0-100)
- Tier rating (minimal/fair/good/excellent/complete)
- Top priorities to improve score
- Cost implications:
  - "Your profile has rich context - images process for $0.0001 each!"
  - "Add 3 more receipts to unlock cheaper processing"

**Why users care:**
- Higher score = cheaper AI analysis
- Shows exactly what to add next
- Gamification (get to 100%!)
- Validates authenticity (receipt confirmations)

---

### 3. **Mini Widget** (Always Visible)

**Where:** Bottom-right corner of ANY page

**Who sees it:**
- Anyone (when processing is active)
- Auto-hides when complete

**Add to AppLayout or any layout component:**

```typescript
import ProcessingMonitor from '../pages/ProcessingMonitor';

// At the end of your layout:
<ProcessingMonitor />
```

**What it shows:**
- Simple progress bar
- "Processing 1,872 / 2,741 images"
- Auto-updates every 3 seconds
- Floating widget (doesn't block UI)

---

## Navigation Flow

### For Admins (You):

```
Login → Dashboard → Admin Section → "Image Processing" tab

Direct URL: https://n-zero.dev/admin/image-processing
```

### For Users (Vehicle Owners):

```
Login → My Vehicles → [Select Vehicle] → See "Profile Completeness" card

Shows:
┌─────────────────────────────────┐
│ Profile Completeness       67%  │
├─────────────────────────────────┤
│ ████████████░░░░░░░░            │
│                                 │
│ EXCELLENT tier                  │
│                                 │
│ Processing Cost: $0.0005/img    │
│ AI Confidence: HIGH             │
│                                 │
│ Top Priorities:                 │
│ 1. Add 3 more receipts  +3 pts  │
│ 2. Upload manual       +10 pts  │
│ 3. Add timeline events  +2 pts  │
└─────────────────────────────────┘
```

### For Anyone (When Processing Active):

```
Visit any page → See floating widget bottom-right:

┌─────────────────────────┐
│ Image Processing        │
│ ━━━━━━━░░░░░░  68.3%   │
│ 1,872 / 2,741           │
│ ⏱ ETA: 47 min          │
└─────────────────────────┘
```

---

## Quick Setup

### Step 1: Add Route (Already Done ✅)

In `App.tsx`:
```typescript
import ImageProcessingDashboard from './pages/ImageProcessingDashboard';

<Route path="/admin/image-processing" element={<ImageProcessingDashboard />} />
```

### Step 2: Add Link in AdminDashboard

```typescript
// Add to navigation in AdminDashboard.tsx
<nav className="space-x-4">
  <button onClick={() => navigate('/admin')}>Overview</button>
  <button onClick={() => navigate('/admin/verifications')}>Verifications</button>
  <button onClick={() => navigate('/admin/image-processing')}>
    📊 Image Processing
  </button>
</nav>
```

### Step 3: Add Completeness to Vehicle Profiles

In `VehicleProfile.tsx`:
```typescript
import ProfileCompletenessCard from '../components/ProfileCompletenessCard';

// In the stats/info section:
<ProfileCompletenessCard vehicleId={vehicleId} />
```

### Step 4: Add Global Widget (Optional)

In `AppLayout.tsx` or main layout:
```typescript
import ProcessingMonitor from '../pages/ProcessingMonitor';

// At end of layout:
<ProcessingMonitor />
```

---

## Access Control

### Admin Dashboard (Restricted)
```typescript
// Already has admin check in AdminDashboard.tsx
const { data: adminData } = await supabase
  .from('admin_users')
  .select('*')
  .eq('user_id', user.id)
  .eq('is_active', true)
  .single();

if (!adminData) {
  // Redirect - not authorized
}
```

### Profile Completeness (Owner/Contributors)
```typescript
// Can show to:
// 1. Vehicle owner (always)
// 2. Contributors (if they helped document)
// 3. Public viewers (read-only, motivate contributions)

// RLS policy:
CREATE POLICY "Users can view completeness for their vehicles"
ON vehicle_processing_summary
FOR SELECT
USING (
  vehicle_id IN (
    SELECT id FROM vehicles WHERE owner_id = auth.uid()
  )
);
```

### Mini Widget (Everyone When Active)
```typescript
// Shows to everyone when processing is happening
// Auto-hides when complete
// No sensitive data - just overall progress
```

---

## Real-World Usage

### Scenario 1: Admin Monitoring Batch Process

1. Start batch: `node scripts/tiered-batch-processor.js`
2. Open browser: https://n-zero.dev/admin/image-processing
3. Watch real-time:
   - Progress bars update every 5s
   - Cost counter ticks up
   - Recent activity scrolls
   - Alerts show if errors
4. Take action:
   - Pause if costs too high
   - Export report when done
   - Check gap reports

### Scenario 2: User Adds Documentation

1. User uploads receipt for their vehicle
2. System auto-calculates new completeness score
3. Profile card updates: "67% → 73% (+6 points!)"
4. Shows: "Processing cost reduced from $0.005 to $0.0001 per image!"
5. Button appears: "Reprocess images with new context ($0.08 total)"
6. User clicks → Images reprocessed cheaply with receipt context

### Scenario 3: Public Viewer Sees Quality

1. Someone browsing vehicles
2. Sees completeness badge on vehicle cards:
   ```
   1985 K5 Blazer
   [EXCELLENT - 78%] ← Completeness badge
   ```
3. Knows: "This vehicle is well-documented"
4. More likely to trust authenticity
5. Higher perceived value

---

## Summary

**Admin Access:**
```
You → https://n-zero.dev/admin/image-processing
See: Everything (costs, models, quality, errors)
```

**User Access:**
```
Vehicle Owner → Vehicle Profile Page
See: Their vehicle's completeness score
Action: Add docs to improve score (and reduce processing costs!)
```

**Public Access:**
```
Anyone → Vehicle cards show completeness badge
See: Quality indicator (78% = well-documented)
```

**Always-On:**
```
Anyone (when processing active) → Floating widget
See: Overall progress, non-sensitive
```

The metrics drive user behavior - high completeness = cheaper processing = users add more docs!

